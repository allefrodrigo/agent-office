// What crosses the IPC bridge: the full state, the events and window.office.

import type { AccountStatus, PlanUsage } from './accounts'
import type { BgProcess, ToolsView } from './backstage'
import type { AgentBrain, AgentSummary, AgentTemplate, HireRequest, OfficePermissionMode, ResultChanges, SessionEntry, WorktreeFloor } from './agents'
import type { AgentResult, AttachmentInput, LogEntry, PermissionDecision, PermissionRequest } from './conversation'
import type { Ledger, LedgerQuery, LedgerToday } from './ledger'
import type { AppInfo, BridgeStatus, CaffeineMode, QuitWait, Settings, UpdateInstallResult, UpdateStatus } from './settings'
import type { SquadInfo } from './squads'
import type { MacJob, Routine, RoutineDraft } from './routines'
import type { ClaudeStats } from './stats'
import type { DelegateTarget, Ticket, TicketDraft, TicketPatch, TicketStatus } from './tickets'

/** CPU (% of the whole machine) and memory (bytes), as in Activity Monitor. */
export interface SystemStats {
  cpu: number
  memUsed: number
  memTotal: number
  /** This app (the office itself). */
  app: { cpu: number; mem: number }
  /**
   * Claude Code processes: office agents and terminal sessions. On Windows the
   * Claude Desktop app (also claude.exe) is left out. cpu is null until two
   * samples exist, or where it cannot be measured.
   */
  claude: { count: number; cpu: number | null; mem: number }
}

/** How "Open in terminal" opened the session (set only when ok). */
export type TerminalVia = 'terminal-app' | 'windows-terminal' | 'console'

export interface OpenTerminalResult {
  ok: boolean
  /** Error for the user (pt-BR) when ok is false. */
  message?: string
  via?: TerminalVia
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
  /** Today's spend per folder, from the cost book. */
  ledgerToday: LedgerToday
  /** Data files found corrupt at startup (restored from a backup, or started over). */
  dataNotices: DataNotice[]
  /** The Mac (or PC) runs on battery now; the scene may switch to Economia. */
  onBattery: boolean
  /** Background processes of the agents, as last scanned (Bastidores). */
  backstage: BgProcess[]
  /** Scheduled tasks, shown on the routines board of every floor. */
  routines: Routine[]
  /** Jobs the Mac schedules itself (launchd), shown beside the routines. Empty off macOS. */
  macJobs: MacJob[]
  /** The café corner holds the screen awake right now. */
  caffeineAwake: boolean
  /** AGENT_OFFICE_TOUR=1: the guided tour opens even if the player has seen it. */
  forceTour?: boolean
}

/** A data file that did not parse: what happened, for the warning in the renderer. */
export interface DataNotice {
  id: string
  at: number
  /** office.json, tickets.json or tickets-closed.json */
  file: string
  /** restored = a backup loaded; lost = no good copy, started over. */
  kind: 'restored' | 'lost'
  text: string
  /** Where the corrupt file was kept. */
  path: string
}

/** A copy of the data in userData/backups/. */
export interface BackupEntry {
  /** Folder name: AAAA-MM-DD (daily) or antes-<timestamp> (before a restore or import). */
  id: string
  kind: 'daily' | 'snapshot'
  at: number
  /** Bytes, all files together. */
  size: number
  files: string[]
}

export type OfficeEvent =
  | { type: 'agent:upsert'; agent: AgentSummary }
  | { type: 'agent:removed'; agentId: string }
  | { type: 'agent:log'; agentId: string; entry: LogEntry }
  /** New log entries of the agent's subagents, grouped: one event per agent every ~250 ms at most. */
  | { type: 'agent:sublog'; agentId: string; logs: { subId: string; entries: LogEntry[] }[] }
  | { type: 'permission:new'; request: PermissionRequest }
  | { type: 'permission:resolved'; requestId: string; agentId: string }
  | { type: 'result:new'; result: AgentResult }
  | { type: 'result:acked'; resultId: string; agentId: string }
  /** The changed files of a result were worked out, or changed (committed, discarded). */
  | { type: 'result:changes'; resultId: string; agentId: string; changes: ResultChanges }
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
  /** The cost book changed, or a new local day began (then costByCwd starts empty). */
  | { type: 'ledger:today'; today: LedgerToday }
  /** Claude Code statistics were read again from disk. */
  | { type: 'stats'; stats: ClaudeStats }
  /** The player clicked a system notification: open the card of that request or result now. */
  | { type: 'notice:open'; agentId: string; itemId: string }
  /** A data file was found corrupt after startup (the closed tickets load on first use). */
  | { type: 'data:notice'; notice: DataNotice }
  | { type: 'update'; update: UpdateStatus }
  /** The charger was plugged in or pulled out. */
  | { type: 'power'; onBattery: boolean }
  | { type: 'backstage'; processes: BgProcess[] }
  /** A routine changed, ran or finished: the whole list. */
  | { type: 'routines'; routines: Routine[] }
  /** The Mac's own scheduled jobs changed (read every minute). */
  | { type: 'macJobs'; jobs: MacJob[] }
  /** The café corner took or let go of the screen. */
  | { type: 'caffeine'; awake: boolean }
  /** Waiting for the agents before quitting; null = not leaving (any more). */
  | { type: 'quit'; wait: QuitWait | null }

