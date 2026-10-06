import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { query, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentResult,
  AgentStatus,
  AgentSummary,
  AskQuestion,
  HireRequest,
  LogEntry,
  OfficeEvent,
  OfficePermissionMode,
  PermissionDecision,
  PermissionRequest,
} from '@shared/types'
import { AGENT_NAMES, describePermission, describeTool, lookFromSeed } from '@shared/describe'
import { findClaude } from './claude-path'
import type { Store } from './store'

const LOG_LIMIT = 400
const PERSISTED_LOG = 150
export const DESK_COUNT = 10

/** Async queue that feeds user messages into a streaming-input query. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(text: string): void {
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w({ value: msg, done: false })
    } else this.items.push(msg)
  }

  close(): void {
    this.closed = true
    this.waiting?.({ value: undefined, done: true })
    this.waiting = null
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      },
    }
  }
}

interface Agent {
  summary: AgentSummary
  log: LogEntry[]
  input?: InputQueue
  query?: Query
  /** Session already exists on disk, so the next start must resume it. */
  started: boolean
}

interface Pending {
  request: PermissionRequest
  resolve: (d: PermissionDecision) => void
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, Agent>()
  private pending = new Map<string, Pending>()
  private results: AgentResult[]

  constructor(private store: Store) {
    super()
    for (const p of store.agents) {
      const summary: AgentSummary = {
        ...p.summary,
        status: p.summary.status === 'done' ? 'done' : 'idle',
        activity: 'Aguardando instruções',
      }
      this.agents.set(summary.id, { summary, log: p.log, started: true })
    }
    this.results = store.results.filter((r) => this.agents.has(r.agentId))
  }

