import { EventEmitter } from 'node:events'
import type { ModelUsage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSummary, Ledger, LedgerDay, LedgerModel, LedgerQuery, LedgerSwitch, LedgerToday, LedgerTotals } from '@shared/types'
import type { Store } from './store'

/** Session marks unused this long are forgotten: such an old session is not resumed. */
const MARK_TTL_MS = 120 * 86_400_000
const MAX_SWITCHES = 5000

/**
 * The last cumulative numbers seen for a session. The SDK reports running totals
 * per query() call, and a resumed session starts from the total its transcript saved,
 * so each result counts only what grew since its mark.
 */
export interface SessionMark {
  total: number
  /** Cumulative per model; missing = unknown (mark taken from an old AgentSummary.costUsd). */
  models?: Record<string, LedgerModel>
  t: number
}

/** 'YYYY-MM-DD' in local time. */
export function localDay(t: number = Date.now()): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const inside = (cwd: string, root: string) => {
  const c = norm(cwd)
  const r = norm(root)
  return c === r || c.startsWith(r + '/')
}

const zeroTotals = (): LedgerTotals => ({ costUsd: 0, results: 0, turns: 0, durationMs: 0 })
const zeroModel = (): LedgerModel => ({ costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

function modelMark(u: ModelUsage): LedgerModel {
  return {
    costUsd: u.costUSD || 0,
    inputTokens: u.inputTokens || 0,
    outputTokens: u.outputTokens || 0,
    cacheReadTokens: u.cacheReadInputTokens || 0,
    cacheWriteTokens: u.cacheCreationInputTokens || 0,
  }
}

function addTotals(t: LedgerTotals, cost: number, turns: number, durationMs: number): void {
  t.costUsd += cost
  t.results += 1
  t.turns += turns
  t.durationMs += durationMs
}

/**
 * Livro-caixa: what the office's agents spent, by folder, local day, agent, model
 * and account. Dismissing an agent never takes anything out of it.
 * Emits 'today' (LedgerToday) when today's numbers change or a new day begins.
 */
export class CostBook extends EventEmitter {
  private midnight: NodeJS.Timeout | null = null

  constructor(private store: Store) {
    super()
    const marks = store.ledgerSessions
    for (const [id, m] of Object.entries(marks)) if (Date.now() - (m.t || 0) > MARK_TTL_MS) delete marks[id]
    this.scheduleMidnight()
  }

  private get book(): Ledger {
    return this.store.ledger
  }

  stop(): void {
    if (this.midnight) clearTimeout(this.midnight)
    this.midnight = null
  }

  /** The scoreboards zero at local midnight; the history stays. */
  private scheduleMidnight(): void {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
    this.midnight = setTimeout(() => {
      this.emit('today', this.today())
      this.scheduleMidnight()
    }, next.getTime() - now.getTime())
    this.midnight.unref?.()
  }

  today(): LedgerToday {
    const day = localDay()
    const costByCwd: Record<string, number> = {}
    const agents: LedgerToday['agents'] = {}
    for (const [cwd, days] of Object.entries(this.book.days)) {
      const d = days[day]
      if (!d?.costUsd) continue
      costByCwd[cwd] = d.costUsd
      for (const [id, a] of Object.entries(d.agents)) {
        if (!(a.costUsd > 0)) continue
        const who = (agents[id] ??= { name: this.book.agents[id]?.name ?? 'Agente', cwd, usd: 0 })
        who.usd += a.costUsd
      }
    }
    return { day, costByCwd, agents }
  }

  /**
   * A run is about to start. A brand-new session starts from zero. A resumed one we
   * never saw stays unmarked until markResumed() (or its first result) says where it stood.
   * `knownTotal` is the agent's last costUsd, for agents saved before the book existed.
   */
  begin(sessionId: string, resumed: boolean, knownTotal: number): void {
    const marks = this.store.ledgerSessions
    if (marks[sessionId]) return
    if (!resumed) marks[sessionId] = { total: 0, models: {}, t: Date.now() }
    else if (knownTotal > 0) marks[sessionId] = { total: knownTotal, t: Date.now() }
    else return
    this.store.save()
  }

  isMarked(sessionId: string): boolean {
    return !!this.store.ledgerSessions[sessionId]
  }

  /** Where an unmarked resumed session stood before this run (its saved totals). */
  markResumed(sessionId: string, total: number, models: Record<string, ModelUsage>): void {
    const marks = this.store.ledgerSessions
    if (marks[sessionId]) return
    marks[sessionId] = { total, models: Object.fromEntries(Object.entries(models).map(([k, u]) => [k, modelMark(u)])), t: Date.now() }
    this.store.save()
  }

  /**
   * Books one SDK result and returns the USD it added. Only SDK results come here:
   * the error cards the office makes itself reuse the session total and add nothing.
   */
  record(agent: AgentSummary, sessionId: string, account: string | undefined, r: SDKResultMessage, at = Date.now()): number {
    const marks = this.store.ledgerSessions
    const total = r.total_cost_usd || 0
    const usage = r.modelUsage ?? {}
    const mark = marks[sessionId]
    let cost = 0
    const models: Record<string, LedgerModel> = {}

    if (total > 0) {
      // No mark: a resumed session whose earlier total we could not read. Its first
      // result only sets the mark, so turns spent before the office saw it never count.
      // A total below the mark means the running total was reset (/clear) or the
      // transcript had none saved: count it from zero.
      const base: SessionMark | undefined = !mark ? undefined : total + 1e-9 < mark.total ? { total: 0, models: {}, t: 0 } : mark
      if (base) {
        cost = Math.max(0, total - base.total)
        if (base.models) {
          for (const [name, u] of Object.entries(usage)) {
            const cur = modelMark(u)
            const was = base.models[name] ?? zeroModel()
            const d: LedgerModel = {
              costUsd: Math.max(0, cur.costUsd - was.costUsd),
              inputTokens: Math.max(0, cur.inputTokens - was.inputTokens),
              outputTokens: Math.max(0, cur.outputTokens - was.outputTokens),
              cacheReadTokens: Math.max(0, cur.cacheReadTokens - was.cacheReadTokens),
              cacheWriteTokens: Math.max(0, cur.cacheWriteTokens - was.cacheWriteTokens),
            }
            if (d.costUsd > 0 || d.inputTokens > 0 || d.outputTokens > 0) models[name] = d
          }
        } else if (cost > 0) {
          models[agent.model || 'desconhecido'] = { ...zeroModel(), costUsd: cost }
        }
      }
      marks[sessionId] = { total, models: Object.fromEntries(Object.entries(usage).map(([k, u]) => [k, modelMark(u)])), t: at }
    }
    // Zeroed results (a crash, a startup error) add no cost and keep the mark as it was.

    const turns = r.num_turns || 0
    const durationMs = r.duration_ms || 0
    const accountId = account || 'main'
    const day = this.dayFor(agent.cwd, localDay(at))
    addTotals(day, cost, turns, durationMs)
    const ag = (day.agents[agent.id] ??= { ...zeroTotals(), models: {}, accounts: {} })
    addTotals(ag, cost, turns, durationMs)
    if (cost > 0) ag.accounts[accountId] = (ag.accounts[accountId] ?? 0) + cost
    addTotals((day.accounts[accountId] ??= zeroTotals()), cost, turns, durationMs)
    for (const [name, d] of Object.entries(models)) {
      ag.models[name] = (ag.models[name] ?? 0) + d.costUsd
      const m = (day.models[name] ??= zeroModel())
      m.costUsd += d.costUsd
      m.inputTokens += d.inputTokens
      m.outputTokens += d.outputTokens
      m.cacheReadTokens += d.cacheReadTokens
      m.cacheWriteTokens += d.cacheWriteTokens
    }
    this.remember(agent, at)
    this.store.save()
    this.emit('today', this.today())
    return cost
  }

  /** A run started on an account, or moved to another one mid-session. */
  switched(agent: AgentSummary, sessionId: string, to: string, from: string | undefined, reason: LedgerSwitch['reason']): void {
    const list = this.book.switches
    const last = [...list].reverse().find((s) => s.sessionId === sessionId)
    // A new run on the same account is not news.
    if (reason === 'start' && last?.to === to) return
    list.push({ t: Date.now(), agentId: agent.id, sessionId, cwd: agent.cwd, ...(from ? { from } : {}), to, reason })
    if (list.length > MAX_SWITCHES) list.splice(0, list.length - MAX_SWITCHES)
    this.remember(agent, Date.now())
    this.store.save()
  }

  /** The agent left the office: its entries stay, now marked with when it left. */
  dismissed(agentId: string): void {
    const a = this.book.agents[agentId]
    if (!a) return
    a.dismissedAt = Date.now()
    this.store.save()
  }

  /** A copy of the book cut to the query. */
  query(q: LedgerQuery = {}): Ledger {
    const out: Ledger = { days: {}, agents: {}, switches: [] }
    for (const [cwd, days] of Object.entries(this.book.days)) {
      if (q.cwd && !inside(cwd, q.cwd)) continue
      for (const [day, d] of Object.entries(days)) {
        if ((q.from && day < q.from) || (q.to && day > q.to)) continue
        ;(out.days[cwd] ??= {})[day] = d
        for (const id of Object.keys(d.agents)) if (this.book.agents[id]) out.agents[id] = this.book.agents[id]
      }
    }
    out.switches = this.book.switches.filter((s) => {
      const day = localDay(s.t)
      return (!q.cwd || inside(s.cwd, q.cwd)) && (!q.from || day >= q.from) && (!q.to || day <= q.to)
    })
    return structuredClone(out)
  }

  private dayFor(cwd: string, day: string): LedgerDay {
    const days = (this.book.days[cwd] ??= {})
    return (days[day] ??= { ...zeroTotals(), agents: {}, models: {}, accounts: {} })
  }

  private remember(agent: AgentSummary, at: number): void {
    const known = this.book.agents[agent.id]
    this.book.agents[agent.id] = {
      id: agent.id,
      name: agent.name,
      cwd: agent.cwd,
      look: agent.look,
      ...(agent.role ? { role: agent.role } : {}),
      ...(agent.squad ? { squad: agent.squad } : {}),
      firstAt: known?.firstAt ?? at,
      lastAt: at,
    }
  }
}
