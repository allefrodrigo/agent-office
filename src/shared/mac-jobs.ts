import { describeSchedule, nextRun } from './schedule'
import type { MacJob, Schedule } from './types'

/**
 * Jobs the Mac schedules on its own (launchd user agents): reading their plists into
 * MacJob, and the sentences the Rotinas window shows. No Electron or file access here.
 */

/** Vendor agents (updaters, cleaners): scheduled too, but not the user's own work. */
const VENDOR = /^(com\.apple|com\.google|com\.microsoft|com\.adobe|com\.valvesoftware|com\.dropbox|com\.spotify|homebrew\.mxcl)\./i

export interface LaunchdStatus {
  pid: number | null
  lastExit: number | null
}

/** `launchctl list`: "PID\tStatus\tLabel" lines, "-" for none. */
export function parseLaunchctlList(text: string): Map<string, LaunchdStatus> {
  const out = new Map<string, LaunchdStatus>()
  for (const line of text.split('\n').slice(1)) {
    const [pid, status, label] = line.split('\t')
    if (!label?.trim()) continue
    const num = (v: string | undefined) => (v && v !== '-' && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : null)
    out.set(label.trim(), { pid: num(pid), lastExit: num(status) })
  }
  return out
}

/** "com.mochilinho.agente.manha" → "mochilinho · agente · manha". */
export function macJobName(label: string): string {
  const parts = label.split('.').filter(Boolean)
  if (parts.length > 1 && /^(com|dev|org|net|io|br|me|app)$/i.test(parts[0])) parts.shift()
  return parts.join(' · ') || label
}

const int = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined)

/** StartCalendarInterval (one dict or a list): each becomes a cron schedule; a missing key means every value, as in launchd. */
export function calendarSchedules(raw: unknown): Schedule[] {
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const out: Schedule[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const d = it as Record<string, unknown>
    const f = (v: number | undefined) => (v === undefined ? '*' : String(v))
    out.push({ kind: 'cron', expr: [f(int(d.Minute, 0, 59)), f(int(d.Hour, 0, 23)), f(int(d.Day, 1, 31)), f(int(d.Month, 1, 12)), f(int(d.Weekday, 0, 7))].join(' ') })
  }
  return out
}

/**
 * A plist (as JSON) into a MacJob, or null when it is not one to show: no label,
 * a vendor agent, or nothing scheduled (KeepAlive daemons, WatchPaths only).
 */
export function macJobFromPlist(plist: unknown, status: LaunchdStatus | undefined, lastLogAt: number | undefined, now = Date.now()): MacJob | null {
  if (!plist || typeof plist !== 'object') return null
  const p = plist as Record<string, unknown>
  const label = typeof p.Label === 'string' ? p.Label.trim() : ''
  if (!label || VENDOR.test(label) || p.Disabled === true) return null
  const schedules = calendarSchedules(p.StartCalendarInterval)
  const everySec = int(p.StartInterval, 1, 366 * 86_400)
  if (!schedules.length && !everySec) return null
  const args = Array.isArray(p.ProgramArguments) ? p.ProgramArguments.filter((a): a is string => typeof a === 'string') : []
  const command = (args.length ? args : typeof p.Program === 'string' ? [p.Program] : []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
  const log = typeof p.StandardOutPath === 'string' ? p.StandardOutPath : typeof p.StandardErrorPath === 'string' ? p.StandardErrorPath : undefined
  let nextAt: number | null = null
  for (const s of schedules) {
    const t = nextRun(s, now)
    if (t !== null && (nextAt === null || t < nextAt)) nextAt = t
  }
  // launchd counts the interval from when it loaded the job: the log's last write is the best guess
  if (!schedules.length && everySec && lastLogAt) {
    const t = lastLogAt + everySec * 1000
    nextAt = t > now ? t : null
  }
  return {
    label,
    name: macJobName(label),
    schedules,
    ...(everySec && !schedules.length ? { everySec } : {}),
    command,
    ...(log ? { log } : {}),
    loaded: !!status,
    running: status?.pid != null,
    lastExit: status?.lastExit ?? null,
    ...(lastLogAt ? { lastLogAt } : {}),
    nextAt,
  }
}

/** "Roda todo dia às 10:00.", "Roda a cada 15 minutos.", several calendar slots joined. */
export function describeMacJob(job: MacJob): string {
  if (job.schedules.length) return job.schedules.map(describeSchedule).join(' ')
  const s = job.everySec ?? 0
  if (s % 3600 === 0) return s === 3600 ? 'Roda a cada hora.' : `Roda a cada ${s / 3600} horas.`
  if (s % 60 === 0) return s === 60 ? 'Roda a cada minuto.' : `Roda a cada ${s / 60} minutos.`
  return `Roda a cada ${s} segundos.`
}

/** How the last run went: ok, failed (with the code), running, or not yet. */
export function macJobState(job: MacJob): 'run' | 'ok' | 'fail' | 'none' | 'off' {
  if (!job.loaded) return 'off'
  if (job.running) return 'run'
  if (job.lastExit === null) return 'none'
  return job.lastExit === 0 ? 'ok' : 'fail'
}
