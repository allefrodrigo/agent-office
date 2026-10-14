import type { Schedule } from './types'

/**
 * Routine schedules: checking them, the next run and the sentence the form shows.
 * Everything is in the computer's local time. No dependency: the cron reader covers
 * the 5 standard fields (lists, ranges, steps, month and weekday names).
 */

/** Shortest gap between two runs of a routine. */
export const MIN_INTERVAL_MIN = 15
const MINUTE = 60_000
/** Interval routines run at most once a week apart. */
const MAX_INTERVAL_MIN = 7 * 24 * 60
/** How far ahead the search for the next run goes (a 29 de fevereiro can be 8 years away). */
const SEARCH_DAYS = 366 * 9

const DAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const DAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
/** Monday first, as people read a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

const pad = (n: number) => String(n).padStart(2, '0')
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const ONCE_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/

// ---------- cron ----------

/** The days, hours and minutes a schedule runs at. */
interface Matcher {
  minutes: number[]
  hours: number[]
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  /** The field was "*" (or "*\/n"): with both restricted, either one matching is enough (as in cron). */
  anyDay: boolean
  anyWeekday: boolean
}

interface FieldDef {
  name: string
  min: number
  max: number
  names?: Record<string, number>
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, abr: 4, may: 5, mai: 5, jun: 6, jul: 7,
  aug: 8, ago: 8, sep: 9, set: 9, oct: 10, out: 10, nov: 11, dec: 12, dez: 12,
}
const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0, dom: 0, mon: 1, seg: 1, tue: 2, ter: 2, wed: 3, qua: 3, thu: 4, qui: 4, fri: 5, sex: 5, sat: 6, sab: 6, 'sáb': 6,
}
const FIELDS: FieldDef[] = [
  { name: 'minuto', min: 0, max: 59 },
  { name: 'hora', min: 0, max: 23 },
  { name: 'dia do mês', min: 1, max: 31 },
  { name: 'mês', min: 1, max: 12, names: MONTH_NAMES },
  // 7 is Sunday too, as in most crons
  { name: 'dia da semana', min: 0, max: 7, names: WEEKDAY_NAMES },
]

class CronError extends Error {}

function value(token: string, f: FieldDef): number {
  const t = token.toLowerCase()
  if (f.names && t in f.names) return f.names[t]
  if (!/^\d+$/.test(t)) throw new CronError(`Campo ${f.name}: "${token}" não é um número${f.names ? ' nem um nome válido' : ''}.`)
  const n = Number(t)
  if (n < f.min || n > f.max) throw new CronError(`Campo ${f.name}: ${n} está fora do intervalo ${f.min}–${f.max}.`)
  return n
}

function field(text: string, f: FieldDef): number[] {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    if (!part) throw new CronError(`Campo ${f.name}: sobrou uma vírgula.`)
    const [range, stepText, extra] = part.split('/')
    if (extra !== undefined) throw new CronError(`Campo ${f.name}: use só uma barra, como em */15.`)
    let step = 1
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) throw new CronError(`Campo ${f.name}: o passo "/${stepText}" precisa ser um número inteiro maior que zero.`)
      step = Number(stepText)
    }
    let lo: number
    let hi: number
    if (range === '*') {
      lo = f.min
      hi = f.max === 7 ? 6 : f.max
    } else if (range.includes('-')) {
      const [a, b, more] = range.split('-')
      if (more !== undefined || !a || !b) throw new CronError(`Campo ${f.name}: "${range}" não é um intervalo válido. Use início-fim, como 1-5.`)
      lo = value(a, f)
      hi = value(b, f)
      if (lo > hi) throw new CronError(`Campo ${f.name}: o intervalo ${a}-${b} está invertido. Escreva o menor primeiro.`)
    } else {
      lo = value(range, f)
      // "5/10" = from 5 to the end, every 10
      hi = stepText !== undefined ? f.max : lo
    }
    for (let v = lo; v <= hi; v += step) out.add(f.max === 7 && v === 7 ? 0 : v)
  }
  return [...out].sort((a, b) => a - b)
}

