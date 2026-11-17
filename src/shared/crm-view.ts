// Sala de CRM: as regras puras da tela (CR-04 a CR-06). O DOM fica em renderer/src/ui/crm; aqui é
// dado entrando e dado saindo, testado em test/crm-view.test.ts. Spec: docs/prd/sala-de-crm.md
// ("Experiência"). As contas de dinheiro, telefone e vencimento vêm de ./crm (CR-02).

import { dealAge, dueGroup, foldText, formatCents, formatPhone, paymentStatus, type DueGroup } from './crm'
import type {
  ContactConsent,
  CrmAuthor,
  CrmCollection,
  CrmData,
  CrmDelta,
  Customer,
  CustomerDraft,
  CustomerImportRow,
  Deal,
  DealDraft,
  ImportChoice,
  Payment,
  PaymentDraft,
  Pipeline,
  PipelineStage,
  Recurrence,
  RecurrenceDraft,
} from './types/crm'
import { CRM_LIMITS, DEFAULT_PIPELINE, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from './types/crm'
import type { TicketDraft } from './types/tickets'

const DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// ---------- o espelho do crm.json ----------

const COLLECTIONS: readonly CrmCollection[] = ['customers', 'deals', 'pipelines', 'payments', 'recurrences', 'suggestions']

/** Items in place by id (same id = replace, new ones at the end), minus the removed ids. */
export function mergeById<T extends { id: string }>(list: readonly T[], items: readonly T[], removed: readonly string[] = []): T[] {
  const drop = new Set(removed)
  const fresh = new Map(items.map((it) => [it.id, it]))
  const out: T[] = []
  for (const it of list) {
    if (drop.has(it.id)) continue
    const next = fresh.get(it.id)
    out.push(next ?? it)
    fresh.delete(it.id)
  }
  for (const it of fresh.values()) if (!drop.has(it.id)) out.push(it)
  return out
}

/**
 * The 'crm' event applied to the mirror: items in place by id, `removed`, the new settings.
 * `reload` is the store's job (it reads crmList again); here it changes nothing.
 */
export function applyCrmDelta(data: CrmData, delta: CrmDelta): CrmData {
  const next = { ...data } as CrmData
  const lists = next as unknown as Record<CrmCollection, { id: string }[]>
  for (const k of COLLECTIONS) {
    const items = (delta[k] ?? []) as { id: string }[]
    const gone = delta.removed?.[k] ?? []
    if (!items.length && !gone.length) continue
    lists[k] = mergeById(lists[k] ?? [], items, gone)
  }
  if (delta.settings) next.settings = delta.settings
  return next
}

/** What waits for the player: the number on the "CRM" button. Phase 1: the pending suggestions. */
export function crmWaiting(data: Pick<CrmData, 'suggestions'> | null): number {
  if (!data) return 0
  return data.suggestions.filter((s) => s.status === 'pending').length
}

// ---------- datas ----------

/** '2026-11-20' → '20/11/2026'; anything else comes back as is. */
export function brDate(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '')
}

/** A moment (ms) as '20/11/2026', local. */
export function brDateOf(t: number | undefined): string {
  if (!t) return ''
  const d = new Date(t)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** '2026-11' → 'nov/2026'. */
export function monthLabel(month: string | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '')
  if (!m) return month ?? ''
  return `${MONTH_SHORT[Number(m[2]) - 1] ?? m[2]}/${m[1]}`
}

/** 'AAAA-MM-DD' at noon local, so a calendar day sorts among moments without a time zone slip. */
export function dayToMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime()
}

/** "hoje", "1 dia", "12 dias": how long a deal sits in its stage. */
export function daysLabel(days: number): string {
  if (days <= 0) return 'hoje'
  return days === 1 ? '1 dia' : `${days} dias`
}

// ---------- tabela ----------

export type SortDir = 'asc' | 'desc'

export interface TableSort {
  col: string
  dir: SortDir
}

/** One column of the reusable table (ui/crm/table.ts). */
export interface CrmColumn<T> {
  id: string
  label: string
  /** What the cell shows. */
  text: (row: T) => string
  /** What the column filter searches, when it differs from the text (a phone's digits). */
  filterText?: (row: T) => string
  /** Sort key; missing = the text. Empty keys go last in both directions. */
  sortKey?: (row: T) => string | number | undefined
  /** Cents the footer sums. */
  cents?: (row: T) => number
  /** The first click sorts this way: dates and money start with the newest or biggest. */
  firstDir?: SortDir
  /** Off until chosen in "Colunas". */
  optional?: boolean
  align?: 'start' | 'end'
  /** Grid track; missing = minmax(120px, 1fr). */
  width?: string
}

