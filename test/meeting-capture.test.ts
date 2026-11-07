import { describe, expect, it } from 'vitest'
import { installMediaPermissions, keepAwake } from '../src/main/meetings/capture'
import { allowPermission, isAppUrl, RADIO_ORIGIN } from '../src/shared/media-permissions'
import { BLOCK_SAMPLES, BLOCKS_PER_CHUNK, blockLevel, createResampler, downsampleTo16k, PcmBatcher, toInt16 } from '../src/shared/meeting-pcm'
import { AUDIO_CHUNK_MAX_BYTES } from '../src/shared/meetings'

const sine = (hz: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))

const rms = (a: ArrayLike<number>, from = 0) => {
  let s = 0
  for (let i = from; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s / (a.length - from))
}

/** Cruzamentos de zero subindo: frequência aproximada do tom. */
const risingZeros = (a: Int16Array) => {
  let n = 0
  for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) n++
  return n
}

/** Roda o reamostrador em quadros de 128, como o worklet, e junta a saída. */
function inQuanta(input: Float32Array, rate: number): Int16Array {
  const state = createResampler(rate)
  const parts: number[] = []
  for (let i = 0; i < input.length; i += 128) parts.push(...downsampleTo16k(input.subarray(i, i + 128), rate, state))
  return Int16Array.from(parts)
}

