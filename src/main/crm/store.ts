import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  CRM_DEFAULTS,
  CRM_LIMITS,
  DEFAULT_PIPELINE,
  type ContactConsent,
  type CrmAuthor,
  type CrmCollection,
  type CrmData,
  type CrmDelta,
  type CrmSettings,
  type Customer,
  type CustomerImportResult,
  type CustomerSource,
  type Deal,
  type ImportChoice,
  type OutboxItem,
  type Payment,
  type Pipeline,
  type PipelineStage,
  type Recurrence,
  type Suggestion,
} from '@shared/types'
import { formatDay, isDay, isMonth, localDate, maskPhone, recurrenceMonths, recurrenceReference } from '@shared/crm'
import { backupCopies, shapeOf } from '../backups'
import { bakPath, loadJson, reportLoad, writeJsonAtomic } from '../fs-safe'
import { log } from '../log'
import { CRM_ID_RE, cleanCrmSettings, type CleanConsent, type CleanCustomerDraft, type CleanDealDraft, type CleanPaymentDraft, type CleanRecurrenceDraft } from '../validate'

const FILE_MODE = 0o600
const DIR_MODE = 0o700
const PLAYER: CrmAuthor = { kind: 'player' }
/** Latest time the CRM keeps (year 2999), in ms. */
const MAX_MS = 32_503_680_000_000

const GONE = {
  customers: 'Esse cliente não existe mais. Ele pode ter sido apagado em outra janela.',
  deals: 'Esse negócio não existe mais. Ele pode ter sido apagado em outra janela.',
  pipelines: 'Esse funil não existe mais. Feche e abra o formulário de novo.',
  payments: 'Esse pagamento não existe mais. Ele pode ter sido apagado em outra janela.',
  recurrences: 'Essa recorrência não existe mais. Ela pode ter sido apagada em outra janela.',
  suggestions: 'Essa sugestão não existe mais.',
} satisfies Record<CrmCollection, string>

const NAMES: Record<'customers' | 'deals' | 'payments' | 'recurrences', string> = { customers: 'clientes', deals: 'negócios', payments: 'pagamentos', recurrences: 'recorrências' }

/**
 * An error for the screen whose text names a customer. Electron logs a failed handler with the
 * error's stack, so the stack carries only the kind: customer data never reaches the log.
 */
export function privateError(message: string, kind: string): Error {
  const err = new Error(message)
  err.stack = `Error: ${kind} (o texto fica só na tela)`
  return err
}

/** What a change saved, and what the 'crm' event carries. */
/** What patchCustomer may set (phase 2). Missing keys keep the saved value. */
export interface CustomerSystemPatch {
  phoneChecked?: boolean
  handedToPlayer?: boolean
  phoneReplyAt?: number
  lastContactAt?: number
  /** Opt-out words or crm_optout: offers off, with the date. Never turns back on here. */
  optOut?: true
}

export interface Saved<T> {
  item: T
  delta: CrmDelta
}

// ---------- careful load (a file edited by hand or written by a newer version) ----------

const id = z.string().regex(CRM_ID_RE)
const ms = z.number().min(0).max(MAX_MS)
const optMs = ms.optional().catch(undefined)
const optText = (max: number) => z.string().max(max).optional().catch(undefined)
const optId = id.optional().catch(undefined)
const optDay = z.string().refine(isDay).optional().catch(undefined)
const optMonth = z.string().refine(isMonth).optional().catch(undefined)
const PHONE_RE = /^\d{8,15}$/
const TICKET_RE = /^[\w-]{1,40}$/
const METHODS = ['pix', 'boleto', 'transfer', 'card', 'cash'] as const

/** The items of a list that pass `item`; the rest are dropped. `newest` keeps the end of a long list. */
const list = <T>(item: z.ZodType<T, unknown>, max: number, newest = false) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((xs) => {
      const ok = xs.flatMap((x) => {
        const r = item.safeParse(x)
        return r.success ? [r.data] : []
      })
      return newest ? ok.slice(-max) : ok.slice(0, max)
    })

const author = z
  .union([z.object({ kind: z.literal('player') }), z.object({ kind: z.literal('bot'), botId: z.string().max(64) }), z.object({ kind: z.literal('system') })])
  .catch({ kind: 'system' }) as z.ZodType<CrmAuthor, unknown>

const storedConsent = z
  .object({
    service: z.boolean().catch(true),
    billing: z.boolean().catch(true),
    offers: z.boolean().catch(false),
    offersAt: optMs,
    offersSource: optText(CRM_LIMITS.consentSource),
    optOutAt: optMs,
  })
  .catch({ service: true, billing: true, offers: false, offersAt: undefined, offersSource: undefined, optOutAt: undefined })
  // Who asked to leave gets no offer, whatever the file says.
  .transform((c) => (c.optOutAt ? { ...c, offers: false } : c))

const storedCustomer = z.object({
  id,
  kind: z.enum(['person', 'company']).catch('person'),
  name: z.string().trim().min(1).max(CRM_LIMITS.name),
  company: optText(CRM_LIMITS.company),
  phones: z
    .array(z.unknown())
    .catch([])
    .transform((ps) => [...new Set(ps.filter((p): p is string => typeof p === 'string' && PHONE_RE.test(p)))].slice(0, CRM_LIMITS.phones)),
  email: optText(CRM_LIMITS.email),
  tags: list(z.string().min(1).max(CRM_LIMITS.tag), CRM_LIMITS.tags),
  owner: optText(CRM_LIMITS.owner),
  floor: optText(40),
  consent: storedConsent,
  source: z.enum(['manual', 'import', 'whatsapp', 'demo']).catch('manual'),
  notes: list(z.object({ id, t: ms, text: z.string().min(1).max(CRM_LIMITS.note), by: author }), CRM_LIMITS.notes, true),
  tickets: list(z.string().regex(TICKET_RE), CRM_LIMITS.tickets),
  lastContactAt: optMs,
  nextStep: optText(CRM_LIMITS.nextStep),
  nextStepOn: optDay,
  phoneChecked: z.boolean().optional().catch(undefined),
  handedToPlayer: z.boolean().optional().catch(undefined),
  phoneReplyAt: optMs,
  createdAt: ms.catch(0),
  updatedAt: ms.catch(0),
})

