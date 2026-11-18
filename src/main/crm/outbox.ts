import { randomUUID } from 'node:crypto'
import {
  CRM_LIMITS,
  type ConversationItem,
  type CrmDelta,
  type Draft,
  type DraftStatus,
  type GateDecision,
  type OfficeEvent,
  type OutboxItem,
} from '@shared/types'
import { maskPhone } from '@shared/crm'
import {
  draftPayment,
  fillPayment,
  gate,
  gateInput,
  globalCounts,
  type GateInput,
  type GatePayment,
  type GateRun,
  type GateSettings,
  type SentRecord,
} from '@shared/crm-gate'
import { OPT_OUT_REPLY } from '@shared/crm-keywords'
import { log } from '../log'
import { textHash } from './audit'
import {
  EvolutionError,
  type AuditEntry,
  type AuditLog,
  type ConnectionView,
  type ConversationLog,
  type EvolutionSender,
  type OutItem,
} from './contracts'
import type { CrmStore } from './store'

// Fila de envio do CRM (CR-12). O único caminho até a Evolution: enqueue → portão → fila → sendText.
// Um envio por vez, com intervalo sorteado; "digitando…" proporcional ao texto; até 3 tentativas em
// erro de rede, nunca em 4xx. O portão roda ao entrar e de novo no instante de enviar. Cada envio
// tem uma chave, e o estado "sending" vai para o disco antes de cada tentativa: o app que fecha no
// meio carrega o item como "failed" e nunca manda duas vezes.

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
/** "digitando…": 50 ms per character, between 0.5 s and 6 s. */
const PRESENCE_PER_CHAR = 50
const PRESENCE_MIN = 500
const PRESENCE_MAX = 6_000
/** Attempts per send, on network, timeout or 5xx only; the wait before the 2nd and the 3rd. */
const MAX_ATTEMPTS = 3
const RETRY_WAIT = [2_000, 8_000]
/** A scheduled send whose time passed this long ago (app closed) goes back to you. */
const STALE = DAY
/** The gate said "later" without a usable time: try again no sooner than this. */
const MIN_RESCHEDULE = MINUTE
/** The longest the queue sleeps before looking again (clock changes, sleep and resume). */
const MAX_SLEEP = HOUR
/** "Testar" in the audit: not a customer id (CRM ids have no parentheses). */
const SELF_TEST_ID = '(teste)'
/** The audit line of a send whose customer was deleted while it went out. */
const FORGOTTEN_ID = '(apagado)'

export const SELF_TEST_TEXT = 'Teste do Agent Office: a conexão com o WhatsApp está funcionando.'

/** The gate and its text filler; the tests pass fakes. */
export interface GatePort {
  gate(input: GateInput): GateDecision
  fillPayment(text: string, payment: GatePayment | null, settings: GateSettings): string
}

/** What the Outbox reads and writes in crm.json. */
export type OutboxStore = Pick<
  CrmStore,
  'customer' | 'payments' | 'settings' | 'outbox' | 'putOutbox' | 'dropOutbox' | 'patchCustomer' | 'setSettings' | 'flush'
>

export interface OutboxDeps {
  store: OutboxStore
  conversations: ConversationLog
  sender: EvolutionSender
  connection: ConnectionView
  audit: AuditLog
  /** The 'crm' and 'crm:item' events to the screen. */
  broadcast?(e: OfficeEvent): void
  gate?: GatePort
  now?: () => number
  /** [0, 1), for the interval between sends. */
  random?: () => number
}

export interface EnqueueOptions {
  /** The bot round that proposed it (gate rule 3). Ignored for your text and the system's. */
  run?: GateRun | null
  /** "Enviar" on the draft card. */
  approved?: boolean
  /** "Enviar mesmo assim", after the screen showed the reason. */
  override?: boolean
}

const STATUS: Record<GateDecision['action'], DraftStatus> = { send: 'scheduled', schedule: 'scheduled', hold: 'held', block: 'blocked' }
const OUTCOME: Record<GateDecision['action'], AuditEntry['outcome']> = {
  send: 'sent',
  schedule: 'scheduled',
  hold: 'held',
  block: 'blocked',
}

