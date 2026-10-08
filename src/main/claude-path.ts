import { accessSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { posix, sep, win32 } from 'node:path'

// Pure helpers here only import node:* so `npm test` runs them without Electron.

/**
 * Wraps a search so only a hit is remembered: `undefined` is searched again on
 * the next call. Separate from findClaude so the cache rule is testable.
 */
export function createFinder(searchFn: () => string | undefined): () => string | undefined {
  let cached: string | undefined
  return () => {
    if (cached) return cached
    cached = searchFn()
    return cached
  }
}

/**
 * Finds the Claude Code executable the office agents run on.
 *
 * Order: $AGENT_OFFICE_CLAUDE, the binary from the SDK's platform package (present
 * in dev; left out of release builds to save ~220 MB), then the user's installed
 * `claude` on PATH or in the usual install folders (see claudeCandidates).
 *
 * Only a hit is remembered: "not found" is searched again on the next call, so
 * installing Claude Code and trying again works without restarting the app.
 * Nothing is executed here, only file existence is checked (I-13).
 */
export const findClaude: () => string | undefined = createFinder(() => search())

/**
 * Ordered places to look for the Claude Code executable. Pure: never runs anything.
 *
 * win32: AGENT_OFFICE_CLAUDE · PATH (PATH or Path) · %USERPROFILE%\.local\bin (native
 * installer) · %USERPROFILE%\.claude\local · npm global
 * (%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin — npm itself only puts
 * claude.cmd/claude.ps1 in %APPDATA%\npm, which need a shell) · the same under
 * %NVM_SYMLINK% · %LOCALAPPDATA%\Microsoft\WinGet\Links · %LOCALAPPDATA%\Programs\claude
 * (legacy). Each folder + 'claude.exe'; unset variables add nothing.
 *
 * darwin/linux: AGENT_OFFICE_CLAUDE · PATH · ~/.local/bin · ~/.claude/local ·
 * /opt/homebrew/bin · /usr/local/bin (each + 'claude').
 *
 * The SDK's bundled binary (dev) is resolved by the caller, right after AGENT_OFFICE_CLAUDE.
 */
export function claudeCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string[] {
  const out: string[] = []
  if (env.AGENT_OFFICE_CLAUDE) out.push(env.AGENT_OFFICE_CLAUDE)

  if (platform === 'win32') {
    const p = win32
    const pkgBin = ['node_modules', '@anthropic-ai', 'claude-code', 'bin']
    const under = (base: string | undefined, ...parts: string[]) => (base ? [p.join(base, ...parts)] : [])
    const dirs = [
      ...(env.PATH ?? env.Path ?? '').split(';').map((d) => d.trim().replace(/^"(.*)"$/, '$1')),
      ...under(home, '.local', 'bin'),
      ...under(home, '.claude', 'local'),
      ...under(env.APPDATA, 'npm', ...pkgBin),
      ...under(env.NVM_SYMLINK, ...pkgBin),
      ...under(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
      ...under(env.LOCALAPPDATA, 'Programs', 'claude'),
    ]
    for (const dir of dirs) if (dir) out.push(p.join(dir, 'claude.exe'))
    return out
  }

  const p = posix
  const dirs = [
    ...(env.PATH ?? '').split(':'),
    p.join(home, '.local', 'bin'),
    p.join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  for (const dir of dirs) if (dir) out.push(p.join(dir, 'claude'))
  return out
}

function search(): string | undefined {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const list = claudeCandidates(process.env, process.platform, homedir())
  const explicit = process.env.AGENT_OFFICE_CLAUDE ? list.shift() : undefined
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

  return list.find(runnable)
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
