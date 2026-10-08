import { execFile, spawn } from 'node:child_process'
import { win32 } from 'node:path'
import type { OpenTerminalResult } from '@shared/types'

/**
 * "Open in terminal" on Windows (ADR-run-6): a new Windows Terminal tab, or a
 * console window of its own when wt is missing or the folder cannot go through
 * wt's parser. Never through a shell: the folder comes from ~/.claude (untrusted).
 *
 * Only `node:*` and `import type` here, so `node --test` can load this module.
 */

const CONTROL = /[\u0000-\u001f\u007f]/
const WT_TIMEOUT_MS = 5000
export const OPEN_FAILED = 'Não consegui abrir o terminal. Use "Copiar comando".'

/** No ';' (wt's command separator, honored anywhere in its command line) and no control characters. */
export function wtSafe(s: string): boolean {
  return !s.includes(';') && !CONTROL.test(s)
}

/** Arguments for wt.exe: new tab in the most recent window (-w 0), constant title. */
export function wtArgs(cwd: string, exe: string, sessionId: string): string[] {
  return ['-w', '0', 'new-tab', '-d', cwd, '--title', 'Claude Code', exe, '--resume', sessionId]
}

/** The Store alias by absolute path first (a wt.exe planted earlier on PATH loses), then PATH. */
export function wtCandidates(env: NodeJS.ProcessEnv): string[] {
  const local = env.LOCALAPPDATA
  return [...(local ? [win32.join(local, 'Microsoft', 'WindowsApps', 'wt.exe')] : []), 'wt.exe']
}

/**
 * Copy of env without ELECTRON_* and AGENT_OFFICE_*: the session the user opens is
 * theirs, so it must reach the bridge like any terminal session (I-07), and must not
 * run as Node because of ELECTRON_RUN_AS_NODE.
 */
export function terminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    const key = k.toUpperCase() // Windows env names are case-insensitive
    if (key.startsWith('ELECTRON_') || key.startsWith('AGENT_OFFICE_')) continue
    out[k] = v
  }
  return out
}

/** How a launch attempt ended, so the fallback logic can be tested without opening windows. */
export type LaunchOutcome = 'ok' | 'missing' | 'failed'

export interface Launcher {
  /** Runs wt.exe; 'missing' means it could not start (try the next candidate or the console). */
  wt(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<LaunchOutcome>
  /** Starts exe detached in cwd, in a console window of its own. */
  console(exe: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<LaunchOutcome>
}

export const nodeLauncher: Launcher = {
  wt: (file, args, env) =>
    new Promise((resolve) => {
      execFile(file, args, { windowsHide: true, timeout: WT_TIMEOUT_MS, env }, (err) => {
        if (!err) return resolve('ok')
        // A string code (ENOENT, EACCES, UNKNOWN) means wt never started: safe to try elsewhere.
        // An exit code or a timeout means it ran; falling back could open a second terminal.
        resolve(typeof (err as NodeJS.ErrnoException).code === 'string' && !err.killed ? 'missing' : 'failed')
      })
    }),
  console: (exe, args, cwd, env) =>
    new Promise((resolve) => {
      try {
        const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, env })
        child.once('spawn', () => {
          child.unref()
          resolve('ok')
        })
        child.once('error', () => resolve('failed'))
      } catch {
        resolve('failed')
      }
    }),
}

/**
 * Windows only. Preconditions checked by the caller: UUID, absolute existing folder,
 * exe ends in .exe. Windows Terminal when available and wtSafe(cwd) && wtSafe(exe);
 * otherwise a console window of its own (no wt parser involved).
 */
export async function launchOnWindows(
  cwd: string,
  exe: string,
  sessionId: string,
  launcher: Launcher = nodeLauncher,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OpenTerminalResult> {
  const childEnv = terminalEnv(env)
  if (wtSafe(cwd) && wtSafe(exe)) {
    for (const wt of wtCandidates(env)) {
      const r = await launcher.wt(wt, wtArgs(cwd, exe, sessionId), childEnv)
      if (r === 'ok') return { ok: true, via: 'windows-terminal' }
      if (r === 'failed') return { ok: false, message: OPEN_FAILED }
    }
  }
  const r = await launcher.console(exe, ['--resume', sessionId], cwd, childEnv)
  return r === 'ok' ? { ok: true, via: 'console' } : { ok: false, message: OPEN_FAILED }
}