/** "digitando…" for a text, in ms: proportional, at most 6 s. */
export function presenceMs(text: string): number {
  return Math.min(PRESENCE_MAX, Math.max(PRESENCE_MIN, text.length * PRESENCE_PER_CHAR))
}

/** A stop that is not a gate rule (the queue's own): waits for you, rule 0. */
const queueHold = (reason: string): GateDecision => ({ action: 'hold', rule: 0, reason })

const STOP_ALL: GateDecision = {
  action: 'block',
  rule: 1,
  reason: 'Parar tudo cancelou este envio. Desligue o Parar tudo e mande de novo, se ainda fizer sentido.',
}
const DISCONNECTED: GateDecision = {
  action: 'block',
  rule: 1,
  reason: 'O WhatsApp desconectou antes do envio. Conecte de novo e mande outra vez.',
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The object without its undefined keys. */
function compact<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out as T
}

const NOT_LINKED = 'O WhatsApp não está configurado. Salve o endereço, a instância e o token em Configurações → CRM → WhatsApp.'

/** The Outbox sends through whatever client the link has now; none = a clear error, never a send. */
export function liveSender(current: () => EvolutionSender | null): EvolutionSender {
  const s = (): EvolutionSender => {
    const c = current()
    if (!c) throw new EvolutionError(NOT_LINKED, 'config')
    return c
  }
  return {
    sendText: async (number, text) => s().sendText(number, text),
    sendDocument: async (number, doc) => s().sendDocument(number, doc),
    presence: async (number, ms) => s().presence(number, ms),
    findSent: async (number, text, since) => s().findSent(number, text, since),
  }
}

export class Outbox {
  private readonly now: () => number
  private readonly random: () => number
  private readonly port: GatePort
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private closed = false
  /** Not before this (ms): the drawn interval after the last send. */
  private freeAt = 0
  /** One send at a time: the queue and "Testar" alike. */
  private chain: Promise<unknown> = Promise.resolve()
  /** "Testar" sends (ms): they count toward the global cap but have no queue item. */
  private selfSent: number[] = []

  constructor(private readonly deps: OutboxDeps) {
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.port = deps.gate ?? { gate, fillPayment }
  }

  // ---------- entrada ----------

  /**
   * Runs the gate, saves the decision on the draft (and in the audit, unless it is "send", which
   * the audit records when it goes out) and queues what may go: now, or at the gate's time.
   * Throws (pt-BR) when the message is already queued or sent, or its text is empty or too long.
   */
  enqueue(draft: Draft, opts: EnqueueOptions = {}): Draft {
    const { store } = this.deps
    const busy = store.outbox.find(
      (x) => x.draftId === draft.id && x.customerId === draft.customerId && x.state !== 'failed' && x.state !== 'canceled',
    )
    if (busy) throw new Error('Esta mensagem já está na fila ou já saiu. Confira o fio da conversa.')
    if (!draft.text.trim()) throw new Error('A mensagem está vazia. Escreva o texto antes de enviar.')
    const flags = {
      run: draft.by.kind === 'bot' ? (opts.run ?? null) : null,
      approved: opts.approved === true,
      override: opts.override === true,
    }
    const { decision, text } = this.judge(draft, flags)
    if (text.length > CRM_LIMITS.messageText)
      throw new Error(`A mensagem passou de ${CRM_LIMITS.messageText.toLocaleString('pt-BR')} caracteres. Encurte e envie de novo.`)
    const at = this.now()
    let key: string | undefined
    if (decision.action === 'send' || decision.action === 'schedule') {
      key = randomUUID()
      this.put(
        {
          key,
          draftId: draft.id,
          customerId: draft.customerId,
          category: draft.category,
          text,
          by: draft.by,
          replyTo: draft.replyTo,
          at: decision.action === 'schedule' ? this.later(decision, at) : at,
          attempts: 0,
          state: 'queued',
          approved: flags.approved || undefined,
          override: flags.override || undefined,
          createdAt: at,
        },
        false,
      )
    }
    const saved = this.saveDraft({ ...draft, status: STATUS[decision.action], decision })
    if (decision.action !== 'send') this.record(saved, text, OUTCOME[decision.action], decision.rule, key)
    log.info(`CRM: rascunho ${draft.id} (${draft.category}, ${draft.by.kind}) → ${decision.action}, regra ${decision.rule}`)
    if (key) this.wake()
    return saved
  }

