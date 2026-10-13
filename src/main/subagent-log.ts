import type { LogEntry, SubagentInfo } from '@shared/types'
import { describeTool, toolDetail } from '@shared/describe'

/**
 * Live tracking of subagents (AO-46). Pure: no timers of its own, no IPC, no disk,
 * so test/subagent-log.test.ts covers it whole.
 *
 * How the SDK ties things together (sdk.d.ts):
 * - the parent calls the Agent tool: a tool_use block with id X;
 * - task_started / task_progress / task_notification carry task_id (our SubagentInfo.id)
 *   and tool_use_id = X;
 * - every message the subagent produces comes with parent_tool_use_id = X. Without
 *   forwardSubagentText only its tool_use/tool_result blocks come; with it, text too.
 * - task_progress brings usage { total_tokens, tool_uses, duration_ms }, last_tool_name
 *   and, with agentProgressSummaries on, a one-line summary.
 */

/** Entries kept per subagent. */
export const SUB_LOG_LIMIT = 500
/** Ended subagents the agent keeps (list and log) for the panel. */
export const SUB_DONE_KEEP = 20
/** Messages of a subagent seen before its task_started: kept for a few tool_use ids only. */
const ORPHAN_KEYS = 20
const ORPHAN_LIMIT = 50
/** Agent → renderer updates are grouped in windows of this length. */
export const SUB_FLUSH_MS = 250

type Block = { type?: unknown; text?: unknown; name?: unknown; input?: unknown; content?: unknown; is_error?: unknown }

/** What one subagent message adds: log entries, and what it is doing now when that changed. */
export interface SubagentStep {
  entries: LogEntry[]
  activity?: string
  /** Name of the last tool it called in this message. */
  tool?: string
  toolUses: number
}

/**
 * Turns the content of a subagent's assistant or user message into log entries, the same
 * kinds the parent's log uses (text → assistant, tool_use → tool, tool_result → tool_result).
 */
export function subagentStep(role: 'assistant' | 'user', content: unknown, newId: () => string, now = Date.now()): SubagentStep {
  const step: SubagentStep = { entries: [], toolUses: 0 }
  const add = (kind: LogEntry['kind'], text: string, tool?: string, isError?: boolean) => {
    const e: LogEntry = { id: newId(), t: now, kind, text }
    if (tool) e.tool = tool
    if (isError) e.isError = true
    step.entries.push(e)
  }
  if (typeof content === 'string') {
    // A user string is the prompt the parent handed over.
    if (content.trim()) add(role === 'user' ? 'user' : 'assistant', content.slice(0, 4000))
    return step
  }
  if (!Array.isArray(content)) return step
  for (const b of content as Block[]) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      add(role === 'user' ? 'user' : 'assistant', b.text.slice(0, 4000))
    } else if (b.type === 'thinking' && role === 'assistant') {
      step.activity = 'Pensando…'
    } else if (b.type === 'tool_use' && typeof b.name === 'string') {
      const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>
      add('tool', toolDetail(b.name, input) || b.name, b.name)
      step.activity = describeTool(b.name, input)
      step.tool = b.name
      step.toolUses++
    } else if (b.type === 'tool_result') {
      const text = typeof b.content === 'string' ? b.content : asBlocks(b.content).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n')
      if (text.trim()) add('tool_result', text.slice(0, 1200), undefined, b.is_error === true)
    }
  }
  return step
}

/** Appends and drops the oldest entries past `limit`, in place. */
export function pushCapped<T>(list: T[], items: T[], limit: number): T[] {
  list.push(...items)
  if (list.length > limit) list.splice(0, list.length - limit)
  return list
}

/** The running subagent a message belongs to: by its Agent tool_use id, else by task id. */
export function findSubagent(subs: readonly SubagentInfo[] | undefined, parentToolUseId: string): SubagentInfo | undefined {
  if (!subs) return undefined
  return subs.find((x) => x.toolUseId === parentToolUseId) ?? subs.find((x) => x.id === parentToolUseId)
}

/** Applies a step to the subagent's card; true when something the renderer shows changed. */
export function applyStep(sub: SubagentInfo, step: SubagentStep): boolean {
  let changed = false
  if (step.activity && step.activity !== sub.activity) {
    sub.activity = step.activity
    changed = true
  }
  if (step.tool && step.tool !== sub.lastTool) {
    sub.lastTool = step.tool
    changed = true
  }
  if (step.toolUses) {
    sub.toolUses = (sub.toolUses ?? 0) + step.toolUses
    changed = true
  }
  return changed
}

/** Moves a subagent to the ended list, newest last, keeping `keep`; returns the ids dropped off the end. */
export function endSubagent(done: SubagentInfo[], sub: SubagentInfo, keep = SUB_DONE_KEEP): string[] {
  const i = done.findIndex((x) => x.id === sub.id)
  if (i >= 0) done.splice(i, 1)
  done.push(sub)
  return done.length > keep ? done.splice(0, done.length - keep).map((x) => x.id) : []
}

/**
 * The logs of an agent's subagents, plus what is still to be sent. Messages that show up
 * before their task_started wait under their tool_use id and join the log when it starts.
 */
export class SubagentLogs {
  private logs = new Map<string, LogEntry[]>()
  private byToolUse = new Map<string, string>()
  private orphans = new Map<string, LogEntry[]>()
  private pending = new Map<string, LogEntry[]>()

  constructor(private limit = SUB_LOG_LIMIT) {}