function parseCron(expr: string): Matcher {
  const parts = expr.trim().split(/\s+/).filter(Boolean)
  if (parts.length !== 5) {
    throw new CronError(
      `A expressão cron precisa de 5 campos (minuto hora dia mês dia-da-semana); essa tem ${parts.length}. Exemplo: 0 9 * * 1-5 (dias úteis às 09:00).`,
    )
  }
  const [minutes, hours, days, months, weekdays] = parts.map((p, i) => field(p, FIELDS[i]))
  return {
    minutes,
    hours,
    days: new Set(days),
    months: new Set(months),
    weekdays: new Set(weekdays),
    anyDay: parts[2].startsWith('*'),
    anyWeekday: parts[4].startsWith('*'),
  }
}

const ALL_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)
const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

function atTime(time: string, weekdays?: number[]): Matcher {
  const [, h, m] = TIME_RE.exec(time) ?? ['', '9', '0']
  return {
    minutes: [Number(m)],
    hours: [Number(h)],
    days: new Set(ALL_DAYS),
    months: new Set(ALL_MONTHS),
    weekdays: new Set(weekdays ?? ALL_WEEKDAYS),
    anyDay: true,
    anyWeekday: !weekdays || weekdays.length === 7,
  }
}

function dayMatches(m: Matcher, d: Date): boolean {
  if (!m.months.has(d.getMonth() + 1)) return false
  const byDay = m.days.has(d.getDate())
  const byWeekday = m.weekdays.has(d.getDay())
  if (m.anyDay && m.anyWeekday) return true
  if (m.anyDay) return byWeekday
  if (m.anyWeekday) return byDay
  return byDay || byWeekday
}

function nextMatch(m: Matcher, after: number): number | null {
  const from = new Date(after)
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)
    if (!dayMatches(m, day)) continue
    for (const h of m.hours) {
      for (const min of m.minutes) {
        // A time skipped by daylight saving lands an hour later, like most schedulers do.
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min).getTime()
        if (t > after) return t
      }
    }
  }
  return null
}

/** Shortest gap between two runs of a cron, in minutes (from the minute and hour fields). */
function cronGap(m: Matcher): number {
  let gap = Infinity
  for (let i = 1; i < m.minutes.length; i++) gap = Math.min(gap, m.minutes[i] - m.minutes[i - 1])
  const hours = new Set(m.hours)
  const nextHourToo = m.hours.some((h) => hours.has((h + 1) % 24))
  if (nextHourToo) gap = Math.min(gap, 60 - m.minutes[m.minutes.length - 1] + m.minutes[0])
  return gap
}

// ---------- the schedule ----------

function onceTime(at: string): number | null {
  const r = ONCE_RE.exec(at)
  if (!r) return null
  const [y, mo, d, h, mi] = r.slice(1).map(Number)
  const t = new Date(y, mo - 1, d, h, mi)
  // 31/02 rolls over to March in Date: refuse it
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? t.getTime() : null
}

const intervalMs = (s: Extract<Schedule, { kind: 'interval' }>) => s.every * (s.unit === 'hours' ? 60 : 1) * MINUTE

function matcher(s: Schedule): Matcher | null {
  if (s.kind === 'daily') return atTime(s.time)
  if (s.kind === 'weekly') return atTime(s.time, s.days)
  if (s.kind === 'cron') return parseCron(s.expr)
  return null
}

/**
 * What is wrong with a schedule, in a sentence that says how to fix it; null when it is fine.
 * A "uma vez" in the past is not checked here (an old routine keeps its date): see `isPast`.
 */