describe('downsampleTo16k', () => {
  it('48 kHz vira 16 kHz: um terço das amostras, mesmo tom, mesma amplitude', () => {
    const out = inQuanta(sine(1000, 48_000, 1), 48_000)
    expect(out.length).toBe(16_000)
    expect(risingZeros(out)).toBeGreaterThanOrEqual(999)
    expect(risingZeros(out)).toBeLessThanOrEqual(1000)
    expect(rms(out, 400) / 0x7fff).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  it('44,1 kHz (razão fracionária) dá 16 mil amostras por segundo, sem deriva', () => {
    const out = inQuanta(sine(440, 44_100, 2), 44_100)
    expect(Math.abs(out.length - 32_000)).toBeLessThanOrEqual(1)
    expect(Math.abs(risingZeros(out) - 880)).toBeLessThanOrEqual(1)
  })

  it('em pedaços dá o mesmo que de uma vez', () => {
    const input = sine(700, 48_000, 0.5)
    const once = Int16Array.from(downsampleTo16k(input, 48_000, createResampler(48_000)))
    expect(Array.from(inQuanta(input, 48_000))).toEqual(Array.from(once))
  })

  it('o passa-baixa corta o que viraria alias (10 kHz em 48 kHz)', () => {
    const out = inQuanta(sine(10_000, 48_000, 1), 48_000)
    expect(rms(out, 400) / 0x7fff).toBeLessThan(0.1)
  })

  it('16 kHz passa direto', () => {
    const input = sine(300, 16_000, 0.1)
    const out = downsampleTo16k(input, 16_000, createResampler(16_000))
    expect(Array.from(out)).toEqual(Array.from(input, toInt16))
  })

  it('devolve uma vista reaproveitada e se ajusta a outra taxa', () => {
    const state = createResampler(48_000)
    const a = downsampleTo16k(new Float32Array(128), 48_000, state)
    const b = downsampleTo16k(new Float32Array(128), 48_000, state)
    expect(a.buffer).toBe(b.buffer)
    downsampleTo16k(new Float32Array(441), 44_100, state)
    expect(state.inRate).toBe(44_100)
    expect(() => createResampler(0)).toThrow()
  })
})

describe('toInt16 e blockLevel', () => {
  it('satura e trata NaN', () => {
    expect(toInt16(1)).toBe(32767)
    expect(toInt16(-1)).toBe(-32768)
    expect(toInt16(3)).toBe(32767)
    expect(toInt16(-3)).toBe(-32768)
    expect(toInt16(NaN)).toBe(0)
    expect(toInt16(0)).toBe(0)
  })

  it('nível de 0 a 1', () => {
    expect(blockLevel(new Int16Array(0))).toBe(0)
    expect(blockLevel(new Int16Array(100))).toBe(0)
    expect(blockLevel(new Int16Array(100).fill(-32768))).toBe(1)
    expect(blockLevel(new Int16Array(100).fill(16384))).toBeCloseTo(0.5, 5)
  })
})

describe('PcmBatcher', () => {
  const block = (v: number) => new Int16Array(BLOCK_SAMPLES).fill(v)

  it('10 blocos de 100 ms viram 1 s, dentro do limite do IPC', () => {
    const b = new PcmBatcher()
    for (let i = 0; i < BLOCKS_PER_CHUNK - 1; i++) expect(b.push(i, block(i)).batch).toBeUndefined()
    const { batch, gap } = b.push(9, block(9))
    expect(gap).toBeUndefined()
    expect(batch!.seq).toBe(0)
    expect(batch!.pcm.length).toBe(16_000)
    expect(batch!.pcm[0]).toBe(0)
    expect(batch!.pcm[15_999]).toBe(9)
    expect(batch!.pcm.byteLength).toBeLessThanOrEqual(AUDIO_CHUNK_MAX_BYTES)
    expect(b.pending).toBe(1)
  })

  it('seq pulada vira buraco; o pedaço segue com o que chegou', () => {
    const b = new PcmBatcher(2)
    b.push(0, block(1))
    const r = b.push(3, block(2))
    expect(r.gap).toEqual({ seq: 0, blocks: 2 })
    expect(r.batch!.pcm.length).toBe(2 * BLOCK_SAMPLES)
  })

  it('flush devolve a sobra uma vez', () => {
    const b = new PcmBatcher()
    expect(b.flush()).toBeUndefined()
    b.push(0, block(5))
    const rest = b.flush()
    expect(rest).toEqual({ seq: 0, pcm: block(5) })
    expect(b.flush()).toBeUndefined()
  })
})

describe('allowPermission', () => {
  const file = 'file:///Applications/Agent%20Office.app/Contents/Resources/app.asar/out/renderer/index.html'
  const dev = 'http://localhost:5173/'

  it('microfone só para a página do app, no quadro principal, só áudio', () => {
    expect(allowPermission('media', file, file, { isMainFrame: true, mediaTypes: ['audio'] })).toBe(true)
    expect(allowPermission('media', `${file}?shots=1#x`, file, { isMainFrame: true, mediaTypes: ['audio'] })).toBe(true)
    expect(allowPermission('media', file, file, { isMainFrame: true, mediaTypes: ['audio', 'video'] })).toBe(false)
    expect(allowPermission('media', file, file, { isMainFrame: true, mediaTypes: ['video'] })).toBe(false)
    expect(allowPermission('media', file, file, { isMainFrame: true, mediaTypes: [] })).toBe(false)
    expect(allowPermission('media', file, file, { isMainFrame: false, mediaTypes: ['audio'] })).toBe(false)
    expect(allowPermission('media', 'http://localhost:5173/index.html', dev, { isMainFrame: true, mediaTypes: ['audio'] })).toBe(true)
  })

  it('outra página file:// ou outra origem não ganha nada', () => {
    expect(allowPermission('media', 'file:///tmp/evil.html', file, { isMainFrame: true, mediaTypes: ['audio'] })).toBe(false)
    expect(allowPermission('media', 'http://localhost:5174/', dev, { isMainFrame: true, mediaTypes: ['audio'] })).toBe(false)
    expect(allowPermission('clipboard-sanitized-write', 'https://example.com/', file)).toBe(false)
    expect(allowPermission('media', 'nem-url', file)).toBe(false)
    expect(allowPermission('media', file, 'nem-url')).toBe(false)
    expect(isAppUrl(file, 'office-media://x')).toBe(false)
  })

  it('a rádio fica com tela cheia e encrypted-media, nunca microfone', () => {
    const yt = `${RADIO_ORIGIN}/embed/abc?autoplay=1`
    expect(allowPermission('fullscreen', yt, file, { isMainFrame: false })).toBe(true)
    expect(allowPermission('mediaKeySystem', yt, file, { isMainFrame: false })).toBe(true)
    expect(allowPermission('media', yt, file, { isMainFrame: false, mediaTypes: ['audio'] })).toBe(false)
    expect(allowPermission('clipboard-read', yt, file)).toBe(false)
  })

  it('o app copia texto e vai para tela cheia; o resto é negado', () => {
    expect(allowPermission('clipboard-sanitized-write', file, file, { isMainFrame: true })).toBe(true)
    expect(allowPermission('fullscreen', file, file, { isMainFrame: true })).toBe(true)
    for (const p of ['notifications', 'geolocation', 'clipboard-read', 'display-capture', 'openExternal', 'midi', 'hid', 'unknown'])
      expect(allowPermission(p, file, file, { isMainFrame: true })).toBe(false)
  })

  it('checagem: áudio ou desconhecido sim, vídeo não', () => {
    expect(allowPermission('media', file, file, { isMainFrame: true, mediaType: 'audio' })).toBe(true)
    expect(allowPermission('media', file, file, { isMainFrame: true, mediaType: 'unknown' })).toBe(true)
    expect(allowPermission('media', file, file, { isMainFrame: true, mediaType: 'video' })).toBe(false)
  })
})

describe('installMediaPermissions', () => {
  const app = 'file:///x/out/renderer/index.html'
  type Req = (wc: unknown, permission: string, cb: (ok: boolean) => void, details: Record<string, unknown>) => void
  type Check = (wc: unknown, permission: string, origin: string, details: Record<string, unknown>) => boolean
  let request: Req | null = null
  let check: Check | null = null
  const ses = {
    setPermissionRequestHandler: (h: Req | null) => (request = h),
    setPermissionCheckHandler: (h: Check | null) => (check = h),
  }
  installMediaPermissions(ses as never, app)

  it('pedido: microfone do app sim, câmera e outra página não', () => {
    const ask = (permission: string, details: Record<string, unknown>) => {
      let got: boolean | undefined
      request!({}, permission, (ok) => (got = ok), details)
      return got
    }
    expect(ask('media', { requestingUrl: app, isMainFrame: true, mediaTypes: ['audio'] })).toBe(true)
    expect(ask('media', { requestingUrl: app, isMainFrame: true, mediaTypes: ['video'] })).toBe(false)
    expect(ask('media', { requestingUrl: `${RADIO_ORIGIN}/embed/x`, isMainFrame: false, mediaTypes: ['audio'] })).toBe(false)
    expect(ask('notifications', { requestingUrl: app, isMainFrame: true })).toBe(false)
  })

  it('checagem sem URL usa a da janela no quadro principal', () => {
    const wc = { getURL: () => app }
    expect(check!(wc, 'media', 'file:///', { isMainFrame: true, mediaType: 'audio' })).toBe(true)
    expect(check!(wc, 'media', 'file:///', { isMainFrame: false, mediaType: 'audio' })).toBe(false)
    expect(check!(null, 'fullscreen', RADIO_ORIGIN, { isMainFrame: false })).toBe(true)
  })
})

describe('keepAwake', () => {
  it('desliga o estrangulamento, segura a suspensão e desfaz uma vez', () => {
    let throttling = true
    const started = new Set<number>()
    const calls: string[] = []
    const wc = { getBackgroundThrottling: () => throttling, setBackgroundThrottling: (v: boolean) => void (throttling = v), isDestroyed: () => false }
    const blocker = {
      start: (type: string) => (calls.push(type), started.add(7), 7),
      stop: (id: number) => void started.delete(id),
      isStarted: (id: number) => started.has(id),
    }
    const restore = keepAwake(wc, blocker as never)
    expect(throttling).toBe(false)
    expect(calls).toEqual(['prevent-app-suspension'])
    expect(started.has(7)).toBe(true)
    restore()
    restore()
    expect(throttling).toBe(true)
    expect(started.size).toBe(0)
  })
})
