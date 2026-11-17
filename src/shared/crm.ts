// Sala de CRM: funções puras de telefone, dinheiro, datas, recorrência, CSV e busca.
// Spec: docs/prd/sala-de-crm.md. Plano: docs/prd/sala-de-crm-plano.md (CR-02).
//
// Dinheiro anda em centavos e datas de calendário em 'AAAA-MM-DD' local; meses em 'AAAA-MM'.
// As contas de calendário rodam em UTC, para que o horário de verão não mude um dia.

import {
  CRM_LIMITS,
  DEFAULT_PIPELINE,
  type CrmData,
  type CrmHit,
  type Customer,
  type CustomerDraft,
  type CustomerImportRow,
  type Deal,
  type Payment,
  type PaymentStatus,
  type Recurrence,
} from './types'

const DAY_MS = 86_400_000
const pad = (n: number, w = 2) => String(n).padStart(w, '0')

// ---------- texto ----------

/** Lower case, no accents, spaces collapsed: what search and filters compare. */
export function foldText(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- telefone ----------

/** DDDs em uso no Brasil (Anatel). */
const BR_DDD = new Set(
  [
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71,
    73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
  ].map(String),
)

/** DDD + local part ('11987654321' or '1134567890') to '55…', or null. */
function brazil(rest: string): string | null {
  if (rest.length !== 10 && rest.length !== 11) return null
  const ddd = rest.slice(0, 2)
  if (!BR_DDD.has(ddd)) return null
  let local = rest.slice(2)
  // A mobile written before 2016, without the 9th digit.
  if (local.length === 8 && /^[6-9]/.test(local)) local = `9${local}`
  if (local.length === 9 && !local.startsWith('9')) return null
  if (local.length === 8 && !/^[2-5]/.test(local)) return null
  return `55${ddd}${local}`
}

/**
 * A phone as typed ('(11) 98765-4321', '+55 11 8765-4321', '011 3456-7890') to digits with the
 * country code ('5511987654321'), or null when it is not a phone. Brazil (the default country):
 * the DDD is required, a mobile missing its 9th digit gets it, and a carrier code after the
 * leading 0 is dropped. Other countries need the '+' (or 00) and stay as typed.
 */
export function normalizePhone(raw: string, country = '55'): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null
  const text = raw.trim()
  if (!/^\+?[\d\s().\-\u00a0]+$/.test(text)) return null
  let digits = text.replace(/\D/g, '')
  let intl = text.startsWith('+')
  if (!intl && text.startsWith('00')) {
    digits = digits.slice(2)
    intl = true
  }
  if (!digits || digits.length > CRM_LIMITS.phoneDigits + 3) return null
  const cc = /^\d{1,3}$/.test(country) ? country : '55'
  let out: string | null
  if (intl) out = digits.startsWith('55') ? brazil(digits.slice(2)) : digits
  else if (cc === '55') {
    if (digits.startsWith('0')) {
      digits = digits.slice(1)
      // 0 + carrier (2 digits) + DDD + number
      if ((digits.length === 12 || digits.length === 13) && !digits.startsWith('55')) digits = digits.slice(2)
    }
    if (digits.length === 10 || digits.length === 11) out = brazil(digits)
    else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) out = brazil(digits.slice(2))
    else out = null
  } else {
    if (digits.startsWith('0')) digits = digits.slice(1)
    out = digits.startsWith(cc) && digits.length >= cc.length + 6 ? digits : cc + digits
  }
  if (!out || out.length < 8 || out.length > CRM_LIMITS.phoneDigits || out.startsWith('0')) return null
  return out
}

/** '5511987654321' -> '55•••••••4321', for logs: the country code and the last four digits only. */
export function maskPhone(phone: string): string {
  const d = String(phone ?? '').replace(/\D/g, '')
  if (d.length <= 6) return '•'.repeat(Math.max(d.length, 1))
  return `${d.slice(0, 2)}${'•'.repeat(d.length - 6)}${d.slice(-4)}`
}

