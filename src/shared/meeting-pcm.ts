// Captura da sala de reunião: o reamostrador do worklet `pcm16k` (taxa do AudioContext → 16 kHz
// Int16) e o agrupador que junta os blocos de 100 ms em pedaços de 1 s para o IPC.
// Puro, sem DOM nem Node, para rodar no AudioWorklet e no vitest (docs/prd/sala-de-reuniao.md).
// Não importe meetings.ts aqui: o worklet levaria junto as listas de texto do filtro.

import { SAMPLE_RATE } from './meeting-audio'

/** Um bloco do worklet: 100 ms a 16 kHz. */
export const BLOCK_SAMPLES = SAMPLE_RATE / 10
/** Blocos por pedaço enviado ao main: 1 s, 32 KB (abaixo de AUDIO_CHUNK_MAX_BYTES; o teste confere). */
export const BLOCKS_PER_CHUNK = 10
/** Corte do passa-baixa antes de decimar: abaixo do Nyquist de 16 kHz (8 kHz), com folga. */
export const LOWPASS_HZ = 7000

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** Estado do reamostrador entre chamadas; um por fluxo. */
export interface ResamplerState {
  inRate: number
  /** Passos de entrada por amostra de saída (3 em 48 kHz). */
  step: number
  /** Coeficientes do passa-baixa; null quando não há o que filtrar (entrada ≤ 16 kHz). */
  coef: Biquad | null
  /** Memória das duas biquads em cascata (4ª ordem). */
  z: Float64Array
  /** Posição da próxima amostra de saída, em amostras de entrada relativas ao buffer atual. */
  pos: number
  /** Última amostra filtrada do buffer anterior, para interpolar na emenda. */
  prev: number
  /** Saída reaproveitada entre chamadas (o worklet roda 375 vezes por segundo). */
  out: Int16Array
}

export function createResampler(inRate: number): ResamplerState {
  if (!(inRate > 0)) throw new Error(`Taxa de amostragem inválida: ${inRate}`)
  return {
    inRate,
    step: inRate / SAMPLE_RATE,
    coef: inRate > SAMPLE_RATE ? lowpass(Math.min(LOWPASS_HZ, inRate * 0.45), inRate) : null,
    z: new Float64Array(4),
    pos: 0,
    prev: 0,
    out: new Int16Array(0),
  }
}

/**
 * Reamostra `input` (Float32 mono em [-1, 1], na taxa `inRate`) para 16 kHz Int16: passa-baixa
 * Butterworth de 4ª ordem e interpolação linear, que aceita razões fracionárias (44,1 kHz).
 * Contínuo entre chamadas: o estado guarda o filtro e a fase.
 *
 * Devolve uma vista do buffer do estado, válida até a próxima chamada: copie se for guardar.
 */
export function downsampleTo16k(input: Float32Array, inRate: number, state: ResamplerState): Int16Array {
  if (state.inRate !== inRate) Object.assign(state, createResampler(inRate))
  const max = Math.ceil(input.length / state.step) + 1
  if (state.out.length < max) state.out = new Int16Array(max)
  const { coef, z, step, out } = state
  let { pos, prev } = state
  let n = 0
  for (let i = 0; i < input.length; i++) {
    let y = input[i]
    if (coef) {
      // duas biquads em cascata (forma direta transposta II)
      let s = coef.b0 * y + z[0]
      z[0] = coef.b1 * y - coef.a1 * s + z[1]
      z[1] = coef.b2 * y - coef.a2 * s
      y = s
      s = coef.b0 * y + z[2]
      z[2] = coef.b1 * y - coef.a1 * s + z[3]
      z[3] = coef.b2 * y - coef.a2 * s
      y = s
    }
    // saídas cuja posição cai em (i - 1, i]
    while (pos <= i) {
      out[n++] = toInt16(prev + (y - prev) * (pos - (i - 1)))
      pos += step
    }
    prev = y
  }
  state.pos = pos - input.length
  state.prev = prev
  return out.subarray(0, n)
}

/** Float em [-1, 1] para Int16, com saturação. */
export function toInt16(v: number): number {
  if (!(v === v)) return 0 // NaN
  const c = v < -1 ? -1 : v > 1 ? 1 : v
  return Math.round(c < 0 ? c * 0x8000 : c * 0x7fff) || 0 // sem -0
}

/** RMS normalizado (0 a 1) de um bloco Int16: o medidor da faixa. */
export function blockLevel(pcm: Int16Array): number {
  if (!pcm.length) return 0
  let sum = 0
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
  return Math.sqrt(sum / pcm.length) / 0x8000
}

/** Um pedaço pronto para o `office:meetingAudio`. */
export interface PcmBatch {
  /** Sequencial do pedaço na faixa, de 0. */
  seq: number
  pcm: Int16Array
}

/** Blocos que faltaram entre dois que chegaram (o worklet não deveria pular, mas o main precisa saber). */
export interface BlockGap {
  /** Seq do pedaço onde o buraco aparece. */
  seq: number
  /** Blocos de 100 ms perdidos. */
  blocks: number
}

/**
 * Junta os blocos de 100 ms do worklet em pedaços de 1 s. Quem manda é a chegada dos blocos
 * (mensagens do worklet), não um timer, para não depender do relógio da página em segundo plano.
 * Bloco com seq pulada vira um aviso de buraco; o pedaço segue com o que chegou.
 */
export class PcmBatcher {
  private blocks: Int16Array[] = []
  private size = 0
  private nextSeq = 0
  private lastBlock = -1

  constructor(private readonly perChunk = BLOCKS_PER_CHUNK) {}

  /** Seq do pedaço em montagem (o próximo a sair). */
  get pending(): number {
    return this.nextSeq
  }

  /** Recebe um bloco; devolve o pedaço quando completou `perChunk` blocos. */
  push(blockSeq: number, pcm: Int16Array): { batch?: PcmBatch; gap?: BlockGap } {
    let gap: BlockGap | undefined
    if (this.lastBlock >= 0 && blockSeq > this.lastBlock + 1) gap = { seq: this.nextSeq, blocks: blockSeq - this.lastBlock - 1 }
    this.lastBlock = blockSeq
    this.blocks.push(pcm)
    this.size += pcm.length
    const batch = this.blocks.length >= this.perChunk ? this.take() : undefined
    return { batch, gap }
  }

  /** O que sobrou (menos de 1 s), no fim da captura; undefined se não há nada. */
  flush(): PcmBatch | undefined {
    return this.blocks.length ? this.take() : undefined
  }

  private take(): PcmBatch {
    const pcm = new Int16Array(this.size)
    let at = 0
    for (const b of this.blocks) {
      pcm.set(b, at)
      at += b.length
    }
    this.blocks = []
    this.size = 0
    return { seq: this.nextSeq++, pcm }
  }
}

/** Biquad passa-baixa Butterworth (Q = 1/√2), fórmulas do Audio EQ Cookbook. */
function lowpass(fc: number, fs: number): Biquad {
  const w = (2 * Math.PI * fc) / fs
  const cw = Math.cos(w)
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const a0 = 1 + alpha
  return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 }
}
