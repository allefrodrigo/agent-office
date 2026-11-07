import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  buildServerArgs,
  doctor,
  newToken,
  sanitize,
  stopAllWhisper,
  TranscriptionQueue,
  transcribeCli,
  WhisperServer,
  type TranscribeOptions,
  type TranscriptionJob,
} from '../src/main/meetings/whisper'
import { findBin, findWhisperModel } from '../src/main/creative/tools'
import type { Track, WhisperSegment } from '@shared/types/meetings'

const TOKEN = 'a'.repeat(64)
const VERBOSE = JSON.stringify({ segments: [{ start: 0, end: 1.5, text: ' olá pessoal ', no_speech_prob: 0.01 }] })

/** Um whisper-server de mentira: processo que sai quando mandam e rede que só responde com ele vivo. */
function fakeMachine(opts: { ready?: boolean } = {}) {
  const spawns: { cmd: string; args: string[]; opts: SpawnOptions; child: FakeChild }[] = []
  class FakeChild extends EventEmitter {
    pid = 1000 + spawns.length
    exitCode: number | null = null
    signalCode: NodeJS.Signals | null = null
    signals: string[] = []
    kill(sig: NodeJS.Signals = 'SIGTERM') {
      this.signals.push(sig)
      this.die(null, sig)
      return true
    }
    die(code: number | null, signal: NodeJS.Signals | null = null) {
      if (this.exitCode !== null || this.signalCode !== null) return
      this.exitCode = code
      this.signalCode = signal
      this.emit('exit', code, signal)
    }
  }
  const spawn = vi.fn((cmd: string, args: string[], o: SpawnOptions) => {
    const child = new FakeChild()
    spawns.push({ cmd, args, opts: o, child })
    return child as unknown as ChildProcess
  })
  const alive = () => {
    const last = spawns.at(-1)
    return last && last.child.exitCode === null && last.child.signalCode === null ? last : undefined
  }
  const requests: string[] = []
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    requests.push(u)
    const cur = alive()
    if (!cur) throw new Error(`connect ECONNREFUSED ${u}`)
    const token = cur.args[cur.args.indexOf('--request-path') + 1]
    if (!u.includes(token)) return new Response('', { status: 404 })
    if (init?.method === 'POST') return new Response(VERBOSE, { status: 200 })
    return new Response('<html>', { status: opts.ready === false ? 503 : 200 })
  }) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>
  let port = 40000
  return { spawn, fetch, spawns, requests, alive, port: async () => port++ }
}

const wav = new Uint8Array([82, 73, 70, 70])
const tokenOf = (args: string[]) => args[args.indexOf('--request-path') + 1].slice(1)

describe('buildServerArgs', () => {
  it('monta a linha do ADR 0012, com o token só no --request-path e sem --convert', () => {
    const args = buildServerArgs({ model: '/m/ggml-small.bin', port: 4321, token: TOKEN, lang: 'pt' })
    expect(args).toEqual(['-m', '/m/ggml-small.bin', '--host', '127.0.0.1', '--port', '4321', '--request-path', `/${TOKEN}`, '-l', 'pt', '-nth', '0.6', '-sns'])
    expect(args).not.toContain('--convert')
    expect(args.filter((a) => a.includes(TOKEN))).toEqual([`/${TOKEN}`])
  })

  it('token novo de 32 bytes em hex a cada chamada', () => {
    const a = newToken()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(newToken()).not.toBe(a)
  })

  it('sanitize tira o token e o que tem cara de token', () => {
    expect(sanitize(`http://127.0.0.1:1/${TOKEN}/inference`, TOKEN)).toBe('http://127.0.0.1:1/[token]/inference')
    expect(sanitize(`falhou em /${'f0'.repeat(32)}/`)).toBe('falhou em /[token]/')
  })
})

