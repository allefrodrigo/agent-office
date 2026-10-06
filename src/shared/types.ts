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
}

export type LogKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_result' | 'system' | 'error' | 'result' | 'decision'

export interface LogEntry {
  id: string
  t: number
  kind: LogKind
  text: string
  tool?: string
  isError?: boolean
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

export interface OfficeState {
  agents: AgentSummary[]
  permissions: PermissionRequest[]
  results: AgentResult[]
  bridge: BridgeStatus
  settings: Settings
  platform: string
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

export interface OfficeAPI {
  getState(): Promise<OfficeState>
  getLog(agentId: string): Promise<LogEntry[]>
  hire(req: HireRequest): Promise<AgentSummary>
  send(agentId: string, text: string): Promise<void>
  interrupt(agentId: string): Promise<void>
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
  pickFolder(): Promise<string | null>
  installBridge(): Promise<BridgeStatus>
  uninstallBridge(): Promise<BridgeStatus>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  openExternal(url: string): Promise<void>
  revealPath(path: string): Promise<void>
  onEvent(cb: (e: OfficeEvent) => void): () => void
}