export function scheduleError(s: Schedule): string | null {
  switch (s.kind) {
    case 'once':
      return onceTime(s.at) === null ? 'Escolha uma data e um horário válidos.' : null
    case 'daily':
      return TIME_RE.test(s.time) ? null : 'Escolha um horário (HH:MM).'
    case 'weekly':
      if (!s.days.length) return 'Marque pelo menos um dia da semana.'
      if (s.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Dia da semana inválido.'
      return TIME_RE.test(s.time) ? null : 'Escolha um horário (HH:MM).'
    case 'interval': {
      if (!Number.isInteger(s.every) || s.every < 1) return 'Diga de quanto em quanto tempo, com um número inteiro.'
      const min = intervalMs(s) / MINUTE
      if (min < MIN_INTERVAL_MIN) return `O mínimo é a cada ${MIN_INTERVAL_MIN} minutos.`
      if (min > MAX_INTERVAL_MIN) return 'O máximo é uma vez por semana. Para mais tempo, use "Dias da semana" ou cron.'
      return null
    }
    case 'cron': {
      let m: Matcher
      try {
        m = parseCron(s.expr)
      } catch (err) {
        return err instanceof CronError ? err.message : 'Expressão cron inválida.'
      }
      const gap = cronGap(m)
      if (gap < MIN_INTERVAL_MIN) {
        return `Essa expressão roda a cada ${gap} min; o mínimo entre execuções é ${MIN_INTERVAL_MIN} minutos. Use, por exemplo, */15 no campo de minutos.`
      }
      if (nextMatch(m, Date.now()) === null) return 'Essa expressão nunca roda (por exemplo, 31 de fevereiro). Confira o dia e o mês.'
      return null
    }
  }
}

/** A "uma vez" whose time already passed. */
export function isPast(s: Schedule, now = Date.now()): boolean {
  if (s.kind !== 'once') return false
  const t = onceTime(s.at)
  return t !== null && t <= now
}

/** The first run strictly after `after` (ms), or null when there is none. Invalid schedules have none. */
export function nextRun(s: Schedule, after: number): number | null {
  if (s.kind === 'once') {
    const t = onceTime(s.at)
    return t !== null && t > after ? t : null
  }
  if (s.kind === 'interval') {
    if (scheduleError(s)) return null
    const p = intervalMs(s)
    const anchor = s.anchor ?? 0
    const k = after < anchor ? 1 : Math.floor((after - anchor) / p) + 1
    return anchor + Math.max(1, k) * p
  }
  let m: Matcher | null
  try {
    m = matcher(s)
  } catch {
    return null
  }
  return m ? nextMatch(m, after) : null
}

/** The next `n` runs after `after`. */
export function nextRuns(s: Schedule, after: number, n: number): number[] {
  const out: number[] = []
  let t: number | null = after
  while (out.length < n && (t = nextRun(s, t)) !== null) out.push(t)
  return out
}

/** Runs in [from, to]: how many (up to `cap`), the first and the last. */
export function runsBetween(s: Schedule, from: number, to: number, cap = 1000): { count: number; first: number | null; last: number | null } {
  let count = 0
  let first: number | null = null
  let last: number | null = null
  let t = nextRun(s, from - 1)
  while (t !== null && t <= to && count < cap) {
    first ??= t
    last = t
    count++
    t = nextRun(s, t)
  }
  // more than `cap`: the last one still counts as the latest slot
  if (count === cap && t !== null && t <= to) {
    let k = t
    while (k <= to) {
      last = k
      const n = nextRun(s, k)
      if (n === null) break
      k = n
    }
  }
  return { count, first, last }
}

// ---------- words ----------

const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`

/** "de segunda a sexta", "toda terça", "aos sábados e domingos", "toda segunda, quarta e sexta". */
export function weekdaysText(days: number[]): string {
  const set = new Set(days)
  if (set.size >= 7) return 'todo dia'
  const order = WEEK_ORDER.filter((d) => set.has(d))
  if (order.length === 2 && set.has(0) && set.has(6)) return 'aos sábados e domingos'
  const each = (d: number) => (d === 0 || d === 6 ? 'todo' : 'toda')
  if (order.length === 1) return `${each(order[0])} ${DAYS[order[0]]}`
  const pos = order.map((d) => WEEK_ORDER.indexOf(d))
  if (order.length >= 3 && pos.every((p, i) => i === 0 || p === pos[i - 1] + 1)) return `de ${DAYS[order[0]]} a ${DAYS[order[order.length - 1]]}`
  return `${each(order[0])} ${order.slice(0, -1).map((d) => DAYS[d]).join(', ')} e ${DAYS[order[order.length - 1]]}`
}

function cronText(expr: string): string {
  let m: Matcher
  try {
    m = parseCron(expr)
  } catch {
    return `Roda conforme o cron "${expr.trim()}".`
  }
  const everyMonth = m.months.size === 12
  if (everyMonth && m.minutes.length === 1 && m.hours.length === 1) {
    const at = `às ${hhmm(m.hours[0], m.minutes[0])}`
    if (m.anyDay) return `Roda ${weekdaysText(m.anyWeekday ? ALL_WEEKDAYS : [...m.weekdays])} ${at}.`
    if (m.anyWeekday && m.days.size === 1) return `Roda todo dia ${[...m.days][0]} do mês ${at}.`
  }
  if (everyMonth && m.anyDay && m.anyWeekday && m.hours.length === 24) {
    if (m.minutes.length === 1) return m.minutes[0] === 0 ? 'Roda toda hora cheia.' : `Roda toda hora, aos ${m.minutes[0]} minutos.`
    const step = m.minutes[1] - m.minutes[0]
    if (m.minutes[0] === 0 && 60 % step === 0 && m.minutes.every((v, i) => v === i * step)) return `Roda a cada ${step} minutos.`
  }
  return `Roda conforme o cron "${expr.trim()}".`
}

/** "Roda de segunda a sexta às 09:00." */
export function describeSchedule(s: Schedule): string {
  switch (s.kind) {
    case 'once': {
      const t = onceTime(s.at)
      if (t === null) return 'Roda uma vez.'
      const d = new Date(t)
      return `Roda uma vez, em ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${hhmm(d.getHours(), d.getMinutes())}.`
    }
    case 'daily':
      return `Roda todo dia às ${s.time}.`
    case 'weekly':
      return `Roda ${weekdaysText(s.days)} às ${s.time}.`
    case 'interval':
      if (s.every === 1) return s.unit === 'hours' ? 'Roda a cada hora.' : 'Roda a cada minuto.'
      return `Roda a cada ${s.every} ${s.unit === 'hours' ? 'horas' : 'minutos'}.`
    case 'cron':
      return cronText(s.expr)
  }
}

const dayNumber = (t: number) => {
  const d = new Date(t)
  return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000)
}

/** "hoje, 14:00", "amanhã, 09:00", "qua, 15/10, 09:00", "15/10/2027, 09:00". */
export function formatWhen(t: number, now = Date.now()): string {
  const d = new Date(t)
  const time = hhmm(d.getHours(), d.getMinutes())
  const diff = dayNumber(t) - dayNumber(now)
  if (diff === 0) return `hoje, ${time}`
  if (diff === 1) return `amanhã, ${time}`
  if (diff === -1) return `ontem, ${time}`
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
  if (diff > 1 && diff < 7) return `${DAYS_SHORT[d.getDay()]}, ${date}, ${time}`
  if (d.getFullYear() === new Date(now).getFullYear()) return `${date}, ${time}`
  return `${date}/${d.getFullYear()}, ${time}`
}

/** "em 2h14", "em 14 min", "em 40 s", "em 3d 4h", "agora". */
export function countdown(t: number, now = Date.now()): string {
  const s = Math.floor((t - now) / 1000)
  if (s <= 0) return 'agora'
  if (s < 60) return `em ${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `em ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `em ${h}h${pad(m % 60)}`
  const d = Math.floor(h / 24)
  return h % 24 ? `em ${d}d ${h % 24}h` : `em ${d} ${d === 1 ? 'dia' : 'dias'}`
}

/** "Roda de segunda a sexta às 09:00. Próxima: amanhã, 09:00" */
export function scheduleSentence(s: Schedule, next: number | null, now = Date.now()): string {
  return `${describeSchedule(s)} ${next === null ? 'Sem próxima execução.' : `Próxima: ${formatWhen(next, now)}`}`
}