/** '5511987654321' -> '+55 11 98765-4321'; another country -> '+<digits>'. */
export function formatPhone(phone: string): string {
  const d = String(phone ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const local = d.slice(4)
    const cut = local.length - 4
    return `+55 ${d.slice(2, 4)} ${local.slice(0, cut)}-${local.slice(cut)}`
  }
  return d ? `+${d}` : String(phone ?? '')
}

// ---------- dinheiro ----------

/** 123456 -> '1.234,56' (no currency sign): CSV cells and form fields. */
export function formatAmount(cents: number): string {
  if (!Number.isFinite(cents)) return '0,00'
  const abs = Math.round(Math.abs(cents))
  const int = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cents < 0 && abs > 0 ? '-' : ''}${int},${pad(abs % 100)}`
}

/** 123456 -> 'R$ 1.234,56'. */
export function formatCents(cents: number): string {
  const s = formatAmount(cents)
  return s.startsWith('-') ? `-R$ ${s.slice(1)}` : `R$ ${s}`
}

/** '1.234' or '1,234' with 3-digit groups after the first: thousands separators. */
const groupsOk = (s: string, sep: string) => {
  const g = s.split(sep)
  return /^\d{1,3}$/.test(g[0]) && g.slice(1).every((x) => /^\d{3}$/.test(x))
}

/**
 * Money as typed to cents: '1.234,56', 'R$ 480', '480.5', '1,234.56'. A single separator with
 * one or two digits after it is the decimal one; with three, it groups thousands. Null for
 * anything else (negative, letters, two decimal marks).
 */
export function parseMoney(text: string): number | null {
  if (typeof text !== 'string' || text.length > 40) return null
  const s = text.replace(/[\s\u00a0]/g, '').replace(/^R\$/i, '')
  if (!s || !/^[\d.,]+$/.test(s)) return null
  const dot = s.lastIndexOf('.')
  const comma = s.lastIndexOf(',')
  let int: string
  let dec = ''
  if (dot >= 0 && comma >= 0) {
    const decSep = dot > comma ? '.' : ','
    const at = s.lastIndexOf(decSep)
    if (s.indexOf(decSep) !== at) return null
    int = s.slice(0, at)
    dec = s.slice(at + 1)
    const thou = decSep === '.' ? ',' : '.'
    if (!groupsOk(int, thou)) return null
    int = int.split(thou).join('')
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? '.' : ','
    const parts = s.split(sep)
    if (parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2) [int, dec] = parts
    else if (groupsOk(s, sep)) int = parts.join('')
    else return null
  } else int = s
  if (!int && dec) int = '0'
  if (!/^\d+$/.test(int) || !/^\d{0,2}$/.test(dec)) return null
  const cents = Number(int) * 100 + Number(dec.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

/** Sum of the amounts, in cents. */
export function sumPayments(ps: readonly Pick<Payment, 'amountCents'>[]): number {
  let sum = 0
  for (const p of ps) sum += p.amountCents
  return sum
}

// ---------- datas ----------

/** 'AAAA-MM-DD' in the local time zone. */
export function localDate(t: number | Date): string {
  const d = t instanceof Date ? t : new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^(\d{4})-(\d{2})$/

/** Days in month `m` (1 to 12) of year `y`. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** A real calendar day as 'AAAA-MM-DD' (no 31/04, no 29/02 outside leap years), years 1900 to 2999. */
export function isDay(s: unknown): s is string {
  const m = typeof s === 'string' ? DAY_RE.exec(s) : null
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}

/** A month as 'AAAA-MM', years 1900 to 2999. */
export function isMonth(s: unknown): s is string {
  const m = typeof s === 'string' ? MONTH_RE.exec(s) : null
  return !!m && Number(m[1]) >= 1900 && Number(m[1]) <= 2999 && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

const utcDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUtc = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 'AAAA-MM-DD' plus `n` days (negative goes back). */
export function addDays(day: string, n: number): string {
  return fromUtc(utcDay(day) + Math.trunc(n) * DAY_MS)
}

/** 'AAAA-MM' plus `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const k = y * 12 + (m - 1) + Math.trunc(n)
  return `${pad(Math.floor(k / 12), 4)}-${pad((k % 12) + 1)}`
}

