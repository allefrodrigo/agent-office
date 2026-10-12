import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSummary, Ledger } from '@shared/types'
import { CostBook, localDay, type SessionMark } from '../src/main/ledger'
import type { Store } from '../src/main/store'

// CostBook only needs the ledger, the session marks and save() from the store.
function fakeStore(marks: Record<string, SessionMark> = {}) {
  const store = { ledger: { days: {}, agents: {}, switches: [] } as Ledger, ledgerSessions: marks, save: vi.fn() }
  return store as typeof store & Store
}

const agent = (over: Partial<AgentSummary> = {}) => ({ id: 'ag-1', name: 'Ada', cwd: '/proj', model: 'claude-opus-5', ...over }) as AgentSummary
const usage = (costUSD: number, inputTokens = 0, outputTokens = 0) => ({
  costUSD,
  inputTokens,
  outputTokens,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 0,
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
})
const result = (total: number, models: Record<string, ReturnType<typeof usage>> = {}, turns = 1, ms = 1000) =>
  ({ total_cost_usd: total, modelUsage: models, num_turns: turns, duration_ms: ms }) as unknown as SDKResultMessage

const T = new Date('2026-10-12T15:00:00').getTime()
const DAY = localDay(T)
let store: ReturnType<typeof fakeStore>
let book: CostBook

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(T)
  store = fakeStore()
  book = new CostBook(store)
})
afterEach(() => {
  book.stop()
  vi.useRealTimers()
})

describe('localDay', () => {
  it('data local YYYY-MM-DD', () => {
    expect(localDay(new Date('2026-01-05T23:59:00').getTime())).toBe('2026-01-05')
    expect(localDay()).toBe(DAY)
  })
})

describe('custo por dia e projeto', () => {
  it('sessão nova conta só o que cresceu entre resultados', () => {
    book.begin('s1', false, 0)
    expect(book.record(agent(), 's1', 'main', result(0.5, { 'claude-opus-5': usage(0.5, 100, 10) }), T)).toBeCloseTo(0.5)
    expect(book.record(agent(), 's1', 'main', result(0.8, { 'claude-opus-5': usage(0.8, 150, 30) }), T)).toBeCloseTo(0.3)
    const d = store.ledger.days['/proj'][DAY]
    expect(d.costUsd).toBeCloseTo(0.8)
    expect(d.results).toBe(2)
    expect(d.turns).toBe(2)
    expect(d.durationMs).toBe(2000)
    expect(d.models['claude-opus-5']).toMatchObject({ inputTokens: 150, outputTokens: 30 })
    expect(d.models['claude-opus-5'].costUsd).toBeCloseTo(0.8)
    expect(d.agents['ag-1'].accounts.main).toBeCloseTo(0.8)
    expect(d.accounts.main.results).toBe(2)
    expect(store.ledger.agents['ag-1']).toMatchObject({ name: 'Ada', cwd: '/proj', firstAt: T, lastAt: T })
  })

  it('sessão retomada não conta duas vezes: o primeiro resultado só marca', () => {
    book.begin('old', true, 0)
    expect(book.isMarked('old')).toBe(false)
    expect(book.record(agent(), 'old', 'main', result(5, { m: usage(5) }), T)).toBe(0)
    expect(book.isMarked('old')).toBe(true)
    expect(book.record(agent(), 'old', 'main', result(5.25, { m: usage(5.25) }), T)).toBeCloseTo(0.25)
    expect(store.ledger.days['/proj'][DAY].costUsd).toBeCloseTo(0.25)
  })

  it('markResumed diz onde a sessão parou; begin repetido não mexe na marca', () => {
    book.markResumed('r', 2, { m: usage(2, 10, 1) })
    book.markResumed('r', 99, {})
    book.begin('r', true, 50)
    expect(book.record(agent(), 'r', 'main', result(2.5, { m: usage(2.5, 20, 2) }), T)).toBeCloseTo(0.5)
    expect(store.ledger.days['/proj'][DAY].models.m).toMatchObject({ inputTokens: 10, outputTokens: 1 })
  })

  it('marca antiga sem modelos (custo salvo no agente) põe o custo no modelo do agente', () => {
    book.begin('k', true, 1)
    expect(book.record(agent({ model: undefined }), 'k', 'a-2', result(1.5), T)).toBeCloseTo(0.5)
    const d = store.ledger.days['/proj'][DAY]
    expect(d.models.desconhecido.costUsd).toBeCloseTo(0.5)
    expect(d.accounts['a-2'].costUsd).toBeCloseTo(0.5)
  })

  it('total abaixo da marca (/clear) conta do zero', () => {
    book.begin('c', false, 0)
    book.record(agent(), 'c', undefined, result(3, { m: usage(3) }), T)
    expect(book.record(agent(), 'c', undefined, result(0.4, { m: usage(0.4) }), T)).toBeCloseTo(0.4)
    expect(store.ledger.days['/proj'][DAY].accounts.main.costUsd).toBeCloseTo(3.4)
  })

  it('resultado zerado não soma custo nem mexe na marca', () => {
    book.begin('z', false, 0)
    book.record(agent(), 'z', 'main', result(1, { m: usage(1) }), T)
    expect(book.record(agent(), 'z', 'main', result(0), T)).toBe(0)
    expect(store.ledgerSessions.z.total).toBe(1)
    expect(store.ledger.days['/proj'][DAY].results).toBe(2)
  })

  it('separa por projeto e por dia', () => {
    book.begin('a', false, 0)
    book.begin('b', false, 0)
    book.record(agent(), 'a', 'main', result(1), T)
    book.record(agent({ id: 'ag-2', cwd: '/outro' }), 'b', 'main', result(2), T + 86_400_000)
    expect(Object.keys(store.ledger.days)).toEqual(['/proj', '/outro'])
    expect(Object.keys(store.ledger.days['/outro'])).toEqual([localDay(T + 86_400_000)])
  })
})

