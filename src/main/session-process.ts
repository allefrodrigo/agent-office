import { execFile } from 'node:child_process'

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
      if (proto === 'TCP' && local?.endsWith(`:${clientPort}`) && remote?.endsWith(`:${serverPort}`)) return Number(pid) || null
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

/** True if the PID is still a Claude Code process (guards against PID reuse). */
export async function isClaudeProcess(pid: number): Promise<boolean> {
  if (!alive(pid)) return false
  const out =
    process.platform === 'win32'
      ? await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
      : await run('ps', ['-p', String(pid), '-o', 'command='])
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
 * Asks the session to quit like closing its terminal would: SIGTERM, then SIGHUP.
 * No SIGKILL: a hard kill can leave the user's terminal stuck in raw mode.
 */
export async function terminate(pid: number): Promise<boolean> {
  for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
    try {
      process.kill(pid, signal)
    } catch {
      return !alive(pid)
    }
    if (await waitExit(pid, 2500)) return true
    if (process.platform === 'win32') break // Windows has no SIGHUP
  }
  return false
}
