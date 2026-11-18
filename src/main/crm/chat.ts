import { randomUUID } from 'node:crypto'
import type {
  ConversationItem,
  ConversationPage,
  ConversationSummary,
  CrmDelta,
  CrmSendInput,
  CrmSettings,
  Customer,
  Draft,
  DraftAction,
  OfficeEvent,
} from '@shared/types'
import { maskPhone } from '@shared/crm'
import { outOfRound } from '@shared/crm-chat-view'
import { matchAlert, matchOptOut } from '@shared/crm-keywords'
import { log } from '../log'
import type { AuditLog, ConversationLog } from './contracts'
import type { EnqueueOptions } from './outbox'
import type { CrmStore } from './store'

// A aba Conversas no main (CR-14): enviar à mão, o cartão do rascunho, "Passar para mim", "Parar
// tudo", conferir o número e o que chega (palavras de saída e de alerta). Nada aqui chama a
// Evolution para enviar: todo envio vai por Outbox.enqueue, que passa pelo portão.

/** The conversation log as CR-14 uses it: the contract plus the list row and the waiting flag. */
export interface ChatLog extends ConversationLog {
  summary(customerId: string): ConversationSummary | undefined
  setWaiting(customerId: string, flag: 'handoff' | 'new-contact' | undefined): ConversationSummary | undefined
  /** "Apagar este cliente": the sync never brings these numbers' older messages back. */
  forgetPhones(phones: readonly string[], at: number): void
}

export interface ChatDeps {
  store: Pick<CrmStore, 'customer' | 'patchCustomer' | 'settings' | 'setSettings'>
  conversations: ChatLog
  outbox: {
    enqueue(draft: Draft, opts?: EnqueueOptions): Draft
    stopAll(): void
    optOut(customerId: string, inbound?: { id: string; at: number }): Draft | null
    forget(customerId: string): CrmDelta
  }
  audit: Pick<AuditLog, 'forget'>
  /** WhatsApp's "has WhatsApp?" for a number, while connected; null = not connected. */
  checkNumber(): ((number: string) => Promise<boolean>) | null
  broadcast(e: OfficeEvent): void
  now?: () => number
}

/** Draft states the card still acts on. */
const OPEN_DRAFT = new Set<Draft['status']>(['pending', 'held', 'blocked'])

const GONE = 'Esse cliente não existe mais. Feche a conversa.'

export class CrmChat {
  private readonly now: () => number

  constructor(private readonly deps: ChatDeps) {
    this.now = deps.now ?? Date.now
  }

  // ---------- ler ----------

  conversations(): ConversationSummary[] {
    return this.deps.conversations.summaries()
  }

  /** A page of the conversation; the first page marks it read. */
  conversation(customerId: string, before?: string): ConversationPage {
    this.customer(customerId)
    const page = this.deps.conversations.page(customerId, before)
    if (!before) {
      const summary = this.deps.conversations.markRead(customerId)
      if (summary) this.deps.broadcast({ type: 'crm:summary', summary })
    }
    return page
  }

  // ---------- escrever ----------

  /**
   * The player's message: a draft by the player, straight to the queue (the gate decides; the
   * player's own text skips rules 3, 7, 9, 13 and 14). Answers the newest unanswered inbound
   * message unless the screen named one.
   */
  send(input: CrmSendInput): Draft {
    this.customer(input.customerId)
    const reply = this.replyOf(input.customerId, input.replyTo)
    const draft: Draft = {
      id: randomUUID(),
      customerId: input.customerId,
      category: input.category,
      text: input.text,
      by: { kind: 'player' },
      createdAt: this.now(),
      status: 'pending',
      ...(reply ? { replyTo: reply.id, replyAt: reply.t } : {}),
    }
    const saved = this.deps.outbox.enqueue(draft, { approved: true, override: input.override === true })
    this.summary(input.customerId)
    return saved
  }

  /**
   * The draft card: "Enviar" (approves), "Enviar mesmo assim" (approves and overrides what the
   * gate lets the player pass) or "Descartar". An edited bot draft stays model text (ADR 0017, 4).
   */
  draft(customerId: string, draftId: string, action: DraftAction, text?: string): Draft {
    this.customer(customerId)
    const found = this.deps.conversations.get(customerId, draftId)
    if (found?.kind !== 'draft' || found.draft.customerId !== customerId) throw new Error('Esse rascunho não existe mais.')
    const draft = found.draft
    if (!OPEN_DRAFT.has(draft.status)) throw new Error('Esse rascunho já foi enviado, agendado ou descartado. Confira o fio da conversa.')
    if (action !== 'discard' && outOfRound(draft))
      throw new Error(
        'Este rascunho veio da rodada de outro cliente e não pode ir para este. Descarte e escreva uma mensagem nova, se fizer sentido.',
      )

    if (action === 'discard') {
      const saved: Draft = { ...draft, status: 'discarded' }
      this.putItem(customerId, { id: saved.id, t: found.t, kind: 'draft', draft: saved })
      log.info(`CRM: rascunho ${draft.id} descartado`)
      this.summary(customerId)
      return saved
    }

    const edited = text !== undefined && text !== draft.text
    const next: Draft = {
      ...draft,
      ...(edited ? { text, edited: draft.by.kind !== 'player' || draft.edited } : {}),
      status: 'pending',
    }
    delete next.decision
    if (!next.edited) delete next.edited
    const opts: EnqueueOptions = {
      approved: true,
      override: action === 'override',
      // A bot draft in a conversation answers that customer: the round of that conversation.
      run: draft.by.kind === 'bot' ? { kind: 'customer', customerId } : null,
    }
    const saved = this.deps.outbox.enqueue(next, opts)
    this.summary(customerId)
    return saved
  }

