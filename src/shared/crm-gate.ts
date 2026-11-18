// Sala de CRM: o portão de envio (docs/adr/0017-portao-de-envio.md). Função pura, sem IA, sem rede,
// sem relógio próprio: a entrada traz o instante. A Outbox chama o portão ao enfileirar e de novo no
// instante de enviar.
//
// As 14 regras rodam na ordem do ADR e a primeira que falha decide. Os detectores (links, dados de
// pagamento, cobrança disfarçada, desconto, texto igual) erram para o lado do cliente: um falso
// positivo custa um clique seu; um falso negativo é uma chave PIX trocada. O corpus de casos está em
// test/fixtures/crm-gate-cases.json.

import {
  AUTONOMY_LABEL,
  MESSAGE_CATEGORY_LABEL,
  type CrmSettings,
  type Customer,
  type DayHours,
  type Draft,
  type GateAction,
  type GateDecision,
  type MessageCategory,
  type Payment,
} from './types'
import { formatCents, formatDay, localDate, parseMoney } from './crm'

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

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

// ---------- o portão ----------

/** The decision, with the optional fields only when they apply (the corpus reads absent as false). */
function decide(
  action: GateAction,
  rule: number,
  reason: string,
  opts: { at?: number; overridable?: boolean; rehearsal?: boolean } = {},
): GateDecision {
  const d: GateDecision = { action, rule, reason }
  if (action === 'schedule' && opts.at !== undefined) d.at = opts.at
  if (opts.overridable) d.overridable = true
  if (opts.rehearsal) d.rehearsal = true
  return d
}

/** An Instant in ms, or `fallback` when it does not parse. */
function ms(iso: string | null | undefined, fallback: number): number {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : fallback
}

/** What every rule reads, worked out once. */
interface Judged {
  input: GateInput
  now: number
  by: GateAuthor
  /** Bot or system: text that came from a model or from the app, not typed by you. */
  model: boolean
  customer: GateCustomer
  /** The payment the draft is about (draftPayment), in any state. */
  payment: GatePayment | null
  /** The text with the markers filled, as it would go out (rule 8 compares this). */
  filled: string
  /** The text with the markers taken out: the system's data is not read by rules 5 and 6. */
  bare: string
  /** What the markers put in (the system's data): in the filled text, only these exact hits are skipped. */
  inserted: string[]
}

/**
 * Send, wait for you, bar or schedule, with the rule and the reason (ADR 0017). Pure: the instant
 * comes in `input.now` and the wall clock (window, day, holiday) is read in the machine's time zone.
 */
export function gate(input: GateInput): GateDecision {
  const now = Date.parse(input.now)
  if (!Number.isFinite(now)) return decide('block', 0, 'O portão não conseguiu ler a hora desta decisão. Tente de novo.')
  const { draft, settings } = input
  // Anything that is not you or the system counts as the bot: every rule holds.
  const by: GateAuthor = draft.by === 'player' || draft.by === 'system' ? draft.by : 'bot'

  // 1 · Parar tudo e conexão
  if (settings.stopAll) return decide('block', 1, 'Parar tudo está ligado: nada sai até você desligar.')
  if (!input.connected) return decide('block', 1, 'WhatsApp desconectado: conecte em Configurações → CRM → WhatsApp e tente de novo.')

  // 2 · Cliente e número
  const customer = input.customer
  if (!customer || customer.id !== draft.customerId)
    return decide('block', 2, 'O cliente desta mensagem não existe mais: confira a conversa.')
  if (!customer.phones[0]) return decide('block', 2, 'O cliente não tem telefone: confira o número na ficha.')
  if (customer.group) return decide('block', 2, 'O destino é um grupo, não uma pessoa: confira o número na ficha.')
  if (!customer.phoneChecked) return decide('block', 2, 'Número ainda não conferido no WhatsApp: confira o número na ficha.')

  // 3 · Escopo da rodada (só o bot)
  if (by === 'bot') {
    const scope = roundScope(input.run, draft.customerId)
    if (scope) return decide('block', 3, scope)
  }

  const payment = draftPayment(draft.paymentId, draft.customerId, input.payments)
  const j: Judged = {
    input,
    now,
    by,
    model: by !== 'player',
    customer,
    payment,
    filled: fillPayment(draft.text, payment, settings),
    bare: withoutMarkers(draft.text),
    inserted: markerValues(draft.text, payment, settings),
  }
  return (
    consentRule(j) ??
    billingRule(j) ??
    contentRule(j) ??
    discountRule(j) ??
    repeatRule(j) ??
    handoffRule(j) ??
    windowRule(j) ??
    perCustomerRule(j) ??
    globalRule(j) ??
    autonomyRule(j) ??
    decide('send', 0, 'Passou em todas as regras do portão.')
  )
}

