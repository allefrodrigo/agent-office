process.env.TZ = 'America/Sao_Paulo'

import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Meeting, MeetingEvent, Segment, Track, WhisperSegment } from '@shared/types/meetings'
import { AUDIO_CHUNK_MAX_BYTES } from '@shared/meetings'
import { MeetingRecorder, pauseMapper, type RecorderDeps, type SystemAudioLike, type WhisperLike } from '../src/main/meetings/recorder'
import { MeetingStore } from '../src/main/meetings/store'
import type { SystemAudioStartOptions } from '../src/main/meetings/system-audio'
import type { TranscribeOptions } from '../src/main/meetings/whisper'

const RATE = 16_000
const T0 = new Date(2026, 10, 7, 14, 30).getTime()

/** Tom de 440 Hz com pico `amp`: o whisper falso reconhece a "fala" pelo pico. */
const speech = (sec: number, amp: number) =>
  Int16Array.from({ length: Math.round(sec * RATE) }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / RATE)))
const silence = (sec: number) => new Int16Array(Math.round(sec * RATE))
const concat = (...parts: Int16Array[]) => {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
/** Fatias de 1 s. */
const seconds = (pcm: Int16Array) => Array.from({ length: Math.ceil(pcm.length / RATE) }, (_, i) => pcm.slice(i * RATE, (i + 1) * RATE))
const bytes = (pcm: Int16Array) => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)
const settle = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

/** Pico (arredondado ao milhar) → o que o whisper "ouviu". */
type Script = Record<number, { text: string; noSpeechProb?: number }>

class FakeWhisper implements WhisperLike {
  calls: TranscribeOptions[] = []
  started = false
  stopped = false
  gate: Promise<void> | null = null
  constructor(private script: Script) {}
  start() {
    this.started = true
    return Promise.resolve('server' as const)
  }
  async transcribe(wav: Uint8Array, opts: TranscribeOptions): Promise<WhisperSegment[]> {
    this.calls.push(opts)
    if (this.gate) await this.gate
    const v = new DataView(wav.buffer, wav.byteOffset + 44)
    let peak = 0
    for (let i = 0; i < v.byteLength / 2; i++) peak = Math.max(peak, Math.abs(v.getInt16(i * 2, true)))
    const hit = this.script[Math.round(peak / 1000) * 1000]
    const ms = Math.round(((wav.byteLength - 44) / 2 / RATE) * 1000)
    return hit ? [{ start: 0, end: ms, text: hit.text, noSpeechProb: hit.noSpeechProb }] : []
  }
  stop() {
    this.stopped = true
    return Promise.resolve()
  }
}

class FakeSystem implements SystemAudioLike {
  opts: SystemAudioStartOptions | null = null
  stops = 0
  fail: Error | null = null
  constructor(private ok = true) {}
  supported() {
    return this.ok
  }
  start(o: SystemAudioStartOptions) {
    this.opts = o
    return this.fail ? Promise.reject(this.fail) : Promise.resolve()
  }
  stop() {
    this.stops++
    this.opts?.onStatus?.({ event: 'exit', code: 0, signal: null })
    return Promise.resolve()
  }
}

let dir: string
let store: MeetingStore
let now: number
let events: MeetingEvent[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-recorder-'))
  store = new MeetingStore(dir)
  now = T0
  events = []
})
afterEach(() => {
  store.lock()
  rmSync(dir, { recursive: true, force: true })
})

function setup(opts: { script?: Script; system?: FakeSystem | null; deps?: Partial<RecorderDeps> } = {}) {
  const whisper = new FakeWhisper(opts.script ?? {})
  const finished: Meeting[] = []
  const rec = new MeetingRecorder({
    store,
    whisper: () => whisper,
    systemAudio: opts.system ? () => opts.system! : undefined,
    emit: (e) => events.push(e),
    clock: { now: () => now, every: () => () => undefined },
    onFinished: (m) => void finished.push(m),
    ...opts.deps,
  })
  return { rec, whisper, finished }
}

