import { describe, expect, it } from 'vitest'
import {
  cutPoints,
  FRAME_MS,
  frameEnergy,
  NOISE_FLOOR_MAX,
  NOISE_FLOOR_MIN,
  noiseFloor,
  SAMPLE_RATE,
  Segmenter,
  wavBytes,
  wavHeader,
  type FrameSpan,
} from '@shared/meeting-audio'

// RN-01: segmentador por energia e cabeçalho WAV da sala de reunião, com PCM sintético.

/** Seno de 440 Hz; `dip` abaixa a amplitude num intervalo [de, até) em segundos. */
function tone(seconds: number, amp = 8000, dip?: { from: number; to: number; amp: number }): Int16Array {
  const out = new Int16Array(Math.round(seconds * SAMPLE_RATE))
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE
    const a = dip && t >= dip.from && t < dip.to ? dip.amp : amp
    out[i] = Math.round(a * Math.sin(2 * Math.PI * 440 * t))
  }
  return out
}

/** Silêncio com um chiado baixo e determinístico (RMS bem abaixo do piso mínimo). */
function quiet(seconds: number, amp = 20): Int16Array {
  const out = new Int16Array(Math.round(seconds * SAMPLE_RATE))
  let seed = 7
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = Math.round(((seed / 0x7fffffff) * 2 - 1) * amp)
  }
  return out
}

