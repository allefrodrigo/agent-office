// Áudio da sala de reunião: o segmentador por energia que corta o PCM nas pausas antes do whisper,
// e o cabeçalho WAV para mandar o trecho sem ffmpeg. Puro, sem Node nem DOM (docs/prd/sala-de-reuniao.md).

/** O PCM da reunião: Int16 mono a 16 kHz. */
export const SAMPLE_RATE = 16_000
/** Tamanho do quadro de análise de energia. */
export const FRAME_MS = 30

/**
 * Limites do piso de ruído (RMS em Int16). Embaixo, o silêncio digital (zeros) não vira piso 0,
 * que faria qualquer chiado contar como fala. Em cima, fala contínua não sobe o limiar a ponto
 * de virar "silêncio".
 */
export const NOISE_FLOOR_MIN = 50
export const NOISE_FLOOR_MAX = 1000
/** Fala é energia acima de 3× o piso. */
export const SPEECH_FACTOR = 3

export interface CutOptions {
  /** Piso de ruído (RMS); padrão: noiseFloor(frames). */
  floor: number
  /** Pausa que permite cortar. */
  minPauseMs: number
  /** Trecho mínimo para cortar numa pausa. */
  minChunkMs: number
  /** Corte forçado neste tamanho. */
  maxChunkMs: number
  /** O corte forçado cai no quadro mais silencioso desta janela final. */
  lookbackMs: number
  /** Fala mínima para o trecho ir ao whisper (filtra estalos). */
  minSpeechMs: number
  /**
   * true: não vem mais áudio, o resto vira o último trecho.
   * false (padrão): o trecho em aberto fica para a próxima chamada (`next`).
   */
  final: boolean
}

export const CUT_DEFAULTS: Omit<CutOptions, 'floor'> = {
  minPauseMs: 700,
  minChunkMs: 4000,
  maxChunkMs: 25_000,
  lookbackMs: 3000,
  minSpeechMs: 150,
  final: false,
}

/** Um trecho com fala, em índices de quadro: [start, end). */
export interface FrameSpan {
  start: number
  end: number
}

export interface Cuts {
  chunks: FrameSpan[]
  /** Primeiro quadro ainda sem decisão; a próxima chamada recomeça daqui. */
  next: number
}

/** RMS de cada quadro completo de 30 ms; a sobra do fim (menos de um quadro) fica de fora. */
export function frameEnergy(pcm: Int16Array, rate = SAMPLE_RATE): Float64Array {
  const size = frameSize(rate)
  const n = Math.floor(pcm.length / size)
  const out = new Float64Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    for (let i = f * size, end = i + size; i < end; i++) sum += pcm[i] * pcm[i]
    out[f] = Math.sqrt(sum / size)
  }
  return out
}

/**
 * Piso de ruído: o 10º percentil das energias, dentro de [NOISE_FLOOR_MIN, NOISE_FLOOR_MAX].
 * O percentil baixo pega os vãos entre as palavras e ignora a fala.
 */
export function noiseFloor(frames: ArrayLike<number>): number {
  if (!frames.length) return NOISE_FLOOR_MIN
  const sorted = Float64Array.from(frames).sort()
  const p10 = sorted[Math.floor((sorted.length - 1) * 0.1)]
  return Math.min(NOISE_FLOOR_MAX, Math.max(NOISE_FLOOR_MIN, p10))
}

/**
 * Onde cortar o áudio em trechos para o whisper:
 * - pausa ≥ 700 ms com trecho ≥ 4 s: corta no meio da pausa;
 * - trecho chegou a 25 s: corta depois do quadro mais silencioso dos últimos 3 s;
 * - silêncio antes da fala é descartado (sobram 350 ms de entrada), e trecho sem fala não sai.
 *
 * Cada decisão depende só dos quadros até ali. Com o mesmo `floor`, rodar de novo a partir de
 * `next` sobre o buffer crescido dá os mesmos cortes que rodar tudo de uma vez: é o que o
 * `Segmenter` faz a cada pedaço que chega.
 */
export function cutPoints(frames: ArrayLike<number>, opts: Partial<CutOptions> = {}): Cuts {
  const o = { ...CUT_DEFAULTS, ...opts }
  const floor = Math.max(NOISE_FLOOR_MIN, o.floor ?? noiseFloor(frames))
  const threshold = floor * SPEECH_FACTOR
  const pause = toFrames(o.minPauseMs)
  const minChunk = toFrames(o.minChunkMs)
  const maxChunk = Math.max(1, toFrames(o.maxChunkMs))
  const lookback = Math.max(1, Math.min(maxChunk, toFrames(o.lookbackMs)))
  const minSpeech = Math.max(1, toFrames(o.minSpeechMs))
  const lead = Math.floor(pause / 2)

  const chunks: FrameSpan[] = []
  const isSpeech = (i: number) => frames[i] >= threshold
  let start = 0
  let silent = 0 // quadros silenciosos seguidos terminando em i
  let speech = 0 // quadros de fala no trecho [start, i]

  const cut = (at: number, upTo: number) => {
    if (speech >= minSpeech) chunks.push({ start, end: at })
    start = at
    // refaz a contagem do que sobrou depois do corte, como uma chamada nova a partir de `at`
    speech = 0
    silent = 0
    for (let k = at; k < upTo; k++) {
      if (isSpeech(k)) {
        speech++
        silent = 0
      } else silent++
    }
  }

  for (let i = 0; i < frames.length; i++) {
    if (isSpeech(i)) {
      speech++
      silent = 0
    } else silent++
    const len = i + 1 - start

    if (!speech) {
      // só silêncio até aqui: anda o começo, guardando um pouco de entrada
      if (len > lead) start = i + 1 - lead
      continue
    }
    if (silent >= pause && len >= minChunk) {
      cut(i + 1 - Math.floor(silent / 2), i + 1)
    } else if (len >= maxChunk) {
      let quiet = i + 1 - lookback
      for (let k = quiet + 1; k <= i; k++) if (frames[k] < frames[quiet]) quiet = k
      cut(quiet + 1, i + 1)
    }
  }

  if (o.final) {
    if (speech >= minSpeech && frames.length > start) chunks.push({ start, end: frames.length })
    return { chunks, next: frames.length }
  }
  return { chunks, next: start }
}

