import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  buildSystemAudioArgs,
  darwinSupportsTap,
  LineSplitter,
  parseStatusLine,
  systemAudioBinPath,
  systemAudioSupported,
  type SystemAudioStatus,
} from '../src/shared/system-audio'
import { SystemAudioCapture } from '../src/main/meetings/system-audio'
import { runQuitHooks } from '../src/main/quit'

describe('parseStatusLine', () => {
  it('lê o ready com o tempo de partida e os processos excluídos', () => {
    expect(parseStatusLine('{"event":"ready","exclude_pids":2,"excluded":3,"startup_ms":46,"t":1794065120.197}')).toEqual({
      event: 'ready',
      startupMs: 46,
      excluded: 3,
    })
  })
  it('lê o nível por segundo, com os floats longos do JSONSerialization', () => {
    expect(parseStatusLine('{"all_zero":false,"callbacks":94,"event":"level","frames":48128,"peak":0.26800000000000002,"rms_dbfs":-17.600000000000001,"sec":0}')).toEqual({
      event: 'level',
      sec: 0,
      rmsDbfs: -17.6,
      peak: 0.268,
      allZero: false,
    })
  })
  it('lê o aviso de silêncio total e o de nenhum buffer', () => {
    expect(parseStatusLine('{"event":"warning","kind":"all_zero","seconds":3,"ever_nonzero":false}')).toEqual({
      event: 'warning',
      kind: 'all_zero',
      seconds: 3,
      everNonzero: false,
    })
    expect(parseStatusLine('{"event":"warning","kind":"no_callbacks","seconds":3}')).toEqual({ event: 'warning', kind: 'no_callbacks', seconds: 3 })
    expect(parseStatusLine('{"event":"warning","kind":"outro"}')).toBeNull()
  })
  it('lê o erro com o passo e o OSStatus', () => {
    expect(parseStatusLine('{"event":"error","step":"create_tap","osstatus":560947818}')).toEqual({ event: 'error', step: 'create_tap', osstatus: 560947818 })
  })
  it('não deixa texto livre passar como passo ou motivo', () => {
    expect(parseStatusLine('{"event":"error","step":"Olá, isto é fala","osstatus":1}')).toEqual({ event: 'error', step: 'unknown', osstatus: 1 })
  })
  it('lê o resumo e a suspeita de permissão negada', () => {
    const line =
      '{"all_zero":true,"conv_errors":0,"event":"summary","in_frames":192000,"out_frames":63989,"out_seconds":3.999,"permission_suspect":true,"reason":"sigterm","uptime_ms":4072,"zero_seconds":4}'
    expect(parseStatusLine(line)).toEqual({
      event: 'summary',
      reason: 'sigterm',
      outSeconds: 3.999,
      allZero: true,
      zeroSeconds: 4,
      convErrors: 0,
      permissionSuspect: true,
      uptimeMs: 4072,
    })
  })
  it('resume o teardown em ok ou não', () => {
    expect(parseStatusLine('{"event":"teardown","osstatus":{"destroyAggregate":0,"destroyTap":0,"stop":0}}')).toEqual({ event: 'teardown', ok: true })
    expect(parseStatusLine('{"event":"teardown","osstatus":{"destroyTap":-50}}')).toEqual({ event: 'teardown', ok: false })
  })
  it('lê o formato e as trocas na lista de excluídos', () => {
    expect(parseStatusLine('{"event":"format","in_bits":32,"in_channels":2,"in_rate":48000,"out_rate":16000}')).toEqual({ event: 'format', inRate: 48000, inChannels: 2, inBits: 32 })
    expect(parseStatusLine('{"event":"excluded","count":2}')).toEqual({ event: 'excluded', count: 2 })
  })
  it('ignora lixo, JSON quebrado, eventos desconhecidos e campos de tipo errado', () => {
    for (const line of ['', 'Fatal error: crash', '{"event":', '[1,2]', 'null', '{"event":"novo"}', '{"event":"level","sec":"0","rms_dbfs":-1,"peak":0}', '{"event":"excluded"}']) {
      expect(parseStatusLine(line)).toBeNull()
    }
  })
})

describe('LineSplitter', () => {
  it('junta linhas que chegam partidas entre pedaços', () => {
    const s = new LineSplitter()
    expect(s.push('{"event":"rea')).toEqual([])
    expect(s.push('dy"}\n{"event":"excluded","count":1}\n{"ev')).toEqual(['{"event":"ready"}', '{"event":"excluded","count":1}'])
    expect(s.push('ent":"x"}')).toEqual([])
    expect(s.end()).toEqual(['{"event":"x"}'])
    expect(s.end()).toEqual([])
  })
  it('descarta uma linha sem fim que passa do limite', () => {
    const s = new LineSplitter()
    s.push('x'.repeat(5000))
    expect(s.push('\n{"a":1}\n')).toEqual(['{"a":1}'])
  })
})

