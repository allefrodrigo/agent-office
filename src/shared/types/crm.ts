// Sala de CRM: clientes, negócios, pagamentos e (fase 2 em diante) as conversas de WhatsApp.
// Spec: docs/prd/sala-de-crm.md. Plano: docs/prd/sala-de-crm-plano.md (CR-01 é este contrato).
//
// Dinheiro anda em centavos (inteiros) e datas de calendário em 'AAAA-MM-DD' local, para que
// soma e vencimento não dependam de ponto flutuante nem de fuso.

// ---------- quem fez ----------

/** Who did something in the CRM: the player, a bot (CRM profile), or the app itself (recurrence, import). */
export type CrmAuthor = { kind: 'player' } | { kind: 'bot'; botId: string } | { kind: 'system' }

// ---------- clientes ----------

export type CustomerKind = 'person' | 'company'

/** Where the customer's data came from (LGPD: origin). */
export type CustomerSource = 'manual' | 'import' | 'whatsapp' | 'demo'

/**
 * What the customer accepted. Atendimento and cobrança rest on the contract; ofertas need consent,
 * with date and origin. A customer who asked to leave (optOutAt) gets no offer, not even from the player.
 */
export interface ContactConsent {
  /** Atendimento: answering who wrote. */
  service: boolean
  /** Cobrança: reminders of open payments (execution of contract). */
  billing: boolean
  /** Ofertas: accepted to receive offers. Imported customers arrive with false. */
  offers: boolean
  /** When offers was turned on (ms). */
  offersAt?: number
  /** How the consent was given, in words: "pediu por WhatsApp em 12/11", "formulário do site". */
  offersSource?: string
  /** The customer asked to stop offers (ms). Set by the opt-out words or a bot's crm_optout; only the player clears it. */
  optOutAt?: number
}

export interface CustomerNote {
  id: string
  t: number
  text: string
  by: CrmAuthor
}

export interface Customer {
  id: string
  kind: CustomerKind
  /** The person's name, or the company's when kind is 'company' and there is no contact person. */
  name: string
  company?: string
  /**
   * Digits only, with country code ('5511987654321'), normalized by normalizePhone. The first one
   * is the WhatsApp number. A phone belongs to one customer only.
   */
  phones: string[]
  email?: string
  tags: string[]
  /** Who takes care of the customer (free text; v1 has one human user). */
  owner?: string
  /** ProjectFloor.id; missing = no floor. */
  floor?: string
  consent: ContactConsent
  source: CustomerSource
  /** Newest last, at most CRM_LIMITS.notes. */
  notes: CustomerNote[]
  /** Ticket ids tied to the customer (deals carry their own). */
  tickets: string[]
  /** Last contact either way (ms): set by hand in phase 1, by the conversation from phase 2. */
  lastContactAt?: number
  nextStep?: string
  /** 'AAAA-MM-DD'. */
  nextStepOn?: string
  createdAt: number
  updatedAt: number
  /** Demo mode: shown, never saved. */
  demo?: boolean
}

/** What the customer form sends. With `id` it edits that customer; without, it creates one. */
export interface CustomerDraft {
  id?: string
  kind?: CustomerKind
  name: string
  company?: string
  /** As typed; the main process normalizes them and refuses one that belongs to someone else. */
  phones?: string[]
  email?: string
  tags?: string[]
  owner?: string
  floor?: string
  /** Offers on/off and where the consent came from; the main process stamps the dates. */
  consent?: Partial<Pick<ContactConsent, 'service' | 'billing' | 'offers' | 'offersSource'>> & { clearOptOut?: boolean }
  tickets?: string[]
  lastContactAt?: number
  nextStep?: string
  nextStepOn?: string
}

// ---------- funil e negócios ----------

/** open = still in play; won and lost close the deal. */
export type StageKind = 'open' | 'won' | 'lost'

export interface PipelineStage {
  id: string
  name: string
  kind: StageKind
}

export interface Pipeline {
  id: string
  name: string
  /** In board order. At least one 'won' and one 'lost'. */
  stages: PipelineStage[]
}