/** window.onerror / unhandledrejection, as the page reports them to the log. */
export interface RendererError {
  kind: 'error' | 'rejection'
  message: string
  source?: string
  stack?: string
}

export interface OfficeAPI {
  getState(): Promise<OfficeState>
  getLog(agentId: string): Promise<LogEntry[]>
  /** The log of one subagent of the agent (running or recently ended); [] when unknown. */
  getSubagentLog(agentId: string, subId: string): Promise<LogEntry[]>
  hire(req: HireRequest): Promise<AgentSummary>
  /** A new agent in this folder with no task yet; it waits for your first message. */
  summon(cwd: string, permissionMode: OfficePermissionMode, brain?: AgentBrain, worktree?: boolean): Promise<AgentSummary>
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
  /**
   * Before dismissing: an agent with a worktree asks (native dialog) whether to keep or
   * remove its copy. 'plain' = no worktree, confirm as usual; 'confirmed' = asked and ok.
   */
  prepareFire(agentId: string): Promise<'plain' | 'confirmed' | 'cancelled'>
  /** Resolves a note for the toast when the agent's worktree was kept or removed. */
  fire(agentId: string): Promise<string | void>
  /** Café corner: keep the screen awake never, while agents work, or always. */
  setCaffeine(mode: CaffeineMode): Promise<void>
  /** "Sair": asks (native dialog), then waits for the agents, interrupts them or stays. */
  quitApp(): Promise<void>
  /** On the "saindo" banner: interrupt whoever is still working and quit now. */
  quitNow(): Promise<void>
  /** On the "saindo" banner: stay. */
  cancelQuit(): Promise<void>
  /** Bastidores → Worktrees: every agent copy, by floor, with size and what removing it would lose. */
  listWorktrees(): Promise<WorktreeFloor[]>
  /** Removes one copy after a native confirmation. Null = cancelled; else a line for the toast. */
  removeWorktreeAt(root: string): Promise<string | null>
  /** Removes every copy with nothing to lose (on one floor, or all), after a native confirmation. */
  cleanWorktrees(floorId?: string): Promise<string | null>
  /** Whether the folder is inside a git repo (the worktree option starts on). */
  isGitRepo(cwd: string): Promise<boolean>
  /** Unified diff of one file listed in a result's changes. */
  resultDiff(resultId: string, path: string): Promise<string>
  /** Opens the result's folder (and a file of it) in Cursor or VS Code. False when neither is installed. */
  openResultInEditor(resultId: string, path?: string): Promise<boolean>
  /** Puts the files back as they were before the task, after a native confirmation. Null = cancelled. */
  discardResult(resultId: string): Promise<ResultChanges | null>
  /** Commits the listed files with this message. */
  commitResult(resultId: string, message: string): Promise<ResultChanges>
  /** Pushes the worktree branch and opens a PR with gh, after a native confirmation. Null = cancelled. */
  openResultPR(resultId: string, title: string): Promise<string | null>
  /** Recent Claude Code sessions (terminal and office) for the resume center. */
  listSessions(): Promise<SessionEntry[]>
  /** Brings a saved session back to the office as an agent. */
  recall(sessionId: string): Promise<AgentSummary>
  /** Opens `claude --resume` for the session in a terminal (macOS Terminal; Windows Terminal or a console window). */
  openInTerminal(sessionId: string): Promise<OpenTerminalResult>
  /** Stops the claude process behind a terminal agent. */
  closeTerminal(agentId: string): Promise<{ ok: boolean; message?: string }>
  respond(decision: PermissionDecision): Promise<void>
  ackResult(resultId: string): Promise<void>
  /** After a plan limit: carry on the same conversation on this account, even outside the agent's pool. */
  continueOn(agentId: string, accountId: string): Promise<void>
  pickFolder(defaultPath?: string): Promise<string | null>
  installBridge(): Promise<BridgeStatus>
  uninstallBridge(): Promise<BridgeStatus>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  /** Creates (unknown id) or replaces a template; returns it as stored. */
  saveTemplate(t: AgentTemplate): Promise<AgentTemplate>
  deleteTemplate(id: string): Promise<void>
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
  /** The cost book, cut to the days and folder asked for (all of it when empty). */
  getLedger(query?: LedgerQuery): Promise<Ledger>
  /** Claude Code statistics as last read from disk (no API call). A stale copy starts a background read. */
  getStats(): Promise<ClaudeStats>
  /** Reads the new bytes of the transcripts now (disk only, no API call). */
  refreshStats(): Promise<ClaudeStats>
  /** Asks where to save (Save dialog) and writes the Markdown there. Resolves the path, or null if cancelled. */
  saveMarkdown(fileName: string, content: string): Promise<string | null>
  /** Puts text on the system clipboard (works even when the page has no focus). */
  copyText(text: string): Promise<void>
  /** Copies in userData/backups, newest first. */
  listBackups(): Promise<BackupEntry[]>
  /** Asks, saves the current state as a backup, puts the backup in place and restarts. Resolves false if the user said no. */
  restoreBackup(id: string): Promise<boolean>
  openBackupsFolder(): Promise<void>
  /** Saves everything in one file the user picks. Resolves its path, or null if cancelled. */
  exportData(): Promise<string | null>
  /** Picks an export, asks, saves the current state as a backup, replaces the data and restarts. */
  importData(): Promise<boolean>
  /** An error the page did not catch, for the app log (main keeps only short strings). */
  reportError(err: RendererError): void
  /** Opens userData/logs in the file manager. */
  openLogs(): Promise<void>
  /** Puts version, OS, Claude Code version and the last 200 log lines on the clipboard. */
  copyDiagnostics(): Promise<void>
  /** Where the auto-update stands. */
  updateStatus(): Promise<UpdateStatus>
  /** Looks for a new release now (Settings → "Verificar agora"). */
  checkForUpdates(): Promise<UpdateStatus>
  /**
   * Saves the data and restarts into the downloaded version. Without `force` it
   * refuses while agents work or permissions wait, and says how many.
   */
  installUpdate(force?: boolean): Promise<UpdateInstallResult>
  listRoutines(): Promise<Routine[]>
  /** Creates (no id) or replaces a routine; throws a message for the form when something is off. */
  saveRoutine(draft: RoutineDraft): Promise<Routine>
  deleteRoutine(id: string): Promise<void>
  /** Pause (false) or resume (true); resuming counts from now. */
  setRoutineEnabled(id: string, enabled: boolean): Promise<Routine>
  /** A paused copy, without history. */
  duplicateRoutine(id: string): Promise<Routine>
  /** One run now, outside the schedule. */
  runRoutineNow(id: string): Promise<Routine>
  /** Reads the Mac's scheduled jobs again. */
  listMacJobs(): Promise<MacJob[]>
  /** Starts a Mac job now (launchctl kickstart); launchd still owns it. */
  runMacJobNow(label: string): Promise<MacJob[]>
  /** The last lines of a Mac job's log. */
  macJobLog(label: string): Promise<string>
  /** Opens a Mac job's log in the default app. */
  openMacJobLog(label: string): Promise<void>
  /** Version, package.json fields and this machine, for the "Sobre" window. */
  appInfo(): Promise<AppInfo>
  /**
   * Hires an agent that downloads the newest release from GitHub and installs it.
   * One at a time: while it is in the office, a new call returns it instead.
   */
  selfUpdate(): Promise<AgentSummary>
  /** Stops a background process (a BgProcess id); an office agent's task stops through its CLI. */
  stopProcess(id: string): Promise<void>
  /** The end of what a background task printed (office agents only). */
  processOutput(id: string): Promise<string>
  /** MCP servers, skills and plugins, with the last 7 days of use. */
  toolsView(): Promise<ToolsView>
  /** Turns an MCP server on or off for every office agent, now and on the next start. */
  toggleMcp(name: string, enabled: boolean): Promise<ToolsView>
  reconnectMcp(name: string): Promise<ToolsView>
  /** Writes enabledPlugins in ~/.claude/settings.json and reloads the running agents. */
  togglePlugin(id: string, enabled: boolean): Promise<ToolsView>
  /** Shows a skill's SKILL.md in the file manager. */
  revealSkill(name: string): Promise<void>
  onEvent(cb: (e: OfficeEvent) => void): () => void
}