/** Whole months from `a` to `b` ('AAAA-MM'); negative when b comes first. */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA'. */
export function formatDay(day: string): string {
  const m = DAY_RE.exec(day)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : day
}

/** 'AAAA-MM-DD' -> 'DD/MM'. */
export function shortDay(day: string): string {
  const m = DAY_RE.exec(day)
  return m ? `${m[3]}/${m[2]}` : day
}

export const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] as const

/** '2026-11' -> 'novembro/2026'. */
export function monthLabel(month: string): string {
  const m = MONTH_RE.exec(month)
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]}/${m[1]}` : month
}

// ---------- pagamentos ----------

/** What the screen shows: an open payment past its due date is overdue. */
export function paymentStatus(p: Pick<Payment, 'state' | 'due'>, today: string): PaymentStatus {
  return p.state === 'open' && p.due < today ? 'overdue' : p.state
}

/** Tab of the Pagamentos screen: Próximos, Atrasados or Histórico. */
export type DueGroup = 'upcoming' | 'overdue' | 'history'

/** Open or disputed: overdue once the due date passed, else upcoming. Paid and canceled: history. */
export function dueGroup(p: Pick<Payment, 'state' | 'due'>, today: string): DueGroup {
  if (p.state === 'paid' || p.state === 'canceled') return 'history'
  return p.due < today ? 'overdue' : 'upcoming'
}

// ---------- recorrência ----------

/** Due date of the recurrence in that month: day 31 in a short month falls on its last day. */
export function recurrenceDue(r: Pick<Recurrence, 'day'>, month: string): string {
  const [y, m] = month.split('-').map(Number)
  const day = Math.min(Math.max(1, Math.trunc(r.day) || 1), daysInMonth(y, m))
  return `${month}-${pad(day)}`
}

/** "Manutenção · novembro/2026": the payment's "referente a". */
export function recurrenceReference(r: Pick<Recurrence, 'reference'>, month: string): string {
  return `${r.reference.trim() || 'Pagamento'} · ${monthLabel(month)}`
}

/** Most payments one pass makes for a recurrence (an app closed for a year). */
const RECURRENCE_BATCH = 12

/**
 * The months that should already have their payment: due minus leadDays is today or earlier,
 * after r.lastMonth, from r.start, up to r.end. At most the 12 newest. None for a paused one.
 */
export function recurrenceMonths(r: Recurrence, today: string, leadDays: number): { month: string; due: string }[] {
  if (!r.active || !isMonth(r.start) || !isDay(today)) return []
  const lead = Math.max(0, Math.trunc(leadDays) || 0)
  let from = isMonth(r.lastMonth) && r.lastMonth >= r.start ? addMonths(r.lastMonth, 1) : r.start
  // Past this month no due date minus lead can reach today.
  let to = addDays(today, lead).slice(0, 7)
  if (isMonth(r.end) && r.end < to) to = r.end
  if (monthsBetween(from, to) > RECURRENCE_BATCH) from = addMonths(to, -RECURRENCE_BATCH)
  const out: { month: string; due: string }[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    const due = recurrenceDue(r, m)
    if (addDays(due, -lead) <= today) out.push({ month: m, due })
  }
  return out.slice(-RECURRENCE_BATCH)
}

/** The next due date still to come (today or later), for "próximo: 20/12"; null when paused or past its end. */
export function nextRecurrence(r: Recurrence, today: string): { month: string; due: string } | null {
  if (!r.active || !isMonth(r.start) || !isDay(today)) return null
  let m = r.start
  if (isMonth(r.lastMonth) && addMonths(r.lastMonth, 1) > m) m = addMonths(r.lastMonth, 1)
  if (today.slice(0, 7) > m) m = today.slice(0, 7)
  for (let i = 0; i < 2; i++, m = addMonths(m, 1)) {
    if (isMonth(r.end) && m > r.end) return null
    const due = recurrenceDue(r, m)
    if (due >= today) return { month: m, due }
  }
  return null
}

// ---------- negócios ----------

/** Whole days the deal has been in its stage. */
export function dealAge(d: Pick<Deal, 'stageAt'>, now: number): number {
  return Math.max(0, Math.floor((now - d.stageAt) / DAY_MS))
}

// ---------- CSV ----------

/** A cell a spreadsheet would run as a formula (CSV injection): = + - @, tab or CR first. */
const FORMULA = /^[=+\-@\t\r]/
/**
 * The same after a separator inside the cell. Excel set to ',' (en-US) ignores quotes that do not
 * open the field, so "a,=1+1" splits into a cell "=1+1" and runs it.
 */
const INNER_FORMULA = /([,;\t\r\n][\s"]*)([=+\-@])/g

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v).replace('.', ',') : '') : String(v)
  if (FORMULA.test(s)) s = `'${s}`
  s = s.replace(INNER_FORMULA, "$1'$2")
  return /[;,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * A CSV for Excel in pt-BR: UTF-8 with BOM, ';' between cells, CRLF between lines. Cells with
 * ; , quotes or line breaks go in quotes; a cell starting with = + - @, tab or CR gets a ' in
 * front, so the spreadsheet shows it as text instead of running it, and so does = + - @ right
 * after a , ; tab or line break inside the cell.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `\ufeff${[header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`
}