  /**
   * The customer asked to leave the offers (matchOptOut): offers off, with the date, and the fixed
   * confirmation queued as the system's Atendimento, answering the message. Null when the customer
   * does not exist or had already left (no second confirmation).
   */
  optOut(customerId: string, inbound?: { id: string; at: number }): Draft | null {
    const { store } = this.deps
    const c = store.customer(customerId)
    if (!c || c.consent.optOutAt) return null
    this.emit(store.patchCustomer(customerId, { optOut: true }).delta)
    log.info(`CRM: cliente ${customerId} saiu das ofertas`)
    const reply: Draft = {
      id: randomUUID(),
      customerId,
      category: 'service',
      text: OPT_OUT_REPLY,
      by: { kind: 'system' },
      createdAt: this.now(),
      status: 'pending',
      ...(inbound ? { replyTo: inbound.id, replyAt: inbound.at } : {}),
    }
    try {
      return this.enqueue(reply)
    } catch (err) {
      // The opt-out already stuck; only the confirmation failed.
      log.warn(`CRM: a confirmação de saída das ofertas não entrou na fila: ${(err as Error).message}`)
      return null
    }
  }

  // ---------- Parar tudo ----------

  /**
   * "Parar tudo": turns the switch on (if it was off), cancels every queued send and stops the
   * retries of the one going out. Only the player turns it off, in the settings.
   */
  stopAll(): void {
    const { store } = this.deps
    if (!store.settings.stopAll) this.emit(store.setSettings({ ...store.settings, stopAll: true }))
    let n = 0
    for (const item of [...store.outbox]) {
      if (item.state !== 'queued') continue
      this.settle(item, STOP_ALL, 'canceled')
      n++
    }
    this.clearTimer()
    log.warn(`CRM: Parar tudo cancelou ${n} envio(s) da fila`)
  }

  // ---------- LGPD ----------

  /**
   * "Apagar este cliente": the customer's queue items leave crm.json (they carry the text). A send
   * already going out ends, but writes nothing more about the customer (put and putItem skip it).
   */
  forget(customerId: string): CrmDelta {
    const keys = this.deps.store.dropOutbox(customerId)
    if (keys.length) log.info(`CRM: ${keys.length} item(ns) da fila saíram com o cliente apagado`)
    return keys.length ? { outboxRemoved: keys } : {}
  }

  // ---------- "Testar" ----------

  /**
   * "Testar": a fixed text to the connected number itself, without the customer rules, but under
   * Parar tudo, the connection and the global cap. Answers what happened, pt-BR; throws what to do.
   */
  sendSelfTest(): Promise<string> {
    return this.exclusive(async () => {
      const { store, connection, sender } = this.deps
      const s = store.settings
      if (s.stopAll) throw new Error('"Parar tudo" está ligado. Desligue em Configurações → CRM e teste de novo.')
      if (!connection.connected()) throw new Error('O WhatsApp não está conectado. Clique em "Conectar" e leia o QR code no celular.')
      const own = connection.ownNumber()
      if (!own || !/^\d{8,15}$/.test(own)) throw new Error('Ainda não sei o número conectado. Espere o ponto ficar verde e teste de novo.')
      const now = this.now()
      const g = globalCounts(this.sentTimes(now), now)
      if (g.lastHour >= s.globalCap.hour || g.today >= s.globalCap.day) {
        throw new Error(`O teto de envios (${s.globalCap.hour} por hora, ${s.globalCap.day} por dia) foi atingido. Teste mais tarde.`)
      }
      try {
        await sender.sendText(own, SELF_TEST_TEXT)
      } catch (err) {
        log.warn(`CRM: teste para ${maskPhone(own)} falhou (${err instanceof EvolutionError ? err.kind : 'erro'})`)
        throw new Error(err instanceof EvolutionError ? err.message : 'O teste não saiu por um erro inesperado. Tente de novo.', {
          cause: err,
        })
      }
      const at = this.now()
      this.selfSent.push(at)
      this.deps.audit.record({
        t: at,
        customerId: SELF_TEST_ID,
        category: 'service',
        by: { kind: 'player' },
        outcome: 'sent',
        rule: 0,
        hash: textHash(SELF_TEST_TEXT),
      })
      log.info(`CRM: teste enviado para ${maskPhone(own)}`)
      return `Mensagem de teste enviada para o seu número (${maskPhone(own)}). Confira no celular.`
    })
  }

