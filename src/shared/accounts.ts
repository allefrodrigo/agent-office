import { projectFor } from './projects'
import type { Settings } from './types'

/** The login in ~/.claude. */
export const MAIN_ACCOUNT = 'main'
export const ACCOUNT_COLORS = ['#e0894a', '#4a8fe0', '#5cbf7a', '#c46ad8', '#e0c24a', '#e05a6a']

/**
 * Accounts an agent may run on: the ones picked by hand, else its project floor's,
 * else the default ones, else the main login. Ids of removed accounts are skipped.
 */
export function accountPool(settings: Pick<Settings, 'accounts' | 'projects' | 'defaultAccounts'>, cwd: string | undefined, picked?: string[]): string[] {
  for (const ids of [picked, projectFor(settings.projects, cwd)?.accounts, settings.defaultAccounts]) {
    const known = (ids ?? []).filter((id) => settings.accounts.some((a) => a.id === id))
    if (known.length) return known
  }
  return [MAIN_ACCOUNT]
}
