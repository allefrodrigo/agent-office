import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Account, LedgerSwitch } from '@shared/types'
import { localDate, parseLine, StatsReader, streaks } from '../src/main/stats'

const NOW = Date.now()
const iso = (t: number) => new Date(t).toISOString()

/** An assistant line as Claude Code writes it. */
function line(o: { session?: string; t?: number; id?: string; req?: string; model?: string; input?: number; output?: number; tools?: number; extra?: Record<string, unknown> } = {}): string {
  const content = Array.from({ length: o.tools ?? 0 }, () => ({ type: 'tool_use' }))
  return JSON.stringify({
    type: 'assistant',
    sessionId: o.session ?? 's1',
    timestamp: iso(o.t ?? NOW - 60_000),
    requestId: o.req ?? 'req-1',
    message: {
      id: o.id ?? 'msg-1',
      model: o.model ?? 'claude-opus-5',
      content,
      usage: { input_tokens: o.input ?? 1000, output_tokens: o.output ?? 100, ...o.extra },
    },
  })
}

describe('parseLine', () => {
  it('lê tokens, cache, busca, modo rápido e chamadas de ferramenta', () => {
    const l = parseLine(
      line({
        tools: 2,
        extra: {
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 30,
          cache_creation: { ephemeral_1h_input_tokens: 10 },
          server_tool_use: { web_search_requests: 2 },
          speed: 'fast',
        },
      }),
    )!
    expect(l).toMatchObject({ sessionId: 's1', key: 'msg-1|req-1', model: 'claude-opus-5', fast: true, toolCalls: 2 })
    expect(l.tokens).toEqual({ input: 1000, output: 100, cacheRead: 50, cacheWrite5m: 20, cacheWrite1h: 10, webSearch: 2, messages: 1, costUsd: 0 })
  })

  it('usa ephemeral_5m quando existe', () => {
    const l = parseLine(line({ extra: { cache_creation_input_tokens: 99, cache_creation: { ephemeral_5m_input_tokens: 7 } } }))!
    expect(l.tokens.cacheWrite5m).toBe(7)
  })

  it('descarta o que não é resposta do modelo', () => {
    expect(parseLine('{"type":"user","message":{}}')).toBeNull()
    expect(parseLine('{"type":"assistant", truncado')).toBeNull()
    expect(parseLine('{"x":"\\"type\\":\\"assistant\\""}')).toBeNull()
    expect(parseLine(line({ model: '<synthetic>' }))).toBeNull()
    expect(parseLine(line().replace(/"timestamp":"[^"]+"/, '"timestamp":"ontem"'))).toBeNull()
    expect(parseLine(line({ session: '' }))).toBeNull()
    expect(parseLine('{"type":"assistant","sessionId":"s","timestamp":"2026-01-01T00:00:00Z"}')).toBeNull()
  })

  it('números negativos ou estranhos viram zero; sem id nem requestId não há chave', () => {
    const raw = JSON.parse(line({ input: -5 }))
    delete raw.message.id
    delete raw.requestId
    const l = parseLine(JSON.stringify(raw))!
    expect(l.tokens.input).toBe(0)
    expect(l.key).toBeUndefined()
  })
})

describe('streaks', () => {
  it('sequência atual termina hoje ou ontem; a maior conta dias seguidos', () => {
    expect(streaks(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-01', '2026-10-02'], '2026-10-12')).toEqual({ current: 3, longest: 3 })
    expect(streaks(['2026-10-10', '2026-10-11'], '2026-10-12')).toEqual({ current: 2, longest: 2 })
    expect(streaks(['2026-10-01'], '2026-10-12')).toEqual({ current: 0, longest: 1 })
    expect(streaks([], '2026-10-12')).toEqual({ current: 0, longest: 0 })
  })
})

describe('StatsReader', () => {
  let home: string
  let data: string
  let accounts: Account[]
  let switches: LedgerSwitch[]
  const projects = () => join(home, '.claude', 'projects', '-proj')
  const reader = () => new StatsReader(data, { accounts: () => accounts, switches: () => switches, plan: () => [] }, home)

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ao-stats-home-'))
    data = mkdtempSync(join(tmpdir(), 'ao-stats-data-'))
    mkdirSync(projects(), { recursive: true })
    accounts = [{ id: 'main', name: 'Principal', provider: 'claude', color: '#e0894a' }]
    switches = []
  })

  it('soma dias, modelos, sessões e ferramentas; sem conta registrada vai para o terminal', async () => {
    writeFileSync(
      join(projects(), 's1.jsonl'),
      [
        '{"type":"user","message":{"content":"oi"}}',
        line({ id: 'a', tools: 1 }),
        line({ id: 'b', session: 's2', model: 'modelo-sem-preco' }),
        '',
      ].join('\n'),
    )
    const stats = await reader().refresh()
    expect(stats.buckets.map((b) => b.accountId)).toEqual(['all', 'main', 'terminal'])
    const all = stats.buckets[0]
    expect(all.totals).toMatchObject({ messages: 2, toolCalls: 1, sessions: 2, activeDays: 1, tokens: 2200 })
    expect(all.totals.costUsd).toBeCloseTo((1000 * 5 + 100 * 25) / 1e6)
    expect(all.byModel['modelo-sem-preco'].costUsd).toBeUndefined()
    expect(stats.unpricedModels).toEqual(['modelo-sem-preco'])
    expect(all.days[0].date).toBe(localDate(NOW - 60_000))
    expect(all.hourCounts.reduce((a, b) => a + b, 0)).toBe(2)
    expect(all.streak.current).toBe(1)
    expect(stats.buckets[1].totals.messages).toBe(0)
    expect(stats.lastRead).toMatchObject({ files: 1 })
    expect(stats.since).toBe(localDate(NOW - 60_000))
  })

  it('a mesma mensagem em dois arquivos (fork, resume) conta uma vez', async () => {
    writeFileSync(join(projects(), 'a.jsonl'), line({ id: 'x' }) + '\n')
    writeFileSync(join(projects(), 'b.jsonl'), line({ id: 'x' }) + '\n' + line({ id: 'y' }) + '\n')
    const all = (await reader().refresh()).buckets[0]
    expect(all.totals.messages).toBe(2)
  })

  it('blocos seguidos da mesma mensagem somam só a saída extra e as ferramentas', async () => {
    writeFileSync(join(projects(), 'a.jsonl'), [line({ id: 'x', output: 10 }), line({ id: 'x', output: 40, tools: 2 }), line({ id: 'x', output: 30 })].join('\n') + '\n')
    const all = (await reader().refresh()).buckets[0]
    expect(all.totals.messages).toBe(1)
    expect(all.byModel['claude-opus-5'].output).toBe(40)
    expect(all.totals.toolCalls).toBe(2)
  })

  it('lê só os bytes novos, ignora a linha pela metade e guarda o progresso em stats.json', async () => {
    const file = join(projects(), 'a.jsonl')
    writeFileSync(file, line({ id: 'x' }) + '\n' + line({ id: 'y' }).slice(0, 40))
    const r = reader()
    expect((await r.refresh()).buckets[0].totals.messages).toBe(1)
    writeFileSync(file, line({ id: 'x' }) + '\n' + line({ id: 'y' }) + '\n')
    expect((await r.refresh()).buckets[0].totals.messages).toBe(2)
    appendFileSync(file, line({ id: 'z' }) + '\n')
    // A new reader starts from stats.json, not from zero.
    const again = await reader().refresh()
    expect(again.buckets[0].totals.messages).toBe(3)
    expect(again.lastRead?.files).toBe(1)
    const idle = await reader().refresh()
    expect(idle.buckets[0].totals.messages).toBe(3)
    expect(idle.lastRead?.files).toBe(0)
  })

  it('arquivo apagado do disco mantém os números', async () => {
    const file = join(projects(), 'a.jsonl')
    writeFileSync(file, line({ id: 'x' }) + '\n')
    const r = reader()
    await r.refresh()
    rmSync(file)
    expect((await r.refresh()).buckets[0].totals.messages).toBe(1)
  })

  it('trocas do livro-caixa dizem a conta de cada sessão do escritório', async () => {
    accounts.push({ id: 'a-2', name: 'Trabalho', provider: 'claude', color: '#4a8fe0' })
    switches = [
      { t: NOW - 3_600_000, agentId: 'ag', sessionId: 's1', cwd: '/p', to: 'main', reason: 'start' },
      { t: NOW - 1_800_000, agentId: 'ag', sessionId: 's1', cwd: '/p', from: 'main', to: 'a-2', reason: 'failover' },
    ]
    writeFileSync(join(projects(), 'a.jsonl'), [line({ id: 'early', t: NOW - 3_000_000 }), line({ id: 'late', t: NOW - 60_000 })].join('\n') + '\n')
    const stats = await reader().refresh()
    const by = Object.fromEntries(stats.buckets.map((b) => [b.accountId, b.totals.messages]))
    expect(by).toEqual({ all: 2, main: 1, 'a-2': 1 })
    expect(stats.buckets.find((b) => b.accountId === 'a-2')!.label).toBe('Trabalho')
  })

  it('pasta de conta com projects/ próprio também é lida; conta removida ganha rótulo', async () => {
    const cfg = mkdtempSync(join(tmpdir(), 'ao-stats-acc-'))
    mkdirSync(join(cfg, 'projects', 'p'), { recursive: true })
    writeFileSync(join(cfg, 'projects', 'p', 'a.jsonl'), line({ id: 'own' }) + '\n')
    accounts.push({ id: 'a-3', name: 'Outra', provider: 'claude', color: '#000000', configDir: cfg })
    const r = reader()
    await r.refresh()
    accounts = accounts.filter((a) => a.id !== 'a-3')
    const stats = await r.current()
    const gone = stats.buckets.find((b) => b.accountId === 'a-3')!
    expect(gone.label).toBe('Conta removida')
    expect(gone.totals.messages).toBe(1)
  })

  it('stats-cache.json do /stats preenche os dias antigos', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'stats-cache.json'),
      JSON.stringify({
        dailyActivity: [
          { date: '2020-01-01', messageCount: 5, sessionCount: 1, toolCallCount: 2 },
          { date: 'lixo', messageCount: 1 },
        ],
        dailyModelTokens: [{ date: '2020-01-01', tokensByModel: { a: 10, b: 5 } }],
      }),
    )
    writeFileSync(join(projects(), 'a.jsonl'), line() + '\n')
    const all = (await reader().refresh()).buckets[0]
    expect(all.days[0]).toEqual({ date: '2020-01-01', messages: 5, sessions: 1, toolCalls: 2, tokens: 15, byModel: {}, costUsd: 0, legacy: true })
    expect(all.days).toHaveLength(2)
  })

  it('stats.json de outra versão é ignorado; refresh em andamento é reaproveitado', async () => {
    writeFileSync(join(data, 'stats.json'), JSON.stringify({ version: 999, days: { all: {} } }))
    const r = reader()
    const events: unknown[] = []
    r.on('stats', (s) => events.push(s))
    const a = r.refresh()
    expect(r.refresh()).toBe(a)
    await a
    expect(events.length).toBeGreaterThanOrEqual(2)
    r.start()
    r.stop()
  })

  it('sem pasta de projetos: tudo zerado, sem erro', async () => {
    rmSync(join(home, '.claude'), { recursive: true, force: true })
    const stats = await reader().refresh()
    expect(stats.error).toBeUndefined()
    expect(stats.buckets[0].totals.messages).toBe(0)
  })
})