/** Rule 3: why the bot's round may not talk to this customer, or null. */
function roundScope(run: GateRun | null, customerId: string): string | null {
  if (!run) return 'Rascunho do bot sem rodada: o bot só fala com o cliente que o chamou.'
  if (run.kind === 'schedule') return 'Rodada de agenda não manda mensagem direta: o Vendedor cria Sugestões.'
  if (run.kind === 'suggestion')
    return run.customerIds.includes(customerId)
      ? null
      : 'O cliente não está na lista da sugestão aprovada: o bot só fala com quem está nela.'
  return run.customerId === customerId ? null : 'Fora da rodada: o bot só fala com o cliente que o chamou.'
}

/** Rule 4: the customer accepts the category. Offers: nobody passes over; service and billing: you may. */
function consentRule({ input, customer }: Judged): GateDecision | null {
  const { category } = input.draft
  const { consent } = customer
  if (category === 'service' || category === 'billing') {
    if (category === 'service' ? consent.service : consent.billing) return null
    if (input.override) return null
    const what = category === 'service' ? 'atendimento' : 'cobrança'
    return decide('block', 4, `O cliente não aceita ${what} por aqui: confira a ficha ou envie mesmo assim.`, { overridable: true })
  }
  // Oferta, ou qualquer categoria que não se conhece: a regra mais dura.
  if (consent.optOutAt) return decide('block', 4, 'O cliente pediu para sair das ofertas: oferta não sai, nem por você.')
  if (!consent.offers)
    return decide('block', 4, 'O cliente não aceitou ofertas: marque o aceite na ficha, com a origem, antes de oferecer.')
  return null
}

/** Rule 5: billing with the system's data; nothing that looks like billing outside the category. */
function billingRule(j: Judged): GateDecision | null {
  const { input, payment, model } = j
  const { draft } = input
  if (!model) {
    // Sua cobrança: vale só "há pagamento aberto", com "Enviar mesmo assim".
    const open = draft.paymentId
      ? payment?.state === 'open'
      : input.payments.some((p) => p.customerId === draft.customerId && p.state === 'open')
    if (draft.category === 'billing' && !open && !input.override)
      return decide('block', 5, 'Cobrança sem pagamento aberto: lance o pagamento na ficha ou envie mesmo assim.', { overridable: true })
  } else if (draft.category === 'billing') {
    const why = botBilling(j)
    if (why) return decide('block', 5, why)
  } else if (looksLikeBilling(draft.text)) {
    return decide('block', 5, 'Isto tem cara de cobrança: o bot só cobra na categoria Cobrança, com os dados do sistema.')
  }
  // Um marcador que ficaria sem dado (ou escrito errado) nunca vai para o cliente.
  const left = UNFILLED.exec(j.filled)
  if (left) {
    const marker = left[0]
    if (marker === '{pagamento}')
      return decide('block', 5, 'Faltam os Dados de pagamento: preencha em Configurações → CRM antes de mandar {pagamento}.')
    if (MARKERS.includes(marker))
      return decide('block', 5, `Sem pagamento para preencher ${marker}: ligue a mensagem a um pagamento aberto.`)
    return decide('block', 5, `Marcador escrito errado (${marker.slice(0, 30)}): use {valor}, {vencimento}, {referente} ou {pagamento}.`)
  }
  return null
}

/** Rule 5 for the bot's and the system's billing: open payment, the three markers, no stray number. */
function botBilling({ input, payment }: Judged): string | null {
  const { draft } = input
  if (!payment || payment.state !== 'open') {
    if (draft.paymentId) return 'O pagamento desta cobrança não está aberto ou não é deste cliente: confira em Pagamentos.'
    const open = input.payments.filter((p) => p.customerId === draft.customerId && p.state === 'open').length
    return open > 1
      ? 'O cliente tem mais de um pagamento aberto: a cobrança precisa dizer qual.'
      : 'Cobrança sem pagamento aberto: o bot só cobra o que está lançado em Pagamentos.'
  }
  const missing = ['{valor}', '{vencimento}', '{pagamento}'].filter((m) => !draft.text.includes(m))
  if (missing.length) return `A cobrança precisa de {valor}, {vencimento} e {pagamento}: falta ${missing.join(' e ')}.`
  const stray = strayNumber(draft.text, payment)
  if (stray) return `"${stray.slice(0, 40)}" não bate com o pagamento: valor e vencimento só entram por {valor} e {vencimento}.`
  return null
}

/** Rule 6: links outside the list (everyone) and payment data written in the text (bot and system). */
function contentRule({ input, bare, filled, inserted, model }: Judged): GateDecision | null {
  const { settings } = input
  // The text as it goes out, too: a marker glued to the text ("golpe{referente}.io") can make a
  // link or a number that neither part has alone. Only a hit the system's data has by itself passes.
  const sysLinks = new Set(inserted.flatMap((v) => findLinks(v).map((l) => l.host || l.text)))
  const outside = (l: LinkHit) => !allowedHost(l.host, settings.allowedLinks)
  const link = findLinks(bare).find(outside) ?? findLinks(filled).find((l) => outside(l) && !sysLinks.has(l.host || l.text))
  if (link && !(!model && input.override)) {
    const shown = (link.host || link.text).slice(0, 60)
    return decide('block', 6, `Link fora da lista (${shown}): só passam os domínios de Configurações → CRM.`, { overridable: !model })
  }
  if (model) {
    const sysData = new Set(inserted.flatMap((v) => findPaymentData(v).map((d) => d.text)))
    const data = findPaymentData(bare)[0] ?? findPaymentData(filled).find((d) => !sysData.has(d.text))
    if (data)
      return decide(
        'block',
        6,
        `O texto tem ${PAYMENT_DATA_LABEL[data.kind]}: dado de pagamento só entra por {pagamento}, escrito pelo sistema.`,
      )
  }
  return null
}

