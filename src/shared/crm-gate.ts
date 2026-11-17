// Sala de CRM: o portão de envio (docs/adr/0017-portao-de-envio.md). Função pura, sem IA, sem rede,
// sem relógio próprio: a entrada traz o instante. A Outbox chama o portão ao enfileirar e de novo no
// instante de enviar.
//
// Por enquanto só a entrada (GateInput, a forma de `base` em test/fixtures/crm-gate-cases.json) e o
// que monta a entrada a partir dos dados do app. As 14 regras são do CR-11, depois do ADR aceito.

import type { CrmSettings, Customer, Draft, GateDecision, MessageCategory, Payment } from './types'
import { localDate } from './crm'

const HOUR = 3_600_000

/** An instant in ISO 8601 with the offset ('2026-11-18T10:00:00-03:00'). Wall-clock rules read it in the machine's time zone. */
export type Instant = string

/** Who wrote the text (ADR 0017, section 4): the model, you, or a fixed text of the app. */
export type GateAuthor = 'bot' | 'player' | 'system'

/** The bot round that proposed the message (rule 3); null for your message or the system's. */
export type GateRun =
  { kind: 'customer'; customerId: string } | { kind: 'schedule' } | { kind: 'suggestion'; suggestionId: string; customerIds: string[] }

/** The rules the gate reads from CrmSettings. */
export type GateSettings = Pick<
  CrmSettings,
  | 'rehearsal'
  | 'autonomy'
  | 'hours'
  | 'holidays'
  | 'perCustomer'
  | 'offerEveryDays'
  | 'globalCap'
  | 'maxDiscountPct'
  | 'allowedLinks'
  | 'stopAll'
  | 'payment'
>

/** The customer of the destination, as the gate sees it. */
export interface GateCustomer {
  id: string
  name: string
  /** Digits with the country code; the first one is the WhatsApp number. */
  phones: string[]
  phoneChecked: boolean
  /** A WhatsApp group: never a destination (rule 2). */
  group: boolean
  consent: { service: boolean; billing: boolean; offers: boolean; optOutAt: Instant | null }
  handedToPlayer: boolean
  phoneReplyAt: Instant | null
}

export type GatePayment = Pick<Payment, 'id' | 'customerId' | 'amountCents' | 'due' | 'state' | 'reference'>

/** Something that already went out to this customer (rules 8 and 11). */
export interface GateSent {
  at: Instant
  category: MessageCategory
  /** We started it (no message it answers). Whoever builds the history decides. */
  initiated: boolean
  /** The final text, markers already filled. */
  text: string
}

/** Every send of the office (rule 12), answers included. */
export interface GateGlobal {
  /** Sends in the last 60 minutes. */
  lastHour: number
  /** Sends on the local calendar day. */
  today: number
  /** The oldest send of the last 60 minutes: the hour frees up one hour after it. */
  oldestInHour: Instant | null
}

/** The message to judge. */
export interface GateDraft {
  id: string
  customerId: string
  by: GateAuthor
  /** A bot's draft you edited: still model text for rules 5 and 6. */
  edited: boolean
  category: MessageCategory
  /** With the markers ({valor}, {vencimento}, {referente}, {pagamento}) still to fill. */
  text: string
  /** The inbound message it answers, or null when we start the conversation. */
  replyTo: { id: string; at: Instant } | null
  paymentId: string | null
  discountPct: number | null
  /** 'AAAA-MM-DD'. */
  validUntil: string | null
}

/** Everything the gate reads (ADR 0017, section 2). */
export interface GateInput {
  now: Instant
  connected: boolean
  settings: GateSettings
  /** Null when the customer does not exist. */
  customer: GateCustomer | null
  /** This customer's payments. */
  payments: GatePayment[]
  history: GateSent[]
  global: GateGlobal
  run: GateRun | null
  draft: GateDraft
  /** You clicked "Enviar" on the draft card (resolves rules 7, 9, 13 and 14). */
  approved: boolean
  /** You confirmed "Enviar mesmo assim" (only where the decision said overridable). */
  override: boolean
}

/** Send, wait for you, bar or schedule, with the rule and the reason. CR-11 writes the rules. */
export function gate(_input: GateInput): GateDecision {
  throw new Error('portão ainda não escrito')
}

/** The text with {valor}, {vencimento}, {referente} and {pagamento} filled from the system's fields. CR-11 writes it. */
export function fillPayment(_text: string, _payment: GatePayment | null, _settings: GateSettings): string {
  throw new Error('portão ainda não escrito')
}

