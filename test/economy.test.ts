import { describe, expect, it } from 'vitest'
import type { AgentSummary } from '@shared/types'
import { adviseAgent, CACHE_COLD_MS, memoryLevel, readCost, spendSplit, wakeCost } from '@shared/economy'

const NOW = 1_800_000_000_000
const agent = (over: Partial<AgentSummary> = {}) =>
  ({
    id: 'a',
    name: 'Ada',
    source: 'office',
    status: 'idle',
    model: 'claude-opus-5-5[1m]',
    context: { used: 300_000, max: 1_000_000, percent: 30 },
    lastTurnAt: NOW - 60_000,
    ...over,
  }) as AgentSummary

describe('custos da memória', () => {
  it('reler e recarregar seguem o preço do modelo (Opus 5.5: 0,2 leitura, 4 entrada x2 na escrita de 1h)', () => {
    expect(readCost('claude-opus-5-5[1m]', 1_000_000)).toBeCloseTo(0.2)
    expect(wakeCost('claude-opus-5-5', 1_000_000)).toBeCloseTo(8)
  })
  it('modelo desconhecido custa como Opus 5.5', () => {
    expect(wakeCost(undefined, 1_000_000)).toBeCloseTo(8)
    expect(readCost('gpt-5', 1_000_000)).toBeCloseTo(0.2)
  })
})

describe('adviseAgent', () => {
  it('memória grande e quente: sugere limpar ou compactar, com o custo por chamada', () => {
    expect(adviseAgent(agent(), 200_000, NOW)).toEqual({ kind: 'big', tokens: 300_000, usd: expect.closeTo(0.06) })
  })
  it('parado além do cache: avisa quanto custa acordar, antes do tamanho', () => {
    const a = agent({ lastTurnAt: NOW - CACHE_COLD_MS - 1 })
    expect(adviseAgent(a, 200_000, NOW)).toMatchObject({ kind: 'cold', tokens: 300_000, usd: expect.closeTo(2.4) })
  })
  it('conversa pequena fria, abaixo do aviso, ocupado, terminal ou aviso desligado: nada', () => {
    expect(adviseAgent(agent({ context: { used: 20_000, max: 1e6, percent: 2 }, lastTurnAt: 0 }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent({ context: { used: 150_000, max: 1e6, percent: 15 } }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent({ status: 'working' }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent({ source: 'terminal' }), 200_000, NOW)).toBeNull()
    expect(adviseAgent(agent(), 0, NOW)).toBeNull()
    expect(adviseAgent(agent({ context: undefined }), 200_000, NOW)).toBeNull()
  })
})

describe('memoryLevel', () => {
  it('avisa pelo tamanho mesmo com a janela de 1M quase vazia', () => {
    expect(memoryLevel({ used: 300_000, max: 1_000_000, percent: 30 }, 200_000)).toBe('warn')
    expect(memoryLevel({ used: 300_000, max: 1_000_000, percent: 30 }, 0)).toBe('ok')
    expect(memoryLevel({ used: 180_000, max: 200_000, percent: 90 }, 500_000)).toBe('full')
  })
})

describe('spendSplit', () => {
  it('a escrita de cache é o que sobra depois de leitura, saída e entrada', () => {
    const s = spendSplit('claude-opus-5-5[1m]', { costUsd: 10, inputTokens: 0, outputTokens: 100_000, cacheReadTokens: 10_000_000 })
    expect(s.read).toBeCloseTo(2)
    expect(s.output).toBeCloseTo(2)
    expect(s.write).toBeCloseTo(6)
  })
  it('sem preço: tudo conta como entrada', () => {
    expect(spendSplit('gpt-5', { costUsd: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })).toEqual({ read: 0, write: 0, output: 0, input: 1 })
  })
})
