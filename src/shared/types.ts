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

/** How hard the model thinks, as in /effort. Unset = the model's default. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Model and effort picked when an agent is hired or summoned; '' or missing = defaults. */
export interface AgentBrain {
  model?: string
  effort?: EffortLevel
  /** Accounts picked by hand (Account.id; two or more take turns). Missing = the project's accounts. */
  accounts?: string[]
}

/**
 * A Claude login the office can run agents on. The main one is ~/.claude; each
 * other one is a config folder (CLAUDE_CONFIG_DIR) with its own login and links
 * to ~/.claude for skills, settings, sessions and memory.
 */
export interface Account {
  /** 'main' for ~/.claude. */
  id: string
  name: string
  /** Only Claude for now; Codex comes later. */
  provider: 'claude'
  /** Config folder; missing = ~/.claude. */
  configDir?: string
  color: string
}

export interface AccountStatus {
  id: string
  /** null = not checked yet, or the check failed. */
  loggedIn: boolean | null
  email?: string
  /** "max", "pro"… */
  plan?: string
  error?: string
  /** Hit a plan limit; agents skip it until then (ms). */
  limitedUntil?: number
}

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
  effort?: EffortLevel
  /** Account the agent runs on now (Account.id); missing = not started yet, or a terminal session. */
  account?: string
  /** Accounts picked by hand when it was hired; missing = its project's accounts. */
  accounts?: string[]
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
  /** Subagents (Agent tool) running for this agent right now. */
  subagents?: SubagentInfo[]
  /** Project floor the agent works on: its cwd is inside that project's folder. Missing = ground floor. */
  project?: string
  /** Runs a squad cycle in the Diretoria of its project floor instead of working at a desk. */
  role?: 'orchestrator'
  /** Squad code, for orchestrators. */
  squad?: string
  /** Where the cycle is, read from squads/<code>/state.json. */
  squadStep?: SquadProgress
}

export interface SubagentInfo {
  id: string
  description: string
  /** Agent type, e.g. "Explore" or "general-purpose". */
  type?: string
  startedAt: number
  /** Running in the background: only background_tasks_changed reports it ending. */
  background: boolean
  tokens?: number
  lastTool?: string
  /** Squad member id, when an orchestrator called one of its own team. */
  member?: string
}

// ---------- squads (Opensquad) ----------

/** A member of an Opensquad squad, without its prompt. */
export interface SquadMember {
  id: string
  name: string
  icon: string
  title: string
  /** subagent = called with the Agent tool; inline = the orchestrator plays the part in its own conversation. */
  execution: 'subagent' | 'inline'
  /** Sector on the project floor: `setor:` in squad.yaml, or "Equipe". */
  sector: string
}

export interface SquadStep {
  id: string
  name: string
  type: 'agent' | 'checkpoint'
  agent?: string
}

export interface SquadInfo {
  code: string
  name: string
  icon: string
  description: string
  /** Project folder (the one holding squads/). */
  cwd: string
  members: SquadMember[]
  steps: SquadStep[]
}

export interface SquadProgress {
  /** 1-based; 0 before the first step. */
  current: number
  total: number
  /** Step name ("Spec"), or the label the runner wrote. */
  label: string
  /** running, completed, failed… as written by the runner. */
  status: string
  type?: 'agent' | 'checkpoint'
  /** Member id of the current step. */
  agent?: string
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
  /** Where the request comes from, e.g. "Ciclo de Produto · Passo 1 · Foco da semana". */
  context?: string
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
  effort?: EffortLevel
  accounts?: string[]
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
  /** '' = the model's default effort. */
  defaultEffort: EffortLevel | ''
  defaultPermissionMode: OfficePermissionMode
  notifications: boolean
  bridgePort: number
  /** One floor per project, in elevator order (1º andar first). */
  projects: ProjectFloor[]
  /** Claude logins, the main one ('main') first. */
  accounts: Account[]
  /** Accounts for folders outside every project floor; empty = the main one. */
  defaultAccounts: string[]
  /** Tickets in "Feito" close by themselves after this many days; 0 = only by hand. */
  ticketAutoCloseDays: number
}

/**
 * A floor tied to one project folder. Every agent hired or called there works in
 * that folder, and agents whose folder is inside it (tickets, resumed or terminal
 * sessions) live there too. Its squads come from <cwd>/squads.
 */
