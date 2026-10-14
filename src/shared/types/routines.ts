// Rotinas: tarefas que um agente roda sozinho num horário ("todo dia às 9h, o agente X faz Y").

import type { EffortLevel, OfficePermissionMode } from './agents'

/**
 * When a routine runs, always in the computer's local time.
 * - once: 'AAAA-MM-DDTHH:MM'
 * - daily / weekly: 'HH:MM'; weekly days 0 = domingo … 6 = sábado
 * - interval: every N minutes (15 or more) or hours, counted from `anchor` (ms, set on save)
 * - cron: 5 fields (minuto hora dia mês dia-da-semana)
 */
export type Schedule =
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; days: number[]; time: string }
  | { kind: 'interval'; every: number; unit: 'minutes' | 'hours'; anchor?: number }
  | { kind: 'cron'; expr: string }

/**
 * Who runs it. A saved template or a new agent is hired on the first run and reused
 * while it stays in the office (Routine.agentId); each run starts a fresh conversation.
 * An existing agent gets the task in its current conversation.
 */
export type RoutineWho =
  | { kind: 'new'; name?: string; model?: string; effort?: EffortLevel }
  | { kind: 'template'; templateId: string }
  | { kind: 'agent'; agentId: string }

/** rodando, esperando você, rodou, falhou, perdida (app fechado), pulada (ainda rodando ou agente ocupado). */
export type RoutineRunStatus = 'running' | 'waiting' | 'ok' | 'failed' | 'missed' | 'skipped'

export interface RoutineRun {
  id: string
  /** The slot it belongs to; missing for "Rodar agora". */
  scheduledFor?: number
  startedAt: number
  endedAt?: number
  status: RoutineRunStatus
  /** What the agent spent on this run, from the cost book. */
  costUsd?: number
  agentId?: string
  /** Kept for the history after the agent leaves. */
  agentName?: string
  resultId?: string
  /** What went wrong (failed) or why it did not run (skipped, missed). */
  error?: string
  /** E.g. "Atrasada: o app estava fechado às 09:00". */
  note?: string
  manual?: boolean
}

/** The app was closed (or the Mac asleep) at the time: run once on opening, or skip it. */
export type MissedPolicy = 'run' | 'skip'

export interface Routine {
  id: string
  name: string
  /** The task, as the agent gets it after the routine's header. */
  prompt: string
  who: RoutineWho
  /** Folder it runs in, unless `floor` (ProjectFloor.id) is set. Unused for an existing agent. */
  cwd?: string
  floor?: string
  /** For agents the routine hires; an existing agent keeps its own. */
  permissionMode: OfficePermissionMode
  schedule: Schedule
  enabled: boolean
  missed: MissedPolicy
  createdAt: number
  updatedAt: number
  /** Next run (ms); null while paused or when nothing is left (a past "uma vez"). */
  nextAt: number | null
  /** The agent the routine hired and reuses (template or new agent). */
  agentId?: string
  /** Newest first, at most ROUTINE_LIMITS.history. */
  history: RoutineRun[]
  /** Demo mode: shown, never saved. */
  demo?: boolean
}

/** What the form sends. With `id` it edits that routine; without, it creates one. */
export interface RoutineDraft {
  id?: string
  name: string
  prompt: string
  who: RoutineWho
  cwd?: string
  floor?: string
  permissionMode?: OfficePermissionMode
  schedule: Schedule
  enabled?: boolean
  missed?: MissedPolicy
}

export const ROUTINE_LIMITS = { name: 60, prompt: 20_000, count: 100, history: 20 }

export const RUN_STATUS_LABEL: Record<RoutineRunStatus, string> = {
  running: 'rodando',
  waiting: 'esperando você',
  ok: 'rodou',
  failed: 'falhou',
  missed: 'perdida',
  skipped: 'pulada',
}

/**
 * A job the Mac itself schedules (launchd, ~/Library/LaunchAgents), listed beside the
 * routines. Read only: the office shows it and can start it now, launchd keeps owning it.
 */
export interface MacJob {
  label: string
  /** "mochilinho · agente · manha", from the label. */
  name: string
  /** StartCalendarInterval as cron schedules; empty for an interval job. */
  schedules: Schedule[]
  /** StartInterval, in seconds. */
  everySec?: number
  /** What it runs, as one line. */
  command: string
  /** StandardOutPath (or StandardErrorPath). */
  log?: string
  /** launchd knows it (launchctl list); a plist left unloaded never runs. */
  loaded: boolean
  running: boolean
  /** Exit status of the last run; null before the first one. Negative: killed by that signal. */
  lastExit: number | null
  /** When the log was last written: the closest thing to "last run" launchd keeps. */
  lastLogAt?: number
  nextAt: number | null
}
