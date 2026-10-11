import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Account, PlanUsage, UsageWindow } from '@shared/types'
import { accountEnv } from './accounts'
import { findClaude } from './claude-path'

const EVERY_MS = 3 * 60 * 1000
/** After a turn ends the numbers move; wait a bit so bursts collapse into one read. */
const AFTER_TURN_MS = 5000

/**
 * Plan limits of every account (5-hour window, week, per-model weeks such as Fable),
 * the same numbers /usage shows. Each read starts a Claude Code process that sends
 * no prompt, so it costs no tokens. Emits 'usage' with PlanUsage[].
 */
export class UsageMonitor extends EventEmitter {
  private last = new Map<string, PlanUsage>()
  private timer?: NodeJS.Timeout
  private soon?: NodeJS.Timeout
  private reading = false

  constructor(private accounts: () => Account[]) {
    super()
  }

  start(): void {
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), EVERY_MS)
  }

  stop(): void {
    clearInterval(this.timer)
    clearTimeout(this.soon)
  }

  current(): PlanUsage[] {
    return this.accounts().map((a) => this.last.get(a.id) ?? { accountId: a.id, windows: [], updatedAt: 0 })
  }

  /** An agent finished a turn: read again shortly. */
  nudge(): void {
    clearTimeout(this.soon)
    this.soon = setTimeout(() => void this.refresh(), AFTER_TURN_MS)
  }

  async refresh(): Promise<PlanUsage[]> {
    if (this.reading) return this.current()
    this.reading = true
    try {
      await Promise.all(
        this.accounts().map(async (a) => {
          try {
            this.last.set(a.id, { accountId: a.id, windows: await read(a), updatedAt: Date.now() })
          } catch (err) {
            // keep the last good numbers on screen, flagged as stale
            const prev = this.last.get(a.id) ?? { accountId: a.id, windows: [], updatedAt: 0 }
            this.last.set(a.id, { ...prev, error: err instanceof Error ? err.message : String(err) })
          }
        }),
      )
    } finally {
      this.reading = false
    }
    const out = this.current()
    this.emit('usage', out)
    return out
  }
}

async function read(account: Account): Promise<UsageWindow[]> {
  const claude = findClaude()
  if (!claude) throw new Error('Claude Code não encontrado.')
  let finish: (r: IteratorResult<SDKUserMessage>) => void = () => undefined
  // A prompt stream that never yields: the process starts and answers control requests only.
  const silent: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise((r) => (finish = r)) }),
  }
  const q = query({
    prompt: silent,
    options: { cwd: homedir(), pathToClaudeCodeExecutable: claude, persistSession: false, env: { ...accountEnv(account), AGENT_OFFICE_MANAGED: '1' } },
  })
  try {
    // Experimental in the SDK: if it goes away, say so instead of crashing.
    const fn = (q as unknown as { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (o: object) => Promise<Usage> })
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
    if (typeof fn !== 'function') throw new Error('Esta versão do SDK não informa os limites do plano.')
    const u = await withTimeout(fn.call(q, { skipBehaviors: true }), 20000)
    if (!u.rate_limits_available || !u.rate_limits) throw new Error('Limites do plano indisponíveis (login por chave de API?).')
    const rl = u.rate_limits
    const out: UsageWindow[] = []
    const add = (key: string, label: string, w?: Window | null) => {
      if (w && typeof w.utilization === 'number') out.push({ key, label, percent: Math.round(w.utilization), resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined })
    }
    add('five_hour', '5h', rl.five_hour)
    add('seven_day', 'Semana', rl.seven_day)
    for (const m of rl.model_scoped ?? []) add(`model:${m.display_name}`, m.display_name, m)
    return out
  } finally {
    finish({ done: true, value: undefined })
    q.close()
  }
}

type Window = { utilization: number | null; resets_at: string | null }
type Usage = {
  rate_limits_available: boolean
  rate_limits: { five_hour?: Window | null; seven_day?: Window | null; model_scoped?: (Window & { display_name: string })[] } | null
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('O Claude Code demorou para responder.')), ms))])
}
