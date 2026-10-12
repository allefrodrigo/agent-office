import { EventEmitter } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Account, ClaudeStats, DayStats, LedgerSwitch, ModelTokens, PlanUsage, StatsBucket } from '@shared/types'
import { messageCost, priceOf } from '@shared/pricing'
import { writeJsonAtomic } from './fs-safe'

/**
 * Claude Code statistics (what /stats shows) read from the transcripts on disk:
 * ~/.claude/projects/<folder>/<session>.jsonl and <session>/subagents/*.jsonl.
 * No process, no API call. Claude Code deletes transcripts after a while
 * (cleanupPeriodDays), so the daily totals live in userData/stats.json, with an index
 * of how far each file was read: every refresh reads only the new bytes.
 *
 * Accounts: every account folder links projects/ to ~/.claude, and a transcript line
 * does not say which login ran it. The cost book's switches (session -> account from
 * a time on) say it for office sessions; the rest go to 'terminal'.
 * Emits 'stats' (ClaudeStats) after each read.
 */

const VERSION = 1
/** Message ids are kept this long to catch copies (forks, resumes); older lines are skipped. */
const SEEN_DAYS = 35
const DAY_MS = 86_400_000
/** getStats() on numbers older than this starts a background read. */
const STALE_MS = 10 * 60_000
const EVERY_MS = 60 * 60_000
const FIRST_READ_MS = 15_000
/** A switch is written just before its run starts; allow for clocks and ordering. */
const SWITCH_SLACK_MS = 5_000
const TERMINAL = 'terminal'
const ALL = 'all'
const CHUNK = 1 << 20

interface FileMark {
  size: number
  mtimeMs: number
  offset: number
}

type Tokens = Omit<ModelTokens, 'costUsd'> & { costUsd: number }

interface DayAgg {
  messages: number
  toolCalls: number
  sessions: Set<string>
  models: Record<string, Tokens>
  costUsd: number
}

interface SessionAgg {
  first: number
  last: number
  messages: number
  bucket: string
}

interface Longest {
  sessionId: string
  durationMs: number
  messages: number
}

/** stats.json */
interface StatsFile {
  version: number
  files: Record<string, FileMark>
  /** Local date -> message keys already counted that day. */
  seen: Record<string, string[]>
  /** Lines older than this cannot be checked for copies: skipped. 0 = first read. */
  checkedSince: number
  days: Record<string, Record<string, Omit<DayAgg, 'sessions'> & { sessions: string[] }>>
  hours: Record<string, number[]>
  sessions: Record<string, SessionAgg>
  longest: Record<string, Longest>
  since?: string
  lastRead?: ClaudeStats['lastRead']
}

interface LegacyDay {
  date: string
  messages: number
  sessions: number
  toolCalls: number
  tokens: number
}

export interface StatsSources {
  accounts: () => Account[]
  switches: () => LedgerSwitch[]
  plan: () => PlanUsage[]
}

export function localDate(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const zeroTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearch: 0, messages: 0, costUsd: 0 })
const tokenSum = (t: Omit<ModelTokens, 'messages' | 'costUsd'>) => t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h
const yieldNow = () => new Promise<void>((r) => setImmediate(r))
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

function addTokens(into: Tokens, t: Tokens): void {
  into.input += t.input
  into.output += t.output
  into.cacheRead += t.cacheRead
  into.cacheWrite5m += t.cacheWrite5m
  into.cacheWrite1h += t.cacheWrite1h
  into.webSearch += t.webSearch
  into.messages += t.messages
  into.costUsd += t.costUsd
}

/** The part of an assistant line we use. Everything else (the conversation) is dropped right away. */
export interface Line {
  sessionId: string
  t: number
  key?: string
  model: string
  tokens: Tokens
  fast: boolean
  toolCalls: number
}

