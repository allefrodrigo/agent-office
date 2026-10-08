import { existsSync, statSync } from 'node:fs'
import { posix, win32 } from 'node:path'

/**
 * Guards for "open in terminal": the session folder comes from ~/.claude, so it
 * is untrusted. Pure (only node:*) so `node --test` can load it without the SDK.
 */

export const OPEN_THROTTLE_MS = 1500
export const BUSY_MESSAGE = 'Já estou abrindo um terminal.'
export const INVALID_CWD_MESSAGE = 'A pasta dessa sessão é inválida.'
export const NO_CLAUDE_MESSAGE = 'Não encontrei o Claude Code neste computador.'

export type GuardResult = { ok: true; exe?: string } | { ok: false; message: string }
export type IsDir = (path: string) => boolean

const CONTROL = /[\u0000-\u001f\u007f]/

export const isDirOnDisk: IsDir = (p) => existsSync(p) && statSync(p).isDirectory()

/**
 * Absolute, no control characters, an existing folder; on Windows only a .exe
 * runs (a .cmd/.ps1 would need a shell). Checked in this order, so the message
 * names the first problem.
 */
export function checkResumeTarget(cwd: string, platform: NodeJS.Platform, exe: string | undefined, isDir: IsDir = isDirOnDisk): GuardResult {
  const path = platform === 'win32' ? win32 : posix
  if (!path.isAbsolute(cwd) || CONTROL.test(cwd)) return { ok: false, message: INVALID_CWD_MESSAGE }
  if (!isDir(cwd)) return { ok: false, message: `A pasta ${cwd} não existe mais.` }
  if (platform === 'win32' && (!exe || !exe.toLowerCase().endsWith('.exe'))) return { ok: false, message: NO_CLAUDE_MESSAGE }
  return platform === 'win32' ? { ok: true, exe } : { ok: true }
}

/** Returns true and consumes the window when at least `windowMs` passed since the last accepted call. */
export function createThrottle(windowMs: number, now: () => number = Date.now): () => boolean {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < windowMs) return false
    last = t
    return true
  }
}

/**
 * One terminal per click burst: a compromised or stuck renderer cannot open
 * dozens. The throttle runs before any disk access, so an invalid call also
 * consumes the window (limits any burst).
 */
export function createOpenGuard(now: () => number = Date.now, windowMs = OPEN_THROTTLE_MS) {
  const allow = createThrottle(windowMs, now)
  return (cwd: string, platform: NodeJS.Platform, exe: () => string | undefined, isDir: IsDir = isDirOnDisk): GuardResult =>
    allow() ? checkResumeTarget(cwd, platform, platform === 'win32' ? exe() : undefined, isDir) : { ok: false, message: BUSY_MESSAGE }
}
