import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { type McpSdkServerConfigWithInstance, type PermissionResult, type PermissionUpdate, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentResult, AgentStatus, AgentSummary, AttachmentInfo, LogEntry, OfficeEvent, PermissionDecision, PermissionRequest, SubagentInfo } from '@shared/types'
import { AGENT_NAMES } from '@shared/describe'
import { projectFor } from '@shared/projects'
import { type Accounts } from '../accounts'
import type { CostBook } from '../ledger'
import type { Store } from '../store'
import { SubagentLogs } from '../subagent-log'
import { LOG_LIMIT, PERSISTED_LOG, type Agent, type Pending, type Prompt } from './types'

/**
 * State of the AgentManager, its queries and the bookkeeping helpers. Each part (office,
 * sdk, rotation, subagents, decisions) extends the previous one; AgentManager (index.ts) is the last.
 */
export abstract class AgentBase extends EventEmitter {
  protected agents = new Map<string, Agent>()
  protected pending = new Map<string, Pending>()
  protected results: AgentResult[]
  /** In-process tools every office agent gets (the ticket board), built per agent. */
  officeTools?: (agent: AgentSummary) => McpSdkServerConfigWithInstance
  /** Picks the Claude account of each run; missing = the app's own login. */
  accounts?: Accounts
  /** The cost book: every SDK result is booked there. */
  book?: CostBook
  /**
   * Demo mode: plays office agents' runs instead of starting Claude Code, so hiring and
   * talking can be shown (and tested by keyboard, AO-38) without spending tokens.
   */
  simulate?: (agentId: string, prompt: string) => void

  constructor(protected store: Store) {
    super()
    for (const p of store.agents) {
      const summary: AgentSummary = {
        ...p.summary,
        status: p.summary.status === 'done' ? 'done' : 'idle',
        activity: 'Aguardando instruções',
        subagents: undefined,
        subagentsDone: undefined,
        // Saved before lastTurnAt existed: the last log line is close enough.
        lastTurnAt: p.summary.lastTurnAt ?? p.log.at(-1)?.t,
      }
      const agent: Agent = { summary, log: p.log, started: true }
      this.agents.set(summary.id, agent)
      if (summary.role === 'orchestrator') this.watchSquad(agent)
    }
    this.results = store.results.filter((r) => this.agents.has(r.agentId))
    this.relocate()
  }

  protected send(e: OfficeEvent): void {
    this.emit('event', e)
  }

  // ---------- queries ----------

  list(): AgentSummary[] {
    return [...this.agents.values()].map((a) => a.summary)
  }

  pendingRequests(): PermissionRequest[] {
    return [...this.pending.values()].map((p) => p.request)
  }

  pendingResults(): AgentResult[] {
    return this.results
  }

  getLog(id: string): LogEntry[] {
    return this.agents.get(id)?.log ?? []
  }

  getSubagentLog(agentId: string, subId: string): LogEntry[] {
    return this.agents.get(agentId)?.subs?.get(subId) ?? []
  }

  // ---------- helpers ----------

  protected freeName(fallback = 'Agente'): string {
    const used = new Set([...this.agents.values()].map((a) => a.summary.name))
    return AGENT_NAMES.find((n) => !used.has(n)) ?? fallback
  }

  /**
   * Floor and desk for a new agent in `cwd`: the project floor holding the folder
   * (ground floor when none does) and the first free desk there. Orchestrators take
   * the desks of the Diretoria, everyone else the team desks.
   */
  protected seat(cwd: string, orchestrator = false, except?: Agent): { project?: string; desk: number } {
    const project = projectFor(this.store.settings.projects, cwd)?.id
    const used = new Set(
      [...this.agents.values()]
        .filter((a) => a !== except && a.summary.project === project && (a.summary.role === 'orchestrator') === orchestrator)
        .map((a) => a.summary.desk),
    )
    let desk = 0
    while (used.has(desk)) desk++
    return { project, desk }
  }