export interface DealStageChange {
  t: number
  from?: string
  to: string
  by: CrmAuthor
}

export interface Deal {
  id: string
  customerId: string
  /** The service: "Site institucional", "Manutenção mensal". */
  title: string
  valueCents: number
  pipelineId: string
  stageId: string
  /** When the deal entered its current stage (ms): "dias na etapa". */
  stageAt: number
  nextStep?: string
  /** 'AAAA-MM-DD'. */
  nextStepOn?: string
  /** ProjectFloor.id; "Criar ticket" opens the ticket there. */
  floor?: string
  tickets: string[]
  /** Position inside its column (lower first). */
  order: number
  /** Stage changes, oldest first, at most CRM_LIMITS.history. Feeds the customer's timeline. */
  history: DealStageChange[]
  createdAt: number
  updatedAt: number
  /** Set when the deal reached a won or lost stage (ms). */
  closedAt?: number
  demo?: boolean
}

export interface DealDraft {
  id?: string
  customerId: string
  title: string
  valueCents?: number
  /** Missing = the default pipeline and its first stage. */
  pipelineId?: string
  stageId?: string
  nextStep?: string
  nextStepOn?: string
  floor?: string
  tickets?: string[]
}

// ---------- pagamentos ----------

/** What is stored. "Atrasado" is not stored: paymentStatus(p, today) works it out. */
export type PaymentState = 'open' | 'paid' | 'canceled' | 'disputed'
/** What the screen shows. */
export type PaymentStatus = 'open' | 'overdue' | 'paid' | 'canceled' | 'disputed'
/** PIX is the only one the CRM collects (fixed key); the rest are only recorded. */
export type PaymentMethod = 'pix' | 'boleto' | 'transfer' | 'card' | 'cash'

export interface Payment {
  id: string
  customerId: string
  dealId?: string
  /** Fatura: short number made by the main process ("2026-11-007"). */
  invoice: string
  amountCents: number
  /** Due date, 'AAAA-MM-DD'. */
  due: string
  /** "Referente a": "Manutenção · novembro/2026". */
  reference: string
  method: PaymentMethod
  owner?: string
  state: PaymentState
  /** 'AAAA-MM-DD', set by markPaid. */
  paidOn?: string
  /** The recurrence that made it. */
  recurrenceId?: string
  /** File name inside userData/crm/anexos (PDF), when one was attached. */
  attachment?: string
  createdAt: number
  updatedAt: number
  demo?: boolean
}

export interface PaymentDraft {
  id?: string
  customerId: string
  dealId?: string
  amountCents: number
  due: string
  reference: string
  method?: PaymentMethod
  owner?: string
  /** Only 'open', 'canceled' or 'disputed' here; paying goes through markPaid. */
  state?: Exclude<PaymentState, 'paid'>
}

/** "Todo dia 20, R$ 480, Manutenção": makes the payment of each month, leadDays before the due date. */
export interface Recurrence {
  id: string
  customerId: string
  dealId?: string
  amountCents: number
  /** Day of the month, 1 to 31; past the month's end it falls on the last day. */
  day: number
  /** Becomes the payment's "referente a", with the month: "Manutenção · novembro/2026". */
  reference: string
  method: PaymentMethod
  /** First month, 'AAAA-MM'. */
  start: string
  /** Last month, 'AAAA-MM'; missing = no end. */
  end?: string
  active: boolean
  /** Last month a payment was made for, 'AAAA-MM'. */
  lastMonth?: string
  createdAt: number
  updatedAt: number
  demo?: boolean
}

export interface RecurrenceDraft {
  id?: string
  customerId: string
  dealId?: string
  amountCents: number
  day: number
  reference: string
  method?: PaymentMethod
  start: string
  end?: string
  active?: boolean
}

// ---------- mensagens (fase 2 em diante; tipos agora para o contrato não mudar depois) ----------