describe('buildSystemAudioArgs', () => {
  it('passa cada PID como argumento próprio, sem shell, e sempre vigia o stdin', () => {
    expect(buildSystemAudioArgs({ excludePids: [4321, 99] })).toEqual(['--exclude-pid', '99', '--exclude-pid', '4321', '--exit-on-stdin-eof'])
  })
  it('descarta PIDs inválidos e repetidos', () => {
    expect(buildSystemAudioArgs({ excludePids: [0, -1, 1.5, NaN, 2 ** 31, 7, 7] })).toEqual(['--exclude-pid', '7', '--exit-on-stdin-eof'])
  })
  it('só põe --seconds com um número positivo', () => {
    expect(buildSystemAudioArgs({ seconds: 5 })).toEqual(['--seconds', '5', '--exit-on-stdin-eof'])
    expect(buildSystemAudioArgs({ seconds: 0 })).toEqual(['--exit-on-stdin-eof'])
    expect(buildSystemAudioArgs({ seconds: Infinity })).toEqual(['--exit-on-stdin-eof'])
    expect(buildSystemAudioArgs()).toEqual(['--exit-on-stdin-eof'])
  })
})

describe('versão do macOS', () => {
  it('exige Darwin 23.2 (macOS 14.2) ou mais novo', () => {
    expect(darwinSupportsTap('23.1.0')).toBe(false)
    expect(darwinSupportsTap('23.2.0')).toBe(true)
    expect(darwinSupportsTap('24.0.0')).toBe(true)
    expect(darwinSupportsTap('27.0.0')).toBe(true)
    expect(darwinSupportsTap('22.6.0')).toBe(false)
    expect(darwinSupportsTap('lixo')).toBe(false)
  })
  it('só no macOS', () => {
    expect(systemAudioSupported('darwin', '25.1.0')).toBe(true)
    expect(systemAudioSupported('win32', '10.0.22631')).toBe(false)
    expect(systemAudioSupported('linux', '30.0.0')).toBe(false)
  })
})

describe('systemAudioBinPath', () => {
  it('empacotado lê de Contents/Resources/bin; em dev, de resources/bin no repo', () => {
    expect(systemAudioBinPath({ packaged: true, resourcesPath: '/Applications/Agent Office.app/Contents/Resources', appPath: '/x' })).toBe(
      '/Applications/Agent Office.app/Contents/Resources/bin/system-audio-tap',
    )
    expect(systemAudioBinPath({ packaged: false, resourcesPath: '/e', appPath: '/repo/' })).toBe('/repo/resources/bin/system-audio-tap')
  })
})

