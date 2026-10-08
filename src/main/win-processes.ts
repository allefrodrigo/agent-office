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

export interface ClaudeStats {
  count: number
  cpu: number | null
  mem: number
}

export interface WindowsClaudeDeps {
  /** Output of `tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH`. */
  tasklist: () => Promise<string>
  /** The CIM query (queryClaudeProcesses); null when PowerShell fails. */
  query: () => Promise<ProcRow[] | null>
  now?: () => number
  warn?: (message: string) => void
}

export const FALLBACK_WARNING = 'PowerShell/CIM indisponível: CPU do Claude Code fica vazia e o Claude Desktop entra na contagem.'

/**
 * Windows (ADR-run-4): `tasklist` every 3 s for count and memory, as before, now by
 * exact image name. A CIM query via PowerShell (~0.5 s of CPU each) runs in the
 * background every sampleEveryMs(cores), or after 5 s when an unknown PID shows up,
 * one at a time: it tells Claude Code from the Claude Desktop app (both claude.exe)
 * by executable path and gives CPU from the change in CPU time between samples.
 * If PowerShell fails, CPU stays null and every claude.exe counts (v0.2.0 behaviour),
 * with a single warning; it tries again after RETRY_MS.
 *
 * Commands, clock and warning are injected so `npm test` drives it without Windows.
 */
export class WindowsClaude {
  static readonly SOON_MS = 5000
  static readonly RETRY_MS = 5 * 60_000
  private kind = new Map<number, 'code' | 'desktop'>()
  private ticks = new Map<number, number>()
  private sampledAt = 0
  private cpu: number | null = null
  private busy = false
  private retryAt = 0
  private warned = false
  private readonly deps: WindowsClaudeDeps
  private readonly now: () => number
  private readonly warn: (message: string) => void

  // No parameter properties: `node --test` strips types and does not support them.
  constructor(deps: WindowsClaudeDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.warn = deps.warn ?? ((m) => console.warn(m))
  }

  async read(cores: number): Promise<ClaudeStats> {
    const out = await this.deps.tasklist()
    const rows = parseTasklistCsv(out).filter((r) => isClaudeImage(r.name))
    // A PID not classified yet counts as Claude Code until the next sample.
    const code = rows.filter((r) => this.kind.get(r.pid) !== 'desktop')
    this.maybeSample(cores, rows.some((r) => !this.kind.has(r.pid)))
    return {
      count: code.length,
      cpu: this.cpu === null ? null : Math.round(this.cpu),
      mem: code.reduce((s, r) => s + r.mem, 0),
    }
  }

  private maybeSample(cores: number, unknown: boolean): void {
    const now = this.now()
    if (this.busy || now < this.retryAt) return
    const since = now - this.sampledAt
    if (since < sampleEveryMs(cores) && !(unknown && since >= WindowsClaude.SOON_MS)) return
    this.busy = true
    void this.deps
      .query()
      .then((rows) => {
        if (!rows) return this.fail(now)
        const code = rows.filter((r) => !isDesktopPath(r.path))
        this.cpu = cpuPercent(this.ticks, code, now - this.sampledAt, cores)
        this.kind = new Map(rows.map((r) => [r.pid, isDesktopPath(r.path) ? 'desktop' : 'code']))
        this.ticks = new Map(code.map((r) => [r.pid, r.ticks]))
        this.sampledAt = now
      })
      .finally(() => {
        this.busy = false
      })
  }

  private fail(now: number): void {
    this.kind.clear()
    this.ticks.clear()
    this.cpu = null
    this.sampledAt = now
    this.retryAt = now + WindowsClaude.RETRY_MS
    if (!this.warned) this.warn(FALLBACK_WARNING)
    this.warned = true
  }
}

/**
 * Windows: creation time of each terminal-session PID when the office learned it
 * (pid → FILETIME). A different creation time later means the PID was reused.
 * Oldest entry goes first past `max`. The CIM query and tasklist are injected.
 */
export class ClaudeIdentities {
  private readonly created = new Map<number, string>()
  private readonly query: (pid: number) => Promise<ProcRow[] | null>
  private readonly tasklist: (pid: number) => Promise<string>
  private readonly max: number

  /** `tasklist`: output of `tasklist /FI "PID eq <pid>" /FO CSV /NH` (fallback without PowerShell). */
  constructor(query: (pid: number) => Promise<ProcRow[] | null>, tasklist: (pid: number) => Promise<string>, max = 256) {
    this.query = query
    this.tasklist = tasklist
    this.max = max
  }

  /** Records the creation time, only for claude.exe outside Claude Desktop with a known one. */
  async remember(pid: number): Promise<void> {
    const row = (await this.query(pid))?.find((r) => r.pid === pid)
    if (!row?.created || !sameClaudeProcess(row, undefined)) return
    this.created.delete(pid)
    this.created.set(pid, row.created)
    if (this.created.size > this.max) this.created.delete(this.created.keys().next().value!)
  }

  /**
   * Still the Claude Code process the office learned? Exact name, not Claude Desktop
   * and the same creation time (a mismatch forgets the entry). Without PowerShell,
   * exact name via tasklist.
   */
  async check(pid: number): Promise<boolean> {
    const rows = await this.query(pid)
    if (rows) {
      const ok = sameClaudeProcess(
        rows.find((r) => r.pid === pid),
        this.created.get(pid),
      )
      if (!ok) this.created.delete(pid)
      return ok
    }
    const out = await this.tasklist(pid)
    return parseTasklistCsv(out).some((r) => r.pid === pid && isClaudeImage(r.name))
  }

  forget(pid: number): void {
    this.created.delete(pid)
  }

  /** Recorded creation time, for tests and diagnostics. */
  get(pid: number): string | undefined {
    return this.created.get(pid)
  }

  get size(): number {
    return this.created.size
  }
}
