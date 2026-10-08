import { execFile } from 'node:child_process'
import { win32 } from 'node:path'

/**
 * Claude Code processes on Windows (ADR-run-4). `tasklist` gives name, PID and
 * memory; one CIM query through PowerShell adds the executable path (to leave the
 * Claude Desktop app out), the creation time (PID identity) and CPU time.
 *
 * Only imports node:* so `npm test` runs it without Electron. Nothing here reads a
 * process command line, and the only value that enters the PowerShell script is a
 * validated positive integer.
 */

export interface ProcRow {
  pid: number
  /** 'claude.exe' */
  name: string
  /** KernelModeTime + UserModeTime, in 100 ns units. */
  ticks: number
  /** WorkingSetSize in bytes. */
  ws: number
  /** CreationDate as a UTC FILETIME (decimal string), null when not readable. */
  created: string | null
  /** ExecutablePath, null when not readable (protected process). */
  path: string | null
}

export const PS_TIMEOUT_MS = 5000
export const CLAUDE_EXE = 'claude.exe'

/** True for the exact image name claude.exe (any case); not claude.exe.bak or myclaude.exe. */
export function isClaudeImage(name: string): boolean {
  return name.toLowerCase() === CLAUDE_EXE
}

/** %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe (never looked up on PATH). */
export function powershellPath(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows'
  return win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Constant script; `pid`, when given, must be a positive safe integer (throws otherwise). */
export function psScript(pid?: number): string {
  if (pid !== undefined && !(typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0)) {
    throw new Error('psScript: pid must be a positive integer')
  }
  const filter = pid === undefined ? "Name='claude.exe'" : `ProcessId=${pid}`
  // Path goes last: it is the only free-form field (Windows paths have no tab or newline).
  return [
    "$ProgressPreference='SilentlyContinue'",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object {`,
    '  "{0}`t{1}`t{2}`t{3}`t{4}`t{5}" -f $_.ProcessId, $_.Name, ($_.KernelModeTime + $_.UserModeTime),',
    "    $_.WorkingSetSize, $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { '' }), $_.ExecutablePath }",
  ].join('\n')
}

/** Base64 of UTF-16LE, for -EncodedCommand (no quoting through the Windows command line). */
export function encodePs(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

const nonNegative = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null)

/** Rows printed by psScript(); malformed lines are skipped. */
export function parseCimLines(out: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const raw of out.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '')
    if (!line.trim()) continue
    const f = line.split('\t')
    if (f.length < 6) continue
    const pid = nonNegative(f[0])
    const ticks = nonNegative(f[2])
    const ws = nonNegative(f[3])
    const name = f[1].trim()
    if (!pid || ticks === null || ws === null || !name) continue
    const created = /^\d+$/.test(f[4]) ? f[4] : null
    const path = f.slice(5).join('\t').trim() || null
    rows.push({ pid, name, ticks, ws, created, path })
  }
  return rows
}

/**
 * Claude Desktop's own executable: MSIX (…\WindowsApps\Claude_…) or the legacy
 * Squirrel install (…\AnthropicClaude\…, assumption P-5). Claude Code sessions the
 * Desktop app starts run from elsewhere and still count as Claude Code.
 */
export function isDesktopPath(path: string | null): boolean {
  if (!path) return false
  return /\\windowsapps\\claude_/i.test(path) || /\\anthropicclaude\\/i.test(path)
}

/**
 * Sum of CPU % (share of the whole machine) of `next` rows also present in `prev`
 * (pid → ticks of the previous sample); null if none overlap or the interval is invalid.
 */
export function cpuPercent(prev: Map<number, number>, next: ProcRow[], elapsedMs: number, cores: number): number | null {
  if (!(elapsedMs > 0) || !(cores > 0)) return null
  let used = 0
  let overlap = false
  for (const r of next) {
    const before = prev.get(r.pid)
    if (before === undefined) continue
    overlap = true
    used += Math.max(0, r.ticks - before) // a reused PID can have fewer ticks: count as idle
  }
  if (!overlap) return null
  return (used / (elapsedMs * 10_000 * cores)) * 100
}

/** clamp(100_000 / cores, 15_000, 60_000) ms: keeps the PowerShell cost ≲ 0.5 p.p. of the machine. */
export function sampleEveryMs(cores: number): number {
  if (!(cores >= 1)) return 60_000
  return Math.round(Math.min(60_000, Math.max(15_000, 100_000 / cores)))
}

/** `tasklist /FO CSV /NH` rows: exact image name, PID and memory in bytes (any locale). */
export function parseTasklistCsv(out: string): { name: string; pid: number; mem: number }[] {
  const rows: { name: string; pid: number; mem: number }[] = []
  for (const line of out.split(/\r?\n/)) {
    const f = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'))
    if (f.length < 5) continue // e.g. "INFORMAÇÕES: Nenhuma tarefa em execução…"
    const pid = Number(f[1])
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    const kb = f[4].replace(/\D/g, '') // "362.936 K" (pt-BR) or "362,936 K" (en-US)
    rows.push({ name: f[0], pid, mem: kb ? Number(kb) * 1024 : 0 })
  }
  return rows
}

/**
 * Runs the CIM query (execFile, no shell, timeout, windowsHide). With `pid`, only
 * that process. null = not Windows, PowerShell unavailable, blocked or failed.
 */
export function queryClaudeProcesses(pid?: number): Promise<ProcRow[] | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  let script: string
  try {
    script = psScript(pid)
  } catch {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    execFile(
      powershellPath(process.env),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePs(script)],
      { timeout: PS_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : parseCimLines(String(stdout ?? ''))),
    )
  })
}

/**
 * Same Claude Code process the office learned? Exact name, not Claude Desktop and,
 * when both creation times are known, the same one (guards against PID reuse).
 */
export function sameClaudeProcess(row: ProcRow | undefined, created: string | undefined): boolean {
  if (!row || !isClaudeImage(row.name) || isDesktopPath(row.path)) return false
  return !created || !row.created || row.created === created
}
