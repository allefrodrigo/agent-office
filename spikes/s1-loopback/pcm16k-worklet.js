// AudioWorklet pcm16k: passa-baixa simples + decimação 48k -> 16k, Int16 mono, blocos de 100 ms.
class Pcm16k extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = Math.round(sampleRate / 16000) // 3 em 48 kHz
    // Passa-baixa: duas biquads Butterworth em cascata, corte ~7 kHz (4ª ordem).
    this.b = this.biquad(7000, sampleRate)
    this.z = [[0, 0], [0, 0]]
    this.phase = 0
    this.block = new Int16Array(1600) // 100 ms em 16 kHz
    this.n = 0
    this.seq = 0
  }
  biquad(fc, fs) {
    const w = (2 * Math.PI * fc) / fs
    const cw = Math.cos(w), sw = Math.sin(w), q = Math.SQRT1_2
    const alpha = sw / (2 * q), a0 = 1 + alpha
    return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 }
  }
  step(x, z) {
    const c = this.b
    const y = c.b0 * x + z[0]
    z[0] = c.b1 * x - c.a1 * y + z[1]
    z[1] = c.b2 * x - c.a2 * y
    return y
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || !input.length) return true
    const chs = input.length
    const len = input[0].length
    for (let i = 0; i < len; i++) {
      let x = 0
      for (let c = 0; c < chs; c++) x += input[c][i]
      x /= chs
      const y = this.step(this.step(x, this.z[0]), this.z[1])
      if (++this.phase >= this.ratio) {
        this.phase = 0
        const v = Math.max(-1, Math.min(1, y))
        this.block[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
        if (this.n === this.block.length) {
          const out = this.block
          this.port.postMessage({ seq: this.seq++, buf: out.buffer }, [out.buffer])
          this.block = new Int16Array(1600)
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('pcm16k', Pcm16k)