/** The separator of a CSV, from its first line: the most frequent of ; , and tab (ties go in that order). */
function csvDelimiter(text: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '\n' || ch === '\r')) break
    else if (!quoted && ch in counts) counts[ch]++
  }
  return [';', ',', '\t'].reduce((best, d) => (counts[d] > counts[best] ? d : best), ';')
}

/** RFC 4180 records: quotes with doubled quotes inside, line breaks inside quotes, CRLF, LF or CR. */
function csvRecords(text: string, delim: string, max: number): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let started = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
      continue
    }
    if (ch === '"' && !started) {
      quoted = true
      started = true
    } else if (ch === delim) {
      row.push(field)
      field = ''
      started = false
    } else if (ch === '\r' || ch === '\n') {
      row.push(field)
      out.push(row)
      row = []
      field = ''
      started = false
      if (ch === '\r' && text[i + 1] === '\n') i++
      if (out.length >= max) return out
    } else {
      field += ch
      started = true
    }
  }
  if (started || row.length) {
    row.push(field)
    out.push(row)
  }
  return out
}

type CsvField = 'name' | 'company' | 'phone' | 'email' | 'tags' | 'owner'

/** Column names a customers sheet uses, folded and without punctuation. */
const CSV_HEADERS: Record<string, CsvField> = {
  nome: 'name',
  name: 'name',
  cliente: 'name',
  contato: 'name',
  nomecompleto: 'name',
  empresa: 'company',
  company: 'company',
  razaosocial: 'company',
  organizacao: 'company',
  telefone: 'phone',
  telefones: 'phone',
  celular: 'phone',
  whatsapp: 'phone',
  fone: 'phone',
  tel: 'phone',
  phone: 'phone',
  email: 'email',
  emails: 'email',
  etiquetas: 'tags',
  etiqueta: 'tags',
  tags: 'tags',
  tag: 'tags',
  responsavel: 'owner',
  owner: 'owner',
  dono: 'owner',
}

const headerKey = (h: string) => foldText(h).replace(/[^a-z0-9]/g, '')

/** What a customer's e-mail must look like. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The rows of a customers CSV (export of another tool or a sheet): separator by the header (; ,
 * or tab), BOM accepted, pt-BR column names with or without accents. Phones are normalized. A row
 * without a name, with a bad phone or e-mail, or repeating a phone of an earlier row comes with
 * `error`. At most CRM_LIMITS.csvRows rows; offers always arrive off. `conflictWith` (a phone that
 * already has a customer) is the main process's to fill.
 */
