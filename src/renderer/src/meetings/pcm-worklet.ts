// AudioWorklet `pcm16k` da sala de reunião: mistura os canais em mono, passa-baixa + decimação da
// taxa do AudioContext para 16 kHz (downsampleTo16k), Int16, e posta blocos de 100 ms numerados.
// Roda no AudioWorkletGlobalScope: carregado por URL do bundle (`?worker&url`, ver capture.ts),
// porque a CSP só deixa rodar script do próprio app (script-src 'self').

import { BLOCK_SAMPLES, createResampler, downsampleTo16k } from '@shared/meeting-pcm'

// O TypeScript não traz os tipos do AudioWorkletGlobalScope.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

/** Mensagem do worklet para a página. */
export interface PcmBlockMessage {
  /** Sequencial do bloco desde que o nó nasceu. */
  seq: number
  /** Int16Array de BLOCK_SAMPLES amostras (transferido). */
  pcm: ArrayBuffer
}

/** Tamanho do quadro de render do Web Audio. */
const QUANTUM = 128

class Pcm16k extends AudioWorkletProcessor {
  private state = createResampler(sampleRate)
  private mono = new Float32Array(QUANTUM)
  private block = new Int16Array(BLOCK_SAMPLES)
  private n = 0
  private seq = 0

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    // Sem fonte ligada (troca de microfone), o relógio segue com silêncio: a linha do tempo da
    // reunião não encolhe e a seq não pula.
    const len = input?.[0]?.length ?? QUANTUM
    if (this.mono.length !== len) this.mono = new Float32Array(len)
    const mono = this.mono
    mono.fill(0)
    if (input?.length) {
      for (const ch of input) for (let i = 0; i < len; i++) mono[i] += ch[i]
      if (input.length > 1) for (let i = 0; i < len; i++) mono[i] /= input.length
    }
    const out = downsampleTo16k(mono, sampleRate, this.state)
    for (let i = 0; i < out.length; i++) {
      this.block[this.n++] = out[i]
      if (this.n === BLOCK_SAMPLES) {
        const buf = this.block.buffer as ArrayBuffer
        this.port.postMessage({ seq: this.seq++, pcm: buf } satisfies PcmBlockMessage, [buf])
        this.block = new Int16Array(BLOCK_SAMPLES)
        this.n = 0
      }
    }
    return true
  }
}

registerProcessor('pcm16k', Pcm16k)
