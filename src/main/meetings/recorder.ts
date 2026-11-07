import { createWriteStream, type WriteStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { SAMPLE_RATE, Segmenter, type PcmChunk } from '@shared/meeting-audio'
import {
  AUDIO_CHUNK_MAX_BYTES,
  dropEcho,
  ECHO_WINDOW_MS,
  isHallucination,
  MEETING_MAX_HOURS,
  SILENCE_AUTOSTOP_MIN,
  whisperPrompt,
  type WhisperPromptInput,
} from '@shared/meetings'
import type { Meeting, MeetingEvent, MeetingGap, MeetingWarning, Segment, Track, WhisperSegment } from '@shared/types/meetings'
import type { SystemAudioStartOptions } from './system-audio'
import type { MeetingStore } from './store'
import { TranscriptionQueue, type TranscribeOptions, type TranscriptionJob, type WhisperMode } from './whisper'
import { log } from '../log'

// Gravador da sala de reunião (RN-04). Uma reunião por vez: recebe o PCM do microfone (pedaços
// do renderer, com seq) e do áudio do sistema (stdout do ajudante Swift, contínuo), grava em
// audio/<faixa>.pcm, corta nas pausas (Segmenter), transcreve na fila do whisper, filtra
// alucinação e eco e grava os segmentos. Logs só com contagens e durações, nunca texto.
//
// Tempo: todo `start`/`end` é ms desde meeting.startedAt no relógio de parede, com as pausas
// dentro (a transcrição mostra o intervalo). Cada faixa tem um `base` (o ms da reunião em que
// a amostra 0 do seu Segmenter foi captada), refeito no primeiro áudio depois de começar e de
// retomar. Na recuperação não há relógio: a faixa começa em 0 e as pausas gravadas são somadas.

/** O que o gravador usa do WhisperServer (testes passam um falso). */
export interface WhisperLike {
  start(): Promise<WhisperMode>
  transcribe(wav: Uint8Array, opts: TranscribeOptions): Promise<WhisperSegment[]>
  stop(): Promise<void>
}

/** O que o gravador usa do SystemAudioCapture (testes passam um falso). */
export interface SystemAudioLike {
  supported(): boolean
  start(o: SystemAudioStartOptions): Promise<void>
  stop(): Promise<void>
}

export interface RecorderClock {
  now(): number
  /** Chama fn a cada ms; devolve como parar. */
  every(ms: number, fn: () => void): () => void
}

export interface RecorderLimits {
  /** Minutos sem fala até o aviso "Esqueceu de encerrar?". */
  idleWarnMin: number
  /** Limite duro, contado no relógio de parede (pausas dentro). */
  maxHours: number
  /** Quanto um segmento de `eu` espera a faixa `outros` para o filtro de eco. */
  echoHoldMs: number
  /** Teto da espera, mesmo com trechos de `outros` na fila. */
  echoHoldMaxMs: number
  /** Atraso da fila a partir do qual avisa. */
  delayWarnMs: number
  /** Maior buraco preenchido com silêncio no arquivo (o resto só fica anotado). */
  gapFillMaxMs: number
}

export const RECORDER_LIMITS: RecorderLimits = {
  idleWarnMin: 5,
  maxHours: MEETING_MAX_HOURS,
  echoHoldMs: 10_000,
  echoHoldMaxMs: 60_000,
  delayWarnMs: 40_000,
  gapFillMaxMs: 60_000,
}

export interface RecorderDeps {
  store: Pick<MeetingStore, 'get' | 'update' | 'appendSegment' | 'audioPath' | 'readSegments'>
  /** Um whisper novo por reunião; undefined quando falta modelo ou binário. */
  whisper: (lang: string) => WhisperLike | undefined
  /** Ausente: o áudio do sistema, se pedido, vem do renderer (Windows) pela faixa `outros`. */
  systemAudio?: () => SystemAudioLike
  emit: (ev: MeetingEvent) => void
  clock?: RecorderClock
  /** 'pt' (padrão), 'en' ou 'auto'. */
  lang?: string
  limits?: Partial<RecorderLimits>
  /** Depois de `ready` (fase 2: gerar a ata, status 'enhancing'). Erros só vão para o log. */
  onFinished?: (meeting: Meeting) => void | Promise<void>
}

export interface RecorderStartOptions {
  mic: boolean
  system: boolean
  /** PIDs do app, fora do tap do sistema (TTS e rádio não viram eco). */
  excludePids?: readonly number[]
  /** Grafia dos nomes para o prompt do whisper; attendees padrão: os da reunião. */
  context?: Omit<WhisperPromptInput, 'previous'>
  /** Configuração "Encerrar sozinho após minutos sem fala"; padrão SILENCE_AUTOSTOP_MIN. */
  silenceAutostopMin?: number
}

export interface RecorderStartResult {
  /** A faixa que o renderer usa para o microfone: `eu` com áudio do sistema, `sala` no presencial. */
  micTrack: Track | null
  /** native: ajudante no main; renderer: o renderer manda `outros` (Windows); none: sem sistema. */
  systemAudio: 'native' | 'renderer' | 'none'
  whisperMode: WhisperMode
}

export interface AudioChunk {
  id: string
  track: Track
  seq: number
  /** Int16 mono 16 kHz, little-endian. */
  pcm: Int16Array | Uint8Array | ArrayBuffer
}

export type StopReason = 'user' | 'silence' | 'limit'

interface TrackState {
  track: Track
  seg: Segmenter
  /** Amostras entregues ao Segmenter (o relógio dele). */
  samples: number
  /** ms da reunião da amostra 0 do Segmenter; null = refazer no próximo áudio. */
  base: number | null
  lastSeq: number | null
  /** Tamanho do último pedaço, para estimar o buraco. */
  chunkSamples: number
  /** Texto do último trecho, para a continuidade do prompt. */
  lastText: string
  file: WriteStream | null
  /** Byte que sobrou de um pedaço ímpar do ajudante. */
  carry: number | null
}

interface Held extends Omit<Segment, 'id'> {
  heldAt: number
}

interface Session {
  meeting: Meeting
  mode: 'live' | 'recovery'
  state: 'recording' | 'paused' | 'finishing'
  whisper: WhisperLike
  queue: TranscriptionQueue
  tracks: Map<Track, TrackState>
  allowed: Set<Track>
  context: Omit<WhisperPromptInput, 'previous'>
  silenceMin: number
  system: SystemAudioLike | null
  /** off: sem tap; starting/running: tap no main; lost: caiu ou não subiu. */
  systemState: 'off' | 'starting' | 'running' | 'lost'
  systemSilentWarned: boolean
  pauseStartedAt: number | null
  pauses: Meeting['pauses']
  gaps: MeetingGap[]
  nextId: number
  /** Relógio de parede da última fala (segmento gravado) ou do começo/retomada. */
  lastActivity: number
  idleWarned: boolean
  delayWarned: boolean
  lastErrorWarnAt: number
  /** Trechos na fila, por faixa (para a espera do eco). */
  inflight: { track: Track; start: number; end: number }[]
  /** Até onde `outros` já foi transcrita (ms da reunião). */
  outrosUntil: number
  /** Falas recentes de `outros`, para o filtro de eco. */
  recentOutros: { start: number; end: number; text: string }[]
  held: Held[]
  stats: { chunks: number; segments: number; hallucinations: number; echo: number; euChecked: number; gaps: number; rejected: number }
  echoWarned: boolean
  stopTimer: (() => void) | null
  stopping: Promise<Meeting> | null
}

const realClock: RecorderClock = {
  now: () => Date.now(),
  every(ms, fn) {
    const t = setInterval(fn, ms)
    t.unref?.()
    return () => clearInterval(t)
  },
}

const MIN = 60_000
const samplesToMs = (n: number) => (n * 1000) / SAMPLE_RATE
const FINISHING_LABEL = 'Terminando a transcrição…'
const NO_WHISPER = 'Falta o whisper para transcrever. Abra "O que falta instalar" na sala de reunião.'

/**
 * O gravador. Uma reunião por vez (ao vivo ou recuperação). Todo erro de entrada lança com a
 * mensagem para o usuário; pedaço que chega fora de hora (pausada, encerrando) é ignorado.
 */
export class MeetingRecorder {
  private s: Session | null = null
  private readonly clock: RecorderClock
  private readonly limits: RecorderLimits
  private readonly lang: string

  constructor(private deps: RecorderDeps) {
    this.clock = deps.clock ?? realClock
    this.limits = { ...RECORDER_LIMITS, ...deps.limits }
    this.lang = deps.lang ?? 'pt'
  }

  /** Id da reunião em andamento (gravando, pausada, encerrando ou recuperando). */
  get activeId(): string | null {
    return this.s?.meeting.id ?? null
  }

  get state(): Session['state'] | null {
    return this.s?.state ?? null
  }

  // ---------- começar ----------

  /**
   * Sobe o whisper (espera ficar pronto) e, com `system` e suporte, o ajudante do áudio do
   * sistema em segundo plano (a permissão do macOS pode segurar ~30 s; vem como aviso).
   * Lança se outra reunião está ativa, se a reunião não está gravando ou se falta o whisper.
   */
  async start(meeting: Meeting, opts: RecorderStartOptions): Promise<RecorderStartResult> {
    if (this.s) throw new Error('Já há uma reunião gravando. Encerre-a antes de começar outra.')
    const current = this.deps.store.get(meeting.id)
    if (!current || current.status !== 'recording') throw new Error('Esta reunião não está pronta para gravar.')
    if (!opts.mic && !opts.system) throw new Error('Escolha o microfone, o áudio do computador ou os dois.')
    const whisper = this.deps.whisper(this.lang)
    if (!whisper) throw new Error(NO_WHISPER)

    const system = opts.system && this.deps.systemAudio ? this.deps.systemAudio() : null
    const native = !!system && system.supported()
    const micTrack: Track | null = opts.mic ? (opts.system ? 'eu' : 'sala') : null
    const allowed = new Set<Track>()
    if (micTrack) allowed.add(micTrack)
    if (opts.system && !this.deps.systemAudio) allowed.add('outros')

    const s = this.open(current, 'live', whisper)
    s.allowed = allowed
    s.context = { attendees: current.attendees, ...opts.context }
    s.silenceMin = opts.silenceAutostopMin ?? SILENCE_AUTOSTOP_MIN
    s.system = native ? system : null
    s.systemState = native ? 'starting' : 'off'
    this.s = s

    let mode: WhisperMode
    try {
      mode = await whisper.start()
    } catch (err) {
      this.s = null
      await whisper.stop().catch(() => undefined)
      void this.closeFiles(s)
      this.upsert(current.id, { status: 'error' })
      throw err
    }
    if (this.s !== s) return { micTrack, systemAudio: 'none', whisperMode: mode }

    s.stopTimer = this.clock.every(1000, () => void this.tick())
    if (opts.system && !native && this.deps.systemAudio) {
      this.warn(
        s,
        'system-audio-failed',
        'Este computador não grava o áudio do sistema (precisa do macOS 14.2 ou mais novo). A reunião segue só com o microfone.',
      )
    }
    if (native) this.startSystem(s, opts.excludePids)
    log.info(
      `Reunião: gravação começou (microfone ${micTrack ?? 'não'}, sistema ${native ? 'ajudante' : allowed.has('outros') ? 'renderer' : 'não'}, whisper ${mode})`,
    )
    return { micTrack, systemAudio: native ? 'native' : allowed.has('outros') ? 'renderer' : 'none', whisperMode: mode }
  }

  private startSystem(s: Session, excludePids?: readonly number[]): void {
    const sys = s.system!
    sys
      .start({
        excludePids,
        onPcm: (buf) => this.onSystemPcm(s, buf),
        onStatus: (ev) => {
          if (this.s !== s || s.state === 'finishing') return
          if (ev.event === 'waiting-permission') {
            this.warn(s, 'system-audio-waiting', 'Aguardando a permissão do macOS para gravar o áudio do computador.')
          } else if (ev.event === 'warning' && !s.systemSilentWarned) {
            s.systemSilentWarned = true
            this.warn(
              s,
              'system-audio-silent',
              'Não estou ouvindo o computador. Libere o áudio do sistema em Ajustes > Privacidade e Segurança > Gravação de Tela e Áudio do Sistema, ou confira se a chamada está no mudo.',
            )
          } else if (ev.event === 'exit' && s.systemState === 'running') {
            s.systemState = 'lost'
            this.closeTrack(s, 'outros')
            this.warn(s, 'system-audio-lost', 'Perdi o áudio do computador. A reunião segue só com o microfone.')
            this.releaseHeld(s)
          }
        },
      })
      .then(() => {
        if (this.s === s && s.systemState === 'starting') s.systemState = 'running'
      })
      .catch((err: unknown) => {
        if (this.s !== s || s.state === 'finishing') return
        s.systemState = 'lost'
        const why = err instanceof Error ? err.message : 'O áudio do computador não começou.'
        this.warn(s, 'system-audio-failed', `${why} A reunião segue só com o microfone.`)
        this.releaseHeld(s)
      })
  }

  // ---------- áudio ----------

  /**
   * Um pedaço do microfone (ou do sistema, no Windows) vindo do renderer. Lança para pedaço
   * inválido (outra reunião, faixa não permitida, maior que 64 KB, seq inválido). Devolve false
   * quando ignora (pausada, encerrando, seq repetido) e true quando gravou.
   */
  pushChunk(chunk: AudioChunk): boolean {
    const s = this.s
    if (!s || s.mode !== 'live' || chunk.id !== s.meeting.id) throw new Error('Esta reunião não está gravando.')
    if (!s.allowed.has(chunk.track)) throw new Error('Faixa de áudio inválida para esta reunião.')
    if (!Number.isSafeInteger(chunk.seq) || chunk.seq < 0) throw new Error('Pedaço de áudio sem sequência válida.')
    if (byteLength(chunk.pcm) > AUDIO_CHUNK_MAX_BYTES) throw new Error('Pedaço de áudio grande demais (máximo de 64 KB).')
    const pcm = toInt16(chunk.pcm)
    if (s.state !== 'recording') return false
    const t = this.trackOf(s, chunk.track)
    if (t.lastSeq !== null && chunk.seq <= t.lastSeq) {
      s.stats.rejected++
      return false
    }
    if (t.lastSeq !== null && chunk.seq > t.lastSeq + 1) this.gap(s, t, chunk.seq - t.lastSeq - 1)
    t.lastSeq = chunk.seq
    t.chunkSamples = pcm.length
    this.feed(s, t, pcm)
    return true
  }

  private onSystemPcm(s: Session, buf: Buffer): void {
    if (this.s !== s || s.state !== 'recording') return
    const t = this.trackOf(s, 'outros')
    let bytes: Uint8Array = buf
    if (t.carry !== null) {
      const joined = new Uint8Array(buf.length + 1)
      joined[0] = t.carry
      joined.set(buf, 1)
      bytes = joined
      t.carry = null
    }
    if (bytes.length % 2) {
      t.carry = bytes[bytes.length - 1]
      bytes = bytes.subarray(0, bytes.length - 1)
    }
    if (!bytes.length) return
    this.feed(s, t, toInt16(bytes))
  }

  /** Seq pulado: anota, avisa e preenche o arquivo e o Segmenter com silêncio (até 60 s). */
  private gap(s: Session, t: TrackState, missing: number): void {
    const ms = Math.round(samplesToMs(missing * t.chunkSamples))
    const at = Math.round((t.base ?? this.meetingNow(s)) + samplesToMs(t.samples))
    const fill = Math.min(missing * t.chunkSamples, Math.round((this.limits.gapFillMaxMs * SAMPLE_RATE) / 1000))
    if (fill > 0) this.feed(s, t, new Int16Array(fill))
    s.gaps.push({ track: t.track, at, ms })
    s.stats.gaps++
    this.upsert(s.meeting.id, { gaps: [...s.gaps] })
    const secs = Math.max(1, Math.round(ms / 1000))
    this.warn(s, 'gap', `— ${secs} s sem áudio —`, { track: t.track, at, ms })
  }

  /** Grava no arquivo da faixa e entrega ao Segmenter; cada trecho fechado vai para a fila. */
  private feed(s: Session, t: TrackState, pcm: Int16Array): void {
    if (t.base === null) t.base = this.meetingNow(s) - samplesToMs(pcm.length) - samplesToMs(t.samples)
    t.file ??= createWriteStream(this.deps.store.audioPath(s.meeting.id, t.track), { flags: 'a', mode: 0o600 })
    t.file.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    t.samples += pcm.length
    const base = t.base
    for (const c of t.seg.push(pcm)) this.enqueue(s, t, c, (ms) => base + ms)
  }

  private enqueue(s: Session, t: TrackState, c: PcmChunk, toMeeting: (ms: number) => number): void {
    const start = Math.round(toMeeting(c.start))
    const end = start + (c.end - c.start)
    const job: TranscriptionJob = {
      meetingId: s.meeting.id,
      track: t.track,
      start,
      end,
      pcm: c.pcm,
      prompt: whisperPrompt({ ...s.context, previous: t.lastText }) || undefined,
    }
    if (s.mode === 'recovery') job.endWall = this.clock.now()
    s.inflight.push({ track: t.track, start, end })
    s.stats.chunks++
    s.queue.push(job)
  }

  // ---------- resultados ----------

  private onResult(s: Session, job: TranscriptionJob, segs: WhisperSegment[]): void {
    if (this.s !== s) return
    this.dropInflight(s, job)
    const kept: Held[] = []
    for (const w of segs) {
      if (isHallucination(w.text, w.noSpeechProb)) {
        s.stats.hallucinations++
        continue
      }
      const start = Math.min(job.end, job.start + Math.max(0, w.start))
      const end = Math.max(start, Math.min(job.end, job.start + Math.max(0, w.end)))
      kept.push({ track: job.track, start, end, text: w.text.trim(), heldAt: this.clock.now() })
    }
    const t = s.tracks.get(job.track)
    if (t && kept.length) t.lastText = kept.map((k) => k.text).join(' ')

    if (job.track === 'outros') {
      s.outrosUntil = Math.max(s.outrosUntil, job.end)
      for (const k of kept) {
        s.recentOutros.push({ start: k.start, end: k.end, text: k.text })
        this.commit(s, k)
      }
    } else if (job.track === 'eu') {
      s.held.push(...kept)
    } else {
      for (const k of kept) this.commit(s, k)
    }
    this.releaseHeld(s)
  }

  private onError(s: Session, job: TranscriptionJob, err: Error): void {
    if (this.s !== s) return
    this.dropInflight(s, job)
    log.warn(`Reunião: um trecho de ${Math.round((job.end - job.start) / 1000)} s falhou no whisper`)
    const now = this.clock.now()
    if (now - s.lastErrorWarnAt >= MIN) {
      s.lastErrorWarnAt = now
      this.warn(s, 'transcription', err.message || 'Um trecho não foi transcrito.')
    }
    this.releaseHeld(s)
  }

  private dropInflight(s: Session, job: TranscriptionJob): void {
    const i = s.inflight.findIndex((j) => j.track === job.track && j.start === job.start)
    if (i >= 0) s.inflight.splice(i, 1)
  }

  /** A faixa `outros` ainda pode trazer fala para comparar com a `eu`. */
  private outrosLive(s: Session): boolean {
    if (s.mode === 'recovery') return false
    return s.systemState === 'starting' || s.systemState === 'running' || (s.allowed.has('outros') && s.state !== 'finishing')
  }

  /**
   * Solta os segmentos de `eu` que já dá para comparar com `outros` (dropEcho): quando `outros`
   * foi transcrita além do fim + 1,5 s, quando não há mais `outros`, ou depois da espera.
   */
  private releaseHeld(s: Session, force = false): void {
    if (!s.held.length) return
    const now = this.clock.now()
    const live = this.outrosLive(s)
    const ready: Held[] = []
    const keep: Held[] = []
    for (const h of s.held) {
      const reach = h.end + ECHO_WINDOW_MS
      const waiting = s.inflight.some((j) => j.track === 'outros' && j.start <= reach)
      const age = now - h.heldAt
      const ok =
        force ||
        s.outrosUntil >= reach ||
        (!live && !waiting) ||
        (age >= this.limits.echoHoldMs && !waiting) ||
        age >= this.limits.echoHoldMaxMs
      ;(ok ? ready : keep).push(h)
    }
    s.held = keep
    ready.sort((a, b) => a.start - b.start)
    for (const h of ready) {
      s.stats.euChecked++
      if (dropEcho([h], s.recentOutros).length) this.commit(s, h)
      else s.stats.echo++
    }
    if (!s.echoWarned && s.stats.echo >= 3 && s.stats.echo >= s.stats.euChecked * 0.2) {
      s.echoWarned = true
      this.warn(s, 'echo', 'O microfone está captando o som do computador. Use fone para uma transcrição melhor.')
    }
    // o eco só olha ±1,5 s: o que ficou para trás de tudo que ainda espera pode sair
    const oldest = Math.min(...s.held.map((h) => h.start), s.outrosUntil) - ECHO_WINDOW_MS - MIN
    if (s.recentOutros.length > 200 || (s.recentOutros[0] && s.recentOutros[0].end < oldest)) {
      s.recentOutros = s.recentOutros.filter((o) => o.end >= oldest).slice(-200)
    }
  }

  private commit(s: Session, h: Omit<Held, 'heldAt'> | Held): void {
    const segment: Segment = { id: s.nextId++, track: h.track, start: h.start, end: h.end, text: h.text }
    this.deps.store.appendSegment(s.meeting.id, segment)
    s.stats.segments++
    s.lastActivity = this.clock.now()
    s.idleWarned = false
    this.deps.emit({ type: 'meeting:segment', meetingId: s.meeting.id, segment })
  }

  private onDelay(s: Session, delayMs: number, pending: number): void {
    if (this.s !== s) return
    const stage = s.mode === 'recovery' ? 'recovering' : s.state === 'finishing' ? 'finishing' : 'live'
    this.deps.emit({
      type: 'meeting:progress',
      meetingId: s.meeting.id,
      stage,
      pending,
      delayMs: Math.round(delayMs),
      ...(stage === 'live' ? {} : { label: FINISHING_LABEL }),
    })
    if (stage !== 'live') return
    if (!s.delayWarned && delayMs > this.limits.delayWarnMs) {
      s.delayWarned = true
      this.warn(s, 'delay', `A transcrição está atrasada ${Math.round(delayMs / 1000)} s.`, { delayMs: Math.round(delayMs) })
    } else if (s.delayWarned && delayMs < this.limits.delayWarnMs * 0.75) s.delayWarned = false
  }

  // ---------- pausa ----------

  /** Para de gravar: fecha o trecho em aberto de cada faixa; o áudio que chegar é descartado. */
  pause(id: string): Meeting {
    const s = this.live(id)
    if (s.state !== 'recording') throw new Error('A reunião não está gravando.')
    for (const t of s.tracks.values()) this.flushTrack(s, t)
    s.state = 'paused'
    s.pauseStartedAt = this.clock.now()
    log.info('Reunião: pausada')
    return this.upsert(id, { status: 'paused' })
  }

  /** Continua a mesma reunião; a pausa entra em meeting.pauses. */
  resume(id: string): Meeting {
    const s = this.live(id)
    if (s.state !== 'paused') throw new Error('A reunião não está pausada.')
    this.closePause(s)
    s.state = 'recording'
    s.lastActivity = this.clock.now()
    s.idleWarned = false
    for (const t of s.tracks.values()) {
      t.base = null // o próximo áudio refaz o relógio da faixa
      t.lastSeq = null // o renderer pode recomeçar a contagem
      t.carry = null
    }
    log.info('Reunião: retomada')
    return this.upsert(id, { status: 'recording', pauses: [...s.pauses] })
  }

  private closePause(s: Session): void {
    if (s.pauseStartedAt === null) return
    const now = this.clock.now()
    s.pauses.push({ at: s.pauseStartedAt - s.meeting.startedAt, ms: now - s.pauseStartedAt })
    s.pauseStartedAt = null
  }

  private flushTrack(s: Session, t: TrackState): void {
    const base = t.base ?? this.meetingNow(s) - samplesToMs(t.samples)
    for (const c of t.seg.flush()) this.enqueue(s, t, c, (ms) => base + ms)
  }

  // ---------- proteções ----------

  /** A cada segundo (público para os testes com relógio falso). Resolve com o encerramento, se houver. */
  async tick(): Promise<void> {
    const s = this.s
    if (!s || s.mode !== 'live' || s.state === 'finishing') return
    const now = this.clock.now()
    this.releaseHeld(s)
    if (now - s.meeting.startedAt >= this.limits.maxHours * 60 * MIN) {
      this.warn(s, 'autostop', `A reunião chegou ao limite de ${this.limits.maxHours} h e foi encerrada.`, { reason: 'limit' })
      await this.stop(s.meeting.id, 'limit')
      return
    }
    if (s.state !== 'recording') return
    if (s.queue.pending > 0) s.lastActivity = Math.max(s.lastActivity, now - 1000) // a fala pode estar na fila
    const quiet = now - s.lastActivity
    if (quiet >= s.silenceMin * MIN) {
      this.warn(s, 'autostop', `${s.silenceMin} min sem fala: a reunião foi encerrada.`, { reason: 'silence' })
      await this.stop(s.meeting.id, 'silence')
    } else if (!s.idleWarned && quiet >= this.limits.idleWarnMin * MIN) {
      s.idleWarned = true
      this.warn(s, 'idle', `Esqueceu de encerrar? ${this.limits.idleWarnMin} min sem fala.`)
    }
  }

  // ---------- encerrar ----------

  /**
   * Encerra: fecha os trechos, para o áudio do sistema, `finishing`, esvazia a fila, para o
   * whisper, `ready` com endedAt e durationMs, e chama onFinished. Chamar de novo devolve o
   * mesmo encerramento.
   */
  stop(id: string, reason: StopReason = 'user'): Promise<Meeting> {
    const s = this.live(id)
    if (s.stopping) return s.stopping
    s.stopping = this.finish(s, reason)
    return s.stopping
  }

  private async finish(s: Session, reason: StopReason): Promise<Meeting> {
    const id = s.meeting.id
    s.stopTimer?.()
    s.stopTimer = null
    this.closePause(s)
    if (s.state === 'recording') for (const t of s.tracks.values()) this.flushTrack(s, t)
    s.state = 'finishing'
    this.upsert(id, { status: 'finishing', pauses: [...s.pauses] })
    this.onDelay(s, s.queue.delayMs, s.queue.pending)
    if (s.system) await s.system.stop().catch(() => undefined)
    s.systemState = 'off'
    await this.closeFiles(s)
    await s.queue.drain()
    this.releaseHeld(s, true)
    await s.whisper.stop().catch(() => undefined)
    const endedAt = this.clock.now()
    const paused = s.pauses.reduce((n, p) => n + p.ms, 0)
    const durationMs = Math.max(0, endedAt - s.meeting.startedAt - paused)
    this.s = null
    log.info(
      `Reunião: encerrada (${reason}) após ${Math.round(durationMs / 1000)} s; ${s.stats.chunks} trechos, ${s.stats.segments} segmentos, ` +
        `${s.stats.hallucinations} alucinações, ${s.stats.echo} ecos, ${s.stats.gaps} buracos, ${s.stats.rejected} pedaços repetidos`,
    )
    const done = this.upsert(id, { status: 'ready', endedAt, durationMs })
    await this.finished(done)
    return done
  }

  private async finished(m: Meeting): Promise<void> {
    try {
      await this.deps.onFinished?.(m)
    } catch (err) {
      log.error('Reunião: falha no onFinished:', err)
    }
  }

  // ---------- recuperação ----------

  /**
   * Reunião `interrupted` (o app fechou gravando): transcreve o audio/*.pcm que ficou, sem
   * captura, e encerra como uma reunião normal. O que já estava em transcript.jsonl não se
   * repete: pula os trechos que terminam antes do último segmento de cada faixa.
   */
  async recoverInterrupted(id: string, context?: Omit<WhisperPromptInput, 'previous'>): Promise<Meeting> {
    if (this.s) throw new Error('Há uma reunião em andamento. Encerre-a antes de transcrever outra.')
    const m = this.deps.store.get(id)
    if (!m) throw new Error('Essa reunião não existe mais.')
    if (m.status !== 'interrupted') throw new Error('Só dá para recuperar uma reunião interrompida.')
    const whisper = this.deps.whisper(this.lang)
    if (!whisper) throw new Error(NO_WHISPER)

    const s = this.open(m, 'recovery', whisper)
    s.context = { attendees: m.attendees, ...context }
    s.state = 'finishing'
    this.s = s
    const existing = this.deps.store.readSegments(id)
    const doneUntil = new Map<Track, number>()
    for (const seg of existing) {
      doneUntil.set(seg.track, Math.max(doneUntil.get(seg.track) ?? -Infinity, seg.end))
      if (seg.track === 'outros') s.recentOutros.push({ start: seg.start, end: seg.end, text: seg.text })
    }
    let audioMs = 0
    try {
      await whisper.start()
      this.upsert(id, { status: 'finishing' })
      const toMeeting = pauseMapper(m.pauses)
      // outros antes de eu: a faixa eu precisa de toda a outros para o filtro de eco
      for (const track of ['outros', 'eu', 'sala'] as const) {
        const ms = await this.recoverTrack(s, track, toMeeting, doneUntil.get(track) ?? -Infinity)
        audioMs = Math.max(audioMs, ms)
        await s.queue.drain()
        this.releaseHeld(s, true)
      }
    } catch (err) {
      this.s = null
      await whisper.stop().catch(() => undefined)
      this.upsert(id, { status: 'interrupted' })
      throw err
    }
    await whisper.stop().catch(() => undefined)
    this.s = null
    const paused = m.pauses.reduce((n, p) => n + p.ms, 0)
    const endedAt = m.endedAt ?? m.startedAt + audioMs + paused
    log.info(
      `Reunião: recuperada, ${Math.round(audioMs / 1000)} s de áudio; ${s.stats.chunks} trechos, ${s.stats.segments} segmentos novos`,
    )
    const done = this.upsert(id, { status: 'ready', endedAt, durationMs: audioMs })
    await this.finished(done)
    return done
  }

  /** Lê audio/<faixa>.pcm em blocos de 1 s, sem carregar o arquivo; devolve a duração em ms. */
  private async recoverTrack(s: Session, track: Track, toMeeting: (ms: number) => number, doneUntil: number): Promise<number> {
    const file = this.deps.store.audioPath(s.meeting.id, track)
    const size = await stat(file).then(
      (st) => st.size,
      () => 0,
    )
    if (size < 2) return 0
    const t = this.trackOf(s, track)
    const send = (chunks: PcmChunk[]) => {
      for (const c of chunks) if (toMeeting(c.end) > doneUntil) this.enqueue(s, t, c, toMeeting)
    }
    const fh = await open(file, 'r')
    try {
      const block = Buffer.alloc(SAMPLE_RATE * 2)
      let carry: number | null = null
      for (;;) {
        const { bytesRead } = await fh.read(block, 0, block.length, null)
        if (!bytesRead) break
        let bytes: Uint8Array = block.subarray(0, bytesRead)
        if (carry !== null) {
          const j = new Uint8Array(bytes.length + 1)
          j[0] = carry
          j.set(bytes, 1)
          bytes = j
          carry = null
        }
        if (bytes.length % 2) {
          carry = bytes[bytes.length - 1]
          bytes = bytes.subarray(0, bytes.length - 1)
        }
        const pcm = toInt16(bytes)
        t.samples += pcm.length
        send(t.seg.push(pcm))
        // memória limitada: no máximo uns trechos esperando o whisper
        if (s.queue.pending >= 3) await s.queue.drain()
      }
      send(t.seg.flush())
    } finally {
      await fh.close()
    }
    return Math.round(samplesToMs(t.samples))
  }

  // ---------- ajudantes ----------

  private open(m: Meeting, mode: Session['mode'], whisper: WhisperLike): Session {
    const now = this.clock.now()
    const existing = this.deps.store.readSegments(m.id)
    const s: Session = {
      meeting: m,
      mode,
      state: 'recording',
      whisper,
      queue: null as unknown as TranscriptionQueue,
      tracks: new Map(),
      allowed: new Set(),
      context: {},
      silenceMin: SILENCE_AUTOSTOP_MIN,
      system: null,
      systemState: 'off',
      systemSilentWarned: false,
      pauseStartedAt: null,
      pauses: [...m.pauses],
      gaps: [...(m.gaps ?? [])],
      nextId: existing.reduce((n, seg) => Math.max(n, seg.id), 0) + 1,
      lastActivity: now,
      idleWarned: false,
      delayWarned: false,
      lastErrorWarnAt: -Infinity,
      inflight: [],
      outrosUntil: -Infinity,
      recentOutros: [],
      held: [],
      stats: { chunks: 0, segments: 0, hallucinations: 0, echo: 0, euChecked: 0, gaps: 0, rejected: 0 },
      echoWarned: false,
      stopTimer: null,
      stopping: null,
    }
    s.queue = new TranscriptionQueue({
      transcribe: (wav, o) => whisper.transcribe(wav, o),
      lang: this.lang,
      startedAt: m.startedAt,
      now: this.clock.now,
      onResult: (job, segs) => this.onResult(s, job, segs),
      onError: (job, err) => this.onError(s, job, err),
      onDelay: (delay, pending) => this.onDelay(s, delay, pending),
    })
    return s
  }

  private trackOf(s: Session, track: Track): TrackState {
    let t = s.tracks.get(track)
    if (!t) {
      t = {
        track,
        seg: new Segmenter(),
        samples: 0,
        base: null,
        lastSeq: null,
        chunkSamples: SAMPLE_RATE,
        lastText: '',
        file: null,
        carry: null,
      }
      s.tracks.set(track, t)
    }
    return t
  }

  private live(id: string): Session {
    const s = this.s
    if (!s || s.mode !== 'live' || s.meeting.id !== id) throw new Error('Esta reunião não está gravando.')
    return s
  }

  private meetingNow(s: Session): number {
    return this.clock.now() - s.meeting.startedAt
  }

  private closeTrack(s: Session, track: Track): void {
    const t = s.tracks.get(track)
    if (!t) return
    this.flushTrack(s, t)
    t.file?.end()
    t.file = null
  }

  private closeFiles(s: Session): Promise<void> {
    const files = [...s.tracks.values()].map((t) => t.file).filter((f): f is WriteStream => !!f)
    for (const t of s.tracks.values()) t.file = null
    return Promise.all(files.map((f) => new Promise<void>((r) => f.end(() => r())))).then(() => undefined)
  }

  private upsert(id: string, patch: Partial<Meeting>): Meeting {
    const m = this.deps.store.update(id, patch)
    if (!m) throw new Error('Essa reunião não existe mais.')
    if (this.s?.meeting.id === id) this.s.meeting = m
    this.deps.emit({ type: 'meeting:upsert', meeting: m })
    return m
  }

  private warn(s: Session, kind: MeetingWarning['kind'], message: string, extra: Partial<MeetingWarning> = {}): void {
    log.info(`Reunião: aviso ${kind}`)
    this.deps.emit({ type: 'meeting:warning', meetingId: s.meeting.id, kind, message, ...extra })
  }
}

/**
 * Do tempo do áudio gravado (sem as pausas) para o tempo da reunião: soma cada pausa que
 * começou antes daquele ponto. Usado na recuperação, que não tem relógio de parede.
 */
export function pauseMapper(pauses: Meeting['pauses']): (audioMs: number) => number {
  const sorted = [...pauses].sort((a, b) => a.at - b.at)
  return (audioMs) => {
    let acc = 0
    for (const p of sorted) {
      if (p.at <= audioMs + acc) acc += p.ms
      else break
    }
    return audioMs + acc
  }
}

/** Int16 little-endian de bytes de PCM; lança para vazio ou tamanho ímpar. */
export function toInt16(pcm: Int16Array | Uint8Array | ArrayBuffer): Int16Array {
  let bytes: Uint8Array
  if (pcm instanceof Int16Array) bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  else if (pcm instanceof Uint8Array) bytes = pcm
  else if (pcm instanceof ArrayBuffer) bytes = new Uint8Array(pcm)
  else throw new Error('Pedaço de áudio inválido.')
  if (!bytes.byteLength || bytes.byteLength % 2) throw new Error('Pedaço de áudio inválido.')
  if (bytes.byteOffset % 2 === 0) return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
  return new Int16Array(bytes.slice().buffer)
}

const byteLength = (pcm: unknown): number => (pcm instanceof ArrayBuffer ? pcm.byteLength : ArrayBuffer.isView(pcm) ? pcm.byteLength : 0)