export function parseCustomersCsv(text: string): CustomerImportRow[] {
  const body = String(text ?? '').replace(/^\ufeff/, '')
  const records = csvRecords(body, csvDelimiter(body), CRM_LIMITS.csvRows + 2)
  const header = records.shift() ?? []
  const cols: Partial<Record<CsvField, number[]>> = {}
  header.forEach((h, i) => {
    const f = CSV_HEADERS[headerKey(h)]
    if (f) (cols[f] ??= []).push(i)
  })
  const rows: CustomerImportRow[] = []
  const seen = new Map<string, number>()
  for (let r = 0; r < records.length; r++) {
    const rec = records[r]
    const line = r + 1
    if (rec.every((c) => !c.trim())) continue
    if (rows.length >= CRM_LIMITS.csvRows) {
      rows.push({ line, draft: { name: '' }, error: `O arquivo passa de ${CRM_LIMITS.csvRows.toLocaleString('pt-BR')} linhas: as seguintes ficaram de fora.` })
      break
    }
    const cell = (f: CsvField) => (cols[f] ?? []).map((i) => (rec[i] ?? '').trim())
    const first = (f: CsvField) => (cell(f).find(Boolean) ?? '').replace(/\s+/g, ' ')
    const name = first('name')
    const company = first('company').slice(0, CRM_LIMITS.company)
    const email = first('email')
    const owner = first('owner').slice(0, CRM_LIMITS.owner)
    const typed = cell('phone')
      .flatMap((c) => c.split(/[/|;,]/))
      .map((p) => p.trim())
      .filter(Boolean)
    const normalized = typed.map((p) => normalizePhone(p))
    const phones = [...new Set(normalized.filter((p): p is string => !!p))]
    const tags: string[] = []
    for (const t of cell('tags').flatMap((c) => c.split(/[,;|]/))) {
      const tag = t.trim().replace(/\s+/g, ' ').slice(0, CRM_LIMITS.tag)
      if (tag && !tags.some((x) => foldText(x) === foldText(tag)) && tags.length < CRM_LIMITS.tags) tags.push(tag)
    }
    const draft: CustomerDraft = {
      name: name.slice(0, CRM_LIMITS.name),
      ...(company ? { company } : {}),
      phones,
      ...(email ? { email } : {}),
      tags,
      ...(owner ? { owner } : {}),
      consent: { offers: false },
    }
    const repeated = phones.map((p) => seen.get(p)).find((n) => n !== undefined)
    const error = !name
      ? 'Linha sem nome: preencha a coluna Nome.'
      : name.length > CRM_LIMITS.name
        ? `O nome passa de ${CRM_LIMITS.name} letras.`
        : normalized.some((p) => !p)
          ? 'Telefone inválido: use DDD e número, como (11) 98765-4321.'
          : phones.length > CRM_LIMITS.phones
            ? `Mais de ${CRM_LIMITS.phones} telefones na mesma linha.`
            : email && (email.length > CRM_LIMITS.email || !EMAIL_RE.test(email))
              ? 'E-mail inválido.'
              : repeated !== undefined
                ? `Telefone repetido: já aparece na linha ${repeated}.`
                : undefined
    if (!error) for (const p of phones) seen.set(p, line)
    rows.push({ line, draft, ...(error ? { error } : {}) })
  }
  return rows
}

// ---------- busca ----------

/** "Maria · Padaria Trigo", or the name alone. */
export function customerTitle(c: Pick<Customer, 'name' | 'company'>): string {
  return c.company ? `${c.name} · ${c.company}` : c.name
}

/** "vence 20/11", "venceu 10/11", "pago 18/10"…: where a payment stands, in words. */
export function paymentWhen(p: Pick<Payment, 'state' | 'due' | 'paidOn'>, today: string): string {
  switch (paymentStatus(p, today)) {
    case 'paid':
      return `pago ${shortDay(p.paidOn ?? p.due)}`
    case 'overdue':
      return `venceu ${shortDay(p.due)}`
    case 'canceled':
      return 'cancelado'
    case 'disputed':
      return `em disputa · vence ${shortDay(p.due)}`
    default:
      return `vence ${shortDay(p.due)}`
  }
}