export type MessageCategory = 'service' | 'billing' | 'offer'
export const MESSAGE_CATEGORIES: readonly MessageCategory[] = ['service', 'billing', 'offer']
export const MESSAGE_CATEGORY_LABEL: Record<MessageCategory, string> = {
  service: 'Atendimento',
  billing: 'Cobrança',
  offer: 'Oferta',
}

/** Per category: draft = only writes; approval = waits for the player; auto = the gate may send alone. */
export type Autonomy = 'draft' | 'approval' | 'auto'
export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  draft: 'Rascunho',
  approval: 'Aprovação',
  auto: 'Autônomo',
}

/**
 * What the send gate (src/shared/crm-gate.ts, fase 2) answers. The first rule that fails decides.
 * The decision table and the cases are in docs/adr/0017-portao-de-envio.md and
 * test/fixtures/crm-gate-cases.json.
 */
export type GateAction = 'send' | 'hold' | 'block' | 'schedule'

export interface GateDecision {
  action: GateAction
  /** The rule of the spec table that decided (1 to 14); 0 = it passed every rule. */
  rule: number
  /** pt-BR, for the draft card: "Espera você: 2ª oferta em 30 dias". */
  reason: string
  /** schedule: when to try again (ms). */
  at?: number
  /** Rule 13 (rehearsal on): it would have been sent; the card says "teria sido enviada". */
  rehearsal?: boolean
  /** The player may send anyway with a confirmation (time and frequency rules; never the offers opt-out). */
  overridable?: boolean
}

export type DraftStatus = 'pending' | 'sent' | 'held' | 'blocked' | 'scheduled' | 'discarded'

/** A message proposed by a bot or written by the player, before the gate. Text may carry {valor}, {vencimento}, {referente}, {pagamento}. */
export interface Draft {
  id: string
  customerId: string
  category: MessageCategory
  text: string
  by: CrmAuthor
  createdAt: number
  /** The inbound message it answers (rules 10 to 12 count only what we start). */
  replyTo?: string
  /** Billing: the payment it is about. */
  paymentId?: string
  /** Offer with a discount: percent and last day ('AAAA-MM-DD'). */
  discountPct?: number
  validUntil?: string
  status: DraftStatus
  decision?: GateDecision
}

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

/** One line of userData/crm/conversas/<customerId>.jsonl (same id = update, like the bots' thread). */
export type ConversationItem =
  | {
      id: string
      t: number
      kind: 'in'
      text: string
      waId: string
      media?: { type: 'image' | 'audio' | 'video' | 'document' | 'other'; name?: string }
    }
  | {
      id: string
      t: number
      kind: 'out'
      text: string
      /** 'phone' = the player answered from the phone (not through the app). */
      by: CrmAuthor | { kind: 'phone' }
      category?: MessageCategory
      status: DeliveryStatus
      waId?: string
      draftId?: string
      /** One per send, so a retry never sends twice. */
      key?: string
    }
  | { id: string; t: number; kind: 'draft'; draft: Draft }
  | { id: string; t: number; kind: 'notice'; text: string; tone?: 'info' | 'warn' | 'error' }

/** Where the WhatsApp link stands (top of the CRM screen). Phase 1 always sends 'off'. */
export interface CrmConnection {
  state: 'off' | 'connecting' | 'open' | 'close' | 'error'
  instance?: string
  /** What went wrong, pt-BR, with what to do. */
  error?: string
  /** The Evolution port answers on the local network too (docker-compose without 127.0.0.1). */
  lanExposed?: boolean
  /** Evolution server version, when known. */
  version?: string
}

// ---------- sugestões (fase 4) ----------

export interface Suggestion {
  id: string
  botId?: string
  t: number
  category: MessageCategory
  /** Why, in one line: "3 clientes sem contato há mais de 60 dias". */
  why: string
  customerIds: string[]
  /** Left out by the gate, with the reason: "não aceitou ofertas". */
  leftOut: { customerId: string; reason: string }[]
  text: string
  status: 'pending' | 'approved' | 'discarded' | 'expired'
  decidedAt?: number
}

// ---------- configurações ----------

/** Send hours of one weekday: null = never; else from and to, 'HH:MM'. */
export type DayHours = { from: string; to: string } | null