describe('WhisperServer', () => {
  it('sobe sem shell, em 127.0.0.1 com token novo, e transcreve por multipart', async () => {
    const m = fakeMachine()
    const s = new WhisperServer({ model: '/m/ggml-small.bin', serverBin: '/bin/whisper-server', cliBin: '/bin/whisper-cli', spawn: m.spawn, fetch: m.fetch, port: m.port })
    expect(await s.start()).toBe('server')
    const { cmd, args, opts } = m.spawns[0]
    expect(cmd).toBe('/bin/whisper-server')
    expect(opts.shell).toBe(false)
    expect(args).not.toContain('--convert')
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1')
    expect(tokenOf(args)).toMatch(/^[0-9a-f]{64}$/)

    const segs = await s.transcribe(wav, { lang: 'pt', prompt: 'Ana, checkout' })
    expect(segs).toEqual([{ start: 0, end: 1500, text: 'olá pessoal', noSpeechProb: 0.01 }])
    const post = m.fetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!
    expect(String(post[0])).toBe(`http://127.0.0.1:40000/${tokenOf(args)}/inference`)
    const body = (post[1] as RequestInit).body as FormData
    expect(body.get('response_format')).toBe('verbose_json')
    expect(body.get('temperature')).toBe('0')
    expect(body.get('language')).toBe('pt')
    expect(body.get('prompt')).toBe('Ana, checkout')
    expect(m.requests.some((u) => u.includes('/load'))).toBe(false)

    await s.stop()
    expect(m.spawns[0].child.signals).toEqual(['SIGTERM'])
    expect(s.mode).toBe('stopped')
  })

  it('o token não aparece nas mensagens de erro', async () => {
    const m = fakeMachine()
    const s = new WhisperServer({ model: '/m/ggml-small.bin', serverBin: '/bin/whisper-server', spawn: m.spawn, fetch: m.fetch, port: m.port })
    await s.start()
    const token = tokenOf(m.spawns[0].args)
    const errors: string[] = []

    // A rede cai com a URL na mensagem.
    m.fetch.mockImplementationOnce(async (url: string | URL) => {
      throw new Error(`connect ECONNREFUSED ${String(url)}`)
    })
    await s.transcribe(wav, { lang: 'pt' }).catch((e: Error) => errors.push(e.message))
    // O servidor responde com erro.
    m.fetch.mockImplementationOnce(async () => new Response('x', { status: 500 }))
    await s.transcribe(wav, { lang: 'pt' }).catch((e: Error) => errors.push(e.message))
    // O corpo não é JSON.
    m.fetch.mockImplementationOnce(async () => new Response('nada', { status: 200 }))
    await s.transcribe(wav, { lang: 'pt' }).catch((e: Error) => errors.push(e.message))
    // Tempo esgotado.
    m.fetch.mockImplementationOnce(async () => {
      throw Object.assign(new Error(`aborted ${token}`), { name: 'TimeoutError' })
    })
    await s.transcribe(wav, { lang: 'pt' }).catch((e: Error) => errors.push(e.message))

    expect(errors).toHaveLength(4)
    expect(errors[1]).toContain('HTTP 500')
    expect(errors[3]).toContain('60 s')
    for (const e of errors) expect(e).not.toContain(token)
    await s.stop()
  })

  it('servidor que não fica pronto, sem whisper-cli: erro sem token e com o que instalar', async () => {
    const m = fakeMachine({ ready: false })
    const s = new WhisperServer({ model: '/m/ggml-small.bin', serverBin: '/bin/whisper-server', spawn: m.spawn, fetch: m.fetch, port: m.port, readyTimeoutMs: 250 })
    const err = await s.start().catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('brew install whisper-cpp')
    expect((err as Error).message).not.toContain(tokenOf(m.spawns[0].args))
    expect(m.spawns[0].child.signals).toContain('SIGKILL')
    await s.stop()
  })

  it('primeira queda: sobe outro com token e porta novos; segunda: passa ao whisper-cli', async () => {
    const m = fakeMachine()
    const modes: string[] = []
    const cli = vi.fn(async (): Promise<WhisperSegment[]> => [{ start: 0, end: 900, text: 'pelo cli' }])
    const s = new WhisperServer({
      model: '/m/ggml-small.bin',
      serverBin: '/bin/whisper-server',
      cliBin: '/bin/whisper-cli',
      spawn: m.spawn,
      fetch: m.fetch,
      port: m.port,
      cli,
      onModeChange: (mode, crashes) => modes.push(`${mode}:${crashes}`),
    })
    await s.start()
    m.spawns[0].child.die(1)
    expect(await s.transcribe(wav, { lang: 'pt' })).toHaveLength(1)
    expect(m.spawns).toHaveLength(2)
    expect(tokenOf(m.spawns[1].args)).not.toBe(tokenOf(m.spawns[0].args))
    expect(m.spawns[1].args[m.spawns[1].args.indexOf('--port') + 1]).not.toBe(m.spawns[0].args[m.spawns[0].args.indexOf('--port') + 1])
    expect(s.mode).toBe('server')
    expect(cli).not.toHaveBeenCalled()

    m.spawns[1].child.die(null, 'SIGSEGV')
    expect(s.mode).toBe('cli')
    expect(s.crashCount).toBe(2)
    expect(await s.transcribe(wav, { lang: 'pt', prompt: 'p' })).toEqual([{ start: 0, end: 900, text: 'pelo cli' }])
    expect(cli).toHaveBeenCalledWith(wav, expect.objectContaining({ bin: '/bin/whisper-cli', model: '/m/ggml-small.bin', lang: 'pt', prompt: 'p' }))
    expect(m.spawns).toHaveLength(2)
    expect(modes).toEqual(['server:0', 'server:1', 'cli:2'])
    await s.stop()
  })

  it('queda no meio de um trecho: refaz no servidor novo', async () => {
    const m = fakeMachine()
    const s = new WhisperServer({ model: '/m/ggml-small.bin', serverBin: '/bin/whisper-server', cliBin: '/bin/whisper-cli', spawn: m.spawn, fetch: m.fetch, port: m.port })
    await s.start()
    const real = m.fetch.getMockImplementation()!
    m.fetch.mockImplementationOnce(async () => {
      m.spawns[0].child.die(1)
      throw new Error('socket hang up')
    })
    m.fetch.mockImplementation(real)
    expect(await s.transcribe(wav, { lang: 'pt' })).toHaveLength(1)
    expect(m.spawns).toHaveLength(2)
    await s.stop()
  })

  it('sem whisper-server, vai direto ao whisper-cli', async () => {
    const m = fakeMachine()
    const cli = vi.fn(async (): Promise<WhisperSegment[]> => [])
    const s = new WhisperServer({ model: '/m/ggml-base.bin', cliBin: '/bin/whisper-cli', spawn: m.spawn, fetch: m.fetch, cli })
    expect(await s.start()).toBe('cli')
    await s.transcribe(wav, { lang: 'en' })
    expect(m.spawn).not.toHaveBeenCalled()
    expect(cli).toHaveBeenCalledOnce()
    await s.stop()
  })

  it('stopAllWhisper encerra todo servidor vivo', async () => {
    const m = fakeMachine()
    const a = new WhisperServer({ model: '/m/x.bin', serverBin: '/bin/ws', spawn: m.spawn, fetch: m.fetch, port: m.port })
    await a.start()
    await stopAllWhisper()
    expect(m.spawns[0].child.signals).toEqual(['SIGTERM'])
    expect(a.mode).toBe('stopped')
    await expect(a.transcribe(wav, { lang: 'pt' })).rejects.toThrow('encerrada')
  })
})

