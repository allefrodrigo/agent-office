// Test helpers of the Chat dos bots: a fake AgentManager and a bot to start from.
import { EventEmitter } from 'node:events'
import {
  BOT_COLORS,
  SENSITIVE_KINDS,
  type AgentResult,
  type AgentSummary,
  type AttachmentInput,
  type Bot,
  type LogEntry,
  type OfficeEvent,
  type PermissionDecision,
  type PermissionRequest,
  type SensitiveKind,
  type WorktreeInfo,
} from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import type { BotHost } from '../../src/main/bots/runner'
import type { BotIdentity, DecisionNote } from '../../src/main/agents/types'

/** Just enough of the AgentManager: bot agents, messages, and the events it sends. */
export class FakeManager extends EventEmitter implements BotHost {
  constructor(private cwd: string) {
    super()
  }

  agents = new Map<string, AgentSummary>()
  busy = new Set<string>()
  sent: { id: string; text: string; display?: string; attachments?: AttachmentInput[] }[] = []
  recalled: { sessionId: string; worktree?: WorktreeInfo }[] = []
  summoned: { cwd: string; worktree?: boolean; as?: BotIdentity }[] = []
  cleared: string[] = []
  configured: { id: string; patch: object }[] = []
  fired: string[] = []
  interrupted: string[] = []
  commands: string[] = []
  pending: PermissionRequest[] = []
  results: AgentResult[] = []
  sensitive = new Map<string, SensitiveKind>()
  /** Agents over their cost cap: sendMessage answers at once with an error. */
  broke = new Set<string>()
  /** Attachments that cannot go: sendMessage throws. */
  failAttachments = false
  private n = 0
  private seq = 0

  add(extra: Partial<AgentSummary> = {}): AgentSummary {
    const a = {
      id: `a${++this.n}`,
      name: 'Agente',
      source: 'office',
      cwd: this.cwd,
      permissionMode: 'default',
      status: 'idle',
      activity: '',
      desk: 0,
      look: lookFromSeed('x'),
      costUsd: 0,
      createdAt: 0,
      sessionId: `s${this.n}`,
      ...extra,
    } as AgentSummary
    this.agents.set(a.id, a)
    this.upsert(a)
    return a
  }
  agent = (id: string) => this.agents.get(id)
  list = () => [...this.agents.values()]
  isBusy = (id: string) => this.busy.has(id)
  recall(sessionId: string, cwd: string, _log: LogEntry[], _d: unknown, worktree?: WorktreeInfo, _h?: unknown, as?: BotIdentity): AgentSummary {
    this.recalled.push({ sessionId, worktree })
    return this.add({ sessionId, cwd, name: as?.name, bot: as?.bot, ...(worktree ? { worktree } : {}) })
  }
  async summon(cwd: string, _d: unknown, worktree?: boolean, as?: BotIdentity): Promise<AgentSummary> {
    this.summoned.push({ cwd, worktree, as })
    await Promise.resolve()
    return this.add({ cwd, name: as?.name, bot: as?.bot })
  }
  demoAgent(name: string, cwd: string, as?: BotIdentity): AgentSummary {
    return this.add({ name, cwd, bot: as?.bot })
  }
  sendMessage(id: string, text: string, display?: string, attachments: AttachmentInput[] = []): void {
    if (this.failAttachments && attachments.length) throw new Error('O arquivo x.bin não pode ir.')
    this.sent.push({ id, text, display, attachments })
    this.log(id, 'user', display ?? text)
    if (this.broke.has(id)) {
      this.result(id, 'Teto de custo do agente atingido.', true)
      return
    }
    this.setBusy(id, 'working', 'Lendo suas instruções')
  }
  async runCommand(id: string, command: string): Promise<void> {
    this.commands.push(command)
    this.log(id, 'user', `! ${command}`)
    await Promise.resolve()
    this.log(id, 'tool', command, 'Bash')
    this.log(id, 'tool_result', 'README.md\nsrc')
  }
  clearContext(id: string): void {
    this.cleared.push(id)
    const a = this.agents.get(id)!
    a.sessionId = `novo-${id}-${this.cleared.length}`
    a.lastTurnAt = undefined
    this.upsert(a)
  }
  configure(id: string, patch: object): void {
    this.configured.push({ id, patch })
  }
  async interrupt(id: string): Promise<void> {
    this.interrupted.push(id)
  }
  fire(id: string): void {
    this.fired.push(id)
    this.agents.delete(id)
    this.busy.delete(id)
    this.emit('event', { type: 'agent:removed', agentId: id } satisfies OfficeEvent)
  }
  pendingRequests = () => this.pending
  pendingResults = () => this.results
  requestSensitive = (id: string) => this.sensitive.get(id)