/** The CRM's rules: they live in crm.json (backed up with the data), changed in Configurações → CRM. */
export interface CrmSettings {
  /** Nothing goes out by itself: the bot writes, the gate decides, the screen shows what would have gone. */
  rehearsal: boolean
  autonomy: Record<MessageCategory, Autonomy>
  /** Index 0 = Sunday … 6 = Saturday. */
  hours: DayHours[]
  /** 'AAAA-MM-DD'; no message on these days. */
  holidays: string[]
  /** Messages we start, per customer. */
  perCustomer: { day: number; week: number }
  /** One offer per customer every this many days. */
  offerEveryDays: number
  /** Whole office. */
  globalCap: { hour: number; day: number }
  /** Seconds between sends, drawn between min and max. */
  intervalSec: { min: number; max: number }
  /** Reminder steps in days from the due date (negative = before). After the last one, it goes to the player. */
  dunning: number[]
  /** Highest discount a bot may offer (percent); 0 = only the player offers. */
  maxDiscountPct: number
  /** Configurações → CRM → Dados de pagamento. The model never types these; {pagamento} becomes them. */
  payment: {
    pixKey: string
    pixKeyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random' | ''
    payee: string
    bank: string
    /** Fixed text after the data, e.g. "Recibo na hora." */
    note: string
  }
  /** Domains allowed in a message ("meusite.com.br"); empty = no link. */
  allowedLinks: string[]
  /** The company name, for {empresa} in the signature. */
  company: string
  /** Added to a bot's first message to a customer. */
  signature: string
  /** Words that take the customer out of offers. */
  optOutWords: string[]
  /** Words that hand the conversation to the player. */
  alertWords: string[]
  /** "Parar tudo": cancels the queue and blocks every send until turned off. */
  stopAll: boolean
  /** A recurrence makes the month's payment this many days before the due date. */
  recurrenceLeadDays: number
}

/** Configurações → CRM, the part that lives in office.json: the screen is a preview, off by default. */
export interface CrmAppSettings {
  /** "CRM (prévia)": the V key, the HUD button and the screen. */
  enabled: boolean
}

// ---------- o que cruza o IPC ----------

/** Everything in crm.json, as crmList returns it. */
export interface CrmData {
  customers: Customer[]
  deals: Deal[]
  pipelines: Pipeline[]
  payments: Payment[]
  recurrences: Recurrence[]
  suggestions: Suggestion[]
  settings: CrmSettings
}

export type CrmCollection = 'customers' | 'deals' | 'pipelines' | 'payments' | 'recurrences' | 'suggestions'

/**
 * What changed, as the 'crm' event carries it: items to put in place (same id = replace),
 * ids removed, the new settings, or `reload` (import, restore, demo: read crmList again).
 */
export interface CrmDelta {
  customers?: Customer[]
  deals?: Deal[]
  pipelines?: Pipeline[]
  payments?: Payment[]
  recurrences?: Recurrence[]
  suggestions?: Suggestion[]
  removed?: Partial<Record<CrmCollection, string[]>>
  settings?: CrmSettings
  reload?: boolean
}

export interface CrmHit {
  kind: 'customer' | 'deal' | 'payment'
  id: string
  customerId: string
  /** "Maria · Padaria Trigo". */
  title: string
  /** "Proposta · R$ 4.800,00", "vence 20/11 · R$ 480,00". */
  detail: string
}

export type CrmCsvKind = 'customers' | 'deals' | 'payments'

/** One row of a customers CSV after parsing, before import. */
export interface CustomerImportRow {
  /** Line in the file (1 = first data line). */
  line: number
  draft: CustomerDraft
  /** Id of the customer that already has this phone: the player picks skip or update. */
  conflictWith?: string
  /** Why the row cannot be imported (pt-BR); such rows are skipped. */
  error?: string
}

export interface CustomerImportPreview {
  /** File name only (no path). */
  file: string
  rows: CustomerImportRow[]
}

/** skip = keep the customer as is; update = fill it with the row (offers still off). */
export type ImportChoice = 'skip' | 'update'