describe('transcribeCli', () => {
  it('grava o WAV 0600 numa pasta temporária, roda o whisper-cli sem shell e apaga tudo', async () => {
    let seen: { bin: string; args: string[]; mode: number; dir: string } | undefined
    const segs = await transcribeCli(wav, {
      bin: '/bin/whisper-cli',
      model: '/m/ggml-small.bin',
      lang: 'pt',
      prompt: 'Ana',
      run: async (bin, args) => {
        const file = args[args.indexOf('-f') + 1]
        const out = args[args.indexOf('-of') + 1]
        seen = { bin, args, mode: statSync(file).mode & 0o777, dir: join(file, '..') }
        expect(readFileSync(file)).toEqual(Buffer.from(wav))
        writeFileSync(`${out}.json`, JSON.stringify({ transcription: [{ offsets: { from: 0, to: 1200 }, text: ' oi ' }] }))
      },
    })
    expect(segs).toEqual([{ start: 0, end: 1200, text: 'oi' }])
    expect(seen!.bin).toBe('/bin/whisper-cli')
    const a = seen!.args
    expect(a.slice(0, 2)).toEqual(['-m', '/m/ggml-small.bin'])
    expect(a).toEqual(expect.arrayContaining(['-l', 'pt', '-oj', '--prompt', 'Ana']))
    expect(a.at(-1)).toBe('-np')
    expect(a[a.indexOf('-f') + 1].startsWith(tmpdir())).toBe(true)
    if (process.platform !== 'win32') expect(seen!.mode).toBe(0o600)
    expect(existsSync(seen!.dir)).toBe(false)
  })

  it('apaga a pasta mesmo quando o whisper-cli falha', async () => {
    let dir = ''
    await expect(
      transcribeCli(wav, {
        bin: 'x',
        model: 'm',
        lang: 'pt',
        run: async (_b, args) => {
          dir = join(args[args.indexOf('-f') + 1], '..')
          throw new Error('O whisper-cli falhou ao transcrever o trecho.')
        },
      }),
    ).rejects.toThrow('falhou')
    expect(dir).not.toBe('')
    expect(existsSync(dir)).toBe(false)
  })
})