const storedDeal = z.object({
  id,
  customerId: id,
  title: z.string().trim().min(1).max(CRM_LIMITS.title),
  valueCents: z.number().int().min(0).max(CRM_LIMITS.amountCents).catch(0),
  pipelineId: z.string().catch(''),
  stageId: z.string().catch(''),
  stageAt: ms.catch(0),
  nextStep: optText(CRM_LIMITS.nextStep),
  nextStepOn: optDay,
  floor: optText(40),
  tickets: list(z.string().regex(TICKET_RE), CRM_LIMITS.tickets),
  order: z.number().min(-1e9).max(1e9).catch(0),
  history: list(z.object({ t: ms, from: optId, to: id, by: author }), CRM_LIMITS.history, true),
  createdAt: ms.catch(0),
  updatedAt: ms.catch(0),
  closedAt: optMs,
})

const storedPayment = z.object({
  id,
  customerId: id,
  dealId: optId,
  invoice: z.string().max(40).catch(''),
  amountCents: z.number().int().min(0).max(CRM_LIMITS.amountCents),
  due: z.string().refine(isDay),
  reference: z.string().max(CRM_LIMITS.reference).catch(''),
  method: z.enum(METHODS).catch('pix'),
  owner: optText(CRM_LIMITS.owner),
  state: z.enum(['open', 'paid', 'canceled', 'disputed']).catch('open'),
  paidOn: optDay,
  recurrenceId: optId,
  attachment: z
    .string()
    .regex(/^[\w.-]{1,200}$/)
    .refine((s) => !s.startsWith('.'))
    .optional()
    .catch(undefined),
  createdAt: ms.catch(0),
  updatedAt: ms.catch(0),
})

const storedRecurrence = z.object({
  id,
  customerId: id,
  dealId: optId,
  amountCents: z.number().int().min(1).max(CRM_LIMITS.amountCents),
  day: z.number().int().min(1).max(31),
  reference: z.string().max(CRM_LIMITS.reference).catch(''),
  method: z.enum(METHODS).catch('pix'),
  start: z.string().refine(isMonth),
  end: optMonth,
  active: z.boolean().catch(true),
  lastMonth: optMonth,
  createdAt: ms.catch(0),
  updatedAt: ms.catch(0),
})

const storedSuggestion = z.object({
  id,
  botId: optText(64),
  t: ms.catch(0),
  category: z.enum(['service', 'billing', 'offer']),
  why: z.string().max(500).catch(''),
  customerIds: list(id, CRM_LIMITS.suggestions),
  leftOut: list(z.object({ customerId: id, reason: z.string().max(200) }), CRM_LIMITS.suggestions),
  text: z.string().max(CRM_LIMITS.messageText).catch(''),
  status: z.enum(['pending', 'approved', 'discarded', 'expired']).catch('pending'),
  decidedAt: optMs,
})

const OUTBOX_KEY_RE = /^[\w-]{8,80}$/
const storedOutbox = z.object({
  key: z.string().regex(OUTBOX_KEY_RE),
  draftId: id,
  customerId: id,
  category: z.enum(['service', 'billing', 'offer']),
  text: z.string().min(1).max(CRM_LIMITS.messageText),
  by: author,
  replyTo: optText(120),
  at: ms,
  attempts: z.number().int().min(0).max(100).catch(0),
  // A send cut in the middle (app closed while "sending") comes back as failed: never sent twice.
  state: z
    .enum(['queued', 'sending', 'sent', 'failed', 'canceled'])
    .catch('failed')
    .transform((st) => (st === 'sending' ? 'failed' : st)),
  sentAt: optMs,
  waId: optText(120),
  approved: z.boolean().optional().catch(undefined),
  override: z.boolean().optional().catch(undefined),
  createdAt: ms.catch(0),
  error: optText(300),
})

const storedPipeline = z
  .object({
    id,
    name: z.string().trim().min(1).max(CRM_LIMITS.title),
    stages: z.array(z.object({ id, name: z.string().trim().min(1).max(CRM_LIMITS.stageName), kind: z.enum(['open', 'won', 'lost']) })).min(2).max(CRM_LIMITS.stages),
  })
  .refine((p) => new Set(p.stages.map((s) => s.id)).size === p.stages.length && p.stages.some((s) => s.kind === 'won') && p.stages.some((s) => s.kind === 'lost'))

/** The items that pass `schema`, without repeated ids, at most `max`. */
function items<T extends { id: string }>(raw: unknown, schema: z.ZodType<unknown, unknown>, max: number): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    const r = schema.safeParse(x)
    if (!r.success) continue
    const item = compact(r.data as T)
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

/** crm.json as it loads: every item checked, orphans dropped, a phone kept by its first customer. */
export function loadCrmData(raw: Partial<Record<keyof CrmData, unknown>>): CrmData {
  const customers = items<Customer>(raw.customers, storedCustomer, CRM_LIMITS.customers)
  const phones = new Set<string>()
  for (const c of customers) c.phones = c.phones.filter((p) => !phones.has(p) && !!phones.add(p))
  let pipelines = items<Pipeline>(raw.pipelines, storedPipeline, CRM_LIMITS.pipelines)
  if (!pipelines.length) pipelines = [structuredClone(DEFAULT_PIPELINE)]
  const known = new Set(customers.map((c) => c.id))
  const deals = items<Deal>(raw.deals, storedDeal, CRM_LIMITS.deals)
    .filter((d) => known.has(d.customerId))
    .map((d) => {
      // A deal whose stage left its pipeline lands on the first stage, never lost.
      const p = pipelines.find((x) => x.id === d.pipelineId) ?? pipelines[0]
      const stage = p.stages.find((s) => s.id === d.stageId) ?? p.stages[0]
      return { ...d, pipelineId: p.id, stageId: stage.id }
    })
  return {
    customers,
    deals,
    pipelines,
    payments: items<Payment>(raw.payments, storedPayment, CRM_LIMITS.payments).filter((p) => known.has(p.customerId)),
    recurrences: items<Recurrence>(raw.recurrences, storedRecurrence, CRM_LIMITS.recurrences).filter((r) => known.has(r.customerId)),
    suggestions: items<Suggestion>(raw.suggestions, storedSuggestion, CRM_LIMITS.suggestions),
    outbox: loadOutbox(raw.outbox, known),
    settings: cleanCrmSettings(raw.settings, structuredClone(CRM_DEFAULTS)),
  }
}