export function parseLine(raw: string): Line | null {
  // Cheap filter before JSON.parse: most lines are user turns, tool results, metadata.
  if (!raw.includes('"type":"assistant"')) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (o.type !== 'assistant') return null
  const msg = o.message as Record<string, unknown> | undefined
  const model = typeof msg?.model === 'string' ? msg.model : ''
  if (!msg || !model || model === '<synthetic>') return null
  const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
  const sessionId = typeof o.sessionId === 'string' ? o.sessionId : ''
  if (!Number.isFinite(t) || !sessionId) return null
  const u = (msg.usage ?? {}) as Record<string, unknown>
  const cc = (u.cache_creation ?? {}) as Record<string, unknown>
  const w1h = num(cc.ephemeral_1h_input_tokens)
  const w5m = cc.ephemeral_5m_input_tokens !== undefined ? num(cc.ephemeral_5m_input_tokens) : Math.max(0, num(u.cache_creation_input_tokens) - w1h)
  const stu = (u.server_tool_use ?? {}) as Record<string, unknown>
  const tokens: Tokens = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite5m: w5m,
    cacheWrite1h: w1h,
    webSearch: num(stu.web_search_requests),
    messages: 1,
    costUsd: 0,
  }
  const content = Array.isArray(msg.content) ? (msg.content as { type?: string }[]) : []
  const id = typeof msg.id === 'string' ? msg.id : ''
  const req = typeof o.requestId === 'string' ? o.requestId : ''
  return {
    sessionId,
    t,
    key: id || req ? `${id}|${req}` : undefined,
    model,
    tokens,
    fast: u.speed === 'fast',
    toolCalls: content.filter((c) => c?.type === 'tool_use').length,
  }
}

export class StatsReader extends EventEmitter {
  private file: string
  private data: StatsFile = StatsReader.empty()
  private days = new Map<string, Map<string, DayAgg>>()
  /** Message key -> local date it was counted on. */
  private seen = new Map<string, string>()
  private legacy: LegacyDay[] = []
  private running: Promise<ClaudeStats> | null = null
  private loaded: Promise<void>
  private timer?: NodeJS.Timeout
  private error?: string
  /** Messages of the file being read, by key: later lines of one message may carry more output tokens. */
  private pending: Map<string, { counted: number; apply: (extraOut: number, tools: number) => void }> | null = null

  constructor(
    dataDir: string,
    private src: StatsSources,
    private home = homedir(),
  ) {
    super()
    this.file = join(dataDir, 'stats.json')
    this.loaded = this.load()
  }

  private static empty(): StatsFile {
    return { version: VERSION, files: {}, seen: {}, checkedSince: 0, days: {}, hours: {}, sessions: {}, longest: {} }
  }

  start(): void {
    this.timer = setTimeout(() => {
      void this.refresh()
      this.timer = setInterval(() => void this.refresh(), EVERY_MS)
      this.timer.unref?.()
    }, FIRST_READ_MS)
    this.timer.unref?.()
  }

  stop(): void {
    clearTimeout(this.timer)
    clearInterval(this.timer)
  }

  /** What is in memory now. Old numbers start a read in the background (disk only). */
  async current(): Promise<ClaudeStats> {
    await this.loaded
    if (!this.running && Date.now() - (this.data.lastRead?.at ?? 0) > STALE_MS) void this.refresh()
    return this.build()
  }

  refresh(): Promise<ClaudeStats> {
    if (this.running) return this.running
    this.running = (async () => {
      await this.loaded
      this.emit('stats', this.build())
      try {
        await this.read()
        this.error = undefined
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      }
      return this.build()
    })().finally(() => {
      this.running = null
      const out = this.build()
      this.emit('stats', out)
    })
    return this.running
  }

