// Agents: status, looks, brains, worktrees, subagents, hiring and saved sessions.

import type { SquadProgress } from './squads'

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
  /** Running total of the current Claude Code session, as the SDK reports it (a resumed session includes earlier turns). */
  costUsd: number
  /** What this agent spent while in the office: the sum of its entries in the cost book. Missing = nothing yet. */
  spentUsd?: number
  createdAt: number
  sessionId?: string
  /** How full the conversation is, as in /context. Unknown until the first turn ends. */
  context?: ContextUsage
  /** Subagents (Agent tool) running for this agent right now. */
  subagents?: SubagentInfo[]
  /** Subagents that already ended, newest last (a few, with their logs kept in memory). */
  subagentsDone?: SubagentInfo[]
  /** Project floor the agent works on: its cwd is inside that project's folder. Missing = ground floor. */
  project?: string
  /** Runs a squad cycle in the Diretoria of its project floor instead of working at a desk. */
  role?: 'orchestrator'
  /** Squad code, for orchestrators. */
  squad?: string
  /** Where the cycle is, read from squads/<code>/state.json. */
  squadStep?: SquadProgress
  /**
   * Works in its own git worktree instead of `cwd`. `cwd` stays the project folder, so
   * the floor, the cost book and the tickets keep counting it there.
   */
  worktree?: WorktreeInfo
}

/** An agent's isolated copy of the repo: `git worktree` on its own branch. */
export interface WorktreeInfo {
  /** Where the agent runs (the worktree, or the same subfolder inside it). */
  path: string
  /** Top folder of the worktree: <repo>/.agent-office/worktrees/<slug>. */
  root: string
  /** Top folder of the original repo. */
  repo: string
  /** agent/<name>-<id> */
  branch: string
  /** Commit the branch started from. */
  base: string
}

/** One file a task changed, as the result card lists it. */
export interface ChangedFile {
  /** Relative to ResultChanges.root (absolute when it was written outside it, without git). */
  path: string
  status: 'added' | 'modified' | 'deleted'
  added?: number
  removed?: number
  binary?: boolean
  /** Content at the start of the task: a blob id, null = did not exist. Missing = as in HEAD at the start. */
  start?: string | null
  /**
   * Index entry at the start ("<mode> <blob>"), null = not in the index, 'unknown' = could
   * not be read. Only for preexisting files: "Descartar" puts the index back too.
   */
  startIndex?: string | null
  /** It already had changes before the task: the diff is against that version. */
  preexisting?: boolean
  /** "Descartar" can put it back. */
  restorable?: boolean
  /** Without git: the tool that wrote it (Edit, Write…). */
  tool?: string
}

/** What a task changed in the folder. Without git, only what the Edit/Write tools touched. */
export interface ResultChanges {
  git: boolean
  /** Repo (or worktree) top folder; the agent's folder without git. */
  root: string
  /** HEAD when the task started. */
  head?: string
  files: ChangedFile[]
  /** More files than the card shows; `total` has the real count. */
  truncated?: boolean
  total?: number
  /** Agent works in a worktree on this branch: "Abrir PR" is available. */
  branch?: string
  /** Committed from the card: short sha. */
  committed?: string
  /** Undone from the card. */
  discarded?: boolean
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
  /** The Agent tool_use that started it: its messages carry this id as parent_tool_use_id. */
  toolUseId?: string
  /** Present-tense line of what it is doing now ("Editando git.ts"), from its own messages. */
  activity?: string
  /** Tool calls so far. */
  toolUses?: number
  /** One-line progress summary, when the SDK sends one in task_progress. */
  summary?: string
  /** Workflow tool run (task_type local_workflow) instead of an Agent tool subagent. */
  workflow?: boolean
  /** Missing while it runs. */
  status?: 'completed' | 'failed' | 'stopped'
  endedAt?: number
}

export interface ContextUsage {
  used: number
  max: number
  /** 0-100+ */
  percent: number
}

export interface HireRequest {
  name: string
  cwd: string
  task: string
  model?: string
  effort?: EffortLevel
  accounts?: string[]
  permissionMode: OfficePermissionMode
  /** Work in an isolated copy (git worktree). Missing = yes when the folder is a git repo. */
  worktree?: boolean
  /** Looks picked in a saved template; missing = drawn from the name. */
  look?: Look
}

/**
 * A saved way of hiring (aba "Modelos" do Novo agente): one click fills the name,
 * looks, brain, freedom and the starting brief. Kept in Settings.templates.
 */
export interface AgentTemplate {
  id: string
  name: string
  /** Missing = drawn from the name, like any hire. */
  look?: Look
  /** '' or missing = Claude Code's default. */
  model?: string
  effort?: EffortLevel
  permissionMode: OfficePermissionMode
  /** Starting brief; {pasta} becomes the folder and {ticket} the chosen ticket. Empty = asks for the task. */
  instruction: string
  /** ProjectFloor.id it belongs to; missing = every floor. */
  floor?: string
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