  private send(e: OfficeEvent): void {
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

  // ---------- office agents (Claude Agent SDK) ----------

  hire(req: HireRequest): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: req.name.trim() || 'Agente',
      source: 'office',
      cwd: req.cwd,
      model: req.model || undefined,
      permissionMode: req.permissionMode,
      status: 'starting',
      activity: 'Chegando ao escritório',
      desk: this.freeDesk(),
      look: lookFromSeed(req.name + id),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId: randomUUID(),
    }
    const agent: Agent = { summary, log: [], started: false }
    this.agents.set(id, agent)
    this.upsert(agent)
    this.addLog(agent, 'user', req.task)
    this.run(agent, req.task)
    return summary
  }

  /** An office agent for a saved session; it waits in the lounge until it gets an instruction. */
  recall(sessionId: string, cwd: string, log: LogEntry[], defaults: { model?: string; permissionMode: OfficePermissionMode }): AgentSummary {
    for (const a of this.agents.values()) if (a.summary.sessionId === sessionId) return a.summary
    const used = new Set([...this.agents.values()].map((a) => a.summary.name))
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: AGENT_NAMES.find((n) => !used.has(n)) ?? basename(cwd) ?? 'Agente',
      source: 'office',
      cwd,
      model: defaults.model || undefined,
      permissionMode: defaults.permissionMode,
      status: 'idle',
      activity: 'De volta, esperando instruções',
      desk: this.freeDesk(),
      look: lookFromSeed(sessionId),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId,
    }
    // started = true: the next message resumes the saved conversation.
    const agent: Agent = { summary, log, started: true }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  sendMessage(id: string, text: string): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office') return
    this.addLog(agent, 'user', text)
    // A new instruction replaces any undelivered result.
    this.dropResults(id)
    if (agent.input && agent.query) {
      agent.input.push(text)
      this.setStatus(agent, 'working', 'Lendo suas instruções')
    } else {
      this.run(agent, text)
    }
  }

  async interrupt(id: string): Promise<void> {
    const agent = this.agents.get(id)
    if (!agent?.query) return
    this.cancelAgentRequests(id)
    await agent.query.interrupt().catch(() => undefined)
    this.addLog(agent, 'system', 'Interrompido por você.')
  }

  fire(id: string): void {
    const agent = this.agents.get(id)
    if (!agent) return
    this.cancelAgentRequests(id)
    this.dropResults(id)
    agent.input?.close()
    agent.query?.close()
    this.agents.delete(id)
    this.send({ type: 'agent:removed', agentId: id })
    this.persist()
  }

  shutdown(): void {
    for (const a of this.agents.values()) {
      a.input?.close()
      a.query?.close()
    }
    this.persist()
  }

  private run(agent: Agent, prompt: string): void {
    const s = agent.summary
    const claude = findClaude()
    if (!claude) {
      this.deliver(agent, {
        text:
          'Não encontrei o Claude Code neste computador.\n\n' +
          'Instale com `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux) ou veja https://code.claude.com/docs, ' +
          'faça login rodando `claude` uma vez no terminal e tente de novo.',
        isError: true,
        costUsd: s.costUsd,
        durationMs: 0,
        turns: 0,
      })
      return
    }
    const input = new InputQueue()
    input.push(prompt)
    agent.input = input
    this.setStatus(agent, 'starting', s.status === 'starting' ? s.activity : 'Voltando ao trabalho')

    const q = query({
      prompt: input,
      options: {
        cwd: s.cwd,
        model: s.model,
        pathToClaudeCodeExecutable: claude,
        permissionMode: s.permissionMode,
        allowDangerouslySkipPermissions: s.permissionMode === 'bypassPermissions',
        ...(agent.started ? { resume: s.sessionId } : { sessionId: s.sessionId }),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append:
            `Your name in this office is ${s.name}. Your final message for each task is handed to the user in person as a report: ` +
            'open with the outcome in one or two sentences, then list the key details. Reply in the language the user wrote in.',
        },
        // Lets the terminal bridge ignore hook events coming from office-managed sessions.
        env: { ...process.env, AGENT_OFFICE_MANAGED: '1' },
        canUseTool: (tool, toolInput, opts) => this.askPlayer(agent, tool, toolInput, opts),
        stderr: (data) => {
          if (/error/i.test(data)) this.addLog(agent, 'error', data.trim().slice(0, 500))
        },
      },
    })
    agent.query = q
    agent.started = true
    this.consume(agent, q)
  }

  private async consume(agent: Agent, q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handle(agent, msg)
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      this.addLog(agent, 'error', text)
      if (this.agents.has(agent.summary.id)) {
        this.deliver(agent, { text: `Tive um problema e parei:\n\n${text}`, isError: true, costUsd: agent.summary.costUsd, durationMs: 0, turns: 0 })
      }
    } finally {
      if (agent.query === q) {
        agent.query = undefined
        agent.input = undefined
        if (agent.summary.status === 'working' || agent.summary.status === 'starting') this.setStatus(agent, 'idle', 'Aguardando instruções')
      }
    }
  }

  private handle(agent: Agent, msg: SDKMessage): void {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          agent.summary.model = msg.model
          if (agent.summary.status === 'starting') this.setStatus(agent, 'working', 'Lendo a tarefa')
        } else if (msg.subtype === 'status' && msg.status === 'compacting') {
          this.setStatus(agent, agent.summary.status, 'Organizando a memória')
        }
        return
      case 'assistant': {
        if (msg.parent_tool_use_id) return // subagent chatter
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            this.addLog(agent, 'assistant', block.text)
          } else if (block.type === 'thinking') {
            this.setActivity(agent, 'Pensando…')
          } else if (block.type === 'tool_use') {
            const input = (block.input ?? {}) as Record<string, unknown>
            const line = describeTool(block.name, input)
            this.addLog(agent, 'tool', toolDetail(block.name, input) || line, block.name)
            this.setActivity(agent, line)
          }
        }
        if (agent.summary.status !== 'waiting') this.setStatus(agent, 'working', agent.summary.activity)
        return
      }
      case 'user': {
        if (msg.parent_tool_use_id) return
        const content = msg.message.content
        if (!Array.isArray(content)) return
        for (const block of content) {
          if (block.type !== 'tool_result') continue
          const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => ('text' in c ? c.text : '')).join('\n')
          if (text.trim()) this.addLog(agent, 'tool_result', text.slice(0, 1200), undefined, block.is_error === true)
        }
        return
      }
      case 'result': {
        const isError = msg.subtype !== 'success' || msg.is_error
        const text = msg.subtype === 'success' ? msg.result : msg.errors.join('\n') || `Parei: ${msg.subtype}`
        agent.summary.costUsd = msg.total_cost_usd
        this.deliver(agent, { text, isError, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, turns: msg.num_turns })
        return
      }
      default:
        return
    }
  }

  private askPlayer(
    agent: Agent,
    tool: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; suggestions?: PermissionUpdate[]; decisionReason?: string },
  ): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const id = this.requestDecision(agent.summary.id, permissionFromTool(tool, input, opts.decisionReason, !!opts.suggestions?.length), (d) => {
        if (d.behavior === 'deny') {
          resolve({ behavior: 'deny', message: d.message?.trim() || 'O usuário negou esta ação.' })
        } else if (tool === 'AskUserQuestion') {
          resolve({ behavior: 'allow', updatedInput: { ...input, answers: d.answers ?? {} } })
        } else {
          resolve({
            behavior: 'allow',
            updatedInput: input,
            ...(d.behavior === 'allow_always' && opts.suggestions ? { updatedPermissions: opts.suggestions } : {}),
          })
        }
      })
      opts.signal.addEventListener('abort', () => this.cancelRequest(id, 'Cancelado.'), { once: true })
    })
  }

  // ---------- decisions (shared by office and terminal agents) ----------

  requestDecision(agentId: string, req: Omit<PermissionRequest, 'id' | 'agentId' | 'createdAt'>, onDecision: (d: PermissionDecision) => void): string {
    const agent = this.agents.get(agentId)
    const request: PermissionRequest = { ...req, id: randomUUID(), agentId, createdAt: Date.now() }
    this.pending.set(request.id, { request, resolve: onDecision })
    if (agent) {
      this.setStatus(agent, 'waiting', req.kind === 'question' ? 'Com uma pergunta para você' : req.kind === 'plan' ? 'Com um plano para você' : 'Precisa da sua permissão')
    }
    this.send({ type: 'permission:new', request })
    return request.id
  }

  respond(d: PermissionDecision): void {
    const p = this.pending.get(d.requestId)
    if (!p) return
    this.pending.delete(d.requestId)
    const agent = this.agents.get(p.request.agentId)
    if (agent) {
      const verdict = d.behavior === 'deny' ? 'Negado' : d.behavior === 'allow_always' ? 'Sempre permitido' : 'Permitido'
      const answers = d.answers ? Object.values(d.answers).join(', ') : ''
      this.addLog(agent, 'decision', p.request.kind === 'question' ? `Você respondeu: ${answers}` : `${verdict}: ${p.request.title}${d.message ? ` — ${d.message}` : ''}`)
      if (!this.hasPending(agent.summary.id)) this.setStatus(agent, 'working', 'Voltando ao trabalho')
    }
    this.send({ type: 'permission:resolved', requestId: d.requestId, agentId: p.request.agentId })
    p.resolve(d)
  }

  cancelRequest(requestId: string, message: string): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.pending.delete(requestId)
    this.send({ type: 'permission:resolved', requestId, agentId: p.request.agentId })
    p.resolve({ requestId, behavior: 'deny', message })
    const agent = this.agents.get(p.request.agentId)
    if (agent && agent.summary.status === 'waiting' && !this.hasPending(agent.summary.id)) this.setStatus(agent, 'working', 'Voltando ao trabalho')
  }

  cancelAgentRequests(agentId: string, message = 'Interrompido pelo usuário.'): void {
    for (const [id, p] of this.pending) if (p.request.agentId === agentId) this.cancelRequest(id, message)
  }

  private hasPending(agentId: string): boolean {
    for (const p of this.pending.values()) if (p.request.agentId === agentId) return true
    return false
  }

  ackResult(resultId: string): void {
    const r = this.results.find((x) => x.id === resultId)
    if (!r) return
    this.results = this.results.filter((x) => x.id !== resultId)
    this.store.results = this.results
    this.send({ type: 'result:acked', resultId, agentId: r.agentId })
    const agent = this.agents.get(r.agentId)
    if (agent && (agent.summary.status === 'done' || agent.summary.status === 'error')) {
      if (agent.summary.source === 'terminal' && !agent.query && agent.summary.activity === 'Sessão encerrada') {
        this.removeTerminal(agent.summary.id)
      } else {
        this.setStatus(agent, 'idle', agent.summary.source === 'terminal' ? 'Esperando no terminal' : 'Aguardando instruções')
      }
    }
  }

  private dropResults(agentId: string): void {
    for (const r of this.results.filter((x) => x.agentId === agentId)) {
      this.send({ type: 'result:acked', resultId: r.id, agentId })
    }
    this.results = this.results.filter((x) => x.agentId !== agentId)
    this.store.results = this.results
  }

  private deliver(agent: Agent, r: Omit<AgentResult, 'id' | 'agentId' | 'createdAt'>): void {
    this.dropResults(agent.summary.id)
    const result: AgentResult = { ...r, id: randomUUID(), agentId: agent.summary.id, createdAt: Date.now() }
    this.results.push(result)
    this.store.results = this.results
    this.addLog(agent, 'result', r.text, undefined, r.isError)
    this.setStatus(agent, r.isError ? 'error' : 'done', r.isError ? 'Deu problema' : 'Trazendo o resultado')
    this.send({ type: 'result:new', result })
  }

  // ---------- terminal agents (hook bridge) ----------

  isOfficeSession(sessionId: string): boolean {
    for (const a of this.agents.values()) if (a.summary.source === 'office' && a.summary.sessionId === sessionId) return true
    return false
  }

  findTerminal(sessionId: string): AgentSummary | undefined {
    for (const a of this.agents.values()) if (a.summary.source === 'terminal' && a.summary.sessionId === sessionId) return a.summary
    return undefined
  }

  terminalPrompt(agentId: string, prompt: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    this.dropResults(agentId)
    if (prompt.trim()) this.addLog(agent, 'user', prompt)
    this.setStatus(agent, 'working', 'Lendo seu pedido')
  }

  terminalAgent(sessionId: string, cwd: string): AgentSummary {
    for (const a of this.agents.values()) {
      if (a.summary.source === 'terminal' && a.summary.sessionId === sessionId) return a.summary
    }
    const id = randomUUID()
    const folder = basename(cwd || '') || 'terminal'
    const summary: AgentSummary = {
      id,
      name: folder,
      source: 'terminal',
      cwd,
      permissionMode: 'default',
      status: 'working',
      activity: 'Chegando do terminal',
      desk: this.freeDesk(),
      look: lookFromSeed(sessionId),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId,
    }
    const agent: Agent = { summary, log: [], started: true }
    this.agents.set(id, agent)
    this.upsert(agent)
    this.addLog(agent, 'system', `Sessão do terminal em ${cwd}`)
    return summary
  }

  terminalUpdate(agentId: string, status: AgentStatus | null, activity: string | null, log?: { kind: LogEntry['kind']; text: string; tool?: string }): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (log) this.addLog(agent, log.kind, log.text, log.tool)
    if (agent.summary.status === 'waiting' && status && status !== 'waiting' && this.hasPending(agentId)) status = null
    if (status || activity) this.setStatus(agent, status ?? agent.summary.status, activity ?? agent.summary.activity)
  }

  terminalResult(agentId: string, text: string): void {
    const agent = this.agents.get(agentId)
    if (agent) this.deliver(agent, { text, isError: false, costUsd: 0, durationMs: 0, turns: 0 })
  }

  terminalEnded(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    this.cancelAgentRequests(agentId)
    if (this.results.some((r) => r.agentId === agentId)) {
      agent.summary.activity = 'Sessão encerrada'
      this.upsert(agent)
    } else {
      this.removeTerminal(agentId)
    }
  }

  /** The terminal session was closed from the office: forget it without waiting for acks. */
  terminalKill(agentId: string): void {
    if (!this.agents.has(agentId)) return
    this.cancelAgentRequests(agentId, 'Sessão encerrada pelo Agent Office.')
    this.dropResults(agentId)
    this.removeTerminal(agentId)
  }

  private removeTerminal(agentId: string): void {
    this.agents.delete(agentId)
    this.send({ type: 'agent:removed', agentId })
  }

  // ---------- helpers ----------

  private freeDesk(): number {
    const used = new Set([...this.agents.values()].map((a) => a.summary.desk))
    for (let i = 0; i < 64; i++) if (!used.has(i)) return i
    return used.size
  }

  private setStatus(agent: Agent, status: AgentStatus, activity: string): void {
    if (agent.summary.status === status && agent.summary.activity === activity) return
    agent.summary.status = status
    agent.summary.activity = activity
    this.upsert(agent)
  }

  private setActivity(agent: Agent, activity: string): void {
    if (agent.summary.status === 'waiting') return
    this.setStatus(agent, 'working', activity)
  }

  private upsert(agent: Agent): void {
    this.send({ type: 'agent:upsert', agent: { ...agent.summary } })
    if (agent.summary.source === 'office') this.persist()
  }

  private addLog(agent: Agent, kind: LogEntry['kind'], text: string, tool?: string, isError?: boolean): void {
    const entry: LogEntry = { id: randomUUID(), t: Date.now(), kind, text, tool, isError }
    agent.log.push(entry)
    if (agent.log.length > LOG_LIMIT) agent.log.splice(0, agent.log.length - LOG_LIMIT)
    this.send({ type: 'agent:log', agentId: agent.summary.id, entry })
    if (agent.summary.source === 'office') this.persist()
  }

  private persist(): void {
    this.store.agents = [...this.agents.values()]
      .filter((a) => a.summary.source === 'office')
      .map((a) => ({ summary: a.summary, log: a.log.slice(-PERSISTED_LOG) }))
  }
}

