import type { Look } from './agents'

// ---------- cost book (livro-caixa) ----------

/** Totals of a slice of the cost book. */
export interface LedgerTotals {
  costUsd: number
  /** Replies the agents finished (SDK results, errors and /compact included). */
  results: number
  /** Model turns of those replies (num_turns of each result). */
  turns: number
  /** Wall time of those replies. */
  durationMs: number
}

/** Spend of one model. Tokens are summed deltas of the SDK's modelUsage. */
export interface LedgerModel {
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One agent on one day in one folder. */
export interface LedgerAgentDay extends LedgerTotals {
  /** model id -> USD */
  models: Record<string, number>
  /** Account.id -> USD */
  accounts: Record<string, number>
}

/** One project folder (an agent's cwd) on one local day. */
export interface LedgerDay extends LedgerTotals {
  /** Agent id -> its share; names live in Ledger.agents. */
  agents: Record<string, LedgerAgentDay>
  /** model id -> spend */
  models: Record<string, LedgerModel>
  /** Account.id the turns ran on -> totals. */
  accounts: Record<string, LedgerTotals>
}

/** Who an agent id of the book was. Kept after the agent is dismissed. */
export interface LedgerAgent {
  id: string
  name: string
  cwd: string
  look?: Look
  role?: 'orchestrator'
  squad?: string
  /** First and last entry, ms. */
  firstAt: number
  lastAt: number
  /** When it left the office; missing = still there. */
  dismissedAt?: number
}

/** A session starting on an account or moving to another one when a plan limit hit. */
export interface LedgerSwitch {
  t: number
  agentId: string
  sessionId: string
  cwd: string
  /** Account.id before; missing on a start. */
  from?: string
  to: string
  reason: 'start' | 'failover'
}

/**
 * The office's own record of spend, kept in office.json. It never shrinks when an
 * agent leaves, and it does not depend on Claude Code transcripts (deleted after a while).
 * Days are local dates, 'YYYY-MM-DD'.
 */
export interface Ledger {
  /** Folder -> day -> totals. */
  days: Record<string, Record<string, LedgerDay>>
  agents: Record<string, LedgerAgent>
  /** Account changes, oldest first (the last few thousand). */
  switches: LedgerSwitch[]
}

/** Days are inclusive 'YYYY-MM-DD'; cwd keeps that folder and the ones inside it. */
export interface LedgerQuery {
  from?: string
  to?: string
  cwd?: string
}

/** What the scoreboards need: today's spend per folder and per agent (dismissed ones included). */
export interface LedgerToday {
  day: string
  costByCwd: Record<string, number>
  /** Agent id -> today's spend, across folders. */
  agents: Record<string, { name: string; cwd: string; usd: number }>
}