// The helper is swapped for a small node script that speaks the same stderr protocol.
const posix = process.platform !== 'win32'
const dir = mkdtempSync(join(tmpdir(), 'system-audio-fake-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function fake(name: string, body: string): string {
  const file = join(dir, name)
  const argsFile = JSON.stringify(`${file}.args`)
  writeFileSync(
    file,
    `#!${process.execPath}
require('fs').writeFileSync(${argsFile}, JSON.stringify(process.argv.slice(2)))
const say = (o) => process.stderr.write(JSON.stringify(o) + '\\n')
${body}
`,
  )
  chmodSync(file, 0o755)
  return file
}

const READY_THEN_STREAM = `
say({ event: 'format', in_rate: 48000, in_channels: 2, in_bits: 32 })
say({ event: 'ready', startup_ms: 3, excluded: 2 })
const tick = setInterval(() => process.stdout.write(Buffer.alloc(320)), 20)
setTimeout(() => say({ event: 'level', sec: 0, rms_dbfs: -21.5, peak: 0.2, all_zero: false }), 30)
process.on('SIGTERM', () => {
  clearInterval(tick)
  say({ event: 'teardown', osstatus: { stop: 0, destroyTap: 0 } })
  say({ event: 'summary', reason: 'sigterm', out_seconds: 0.1, all_zero: false, zero_seconds: 0, conv_errors: 0, permission_suspect: false, uptime_ms: 100 })
  process.exit(0)
})
`

describe.runIf(posix)('SystemAudioCapture com um ajudante falso', () => {
  let cap: SystemAudioCapture | null = null
  afterEach(async () => {
    await cap?.stop()
    cap = null
  })
  const darwin = { platform: 'darwin', osRelease: '25.0.0' }

  it('passa os PIDs como argv, entrega o PCM e os eventos, e para com SIGTERM', async () => {
    const bin = fake('ok', READY_THEN_STREAM)
    cap = new SystemAudioCapture({ ...darwin, binPath: bin })
    const events: SystemAudioStatus[] = []
    let bytes = 0
    await cap.start({ excludePids: [process.pid, 12], onPcm: (b) => (bytes += b.length), onStatus: (e) => events.push(e) })
    expect(cap.running).toBe(true)
    expect(JSON.parse(readFileSync(`${bin}.args`, 'utf8'))).toEqual(['--exclude-pid', '12', '--exclude-pid', String(process.pid), '--exit-on-stdin-eof'])
    await new Promise((r) => setTimeout(r, 120))
    await cap.stop()
    expect(cap.running).toBe(false)
    expect(bytes).toBeGreaterThan(0)
    const kinds = events.map((e) => e.event)
    expect(kinds.slice(0, 2)).toEqual(['format', 'ready'])
    expect(kinds).toContain('level')
    expect(kinds.slice(-3)).toEqual(['teardown', 'summary', 'exit'])
    expect(events.find((e) => e.event === 'summary')).toMatchObject({ reason: 'sigterm' })
  })

  it('avisa que espera a permissão e segue esperando até o ready', async () => {
    const bin = fake('slow', `setTimeout(() => say({ event: 'ready', startup_ms: 250, excluded: 1 }), 250)\nsetInterval(() => {}, 1000)`)
    cap = new SystemAudioCapture({ ...darwin, binPath: bin, permissionHintMs: 40, readyTimeoutMs: 5000 })
    const events: string[] = []
    await cap.start({ onPcm: () => undefined, onStatus: (e) => events.push(e.event) })
    expect(events).toEqual(['waiting-permission', 'ready'])
  })

  it('desiste no prazo e não deixa o processo para trás', async () => {
    const bin = fake('mute', `setInterval(() => {}, 1000)`)
    cap = new SystemAudioCapture({ ...darwin, binPath: bin, permissionHintMs: 20, readyTimeoutMs: 150 })
    const events: string[] = []
    await expect(cap.start({ onPcm: () => undefined, onStatus: (e) => events.push(e.event) })).rejects.toThrow(/Ajustes/)
    await cap.stop()
    expect(cap.running).toBe(false)
    expect(events).toEqual(['waiting-permission', 'exit'])
  })

  it('erro do Core Audio antes do ready vira uma mensagem com o passo', async () => {
    const bin = fake('fail', `say({ event: 'error', step: 'create_tap', osstatus: -50 })\nprocess.exit(1)`)
    cap = new SystemAudioCapture({ ...darwin, binPath: bin })
    await expect(cap.start({ onPcm: () => undefined })).rejects.toThrow(/create_tap, OSStatus -50/)
    expect(cap.running).toBe(false)
  })

  it('usa SIGKILL quando o ajudante ignora o SIGTERM', async () => {
    const bin = fake('stubborn', `process.on('SIGTERM', () => {})\nsay({ event: 'ready', startup_ms: 1, excluded: 0 })\nsetInterval(() => {}, 1000)`)
    cap = new SystemAudioCapture({ ...darwin, binPath: bin, killAfterMs: 100 })
    let exit: SystemAudioStatus | undefined
    await cap.start({ onPcm: () => undefined, onStatus: (e) => e.event === 'exit' && (exit = e) })
    await cap.stop()
    expect(exit).toEqual({ event: 'exit', code: null, signal: 'SIGKILL' })
  })

  it('para junto com o app (onQuit)', async () => {
    const bin = fake('quit', READY_THEN_STREAM)
    cap = new SystemAudioCapture({ ...darwin, binPath: bin })
    let exited = false
    await cap.start({ onPcm: () => undefined, onStatus: (e) => e.event === 'exit' && (exited = true) })
    runQuitHooks()
    await cap.stop()
    expect(exited).toBe(true)
  })

  it('recusa começar duas vezes, fora do macOS 14.2 e sem o binário', async () => {
    const bin = fake('twice', READY_THEN_STREAM)
    cap = new SystemAudioCapture({ ...darwin, binPath: bin })
    await cap.start({ onPcm: () => undefined })
    await expect(cap.start({ onPcm: () => undefined })).rejects.toThrow(/já está/)
    await expect(new SystemAudioCapture({ platform: 'darwin', osRelease: '23.1.0', binPath: bin }).start({ onPcm: () => undefined })).rejects.toThrow(/14\.2/)
    const missing = join(dir, 'nao-existe')
    expect(existsSync(missing)).toBe(false)
    await expect(new SystemAudioCapture({ ...darwin, binPath: missing }).start({ onPcm: () => undefined })).rejects.toThrow(/npm run native/)
  })
})
