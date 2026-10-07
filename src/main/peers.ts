import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Claude Code sessions address each other by name ("agents-2d-24") when they use
 * SendMessage. Each running session writes ~/.claude/sessions/<pid>.json with its
 * name and session ID. The format is internal: if it changes, this returns null
 * and the office just skips the animation.
 */
export function sessionIdForName(to: string): string | null {
  const name = to.replace(/\s*\[[^\]]*\]\s*$/, '').trim()
  if (!name) return null
  const dir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'sessions')
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const s = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { name?: unknown; sessionId?: unknown }
        if (s.name === name && typeof s.sessionId === 'string') return s.sessionId
      } catch {
        // half-written or foreign file
      }
    }
  } catch {
    // no sessions folder
  }
  return null
}