/** The queue as it loads: checked items of known customers, one per key, the newest kept. */
function loadOutbox(raw: unknown, known: Set<string>): OutboxItem[] {
  const seen = new Set<string>()
  const out: OutboxItem[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    const r = storedOutbox.safeParse(x)
    if (!r.success || seen.has(r.data.key) || !known.has(r.data.customerId)) continue
    seen.add(r.data.key)
    out.push(r.data as OutboxItem)
  }
  return out.slice(-CRM_LIMITS.outbox)
}

/** The object without its undefined keys (and without demo: false). */
function compact<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>
  for (const k of Object.keys(out)) if (out[k] === undefined || (k === 'demo' && out[k] !== true)) delete out[k]
  return out as T
}

/** The value of `key` in a draft that has it (even undefined: it clears), else `fallback`. */
function field<D extends object, K extends keyof D>(d: D, key: K, fallback: D[K] | undefined): D[K] | undefined {
  return Object.hasOwn(d, key) ? d[key] : fallback
}

function chmod(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch {
    // Windows has no Unix modes; a missing file has nothing to protect
  }
}

/**
 * userData/crm.json ({ customers, deals, pipelines, payments, recurrences, suggestions, settings }),
 * written like bots.json: atomically, debounced, never over a file that did not parse, 0600.
 * Attachments live in userData/crm/anexos (folders 0700, made when needed). Demo items live in
 * memory only. Every method takes arguments validate.ts already cleaned and throws pt-BR
 * messages for the rules: one phone, one customer; a pipeline keeps a won and a lost stage.
 */
export class CrmStore {
  private file: string
  private root: string
  private data: CrmData
  private timer: NodeJS.Timeout | null = null
  private locked = false
  private dirty = false
  private now: () => number
  /** Phone -> its customer; rebuilt when customers change. */
  private phoneIndex: Map<string, Customer> | null = null

