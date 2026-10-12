import { describe, expect, it } from 'vitest'
import { messageCost, priceOf } from '@shared/pricing'

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearch: 0 }

describe('priceOf', () => {
  it('acha a família pelo prefixo mais longo', () => {
    expect(priceOf('claude-opus-5-5')).toMatchObject({ input: 4, output: 20 })
    expect(priceOf('claude-opus-5')).toMatchObject({ input: 5, output: 25 })
    expect(priceOf('claude-haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5 })
    expect(priceOf('claude-fable-5-1')).toMatchObject({ cacheRead: 0.25 })
  })
  it('ignora [1m] e maiúsculas', () => {
    expect(priceOf('Claude-Opus-5-5[1M]')).toEqual(priceOf('claude-opus-5-5'))
  })
  it('modelo desconhecido ou prefixo sem hífen não tem preço', () => {
    expect(priceOf('gpt-5')).toBeUndefined()
    expect(priceOf('claude-opus-55')).toBeUndefined()
    expect(priceOf('<synthetic>')).toBeUndefined()
  })
})

describe('messageCost', () => {
  it('soma entrada, saída e cache pelos multiplicadores', () => {
    // opus 5: 5 in, 25 out, 0.5 cache read; writes 1.25x (5m) and 2x (1h) input
    const usd = messageCost('claude-opus-5', { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000, webSearch: 0 })
    expect(usd).toBeCloseTo(5 + 25 + 0.5 + 6.25 + 10)
  })
  it('modo rápido custa o dobro; busca na web soma 1 centavo cada', () => {
    const u = { ...zero, output: 1_000_000, webSearch: 3 }
    expect(messageCost('claude-opus-5', u, true)).toBeCloseTo(50 + 0.03)
    expect(messageCost('claude-opus-5', u)).toBeCloseTo(25 + 0.03)
  })
  it('prompt longo do Haiku 5.5 muda o preço, cache lido junto', () => {
    expect(messageCost('claude-haiku-5-5', { ...zero, input: 100_000, output: 1_000_000 })).toBeCloseTo(0.01 + 0.5)
    const long = messageCost('claude-haiku-5-5', { ...zero, input: 50_000, cacheRead: 60_000, output: 1_000_000 })
    expect(long).toBeCloseTo((50_000 * 0.5 + 60_000 * 0.05 + 1_000_000 * 2.5) / 1_000_000)
  })
  it('sem preço devolve undefined', () => {
    expect(messageCost('desconhecido', zero)).toBeUndefined()
  })
})