  /** A subagent started (task_started). */
  start(subId: string, toolUseId?: string): void {
    if (!this.logs.has(subId)) this.logs.set(subId, [])
    if (!toolUseId) return
    this.byToolUse.set(toolUseId, subId)
    const early = this.orphans.get(toolUseId)
    if (early) {
      this.orphans.delete(toolUseId)
      this.push(subId, early)
    }
  }

  /** Sub id for a parent_tool_use_id; undefined when no started subagent has it. */
  resolve(parentToolUseId: string): string | undefined {
    return this.byToolUse.get(parentToolUseId) ?? (this.logs.has(parentToolUseId) ? parentToolUseId : undefined)
  }

  /** Adds entries of the subagent behind `parentToolUseId`; returns its id, or undefined while it waits for task_started. */
  add(parentToolUseId: string, entries: LogEntry[]): string | undefined {
    const subId = this.resolve(parentToolUseId)
    if (subId) {
      if (entries.length) this.push(subId, entries)
      return subId
    }
    if (!entries.length) return undefined
    let early = this.orphans.get(parentToolUseId)
    if (!early) {
      if (this.orphans.size >= ORPHAN_KEYS) this.orphans.delete(this.orphans.keys().next().value!)
      early = []
      this.orphans.set(parentToolUseId, early)
    }
    pushCapped(early, entries, ORPHAN_LIMIT)
    return undefined
  }

  /** A line the office writes itself (start, end). */
  note(subId: string, entry: LogEntry): void {
    if (this.logs.has(subId)) this.push(subId, [entry])
  }

  /** A whole log at once (session resumed from disk); nothing to send. */
  seed(subId: string, entries: LogEntry[]): void {
    this.logs.set(subId, entries.slice(-this.limit))
  }

  get(subId: string): LogEntry[] {
    return this.logs.get(subId) ?? []
  }

  has(subId: string): boolean {
    return this.logs.has(subId)
  }

  /** Entries not sent yet, grouped by subagent, and clears them. */
  take(): { subId: string; entries: LogEntry[] }[] {
    const out = [...this.pending].map(([subId, entries]) => ({ subId, entries }))
    this.pending.clear()
    return out
  }

  get hasPending(): boolean {
    return this.pending.size > 0
  }

  forget(subId: string): void {
    this.logs.delete(subId)
    this.pending.delete(subId)
    for (const [k, v] of this.byToolUse) if (v === subId) this.byToolUse.delete(k)
  }

  /** Entries held in memory, for the load test. */
  get size(): number {
    let n = 0
    for (const l of this.logs.values()) n += l.length
    for (const l of this.orphans.values()) n += l.length
    return n
  }

  private push(subId: string, entries: LogEntry[]): void {
    pushCapped(this.logs.get(subId)!, entries, this.limit)
    // Within one window only the newest `limit` can matter to the renderer.
    pushCapped(this.pending.get(subId) ?? this.pending.set(subId, []).get(subId)!, entries, this.limit)
  }
}

/**
 * Groups bursts into one call per window: the first mark() arms a timer, later marks in
 * the same window ride along. Timers are injected so tests can drive them.
 */
export class Coalescer {
  private timer: unknown = null

  constructor(
    private flush: () => void,
    private ms = SUB_FLUSH_MS,
    private timers: { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void } = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    },
  ) {}

  mark(): void {
    if (this.timer !== null) return
    this.timer = this.timers.set(() => {
      this.timer = null
      this.flush()
    }, this.ms)
  }

  /** Sends what is waiting right away (a subagent ended: the renderer should see it now). */
  now(): void {
    this.cancel()
    this.flush()
  }

  cancel(): void {
    if (this.timer === null) return
    this.timers.clear(this.timer)
    this.timer = null
  }
}

/**
 * Resume: which subagent transcript (agent-<id>.jsonl) belongs to which Agent tool call.
 * The tool_result of an Agent call ends with "agentId: <id>"; the call itself has the
 * description and the type. Pure over the parent's transcript messages.
 */
export function agentCallsFromTranscript(messages: { type: string; message: unknown; parent_tool_use_id: string | null }[]): Map<string, { toolUseId: string; description: string; type?: string; isError: boolean }> {
  const calls = new Map<string, { description: string; type?: string }>()
  const out = new Map<string, { toolUseId: string; description: string; type?: string; isError: boolean }>()
  for (const m of messages) {
    if (m.parent_tool_use_id) continue
    const content = (m.message as { content?: unknown } | null)?.content
    for (const b of asBlocks(content) as (Block & { id?: unknown; tool_use_id?: unknown })[]) {
      if (b.type === 'tool_use' && (b.name === 'Agent' || b.name === 'Task') && typeof b.id === 'string') {
        const input = (b.input ?? {}) as Record<string, unknown>
        calls.set(b.id, { description: typeof input.description === 'string' ? input.description : 'Ajudante', type: typeof input.subagent_type === 'string' ? input.subagent_type : undefined })
      } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string' && calls.has(b.tool_use_id)) {
        const text = typeof b.content === 'string' ? b.content : asBlocks(b.content).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n')
        const id = /agentId:\s*([\w-]+)/.exec(text)?.[1]
        if (id) out.set(id, { toolUseId: b.tool_use_id, ...calls.get(b.tool_use_id)!, isError: b.is_error === true })
      }
    }
  }
  return out
}

function asBlocks(v: unknown): Block[] {
  return Array.isArray(v) ? (v as Block[]) : []
}