/** Rule 7: the bot's discount within the cap and the validity. Approving resolves it. */
function discountRule({ input, now, by }: Judged): GateDecision | null {
  if (by !== 'bot' || input.approved) return null
  const { draft, settings } = input
  const { pcts, talks } = discountIn(withoutMarkers(draft.text), draft.category)
  const declared = draft.discountPct !== null && draft.discountPct > 0 ? draft.discountPct : null
  if (declared === null && !talks) return null
  const wait = (why: string) => decide('hold', 7, `Espera você: ${why}.`)
  if (declared === null) return wait('o texto fala em desconto, mas o rascunho não declara quanto')
  if (declared > settings.maxDiscountPct) return wait(`desconto de ${declared}% acima do teto de ${settings.maxDiscountPct}%`)
  const other = pcts.find((p) => p !== declared)
  if (other !== undefined) return wait(`o texto diz ${other}%, o rascunho declara ${declared}%`)
  if (!pcts.length) return wait(`o texto não diz o desconto de ${declared}% que o rascunho declara`)
  if (!draft.validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(draft.validUntil)) return wait('desconto sem validade')
  if (draft.validUntil < localDate(now)) return wait(`a validade do desconto (${formatDay(draft.validUntil)}) já passou`)
  return null
}

/** Rule 8: the same text already went out to this customer in the last 24 h. */
function repeatRule({ input, now, filled }: Judged): GateDecision | null {
  if (input.override) return null
  if (!countRecent(input.history, now, DAY, (h) => sameText(h.text, filled))) return null
  return decide('block', 8, 'Texto igual a um enviado a este cliente nas últimas 24 h: mude o texto ou envie mesmo assim.', {
    overridable: true,
  })
}

/** Rule 9: the conversation is with you, you answered from the phone, or the message answered is old. */
function handoffRule({ input, now, model, customer }: Judged): GateDecision | null {
  if (!model || input.approved) return null
  if (customer.handedToPlayer) return decide('hold', 9, 'Espera você: a conversa está com você. Devolva ao bot para ele voltar a enviar.')
  // Sem hora legível, conta como agora: o bot fica quieto.
  if (customer.phoneReplyAt !== null && now - ms(customer.phoneReplyAt, now) < 12 * HOUR)
    return decide('hold', 9, 'Espera você: você respondeu pelo celular há menos de 12 h.')
  const reply = input.draft.replyTo
  if (reply && now - ms(reply.at, -Infinity) >= 2 * HOUR)
    return decide('hold', 9, 'Espera você: a mensagem respondida chegou há mais de 2 h.')
  return null
}

/** Rule 10: inside the send window; an answer to a message of less than 15 min goes anyway. */
function windowRule({ input, now }: Judged): GateDecision | null {
  const { draft, settings } = input
  if (input.override) return null
  if (draft.replyTo && now - ms(draft.replyTo.at, -Infinity) < 15 * MINUTE) return null
  if (inWindow(now, settings.hours, settings.holidays)) return null
  const at = nextWindow(now, settings.hours, settings.holidays)
  // Nenhum dia com horário: "agendar" seria esperar para sempre.
  if (at === null)
    return decide('hold', 10, 'Espera você: nenhum dia tem horário de envio. Ligue um em Configurações → CRM ou envie mesmo assim.', {
      overridable: true,
    })
  return decide('schedule', 10, `Fora do horário de envio: sai ${when(at, now)}.`, { at, overridable: true })
}

/** Rule 11: per-customer limits, only for what we start; counts only what we started. */
function perCustomerRule({ input, now }: Judged): GateDecision | null {
  const { draft, settings, history } = input
  if (draft.replyTo || input.override) return null
  const wait = (why: string) => decide('hold', 11, `Espera você: ${why}.`, { overridable: true })
  const started = (h: GateSent) => h.initiated
  const day = countRecent(history, now, 'day', started)
  if (day >= settings.perCustomer.day) return wait(`seria a ${day + 1}ª mensagem nossa hoje (limite ${settings.perCustomer.day} por dia)`)
  const week = countRecent(history, now, 7 * DAY, started)
  if (week >= settings.perCustomer.week) return wait(`seria a ${week + 1}ª mensagem em 7 dias (limite ${settings.perCustomer.week})`)
  if (draft.category === 'offer') {
    const offers = countRecent(history, now, settings.offerEveryDays * DAY, (h) => h.initiated && h.category === 'offer')
    if (offers >= 1) return wait(`${offers + 1}ª oferta em ${settings.offerEveryDays} dias`)
  }
  return null
}