  // ---------- storage ----------

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as StatsFile
      if (raw?.version === VERSION) this.data = { ...StatsReader.empty(), ...raw }
    } catch {
      // first run or unreadable: start over (the transcripts still on disk come back)
    }
    for (const [bucket, days] of Object.entries(this.data.days)) {
      const m = new Map<string, DayAgg>()
      for (const [date, d] of Object.entries(days)) m.set(date, { ...d, sessions: new Set(d.sessions) })
      this.days.set(bucket, m)
    }
    for (const [date, keys] of Object.entries(this.data.seen)) for (const k of keys) this.seen.set(k, date)
    await this.loadLegacy()
  }

  private async save(): Promise<void> {
    const days: StatsFile['days'] = {}
    for (const [bucket, m] of this.days) {
      const out: StatsFile['days'][string] = {}
      for (const [date, d] of m) out[date] = { ...d, sessions: [...d.sessions] }
      days[bucket] = out
    }
    const seen: Record<string, string[]> = {}
    for (const [k, date] of this.seen) (seen[date] ??= []).push(k)
    this.data = { ...this.data, days, seen }
    await mkdir(join(this.file, '..'), { recursive: true })
    writeJsonAtomic(this.file, this.data)
  }

  /** ~/.claude/stats-cache.json: /stats' own cache, for days before the app read anything. */
  private async loadLegacy(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(join(this.home, '.claude', 'stats-cache.json'), 'utf8')) as {
        dailyActivity?: { date: string; messageCount?: number; sessionCount?: number; toolCallCount?: number }[]
        dailyModelTokens?: { date: string; tokensByModel?: Record<string, number> }[]
      }
      const tokens = new Map((raw.dailyModelTokens ?? []).map((d) => [d.date, Object.values(d.tokensByModel ?? {}).reduce((a, b) => a + num(b), 0)]))
      this.legacy = (raw.dailyActivity ?? [])
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
        .map((d) => ({ date: d.date, messages: num(d.messageCount), sessions: num(d.sessionCount), toolCalls: num(d.toolCallCount), tokens: tokens.get(d.date) ?? 0 }))
    } catch {
      this.legacy = []
    }
  }

  // ---------- reading ----------

  /** Every projects/ folder: ~/.claude's plus any account folder whose projects/ is not a link to it. */
  private async roots(): Promise<{ dir: string; fallback: string }[]> {
    const out: { dir: string; fallback: string }[] = []
    const seen = new Set<string>()
    const add = async (dir: string, fallback: string) => {
      try {
        const real = await realpath(dir)
        if (seen.has(real)) return
        seen.add(real)
        out.push({ dir: real, fallback })
      } catch {
        // no such folder
      }
    }
    await add(join(this.home, '.claude', 'projects'), TERMINAL)
    for (const a of this.src.accounts()) if (a.configDir) await add(join(a.configDir, 'projects'), a.id)
    return out
  }

  private async listFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory() && depth < 3) await this.listFiles(p, depth + 1, out)
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
    }
    return out
  }

  private async read(): Promise<void> {
    const started = Date.now()
    const bySession = new Map<string, LedgerSwitch[]>()
    for (const s of this.src.switches()) {
      const list = bySession.get(s.sessionId) ?? []
      list.push(s)
      bySession.set(s.sessionId, list)
    }
    for (const list of bySession.values()) list.sort((a, b) => a.t - b.t)
    const accountAt = (sessionId: string, t: number, fallback: string): string => {
      const list = bySession.get(sessionId)
      if (!list) return fallback
      let to = fallback
      for (const s of list) {
        if (s.t - SWITCH_SLACK_MS > t) break
        to = s.to
      }
      return to
    }

    const live = new Set<string>()
    let files = 0
    let bytes = 0
    for (const root of await this.roots()) {
      for (const path of await this.listFiles(root.dir)) {
        live.add(path)
        let st
        try {
          st = await stat(path)
        } catch {
          continue
        }
        const mark = this.data.files[path]
        if (mark && mark.size === st.size && mark.mtimeMs === st.mtimeMs) continue
        // Rewritten or shrunk: start over; the seen keys keep it from counting twice.
        const from = mark && st.size >= mark.offset ? mark.offset : 0
        if (st.size <= from) {
          this.data.files[path] = { size: st.size, mtimeMs: st.mtimeMs, offset: from }
          continue
        }
        const offset = await this.readFile(path, from, st.size, (line) => this.count(line, accountAt(line.sessionId, line.t, root.fallback)))
        this.data.files[path] = { size: st.size, mtimeMs: st.mtimeMs, offset }
        files++
        bytes += offset - from
        await yieldNow()
      }
    }
    // Gone from disk (Claude Code cleaned them up): their numbers stay, their marks go.
    for (const path of Object.keys(this.data.files)) if (!live.has(path)) delete this.data.files[path]
    this.prune()
    this.data.lastRead = { at: Date.now(), files, bytes, ms: Date.now() - started }
    await this.loadLegacy()
    await this.save()
  }

  /** Reads [from, to) line by line; returns the offset after the last full line. */
  private async readFile(path: string, from: number, to: number, onLine: (l: Line) => void): Promise<number> {
    let offset = from
    let rest: Buffer = Buffer.alloc(0)
    this.pending = new Map()
    const stream = createReadStream(path, { start: from, end: to - 1, highWaterMark: CHUNK })
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk
        const end = buf.lastIndexOf(0x0a)
        if (end < 0) {
          rest = buf
          continue
        }
        const text = buf.subarray(0, end).toString('utf8')
        rest = buf.subarray(end + 1)
        offset += end + 1
        for (const raw of text.split('\n')) {
          const line = parseLine(raw)
          if (line) onLine(line)
        }
        await yieldNow()
      }
    } finally {
      stream.destroy()
      this.pending = null
    }
    return offset
  }

  private count(line: Line, bucket: string): void {
    if (this.data.checkedSince && line.t < this.data.checkedSince) return
    const date = localDate(line.t)
    if (line.key) {
      const open = this.pending?.get(line.key)
      if (open) {
        // Another content block of a message counted a moment ago in this file.
        open.apply(Math.max(0, line.tokens.output - open.counted), line.toolCalls)
        open.counted = Math.max(open.counted, line.tokens.output)
        return
      }
      if (this.seen.has(line.key)) return
      this.seen.set(line.key, date)
    }
    const tokens = { ...line.tokens, costUsd: messageCost(line.model, line.tokens, line.fast) ?? 0 }
    const day = this.dayAgg(bucket, date)
    const model = (day.models[line.model] ??= zeroTokens())
    addTokens(model, tokens)
    day.messages++
    day.toolCalls += line.toolCalls
    day.costUsd += tokens.costUsd
    day.sessions.add(line.sessionId)
    const hours = (this.data.hours[bucket] ??= new Array(24).fill(0))
    hours[new Date(line.t).getHours()]++
    const s = this.data.sessions[line.sessionId]
    if (!s) this.data.sessions[line.sessionId] = { first: line.t, last: line.t, messages: 1, bucket }
    else {
      s.first = Math.min(s.first, line.t)
      s.last = Math.max(s.last, line.t)
      s.messages++
    }
    if (!this.data.since || date < this.data.since) this.data.since = date
    if (line.key && this.pending) {
      const fast = line.fast
      const name = line.model
      this.pending.set(line.key, {
        counted: line.tokens.output,
        apply: (extraOut, tools) => {
          day.toolCalls += tools
          if (!extraOut) return
          const extra = { ...zeroTokens(), output: extraOut }
          const usd = messageCost(name, extra, fast) ?? 0
          model.output += extraOut
          model.costUsd += usd
          day.costUsd += usd
        },
      })
    }
  }

  private dayAgg(bucket: string, date: string): DayAgg {
    let m = this.days.get(bucket)
    if (!m) this.days.set(bucket, (m = new Map()))
    let d = m.get(date)
    if (!d) m.set(date, (d = { messages: 0, toolCalls: 0, sessions: new Set(), models: {}, costUsd: 0 }))
    return d
  }

  /** Forgets message keys and sessions old enough that their transcripts are gone. */
  private prune(): void {
    const cut = Date.now() - SEEN_DAYS * DAY_MS
    const cutDate = localDate(cut)
    let pruned = false
    for (const [k, date] of this.seen) {
      if (date < cutDate) {
        this.seen.delete(k)
        pruned = true
      }
    }
    if (pruned || this.data.checkedSince) this.data.checkedSince = Math.max(this.data.checkedSince, new Date(`${cutDate}T00:00:00`).getTime())
    for (const [id, s] of Object.entries(this.data.sessions)) {
      if (s.last >= cut) continue
      this.foldLongest(id, s)
      delete this.data.sessions[id]
    }
  }

  private foldLongest(id: string, s: SessionAgg): void {
    for (const b of [s.bucket, ALL]) {
      const best = this.data.longest[b]
      const durationMs = s.last - s.first
      if (!best || durationMs > best.durationMs) this.data.longest[b] = { sessionId: id, durationMs, messages: s.messages }
    }
  }

  // ---------- output ----------

  private build(): ClaudeStats {
    const accounts = this.src.accounts()
    const unpriced = new Set<string>()
    const bucketIds = new Set<string>([ALL, ...accounts.map((a) => a.id)])
    for (const b of this.days.keys()) bucketIds.add(b)
    const buckets: StatsBucket[] = []
    for (const id of bucketIds) {
      if (id === TERMINAL) continue
      buckets.push(this.bucket(id, accounts, unpriced))
    }
    if (this.days.has(TERMINAL)) buckets.push(this.bucket(TERMINAL, accounts, unpriced))
    return {
      generatedAt: Date.now(),
      buckets,
      plan: this.src.plan(),
      unpricedModels: [...unpriced].sort(),
      since: this.data.since,
      reading: !!this.running,
      lastRead: this.data.lastRead,
      error: this.error,
    }
  }

  private bucket(id: string, accounts: Account[], unpriced: Set<string>): StatsBucket {
    const account = accounts.find((a) => a.id === id)
    const label = id === ALL ? 'Todas as contas' : id === TERMINAL ? 'Terminal' : (account?.name ?? 'Conta removida')
    const color = id === ALL ? '#d97757' : id === TERMINAL ? '#9c9ab5' : (account?.color ?? '#6f6d8a')
    const sources = id === ALL ? [...this.days.values()] : this.days.has(id) ? [this.days.get(id)!] : []

    const merged = new Map<string, DayAgg>()
    for (const m of sources) {
      for (const [date, d] of m) {
        const into = merged.get(date) ?? { messages: 0, toolCalls: 0, sessions: new Set<string>(), models: {}, costUsd: 0 }
        into.messages += d.messages
        into.toolCalls += d.toolCalls
        into.costUsd += d.costUsd
        for (const s of d.sessions) into.sessions.add(s)
        for (const [name, t] of Object.entries(d.models)) addTokens((into.models[name] ??= zeroTokens()), t)
        merged.set(date, into)
      }
    }

    const byModel: Record<string, ModelTokens> = {}
    const allSessions = new Set<string>()
    const days: DayStats[] = []
    const totals = { sessions: 0, messages: 0, toolCalls: 0, tokens: 0, costUsd: 0, activeDays: 0 }
    for (const [date, d] of [...merged].sort(([a], [b]) => a.localeCompare(b))) {
      let tokens = 0
      const dayModels: Record<string, ModelTokens> = {}
      for (const [name, t] of Object.entries(d.models)) {
        const priced = !!priceOf(name)
        if (!priced) unpriced.add(name)
        dayModels[name] = { ...t, costUsd: priced ? t.costUsd : undefined }
        tokens += tokenSum(t)
        const m = (byModel[name] ??= { ...zeroTokens(), costUsd: priced ? 0 : undefined })
        addTokens(m as Tokens, t)
        if (!priced) m.costUsd = undefined
      }
      for (const s of d.sessions) allSessions.add(s)
      days.push({ date, messages: d.messages, sessions: d.sessions.size, toolCalls: d.toolCalls, tokens, byModel: dayModels, costUsd: d.costUsd })
      totals.messages += d.messages
      totals.toolCalls += d.toolCalls
      totals.tokens += tokens
      totals.costUsd += d.costUsd
    }
    totals.sessions = allSessions.size
    totals.activeDays = days.length

    // /stats' own cache fills the days before the app started reading (all accounts only).
    if (id === ALL && this.legacy.length) {
      const first = days[0]?.date ?? this.data.since ?? '9999'
      const old = this.legacy.filter((d) => d.date < first).map((d): DayStats => ({ ...d, byModel: {}, costUsd: 0, legacy: true }))
      days.unshift(...old)
    }

    const hourCounts = [...(id === ALL ? this.sumHours() : (this.data.hours[id] ?? new Array(24).fill(0)))]

    let longest: Longest | undefined = this.data.longest[id]
    for (const [sid, s] of Object.entries(this.data.sessions)) {
      if (id !== ALL && s.bucket !== id) continue
      const durationMs = s.last - s.first
      if (!longest || durationMs > longest.durationMs) longest = { sessionId: sid, durationMs, messages: s.messages }
    }

    return { accountId: id, label, color, days, byModel, totals, streak: streaks(days.map((d) => d.date)), hourCounts, longestSession: longest }
  }

  private sumHours(): number[] {
    const out = new Array(24).fill(0)
    for (const h of Object.values(this.data.hours)) h.forEach((n, i) => (out[i] += n))
    return out
  }
}

/** Current streak (ending today or yesterday) and longest run of consecutive active days. */
export function streaks(dates: string[], today = localDate(Date.now())): { current: number; longest: number } {
  const set = new Set(dates)
  const sorted = [...set].sort()
  const next = (d: string) => {
    const t = new Date(`${d}T12:00:00`)
    t.setDate(t.getDate() + 1)
    return localDate(t.getTime())
  }
  const prev = (d: string) => {
    const t = new Date(`${d}T12:00:00`)
    t.setDate(t.getDate() - 1)
    return localDate(t.getTime())
  }
  let longest = 0
  let run = 0
  let last = ''
  for (const d of sorted) {
    run = last && next(last) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    last = d
  }
  let current = 0
  let d = set.has(today) ? today : prev(today)
  while (set.has(d)) {
    current++
    d = prev(d)
  }
  return { current, longest }
}
