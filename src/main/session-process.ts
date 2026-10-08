import { execFile } from 'node:child_process'
import { isClaudeImage, parseTasklistCsv, queryClaudeProcesses, sameClaudeProcess } from './win-processes'

/**
 * Helpers to find and stop the `claude` process behind a terminal session.
 *
 * Hook events carry no PID, but each one arrives over a TCP connection opened by
 * the claude process itself. While that connection is open, its client port maps
 * to the owning process (lsof on macOS/Linux, netstat on Windows).
 */

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000, windowsHide: true }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout)))
  })

/** PID of the process on the client end of a connection to our server, or null. */
export async function pidForClientPort(clientPort: number, serverPort: number): Promise<number | null> {
  if (process.platform === 'win32') {
    const out = await run('netstat', ['-ano', '-p', 'TCP'])
    for (const line of out.split(/\r?\n/)) {
      const [proto, local, remote, , pid] = line.trim().split(/\s+/)
      if (proto === 'TCP' && local?.endsWith(`:${clientPort}`) && remote?.endsWith(`:${serverPort}`)) {
        const n = Number(pid)
        if (!Number.isSafeInteger(n) || n <= 0) return null
        void rememberIdentity(n) // not awaited: the hook is dispatched right away
        return n
      }
    }
    return null
  }
  // -Fp prints one "p<pid>" line per process; our own server end shows up too.
  const out = await run('lsof', ['-nP', `-iTCP:${clientPort}`, '-sTCP:ESTABLISHED', '-Fp'])
  for (const line of out.split('\n')) {
    const pid = Number(line.slice(1))
    if (line.startsWith('p') && pid > 1 && pid !== process.pid) return pid
  }
  return null
}

// Windows: creation time of each terminal-session PID when the office learned it
// (pid → FILETIME). A different creation time later means the PID was reused.
const identities = new Map<number, string>()
const MAX_IDENTITIES = 256

/**
 * Windows only (no-op elsewhere): records the creation time of a terminal session's
 * process, so isClaudeProcess() can tell it from a later process with the same PID.
 */
export async function rememberIdentity(pid: number): Promise<void> {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return
  const row = (await queryClaudeProcesses(pid))?.find((r) => r.pid === pid)
  if (!row?.created || !sameClaudeProcess(row, undefined)) return
  identities.delete(pid)
  identities.set(pid, row.created)
  if (identities.size > MAX_IDENTITIES) identities.delete(identities.keys().next().value!)
}

/**
 * True if the PID is still the Claude Code process of a terminal session (guards
 * against PID reuse). macOS/Linux: `ps` command contains "claude". Windows: exact
 * image name claude.exe, not the Claude Desktop app and, when known, the creation
 * time recorded by rememberIdentity(); without PowerShell, exact name via tasklist.
 */
export async function isClaudeProcess(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !alive(pid)) return false
  if (process.platform === 'win32') {
    const rows = await queryClaudeProcesses(pid)
    if (rows) {
      const ok = sameClaudeProcess(
        rows.find((r) => r.pid === pid),
        identities.get(pid),
      )
      if (!ok) identities.delete(pid)
      return ok
    }
    const out = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
    return parseTasklistCsv(out).some((r) => r.pid === pid && isClaudeImage(r.name))
  }
  const out = await run('ps', ['-p', String(pid), '-o', 'command='])
  return /claude/i.test(out)
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function waitExit(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return !alive(pid)
}

/**
 * Asks the session to quit like closing its terminal would.
 *
 * macOS/Linux: SIGTERM, then SIGHUP. No SIGKILL: a hard kill can leave the user's
 * terminal stuck in raw mode (I-11).
 *
 * Windows: exception to I-11 (ADR-run-5). There is no SIGHUP and Node turns SIGTERM
 * into TerminateProcess, so the session ends immediately (its last transcript write
 * may be lost and SessionEnd does not fire; the conversation stays saved). The
 * renderer says so in the confirmation before the user agrees, and callers check the
 * PID first with isClaudeProcess() (exact name, not Claude Desktop, same creation time).
 */
export async function terminate(pid: number): Promise<boolean> {
  for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
    try {
      process.kill(pid, signal)
    } catch {
      return !alive(pid)
    }
    if (await waitExit(pid, 2500)) {
      identities.delete(pid)
      return true
    }
    if (process.platform === 'win32') break // Windows has no SIGHUP
  }
  return false
}