/** Rule 12: the office's cap per hour and per day, answers included. Nobody passes over. */
function globalRule({ input, now }: Judged): GateDecision | null {
  const { global, settings } = input
  const { hours, holidays, globalCap } = settings
  if (global.today >= globalCap.day) {
    const d = new Date(now)
    const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    const at = nextWindow(tomorrow, hours, holidays) ?? tomorrow
    return decide('schedule', 12, `Teto do escritório (${globalCap.day} por dia): sai ${when(at, now)}.`, { at })
  }
  if (global.lastHour >= globalCap.hour) {
    let at = Math.max(ms(global.oldestInHour, now) + HOUR, now + MINUTE)
    if (!inWindow(at, hours, holidays)) at = nextWindow(at, hours, holidays) ?? at
    return decide('schedule', 12, `Teto do escritório (${globalCap.hour} por hora): sai ${when(at, now)}.`, { at })
  }
  return null
}

/** Rules 13 and 14: rehearsal (only in Autônomo) and the category's autonomy. Approving resolves both. */
function autonomyRule({ input, model }: Judged): GateDecision | null {
  if (!model || input.approved) return null
  const { category } = input.draft
  const level = input.settings.autonomy[category]
  if (level === 'auto') return input.settings.rehearsal ? decide('hold', 13, 'Modo ensaio: teria sido enviada.', { rehearsal: true }) : null
  if (level === 'draft') return decide('hold', 14, 'Rascunho: o bot só escreve nesta categoria')
  const label = AUTONOMY_LABEL[level] ?? AUTONOMY_LABEL.approval
  return decide('hold', 14, `Espera você: ${MESSAGE_CATEGORY_LABEL[category] ?? category} está em ${label}`)
}

// ---------- marcadores ----------

const MARKERS = ['{valor}', '{vencimento}', '{referente}', '{pagamento}']
/** A marker, in any case and with spaces inside: what is left after filling never goes out. */
const UNFILLED = /\{\s*(?:valor|vencimento|referente|pagamento)\s*\}/i
const MARKER_RE = /\{\s*(?:valor|vencimento|referente|pagamento)\s*\}/gi

/** The text with every marker (well written or not) replaced by a break: the detectors never read the system's data. */
function withoutMarkers(text: string): string {
  return String(text ?? '').replace(MARKER_RE, ' | ')
}

const PIX_KEY_LABEL: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', email: 'e-mail', phone: 'telefone', random: 'chave aleatória' }

/** {pagamento}: the PIX key and its type, the payee, the bank and the fixed note, one per line. Null without a key. */
function paymentLines(p: GateSettings['payment']): string | null {
  const key = p.pixKey.trim()
  if (!key) return null
  const type = PIX_KEY_LABEL[p.pixKeyType]
  const lines = [`Chave PIX${type ? ` (${type})` : ''}: ${key}`]
  if (p.payee.trim()) lines.push(`Favorecido: ${p.payee.trim()}`)
  if (p.bank.trim()) lines.push(`Banco: ${p.bank.trim()}`)
  if (p.note.trim()) lines.push(p.note.trim())
  return lines.join('\n')
}

/**
 * The text with the markers filled from the system's fields: {valor} 'R$ 480,00', {vencimento}
 * '20/11/2026', {referente} the payment's "referente a", {pagamento} the lines of Configurações →
 * CRM → Dados de pagamento. One pass: what goes in is never read again. A marker without its data
 * (no payment, no PIX key) stays as is, and the gate bars it (rule 5).
 */
export function fillPayment(text: string, payment: GatePayment | null, settings: GateSettings): string {
  return String(text ?? '').replace(MARKER_FILL, (marker, name: string) => markerValue(name, payment, settings) ?? marker)
}

const MARKER_FILL = /\{(valor|vencimento|referente|pagamento)\}/g

/** What one marker becomes, or null when its data is missing. */
function markerValue(name: string, payment: GatePayment | null, settings: GateSettings): string | null {
  if (name === 'pagamento') return paymentLines(settings.payment)
  if (!payment) return null
  if (name === 'valor') return formatCents(payment.amountCents)
  if (name === 'vencimento') return formatDay(payment.due)
  return payment.reference.trim()
}

/** The values fillPayment puts into this text, one per marker filled. */
function markerValues(text: string, payment: GatePayment | null, settings: GateSettings): string[] {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(MARKER_FILL)) {
    const v = markerValue(m[1], payment, settings)
    if (v) out.push(v)
  }
  return out
}

// ---------- janela de envio ----------

const HHMM = /^(\d{1,2}):(\d{2})$/

/** The window of a local day (ms), or null: no hours, a bad time, or an empty window. */
function windowOf(day: Date, hours: DayHours | undefined): [number, number] | null {
  const a = hours ? HHMM.exec(hours.from) : null
  const b = hours ? HHMM.exec(hours.to) : null
  if (!a || !b) return null
  const at = (m: RegExpExecArray) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(m[1]), Number(m[2])).getTime()
  const [start, end] = [at(a), at(b)]
  return start < end ? [start, end] : null
}