  // ---------- what the real manager would emit ----------
  log(agentId: string, kind: LogEntry['kind'], text: string, tool?: string, isError?: boolean): void {
    const entry: LogEntry = { id: `e${++this.seq}`, t: Date.now(), kind, text, ...(tool ? { tool } : {}), ...(isError ? { isError } : {}) }
    this.emit('event', { type: 'agent:log', agentId, entry } satisfies OfficeEvent)
  }
  upsert(a: AgentSummary): void {
    this.emit('event', { type: 'agent:upsert', agent: { ...a } } satisfies OfficeEvent)
  }
  setBusy(id: string, status: AgentSummary['status'], activity: string): void {
    const a = this.agents.get(id)!
    a.status = status
    a.activity = activity
    if (status === 'idle') this.busy.delete(id)
    else this.busy.add(id)
    this.upsert(a)
  }
  /** The turn ends: the quiet path of deliver (status first, then the result). */
  result(id: string, text: string, isError = false, spent = 0, quiet = true): AgentResult {
    const a = this.agents.get(id)!
    a.spentUsd = (a.spentUsd ?? 0) + spent
    a.lastTurnAt = Date.now()
    this.setBusy(id, 'idle', 'Respondeu no Chat')
    const result: AgentResult = { id: `r${++this.seq}`, agentId: id, text, isError, costUsd: 0, durationMs: 1200, turns: 1, createdAt: Date.now() }
    if (quiet) this.emit('quietResult', result)
    else this.emit('event', { type: 'result:new', result } satisfies OfficeEvent)
    return result
  }
  ask(agentId: string, extra: Partial<PermissionRequest> = {}, sensitive?: SensitiveKind): PermissionRequest {
    const request = { id: `p${++this.seq}`, agentId, kind: 'tool', toolName: 'Bash', title: 'Rodar git push', detail: 'git push', input: { command: 'git push' }, canAlwaysAllow: true, createdAt: 0, ...extra } as PermissionRequest
    if (sensitive) this.sensitive.set(request.id, sensitive)
    this.pending.push(request)
    this.setBusy(agentId, 'waiting', 'Esperando você')
    this.emit('event', { type: 'permission:new', request } satisfies OfficeEvent)
    return request
  }
  decide(request: PermissionRequest, decision: Omit<PermissionDecision, 'requestId'>, cancelled = false): void {
    this.pending = this.pending.filter((p) => p.id !== request.id)
    this.emit('decision', { request, decision: { requestId: request.id, ...decision }, ...(cancelled ? { cancelled } : {}) } satisfies DecisionNote)
    this.emit('event', { type: 'permission:resolved', requestId: request.id, agentId: request.agentId } satisfies OfficeEvent)
    this.setBusy(request.agentId, 'working', 'Voltando ao trabalho')
  }
}

export const makeBot = (cwd: string, extra: Partial<Bot> = {}): Bot => ({
  id: 'gabi',
  name: 'Gabi',
  tagline: 'Resumo da manhã',
  role: 'Você é o chefe de gabinete do andar.',
  color: BOT_COLORS[0],
  look: lookFromSeed('bot:gabi'),
  floor: 'terreo',
  cwd,
  permissionMode: 'default',
  askBefore: [...SENSITIVE_KINDS],
  apps: 'all',
  worktree: false,
  dailyBudgetUsd: 0,
  pinned: false,
  hidden: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  lastReadAt: 0,
  runs: [],
  ...extra,
})