export function toolDetail(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Bash':
      return `$ ${input.command ?? ''}`
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
      return `${tool} ${input.file_path ?? ''}`
    case 'Grep':
      return `Grep "${input.pattern ?? ''}" ${input.path ?? ''}`
    case 'Glob':
      return `Glob ${input.pattern ?? ''}`
    case 'WebFetch':
      return `WebFetch ${input.url ?? ''}`
    case 'WebSearch':
      return `WebSearch "${input.query ?? ''}"`
    default:
      return describeTool(tool, input)
  }
}

export function permissionFromTool(
  tool: string,
  input: Record<string, unknown>,
  reason?: string,
  canAlwaysAllow = false,
): Omit<PermissionRequest, 'id' | 'agentId' | 'createdAt'> {
  if (tool === 'AskUserQuestion') {
    const questions = (Array.isArray(input.questions) ? input.questions : []) as AskQuestion[]
    return { kind: 'question', toolName: tool, title: 'Tenho uma pergunta', detail: '', input, questions, canAlwaysAllow: false }
  }
  if (tool === 'ExitPlanMode') {
    return { kind: 'plan', toolName: tool, title: 'Posso seguir com este plano?', detail: '', input, plan: String(input.plan ?? ''), canAlwaysAllow: false }
  }
  const d = describePermission(tool, input)
  return { kind: 'tool', toolName: tool, title: d.title, detail: d.detail, input, reason, canAlwaysAllow }
}