/** `now` (ms) is inside the send window: hours of the local weekday, start included, end excluded, never on a holiday. */
export function inWindow(now: number, hours: readonly DayHours[], holidays: readonly string[]): boolean {
  const d = new Date(now)
  if (holidays.includes(localDate(d))) return false
  const w = windowOf(d, hours[d.getDay()])
  return !!w && now >= w[0] && now < w[1]
}

/**
 * The first instant at or after `now` (ms) inside a send window: `now` itself when it is inside one,
 * else the start of the next, skipping holidays. Days are built from the local calendar, so the
 * start follows daylight saving time. Null when no day of the coming year has a window.
 */
export function nextWindow(now: number, hours: readonly DayHours[], holidays: readonly string[]): number | null {
  const d = new Date(now)
  const off = new Set(holidays)
  for (let i = 0; i <= 366; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)
    if (off.has(localDate(day))) continue
    const w = windowOf(day, hours[day.getDay()])
    if (w && w[1] > now) return Math.max(w[0], now)
  }
  return null
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const pad2 = (n: number) => String(n).padStart(2, '0')

/** "hoje às 10:20" or "qui 19/11 às 09:00", in local time. */
function when(at: number, now: number): string {
  const d = new Date(at)
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (localDate(d) === localDate(now)) return `hoje às ${time}`
  return `${WEEKDAYS[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} às ${time}`
}

/**
 * How many of `history` match `pred` in the period: the local calendar day of `now` ('day'), or the
 * last `period` ms (a send exactly `period` ago no longer counts). A time ahead of `now` (clock moved
 * back) or one that does not parse counts as now.
 */
export function countRecent(
  history: readonly GateSent[],
  now: number,
  period: 'day' | number,
  pred: (h: GateSent) => boolean = () => true,
): number {
  const today = localDate(now)
  let n = 0
  for (const h of history) {
    if (!pred(h)) continue
    const t = Math.min(ms(h.at, now), now)
    if (period === 'day' ? localDate(t) === today : t > now - period) n++
  }
  return n
}

// ---------- texto ----------

/** Characters that do not show but split a word: zero width, soft hyphen, direction marks, variation selectors. */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu

/** Lower case, no accents, no invisible characters; compatibility forms (fullwidth, bold) to plain ones. */
function plain(text: string): string {
  return String(text ?? '')
    .replace(INVISIBLE, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/** Digits of other scripts ('١٢٣', '१२३') as 0–9: Unicode keeps each script's digits in a run from 0 to 9. */
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x80) return ch
    let start = cp
    while (start > cp - 100 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--
    return String((cp - start) % 10)
  })
}

/** Same text for rule 8: case, accents, spaces, punctuation and emoji do not count. */
export function sameText(a: string, b: string): boolean {
  const key = (s: string) => plain(s).replace(/[^\p{L}\p{N}]/gu, '')
  const [ka, kb] = [key(a), key(b)]
  // Só símbolos dos dois lados: compara o texto como veio.
  return ka || kb ? ka === kb : String(a ?? '').trim() === String(b ?? '').trim()
}

// ---------- links ----------

/**
 * Top-level domains people meet in messages (scam ones included: .bet, .lat, .online); any
 * two-letter one (country) also counts. Any other TLD counts when a path follows or the host
 * starts with www.: "pedido.obrigado" is a missing space, "golpe.qualquer/pix" is a link.
 */
const GTLDS =
  'com|net|org|info|biz|app|dev|page|site|online|store|shop|link|click|top|xyz|club|live|pro|vip|tech|cloud|digital|email|life|' +
  'today|world|space|website|fun|icu|buzz|sbs|cfd|bond|lol|win|bid|loan|loans|work|mobi|name|gov|edu|mil|int|news|blog|art|' +
  'agency|money|finance|bank|pay|cash|help|support|services|center|network|global|social|zone|one|host|web|wiki|ink|run|plus|' +
  'tips|guru|rocks|cam|tel|museum|aero|coop|jobs|travel|xxx|bet|lat|casa|ninja|rest|beauty|hair|skin|quest|cyou|monster|fit|mom|' +
  'pics|best|ltd|company|group|solutions|stream|video|games|game|chat|team|systems|gold|sale|deals|promo|gift|gifts|cards|' +
  'credit|tax|claims|delivery|express|market|trade|exchange|capital|fund|red|blue|pink|black|green|wtf|fyi|tube|cafe|tours|' +
  'photo|photos|design|studio|media|marketing|academy|school|health|care|clinic|legal|law|auto|car|cars|house|land|city|love|' +
  'casino|poker|bingo|lotto|dating|now|ooo|boutique|fashion|shopping|discount|coupons|free|bio|eco|energy'