/** Per column filters (column id → text typed), how the table remembers them. */
export type ColumnFilters = Readonly<Record<string, string>>

/** Words of `query`, folded (no accents, no case). */
function terms(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean)
}

/** Rows whose every filtered column has every word typed in its filter, accents and case aside. */
export function filterRows<T>(rows: readonly T[], columns: readonly CrmColumn<T>[], filters: ColumnFilters): T[] {
  const active = columns.map((c) => ({ c, words: terms(filters[c.id] ?? '') })).filter((f) => f.words.length)
  if (!active.length) return [...rows]
  return rows.filter((row) =>
    active.every(({ c, words }) => {
      const hay = foldText((c.filterText ?? c.text)(row))
      return words.every((w) => hay.includes(w))
    }),
  )
}

/** A filter has text in it. */
export function hasFilters(filters: ColumnFilters): boolean {
  return Object.values(filters).some((v) => v.trim() !== '')
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })
const isEmptyKey = (k: string | number | undefined) => k === undefined || k === '' || (typeof k === 'number' && Number.isNaN(k))

function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

/** Stable sort by the column: ties keep their order; empty values go last either way. */
export function sortRows<T>(rows: readonly T[], column: CrmColumn<T>, dir: SortDir): T[] {
  const key = column.sortKey ?? column.text
  const decorated = rows.map((row, i) => ({ row, i, k: key(row) }))
  decorated.sort((a, b) => {
    const ea = isEmptyKey(a.k)
    const eb = isEmptyKey(b.k)
    if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1
    const c = compareKeys(a.k as string | number, b.k as string | number)
    return (dir === 'asc' ? c : -c) || a.i - b.i
  })
  return decorated.map((d) => d.row)
}

/** A click on a column header: the same column flips; another starts in its first direction. */
export function nextSort<T>(current: TableSort | null, column: CrmColumn<T>): TableSort {
  if (current?.col === column.id) return { col: column.id, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { col: column.id, dir: column.firstDir ?? 'asc' }
}

/** The aria-sort of a header. */
export function ariaSort(sort: TableSort | null, colId: string): 'ascending' | 'descending' | 'none' {
  if (sort?.col !== colId) return 'none'
  return sort.dir === 'asc' ? 'ascending' : 'descending'
}

/** Filter, then sort: the rows on screen. */
export function tableRows<T>(rows: readonly T[], columns: readonly CrmColumn<T>[], filters: ColumnFilters, sort: TableSort | null): T[] {
  const shown = filterRows(rows, columns, filters)
  const col = sort ? columns.find((c) => c.id === sort.col) : undefined
  return col && sort ? sortRows(shown, col, sort.dir) : shown
}

/** "Colunas" as saved in localStorage: known ids only; null when nothing usable was saved. */
export function parseColumnPrefs<T>(raw: string | null, columns: readonly CrmColumn<T>[]): string[] | null {
  if (!raw) return null
  try {
    const list: unknown = JSON.parse(raw)
    if (!Array.isArray(list)) return null
    const known = new Set(columns.map((c) => c.id))
    const ids = [...new Set(list.filter((x): x is string => typeof x === 'string' && known.has(x)))]
    return ids.length ? ids : null
  } catch {
    return null
  }
}

/** The columns on screen, in their own order: the chosen ones, or those not optional. The first never hides. */
export function visibleColumns<T>(columns: readonly CrmColumn<T>[], chosen: readonly string[] | null): CrmColumn<T>[] {
  if (!chosen) return columns.filter((c) => !c.optional)
  const set = new Set(chosen)
  return columns.filter((c, i) => i === 0 || set.has(c.id))
}

/** Turns a column on or off in "Colunas". The first column stays. */
export function toggleColumn<T>(columns: readonly CrmColumn<T>[], chosen: readonly string[] | null, id: string): string[] {
  const now = visibleColumns(columns, chosen).map((c) => c.id)
  if (id === columns[0]?.id) return now
  const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id]
  return columns.filter((c) => next.includes(c.id)).map((c) => c.id)
}

