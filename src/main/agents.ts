import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { basename } from 'node:path'
import { query, type McpSdkServerConfigWithInstance, type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentResult,
  AgentStatus,
  AgentSummary,
  AskQuestion,
  AttachmentInfo,
  AttachmentInput,
  HireRequest,
  LogEntry,
  OfficeEvent,
  OfficePermissionMode,
  PermissionDecision,
  PermissionRequest,
  SquadInfo,
  SquadProgress,
  SubagentInfo,
} from '@shared/types'
import { AGENT_NAMES, describePermission, describeTool, lookFromSeed } from '@shared/describe'
import { buildMessage } from './attachments'
import { findClaude } from './claude-path'
import { sessionIdForName } from './peers'
import { findSquad, memberAgents, orchestratorPrompt, outsideTeam, readProgress, squadDir, teamGuard, type SquadDefinition } from './squads'
import type { Store } from './store'

const LOG_LIMIT = 400
const PERSISTED_LOG = 150
export const DESK_COUNT = 10

/** A plain string, or content blocks when the message carries attachments. */
type Prompt = SDKUserMessage['message']['content']

/** Async queue that feeds user messages into a streaming-input query. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(content: Prompt): void {
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
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
  /** Running /compact: its result is housekeeping, not a report for the player. */
  compacting?: boolean
  /** Orchestrators: the squad, read again from disk before each run. */
  squad?: SquadDefinition
  /** Orchestrators: watches squads/<code>/state.json. */
  watcher?: FSWatcher
  /** Demo mode: simulated, never saved. */
  demo?: boolean
}

interface Pending {
  request: PermissionRequest
  resolve: (d: PermissionDecision) => void
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, Agent>()
  private pending = new Map<string, Pending>()
  private results: AgentResult[]
  /** In-process tools every office agent gets (the ticket board), built per agent. */
  officeTools?: (agent: AgentSummary) => McpSdkServerConfigWithInstance

  constructor(private store: Store) {
    super()
    for (const p of store.agents) {
      const summary: AgentSummary = {
        ...p.summary,
        status: p.summary.status === 'done' ? 'done' : 'idle',
        activity: 'Aguardando instruções',
        subagents: undefined,
      }
      const agent: Agent = { summary, log: p.log, started: true }
      this.agents.set(summary.id, agent)
      if (summary.role === 'orchestrator') this.watchSquad(agent)
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

  /** `display` is what the log shows when the prompt itself is long (a ticket brief). */
  hire(req: HireRequest, display?: string): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: req.name.trim() || this.freeName(),
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
    this.addLog(agent, 'user', display ?? req.task)
    this.run(agent, req.task)
    return summary
  }

  /** An office agent for a saved session; it waits in the lounge until it gets an instruction. */
  recall(sessionId: string, cwd: string, log: LogEntry[], defaults: { model?: string; permissionMode: OfficePermissionMode }): AgentSummary {
    for (const a of this.agents.values()) if (a.summary.sessionId === sessionId) return a.summary
    // started = true: the next message resumes the saved conversation.
    return this.idleAgent(sessionId, cwd, log, true, 'De volta, esperando instruções', defaults)
  }

  /** A new agent with no task yet, like typing `claude` in a folder: it waits for your first message. */
  summon(cwd: string, defaults: { model?: string; permissionMode: OfficePermissionMode }): AgentSummary {
    return this.idleAgent(randomUUID(), cwd, [], false, 'Esperando a primeira instrução', defaults)
  }

  /**
   * An orchestrator for a squad: one Claude Code session that runs the squad's cycle
   * and can only call its own members. It lives on the squad floor.
   */
  runSquad(squad: SquadInfo, task: string, display: string, defaults: { model?: string; permissionMode: OfficePermissionMode }): AgentSummary {
    const same = [...this.agents.values()].find((a) => a.summary.role === 'orchestrator' && a.summary.squad === squad.code && a.summary.cwd === squad.cwd)
    if (same) {
      if (this.busy(same)) throw new Error(`${same.summary.name} já está rodando um ciclo. Espere terminar ou interrompa pelo painel.`)
      same.summary.permissionMode = defaults.permissionMode
      this.sendMessage(same.summary.id, task, display)
      return same.summary
    }
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: squad.name,
      source: 'office',
      cwd: squad.cwd,
      model: defaults.model || undefined,
      permissionMode: defaults.permissionMode,
      status: 'starting',
      activity: 'Subindo para a Diretoria',
      desk: this.freeDirectorDesk(),
      look: lookFromSeed(`orquestrador:${squad.code}`),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId: randomUUID(),
      role: 'orchestrator',
      squad: squad.code,
    }
    const agent: Agent = { summary, log: [], started: false }
    this.agents.set(id, agent)
    this.watchSquad(agent)
    this.upsert(agent)
    this.addLog(agent, 'user', display)
    this.run(agent, task)
    return summary
  }