const TLD = `(?:${GTLDS}|[a-z]{2}|xn--[a-z0-9-]{2,59})`
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?'
// '_' and '-' are not part of a host: "x_golpe.io" and "golpe.io_pix" still hold golpe.io.
const HOST_END = '(?![\\p{L}\\p{N}@])'
/** A host, not glued to a word and not the local part of an e-mail: www. and any TLD, labels and a known TLD, or any TLD with a path. */
const HOST_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.])(?:www\\.(?:${LABEL}\\.)+[a-z]{2,24}${HOST_END}|(?:${LABEL}\\.)+(?:${TLD}${HOST_END}|[a-z]{2,24}(?=[/?#]\\S|:\\d)))`,
  'gu',
)
/** "golpe ponto com" when it ends there (or goes on with another "ponto"), not "bater o ponto com atraso". */
const SPELLED_DOT = new RegExp(
  `[ \\t]+ponto[ \\t]+(?=${TLD}(?![\\p{L}\\p{N}])(?:[ \\t]+ponto[ \\t]+|[ \\t]*$|[ \\t]*[/:?#!.,;)\\]]))`,
  'gmu',
)
const SCHEME_RE = /\b[a-z][a-z0-9+.-]{0,15}:\/\/[^\s<>"'`]*/g
const IPV4_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)/g

/** A link found in a text: what was written and its host (lower case; '' when there is none). */
export interface LinkHit {
  text: string
  host: string
}

/** The text as a browser would read a link: compatibility forms folded (fullwidth dot), invisible characters out, dots unhidden. */
function linkText(text: string): string {
  return String(text ?? '')
    .replace(INVISIBLE, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3002\uff61\ufe12]/g, '.')
    .replace(/\s*[[({]\s*(?:\.|dot|ponto)\s*[\])}]\s*/g, '.')
    .replace(/(?<=[\p{L}\p{N}])[ \t]+\.[ \t]*(?=[\p{L}\p{N}])/gu, '.')
    .replace(SPELLED_DOT, '.')
}

/**
 * Links in a text: URLs with any scheme (the host after a user@ part), loose domains (also with
 * spaces before the dot, "[.]" or "ponto com"), shorteners, wa.me and IPv4 addresses. An e-mail
 * is not a link (rule 6 reads it as payment data in model text).
 */
export function findLinks(text: string): LinkHit[] {
  const s = linkText(text)
  const hits: LinkHit[] = []
  const spans: [number, number][] = []
  for (const m of s.matchAll(SCHEME_RE)) {
    const at = m.index ?? 0
    spans.push([at, at + m[0].length])
    const authority = m[0].slice(m[0].indexOf('//') + 2).split(/[/?#\\]/)[0]
    const host = authority
      .slice(authority.lastIndexOf('@') + 1)
      .replace(/[.,;:!?)\]}>]+$/, '')
      .replace(/:\d+$/, '')
      .replace(/^\[|\]$/g, '')
    hits.push({ text: m[0], host })
  }
  for (const m of s.matchAll(HOST_RE)) {
    const at = m.index ?? 0
    // Dentro de uma URL com esquema, o host já foi lido: o resto é caminho.
    if (spans.some(([a, b]) => at > a && at < b)) continue
    // "maria@gmail.com" é e-mail; "x@golpe.io/pagar" é link com usuário na frente.
    if (s[at - 1] === '@' && s[at + m[0].length] !== '/') continue
    hits.push({ text: m[0], host: m[0] })
  }
  for (const m of s.matchAll(IPV4_RE)) hits.push({ text: m[0], host: m[0] })
  return hits
}

/** The host is a listed domain or a subdomain of one ('www.estudio.com.br' under 'estudio.com.br'). */
function allowedHost(host: string, allowed: readonly string[]): boolean {
  if (!host) return false
  return allowed.some((raw) => {
    const a = raw
      .trim()
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/^\.+|\.+$/g, '')
    return a.length > 0 && (host === a || host.endsWith(`.${a}`))
  })
}

// ---------- dados de pagamento ----------

export type PaymentDataKind = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random' | 'boleto' | 'card' | 'account' | 'pix' | 'number'

/** Payment data found in a text: its kind and the piece that matched (normalized). */
export interface PaymentDataHit {
  kind: PaymentDataKind
  text: string
}