  constructor(dir: string, opts: { now?: () => number } = {}) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'crm.json')
    this.root = resolve(dir, 'crm')
    this.now = opts.now ?? Date.now
    const r = loadJson<Partial<CrmData>>(this.file, { valid: shapeOf('crm.json'), fallbacks: backupCopies(dir, 'crm.json') })
    reportLoad(this.file, r)
    // loadJson refreshed the .bak with the default mode; it holds the same personal data.
    chmod(bakPath(this.file), FILE_MODE)
    this.data = loadCrmData(r.status === 'ok' || r.status === 'restored' ? r.data : {})
    if (r.status === 'restored') {
      this.dirty = true
      this.flush()
    }
  }

  // ---------- reading ----------

  /** Everything, as crmList returns it (demo items included). */
  list(): CrmData {
    return { ...this.data }
  }

  get customers(): Customer[] {
    return this.data.customers
  }

  get deals(): Deal[] {
    return this.data.deals
  }

  get pipelines(): Pipeline[] {
    return this.data.pipelines
  }

  get payments(): Payment[] {
    return this.data.payments
  }

  get recurrences(): Recurrence[] {
    return this.data.recurrences
  }

  get suggestions(): Suggestion[] {
    return this.data.suggestions
  }

  get settings(): CrmSettings {
    return this.data.settings
  }

  customer(customerId: string): Customer | undefined {
    return this.data.customers.find((c) => c.id === customerId)
  }

  deal(dealId: string): Deal | undefined {
    return this.data.deals.find((d) => d.id === dealId)
  }

  payment(paymentId: string): Payment | undefined {
    return this.data.payments.find((p) => p.id === paymentId)
  }

  recurrence(recurrenceId: string): Recurrence | undefined {
    return this.data.recurrences.find((r) => r.id === recurrenceId)
  }

  /** The customer that has this phone, if any. */
  ownerOfPhone(phone: string): Customer | undefined {
    if (!this.phoneIndex) {
      this.phoneIndex = new Map()
      for (const c of this.data.customers) for (const p of c.phones) if (!this.phoneIndex.has(p)) this.phoneIndex.set(p, c)
    }
    return this.phoneIndex.get(phone)
  }

  private must<C extends 'customers' | 'deals' | 'payments' | 'recurrences'>(coll: C, itemId: string): CrmData[C][number] {
    const item = (this.data[coll] as { id: string }[]).find((x) => x.id === itemId)
    if (!item) throw new Error(GONE[coll])
    return item as CrmData[C][number]
  }

  /** Items that count toward CRM_LIMITS (demo items do not). */
  private real(coll: 'customers' | 'deals' | 'payments' | 'recurrences'): number {
    let n = 0
    for (const x of this.data[coll] as { demo?: boolean }[]) if (!x.demo) n++
    return n
  }

  /** Refuses one more item past CRM_LIMITS (demo items do not count). */
  private room(coll: 'customers' | 'deals' | 'payments' | 'recurrences', count = this.real(coll)): void {
    const max = CRM_LIMITS[coll]
    if (count >= max) {
      throw new Error(`Limite de ${max.toLocaleString('pt-BR')} ${NAMES[coll]} atingido. Apague alguns antes de criar outros.`)
    }
  }

  /** Puts the item in place (same id = replace) and schedules the save. */
  private put<C extends Exclude<CrmCollection, 'pipelines' | 'suggestions'>>(coll: C, item: CrmData[C][number]): void {
    const arr = this.data[coll] as { id: string }[]
    const i = arr.findIndex((x) => x.id === item.id)
    const before = i >= 0 ? arr[i] : undefined
    if (i >= 0) arr[i] = item
    else arr.push(item)
    if (coll === 'customers') this.indexPhones(before as Customer | undefined, item as Customer)
    this.save()
  }

  /**
   * Keeps the phone index in step with one customer write, without rebuilding it (an import of
   * 5 000 rows would rebuild it 5 000 times). Dropping a phone is rare: that rebuilds it later.
   */
  private indexPhones(before: Customer | undefined, after: Customer): void {
    const index = this.phoneIndex
    if (!index) return
    if (before?.phones.some((p) => !after.phones.includes(p))) {
      this.phoneIndex = null
      return
    }
    for (const p of after.phones) {
      const owner = index.get(p)
      if (!owner || owner.id === after.id) index.set(p, after)
    }
  }

  /** One phone, one customer: throws (naming the other customer, for the screen only) when a phone is taken. */
  private checkPhones(phones: readonly string[], self?: string): void {
    for (const p of phones) {
      const other = this.ownerOfPhone(p)
      if (other && other.id !== self) {
        log.info(`CRM: telefone ${maskPhone(p)} recusado; já é do cliente ${other.id}`)
        throw privateError(`Esse telefone já é de ${other.name}. Abra a ficha dele ou use outro número.`, 'telefone de outro cliente')
      }
    }
  }

  // ---------- clientes ----------

  /** Creates (no id) or edits a customer. A key the draft lacks keeps the saved value. */
  saveCustomer(d: CleanCustomerDraft, opts: { source?: CustomerSource; count?: number } = {}): Saved<Customer> {
    const at = this.now()
    const before = d.id ? this.customer(d.id) : undefined
    if (d.id && !before) throw new Error(GONE.customers)
    if (!before) this.room('customers', opts.count)
    const phones = d.phones ?? before?.phones ?? []
    this.checkPhones(phones, before?.id)
    const c = compact<Customer>({
      id: before?.id ?? randomUUID(),
      kind: d.kind ?? before?.kind ?? 'person',
      name: d.name,
      company: field(d, 'company', before?.company),
      phones,
      email: field(d, 'email', before?.email),
      tags: d.tags ?? before?.tags ?? [],
      owner: field(d, 'owner', before?.owner),
      floor: field(d, 'floor', before?.floor),
      consent: mergeConsent(before?.consent, d.consent, at),
      source: before?.source ?? opts.source ?? 'manual',
      notes: before?.notes ?? [],
      tickets: d.tickets ?? before?.tickets ?? [],
      lastContactAt: field(d, 'lastContactAt', before?.lastContactAt),
      nextStep: field(d, 'nextStep', before?.nextStep),
      nextStepOn: field(d, 'nextStepOn', before?.nextStepOn),
      // The WhatsApp check belongs to the first phone: a new first phone needs a new check.
      phoneChecked: before?.phoneChecked && before.phones[0] === phones[0] ? true : undefined,
      handedToPlayer: before?.handedToPlayer,
      phoneReplyAt: before?.phoneReplyAt,
      createdAt: before?.createdAt ?? at,
      updatedAt: at,
      demo: before?.demo,
    })
    this.put('customers', c)
    return { item: c, delta: { customers: [c] } }
  }

  /**
   * Phase 2: what the WhatsApp side sets on a customer, never from a form: the number was checked,
   * "Passar para mim", the player answered from the phone, the last contact, and the opt-out
   * (only on: clearing it is the player's, through saveCustomer with clearOptOut).
   */
  patchCustomer(customerId: string, patch: CustomerSystemPatch): Saved<Customer> {
    const before = this.must('customers', customerId)
    const at = this.now()
    const consent = patch.optOut && !before.consent.optOutAt ? { ...before.consent, offers: false, optOutAt: at } : before.consent
    const c = compact<Customer>({
      ...before,
      consent,
      phoneChecked: field(patch, 'phoneChecked', before.phoneChecked) || undefined,
      handedToPlayer: field(patch, 'handedToPlayer', before.handedToPlayer) || undefined,
      phoneReplyAt: field(patch, 'phoneReplyAt', before.phoneReplyAt),
      lastContactAt: Math.max(before.lastContactAt ?? 0, patch.lastContactAt ?? 0) || undefined,
      updatedAt: at,
    })
    this.put('customers', c)
    return { item: c, delta: { customers: [c] } }
  }

  /**
   * Phase 2: a number nobody knows wrote on WhatsApp. It becomes "Novo contato" (or the profile
   * name, cut to size), source whatsapp, number checked, no bot, and no consent for billing or
   * offers: nothing was agreed yet. Returns the owner when the phone already has one.
   */
  contactFromWhatsapp(phone: string, profileName?: string): Saved<Customer> {
    const owner = this.ownerOfPhone(phone)
    if (owner) return { item: owner, delta: {} }
    this.room('customers')
    const at = this.now()
    const name = (profileName ?? '').replace(/[\p{C}]/gu, '').trim().slice(0, CRM_LIMITS.name) || 'Novo contato'
    const c: Customer = {
      id: randomUUID(),
      kind: 'person',
      name,
      phones: [phone],
      tags: [],
      consent: { service: true, billing: false, offers: false },
      source: 'whatsapp',
      notes: [],
      tickets: [],
      lastContactAt: at,
      phoneChecked: true,
      createdAt: at,
      updatedAt: at,
    }
    this.put('customers', c)
    return { item: c, delta: { customers: [c] } }
  }

  // ---------- fila de envio (fase 2) ----------

  /** The send queue, oldest first. The Outbox owns it; everything else only reads. */
  get outbox(): OutboxItem[] {
    return this.data.outbox
  }

  /** Puts a queue item in place (same key = replace); past the limit, the oldest finished ones leave. */
  putOutbox(item: OutboxItem): Saved<OutboxItem> {
    const arr = this.data.outbox
    const i = arr.findIndex((x) => x.key === item.key)
    if (i >= 0) arr[i] = item
    else arr.push(item)
    if (arr.length > CRM_LIMITS.outbox) {
      const done = (x: OutboxItem) => x.state === 'sent' || x.state === 'canceled' || x.state === 'failed'
      let extra = arr.length - CRM_LIMITS.outbox
      this.data.outbox = arr.filter((x) => !(extra > 0 && done(x) && extra--))
    }
    this.save()
    return { item, delta: { outbox: [item] } }
  }

  /** "Apagar este cliente": the customer's queue items leave (they carry the text). Answers their keys. */
  dropOutbox(customerId: string): string[] {
    const keys = this.data.outbox.filter((x) => x.customerId === customerId).map((x) => x.key)
    if (!keys.length) return keys
    this.data.outbox = this.data.outbox.filter((x) => x.customerId !== customerId)
    this.save()
    return keys
  }

  /** Removes the customer with its deals, payments (attachments too) and recurrences. */
  deleteCustomer(customerId: string): CrmDelta {
    const c = this.must('customers', customerId)
    const mine = <T extends { id: string; customerId: string }>(xs: T[]) => xs.filter((x) => x.customerId === c.id)
    const deals = mine(this.data.deals).map((x) => x.id)
    const payments = mine(this.data.payments)
    const recurrences = mine(this.data.recurrences).map((x) => x.id)
    for (const p of payments) if (p.attachment) this.removeAttachment(p.attachment)
    this.data.customers = this.data.customers.filter((x) => x.id !== c.id)
    this.data.deals = this.data.deals.filter((x) => x.customerId !== c.id)
    this.data.payments = this.data.payments.filter((x) => x.customerId !== c.id)
    this.data.recurrences = this.data.recurrences.filter((x) => x.customerId !== c.id)
    const suggestions: Suggestion[] = []
    this.data.suggestions = this.data.suggestions.map((s) => {
      if (!s.customerIds.includes(c.id) && !s.leftOut.some((l) => l.customerId === c.id)) return s
      const next = { ...s, customerIds: s.customerIds.filter((x) => x !== c.id), leftOut: s.leftOut.filter((l) => l.customerId !== c.id) }
      suggestions.push(next)
      return next
    })
    this.phoneIndex = null
    this.save()
    const removed: CrmDelta['removed'] = { customers: [c.id] }
    if (deals.length) removed.deals = deals
    if (payments.length) removed.payments = payments.map((p) => p.id)
    if (recurrences.length) removed.recurrences = recurrences
    return { removed, ...(suggestions.length ? { suggestions } : {}) }
  }

  /** A note on the customer, newest last; the oldest go past CRM_LIMITS.notes. */
  addNote(customerId: string, text: string, by: CrmAuthor = PLAYER): Saved<Customer> {
    const before = this.must('customers', customerId)
    const at = this.now()
    const c: Customer = { ...before, notes: [...before.notes, { id: randomUUID(), t: at, text, by }].slice(-CRM_LIMITS.notes), updatedAt: at }
    this.put('customers', c)
    return { item: c, delta: { customers: [c] } }
  }

  // ---------- negócios ----------

  private pipelineOf(pipelineId: string | undefined): Pipeline {
    if (!pipelineId) return this.data.pipelines[0]
    const p = this.data.pipelines.find((x) => x.id === pipelineId)
    if (!p) throw new Error(GONE.pipelines)
    return p
  }

  private stageOf(p: Pipeline, stageId: string): PipelineStage {
    const s = p.stages.find((x) => x.id === stageId)
    if (!s) throw new Error('Essa etapa não existe mais nesse funil. Feche e abra o quadro de novo.')
    return s
  }

  /** The deals of a column, in board order. */
  private column(pipelineId: string, stageId: string, except?: string): Deal[] {
    return this.data.deals.filter((d) => d.pipelineId === pipelineId && d.stageId === stageId && d.id !== except).sort((a, b) => a.order - b.order)
  }

  /** The deal enters `stage` now: history, days in the stage, closed when won or lost. */
  private enter(deal: Deal, stage: PipelineStage, by: CrmAuthor, at: number): Deal {
    const history = [...deal.history, { t: at, ...(deal.stageId ? { from: deal.stageId } : {}), to: stage.id, by }].slice(-CRM_LIMITS.history)
    const next: Deal = { ...deal, stageId: stage.id, stageAt: at, history }
    if (stage.kind === 'open') delete next.closedAt
    else next.closedAt = at
    return next
  }

  /** Creates (no id) or edits a deal; a change of stage or pipeline goes into its history. */
  saveDeal(d: CleanDealDraft, by: CrmAuthor = PLAYER): Saved<Deal> {
    const at = this.now()
    const before = d.id ? this.deal(d.id) : undefined
    if (d.id && !before) throw new Error(GONE.deals)
    const customer = this.customer(d.customerId)
    if (!customer) throw new Error('Esse cliente não existe mais. Escolha outro.')
    if (!before) this.room('deals')
    const pipeline = this.pipelineOf(d.pipelineId ?? before?.pipelineId)
    const stage = this.stageOf(pipeline, d.stageId ?? (before && before.pipelineId === pipeline.id ? before.stageId : pipeline.stages[0].id))
    const fields = {
      customerId: customer.id,
      title: d.title,
      valueCents: field(d, 'valueCents', before?.valueCents) ?? 0,
      nextStep: field(d, 'nextStep', before?.nextStep),
      nextStepOn: field(d, 'nextStepOn', before?.nextStepOn),
      floor: field(d, 'floor', before?.floor),
      tickets: d.tickets ?? before?.tickets ?? [],
      updatedAt: at,
    }
    let deal: Deal
    if (!before) {
      deal = this.enter(
        { id: randomUUID(), ...fields, pipelineId: pipeline.id, stageId: '', stageAt: at, order: this.nextOrder(pipeline.id, stage.id), history: [], createdAt: at, ...(customer.demo ? { demo: true } : {}) },
        stage,
        by,
        at,
      )
    } else {
      deal = { ...before, ...fields }
      if (pipeline.id !== before.pipelineId || stage.id !== before.stageId) deal = { ...this.enter({ ...deal, pipelineId: pipeline.id }, stage, by, at), order: this.nextOrder(pipeline.id, stage.id) }
    }
    deal = compact(deal)
    this.put('deals', deal)
    return { item: deal, delta: { deals: [deal] } }
  }

  private nextOrder(pipelineId: string, stageId: string): number {
    return Math.max(-1, ...this.column(pipelineId, stageId).map((d) => d.order)) + 1
  }

  /** Moves the deal to `stageId` of its pipeline, before `beforeId` (or to the end of the column). */
  moveDeal(dealId: string, stageId: string, beforeId?: string, by: CrmAuthor = PLAYER): Saved<Deal> {
    const before = this.must('deals', dealId)
    const stage = this.stageOf(this.pipelineOf(before.pipelineId), stageId)
    const at = this.now()
    let deal: Deal = stage.id === before.stageId ? { ...before } : { ...this.enter(before, stage, by, at), updatedAt: at }
    const col = this.column(before.pipelineId, stage.id, before.id)
    const pos = beforeId ? col.findIndex((x) => x.id === beforeId) : -1
    col.splice(pos < 0 ? col.length : pos, 0, deal)
    const changed: Deal[] = []
    col.forEach((x, i) => {
      if (x.id === deal.id) {
        deal = { ...deal, order: i }
        changed.push(deal)
      } else if (x.order !== i) changed.push({ ...x, order: i })
    })
    for (const x of changed) this.put('deals', x)
    return { item: deal, delta: { deals: changed } }
  }

  /** Removes the deal; its payments and recurrences stay, without the link. */
  deleteDeal(dealId: string): CrmDelta {
    const deal = this.must('deals', dealId)
    this.data.deals = this.data.deals.filter((d) => d.id !== deal.id)
    const payments = this.unlink(this.data.payments, deal.id)
    const recurrences = this.unlink(this.data.recurrences, deal.id)
    this.save()
    return { removed: { deals: [deal.id] }, ...(payments.length ? { payments } : {}), ...(recurrences.length ? { recurrences } : {}) }
  }

  private unlink<T extends { id: string; dealId?: string }>(arr: T[], dealId: string): T[] {
    const out: T[] = []
    arr.forEach((x, i) => {
      if (x.dealId !== dealId) return
      const { dealId: _gone, ...rest } = x
      arr[i] = rest as T
      out.push(arr[i])
    })
    return out
  }

  /** Creates or replaces a pipeline; refuses dropping a stage that still has deals. */
  savePipeline(p: Pipeline): Saved<Pipeline> {
    const i = this.data.pipelines.findIndex((x) => x.id === p.id)
    if (i < 0 && this.data.pipelines.length >= CRM_LIMITS.pipelines) throw new Error(`Limite de ${CRM_LIMITS.pipelines} funis atingido.`)
    if (i >= 0) {
      for (const s of this.data.pipelines[i].stages) {
        if (p.stages.some((x) => x.id === s.id)) continue
        const n = this.data.deals.filter((d) => d.pipelineId === p.id && d.stageId === s.id).length
        if (n) throw new Error(`A etapa "${s.name}" tem ${n} ${n === 1 ? 'negócio' : 'negócios'}. Mova para outra etapa antes de tirá-la do funil.`)
      }
      this.data.pipelines[i] = p
    } else this.data.pipelines.push(p)
    this.save()
    return { item: p, delta: { pipelines: [p] } }
  }

  // ---------- pagamentos ----------

  /** The deal must exist and be of the customer. */
  private dealOf(customerId: string, dealId: string | undefined): string | undefined {
    if (!dealId) return undefined
    const deal = this.deal(dealId)
    if (!deal) throw new Error(GONE.deals)
    if (deal.customerId !== customerId) throw new Error('Esse negócio é de outro cliente. Escolha um negócio deste cliente.')
    return deal.id
  }

  /** "AAAA-MM-": the invoice prefix of the month `at` falls in. */
  private invoicePrefix(at: number): string {
    return `${localDate(at).slice(0, 7)}-`
  }

  /** The highest invoice number already given under the prefix (0 when none). */
  private lastInvoice(prefix: string): number {
    let max = 0
    for (const p of this.data.payments) {
      if (!p.invoice.startsWith(prefix)) continue
      const n = Number(p.invoice.slice(prefix.length))
      if (Number.isSafeInteger(n) && n > max) max = n
    }
    return max
  }

  /** "AAAA-MM-NNN": the month it was made and the next number of that month. */
  private nextInvoice(at: number): string {
    const prefix = this.invoicePrefix(at)
    return `${prefix}${String(this.lastInvoice(prefix) + 1).padStart(3, '0')}`
  }

  /** Creates (no id) or edits a payment; the invoice number is made here. */
  savePayment(d: CleanPaymentDraft): Saved<Payment> {
    const at = this.now()
    const before = d.id ? this.payment(d.id) : undefined
    if (d.id && !before) throw new Error(GONE.payments)
    const customer = this.customer(d.customerId)
    if (!customer) throw new Error('Esse cliente não existe mais. Escolha outro.')
    if (!before) this.room('payments')
    const state = d.state ?? before?.state ?? 'open'
    const p = compact<Payment>({
      ...before,
      id: before?.id ?? randomUUID(),
      customerId: customer.id,
      dealId: this.dealOf(customer.id, field(d, 'dealId', before?.dealId)),
      invoice: before?.invoice || this.nextInvoice(at),
      amountCents: d.amountCents,
      due: d.due,
      reference: d.reference,
      method: d.method ?? before?.method ?? 'pix',
      owner: Object.hasOwn(d, 'owner') ? d.owner : (before?.owner ?? customer.owner),
      state,
      // Reopened (open, canceled, disputed): the payment date goes.
      paidOn: state === 'paid' ? before?.paidOn : undefined,
      createdAt: before?.createdAt ?? at,
      updatedAt: at,
      demo: before ? before.demo : customer.demo,
    })
    this.put('payments', p)
    return { item: p, delta: { payments: [p] } }
  }

  /** Paid on that day ('AAAA-MM-DD'): the dunning of the payment stops. */
  markPaid(paymentId: string, paidOn: string): Saved<Payment> {
    const before = this.must('payments', paymentId)
    const p: Payment = { ...before, state: 'paid', paidOn, updatedAt: this.now() }
    this.put('payments', p)
    return { item: p, delta: { payments: [p] } }
  }

  deletePayment(paymentId: string): CrmDelta {
    const p = this.must('payments', paymentId)
    if (p.attachment) this.removeAttachment(p.attachment)
    this.data.payments = this.data.payments.filter((x) => x.id !== p.id)
    this.save()
    return { removed: { payments: [p.id] } }
  }

  // ---------- recorrências ----------

  /** Creates or edits a recurrence, then makes the payments already due. */
  saveRecurrence(d: CleanRecurrenceDraft, today = localDate(this.now())): Saved<Recurrence> {
    const at = this.now()
    const before = d.id ? this.recurrence(d.id) : undefined
    if (d.id && !before) throw new Error(GONE.recurrences)
    const customer = this.customer(d.customerId)
    if (!customer) throw new Error('Esse cliente não existe mais. Escolha outro.')
    if (!before) this.room('recurrences')
    const r = compact<Recurrence>({
      ...before,
      id: before?.id ?? randomUUID(),
      customerId: customer.id,
      dealId: this.dealOf(customer.id, field(d, 'dealId', before?.dealId)),
      amountCents: d.amountCents,
      day: d.day,
      reference: d.reference,
      method: d.method ?? before?.method ?? 'pix',
      start: d.start,
      end: field(d, 'end', before?.end),
      active: d.active ?? before?.active ?? true,
      createdAt: before?.createdAt ?? at,
      updatedAt: at,
      demo: before ? before.demo : customer.demo,
    })
    this.put('recurrences', r)
    const made = this.makeRecurring([r], today)
    const item = this.recurrence(r.id) ?? r
    return { item, delta: { recurrences: [item], ...(made.length ? { payments: made } : {}) } }
  }

  /** Removes the recurrence; the payments it made stay, without the link. */
  deleteRecurrence(recurrenceId: string): CrmDelta {
    const r = this.must('recurrences', recurrenceId)
    this.data.recurrences = this.data.recurrences.filter((x) => x.id !== r.id)
    const payments: Payment[] = []
    this.data.payments.forEach((p, i) => {
      if (p.recurrenceId !== r.id) return
      const { recurrenceId: _gone, ...rest } = p
      this.data.payments[i] = rest
      payments.push(rest)
    })
    this.save()
    return { removed: { recurrences: [r.id] }, ...(payments.length ? { payments } : {}) }
  }

  /**
   * The payments every active recurrence owes by `today` (recurrenceMonths), made now: at
   * startup, once a local day and after a recurrence is saved. Null when nothing was due.
   */
  runRecurrences(today = localDate(this.now())): CrmDelta | null {
    const before = new Map(this.data.recurrences.map((r) => [r.id, r.lastMonth]))
    const made = this.makeRecurring(this.data.recurrences, today)
    if (!made.length) return null
    const recurrences = this.data.recurrences.filter((r) => before.get(r.id) !== r.lastMonth)
    return { payments: made, recurrences }
  }

  /**
   * Makes the payments `recs` owe by `today`. One pass over the payments up front (what exists,
   * how many count toward the limit, the last invoice number), then constant work per payment:
   * thousands of recurrences after weeks closed would otherwise freeze startup for minutes.
   * lastMonth moves only to the last month that has its payment, so a month the limit cut is
   * made on a later pass, once there is room.
   */
  private makeRecurring(recs: readonly Recurrence[], today: string): Payment[] {
    const at = this.now()
    const lead = this.data.settings.recurrenceLeadDays
    const made: Payment[] = []
    const owing = recs.map((r) => ({ r, months: recurrenceMonths(r, today, lead) })).filter((x) => x.months.length)
    if (!owing.length) return made
    const key = (recurrenceId: string, day: string) => `${recurrenceId}|${day}`
    const have = new Set<string>()
    for (const p of this.data.payments) if (p.recurrenceId) have.add(key(p.recurrenceId, p.due))
    const customers = new Map(this.data.customers.map((c) => [c.id, c]))
    const deals = new Set(this.data.deals.map((d) => d.id))
    let real = this.real('payments')
    const prefix = this.invoicePrefix(at)
    let invoice = this.lastInvoice(prefix)
    for (const { r: r0, months } of owing) {
      const customer = customers.get(r0.customerId)
      if (!customer) continue
      const dealId = r0.dealId && deals.has(r0.dealId) ? r0.dealId : undefined
      let last: string | undefined
      for (const m of months) {
        // Never twice for the same month, whatever lastMonth says.
        if (have.has(key(r0.id, m.due))) {
          last = m.month
          continue
        }
        if (!r0.demo && real >= CRM_LIMITS.payments) {
          log.warn(`CRM: limite de pagamentos atingido; a recorrência ${r0.id} não criou o mês ${m.month}`)
          break
        }
        invoice++
        const p = compact<Payment>({
          id: randomUUID(),
          customerId: customer.id,
          dealId,
          invoice: `${prefix}${String(invoice).padStart(3, '0')}`,
          amountCents: r0.amountCents,
          due: m.due,
          reference: recurrenceReference(r0, m.month),
          method: r0.method,
          owner: customer.owner,
          state: 'open',
          recurrenceId: r0.id,
          createdAt: at,
          updatedAt: at,
          demo: r0.demo,
        })
        this.data.payments.push(p)
        made.push(p)
        have.add(key(r0.id, m.due))
        if (!p.demo) real++
        last = m.month
      }
      if (!last || last === r0.lastMonth) continue
      const i = this.data.recurrences.findIndex((x) => x.id === r0.id)
      if (i >= 0) this.data.recurrences[i] = { ...r0, lastMonth: last }
    }
    if (made.length) {
      log.info(`CRM: recorrências criaram ${made.length} pagamento(s)`)
      this.save()
    }
    return made
  }

  // ---------- configurações e importação ----------

  /** The rules, already cleaned (cleanCrmSettings). */
  setSettings(settings: CrmSettings): CrmDelta {
    this.data.settings = settings
    this.save()
    return { settings }
  }

  /**
   * CSV rows, each already cleaned: a phone nobody has makes a customer (source 'import', offers
   * off); a phone that is someone's follows the row's choice. Skip keeps that customer as it is;
   * update fills it with the row (name, company, e-mail, owner; tags and phones added), consent
   * untouched. A row whose phones belong to two customers, or past the limit, is skipped.
   */
  importCustomers(rows: readonly { draft: CleanCustomerDraft; onConflict: ImportChoice }[]): { result: CustomerImportResult; delta: CrmDelta } {
    const result: CustomerImportResult = { created: 0, updated: 0, skipped: 0 }
    const at = this.now()
    // Counted once: room() would walk every customer again for each new row.
    let count = this.real('customers')
    for (const { draft, onConflict } of rows) {
      const phones = draft.phones ?? []
      const owners = [...new Set(phones.map((p) => this.ownerOfPhone(p)).filter((c): c is Customer => !!c))]
      if (!owners.length) {
        try {
          const { id: _id, consent: _consent, ...fresh } = draft
          this.saveCustomer(fresh, { source: 'import', count })
          count++
          result.created++
        } catch {
          result.skipped++
        }
        continue
      }
      if (onConflict !== 'update' || owners.length > 1) {
        result.skipped++
        continue
      }
      const c = owners[0]
      const tags = [...c.tags]
      for (const t of draft.tags ?? []) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t)
      const next = compact<Customer>({
        ...c,
        name: draft.name,
        company: draft.company ?? c.company,
        email: draft.email ?? c.email,
        owner: draft.owner ?? c.owner,
        tags: tags.slice(0, CRM_LIMITS.tags),
        phones: [...new Set([...c.phones, ...phones])].slice(0, CRM_LIMITS.phones),
        updatedAt: at,
      })
      this.put('customers', next)
      result.updated++
    }
    return { result, delta: { reload: true } }
  }

  // ---------- demonstração ----------

  /** Demo items (demo: true): shown with the rest, never written. */
  addDemo(demo: Partial<Pick<CrmData, 'customers' | 'deals' | 'payments' | 'recurrences'>>): void {
    for (const c of demo.customers ?? []) this.data.customers.push({ ...c, demo: true })
    for (const d of demo.deals ?? []) this.data.deals.push({ ...d, demo: true })
    for (const p of demo.payments ?? []) this.data.payments.push({ ...p, demo: true })
    for (const r of demo.recurrences ?? []) this.data.recurrences.push({ ...r, demo: true })
    this.phoneIndex = null
  }

  // ---------- anexos ----------

  /** userData/crm/anexos, made 0700 with its parent when first needed. */
  attachmentsDir(): string {
    const dir = join(this.root, 'anexos')
    if (!this.locked) {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE })
      for (const d of [this.root, dir]) chmod(d, DIR_MODE)
    }
    return dir
  }

  /** Deletes an attachment by name, never outside userData/crm/anexos. */
  private removeAttachment(name: string): void {
    const dir = join(this.root, 'anexos')
    const file = resolve(dir, name)
    if (!file.startsWith(dir + sep) || !existsSync(file)) return
    rmSync(file, { force: true })
  }

  // ---------- writing ----------

  save(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.locked || !this.dirty) return
    const real = <T extends { demo?: boolean }>(xs: T[]) => xs.filter((x) => !x.demo)
    const { customers, deals, pipelines, payments, recurrences, suggestions, outbox, settings } = this.data
    writeJsonAtomic(
      this.file,
      {
        customers: real(customers),
        deals: real(deals),
        pipelines,
        payments: real(payments),
        recurrences: real(recurrences),
        suggestions,
        outbox,
        settings,
      } satisfies CrmData,
      { mode: FILE_MODE },
    )
    chmod(this.file, FILE_MODE)
    this.dirty = false
  }

  /** Writes what is pending, then stops writing for good (the app restarts next). */
  lock(): void {
    this.flush()
    this.locked = true
  }
}

/** Consent after the player's change. Offers on stamps offersAt; an opt-out only goes with clearOptOut. */
export function mergeConsent(before: ContactConsent | undefined, patch: CleanConsent | undefined, at: number): ContactConsent {
  const cur: ContactConsent = before ? { ...before } : { service: true, billing: true, offers: false }
  if (!patch) return cur
  if (patch.service !== undefined) cur.service = patch.service
  if (patch.billing !== undefined) cur.billing = patch.billing
  if (patch.clearOptOut) delete cur.optOutAt
  if (patch.offers === true) {
    if (cur.optOutAt) {
      throw new Error(`Esse cliente pediu para sair das ofertas em ${formatDay(localDate(cur.optOutAt))}. Só religue se ele pediu de novo: marque que ele pediu para voltar a receber.`)
    }
    if (!cur.offers) {
      cur.offers = true
      cur.offersAt = at
      cur.offersSource = patch.offersSource ?? `Marcado na ficha em ${formatDay(localDate(at))}`
    } else if (patch.offersSource) cur.offersSource = patch.offersSource
  } else if (patch.offers === false) {
    cur.offers = false
    delete cur.offersAt
    delete cur.offersSource
  }
  return cur
}