  /**
   * Floors changed: agents whose folder now belongs to another floor (or to none)
   * move there and take a free desk. Returns whether anyone moved.
   */
  relocate(): boolean {
    let moved = false
    for (const agent of this.agents.values()) {
      const s = agent.summary
      if (projectFor(this.store.settings.projects, s.cwd)?.id === s.project) continue
      Object.assign(s, this.seat(s.cwd, s.role === 'orchestrator', agent))
      this.upsert(agent)
      moved = true
    }
    return moved
  }

  /** Exact reading, the same numbers /context shows. */
  protected readContext(agent: Agent): void {
    const q = agent.query
    q?.getContextUsage({ detail: 'summary' })
      .then((c) => {
        if (agent.query === q) this.setContext(agent, c.totalTokens, c.rawMaxTokens)
      })
      .catch(() => undefined)
  }

  protected setContext(agent: Agent, used: number, max: number): void {
    if (!(max > 0)) return
    const percent = Math.round((used / max) * 100)
    const prev = agent.summary.context
    if (prev && prev.percent === percent && prev.max === max) return
    agent.summary.context = { used, max, percent }
    this.upsert(agent)
  }

  protected setStatus(agent: Agent, status: AgentStatus, activity: string): void {
    if (agent.summary.status === status && agent.summary.activity === activity) return
    agent.summary.status = status
    agent.summary.activity = activity
    this.upsert(agent)
  }

  protected setActivity(agent: Agent, activity: string): void {
    if (agent.summary.status === 'waiting') return
    this.setStatus(agent, 'working', activity)
  }

  protected upsert(agent: Agent): void {
    this.send({ type: 'agent:upsert', agent: { ...agent.summary } })
    if (agent.summary.source === 'office') this.persist()
  }

  protected addLog(agent: Agent, kind: LogEntry['kind'], text: string, tool?: string, isError?: boolean, attachments?: AttachmentInfo[]): void {
    const entry: LogEntry = { id: randomUUID(), t: Date.now(), kind, text, tool, isError, attachments }
    agent.log.push(entry)
    if (agent.log.length > LOG_LIMIT) agent.log.splice(0, agent.log.length - LOG_LIMIT)
    this.send({ type: 'agent:log', agentId: agent.summary.id, entry })
    if (agent.summary.source === 'office') this.persist()
  }

  protected persist(): void {
    this.store.agents = [...this.agents.values()]
      .filter((a) => a.summary.source === 'office' && !a.demo)
      .map((a) => ({ summary: { ...a.summary, subagentsDone: undefined }, log: a.log.slice(-PERSISTED_LOG) }))
  }

  // ---------- implemented by the later parts ----------
  protected abstract watchSquad(agent: Agent): void
  protected abstract run(agent: Agent, prompt: Prompt): void
  protected abstract failover(agent: Agent, hit: { resetsAt?: number }): boolean
  protected abstract trackSubagents(agent: Agent, msg: Extract<SDKMessage, { type: 'system' }>): void
  protected abstract subLogs(agent: Agent): SubagentLogs
  protected abstract subagentMessage(agent: Agent, parentToolUseId: string, role: 'assistant' | 'user', content: unknown): void
  protected abstract retire(agent: Agent, sub: SubagentInfo, status: NonNullable<SubagentInfo['status']>, line?: string): void
  protected abstract clearSubagents(agent: Agent): void
  protected abstract askPlayer(
    agent: Agent,
    tool: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; suggestions?: PermissionUpdate[]; decisionReason?: string; agentID?: string },
  ): Promise<PermissionResult>
  protected abstract overBudget(agent: Agent): boolean
  protected abstract budgetText(agent: Agent): string
  abstract requestDecision(agentId: string, req: Omit<PermissionRequest, 'id' | 'agentId' | 'createdAt'>, onDecision: (d: PermissionDecision) => void): string
  abstract cancelRequest(requestId: string, message: string): void
  abstract cancelAgentRequests(agentId: string, message?: string): void
  protected abstract dropResults(agentId: string): void
  protected abstract deliver(agent: Agent, r: Omit<AgentResult, 'id' | 'agentId' | 'createdAt'>): void
  protected abstract removeTerminal(agentId: string): void
}
