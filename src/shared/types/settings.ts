// Settings, project floors, the bridge and the auto-update.

import type { VideoSettings } from '../video'
import type { Account } from './accounts'
import type { AgentTemplate, EffortLevel, Look, OfficePermissionMode } from './agents'

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
  /** Subagents (Agent tool) an office agent may run at the same time; 0 = Claude Code's own limit. */
  maxSubagents: number
  /** Most an office agent may spend, in USD, counted from the cost book; 0 = no cap. */
  agentBudgetUsd: number
  /** Most the whole office may spend in a local day, in USD; 0 = no cap. */
  dailyBudgetUsd: number
  /** Delegating a ticket to an agent already here starts a new conversation instead of piling onto the old one. */
  freshTicketSession: boolean
  /** Each squad cycle starts the orchestrator on a new conversation; the squad keeps its memory in files. */
  freshSquadCycle: boolean
  /** A conversation this big (tokens) gets a warning and the advice to clear or compact; 0 = off. */
  contextWarnTokens: number
  /** Ask before a message wakes an agent whose cache went cold with a big conversation. */
  coldConfirm: boolean
  /** Saved hiring templates, global and per floor. Changed only through saveTemplate/deleteTemplate. */
  templates: AgentTemplate[]
  /** Which releases the auto-update follows. Missing = 'stable'. */
  updateChannel?: UpdateChannel
  /** MCP servers turned off in Bastidores: every office agent starts with them off. */
  disabledMcp?: string[]
  /** Configurações → Vídeo: shadows, fps limit, effects, battery saver. */
  video: VideoSettings
  /** Café corner (Copa): keep the screen awake. Missing = 'off'. */
  caffeine?: CaffeineMode
}

/** Café corner: never keep the screen on, only while agents work, or always. */
export type CaffeineMode = 'off' | 'agents' | 'on'

/** The app is waiting for the agents to finish before it quits. */
export interface QuitWait {
  working: number
  pending: number
}

// ---------- auto-update ----------

/** 'beta' also takes pre-releases (tags like v0.4.0-beta.1). */
export type UpdateChannel = 'stable' | 'beta'

export interface UpdateStatus {
  /** disabled = dev build (only the packaged app updates itself). */
  state: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'error'
  /** The new version, while downloading or once ready. */
  version?: string
  /** Download progress, 0-100. */
  percent?: number
  /** What went wrong, for state 'error'. */
  message?: string
  /** Last finished check (ms). */
  checkedAt?: number
}

/** The "Sobre" window (click on the version chip): package.json fields plus this machine. */
export interface AppInfo {
  version: string
  description?: string
  author?: string
  license?: string
  /** Project page, from package.json homepage (or repository). */
  homepage?: string
  /** https://github.com/<owner>/<repo>, where the releases are published. */
  repo?: string
  /** false = running from the source checkout (npm run dev). */
  packaged: boolean
  /** The .app bundle or install folder; the source checkout in dev. */
  location: string
  /** userData: office.json, tickets, logs and backups. */
  dataDir: string
  /** "macOS 26.0 (arm64)". */
  os: string
  platform: string
  arch: string
  electron: string
  chrome: string
  node: string
  /** `claude --version`, or why it could not be read. */
  claude: string
}

/** installUpdate's answer: what keeps the app from restarting right now. */
export interface UpdateInstallResult {
  ok: boolean
  /** Office agents working right now. */
  working?: number
  /** Permission requests still waiting for you. */
  pending?: number
}

/**
 * A floor tied to one project folder. Every agent hired or called there works in
 * that folder, and agents whose folder is inside it (tickets, resumed or terminal
 * sessions) live there too. Its squads come from <cwd>/squads.
 */
export interface ProjectFloor {
  id: string
  /** Shown in the elevator and on the Diretoria sign. */
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
  /** false = new agents here work straight in the project folder, no worktree by default. */
  worktrees?: false
}