/** Um trecho pronto para o whisper; tempos em ms desde o começo do Segmenter. */
export interface PcmChunk {
  start: number
  end: number
  pcm: Int16Array
}

export interface SegmenterOptions extends Omit<CutOptions, 'floor' | 'final'> {
  /** Quanto do passado entra no piso de ruído. */
  floorWindowMs: number
}

/**
 * O segmentador em fluxo: o gravador entrega pedaços de 1 s (`push`) e recebe os trechos
 * fechados; `flush` no fim devolve o que sobrou. A memória fica limitada ao trecho em aberto
 * (até 25 s) e à janela do piso de ruído, não à duração da reunião.
 */
export class Segmenter {
  private readonly opts: SegmenterOptions
  private readonly size = frameSize(SAMPLE_RATE)
  /** Amostras desde o quadro `offset` (inclui a sobra de menos de um quadro no fim). */
  private pending = new Int16Array(0)
  /** Energia dos quadros completos de `pending`. */
  private energies: number[] = []
  /** Índice absoluto do primeiro quadro de `pending`. */
  private offset = 0
  /** Energias recentes para o piso de ruído (anel). */
  private history: number[] = []
  private historyAt = 0

  constructor(opts: Partial<SegmenterOptions> = {}) {
    this.opts = { ...CUT_DEFAULTS, floorWindowMs: 60_000, ...opts }
  }

  /** Piso de ruído atual (RMS). */
  get floor(): number {
    return noiseFloor(this.history)
  }

  push(pcm: Int16Array): PcmChunk[] {
    const had = Math.floor(this.pending.length / this.size)
    const merged = new Int16Array(this.pending.length + pcm.length)
    merged.set(this.pending)
    merged.set(pcm, this.pending.length)
    this.pending = merged
    const fresh = frameEnergy(this.pending.subarray(had * this.size))
    const cap = Math.max(1, toFrames(this.opts.floorWindowMs))
    for (const e of fresh) {
      this.energies.push(e)
      if (this.history.length < cap) this.history.push(e)
      else this.history[this.historyAt++ % cap] = e
    }
    return this.cut(false)
  }

  /** Fecha o trecho em aberto (encerrar, pausar) e zera o buffer; o relógio continua. */
  flush(): PcmChunk[] {
    const out = this.cut(true)
    // a sobra de menos de um quadro conta no relógio, para o próximo trecho não adiantar
    if (this.pending.length) this.offset += this.pending.length / this.size
    this.pending = new Int16Array(0)
    this.energies = []
    return out
  }

  private cut(final: boolean): PcmChunk[] {
    const { chunks, next } = cutPoints(this.energies, { ...this.opts, floor: this.floor, final })
    const ms = (frame: number) => Math.round(((this.offset + frame) * this.size * 1000) / SAMPLE_RATE)
    const out = chunks.map((c) => {
      const end = final && c.end === this.energies.length ? this.pending.length : c.end * this.size
      return { start: ms(c.start), end: ms(end / this.size), pcm: this.pending.slice(c.start * this.size, end) }
    })
    if (!final && next > 0) {
      this.pending = this.pending.slice(next * this.size)
      this.energies = this.energies.slice(next)
      this.offset += next
    }
    if (final) {
      this.offset += this.energies.length
      this.pending = this.pending.slice(this.energies.length * this.size)
      this.energies = []
    }
    return out
  }
}

/** Cabeçalho de 44 bytes de um WAV PCM 16 bits mono com `samples` amostras. */
export function wavHeader(samples: number, rate = SAMPLE_RATE): Uint8Array {
  const bytes = samples * 2
  const h = new Uint8Array(44)
  const v = new DataView(h.buffer)
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) h[at + i] = s.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + bytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // tamanho do bloco fmt
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) // bytes por segundo
  v.setUint16(32, 2, true) // bytes por amostra
  v.setUint16(34, 16, true) // bits por amostra
  ascii(36, 'data')
  v.setUint32(40, bytes, true)
  return h
}

/** O WAV inteiro (cabeçalho + amostras em little-endian), pronto para o POST ao whisper. */
export function wavBytes(pcm: Int16Array, rate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2)
  out.set(wavHeader(pcm.length, rate))
  const v = new DataView(out.buffer, 44)
  for (let i = 0; i < pcm.length; i++) v.setInt16(i * 2, pcm[i], true)
  return out
}

function frameSize(rate: number): number {
  return Math.round((rate * FRAME_MS) / 1000)
}

function toFrames(ms: number): number {
  return Math.round(ms / FRAME_MS)
}