  /** Demo mode: an orchestrator with no session behind it; demo.ts plays its cycle. */
  demoOrchestrator(squad: SquadDefinition): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: squad.name,
      source: 'office',
      cwd: squad.cwd,
      permissionMode: 'default',
      status: 'working',
      activity: 'Lendo o pipeline',
      desk: this.freeDirectorDesk(),
      look: lookFromSeed(`orquestrador:${squad.code}`),
      costUsd: 0,
      createdAt: Date.now(),
      role: 'orchestrator',
      squad: squad.code,
    }
    const agent: Agent = { summary, log: [], started: true, squad, demo: true }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  /** Demo mode: moves a simulated cycle along. */
  demoStep(agentId: string, step: SquadProgress | undefined, status: AgentStatus, activity: string): void {
    const agent = this.agents.get(agentId)
    if (!agent?.demo) return
    agent.summary.squadStep = step
    agent.summary.status = status
    agent.summary.activity = activity
    this.upsert(agent)
  }

  /** Follows squads/<code>/state.json, which the runner rewrites before every step. */
  private watchSquad(agent: Agent): void {
    const s = agent.summary
    const info = s.squad ? findSquad(s.cwd, s.squad) : undefined
    if (!info) return
    agent.squad = info
    let timer: NodeJS.Timeout | null = null
    const read = () => {
      timer = null
      const step = readProgress(info)
      if (JSON.stringify(step) === JSON.stringify(s.squadStep)) return
      s.squadStep = step
      this.upsert(agent)
    }
    try {
      agent.watcher = watch(squadDir(info), (_e, file) => {
        if (file && file !== 'state.json') return
        if (!timer) timer = setTimeout(read, 250)
      })
      agent.watcher.on('error', () => agent.watcher?.close())
    } catch {
      // folder gone: the step line just stays empty
    }
    read()
  }

  private idleAgent(
    sessionId: string,
    cwd: string,
    log: LogEntry[],
    started: boolean,
    activity: string,
    defaults: { model?: string; permissionMode: OfficePermissionMode },
  ): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: this.freeName(basename(cwd) || 'Agente'),
      source: 'office',
      cwd,
      model: defaults.model || undefined,
      permissionMode: defaults.permissionMode,
      status: 'idle',
      activity,
      desk: this.freeDesk(),
      look: lookFromSeed(sessionId),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId,
    }
    const agent: Agent = { summary, log, started }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  /** Throws, before anything is sent, when an attachment can't go. */
  sendMessage(id: string, text: string, display?: string, attachments: AttachmentInput[] = []): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || agent.demo) return
    const { content, infos } = attachments.length ? buildMessage(text, attachments) : { content: text, infos: [] }
    this.addLog(agent, 'user', display ?? text, undefined, undefined, infos.length ? infos : undefined)
    // A new instruction replaces any undelivered result.
    this.dropResults(id)
    if (agent.input && agent.query) {
      agent.input.push(content)
      this.setStatus(agent, 'working', 'Lendo suas instruções')
    } else {
      this.run(agent, content)
    }
  }

  compact(id: string): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || !agent.started || this.busy(agent)) return
    agent.compacting = true
    this.addLog(agent, 'system', 'Compactando: resumindo a conversa para liberar contexto…')
    this.dropResults(id)
    if (agent.input && agent.query) agent.input.push('/compact')
    else this.run(agent, '/compact')
    this.setStatus(agent, 'working', 'Organizando a memória')
  }

  /** Same agent, brand-new conversation: closes the session and starts the next one from zero. */
  clearContext(id: string): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office') return
    this.cancelAgentRequests(id)
    this.dropResults(id)
    agent.input?.close()
    agent.query?.close()
    agent.input = undefined
    agent.query = undefined
    agent.started = false
    agent.compacting = false
    agent.summary.sessionId = randomUUID()
    agent.summary.context = undefined
    this.addLog(agent, 'system', 'Contexto limpo. A próxima mensagem começa uma conversa nova.')
    this.setStatus(agent, 'idle', 'Memória limpa, esperando instruções')
    this.upsert(agent)
  }

  isBusy(id: string): boolean {
    const agent = this.agents.get(id)
    return !!agent && this.busy(agent)
  }

  private busy(agent: Agent): boolean {
    const st = agent.summary.status
    return st === 'working' || st === 'starting' || st === 'waiting'
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
    agent.watcher?.close()
    this.agents.delete(id)
    this.send({ type: 'agent:removed', agentId: id })
    this.persist()
  }

  shutdown(): void {
    for (const a of this.agents.values()) {
      a.input?.close()
      a.query?.close()
      a.watcher?.close()
    }
    this.persist()
  }

  private run(agent: Agent, prompt: Prompt): void {
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
    // Orchestrators read the squad again, so edits to squad.yaml count from the next run.
    const squad = s.role === 'orchestrator' && s.squad ? findSquad(s.cwd, s.squad) : undefined
    if (s.role === 'orchestrator') {
      if (!squad) {
        this.deliver(agent, { text: `Não achei mais o squad \`${s.squad}\` em ${s.cwd}/squads.`, isError: true, costUsd: s.costUsd, durationMs: 0, turns: 0 })
        return
      }
      agent.squad = squad
      // Squad cycles touch real systems: never without approvals, whatever was saved.
      if (s.permissionMode === 'bypassPermissions') s.permissionMode = 'default'
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
            'open with the outcome in one or two sentences, then list the key details. Reply in the language the user wrote in. ' +
            'The office has a kanban board of tickets (keys like AO-12); use the mcp__office__ tools to read, open, comment on and move tickets when asked or when you are working on one.' +
            (squad ? `\n\n${orchestratorPrompt(squad)}` : ''),
        },
        ...(squad ? { agents: memberAgents(squad), hooks: { PreToolUse: teamGuard(squad) } } : {}),
        ...(this.officeTools ? { mcpServers: { office: this.officeTools(s) } } : {}),
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
        // Subagents live inside the CLI process, so they ended with it.
        this.clearSubagents(agent)
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
        } else if (msg.subtype === 'compact_boundary') {
          const { trigger, pre_tokens, post_tokens } = msg.compact_metadata
          const freed = post_tokens !== undefined ? ` de ${kTokens(pre_tokens)} para ${kTokens(post_tokens)}` : ''
          this.addLog(agent, 'system', `${trigger === 'auto' ? 'O contexto encheu e foi compactado sozinho' : 'Conversa compactada'}${freed}.`)
          if (post_tokens !== undefined && agent.summary.context) this.setContext(agent, post_tokens, agent.summary.context.max)
        } else {
          this.trackSubagents(agent, msg)
        }
        return
      case 'assistant': {
        if (msg.parent_tool_use_id) return // subagent chatter
        // Live estimate between the exact readings taken after each turn.
        const u = msg.message.usage
        if (u && agent.summary.context) {
          this.setContext(agent, u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens, agent.summary.context.max)
        }
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
        this.readContext(agent)
        // The turn is over, so no foreground subagent can still be running (covers an interrupt that lost its notification).
        const bg = agent.summary.subagents?.filter((x) => x.background)
        agent.summary.subagents = bg?.length ? bg : undefined
        if (agent.compacting) {
          agent.compacting = false
          if (isError) this.addLog(agent, 'error', `Não consegui compactar: ${text}`)
          this.setStatus(agent, 'idle', isError ? 'Não conseguiu compactar' : 'Memória organizada, esperando instruções')
          return
        }
        this.deliver(agent, { text, isError, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, turns: msg.num_turns })
        return
      }
      default:
        return
    }
  }

  // ---------- subagents (Agent tool) ----------

  private trackSubagents(agent: Agent, msg: Extract<SDKMessage, { type: 'system' }>): void {
    const subs = agent.summary.subagents ?? []
    switch (msg.subtype) {
      case 'task_started': {
        const isAgent = msg.task_type === 'local_agent' || !!msg.subagent_type
        if (!isAgent || msg.ambient || msg.skip_transcript || subs.some((x) => x.id === msg.task_id)) return
        const sub: SubagentInfo = { id: msg.task_id, description: msg.description, type: msg.subagent_type, startedAt: Date.now(), background: !!msg.is_backgrounded }
        const member = agent.squad?.members.find((m) => m.id === msg.subagent_type)
        if (member) sub.member = member.id
        this.setSubagents(agent, [...subs, sub])
        this.addLog(agent, 'system', member ? `Chamou ${member.icon} ${member.name}: ${sub.description}` : `Chamou um ajudante${sub.type ? ` (${sub.type})` : ''}: ${sub.description}`)
        return
      }
      case 'task_progress': {
        const sub = subs.find((x) => x.id === msg.task_id)
        if (!sub) return
        sub.tokens = msg.usage.total_tokens
        sub.lastTool = msg.last_tool_name
        this.upsert(agent)
        return
      }
      case 'task_updated': {
        const sub = subs.find((x) => x.id === msg.task_id)
        if (sub && msg.patch.is_backgrounded !== undefined) sub.background = msg.patch.is_backgrounded
        return
      }
      case 'task_notification': {
        const sub = subs.find((x) => x.id === msg.task_id)
        if (!sub) return
        this.setSubagents(agent, subs.filter((x) => x !== sub))
        const verb = msg.status === 'completed' ? 'terminou' : msg.status === 'failed' ? 'falhou' : 'foi interrompido'
        const tokens = msg.usage?.total_tokens ?? sub.tokens
        const ms = msg.usage?.duration_ms ?? Date.now() - sub.startedAt
        const stats = [tokens ? `${kTokens(tokens)} tokens` : '', `${(ms / 1000).toFixed(1).replace('.', ',')} s`].filter(Boolean).join(' · ')
        const member = sub.member ? agent.squad?.members.find((m) => m.id === sub.member) : undefined
        this.addLog(agent, msg.status === 'failed' ? 'error' : 'system', `${member ? `${member.icon} ${member.name}` : 'Ajudante'} ${verb}: ${sub.description} (${stats})`, undefined, msg.status === 'failed')
        if (sub.member) {
          const summary = msg.status === 'failed' ? (msg.summary || 'Falhou sem dizer por quê.').slice(0, 200) : undefined
          this.send({ type: 'member:ended', agentId: agent.summary.id, taskId: sub.id, member: sub.member, status: msg.status, summary })
        }
        return
      }
      case 'background_tasks_changed': {
        // Level signal: a background subagent missing here is gone even if its notification was lost.
        const live = new Set(msg.tasks.map((t) => t.task_id))
        const gone = subs.filter((x) => x.background && !live.has(x.id))
        if (gone.length) this.setSubagents(agent, subs.filter((x) => !gone.includes(x)))
        return
      }
      default:
        return
    }
  }

  /** Demo mode: feeds simulated task_* events to any agent. */
  demoTask(agentId: string, msg: Extract<SDKMessage, { type: 'system' }>): void {
    const agent = this.agents.get(agentId)
    if (agent) this.trackSubagents(agent, msg)
  }

  private setSubagents(agent: Agent, subs: SubagentInfo[]): void {
    agent.summary.subagents = subs.length ? subs : undefined
    this.upsert(agent)
  }

  private clearSubagents(agent: Agent): void {
    const subs = agent.summary.subagents
    if (!subs?.length) return
    this.setSubagents(agent, [])
    this.addLog(agent, 'system', subs.length === 1 ? 'O ajudante parou junto com a sessão.' : `${subs.length} ajudantes pararam junto com a sessão.`)
  }

  private askPlayer(
    agent: Agent,
    tool: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; suggestions?: PermissionUpdate[]; decisionReason?: string },
  ): Promise<PermissionResult> {
    // The board is the office's own tool: no need to walk over and ask.
    if (tool.startsWith('mcp__office__')) return Promise.resolve({ behavior: 'allow', updatedInput: input })
    const squad = agent.squad
    if (squad && (tool === 'Agent' || tool === 'Task')) {
      // Handing a step to a member is the orchestrator's job; anyone else is out (the hook already says so).
      const why = outsideTeam(squad, tool, input)
      return Promise.resolve(why ? { behavior: 'deny', message: why } : { behavior: 'allow', updatedInput: input })
    }
    const req = permissionFromTool(tool, input, opts.decisionReason, !!opts.suggestions?.length)
    if (squad) req.context = this.squadContext(agent, squad, tool === 'AskUserQuestion')
    return new Promise((resolve) => {
      const id = this.requestDecision(agent.summary.id, req, (d) => {
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

  /** "Ciclo de Produto · Passo 1 · Foco da semana": read fresh, the watcher may still be debouncing. */
  private squadContext(agent: Agent, squad: SquadDefinition, question: boolean): string {
    const step = readProgress(squad) ?? agent.summary.squadStep
    if (step && JSON.stringify(step) !== JSON.stringify(agent.summary.squadStep)) {
      agent.summary.squadStep = step
      this.upsert(agent)
    }
    if (!step?.current) return squad.name
    const who = !question && step.agent ? squad.members.find((m) => m.id === step.agent) : undefined
    return [squad.name, `Passo ${step.current}${step.total ? `/${step.total}` : ''}`, step.label, who ? `${who.icon} ${who.name}` : ''].filter(Boolean).join(' · ')
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

  /** A terminal session messaged another session (SendMessage): show them talking. */
  terminalChat(fromId: string, input: Record<string, unknown>): void {
    const text = typeof input.message === 'string' ? input.message.split('\n').find((l) => l.trim())?.trim() : undefined
    if (!text || typeof input.to !== 'string') return
    const sessionId = sessionIdForName(input.to)
    const to = sessionId ? this.findTerminal(sessionId) : undefined
    this.send({ type: 'agent:chat', fromId, toId: to && to.id !== fromId ? to.id : null, text: text.slice(0, 140) })
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

  private freeName(fallback = 'Agente'): string {
    const used = new Set([...this.agents.values()].map((a) => a.summary.name))
    return AGENT_NAMES.find((n) => !used.has(n)) ?? fallback
  }

  /** Ground-floor desks; orchestrators sit in the Diretoria upstairs. */
  private freeDesk(): number {
    const used = new Set([...this.agents.values()].filter((a) => a.summary.role !== 'orchestrator').map((a) => a.summary.desk))
    for (let i = 0; i < 64; i++) if (!used.has(i)) return i
    return used.size
  }

  private freeDirectorDesk(): number {
    const used = new Set([...this.agents.values()].filter((a) => a.summary.role === 'orchestrator').map((a) => a.summary.desk))
    for (let i = 0; i < 64; i++) if (!used.has(i)) return i
    return used.size
  }

  /** Exact reading, the same numbers /context shows. */
  private readContext(agent: Agent): void {
    const q = agent.query
    q?.getContextUsage({ detail: 'summary' })
      .then((c) => {
        if (agent.query === q) this.setContext(agent, c.totalTokens, c.rawMaxTokens)
      })
      .catch(() => undefined)
  }

  private setContext(agent: Agent, used: number, max: number): void {
    if (!(max > 0)) return
    const percent = Math.round((used / max) * 100)
    const prev = agent.summary.context
    if (prev && prev.percent === percent && prev.max === max) return
    agent.summary.context = { used, max, percent }
    this.upsert(agent)
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

  private addLog(agent: Agent, kind: LogEntry['kind'], text: string, tool?: string, isError?: boolean, attachments?: AttachmentInfo[]): void {
    const entry: LogEntry = { id: randomUUID(), t: Date.now(), kind, text, tool, isError, attachments }
    agent.log.push(entry)
    if (agent.log.length > LOG_LIMIT) agent.log.splice(0, agent.log.length - LOG_LIMIT)
    this.send({ type: 'agent:log', agentId: agent.summary.id, entry })
    if (agent.summary.source === 'office') this.persist()
  }

  private persist(): void {
    this.store.agents = [...this.agents.values()]
      .filter((a) => a.summary.source === 'office' && !a.demo)
      .map((a) => ({ summary: a.summary, log: a.log.slice(-PERSISTED_LOG) }))
  }
}

function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
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