  // ---------- a conversa ----------

  /** "Passar para mim" / "Devolver ao bot". */
  handOff(customerId: string, toPlayer: boolean, why?: string): Customer {
    const before = this.customer(customerId)
    const { item, delta } = this.deps.store.patchCustomer(customerId, { handedToPlayer: toPlayer })
    this.deps.broadcast({ type: 'crm', delta })
    this.deps.conversations.setWaiting(customerId, toPlayer ? 'handoff' : undefined)
    if (!!before.handedToPlayer !== toPlayer) {
      const text = toPlayer ? (why ?? 'A conversa passou para você. O bot fica calado até você devolver.') : 'A conversa voltou para o bot.'
      this.putItem(customerId, { id: randomUUID(), t: this.now(), kind: 'notice', text, tone: toPlayer && why ? 'warn' : 'info' })
    }
    this.summary(customerId)
    return item
  }

  /** "Conferir número": asks WhatsApp whether the first phone has WhatsApp (gate rule 2). */
  async checkPhone(customerId: string): Promise<Customer> {
    const c = this.customer(customerId)
    const phone = c.phones[0]
    if (!phone) throw new Error('Esse cliente não tem telefone. Ponha um número na ficha e confira de novo.')
    const check = this.deps.checkNumber()
    if (!check) throw new Error('Conecte o WhatsApp antes de conferir o número (Configurações → CRM → WhatsApp).')
    const ok = await check(phone)
    if (!this.deps.store.customer(customerId)) throw new Error(GONE)
    if (!ok) {
      log.info(`CRM: ${maskPhone(phone)} não tem WhatsApp`)
      throw new Error(`O número ${maskPhone(phone)} não tem WhatsApp. Confira o DDD e os dígitos na ficha.`)
    }
    const { item, delta } = this.deps.store.patchCustomer(customerId, { phoneChecked: true })
    this.deps.broadcast({ type: 'crm', delta })
    return item
  }

  /** "Parar tudo": on cancels the queue; off (only the player, here or in the settings) frees the sends. */
  stopAll(on: boolean): CrmSettings {
    const { store, outbox } = this.deps
    if (on) outbox.stopAll()
    else if (store.settings.stopAll) {
      this.deps.broadcast({ type: 'crm', delta: store.setSettings({ ...store.settings, stopAll: false }) })
      log.info('CRM: Parar tudo desligado')
    }
    return store.settings
  }

  // ---------- o que chega ----------

  /**
   * A customer's message, after it went into the conversation (events.ts → onInbound). Exit words
   * take the customer out of offers, in code, before any model; alert words hand the
   * conversation to the player.
   */
  inbound(customerId: string, item: ConversationItem): void {
    if (item.kind !== 'in' || !item.text) return
    const c = this.deps.store.customer(customerId)
    if (!c) return
    const s = this.deps.store.settings
    if (matchOptOut(item.text, s.optOutWords)) {
      this.deps.outbox.optOut(customerId, { id: item.id, at: item.t })
      this.putItem(customerId, {
        id: randomUUID(),
        t: this.now(),
        kind: 'notice',
        text: 'O cliente pediu para sair das ofertas. Ofertas desligadas na ficha.',
        tone: 'warn',
      })
      this.summary(customerId)
    }
    const alert = matchAlert(item.text, s.alertWords)
    if (alert && !this.deps.store.customer(customerId)?.handedToPlayer) {
      this.handOff(customerId, true, `Palavra de alerta ("${alert}"): a conversa passou para você.`)
    }
  }

  // ---------- LGPD ----------

  /** "Apagar este cliente": the conversation file, the queue items with its text, and the audit keeps only date, category and hash. */
  forget(customerId: string): CrmDelta {
    const phones = this.deps.store.customer(customerId)?.phones ?? []
    const delta = this.deps.outbox.forget(customerId)
    this.deps.conversations.remove(customerId)
    this.deps.conversations.forgetPhones(phones, this.now())
    this.deps.audit.forget(customerId)
    return delta
  }

  // ---------- interno ----------

  private customer(customerId: string): Customer {
    const c = this.deps.store.customer(customerId)
    if (!c) throw new Error(GONE)
    return c
  }

  /** The inbound message a send answers: the named one, or the newest one with nothing sent after it. */
  private replyOf(customerId: string, named?: string): { id: string; t: number } | undefined {
    if (named) {
      const x = this.deps.conversations.get(customerId, named)
      return x?.kind === 'in' ? { id: x.id, t: x.t } : undefined
    }
    const items = this.deps.conversations.page(customerId).items
    for (let i = items.length - 1; i >= 0; i--) {
      const x = items[i]
      if (x.kind === 'in') return { id: x.id, t: x.t }
      if (x.kind === 'out') return undefined
    }
    return undefined
  }

  private putItem(customerId: string, item: ConversationItem): void {
    this.deps.conversations.put(customerId, item)
    this.deps.broadcast({ type: 'crm:item', customerId, item })
  }

  private summary(customerId: string): void {
    const summary = this.deps.conversations.summary(customerId)
    if (summary) this.deps.broadcast({ type: 'crm:summary', summary })
  }
}
