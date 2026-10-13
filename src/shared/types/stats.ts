import type { PlanUsage } from './accounts'

// ---------- Claude Code statistics (from the transcripts on disk) ----------

/** Tokens of one model. costUsd is the API-price equivalent; missing = no price for this model. */
export interface ModelTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
  webSearch: number
  /** Model responses (deduplicated API messages). */
  messages: number
  costUsd?: number
}

export interface DayStats {
  /** 'YYYY-MM-DD', local time. */
  date: string
  /** Model responses. */
  messages: number
  sessions: number
  toolCalls: number
  /** Input + output + cache tokens. */
  tokens: number
  byModel: Record<string, ModelTokens>
  costUsd: number
  /** From ~/.claude/stats-cache.json (days before the app started reading): totals only. */
  legacy?: boolean
}

/** One account, the terminal (sessions with no account on record) or everything. */
export interface StatsBucket {
  /** Account.id, 'terminal' or 'all'. */
  accountId: string
  label: string
  color: string
  /** Oldest first; only days with activity. */
  days: DayStats[]
  byModel: Record<string, ModelTokens>
  totals: { sessions: number; messages: number; toolCalls: number; tokens: number; costUsd: number; activeDays: number }
  streak: { current: number; longest: number }
  /** Model responses per local hour. */
  hourCounts: number[]
  longestSession?: { sessionId: string; durationMs: number; messages: number }
}

export interface ClaudeStats {
  generatedAt: number
  /** 'all' first, then one per account with data, then 'terminal'. */
  buckets: StatsBucket[]
  /** UsageMonitor's last numbers, from memory. */
  plan: PlanUsage[]
  /** Models with no price in the local table: tokens only. */
  unpricedModels: string[]
  /** First day read from the transcripts; older days come from stats-cache.json. */
  since?: string
  /** A read is running in the background. */
  reading: boolean
  /** Last read's numbers: files, bytes, time. */
  lastRead?: { at: number; files: number; bytes: number; ms: number }
  error?: string
}
