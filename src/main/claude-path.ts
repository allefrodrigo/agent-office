import { accessSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, join, sep } from 'node:path'

let cached: string | null | undefined

/**
 * Finds the Claude Code executable the office agents run on.
 *
 * Order: $AGENT_OFFICE_CLAUDE, the binary from the SDK's platform package (present
 * in dev; left out of release builds to save ~220 MB), then the user's installed
 * `claude` on PATH or in the usual install folders.
 */
export function findClaude(): string | undefined {
  if (cached !== undefined) return cached ?? undefined
  cached = search() ?? null
  return cached ?? undefined
}

function search(): string | undefined {
  const win = process.platform === 'win32'
  const exe = win ? 'claude.exe' : 'claude'
  const explicit = process.env.AGENT_OFFICE_CLAUDE
  if (explicit && runnable(explicit)) return explicit

  try {
    const bundled = createRequire(import.meta.url)
      .resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${exe}`)
      // executables cannot run from inside the asar archive
      .replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
    if (runnable(bundled)) return bundled
  } catch {
    // not bundled in this build
  }

  const home = homedir()
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(win ? [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'claude'), join(process.env.APPDATA ?? '', 'npm')] : []),
  ]
  for (const dir of dirs) {
    if (!dir) continue
    const candidate = join(dir, exe)
    if (runnable(candidate)) return candidate
  }
  return undefined
}

function runnable(p: string): boolean {
  try {
    if (!existsSync(p)) return false
    if (process.platform !== 'win32') accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}