// ---------- montar a entrada ----------

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** ms to an Instant in the machine's time zone ('2026-11-18T10:00:00-03:00'; milliseconds only when not zero). */
export function isoAt(ms: number): Instant {
  const d = new Date(ms)
  const off = -d.getTimezoneOffset()
  const abs = Math.abs(off)
  const frac = d.getMilliseconds() ? `.${pad(d.getMilliseconds(), 3)}` : ''
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${frac}`
  return `${date}T${time}${off >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** Rule 12's counts from the times (ms) of every send of the office. A time ahead of `now` (clock moved back) counts as now. */
export function globalCounts(sent: readonly number[], now: number): GateGlobal {
  const today = localDate(now)
  let lastHour = 0
  let day = 0
  let oldest: number | null = null
  for (const raw of sent) {
    const t = Math.min(raw, now)
    if (t > now - HOUR) {
      lastHour++
      if (oldest === null || t < oldest) oldest = t
    }
    if (localDate(t) === today) day++
  }
  return { lastHour, today: day, oldestInHour: oldest === null ? null : isoAt(oldest) }
}

/** The payment a draft is about: its paymentId (of the same customer), else the customer's only open payment. */
export function draftPayment(
  paymentId: string | null | undefined,
  customerId: string,
  payments: readonly GatePayment[],
): GatePayment | null {
  if (paymentId) return payments.find((p) => p.id === paymentId && p.customerId === customerId) ?? null
  const open = payments.filter((p) => p.customerId === customerId && p.state === 'open')
  return open.length === 1 ? open[0] : null
}

/** What went out to the customer, as the app keeps it. */
export interface SentRecord {
  t: number
  category?: MessageCategory
  initiated: boolean
  text: string
}

/** The app's data around one decision; gateInput turns it into the gate's input. */
export interface GateSources {
  now: number
  connected: boolean
  settings: GateSettings
  customer: Customer | undefined
  /** Any payments: only the customer's are passed on. */
  payments: readonly Payment[]
  history: readonly SentRecord[]
  /** When each send of the office went out (ms). */
  sent: readonly number[]
  run: GateRun | null
  draft: Draft
  approved: boolean
  override: boolean
}

const PHONE_RE = /^\d{8,15}$/

function gateCustomer(c: Customer): GateCustomer {
  return {
    id: c.id,
    name: c.name,
    phones: [...c.phones],
    phoneChecked: c.phoneChecked === true,
    // Inbound drops groups and phones are E.164 digits; anything else is not a person's number.
    group: c.phones.length > 0 && !PHONE_RE.test(c.phones[0]),
    consent: {
      service: c.consent.service,
      billing: c.consent.billing,
      offers: c.consent.offers,
      optOutAt: c.consent.optOutAt ? isoAt(c.consent.optOutAt) : null,
    },
    handedToPlayer: c.handedToPlayer === true,
    phoneReplyAt: c.phoneReplyAt ? isoAt(c.phoneReplyAt) : null,
  }
}

/**
 * The gate's input from the app's data. An answer with no time for the message it answers counts
 * as answering a very old one (rule 9 holds it; rule 10 does not let it through at night).
 */
export function gateInput(src: GateSources): GateInput {
  const { draft } = src
  const customerId = src.customer?.id ?? draft.customerId
  return {
    now: isoAt(src.now),
    connected: src.connected,
    settings: src.settings,
    customer: src.customer ? gateCustomer(src.customer) : null,
    payments: src.payments
      .filter((p) => p.customerId === customerId)
      .map((p) => ({ id: p.id, customerId: p.customerId, amountCents: p.amountCents, due: p.due, state: p.state, reference: p.reference })),
    history: src.history.map((h) => ({ at: isoAt(h.t), category: h.category ?? 'service', initiated: h.initiated, text: h.text })),
    global: globalCounts(src.sent, src.now),
    run: src.run,
    draft: {
      id: draft.id,
      customerId: draft.customerId,
      by: draft.by.kind,
      edited: draft.edited === true,
      category: draft.category,
      text: draft.text,
      replyTo: draft.replyTo ? { id: draft.replyTo, at: isoAt(draft.replyAt ?? 0) } : null,
      paymentId: draft.paymentId ?? null,
      discountPct: draft.discountPct ?? null,
      validUntil: draft.validUntil ?? null,
    },
    approved: src.approved,
    override: src.override,
  }
}