/** The CSS grid of a row. */
export function gridTemplate<T>(columns: readonly CrmColumn<T>[]): string {
  return columns.map((c) => c.width ?? 'minmax(120px, 1fr)').join(' ')
}

/** From this many rows on, the table draws only the ones in view. */
export const VIRTUAL_FROM = 200

export interface VirtualWindow {
  /** First row drawn. */
  start: number
  /** One past the last row drawn. */
  end: number
  /** Blank space above and below the rows drawn (px). */
  top: number
  bottom: number
}

/** Which rows to draw: all of them up to VIRTUAL_FROM; above it, the ones in view plus `overscan` each side. */
export function virtualWindow(count: number, rowHeight: number, scrollTop: number, viewport: number, overscan = 8): VirtualWindow {
  if (count <= VIRTUAL_FROM || rowHeight <= 0) return { start: 0, end: count, top: 0, bottom: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const inView = Math.ceil(Math.max(0, viewport) / rowHeight) + 1
  const start = Math.max(0, Math.min(count, first - overscan))
  const end = Math.max(start, Math.min(count, first + inView + overscan))
  return { start, end, top: start * rowHeight, bottom: (count - end) * rowHeight }
}

/** The scrollTop that brings row `i` into view, moving as little as possible. */
export function scrollForRow(i: number, rowHeight: number, scrollTop: number, viewport: number): number {
  const top = i * rowHeight
  if (top < scrollTop) return top
  if (top + rowHeight > scrollTop + viewport) return Math.max(0, top + rowHeight - viewport)
  return scrollTop
}

/** The row the arrows land on: ↑ ↓, Home/End, PageUp/PageDown (a page = `page` rows). */
export function moveRow(current: number, count: number, key: string, page = 10): number {
  if (count <= 0) return -1
  const at = Math.max(0, Math.min(count - 1, current))
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, current < 0 ? 0 : at + 1)
    case 'ArrowUp':
      return Math.max(0, at - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    case 'PageDown':
      return Math.min(count - 1, at + page)
    case 'PageUp':
      return Math.max(0, at - page)
    default:
      return at
  }
}

/** Singular and plural of what the table lists: ['cliente', 'clientes']. */
export type Noun = readonly [one: string, many: string]

export const countOf = (n: number, noun: Noun): string => `${n} ${n === 1 ? noun[0] : noun[1]}`

/** Sum of a money column. */
export function sumColumn<T>(rows: readonly T[], column: CrmColumn<T> | undefined): number {
  if (!column?.cents) return 0
  let s = 0
  for (const r of rows) s += column.cents(r)
  return s
}

/** The footer: "12 pagamentos · R$ 1.234,56", "3 de 40 clientes". */
export function tableFooter(shown: number, total: number, noun: Noun, cents?: number): string {
  const n = shown === total ? countOf(shown, noun) : `${shown} de ${countOf(total, noun)}`
  return cents === undefined ? n : `${n} · ${formatCents(cents)}`
}

/** What the live region says after a sort or a filter: "12 clientes, ordenados por Último contato, decrescente". */
export function tableAnnouncement(shown: number, total: number, noun: Noun, sort: { label: string; dir: SortDir } | null): string {
  const n = shown === total ? countOf(shown, noun) : `${shown} de ${countOf(total, noun)}, filtrados`
  if (!sort) return n
  return `${n}, ordenados por ${sort.label}, ${sort.dir === 'asc' ? 'crescente' : 'decrescente'}`
}

// ---------- clientes ----------

/** "Maria · Padaria Trigo", or just one of them. */
export function customerTitle(c: Pick<Customer, 'name' | 'company'>): string {
  const company = c.company?.trim()
  return company && company !== c.name ? `${c.name} · ${company}` : c.name
}

/** Deals of each customer. */
export function dealsByCustomer(deals: readonly Deal[]): Map<string, Deal[]> {
  const map = new Map<string, Deal[]>()
  for (const d of deals) {
    const list = map.get(d.customerId)
    if (list) list.push(d)
    else map.set(d.customerId, [d])
  }
  return map
}

/** The pipeline by id; missing = the first one, or the default. */
export function pipelineOf(pipelines: readonly Pipeline[], id?: string): Pipeline {
  return (id ? pipelines.find((p) => p.id === id) : undefined) ?? pipelines[0] ?? DEFAULT_PIPELINE
}