describe('TranscriptionQueue', () => {
  const pcm = new Int16Array(160)
  const job = (track: Track, start: number, end = start + 5000): TranscriptionJob => ({ meetingId: 'r1', track, start, end, pcm })

  /** Whisper falso que só responde quando o teste solta. */
  function gated() {
    const calls: { resolve: (s: WhisperSegment[]) => void; reject: (e: Error) => void }[] = []
    const transcribe = vi.fn((_wav: Uint8Array, _opts: TranscribeOptions) => new Promise<WhisperSegment[]>((resolve, reject) => calls.push({ resolve, reject })))
    const next = async (segs: WhisperSegment[] = []) => {
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0))
      calls.shift()!.resolve(segs)
      await new Promise((r) => setTimeout(r, 0))
    }
    return { transcribe, calls, next }
  }

  it('um por vez, em ordem de início, alternando as faixas', async () => {
    const g = gated()
    const order: string[] = []
    const q = new TranscriptionQueue({ transcribe: g.transcribe, lang: 'pt', onResult: (j) => order.push(`${j.track}@${j.start}`) })
    q.push(job('eu', 0))
    // Enquanto o primeiro roda, chegam três do microfone e dois do sistema, fora de ordem.
    q.push(job('eu', 20000))
    q.push(job('eu', 10000))
    q.push(job('outros', 15000))
    q.push(job('eu', 30000))
    q.push(job('outros', 5000))
    expect(g.transcribe).toHaveBeenCalledTimes(1)
    expect(q.pending).toBe(6)
    for (let i = 0; i < 6; i++) await g.next()
    expect(order).toEqual(['eu@0', 'outros@5000', 'eu@10000', 'outros@15000', 'eu@20000', 'eu@30000'])
    expect(q.processed).toBe(6)
    const [sent, opts] = g.transcribe.mock.calls[0]
    expect(opts).toEqual({ lang: 'pt', prompt: undefined })
    expect(String.fromCharCode(...sent.slice(0, 4))).toBe('RIFF')
  })

  it('mede o atraso: agora menos a hora em que o trecho terminou', async () => {
    let now = 1_000_000
    const delays: [number, number][] = []
    const g = gated()
    const q = new TranscriptionQueue({
      transcribe: g.transcribe,
      lang: 'pt',
      startedAt: 1_000_000 - 30_000,
      now: () => now,
      onResult: () => {},
      onDelay: (d, p) => delays.push([d, p]),
    })
    q.push(job('outros', 20_000, 28_000)) // terminou há 2 s
    expect(delays.at(-1)).toEqual([2000, 1])
    now += 3000
    await g.next()
    expect(q.delayMs).toBe(5000)
    expect(delays.at(-1)).toEqual([5000, 0])
  })

  it('erro de um trecho não para a fila; drain espera o fim', async () => {
    const errors: string[] = []
    const results: number[] = []
    const q = new TranscriptionQueue({
      transcribe: async (_w, o) => {
        if (o.prompt === 'falha') throw new Error('quebrou')
        return []
      },
      lang: 'pt',
      onResult: (j) => results.push(j.start),
      onError: (_j, e) => errors.push(e.message),
    })
    q.push({ ...job('eu', 0), prompt: 'falha' })
    q.push(job('eu', 5000))
    await q.drain()
    expect(errors).toEqual(['quebrou'])
    expect(results).toEqual([5000])
    await q.drain()
  })

  it('clear descarta o que espera e ignora o trecho em andamento', async () => {
    const g = gated()
    const results: number[] = []
    const q = new TranscriptionQueue({ transcribe: g.transcribe, lang: 'pt', onResult: (j) => results.push(j.start) })
    q.push(job('eu', 0))
    q.push(job('eu', 5000))
    const drained = q.drain()
    q.clear()
    await drained
    await g.next([{ start: 0, end: 1, text: 'x' }])
    expect(results).toEqual([])
    // Depois de limpar, a fila volta a andar.
    q.push(job('outros', 9000))
    await g.next()
    expect(results).toEqual([9000])
  })
})