const KIND_RANK: Record<CrmHit['kind'], number> = { customer: 0, deal: 1, payment: 2 }

/**
 * Customers, deals and payments matching the query, best first: every word in the name,
 * company, e-mail, tags, owner, deal title, invoice or reference (no accents, any case), or
 * part of a phone (digits only: '98765', '(11) 9876'). Deals and payments also match by their
 * customer. The stage names come from data.pipelines when it has them.
 */
export function searchCrm(data: Pick<CrmData, 'customers' | 'deals' | 'payments'>, query: string, today: string, limit: number = CRM_LIMITS.searchHits): CrmHit[] {
  const q = foldText(String(query ?? '').slice(0, CRM_LIMITS.query))
  if (!q) return []
  const words = q.split(' ')
  const digits = q.replace(/\D/g, '')
  const phoneLike = digits.length >= 3 && /^[\d\s().+-]+$/.test(q)
  const all = (hay: string) => words.every((w) => hay.includes(w))
  const pipelines = (data as Partial<Pick<CrmData, 'pipelines'>>).pipelines ?? [DEFAULT_PIPELINE]
  const stageName = (d: Deal) => pipelines.find((p) => p.id === d.pipelineId)?.stages.find((s) => s.id === d.stageId)?.name ?? d.stageId

  const people = new Map<string, { c: Customer; hay: string; phone: boolean }>()
  for (const c of data.customers) {
    const hay = foldText([c.name, c.company, c.email, c.owner, ...c.tags].filter(Boolean).join(' '))
    people.set(c.id, { c, hay, phone: phoneLike && c.phones.some((p) => p.includes(digits)) })
  }

  const hits: (CrmHit & { score: number })[] = []
  for (const { c, hay, phone } of people.values()) {
    const name = foldText(c.name)
    let score = phone ? 90 : 0
    if (all(hay)) score = Math.max(score, name.startsWith(q) ? 100 : name.split(' ').some((w) => w.startsWith(words[0])) ? 80 : 65)
    if (!score) continue
    const detail = [c.phones[0] ? formatPhone(c.phones[0]) : '', c.tags.join(', ')].filter(Boolean).join(' · ')
    hits.push({ kind: 'customer', id: c.id, customerId: c.id, title: customerTitle(c), detail, score })
  }
  for (const d of data.deals) {
    const who = people.get(d.customerId)
    const title = foldText(d.title)
    let score = title.startsWith(q) ? 70 : all(title) ? 60 : who && all(`${title} ${who.hay}`) ? 30 : 0
    if (who?.phone) score = Math.max(score, 25)
    if (!score) continue
    hits.push({ kind: 'deal', id: d.id, customerId: d.customerId, title: who ? `${d.title} · ${who.c.name}` : d.title, detail: `${stageName(d)} · ${formatCents(d.valueCents)}`, score })
  }
  for (const p of data.payments) {
    const who = people.get(p.customerId)
    const own = foldText(`${p.invoice} ${p.reference}`)
    const score = foldText(p.invoice).startsWith(q) ? 75 : all(own) ? 55 : who && all(`${own} ${who.hay}`) ? 20 : who?.phone ? 15 : 0
    if (!score) continue
    hits.push({
      kind: 'payment',
      id: p.id,
      customerId: p.customerId,
      title: who ? `${p.invoice} · ${who.c.name}` : p.invoice,
      detail: `${paymentWhen(p, today)} · ${formatCents(p.amountCents)}`,
      score,
    })
  }
  return hits
    .sort((a, b) => b.score - a.score || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.title.localeCompare(b.title, 'pt-BR'))
    .slice(0, Math.max(0, limit))
    .map(({ score: _score, ...hit }) => hit)
}