export function stageOf(pipelines: readonly Pipeline[], pipelineId: string, stageId: string): PipelineStage | undefined {
  return (
    pipelineOf(pipelines, pipelineId).stages.find((s) => s.id === stageId) ??
    pipelines.flatMap((p) => p.stages).find((s) => s.id === stageId)
  )
}

export function stageName(pipelines: readonly Pipeline[], pipelineId: string, stageId: string): string {
  return stageOf(pipelines, pipelineId, stageId)?.name ?? 'Etapa removida'
}

/** The deal still in play (stage kind 'open'). */
export function dealOpen(pipelines: readonly Pipeline[], d: Deal): boolean {
  return (stageOf(pipelines, d.pipelineId, d.stageId)?.kind ?? 'open') === 'open'
}

/** "Etapa" of a customer: the stage of the newest open deal; with none open, of the newest deal. */
export function customerStage(deals: readonly Deal[] | undefined, pipelines: readonly Pipeline[]): string {
  if (!deals?.length) return ''
  const newest = (list: readonly Deal[]) => list.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
  const open = deals.filter((d) => dealOpen(pipelines, d))
  const d = newest(open.length ? open : deals)
  return stageName(pipelines, d.pipelineId, d.stageId)
}

export interface CustomerColumnsCtx {
  /** "Etapa" of the customer (customerStage). */
  stage(c: Customer): string
  /** Name of the floor (ProjectFloor), '' without one. */
  floor(c: Customer): string
}

/** The Clientes table: Cliente, Empresa, Telefone, Etiquetas, Etapa, Último contato, Próximo passo, Responsável, Andar. */
export function customerColumns(ctx: CustomerColumnsCtx): CrmColumn<Customer>[] {
  return [
    { id: 'name', label: 'Cliente', text: (c) => c.name, width: 'minmax(160px, 1.4fr)' },
    { id: 'company', label: 'Empresa', text: (c) => c.company ?? '' },
    {
      id: 'phone',
      label: 'Telefone',
      text: (c) => (c.phones[0] ? formatPhone(c.phones[0]) : ''),
      filterText: (c) => [...c.phones.map(formatPhone), ...c.phones].join(' '),
      sortKey: (c) => c.phones[0],
      width: 'minmax(150px, 1fr)',
    },
    { id: 'tags', label: 'Etiquetas', text: (c) => c.tags.join(', ') },
    { id: 'stage', label: 'Etapa', text: (c) => ctx.stage(c), width: 'minmax(110px, 0.8fr)' },
    {
      id: 'lastContact',
      label: 'Último contato',
      text: (c) => brDateOf(c.lastContactAt),
      sortKey: (c) => c.lastContactAt,
      firstDir: 'desc',
      width: 'minmax(120px, 0.8fr)',
    },
    {
      id: 'nextStep',
      label: 'Próximo passo',
      text: (c) => [c.nextStep ?? '', c.nextStepOn ? brDate(c.nextStepOn) : ''].filter(Boolean).join(' · '),
      sortKey: (c) => c.nextStepOn ?? (c.nextStep ? '9999' : undefined),
      width: 'minmax(160px, 1.3fr)',
    },
    { id: 'owner', label: 'Responsável', text: (c) => c.owner ?? '', optional: false },
    { id: 'floor', label: 'Andar', text: (c) => ctx.floor(c) },
  ]
}

/** The customer as the form sends it back (saveCustomer replaces the whole customer). */
export function customerToDraft(c: Customer): CustomerDraft {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    company: c.company,
    phones: [...c.phones],
    email: c.email,
    tags: [...c.tags],
    owner: c.owner,
    floor: c.floor,
    consent: { service: c.consent.service, billing: c.consent.billing, offers: c.consent.offers, offersSource: c.consent.offersSource },
    tickets: [...c.tickets],
    lastContactAt: c.lastContactAt,
    nextStep: c.nextStep,
    nextStepOn: c.nextStepOn,
  }
}

/** "site, loja , site" → ['site', 'loja']: tags or phones typed with commas. */
export function splitList(text: string, max: number = CRM_LIMITS.tags, each: number = CRM_LIMITS.tag): string[] {
  const out: string[] = []
  for (const raw of text.split(/[,;\n]/)) {
    const v = raw.trim().slice(0, each)
    if (v && !out.some((x) => foldText(x) === foldText(v))) out.push(v)
    if (out.length >= max) break
  }
  return out
}

