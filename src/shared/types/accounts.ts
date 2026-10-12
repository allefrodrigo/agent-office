// Claude accounts and their plan limits.

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