  // ---------- ciclo de vida ----------

  /**
   * At startup: a send scheduled for a time that passed more than 24 h ago goes back to you; a
   * send cut in the middle (loaded as failed, without an error) says so; then the queue runs.
   */
  start(): void {
    const { store } = this.deps
    const now = this.now()
    for (const item of [...store.outbox]) {
      if (item.state === 'queued' && item.at < now - STALE) {
        this.settle(
          item,
          {
            action: 'hold',
            rule: 10,
            reason: 'Espera você: ficou agendada com o app fechado e a hora passou há mais de 24 h. Confira se ainda faz sentido.',
          },
          'held',
        )
      } else if (item.state === 'failed' && !item.error) {
        const reason = 'O app fechou no meio do envio. Confira no celular se a mensagem saiu antes de mandar de novo.'
        this.put({ ...item, error: reason }, false)
        this.markOut(item, 'failed')
        const draft = this.draftOf(item)
        if (draft) this.saveDraft({ ...draft, status: 'held', decision: queueHold(`Não se sabe se saiu: ${reason}`) })
      }
    }
    this.wake()
  }

  /** Stops the timers (app quit, tests). What is queued stays in crm.json for the next start. */
  close(): void {
    this.closed = true
    this.clearTimer()
  }

  // ---------- a fila ----------

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Looks at the queue after `delay` ms (now, by default). */
  private wake(delay = 0): void {
    if (this.closed || this.running) return
    this.clearTimer()
    this.timer = setTimeout(() => void this.drain(), Math.min(Math.max(0, delay), MAX_SLEEP))
    this.timer.unref?.()
  }

  /** Runs `fn` after whatever send is going out. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  /** The queued item that goes next: earliest time, then oldest. */
  private next(): OutboxItem | undefined {
    let best: OutboxItem | undefined
    for (const x of this.deps.store.outbox) {
      if (x.state === 'queued' && (!best || x.at < best.at || (x.at === best.at && x.createdAt < best.createdAt))) best = x
    }
    return best
  }

  private async drain(): Promise<void> {
    this.timer = null
    if (this.closed || this.running) return
    this.running = true
    let delay: number | null = null
    try {
      for (;;) {
        const next = this.next()
        if (this.closed || !next) break
        const wait = Math.max(next.at, this.freeAt) - this.now()
        if (wait > 0) {
          delay = wait
          break
        }
        await this.exclusive(() => this.process(next))
        // Never spin on one item: one that is still due after its turn waits a minute.
        const after = this.deps.store.outbox.find((x) => x.key === next.key)
        if (after?.state === 'queued' && after.at <= this.now()) {
          delay = MINUTE
          break
        }
      }
    } catch (err) {
      log.error(`CRM: a fila parou por um erro; tenta de novo em 1 minuto: ${(err as Error).message}`)
      delay = MINUTE
    } finally {
      this.running = false
    }
    if (delay !== null) this.wake(delay)
  }

  /** The gate again, right before sending: Parar tudo, opt-out, connection, cap, window. */
  private async process(picked: OutboxItem): Promise<void> {
    const item = this.deps.store.outbox.find((x) => x.key === picked.key)
    if (!item || item.state !== 'queued') return
    const draft = this.draftOf(item)
    if (!draft) {
      this.settle(item, queueHold('O rascunho desta mensagem sumiu da conversa. Escreva de novo, se ainda fizer sentido.'), 'canceled')
      return
    }
    if (this.mayGo(item, draft)) await this.send(item, draft)
  }