/** Which field an error from the main process belongs to, so the form shows it there. */
export function fieldOfError(message: string): 'name' | 'phones' | 'email' | 'amount' | 'due' | 'customer' | null {
  const m = foldText(message)
  if (/telefone|numero|celular|whatsapp/.test(m)) return 'phones'
  if (/e-?mail/.test(m)) return 'email'
  if (/valor|centavo|r\$/.test(m)) return 'amount'
  if (/vencimento/.test(m)) return 'due'
  if (/cliente/.test(m) && /escolha|nao existe|sem cliente/.test(m)) return 'customer'
  if (/nome/.test(m)) return 'name'
  return null
}

export interface ConsentLine {
  label: string
  on: boolean
  /** "aceitou em 12/11/2026 · formulário do site", "pediu para sair em 12/11/2026", "não aceitou". */
  detail: string
  /** The customer asked to stop offers: turning offers back on warns first. */
  optedOut?: boolean
}

/** The contact permissions as the customer card shows them. */
export function consentLines(consent: ContactConsent): ConsentLine[] {
  const offers: ConsentLine = consent.optOutAt
    ? { label: 'Ofertas', on: false, detail: `pediu para sair em ${brDateOf(consent.optOutAt)}`, optedOut: true }
    : consent.offers
      ? {
          label: 'Ofertas',
          on: true,
          detail: [
            'aceitou' + (consent.offersAt ? ` em ${brDateOf(consent.offersAt)}` : ''),
            consent.offersSource?.trim() || 'origem não registrada',
          ].join(' · '),
        }
      : { label: 'Ofertas', on: false, detail: 'não aceitou' }
  return [
    { label: 'Atendimento', on: consent.service, detail: consent.service ? 'responder quem escreveu' : 'desligado' },
    { label: 'Cobrança', on: consent.billing, detail: consent.billing ? 'lembretes de pagamento em aberto' : 'desligado' },
    offers,
  ]
}

/** Who did it, for the timeline. */
export function authorLabel(by: CrmAuthor, botName: (id: string) => string | undefined = () => undefined): string {
  if (by.kind === 'player') return 'Você'
  if (by.kind === 'system') return 'O app'
  return botName(by.botId) ?? 'Bot removido'
}

export interface TimelineEntry {
  t: number
  kind: 'created' | 'note' | 'stage' | 'payment' | 'paid'
  text: string
  by: string
}

const SOURCE_LABEL: Record<Customer['source'], string> = {
  manual: 'cadastrado à mão',
  import: 'importado de uma planilha',
  whatsapp: 'chegou pelo WhatsApp',
  demo: 'de demonstração',
}

