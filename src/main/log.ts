import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

/**
 * App log in userData/logs/main-<date>.log, for investigating crashes users report.
 *
 * A file that passes 5 MB is renamed main-<date>-<time>.log and a new one starts;
 * only the 5 newest main-*.log stay. Writes are synchronous so the last line
 * before a crash reaches the disk.
 *
 * Never log prompts, agent messages or tool input: log events and errors only.
 * Every line goes through redact(), which drops the bridge token (registered with
 * secret()) and anything shaped like a token, key or auth header.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

let maxBytes = 5 * 1024 * 1024
const MAX_FILES = 5
/** One line is capped: a stack is enough, a dumped object is not welcome. */
const MAX_LINE = 8000

let dir = ''
let file = ''
let day = ''
let size = 0
const secrets = new Set<string>()

const PATTERNS: [RegExp, string][] = [
  [/(x-agent-office-token["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]'],
  [/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[^\s"',}]+/gi, '$1[redacted]'],
  [/\bbearer\s+[\w.~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\bsk-ant-[\w-]+/g, '[redacted]'],
  [/(["']?(?:token|api[_-]?key|secret|password)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[redacted]'],
]

/** Starts logging into <userData>/logs. Call once, after userData is set. maxBytes is for tests. */
export function initLog(userData: string, opts: { maxBytes?: number } = {}): void {
  if (opts.maxBytes && opts.maxBytes > 0) maxBytes = opts.maxBytes
  dir = join(userData, 'logs')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    dir = ''
  }
}

export function logDir(): string {
  return dir
}

/** The file being written now (may not exist yet). */
export function logFile(): string {
  openFile()
  return file
}

/** A value that must never reach the log (the bridge token). */
export function secret(value: string | undefined): void {
  const v = value?.trim()
  if (v && v.length >= 8) secrets.add(v)
}

export function redact(text: string): string {
  let out = text
  for (const s of secrets) out = out.split(s).join('[redacted]')
  for (const [re, to] of PATTERNS) out = out.replace(re, to)
  return out
}

export const log = {
  debug: (...args: unknown[]) => write('debug', args),
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
}

/** Mirrors console.warn/error into the log too (libraries and old code use them). */
export function captureConsole(): void {
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      write(level, args)
    }
  }
}

/** The last n lines of the log, oldest first, across the current and previous file. */
export function tail(n: number): string[] {
  if (!dir) return []
  const lines: string[] = []
  for (const f of logFiles().reverse()) {
    try {
      const chunk = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean)
      lines.unshift(...chunk.slice(-(n - lines.length)))
    } catch {
      // removed meanwhile
    }
    if (lines.length >= n) break
  }
  return lines
}

function write(level: LogLevel, args: unknown[]): void {
  if (level === 'debug' && !process.env.AGENT_OFFICE_DEBUG) return
  let text = redact(args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : format('%o', a))).join(' '))
  if (text.length > MAX_LINE) text = text.slice(0, MAX_LINE) + ' …[cortado]'
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${text.replace(/\n/g, '\n    ')}\n`
  if (!dir) return
  try {
    openFile()
    if (size + line.length > maxBytes && size > 0) rotate()
    appendFileSync(file, line)
    size += Buffer.byteLength(line)
  } catch {
    // a full or read-only disk must not take the app down with it
  }
}

/** Picks today's file; a new day starts a new file. */
function openFile(): void {
  if (!dir) return
  const today = localDate(new Date())
  if (today === day && file) return
  day = today
  file = join(dir, `main-${day}.log`)
  try {
    size = statSync(file).size
  } catch {
    size = 0
  }
  prune()
}

function rotate(): void {
  const t = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  let stamp = `${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}-${pad(t.getMilliseconds(), 3)}`
  // Two rotations in the same millisecond must not overwrite each other.
  for (let i = 1; existsSync(join(dir, `main-${day}-${stamp}.log`)); i++) stamp = `${stamp.split('-').slice(0, 2).join('-')}-${i}`
  try {
    renameSync(file, join(dir, `main-${day}-${stamp}.log`))
  } catch {
    // keep appending to the same file
    return
  }
  size = 0
  prune()
}

/** main-*.log, oldest first. */
function logFiles(): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => /^main-[\d-]+\.log$/.test(f))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => a.t - b.t || a.f.localeCompare(b.f))
      .map((x) => x.f)
  } catch {
    return []
  }
}

/** Keeps the 5 newest files, counting the one being written. */
function prune(): void {
  const current = file.slice(dir.length + 1)
  const old = logFiles().filter((f) => f !== current)
  for (const f of old.slice(0, Math.max(0, old.length - (MAX_FILES - 1)))) {
    try {
      unlinkSync(join(dir, f))
    } catch {
      // already gone
    }
  }
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
