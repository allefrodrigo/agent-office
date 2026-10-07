// Types shared by the main process, the preload bridge and the renderer.

export type AgentStatus =
  | 'starting' // process spawning
  | 'working' // running tools / thinking
  | 'waiting' // blocked on a decision from the player
  | 'done' // finished a turn, result ready
  | 'idle' // result delivered, waiting for new instructions
  | 'error' // turn ended with an error
  | 'stopped' // process gone (terminal session ended, or app restarted)

/** Where the agent lives: spawned by the office, or a Claude Code session running in a terminal. */
export type AgentSource = 'office' | 'terminal'

export type OfficePermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan' | 'bypassPermissions'

export interface Look {
  skin: string
  hair: string
  hairStyle: number
  shirt: string
  pants: string
  shoes: string
}

export interface AgentSummary {
  id: string
  name: string
  source: AgentSource
  cwd: string
  model?: string
  permissionMode: OfficePermissionMode
  status: AgentStatus
  /** Short present-tense description of what the agent is doing ("Editando app.ts"). */
  activity: string
  desk: number
  look: Look
  costUsd: number
  createdAt: number
  sessionId?: string
  /** How full the conversation is, as in /context. Unknown until the first turn ends. */
  context?: ContextUsage
}

export interface ContextUsage {
  used: number
  max: number
  /** 0-100+ */
  percent: number
}

export type LogKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_result' | 'system' | 'error' | 'result' | 'decision'

export interface LogEntry {
  id: string
  t: number
  kind: LogKind
  text: string
  tool?: string
  isError?: boolean
  /** Files sent with a user message: names only, never the content. */
  attachments?: AttachmentInfo[]
}

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'file'

/** A file sent with a message. Files from disk travel as a path; pasted images as base64. */
export interface AttachmentInput {
  name: string
  /** What the browser claims; the main process checks the bytes instead. */
  mime?: string
  path?: string
  dataBase64?: string
}

export interface AttachmentInfo {
  name: string
  kind: AttachmentKind
  size: number
}

export interface AskQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

export interface PermissionRequest {
  id: string
  agentId: string
  /** tool = approve a tool call; question = AskUserQuestion; plan = ExitPlanMode */
  kind: 'tool' | 'question' | 'plan'
  toolName: string
  title: string
  detail: string
  input: Record<string, unknown>
  questions?: AskQuestion[]
  plan?: string
  reason?: string
  canAlwaysAllow: boolean
  createdAt: number
}

export interface PermissionDecision {
  requestId: string
  behavior: 'allow' | 'allow_always' | 'deny'
  message?: string
  /** For AskUserQuestion: question text -> chosen label(s), comma separated. */
  answers?: Record<string, string>
}

export interface AgentResult {
  id: string
  agentId: string
  text: string
  isError: boolean
  costUsd: number
  durationMs: number
  turns: number
  createdAt: number
}

export interface HireRequest {
  name: string
  cwd: string
  task: string
  model?: string
  permissionMode: OfficePermissionMode
}

/** A Claude Code session saved on this machine, for the resume center. */
export interface SessionEntry {
  sessionId: string
  title: string
  firstPrompt?: string
  cwd?: string
  branch?: string
  lastModified: number
  fileSize?: number
}

export interface BridgeStatus {
  installed: boolean
  listening: boolean
  port: number
  error?: string
}

export interface Settings {
  playerName: string
  playerLook: Look
  pixelSize: number
  defaultModel: string
  defaultPermissionMode: OfficePermissionMode
  notifications: boolean
  bridgePort: number
}

// ---------- tickets (kanban) ----------

export type TicketStatus = 'backlog' | 'todo' | 'doing' | 'review' | 'done'
export type TicketType = 'bug' | 'feature' | 'improvement' | 'task'
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical'

/** Who did something on the board. Agents carry their office id while they are around. */
export interface Actor {
  kind: 'player' | 'agent'
  name: string
  id?: string
}

export interface Criterion {
  text: string
  done: boolean
}

export interface TicketComment {
  id: string
  t: number
  author: Actor
  text: string
}

export interface TicketActivity {
  id: string
  t: number
  actor: Actor
  text: string
}

/**
 * A unit of work an agent can pick up on its own: everything it needs is in the
 * ticket (folder, context, acceptance criteria), so delegating is just handing it over.
 */
export interface Ticket {
  id: string
  /** Short human key, e.g. "AO-12". Agents and people refer to tickets by it. */
  key: string
  title: string
  type: TicketType
  priority: TicketPriority
  status: TicketStatus
  /** Markdown: context, where to look, how to reproduce. */
  description: string
  acceptance: Criterion[]
  /** Project folder the agent works in. */
  cwd?: string
  tags: string[]
  /** Story points. */
  estimate?: number
  /** YYYY-MM-DD */
  dueDate?: string
  reporter: Actor
  assignee?: Actor
  /** Position inside its column, lower first. */
  order: number
  createdAt: number
  updatedAt: number
  comments: TicketComment[]
  activity: TicketActivity[]
}