const newMeeting = (system: boolean) =>
  store.create(
    { floor: 'p1', title: 'Kickoff do checkout', template: 'padrao', attendees: ['Ana', 'Bruno'], sources: { mic: true, system } },
    now,
  )

const warnings = () => events.filter((e): e is Extract<MeetingEvent, { type: 'meeting:warning' }> => e.type === 'meeting:warning')
const byStart = (segs: Segment[]) => [...segs].sort((a, b) => a.start - b.start)

/** Alimenta as faixas segundo a segundo, com o relógio andando junto. */
async function play(
  rec: MeetingRecorder,
  id: string,
  tracks: Partial<Record<Track, Int16Array>>,
  sys?: FakeSystem,
  seq: Partial<Record<Track, number>> = {},
) {
  const slices = Object.fromEntries(Object.entries(tracks).map(([k, v]) => [k, seconds(v)])) as Record<Track, Int16Array[]>
  const n = Math.max(...Object.values(slices).map((s) => s.length))
  for (let i = 0; i < n; i++) {
    now += 1000
    for (const [track, list] of Object.entries(slices) as [Track, Int16Array[]][]) {
      if (!list[i]) continue
      if (track === 'outros' && sys) sys.opts!.onPcm(bytes(list[i]))
      else rec.pushChunk({ id, track, seq: (seq[track] = (seq[track] ?? -1) + 1), pcm: list[i] })
    }
    await settle(2)
  }
  return seq
}