const PAYMENT_DATA_LABEL: Record<PaymentDataKind, string> = {
  cpf: 'um CPF',
  cnpj: 'um CNPJ',
  email: 'um e-mail',
  phone: 'um telefone',
  random: 'uma chave aleatória',
  boleto: 'uma linha digitável de boleto',
  card: 'um número de cartão',
  account: 'agência e conta',
  pix: 'um PIX copia e cola',
  number: 'um número longo',
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  um: '1',
  uma: '1',
  dois: '2',
  duas: '2',
  tres: '3',
  quatro: '4',
  cinco: '5',
  seis: '6',
  meia: '6',
  sete: '7',
  oito: '8',
  nove: '9',
}
const DIGIT_WORD_RE = /\b(?:zero|uma?|dois|duas|tres|quatro|cinco|seis|meia|sete|oito|nove)\b/g
/** A date (19/11, 19/11/2026) or a time (14:30, 14h30): common numbers that must not glue to their neighbours. */
const DATE_RE = /(?<![\d./-])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g
const TIME_RE = /(?<![\d.:])(?:[01]?\d|2[0-3])(?::|h)[0-5]\d(?![\d:])/g
/** Digits glued by up to three separators (space, dot, dash, slash, brackets, plus) or a comma right before a digit. */
const RUN_RE = /\d(?:[\s.\-/()+_*·•]{0,3}\d|,\d)*/g
const PHONE_SHAPE = /^(?:9[\s.-]?\d{4}[\s.-]?\d{4}|\d{4}[\s.-]\d{4})$/
const UUID_RE = /[0-9a-f]{8}[\s-]?[0-9a-f]{4}[\s-]?[0-9a-f]{4}[\s-]?[0-9a-f]{4}[\s-]?[0-9a-f]{12}/g
const PIX_CODE_RE = /000201\d{2}|br\W{0,3}gov\W{0,3}bcb/
/** Agência with three digits or more; conta (c/c, cc) with four or more. An optional "nº" between. */
const ACCOUNT_RE =
  /\b(?:agencia|ag)\b\W{0,4}(?:n(?:o|um|umero)?\b\W{0,3})?\d{3,}|\b(?:conta(?:\s+corrente|\s+poupanca)?|c\/c|cc)\b\W{0,4}(?:n(?:o|um|umero)?\b\W{0,3})?\d{4,}/
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*/u
/** "maria at gmail dot com": the English spelling, only in full (an "at" alone is a word). */
const SPELLED_EN_EMAIL = /[\p{L}\p{N}._%+-]+\s+at\s+[\p{L}\p{N}-]+\s+(?:dot|ponto)\s+[a-z]{2,24}\b/u
/** "maria @ gmail.com": spaces around a written @ only when a known TLD follows. */
const SPACED_AT = new RegExp(
  `[\\p{L}\\p{N}._%+-]+\\s+@\\s*[\\p{L}\\p{N}-]+\\.${TLD}\\b|[\\p{L}\\p{N}._%+-]+@\\s+[\\p{L}\\p{N}-]+\\.${TLD}\\b`,
  'u',
)

/** CPF check digits. */
function cpfOk(d: string): boolean {
  if (/^(\d)\1{10}$/.test(d)) return false
  const dv = (len: number) => {
    let s = 0
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/** Luhn check (cards). */
function luhn(d: string): boolean {
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i])
    if (i % 2 === 1) x = x * 2 > 9 ? x * 2 - 9 : x * 2
    sum += x
  }
  return sum % 10 === 0
}

/**
 * What a run of digits is, or null for a common number. Ten digits or more is always data; eight
 * or nine are a phone when written like one ('98888-7777') or split into five pieces or more.
 */
function runKind(run: string): PaymentDataKind | null {
  const d = run.replace(/\D/g, '')
  const n = d.length
  if (n < 10) return n >= 8 && (PHONE_SHAPE.test(run) || run.split(/\D+/).length >= 5) ? 'phone' : null
  if (n === 44 || n === 47 || n === 48) return 'boleto'
  if (n === 14) return 'cnpj'
  if (n === 11) return cpfOk(d) ? 'cpf' : 'phone'
  if ((n === 12 || n === 13) && d.startsWith('55')) return 'phone'
  if (n >= 13 && n <= 19 && luhn(d)) return 'card'
  return n <= 13 ? 'phone' : 'number'
}

/**
 * Payment data in a text (ADR 0017, rule 6): PIX copia e cola, random key (UUID), e-mail (also
 * "arroba" and "ponto" spelled out), agência e conta, and runs of digits: CPF, CNPJ, phone, card
 * (Luhn), boleto line, or any number of ten digits or more. Disguises count: digits split by
 * spaces or dots, digits spelled out in the middle ("um dois três 456.789-09"), fullwidth and
 * other scripts' digits, invisible characters. Dates, times, money and short numbers pass.
 */
export function findPaymentData(text: string): PaymentDataHit[] {
  const s = asciiDigits(plain(text))
  const hits: PaymentDataHit[] = []
  const pix = PIX_CODE_RE.exec(s)
  if (pix) hits.push({ kind: 'pix', text: pix[0] })
  for (const m of s.matchAll(UUID_RE)) if (/[a-f]/.test(m[0])) hits.push({ kind: 'random', text: m[0] })
  const spelled = s
    .replace(/\s*(?:\barroba\b|[[(]\s*(?:at|arroba)\s*[\])])\s*/g, '@')
    .replace(/\s*(?:\bponto\b|[[(]\s*(?:dot|ponto|\.)\s*[\])])\s*/g, '.')
  // Só procura e-mail onde há uma arroba (escrita ou por extenso): a busca é cara num texto longo sem ela.
  const email =
    (spelled.includes('@') ? (EMAIL_RE.exec(spelled) ?? SPACED_AT.exec(s)) : null) ?? (/\bat\b/.test(s) ? SPELLED_EN_EMAIL.exec(s) : null)
  if (email) hits.push({ kind: 'email', text: email[0] })
  const digits = s
    .replace(DIGIT_WORD_RE, (w) => DIGIT_WORDS[w])
    .replace(DATE_RE, (m, dd: string, mm: string) =>
      Number(dd) >= 1 && Number(dd) <= 31 && Number(mm) >= 1 && Number(mm) <= 12 ? ' | ' : m,
    )
    .replace(TIME_RE, ' | ')
  const account = ACCOUNT_RE.exec(digits)
  if (account) hits.push({ kind: 'account', text: account[0] })
  for (const m of digits.matchAll(RUN_RE)) {
    const kind = runKind(m[0])
    if (kind) hits.push({ kind, text: m[0] })
  }
  return hits
}