  /**
   * The gate for this item now. True = send; otherwise the item was settled or rescheduled. Runs
   * when the item comes up and again before each attempt: typing and retries take seconds, and a
   * PARAR, a hand-off or an answer from the phone may arrive meanwhile.
   */
  private mayGo(item: OutboxItem, draft: Draft): boolean {
    // The round was checked when it entered; the destination of a queued item never changes.
    const run: GateRun | null = draft.by.kind === 'bot' ? { kind: 'customer', customerId: item.customerId } : null
    let judged: { decision: GateDecision; text: string }
    try {
      judged = this.judge(draft, { run, approved: item.approved === true, override: item.override === true })
    } catch (err) {
      log.error(`CRM: o portão falhou no instante de enviar ${item.key}: ${(err as Error).message}`)
      this.settle(item, queueHold('O portão não conseguiu decidir no instante de enviar. Confira e mande de novo.'), 'canceled')
      return false
    }
    const { decision, text } = judged
    if (text !== item.text) {
      this.settle(
        item,
        queueHold('O texto ou os dados de pagamento mudaram depois de a mensagem entrar na fila. Confira e mande de novo.'),
        'canceled',
      )
      return false
    }
    if (decision.action === 'block' || decision.action === 'hold') this.settle(item, decision, OUTCOME[decision.action])
    else if (decision.action === 'schedule') this.reschedule(item, draft, decision)
    else return true
    return false
  }

  /** The gate said "later": the item waits for the new time. */
  private reschedule(item: OutboxItem, draft: Draft, decision: GateDecision): void {
    this.put({ ...item, state: 'queued', at: this.later(decision, this.now()) }, false)
    this.saveDraft({ ...draft, status: 'scheduled', decision })
    this.record(draft, item.text, 'scheduled', decision.rule, item.key)
  }

  /** The gate's time, or a minute from now when it gave none (or one already past): never a tight loop. */
  private later(decision: GateDecision, now: number): number {
    return decision.at !== undefined && decision.at > now ? decision.at : now + MIN_RESCHEDULE
  }

  /** Why the send must not go now, or null: Parar tudo or the connection, checked before every attempt. */
  private stopNow(): GateDecision | null {
    if (this.deps.store.settings.stopAll) return STOP_ALL
    if (!this.deps.connection.connected()) return DISCONNECTED
    return null
  }