describe('today e query', () => {
  beforeEach(() => {
    book.begin('a', false, 0)
    book.begin('b', false, 0)
    book.begin('c', false, 0)
    book.record(agent(), 'a', 'main', result(1), T)
    book.record(agent({ id: 'ag-2', name: 'Bob', cwd: '/proj/sub' }), 'b', 'main', result(2), T)
    book.record(agent({ id: 'ag-3', cwd: '/outro' }), 'c', 'main', result(4), T - 3 * 86_400_000)
  })

  it('today soma por pasta e por agente, só de hoje', () => {
    const t = book.today()
    expect(t.day).toBe(DAY)
    expect(t.costByCwd).toEqual({ '/proj': 1, '/proj/sub': 2 })
    expect(t.agents).toEqual({ 'ag-1': { name: 'Ada', cwd: '/proj', usd: 1 }, 'ag-2': { name: 'Bob', cwd: '/proj/sub', usd: 2 } })
  })

  it('query corta por pasta (com subpastas) e por dias, e devolve cópia', () => {
    const inProj = book.query({ cwd: '/proj/' })
    expect(Object.keys(inProj.days).sort()).toEqual(['/proj', '/proj/sub'])
    expect(Object.keys(inProj.agents).sort()).toEqual(['ag-1', 'ag-2'])
    expect(Object.keys(book.query({ to: localDay(T - 86_400_000) }).days)).toEqual(['/outro'])
    expect(Object.keys(book.query({ from: DAY }).days).sort()).toEqual(['/proj', '/proj/sub'])
    expect(Object.keys(book.query().days)).toHaveLength(3)
    inProj.days['/proj'][DAY].costUsd = 999
    expect(store.ledger.days['/proj'][DAY].costUsd).toBe(1)
  })

  it('emite today a cada resultado e à meia-noite', () => {
    const seen = vi.fn()
    book.on('today', seen)
    book.record(agent(), 'a', 'main', result(1.5), T)
    expect(seen).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(86_400_000)
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

describe('trocas de conta e saída', () => {
  it('switched ignora início repetido na mesma conta e filtra por query', () => {
    book.switched(agent(), 's', 'main', undefined, 'start')
    book.switched(agent(), 's', 'main', undefined, 'start')
    book.switched(agent(), 's', 'a-2', 'main', 'failover')
    expect(store.ledger.switches.map((s) => [s.to, s.from, s.reason])).toEqual([
      ['main', undefined, 'start'],
      ['a-2', 'main', 'failover'],
    ])
    expect(book.query({ cwd: '/outro' }).switches).toEqual([])
    expect(book.query({ from: DAY, to: DAY }).switches).toHaveLength(2)
  })

  it('guarda só as últimas trocas', () => {
    for (let i = 0; i < 5003; i++) book.switched(agent(), `s${i}`, i % 2 ? 'main' : 'a-2', undefined, 'start')
    expect(store.ledger.switches).toHaveLength(5000)
    expect(store.ledger.switches[0].sessionId).toBe('s3')
  })

  it('dismissed marca a saída e não apaga nada', () => {
    book.begin('a', false, 0)
    book.record(agent(), 'a', 'main', result(1), T)
    book.dismissed('ag-1')
    book.dismissed('ghost')
    expect(store.ledger.agents['ag-1'].dismissedAt).toBe(T)
    expect(store.ledger.days['/proj'][DAY].costUsd).toBe(1)
  })

  it('marcas velhas são esquecidas ao abrir', () => {
    const old = fakeStore({ velha: { total: 1, t: T - 121 * 86_400_000 }, nova: { total: 1, t: T }, sem: { total: 1 } as SessionMark })
    new CostBook(old).stop()
    expect(Object.keys(old.ledgerSessions)).toEqual(['nova'])
  })
})