// ---------- cobrança ----------

const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const NUM_WORDS =
  'zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|' +
  'dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzent[ao]s|trezent[ao]s|' +
  'quatrocent[ao]s|quinhent[ao]s|seiscent[ao]s|setecent[ao]s|oitocent[ao]s|novecent[ao]s|mil|milhao|milhoes'
/** An amount spelled out: number words ending in reais or centavos ("quatrocentos e oitenta reais", "R$ cem"). */
const SPELLED_MONEY = new RegExp(
  `\\b(?:${NUM_WORDS})(?:\\s+(?:e\\s+)?(?:${NUM_WORDS}))*\\s+(?:reais|real|centavos?)\\b|r\\$\\s*(?:${NUM_WORDS})\\b`,
)
/** Hundreds and thousands spelled out: in a billing text they are an amount. */
const SPELLED_BIG =
  /\b(?:cem|cento|duzent[ao]s|trezent[ao]s|quatrocent[ao]s|quinhent[ao]s|seiscent[ao]s|setecent[ao]s|oitocent[ao]s|novecent[ao]s|mil)\b/
const BILLING_WORDS =
  /\b(?:boletos?|pix|pagamentos?|pagar|pague|vencimentos?|vence|vencem|venceu|vencer|vencid[ao]s?|faturas?|cobrancas?)\b/
const MONEY_RE = /r\$\s*\d|\d[\d.,]*\s*(?:reais|real)\b/
const DAY_MONTH_RE = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+de\\s+(\\d{4}))?\\b`, 'g')
const LOOSE_DATE = new RegExp(`(?<!\\d)\\d{1,2}/\\d{1,2}(?!\\d)|\\bdia\\s+\\d{1,2}\\b|\\b\\d{1,2}\\s+de\\s+(?:${MONTHS.join('|')})\\b`)

/**
 * Billing outside its category (rule 5): a payment marker, or an amount in reais or a date next
 * to a billing word (boleto, PIX, pagamento, pagar, vencimento, vence, fatura, cobrança).
 */
export function looksLikeBilling(text: string): boolean {
  if (UNFILLED.test(String(text ?? ''))) return true
  const s = asciiDigits(plain(text))
  return BILLING_WORDS.test(s) && (MONEY_RE.test(s) || SPELLED_MONEY.test(s) || LOOSE_DATE.test(s))
}

/**
 * The first number of a billing text (markers taken out) that does not match the payment, or null.
 * Matches: the amount (480, 480,00, R$ 480,00, 1.234,56) and the due date (20/11, 20/11/2026,
 * "dia 20", "20 de novembro"). An amount spelled out never matches.
 */
export function strayNumber(text: string, payment: Pick<GatePayment, 'amountCents' | 'due'>): string | null {
  let s = asciiDigits(plain(withoutMarkers(text)))
  const spelled = SPELLED_MONEY.exec(s) ?? SPELLED_BIG.exec(s)
  if (spelled) return spelled[0]
  const [y, m, d] = payment.due.split('-').map(Number)
  let stray: string | null = null
  const check = (ok: boolean, piece: string) => {
    if (!ok && stray === null) stray = piece.trim()
    return ' | '
  }
  s = s.replace(DATE_RE, (piece, dd: string, mm: string, yy?: string) => {
    const year = !yy || Number(yy) === y || Number(yy) === y % 100
    return check(Number(dd) === d && Number(mm) === m && year, piece)
  })
  s = s.replace(DAY_MONTH_RE, (piece, dd: string, month: string, yy?: string) =>
    check(Number(dd) === d && MONTHS.indexOf(month) + 1 === m && (!yy || Number(yy) === y), piece),
  )
  s = s.replace(/\bdia\s+(\d{1,2})(?!\d)/g, (piece, dd: string) => check(Number(dd) === d, piece))
  for (const [piece] of s.matchAll(/(?:r\$\s*)?\d[\d.,]*/g)) check(parseMoney(piece.replace(/[.,]+$/, '')) === payment.amountCents, piece)
  return stray
}

// ---------- desconto ----------

const PERCENT_RE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:%|por\s*cento|porcento)/g
const DISCOUNT_WORDS =
  /\b(?:desconto|descontos|descontao|descontinho|descontar|desconte|descontamos|off|abatimento|por\s*cento|porcento)\b|\bpela\s+metade\b|\bmetade\s+do\s+preco\b/

/** The percentages a text gives and whether it talks about a discount (any percentage counts in an offer). */
function discountIn(text: string, category: MessageCategory): { pcts: number[]; talks: boolean } {
  const s = asciiDigits(plain(text))
  const pcts = [...s.matchAll(PERCENT_RE)].map((m) => Number(m[1].replace(',', '.')))
  return { pcts, talks: DISCOUNT_WORDS.test(s) || (category === 'offer' && pcts.length > 0) }
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
