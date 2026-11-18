// Fase 2 da Sala de CRM: o que as peças do main combinam entre si. O coordenador escreveu este
// arquivo antes de abrir os agentes crm-whatsapp (CR-08 a CR-10) e crm-portao (CR-11 a CR-13);
// cada um implementa o seu lado e usa o do outro só por estas interfaces. Mudar algo aqui é
// pedir ao coordenador.

import type { ConversationItem, ConversationPage, ConversationSummary, CrmAuthor, CrmConnection, MessageCategory } from '@shared/types'

// ---------- Evolution (crm-whatsapp implementa em evolution.ts) ----------

/**
 * How a call to the Evolution failed. The Outbox retries refused, network, timeout and http5xx
 * (up to 3 times), never http4xx. refused = the request never reached the server (connection
 * refused, DNS): nothing went out. network, timeout and http5xx may come after the server already
 * sent the message: the Outbox asks findSent before trying again.
 */
export type EvolutionErrorKind = 'config' | 'refused' | 'network' | 'timeout' | 'http4xx' | 'http5xx' | 'schema' | 'not-whatsapp'

/** pt-BR message that says what to do, never the token, the URL's secrets or message text. */
export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly kind: EvolutionErrorKind,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'EvolutionError'
  }

  get retryable(): boolean {
    return this.kind === 'refused' || this.kind === 'network' || this.kind === 'timeout' || this.kind === 'http5xx'
  }

  /** The server may have sent the message before this error: check with findSent before trying again. */
  get maybeDelivered(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'http5xx'
  }
}

/**
 * The sending side of EvolutionClient. Only src/main/crm/outbox.ts may call these: a test of
 * architecture (crm-portao) fails when another file calls send*. `number` is digits only, with
 * the country code (normalizePhone), never a JID chosen by a model.
 */
export interface EvolutionSender {
  /** Resolves with WhatsApp's id of the message. */
  sendText(number: string, text: string): Promise<{ waId: string }>
  sendDocument(number: string, doc: { fileName: string; base64: string; caption?: string }): Promise<{ waId: string }>
  /** "digitando…" for `ms` (the Outbox: proportional to the text, at most 6 s). */
  presence(number: string, ms: number): Promise<void>
  /**
   * A message we sent (fromMe) to `number` with exactly `text`, at or after `since` (ms), as
   * findMessages has it; null when there is none. Throws EvolutionError when it cannot tell: the
   * Outbox then stops and hands the draft back ("confira no celular"), never sends blind.
   */
  findSent(number: string, text: string, since: number): Promise<{ waId: string } | null>
}

/** The link as the Outbox and the gate see it (crm-whatsapp implements it in events.ts). */
export interface ConnectionView {
  /** WhatsApp connected now (gate rule 1). */
  connected(): boolean
  /** The connected number (digits), for "Testar"; undefined until known. */
  ownNumber(): string | undefined
  current(): CrmConnection
}

// ---------- conversas (crm-whatsapp implementa em conversations.ts) ----------

export type OutItem = Extract<ConversationItem, { kind: 'out' }>

/**
 * userData/crm/conversas/<customerId>.jsonl, only appended (same id = update, like the bots'
 * thread). Folders 0700, files 0600. Text is stored as plain text, already cleaned.
 */
export interface ConversationLog {
  /** Appends the item; an item with an id already there replaces it when read. */
  put(customerId: string, item: ConversationItem): void
  get(customerId: string, itemId: string): ConversationItem | undefined
  /** Outbound messages since `since` (ms), oldest first: the gate's history (rules 8 and 11). */
  sentSince(customerId: string, since: number): OutItem[]
  /** Newest last; `before` = an item id to page back from. */
  page(customerId: string, before?: string, limit?: number): ConversationPage
  /** One row per customer with a conversation, newest first. */
  summaries(): ConversationSummary[]
  /** The player opened the conversation: unread goes to 0. */
  markRead(customerId: string): ConversationSummary | undefined
  /** LGPD: "Apagar este cliente" removes the file. */
  remove(customerId: string): void
}

// ---------- auditoria (crm-portao implementa em audit.ts) ----------

/** One line of userData/crm/auditoria.jsonl: never the text, only its hash. */
export interface AuditEntry {
  t: number
  customerId: string
  category: MessageCategory
  by: CrmAuthor | { kind: 'phone' }
  /** sent = it went out; blocked, held, scheduled = the gate's decision; canceled = "Parar tudo" or the player. */
  outcome: 'sent' | 'blocked' | 'held' | 'scheduled' | 'canceled' | 'failed'
  /** The gate rule that decided (0 = passed every rule). */
  rule: number
  /** sha256 of the final text, hex. */
  hash: string
  /** Outbox key, when there is one. */
  key?: string
  /** It went out with "Enviar mesmo assim": the player passed over a rule the gate lets them pass. */
  override?: true
}

export interface AuditLog {
  record(e: AuditEntry): void
  /** "Apagar este cliente": the customer's lines keep only date, category and hash. */
  forget(customerId: string): void
}