describe('MeetingRecorder', () => {
  it('turns two synthetic tracks into segments in order, on the meeting clock', async () => {
    const sys = new FakeSystem()
    const { rec, whisper, finished } = setup({
      system: sys,
      script: { 4000: { text: 'Bom dia a todos.' }, 5000: { text: 'Vamos falar do checkout.' }, 6000: { text: 'O prazo é sexta.' } },
    })
    const m = newMeeting(true)
    const r = await rec.start(m, { mic: true, system: true, context: { floor: 'agents-2d', agents: ['Turing'] } })
    expect(r).toEqual({ micTrack: 'eu', systemAudio: 'native', whisperMode: 'server' })
    await settle()
    await play(
      rec,
      m.id,
      {
        eu: concat(silence(1), speech(4, 4000), silence(2), speech(5, 5000), silence(2)),
        outros: concat(silence(3), speech(5, 6000), silence(6)),
      },
      sys,
    )
    const done = await rec.stop(m.id)

    const segs = store.readSegments(m.id)
    expect(segs.map((s) => s.id).sort()).toEqual([1, 2, 3])
    expect(byStart(segs).map((s) => [s.track, s.text])).toEqual([
      ['eu', 'Bom dia a todos.'],
      ['outros', 'O prazo é sexta.'],
      ['eu', 'Vamos falar do checkout.'],
    ])
    const prazo = segs.find((s) => s.track === 'outros')!
    expect(prazo.start).toBeGreaterThanOrEqual(2500)
    expect(prazo.start).toBeLessThanOrEqual(3100)
    expect(done.status).toBe('ready')
    expect(done.counts.segments).toBe(3)
    expect(done.endedAt).toBe(now)
    expect(done.durationMs).toBe(14_000)
    expect(finished.map((f) => f.id)).toEqual([m.id])
    expect(whisper.stopped).toBe(true)
    expect(sys.stops).toBe(1)
    // o prompt leva os nomes e, no trecho seguinte da mesma faixa, o texto anterior
    expect(whisper.calls[0].prompt).toContain('Participantes: Ana, Bruno.')
    expect(whisper.calls.some((c) => c.prompt?.includes('Bom dia a todos.'))).toBe(true)
    // áudio no disco, por faixa
    expect(statSync(store.audioPath(m.id, 'eu')).size).toBe(14 * RATE * 2)
    expect(statSync(store.audioPath(m.id, 'outros')).size).toBe(14 * RATE * 2)
    // eventos: segmentos, finishing → ready, progresso com o rótulo do encerramento
    expect(events.filter((e) => e.type === 'meeting:segment')).toHaveLength(3)
    const statuses = events.flatMap((e) => (e.type === 'meeting:upsert' ? [e.meeting.status] : []))
    expect(statuses).toEqual(['finishing', 'ready'])
    expect(events.some((e) => e.type === 'meeting:progress' && e.stage === 'finishing' && e.label === 'Terminando a transcrição…')).toBe(
      true,
    )
    expect(warnings().map((w) => w.kind)).toEqual([]) // a saída do ajudante no stop não é "perdi o áudio"
    expect(rec.activeId).toBeNull()
  })

  it('marks a skipped seq as a gap, fills it with silence and ignores repeats', async () => {
    const { rec } = setup()
    const m = newMeeting(false)
    expect((await rec.start(m, { mic: true, system: false })).micTrack).toBe('sala')
    const one = silence(1)
    now += 1000
    expect(rec.pushChunk({ id: m.id, track: 'sala', seq: 0, pcm: one })).toBe(true)
    now += 1000
    rec.pushChunk({ id: m.id, track: 'sala', seq: 1, pcm: one })
    now += 3000
    expect(rec.pushChunk({ id: m.id, track: 'sala', seq: 4, pcm: one })).toBe(true)
    expect(rec.pushChunk({ id: m.id, track: 'sala', seq: 4, pcm: one })).toBe(false)
    const gap = warnings().find((w) => w.kind === 'gap')!
    expect(gap).toMatchObject({ meetingId: m.id, track: 'sala', at: 2000, ms: 2000, message: '— 2 s sem áudio —' })
    expect(store.get(m.id)!.gaps).toEqual([{ track: 'sala', at: 2000, ms: 2000 }])
    await rec.stop(m.id)
    expect(statSync(store.audioPath(m.id, 'sala')).size).toBe(5 * RATE * 2)
  })

  it('makes no chunks while paused and records the pause', async () => {
    const { rec, whisper } = setup({ script: { 4000: { text: 'Antes da pausa.' }, 5000: { text: 'Depois da pausa.' } } })
    const m = newMeeting(false)
    await rec.start(m, { mic: true, system: false })
    const seq = await play(rec, m.id, { sala: concat(silence(1), speech(2, 4000)) })
    expect(rec.pause(m.id).status).toBe('paused')
    await settle()
    const callsAtPause = whisper.calls.length
    expect(callsAtPause).toBe(1) // o trecho em aberto fechou na pausa
    for (let i = 0; i < 5; i++) {
      now += 1000
      expect(rec.pushChunk({ id: m.id, track: 'sala', seq: (seq.sala = seq.sala! + 1), pcm: speech(1, 5000) })).toBe(false)
    }
    await settle()
    expect(whisper.calls.length).toBe(callsAtPause)
    expect(() => rec.pause(m.id)).toThrow(/não está gravando/)

    const resumed = rec.resume(m.id)
    expect(resumed.status).toBe('recording')
    expect(resumed.pauses).toEqual([{ at: 3000, ms: 5000 }])
    await play(rec, m.id, { sala: concat(silence(1), speech(2, 5000), silence(1)) }, undefined, { sala: 0 }) // seq recomeça depois da pausa
    const done = await rec.stop(m.id)
    const segs = store.readSegments(m.id)
    expect(segs.map((s) => s.text)).toEqual(['Antes da pausa.', 'Depois da pausa.'])
    // depois da pausa, a fala cai no relógio da reunião (7 s em diante)
    expect(segs[1].start).toBeGreaterThanOrEqual(8000)
    expect(done.durationMs).toBe(12_000 - 5000)
    // o áudio da pausa não foi para o disco: 3 s antes + 4 s depois
    expect(statSync(store.audioPath(m.id, 'sala')).size).toBe(7 * RATE * 2)
  })

  it('warns after 5 min of silence and stops by itself after N minutes', async () => {
    const { rec, finished } = setup()
    const m = newMeeting(false)
    await rec.start(m, { mic: true, system: false, silenceAutostopMin: 15 })
    now += 4 * 60_000
    await rec.tick()
    expect(warnings()).toHaveLength(0)
    now += 60_000
    await rec.tick()
    expect(warnings().map((w) => w.kind)).toEqual(['idle'])
    await rec.tick()
    expect(warnings()).toHaveLength(1) // avisa uma vez
    now += 10 * 60_000
    await rec.tick()
    expect(warnings().at(-1)).toMatchObject({ kind: 'autostop', reason: 'silence' })
    expect(store.get(m.id)!.status).toBe('ready')
    expect(finished).toHaveLength(1)
    expect(rec.activeId).toBeNull()
  })

  it('stops at the 4 h hard limit, even when paused', async () => {
    const { rec } = setup()
    const m = newMeeting(false)
    await rec.start(m, { mic: true, system: false, silenceAutostopMin: 10_000 })
    now += 3 * 3600_000
    rec.pause(m.id)
    now += 3600_000
    await rec.tick()
    expect(warnings().at(-1)).toMatchObject({ kind: 'autostop', reason: 'limit' })
    const done = store.get(m.id)!
    expect(done.status).toBe('ready')
    expect(done.pauses).toEqual([{ at: 3 * 3600_000, ms: 3600_000 }])
    expect(done.durationMs).toBe(3 * 3600_000)
  })

  it('recovers an interrupted meeting from the PCM files, without repeating what was saved', async () => {
    const { rec, whisper, finished } = setup({
      script: { 4000: { text: 'Primeira fala.' }, 5000: { text: 'Segunda fala.' }, 6000: { text: 'Fala dos outros.' } },
    })
    const m = newMeeting(true)
    writeFileSync(store.audioPath(m.id, 'eu'), bytes(concat(silence(1), speech(4, 4000), silence(2), speech(5, 5000), silence(1))))
    writeFileSync(store.audioPath(m.id, 'outros'), bytes(concat(silence(8), speech(4, 6000), silence(1))))
    store.appendSegment(m.id, { id: 1, track: 'eu', start: 650, end: 6000, text: 'Primeira fala.' })
    // pausa de 10 s aos 6 s de reunião
    store.update(m.id, { status: 'interrupted', pauses: [{ at: 6000, ms: 10_000 }] })
    await expect(rec.recoverInterrupted('2026-01-01-0000-nao-existe')).rejects.toThrow(/não existe/)

    const done = await rec.recoverInterrupted(m.id)
    expect(done.status).toBe('ready')
    expect(done.durationMs).toBe(13_000)
    expect(done.endedAt).toBe(T0 + 13_000 + 10_000)
    const segs = store.readSegments(m.id)
    expect(segs.map((s) => [s.id, s.track, s.text])).toEqual([
      [1, 'eu', 'Primeira fala.'],
      [2, 'outros', 'Fala dos outros.'],
      [3, 'eu', 'Segunda fala.'],
    ])
    // depois da pausa, +10 s
    expect(segs[2].start).toBeGreaterThanOrEqual(16_500)
    expect(segs[1].start).toBeGreaterThanOrEqual(17_500)
    expect(whisper.stopped).toBe(true)
    expect(finished).toHaveLength(1)
    const statuses = events.flatMap((e) => (e.type === 'meeting:upsert' ? [e.meeting.status] : []))
    expect(statuses).toEqual(['finishing', 'ready'])
    await expect(rec.recoverInterrupted(m.id)).rejects.toThrow(/interrompida/)
  })

  it('drops hallucinations and microphone echo of the other side, then suggests headphones', async () => {
    const sys = new FakeSystem()
    const echo = 'Vamos fechar o escopo da sprint hoje à tarde.'
    const { rec } = setup({
      system: sys,
      script: {
        5000: { text: 'Eu falo outra coisa completamente diferente.' },
        6000: { text: echo },
        7000: { text: echo }, // o microfone captou o alto-falante
        8000: { text: 'Obrigado por assistir!' },
        9000: { text: 'Texto inventado no silêncio.', noSpeechProb: 0.9 },
      },
    })
    const m = newMeeting(true)
    await rec.start(m, { mic: true, system: true })
    await settle()
    const turn = (euAmp: number) => ({ eu: concat(speech(5, euAmp), silence(2)), outros: concat(speech(5, 6000), silence(2)) })
    const seq = {}
    for (const amp of [7000, 7000, 7000]) await play(rec, m.id, turn(amp), sys, seq)
    await play(rec, m.id, { eu: concat(speech(5, 8000), silence(2), speech(5, 9000), silence(2), speech(5, 5000), silence(2)) }, sys, seq)
    await rec.stop(m.id)
    const segs = store.readSegments(m.id)
    expect(segs.filter((s) => s.track === 'outros').map((s) => s.text)).toEqual([echo, echo, echo])
    expect(segs.filter((s) => s.track === 'eu').map((s) => s.text)).toEqual(['Eu falo outra coisa completamente diferente.'])
    expect(warnings().filter((w) => w.kind === 'echo')).toHaveLength(1)
  })

  it('rejects oversized chunks, unknown tracks and other meetings', async () => {
    const { rec } = setup()
    const m = newMeeting(false)
    expect(() => rec.pushChunk({ id: m.id, track: 'sala', seq: 0, pcm: silence(1) })).toThrow(/não está gravando/)
    await rec.start(m, { mic: true, system: false })
    expect(() => rec.pushChunk({ id: m.id, track: 'sala', seq: 0, pcm: new Uint8Array(AUDIO_CHUNK_MAX_BYTES + 2) })).toThrow(
      /grande demais/,
    )
    expect(() => rec.pushChunk({ id: m.id, track: 'sala', seq: 0, pcm: new Uint8Array(3) })).toThrow(/inválido/)
    expect(() => rec.pushChunk({ id: m.id, track: 'outros', seq: 0, pcm: silence(1) })).toThrow(/Faixa/)
    expect(() => rec.pushChunk({ id: m.id, track: 'eu', seq: 0, pcm: silence(1) })).toThrow(/Faixa/)
    expect(() => rec.pushChunk({ id: 'outra', track: 'sala', seq: 0, pcm: silence(1) })).toThrow(/não está gravando/)
    expect(() => rec.pushChunk({ id: m.id, track: 'sala', seq: -1, pcm: silence(1) })).toThrow(/sequência/)
    expect(rec.pushChunk({ id: m.id, track: 'sala', seq: 0, pcm: new Uint8Array(AUDIO_CHUNK_MAX_BYTES) })).toBe(true)
    await expect(rec.start(m, { mic: true, system: false })).rejects.toThrow(/Já há uma reunião/)
    await rec.stop(m.id)
  })

  it('reports the system audio: waiting, silent, lost (then mic only), and failure to start', async () => {
    const sys = new FakeSystem()
    const { rec } = setup({ system: sys, script: { 4000: { text: 'Sigo falando sozinho.' } } })
    const m = newMeeting(true)
    await rec.start(m, { mic: true, system: true, excludePids: [123] })
    await settle()
    expect(sys.opts!.excludePids).toEqual([123])
    sys.opts!.onStatus!({ event: 'waiting-permission' })
    sys.opts!.onStatus!({ event: 'warning', kind: 'all_zero', seconds: 3 })
    sys.opts!.onStatus!({ event: 'warning', kind: 'all_zero', seconds: 6 })
    sys.opts!.onStatus!({ event: 'exit', code: 1, signal: null })
    expect(warnings().map((w) => w.kind)).toEqual(['system-audio-waiting', 'system-audio-silent', 'system-audio-lost'])
    // sem outros, a fala do microfone sai sem esperar o filtro de eco
    await play(rec, m.id, { eu: concat(silence(1), speech(5, 4000), silence(2)) })
    await settle()
    expect(store.readSegments(m.id).map((s) => s.text)).toEqual(['Sigo falando sozinho.'])
    await rec.stop(m.id)

    const failing = new FakeSystem()
    failing.fail = new Error('O macOS não liberou o áudio do sistema a tempo.')
    const second = setup({ system: failing })
    const m2 = store.create({ floor: 'p1', title: 'Outra', template: 'padrao', attendees: [], sources: { mic: true, system: true } }, now)
    await second.rec.start(m2, { mic: true, system: true })
    await settle()
    expect(warnings().at(-1)).toMatchObject({ kind: 'system-audio-failed', message: expect.stringContaining('segue só com o microfone') })
    await second.rec.stop(m2.id)

    const old = setup({ system: new FakeSystem(false) })
    const m3 = store.create({ floor: 'p1', title: 'Velho', template: 'padrao', attendees: [], sources: { mic: true, system: true } }, now)
    expect((await old.rec.start(m3, { mic: true, system: true })).systemAudio).toBe('none')
    expect(warnings().at(-1)!.kind).toBe('system-audio-failed')
    await old.rec.stop(m3.id)
  })

  it('takes the system track from the renderer when there is no helper (Windows)', async () => {
    const { rec } = setup({ script: { 6000: { text: 'Do outro lado.' } } })
    const m = newMeeting(true)
    expect(await rec.start(m, { mic: true, system: true })).toMatchObject({ micTrack: 'eu', systemAudio: 'renderer' })
    await play(rec, m.id, { outros: concat(speech(5, 6000), silence(2)) })
    await rec.stop(m.id)
    expect(store.readSegments(m.id).map((s) => [s.track, s.text])).toEqual([['outros', 'Do outro lado.']])
  })

  it('emits progress and warns when the queue falls 40 s behind', async () => {
    const { rec, whisper } = setup({ script: { 4000: { text: 'Atrasada.' } } })
    let open!: () => void
    whisper.gate = new Promise((r) => (open = r))
    const m = newMeeting(false)
    await rec.start(m, { mic: true, system: false })
    await play(rec, m.id, { sala: concat(silence(1), speech(5, 4000), silence(2)) })
    now += 45_000
    await play(rec, m.id, { sala: concat(speech(5, 4000), silence(2)) }, undefined, { sala: 7 })
    expect(warnings().find((w) => w.kind === 'delay')).toMatchObject({ delayMs: expect.any(Number) })
    expect(events.some((e) => e.type === 'meeting:progress' && e.stage === 'live' && e.pending >= 1)).toBe(true)
    open()
    await rec.stop(m.id)
    expect(store.readSegments(m.id)).toHaveLength(2)
  })

  it('fails to start without whisper, marking the meeting as error', async () => {
    const { rec } = setup({ deps: { whisper: () => undefined } })
    const m = newMeeting(false)
    await expect(rec.start(m, { mic: true, system: false })).rejects.toThrow(/whisper/)
    const broken: WhisperLike = {
      start: () => Promise.reject(new Error('Falta o modelo.')),
      transcribe: () => Promise.resolve([]),
      stop: () => Promise.resolve(),
    }
    const second = setup({ deps: { whisper: () => broken } })
    await expect(second.rec.start(m, { mic: true, system: false })).rejects.toThrow(/Falta o modelo/)
    expect(store.get(m.id)!.status).toBe('error')
    expect(second.rec.activeId).toBeNull()
    expect(existsSync(join(dir, 'meetings.json'))).toBe(true)
  })

  it('maps recorded audio time to meeting time across pauses', () => {
    const map = pauseMapper([
      { at: 10_000, ms: 5000 },
      { at: 3000, ms: 1000 },
    ])
    expect(map(0)).toBe(0)
    expect(map(2999)).toBe(2999)
    expect(map(3000)).toBe(4000)
    expect(map(8999)).toBe(9999)
    expect(map(9000)).toBe(15_000)
  })
})