export interface TicketDraft {
  title: string
  type?: TicketType
  priority?: TicketPriority
  status?: TicketStatus
  description?: string
  acceptance?: Criterion[]
  /** null clears it. */
  cwd?: string | null
  tags?: string[]
  estimate?: number | null
  dueDate?: string | null
}

export type TicketPatch = Partial<TicketDraft>

/** Who takes a ticket: an office agent already here, or a new one hired for it. */
export type DelegateTarget = { agentId: string } | { hire: { model?: string; permissionMode?: OfficePermissionMode } }

/** One plan limit window, as in /usage. */
export interface UsageWindow {
  key: string
  /** "5h", "Semana", or a model bucket such as "Fable". */
  label: string
  percent: number
  resetsAt?: number
}

export interface PlanUsage {
  windows: UsageWindow[]
  updatedAt: number
  /** Last read failed; windows hold the previous numbers. */
  error?: string
}

/** CPU (% of the whole machine) and memory (bytes), as in Activity Monitor. */
export interface SystemStats {
  cpu: number
  memUsed: number
  memTotal: number
  /** This app (the office itself). */
  app: { cpu: number; mem: number }
  /** Every Claude Code process: office agents and terminal sessions. cpu is null where unknown (Windows). */
  claude: { count: number; cpu: number | null; mem: number }
}

export interface OfficeState {
  agents: AgentSummary[]
  permissions: PermissionRequest[]
  results: AgentResult[]
  tickets: Ticket[]
  bridge: BridgeStatus
  settings: Settings
  platform: string
  usage: PlanUsage
  system: SystemStats | null
}

export type OfficeEvent =
  | { type: 'agent:upsert'; agent: AgentSummary }
  | { type: 'agent:removed'; agentId: string }
  | { type: 'agent:log'; agentId: string; entry: LogEntry }
  | { type: 'permission:new'; request: PermissionRequest }
  | { type: 'permission:resolved'; requestId: string; agentId: string }
  | { type: 'result:new'; result: AgentResult }
  | { type: 'result:acked'; resultId: string; agentId: string }
  | { type: 'bridge:status'; status: BridgeStatus }
  | { type: 'settings'; settings: Settings }
  | { type: 'usage'; usage: PlanUsage }
  | { type: 'system'; system: SystemStats }
  /** One session messaged another; toId is null when the recipient is not in the office. */
  | { type: 'agent:chat'; fromId: string; toId: string | null; text: string }
  | { type: 'ticket:upsert'; ticket: Ticket }
  | { type: 'ticket:removed'; ticketId: string }

export interface OfficeAPI {
  getState(): Promise<OfficeState>
  getLog(agentId: string): Promise<LogEntry[]>
  hire(req: HireRequest): Promise<AgentSummary>
  /** A new agent in this folder with no task yet; it waits for your first message. */
  summon(cwd: string, permissionMode: OfficePermissionMode): Promise<AgentSummary>
  send(agentId: string, text: string, attachments?: AttachmentInput[]): Promise<void>
  /** Disk path of a picked or dropped file; '' for pasted data. */
  pathForFile(file: File): string
  interrupt(agentId: string): Promise<void>
  /** Summarizes the conversation so far (/compact) to free up context. */
  compact(agentId: string): Promise<void>
  /** Starts a fresh conversation with the same agent. */
  clearContext(agentId: string): Promise<void>
  /** Reads the plan limits again now. */
  refreshUsage(): Promise<PlanUsage>
  fire(agentId: string): Promise<void>
  /** Recent Claude Code sessions (terminal and office) for the resume center. */
  listSessions(): Promise<SessionEntry[]>
  /** Brings a saved session back to the office as an agent. */
  recall(sessionId: string): Promise<AgentSummary>
  /** Opens a terminal window running `claude --resume` for the session (macOS). */
  openInTerminal(sessionId: string): Promise<{ ok: boolean; message?: string }>
  /** Stops the claude process behind a terminal agent. */
  closeTerminal(agentId: string): Promise<{ ok: boolean; message?: string }>
  respond(decision: PermissionDecision): Promise<void>
  ackResult(resultId: string): Promise<void>
  pickFolder(defaultPath?: string): Promise<string | null>
  installBridge(): Promise<BridgeStatus>
  uninstallBridge(): Promise<BridgeStatus>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  createTicket(draft: TicketDraft): Promise<Ticket>
  updateTicket(ticketId: string, patch: TicketPatch): Promise<Ticket>
  /** Moves a ticket to a column, before `beforeId` (or to the end). */
  moveTicket(ticketId: string, status: TicketStatus, beforeId?: string): Promise<void>
  commentTicket(ticketId: string, text: string): Promise<void>
  deleteTicket(ticketId: string): Promise<void>
  /** 'me' = the player takes it; null = nobody (a ticket in "Fazendo" goes back to "A fazer"). */
  assignTicket(ticketId: string, who: 'me' | null): Promise<void>
  /** Hands the ticket to an agent: it gets the full brief and the ticket moves to "Fazendo". */
  delegateTicket(ticketId: string, target: DelegateTarget): Promise<AgentSummary>
  openExternal(url: string): Promise<void>
  revealPath(path: string): Promise<void>
  onEvent(cb: (e: OfficeEvent) => void): () => void
}