function join(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const ms = (frames: number) => frames * FRAME_MS
const spansMs = (spans: FrameSpan[]) => spans.map((s) => ({ start: ms(s.start), end: ms(s.end) }))

describe('frameEnergy', () => {
  it('um quadro a cada 30 ms; a sobra do fim fica de fora', () => {
    expect(frameEnergy(new Int16Array(480 * 3 + 100))).toHaveLength(3)
    expect(frameEnergy(new Int16Array(479))).toHaveLength(0)
  })

  it('RMS do seno é a amplitude / √2; silêncio digital é 0', () => {
    const e = frameEnergy(tone(1, 10_000))
    for (const v of e) expect(v).toBeCloseTo(10_000 / Math.SQRT2, -2)
    expect([...frameEnergy(new Int16Array(4800))].every((v) => v === 0)).toBe(true)
  })
})

describe('noiseFloor', () => {
  it('pega o 10º percentil, ignorando a fala', () => {
    const frames = [...Array(20).fill(200), ...Array(80).fill(5000)]
    expect(noiseFloor(frames)).toBe(200)
  })

  it('fica entre o mínimo e o máximo', () => {
    expect(noiseFloor([])).toBe(NOISE_FLOOR_MIN)
    expect(noiseFloor(new Float64Array(100))).toBe(NOISE_FLOOR_MIN)
    expect(noiseFloor(Array(100).fill(9000))).toBe(NOISE_FLOOR_MAX)
  })
})

describe('cutPoints', () => {
  it('corta na pausa de 1 s entre duas falas de 5 s', () => {
    const pcm = join(quiet(1), tone(5), quiet(1), tone(5), quiet(1))
    const { chunks } = cutPoints(frameEnergy(pcm), { final: true })
    const [a, b] = spansMs(chunks)
    expect(chunks).toHaveLength(2)
    // entrada de até 350 ms antes da fala
    expect(a.start).toBeGreaterThanOrEqual(600)
    expect(a.start).toBeLessThanOrEqual(1000)
    // corte dentro da pausa (6 s a 7 s)
    expect(a.end).toBeGreaterThan(6000)
    expect(a.end).toBeLessThan(7000)
    expect(b.start).toBeGreaterThanOrEqual(a.end)
    expect(b.start).toBeLessThanOrEqual(7000)
    expect(b.end).toBeGreaterThanOrEqual(12_000)
  })

  it('pausa curta (300 ms) não corta', () => {
    const pcm = join(tone(2), quiet(0.3), tone(2), quiet(0.3), tone(2), quiet(1))
    expect(cutPoints(frameEnergy(pcm), { final: true }).chunks).toHaveLength(1)
  })

  it('pausa longa com trecho abaixo de 4 s não corta', () => {
    const pcm = join(tone(2), quiet(1), tone(3), quiet(1))
    const { chunks } = cutPoints(frameEnergy(pcm), { final: true })
    expect(chunks).toHaveLength(1)
    expect(ms(chunks[0].start)).toBe(0)
    expect(ms(chunks[0].end)).toBeGreaterThan(6000)
  })

  it('fala contínua nunca passa de 25 s', () => {
    const { chunks } = cutPoints(frameEnergy(tone(60)), { final: true })
    expect(chunks.length).toBe(3)
    for (const c of chunks) expect(ms(c.end - c.start)).toBeLessThanOrEqual(25_000)
    // cobre tudo, sem buraco
    expect(chunks[0].start).toBe(0)
    expect(chunks[1].start).toBe(chunks[0].end)
    expect(chunks[2].start).toBe(chunks[1].end)
    expect(ms(chunks[2].end)).toBe(Math.floor(60_000 / FRAME_MS) * FRAME_MS)
  })

  it('o corte forçado cai no ponto mais silencioso dos últimos 3 s', () => {
    const pcm = tone(40, 8000, { from: 23.01, to: 23.07, amp: 1500 })
    const { chunks } = cutPoints(frameEnergy(pcm), { final: true })
    expect(ms(chunks[0].end)).toBeGreaterThan(23_000)
    expect(ms(chunks[0].end)).toBeLessThanOrEqual(23_100)
  })

  it('silêncio não gera trecho', () => {
    expect(cutPoints(frameEnergy(new Int16Array(SAMPLE_RATE * 30)), { final: true }).chunks).toEqual([])
    expect(cutPoints(frameEnergy(quiet(30)), { final: true }).chunks).toEqual([])
  })

  it('estalo curto no silêncio não vai ao whisper', () => {
    const pcm = join(quiet(2), tone(0.06), quiet(6))
    expect(cutPoints(frameEnergy(pcm), { final: true }).chunks).toEqual([])
  })

  it('sem final, o trecho em aberto fica para depois e o silêncio é descartado', () => {
    const silent = cutPoints(frameEnergy(quiet(10)))
    expect(silent.chunks).toEqual([])
    // só a entrada de ~350 ms continua pendente
    expect(ms(frameEnergy(quiet(10)).length - silent.next)).toBeLessThanOrEqual(360)

    const talking = cutPoints(frameEnergy(join(quiet(1), tone(3))))
    expect(talking.chunks).toEqual([])
    expect(ms(talking.next)).toBeGreaterThanOrEqual(600)
    expect(ms(talking.next)).toBeLessThanOrEqual(1000)
  })

  it('piso alto informado deixa a fala baixa de fora', () => {
    const frames = frameEnergy(join(tone(5, 1000), quiet(1)))
    expect(cutPoints(frames, { final: true, floor: 50 }).chunks).toHaveLength(1)
    expect(cutPoints(frames, { final: true, floor: 400 }).chunks).toEqual([])
  })
})

describe('Segmenter', () => {
  const pieces = (pcm: Int16Array, size = SAMPLE_RATE) => {
    const out: Int16Array[] = []
    for (let i = 0; i < pcm.length; i += size) out.push(pcm.subarray(i, i + size))
    return out
  }

  it('em pedaços de 1 s, corta igual a rodar tudo de uma vez', () => {
    const pcm = join(quiet(1.5), tone(5), quiet(1), tone(30), quiet(2), tone(4.2), quiet(0.4))
    const seg = new Segmenter()
    const got = pieces(pcm).flatMap((p) => seg.push(p))
    got.push(...seg.flush())
    const batch = spansMs(cutPoints(frameEnergy(pcm), { final: true, floor: NOISE_FLOOR_MIN }).chunks)
    expect(got.map((c) => ({ start: c.start, end: c.end }))).toEqual(batch)
    expect(got).toHaveLength(4)
    for (const c of got) {
      expect(c.end - c.start).toBeLessThanOrEqual(25_000)
      expect(c.pcm.length).toBe(Math.round(((c.end - c.start) * SAMPLE_RATE) / 1000))
    }
  })

  it('o PCM do trecho é o pedaço certo do áudio', () => {
    const pcm = join(quiet(1), tone(5.01, 3000))
    const seg = new Segmenter()
    // pedaços de 0,7 s: sobra menos de um quadro no fim, e ela entra no último trecho
    const [chunk] = [...pieces(pcm, 11_200).flatMap((p) => seg.push(p)), ...seg.flush()]
    expect(chunk.end).toBe(6010)
    const from = (chunk.start * SAMPLE_RATE) / 1000
    expect(chunk.pcm).toEqual(pcm.slice(from, from + chunk.pcm.length))
  })

  it('memória limitada: silêncio longo não acumula', () => {
    const seg = new Segmenter()
    for (let i = 0; i < 120; i++) expect(seg.push(quiet(1))).toEqual([])
    const pending = (seg as unknown as { pending: Int16Array }).pending
    expect(pending.length).toBeLessThan(SAMPLE_RATE * 2)
    expect(seg.flush()).toEqual([])
  })

  it('depois do flush, o relógio continua', () => {
    const seg = new Segmenter()
    seg.push(quiet(1))
    seg.push(tone(1))
    seg.push(tone(1))
    const first = seg.flush()
    expect(first).toHaveLength(1)
    expect(first[0].end).toBe(3000)
    seg.push(tone(1))
    seg.push(tone(1))
    const second = seg.flush()
    expect(second).toHaveLength(1)
    expect(second[0].start).toBe(3000)
    expect(second[0].end).toBe(5000)
  })

  it('o piso acompanha o ruído da sala', () => {
    const seg = new Segmenter()
    seg.push(quiet(3, 400))
    expect(seg.floor).toBeGreaterThan(NOISE_FLOOR_MIN)
    expect(seg.floor).toBeLessThan(400)
  })
})

describe('wavHeader', () => {
  it('cabeçalho PCM 16 bits mono, byte a byte', () => {
    // prettier-ignore
    const expected = [
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x7d, 0x00, 0x00, // 36 + 32000
      0x57, 0x41, 0x56, 0x45, // WAVE
      0x66, 0x6d, 0x74, 0x20, // 'fmt '
      0x10, 0x00, 0x00, 0x00, // 16
      0x01, 0x00, // PCM
      0x01, 0x00, // mono
      0x80, 0x3e, 0x00, 0x00, // 16000 Hz
      0x00, 0x7d, 0x00, 0x00, // 32000 bytes/s
      0x02, 0x00, // 2 bytes por amostra
      0x10, 0x00, // 16 bits
      0x64, 0x61, 0x74, 0x61, // data
      0x00, 0x7d, 0x00, 0x00, // 32000 bytes
    ]
    expect([...wavHeader(16_000, 16_000)]).toEqual(expected)
  })

  it('outra taxa e zero amostras', () => {
    const v = new DataView(wavHeader(0, 48_000).buffer)
    expect(v.getUint32(4, true)).toBe(36)
    expect(v.getUint32(24, true)).toBe(48_000)
    expect(v.getUint32(28, true)).toBe(96_000)
    expect(v.getUint32(40, true)).toBe(0)
  })

  it('wavBytes junta o cabeçalho e as amostras em little-endian', () => {
    const wav = wavBytes(Int16Array.from([1, -1, 256, -32768]))
    expect(wav).toHaveLength(44 + 8)
    expect([...wav.subarray(0, 44)]).toEqual([...wavHeader(4)])
    expect([...wav.subarray(44)]).toEqual([0x01, 0x00, 0xff, 0xff, 0x00, 0x01, 0x00, 0x80])
  })
})