  private async send(queued: OutboxItem, draft: Draft): Promise<void> {
    const { store, sender } = this.deps
    const number = store.customer(queued.customerId)?.phones[0]
    if (!number) {
      this.settle(queued, queueHold('O cliente ficou sem telefone. Confira a ficha.'), 'canceled')
      return
    }
    this.markOut(queued, 'queued')
    await this.typing(number, queued.text)
    // Still "queued" while typing (nothing went out yet): Parar tudo may have canceled it meanwhile.
    let item = store.outbox.find((x) => x.key === queued.key)
    if (!item || item.state !== 'queued') return
    let error = 'O envio falhou por um erro inesperado.'
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const stop = this.stopNow()
      if (stop) {
        this.settle(item, stop, 'canceled')
        return
      }
      if (!this.mayGo(item, draft)) return
      // On disk before the call: an app closed from here on loads it as failed, never sends it twice.
      item = this.put({ ...item, state: 'sending', attempts: item.attempts + 1 }, true)
      const tried = this.now()
      let reply: { waId: string } | null | undefined
      try {
        reply = await sender.sendText(number, item.text)
      } catch (err) {
        const e = err instanceof EvolutionError ? err : null
        if (e) error = e.message
        log.warn(`CRM: envio ${item.key} para ${maskPhone(number)} falhou (${e?.kind ?? 'erro'}; tentativa ${attempt} de ${MAX_ATTEMPTS})`)
        if (!e?.retryable) break
        const last = attempt === MAX_ATTEMPTS
        if (!last || e.maybeDelivered) await sleep(RETRY_WAIT[Math.min(attempt, RETRY_WAIT.length) - 1])
        // A timeout or a 5xx may come after the server sent it: ask before sending again (or
        // before calling the last one failed). No way to tell = stop and hand it to the player.
        reply = e.maybeDelivered ? await this.alreadySent(number, item.text, tried) : null
        if (reply === undefined || (!reply && last)) break
        if (!reply) continue
      }
      // Outside the try: a disk error while saving "sent" is not a failed send to try again.
      this.sent(item, draft, reply.waId, number, attempt)
      return
    }
    item = this.put({ ...item, state: 'failed', error }, true)
    this.markOut(item, 'failed')
    this.saveDraft({ ...draft, status: 'held', decision: queueHold(`Não saiu: ${error} Confira no celular antes de mandar de novo.`) })
    this.record(draft, item.text, 'failed', 0, item.key)
    this.freeAt = this.now() + this.interval()
  }

  /**
   * After an ambiguous failure: the server's copy of what we sent since `since` (a little before,
   * for clock skew). null = it did not go out; undefined = no way to tell, so the queue stops.
   */
  private async alreadySent(number: string, text: string, since: number): Promise<{ waId: string } | null | undefined> {
    try {
      return await this.deps.sender.findSent(number, text, since - 60_000)
    } catch (err) {
      log.warn(
        `CRM: não deu para conferir se o envio para ${maskPhone(number)} saiu (${err instanceof EvolutionError ? err.kind : 'erro'})`,
      )
      return undefined
    }
  }

  /** It went out: the queue first (on disk), then the conversation, the draft, the audit and the customer. */
  private sent(item: OutboxItem, draft: Draft, waId: string, number: string, attempt: number): void {
    const sentAt = this.now()
    const done = this.put({ ...item, state: 'sent', sentAt, waId, error: undefined }, true)
    this.markOut(done, 'sent', { waId, t: sentAt })
    this.saveDraft({ ...draft, status: 'sent' })
    this.record(draft, done.text, 'sent', 0, done.key, done.override === true)
    try {
      this.emit(this.deps.store.patchCustomer(done.customerId, { lastContactAt: sentAt }).delta)
    } catch {
      // the customer was deleted while the message went out
    }
    this.freeAt = sentAt + this.interval()
    log.info(`CRM: envio ${done.key} saiu para ${maskPhone(number)} (${done.category}, tentativa ${attempt})`)
  }

  /** "digitando…" for a time proportional to the text; the send waits for it even if the server answers at once. */
  private async typing(number: string, text: string): Promise<void> {
    const ms = presenceMs(text)
    const started = this.now()
    try {
      await this.deps.sender.presence(number, ms)
    } catch {
      // "digitando…" is a courtesy: the send decides
    }
    const rest = ms - (this.now() - started)
    if (rest > 0) await sleep(rest)
  }

  /** Seconds between sends, drawn between the settings' min and max, in ms. */
  private interval(): number {
    const { min, max } = this.deps.store.settings.intervalSec
    const lo = Math.max(0, Math.min(min, max))
    const hi = Math.max(lo, min, max)
    return Math.round((lo + this.random() * (hi - lo)) * 1000)
  }

  /**
   * A queued item leaves the queue without going out: canceled, its draft with the decision (held
   * or blocked, for the card), its out item (if any) failed, and a line in the audit.
   */
  private settle(item: OutboxItem, decision: GateDecision, outcome: AuditEntry['outcome']): void {
    const done = this.put({ ...item, state: 'canceled', error: decision.reason }, false)
    this.markOut(done, 'failed')
    const draft = this.draftOf(item)
    if (draft) this.saveDraft({ ...draft, status: STATUS[decision.action], decision })
    this.record(draft ?? { customerId: item.customerId, category: item.category, by: item.by }, item.text, outcome, decision.rule, item.key)
  }

  // ---------- portão ----------

  /** Fills the text, builds the gate's input from crm.json, the conversation and the queue, and asks the gate. */
  private judge(
    draft: Draft,
    flags: { run: GateRun | null; approved: boolean; override: boolean },
  ): { decision: GateDecision; text: string } {
    const { store, connection } = this.deps
    const now = this.now()
    const settings = store.settings
    const payments = store.payments.filter((p) => p.customerId === draft.customerId)
    const text = this.port.fillPayment(draft.text, draftPayment(draft.paymentId, draft.customerId, payments), settings)
    const input = gateInput({
      now,
      connected: connection.connected(),
      settings,
      customer: store.customer(draft.customerId),
      payments,
      history: this.history(draft.customerId, now),
      sent: this.sentTimes(now),
      run: flags.run,
      draft,
      approved: flags.approved,
      override: flags.override,
    })
    return { decision: this.port.gate(input), text }
  }

  /**
   * What went out to the customer in the window the rules look at (7 days, or the offers' period).
   * Initiated comes from the queue item (no replyTo); a message the queue does not know (sent from
   * the phone, or an item gone from the queue) counts as initiated: on doubt, the limits hold more.
   */
  private history(customerId: string, now: number): SentRecord[] {
    const { store, conversations } = this.deps
    const since = now - Math.max(7, store.settings.offerEveryDays) * DAY
    const queue = new Map(store.outbox.filter((x) => x.customerId === customerId).map((x) => [x.key, x]))
    return conversations
      .sentSince(customerId, since)
      .filter((o) => o.status !== 'queued' && o.status !== 'failed')
      .map((o) => {
        const q = o.key ? queue.get(o.key) : undefined
        return { t: o.t, category: o.category, initiated: q ? !q.replyTo : true, text: o.text }
      })
  }

  /** When each send of the office went out, from the queue's sentAt and "Testar", over the last two days. */
  private sentTimes(now: number): number[] {
    const since = now - 2 * DAY
    const out: number[] = []
    for (const x of this.deps.store.outbox) if (x.state === 'sent' && x.sentAt !== undefined && x.sentAt > since) out.push(x.sentAt)
    this.selfSent = this.selfSent.filter((t) => t > since)
    return out.concat(this.selfSent)
  }

  // ---------- gravar ----------

  /** Puts the queue item in place; `durable` writes crm.json now (before and after a send). */
  private put(item: OutboxItem, durable: boolean): OutboxItem {
    // The customer was deleted meanwhile (a send in flight): nothing more about them on disk.
    if (!this.deps.store.customer(item.customerId)) return item
    const saved = this.deps.store.putOutbox(compact(item))
    if (durable) this.deps.store.flush()
    this.emit(saved.delta)
    return saved.item
  }

  private draftOf(item: OutboxItem): Draft | undefined {
    const found = this.deps.conversations.get(item.customerId, item.draftId)
    return found?.kind === 'draft' && found.draft.customerId === item.customerId ? found.draft : undefined
  }

  private saveDraft(draft: Draft): Draft {
    this.putItem(draft.customerId, { id: draft.id, t: draft.createdAt, kind: 'draft', draft })
    return draft
  }

  /** The 'out' item of a queue item (id = the key): written when it starts going, then sent or failed. */
  private markOut(item: OutboxItem, status: OutItem['status'], extra: { waId?: string; t?: number } = {}): void {
    const before = this.deps.conversations.get(item.customerId, item.key)
    if (status === 'failed' && before?.kind !== 'out') return
    const out: OutItem = compact({
      id: item.key,
      t: extra.t ?? (before?.kind === 'out' ? before.t : this.now()),
      kind: 'out',
      text: item.text,
      by: item.by,
      category: item.category,
      status,
      waId: extra.waId,
      draftId: item.draftId,
      key: item.key,
    })
    this.putItem(item.customerId, out)
  }

  private putItem(customerId: string, item: ConversationItem): void {
    if (!this.deps.store.customer(customerId)) return
    this.deps.conversations.put(customerId, item)
    this.deps.broadcast?.({ type: 'crm:item', customerId, item })
  }

  private record(
    who: Pick<Draft, 'customerId' | 'category' | 'by'>,
    text: string,
    outcome: AuditEntry['outcome'],
    rule: number,
    key?: string,
    override?: boolean,
  ): void {
    this.deps.audit.record(
      compact({
        t: this.now(),
        // A customer deleted while the message went out: the line keeps only date, category and hash.
        customerId: this.deps.store.customer(who.customerId) ? who.customerId : FORGOTTEN_ID,
        category: who.category,
        by: who.by,
        outcome,
        rule,
        hash: textHash(text),
        key,
        ...(override ? { override: true as const } : {}),
      }),
    )
  }

  private emit(delta: CrmDelta): void {
    if (Object.keys(delta).length) this.deps.broadcast?.({ type: 'crm', delta })
  }
}