/** Notes, stage changes and payments of the customer, newest first. */
export function customerTimeline(
  c: Customer,
  deals: readonly Deal[],
  payments: readonly Payment[],
  pipelines: readonly Pipeline[],
  botName?: (id: string) => string | undefined,
): TimelineEntry[] {
  const out: TimelineEntry[] = [
    {
      t: c.createdAt,
      kind: 'created',
      text: `Cliente ${SOURCE_LABEL[c.source] ?? 'cadastrado'}`,
      by: c.source === 'manual' ? 'Você' : 'O app',
    },
  ]
  for (const n of c.notes) out.push({ t: n.t, kind: 'note', text: n.text, by: authorLabel(n.by, botName) })
  for (const d of deals) {
    if (d.customerId !== c.id) continue
    for (const h of d.history) {
      const to = stageName(pipelines, d.pipelineId, h.to)
      const text = h.from ? `${d.title}: ${stageName(pipelines, d.pipelineId, h.from)} → ${to}` : `${d.title}: entrou em ${to}`
      out.push({ t: h.t, kind: 'stage', text, by: authorLabel(h.by, botName) })
    }
  }
  for (const p of payments) {
    if (p.customerId !== c.id) continue
    out.push({
      t: p.createdAt,
      kind: 'payment',
      text: `Fatura ${p.invoice} · ${formatCents(p.amountCents)} · vence ${brDate(p.due)}`,
      by: p.recurrenceId ? 'O app' : 'Você',
    })
    if (p.state === 'paid' && p.paidOn)
      out.push({ t: dayToMs(p.paidOn), kind: 'paid', text: `Pagou a fatura ${p.invoice} · ${formatCents(p.amountCents)}`, by: 'Você' })
  }
  return out.sort((a, b) => b.t - a.t)
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Apagar este cliente": what goes with it, in one sentence. */
export function deleteCustomerText(c: Customer, data: Pick<CrmData, 'deals' | 'payments' | 'recurrences'>): string {
  const deals = data.deals.filter((d) => d.customerId === c.id).length
  const payments = data.payments.filter((p) => p.customerId === c.id).length
  const recurrences = data.recurrences.filter((r) => r.customerId === c.id).length
  const parts = [
    deals ? plural(deals, 'negócio', 'negócios') : '',
    payments ? plural(payments, 'pagamento', 'pagamentos') : '',
    recurrences ? plural(recurrences, 'recorrência', 'recorrências') : '',
    c.notes.length ? plural(c.notes.length, 'nota', 'notas') : '',
  ].filter(Boolean)
  const what = parts.length ? `Vão junto: ${joinPt(parts)}.` : 'Ele não tem negócios, pagamentos nem notas.'
  return `${customerTitle(c)} sai do CRM. ${what} Os tickets ligados ficam no quadro. Não dá para desfazer: exporte os dados antes se precisar guardá-los.`
}

/** ['a', 'b', 'c'] → 'a, b e c'. */
export function joinPt(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

// ---------- importação de CSV ----------

export interface ImportStats {
  /** New customers, ready. */
  fresh: number
  /** Phone already in the CRM: skip or update. */
  conflicts: number
  /** Rows that cannot go in. */
  errors: number
}

export function importStats(rows: readonly CustomerImportRow[]): ImportStats {
  let fresh = 0
  let conflicts = 0
  let errors = 0
  for (const r of rows) {
    if (r.error) errors++
    else if (r.conflictWith) conflicts++
    else fresh++
  }
  return { fresh, conflicts, errors }
}

/** What importCustomersCsv receives: rows with an error stay out; a conflict follows its choice (skip by default). */
export function importRequest(
  rows: readonly CustomerImportRow[],
  choices: ReadonlyMap<number, ImportChoice>,
): { draft: CustomerDraft; onConflict?: ImportChoice }[] {
  return rows
    .filter((r) => !r.error)
    .map((r) => (r.conflictWith ? { draft: r.draft, onConflict: choices.get(r.line) ?? 'skip' } : { draft: r.draft }))
}

/** "Importar 12 clientes e atualizar 2": the confirm button. */
export function importButtonLabel(rows: readonly CustomerImportRow[], choices: ReadonlyMap<number, ImportChoice>): string {
  const s = importStats(rows)
  const updates = rows.filter((r) => !r.error && r.conflictWith && choices.get(r.line) === 'update').length
  const parts = [s.fresh ? `importar ${plural(s.fresh, 'cliente', 'clientes')}` : '', updates ? `atualizar ${updates}` : ''].filter(Boolean)
  if (!parts.length) return 'Nada para importar'
  const text = parts.join(' e ')
  return text[0].toUpperCase() + text.slice(1)
}

// ---------- negócios ----------

export interface BoardColumn {
  stage: PipelineStage
  deals: Deal[]
  totalCents: number
}

/** The board: one column per stage of the pipeline, deals by `order` (then the oldest first). */
export function boardColumns(pipeline: Pipeline, deals: readonly Deal[]): BoardColumn[] {
  const mine = deals.filter((d) => d.pipelineId === pipeline.id || (!pipeline.stages.length && !d.pipelineId))
  return pipeline.stages.map((stage) => {
    const list = mine.filter((d) => d.stageId === stage.id).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    return { stage, deals: list, totalCents: list.reduce((s, d) => s + d.valueCents, 0) }
  })
}

/** ⌥←/⌥→: the stage next door, or null at the edge. */
export function neighborStage(pipeline: Pipeline, stageId: string, dir: -1 | 1): PipelineStage | null {
  const i = pipeline.stages.findIndex((s) => s.id === stageId)
  if (i < 0) return null
  return pipeline.stages[i + dir] ?? null
}

/** Deals whose customer or service has every word of `query`. */
export function filterDeals(deals: readonly Deal[], query: string, customer: (id: string) => Customer | undefined): Deal[] {
  const words = terms(query)
  if (!words.length) return [...deals]
  return deals.filter((d) => {
    const c = customer(d.customerId)
    const hay = foldText([d.title, c?.name ?? '', c?.company ?? '', d.nextStep ?? ''].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

/** What a screen reader hears on a deal card. */
export function dealCardLabel(d: Deal, customer: Customer | undefined, stage: string, now: number): string {
  const who = customer ? customerTitle(customer) : 'Cliente removido'
  const parts = [`${who}: ${d.title}`, formatCents(d.valueCents), `${stage}, ${daysLabel(dealAge(d, now))} na etapa`]
  if (d.nextStep) parts.push(`próximo passo: ${d.nextStep}`)
  return parts.join('. ')
}

export function dealToDraft(d: Deal): DealDraft {
  return {
    id: d.id,
    customerId: d.customerId,
    title: d.title,
    valueCents: d.valueCents,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    nextStep: d.nextStep,
    nextStepOn: d.nextStepOn,
    floor: d.floor,
    tickets: [...d.tickets],
  }
}

/**
 * "Criar ticket" of a deal: the ticket carries the customer, the service, the value and the next
 * step, and opens in the floor's folder (`cwd`) when the deal has one.
 */
export function dealTicketDraft(d: Deal, customer: Customer | undefined, stage: string, cwd?: string): TicketDraft {
  const who = customer ? customerTitle(customer) : 'Cliente removido'
  const lines = [
    `Negócio do CRM: **${d.title}** para **${who}**.`,
    '',
    `- Cliente: ${who}`,
    `- Serviço: ${d.title}`,
    `- Valor: ${formatCents(d.valueCents)}`,
    `- Etapa: ${stage}`,
  ]
  if (d.nextStep) lines.push(`- Próximo passo: ${d.nextStep}${d.nextStepOn ? ` (até ${brDate(d.nextStepOn)})` : ''}`)
  return {
    title: `${d.title} · ${customer?.name ?? who}`.slice(0, 160),
    type: 'task',
    priority: 'medium',
    status: 'todo',
    description: lines.join('\n'),
    cwd: cwd || undefined,
    tags: ['crm'],
    dueDate: d.nextStepOn ?? null,
  }
}

// ---------- pagamentos ----------

export type PaymentTab = DueGroup | 'all'

export const PAYMENT_TABS: readonly { id: PaymentTab; label: string }[] = [
  { id: 'upcoming', label: 'Próximos' },
  { id: 'overdue', label: 'Atrasados' },
  { id: 'history', label: 'Histórico' },
  { id: 'all', label: 'Todos' },
]

export function isPaymentTab(v: unknown): v is PaymentTab {
  return PAYMENT_TABS.some((t) => t.id === v)
}

/** The payments of a tab (dueGroup), or all. */
export function paymentsIn(payments: readonly Payment[], tab: PaymentTab, today: string): Payment[] {
  if (tab === 'all') return [...payments]
  return payments.filter((p) => dueGroup(p, today) === tab)
}

/** How many payments each tab holds. */
export function paymentTabCounts(payments: readonly Payment[], today: string): Record<PaymentTab, number> {
  const counts: Record<PaymentTab, number> = { upcoming: 0, overdue: 0, history: 0, all: payments.length }
  for (const p of payments) counts[dueGroup(p, today)]++
  return counts
}

/** Each tab opens sorted its own way: what is due soonest first; the history, the newest first. */
export function defaultPaymentSort(tab: PaymentTab): TableSort {
  return tab === 'upcoming' || tab === 'overdue' ? { col: 'due', dir: 'asc' } : { col: 'due', dir: 'desc' }
}

/** "Estado" of a payment: "Pago em 18/10/2026", "Atrasado", "Aberto". */
export function paymentStateText(p: Payment, today: string): string {
  const s = paymentStatus(p, today)
  if (s === 'paid' && p.paidOn) return `Pago em ${brDate(p.paidOn)}`
  return PAYMENT_STATUS_LABEL[s]
}

/** The Pagamentos table: Cliente, Fatura, Valor, Vencimento, Referente a, Método, Responsável, Estado. */
export function paymentColumns(ctx: { customer(id: string): Customer | undefined; today(): string }): CrmColumn<Payment>[] {
  return [
    {
      id: 'customer',
      label: 'Cliente',
      text: (p) => {
        const c = ctx.customer(p.customerId)
        return c ? customerTitle(c) : 'Cliente removido'
      },
      width: 'minmax(170px, 1.4fr)',
    },
    { id: 'invoice', label: 'Fatura', text: (p) => p.invoice, width: 'minmax(110px, 0.7fr)' },
    {
      id: 'amount',
      label: 'Valor',
      text: (p) => formatCents(p.amountCents),
      sortKey: (p) => p.amountCents,
      cents: (p) => p.amountCents,
      firstDir: 'desc',
      align: 'end',
      width: 'minmax(110px, 0.7fr)',
    },
    { id: 'due', label: 'Vencimento', text: (p) => brDate(p.due), sortKey: (p) => p.due, width: 'minmax(110px, 0.7fr)' },
    { id: 'reference', label: 'Referente a', text: (p) => p.reference, width: 'minmax(160px, 1.3fr)' },
    { id: 'method', label: 'Método', text: (p) => PAYMENT_METHOD_LABEL[p.method] ?? p.method, width: 'minmax(100px, 0.6fr)' },
    { id: 'owner', label: 'Responsável', text: (p) => p.owner ?? '' },
    { id: 'state', label: 'Estado', text: (p) => paymentStateText(p, ctx.today()), width: 'minmax(130px, 0.8fr)' },
  ]
}

/** "Todo dia 20 · R$ 480,00 · Manutenção · desde nov/2026". */
export function recurrenceLabel(r: Pick<Recurrence, 'day' | 'amountCents' | 'reference' | 'start' | 'end'>): string {
  const period = r.end ? `de ${monthLabel(r.start)} a ${monthLabel(r.end)}` : `desde ${monthLabel(r.start)}`
  return [`Todo dia ${r.day}`, formatCents(r.amountCents), r.reference, period].join(' · ')
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/

/** What is wrong with a new payment before it goes to the main process (which checks again). */
export function paymentDraftError(d: Partial<PaymentDraft>): { field: 'customer' | 'amount' | 'due' | 'reference'; text: string } | null {
  if (!d.customerId) return { field: 'customer', text: 'Escolha o cliente do pagamento.' }
  if (!d.amountCents || d.amountCents <= 0) return { field: 'amount', text: 'Escreva o valor, por exemplo 480 ou 1.250,00.' }
  if (d.amountCents > CRM_LIMITS.amountCents)
    return { field: 'amount', text: 'O valor passa do limite de R$ 100 milhões. Confira os zeros.' }
  if (!d.due || !ISO_DAY.test(d.due)) return { field: 'due', text: 'Escolha a data de vencimento.' }
  if (!d.reference?.trim()) return { field: 'reference', text: 'Diga a que o pagamento se refere, por exemplo "Manutenção · novembro".' }
  return null
}

/** What is wrong with a recurrence before it goes to the main process. */
export function recurrenceDraftError(
  d: Partial<RecurrenceDraft>,
): { field: 'customer' | 'amount' | 'day' | 'reference' | 'start' | 'end'; text: string } | null {
  if (!d.customerId) return { field: 'customer', text: 'Escolha o cliente da recorrência.' }
  if (!d.amountCents || d.amountCents <= 0) return { field: 'amount', text: 'Escreva o valor de cada mês, por exemplo 480.' }
  if (d.amountCents > CRM_LIMITS.amountCents)
    return { field: 'amount', text: 'O valor passa do limite de R$ 100 milhões. Confira os zeros.' }
  if (!Number.isInteger(d.day) || (d.day ?? 0) < 1 || (d.day ?? 0) > 31) return { field: 'day', text: 'O dia do vencimento vai de 1 a 31.' }
  if (!d.reference?.trim()) return { field: 'reference', text: 'Diga a que se refere, por exemplo "Manutenção".' }
  if (!d.start || !ISO_MONTH.test(d.start)) return { field: 'start', text: 'Escolha o mês do primeiro pagamento.' }
  if (d.end && (!ISO_MONTH.test(d.end) || d.end < d.start))
    return { field: 'end', text: 'O último mês vem depois do primeiro. Deixe vazio para não ter fim.' }
  return null
}

/** 'AAAA-MM' of a 'AAAA-MM-DD'. */
export const monthOf = (day: string): string => day.slice(0, 7)

/** Whole days between two calendar days (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayToMs(b) - dayToMs(a)) / DAY)
}