export interface CustomerImportResult {
  created: number
  updated: number
  skipped: number
}

export type CrmTab = 'conversations' | 'customers' | 'deals' | 'payments' | 'suggestions'
export const CRM_TABS: readonly CrmTab[] = ['conversations', 'customers', 'deals', 'payments', 'suggestions']
export const CRM_TAB_LABEL: Record<CrmTab, string> = {
  conversations: 'Conversas',
  customers: 'Clientes',
  deals: 'Negócios',
  payments: 'Pagamentos',
  suggestions: 'Sugestões',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  open: 'Aberto',
  overdue: 'Atrasado',
  paid: 'Pago',
  canceled: 'Cancelado',
  disputed: 'Em disputa',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'PIX',
  boleto: 'Boleto',
  transfer: 'Transferência',
  card: 'Cartão',
  cash: 'Dinheiro',
}

// ---------- limites e padrões ----------

export const CRM_LIMITS = {
  customers: 10_000,
  deals: 20_000,
  payments: 50_000,
  recurrences: 5_000,
  suggestions: 500,
  pipelines: 10,
  stages: 12,
  stageName: 30,
  name: 120,
  company: 120,
  phones: 5,
  /** E.164: at most 15 digits with the country code. */
  phoneDigits: 15,
  email: 254,
  tags: 20,
  tag: 30,
  owner: 60,
  note: 4_000,
  notes: 200,
  tickets: 50,
  title: 120,
  nextStep: 200,
  reference: 120,
  consentSource: 200,
  /** R$ 100 milhões, in cents. */
  amountCents: 10_000_000_000,
  /** Stage changes kept per deal. */
  history: 100,
  /** Customers CSV: file size and data rows. */
  csvBytes: 5 * 1024 * 1024,
  csvRows: 5_000,
  /** Hits crmSearch returns. */
  searchHits: 50,
  query: 200,
  /** Inbound and outbound message text (phase 2). */
  messageText: 4_000,
  holidays: 60,
  words: 40,
  word: 40,
  allowedLinks: 20,
  signature: 120,
  paymentField: 140,
} as const

export const DEFAULT_PIPELINE: Pipeline = {
  id: 'padrao',
  name: 'Vendas',
  stages: [
    { id: 'novo', name: 'Novo', kind: 'open' },
    { id: 'conversando', name: 'Conversando', kind: 'open' },
    { id: 'proposta', name: 'Proposta', kind: 'open' },
    { id: 'fechado', name: 'Fechado', kind: 'won' },
    { id: 'perdido', name: 'Perdido', kind: 'lost' },
  ],
}

export const CRM_DEFAULTS: CrmSettings = {
  rehearsal: true,
  autonomy: { service: 'approval', billing: 'approval', offer: 'draft' },
  // Domingo nunca; seg a sex 09:00–18:00; sábado 09:00–13:00.
  hours: [
    null,
    { from: '09:00', to: '18:00' },
    { from: '09:00', to: '18:00' },
    { from: '09:00', to: '18:00' },
    { from: '09:00', to: '18:00' },
    { from: '09:00', to: '18:00' },
    { from: '09:00', to: '13:00' },
  ],
  holidays: [],
  perCustomer: { day: 1, week: 3 },
  offerEveryDays: 30,
  globalCap: { hour: 30, day: 150 },
  intervalSec: { min: 8, max: 25 },
  dunning: [-3, 0, 3, 7],
  maxDiscountPct: 0,
  payment: { pixKey: '', pixKeyType: '', payee: '', bank: '', note: '' },
  allowedLinks: [],
  company: '',
  signature: '— Assistente virtual da {empresa}',
  optOutWords: ['parar', 'sair', 'não quero', 'descadastrar', 'pare'],
  alertWords: ['humano', 'atendente', 'pessoa', 'procon', 'advogado', 'processo', 'reclamação', 'golpe'],
  stopAll: false,
  recurrenceLeadDays: 10,
}

export const CRM_APP_DEFAULTS: CrmAppSettings = { enabled: false }