export interface ProjectFloor {
  id: string
  /** Shown in the elevator and on the lobby sign. */
  name: string
  cwd: string
  /** Accounts its agents run on (Account.id); two or more take turns. Missing or empty = Settings.defaultAccounts. */
  accounts?: string[]
  /** The company's logo as a PNG data URL (re-encoded and capped at 256 px by the settings form). */
  logo?: string
  /** Brand color (#rrggbb): signs and uniforms. Missing = the office orange. */
  brandColor?: string
  /** Its agents wear the company uniform: shirt in the brand color with the logo on the chest. */
  uniform?: boolean
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
  /** When it reached "Feito"; auto-close counts from here. */
  doneAt?: number
  /** Closed: off the board, kept in the archive (userData/tickets-closed.json). */
  closedAt?: number
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
export type DelegateTarget = { agentId: string } | { hire: { model?: string; effort?: EffortLevel; accounts?: string[]; permissionMode?: OfficePermissionMode } }

/** One plan limit window, as in /usage. */
export interface UsageWindow {
  key: string
  /** "5h", "Semana", or a model bucket such as "Fable". */
  label: string
  percent: number
  resetsAt?: number
}

/** Plan limits of one account. */
export interface PlanUsage {
  accountId: string
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
  /** One per account, in Settings.accounts order. */
  usage: PlanUsage[]
  accounts: AccountStatus[]
  system: SystemStats | null
  /** Squads of every project floor; each one's cwd is its project folder. */
  squads: SquadInfo[]
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
  | { type: 'usage'; usage: PlanUsage[] }
  | { type: 'accounts'; accounts: AccountStatus[] }
  | { type: 'system'; system: SystemStats }
  /** One session messaged another; toId is null when the recipient is not in the office. */
  | { type: 'agent:chat'; fromId: string; toId: string | null; text: string }
  | { type: 'ticket:upsert'; ticket: Ticket }
  | { type: 'ticket:removed'; ticketId: string }
  | { type: 'squads'; squads: SquadInfo[] }
  /** A squad member (subagent) finished; failures carry what went wrong. */
  | { type: 'member:ended'; agentId: string; taskId: string; member: string; status: 'completed' | 'failed' | 'stopped'; summary?: string }

export interface OfficeAPI {
  getState(): Promise<OfficeState>
  getLog(agentId: string): Promise<LogEntry[]>
  hire(req: HireRequest): Promise<AgentSummary>
  /** A new agent in this folder with no task yet; it waits for your first message. */
  summon(cwd: string, permissionMode: OfficePermissionMode, brain?: AgentBrain): Promise<AgentSummary>
  send(agentId: string, text: string, attachments?: AttachmentInput[]): Promise<void>
  /** Disk path of a picked or dropped file; '' for pasted data. */
  pathForFile(file: File): string
  interrupt(agentId: string): Promise<void>
  /** Summarizes the conversation so far (/compact) to free up context. */
  compact(agentId: string): Promise<void>
  /** Starts a fresh conversation with the same agent. */
  clearContext(agentId: string): Promise<void>
  /** Reads the plan limits again now. */
  refreshUsage(): Promise<PlanUsage[]>
  /** Checks the login of every account (claude auth status). */
  checkAccounts(): Promise<AccountStatus[]>
  /** A new Claude account: makes its config folder; log in next. */
  addAccount(name: string): Promise<Settings>
  /** Forgets the account. Its config folder stays on disk. */
  removeAccount(id: string): Promise<Settings>
  /** Opens a terminal running `claude auth login` for the account (macOS). */
  loginAccount(id: string): Promise<{ ok: boolean; message?: string }>
  /** Accounts of a project floor, or of everything outside the floors (null). Empty = the default. */
  setAccountPool(floorId: string | null, ids: string[]): Promise<Settings>
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
  /** Closes tickets in "Feito" (all of them when no ids): off the board, into the archive. Resolves how many closed. */
  closeTickets(ticketIds?: string[]): Promise<number>
  /** Closed tickets, newest first, filtered by key, title, description or tag. */
  listClosed(search?: string): Promise<Ticket[]>
  /** Brings a closed ticket back to "A fazer". */
  reopenTicket(ticketId: string): Promise<Ticket>
  /** 'me' = the player takes it; null = nobody (a ticket in "Fazendo" goes back to "A fazer"). */
  assignTicket(ticketId: string, who: 'me' | null): Promise<void>
  /** Hands the ticket to an agent: it gets the full brief and the ticket moves to "Fazendo". */
  delegateTicket(ticketId: string, target: DelegateTarget): Promise<AgentSummary>
  openExternal(url: string): Promise<void>
  revealPath(path: string): Promise<void>
  /** YouTube video ID of the current Claude FM live. */
  radioVideo(): Promise<string>
  /** Squads found in squads/<code>/squad.yaml of a folder; empty when there are none. */
  listSquads(cwd: string): Promise<SquadInfo[]>
  /** An orchestrator that runs one cycle of the squad with its own team only. */
  runSquad(cwd: string, code: string, permissionMode: OfficePermissionMode, note?: string): Promise<AgentSummary>
  onEvent(cb: (e: OfficeEvent) => void): () => void
}