describe('doctor', () => {
  it('tudo instalado', () => {
    const d = doctor({ bin: (n) => `/opt/homebrew/bin/${n}`, model: () => '/Users/x/.cache/whisper/ggml-small.bin' })
    expect(d.canTranscribe).toBe(true)
    expect(d.problems).toEqual([])
    expect(d.model.found).toBe('ggml-small.bin')
    expect(d.whisperServer.found).toBe('/opt/homebrew/bin/whisper-server')
  })

  it('cada falta diz o que fazer, em pt-BR', () => {
    const d = doctor({ bin: () => undefined, model: () => undefined })
    expect(d.canTranscribe).toBe(false)
    expect(d.whisperCli.message).toBe('Falta o whisper-cli. Instale com `brew install whisper-cpp` e tente de novo.')
    expect(d.whisperServer.message).toContain('Instale com `brew install whisper-cpp` e tente de novo.')
    expect(d.model.message).toContain('ggml-small.bin')
    expect(d.model.message).toMatch(/e tente de novo\.$/)
    expect(d.ffmpeg.message).toBe('Falta o ffmpeg. Instale com `brew install ffmpeg` e tente de novo.')
    expect(d.problems).toHaveLength(4)
  })

  it('só o whisper-cli e o modelo já bastam para transcrever', () => {
    const d = doctor({ bin: (n) => (n === 'whisper-cli' ? '/b/whisper-cli' : undefined), model: () => '/m/ggml-base.bin' })
    expect(d.canTranscribe).toBe(true)
    expect(d.problems).toHaveLength(2)
  })
})

// Binário real: AGENT_OFFICE_WHISPER_IT=1 npx vitest run test/meetings-whisper.test.ts
const IT = process.env.AGENT_OFFICE_WHISPER_IT === '1'
describe.skipIf(!IT)('whisper-server de verdade', () => {
  it('sobe, transcreve uma fala do `say` em pt-BR e encerra', async () => {
    const model = findWhisperModel()
    const serverBin = findBin('whisper-server')
    const cliBin = findBin('whisper-cli')
    const say = findBin('say')
    const ffmpeg = findBin('ffmpeg')
    expect(model && serverBin && cliBin && say && ffmpeg).toBeTruthy()
    const dir = mkdtempSync(join(tmpdir(), 'whisper-it-'))
    try {
      const aiff = join(dir, 'fala.aiff')
      const pcmFile = join(dir, 'fala.pcm')
      execFileSync(say!, ['-v', 'Luciana', '-o', aiff, 'Bom dia, pessoal. Vamos falar do checkout com pix e do limite do gateway.'])
      execFileSync(ffmpeg!, ['-loglevel', 'error', '-i', aiff, '-ac', '1', '-ar', '16000', '-f', 's16le', pcmFile])
      const buf = readFileSync(pcmFile)
      const pcm = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
      const { wavBytes } = await import('@shared/meeting-audio')

      const s = new WhisperServer({ model: model!, serverBin, cliBin, lang: 'pt' })
      const t0 = performance.now()
      expect(await s.start()).toBe('server')
      const startup = performance.now() - t0
      const lat: number[] = []
      let text = ''
      for (let i = 0; i < 3; i++) {
        const t = performance.now()
        const segs = await s.transcribe(wavBytes(pcm), { lang: 'pt', prompt: 'checkout, pix, gateway' })
        lat.push(performance.now() - t)
        text = segs.map((x) => x.text).join(' ')
      }
      const pid = s.pid!
      await s.stop()
      expect(() => process.kill(pid, 0)).toThrow()

      const t = performance.now()
      const cliSegs = await transcribeCli(wavBytes(pcm), { bin: cliBin!, model: model!, lang: 'pt', prompt: 'checkout, pix, gateway' })
      const cliMs = performance.now() - t

      console.log(
        JSON.stringify({
          model: model!.split('/').pop(),
          audioMs: Math.round((pcm.length / 16000) * 1000),
          startupMs: Math.round(startup),
          serverMs: lat.map(Math.round),
          cliMs: Math.round(cliMs),
          serverWords: text ? text.split(' ').length : 0,
          cliSegments: cliSegs.length,
        }),
      )
      expect(text.toLowerCase()).toMatch(/checkout|pix|gateway/)
      expect(cliSegs.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
