import type { ConversationItem, CrmConnection, CrmQr, Customer, OfficeEvent } from '@shared/types'
import { maskPhone } from '@shared/crm'
import {
  MAX_FRAME,
  inboundItem,
  namespaceFrame,
  nextStatus,
  readConnectionUpdate,
  readSocketFrame,
  readWaId,
  readWaMessage,
  readWaUpdate,
  reconnectDelay,
  recordTime,
  syncSince,
  waItemId,
  type SocketEvent,
  type WaMessage,
  type WaSkip,
} from '@shared/crm-inbound'
import { log } from '../log'
import type { ConnectionView, EvolutionSender } from './contracts'
import type { ConversationStore } from './conversations'
import { nodeSocket, type EvolutionClient, type SocketFactory, type SocketLike } from './evolution'
import type { CrmStore } from './store'

// Os eventos do WhatsApp (CR-09, ADR 0015): WebSocket de saída para a Evolution (socket.io à mão,
// token no cabeçalho), reconexão de 1 s a 60 s e, enquanto ele está caído, busca com findMessages a
// cada 20 s. Ao abrir e ao reconectar, busca o que chegou desde a última mensagem vista. Cada
// mensagem vira um item da conversa; número desconhecido vira "Novo contato". Logs sem texto de
// mensagem e com o telefone mascarado.

export const POLL_MS = 20_000
/**
 * A message from this number may be one the app just sent: the server can announce it before
 * the Outbox writes its waId. It waits this long before counting as "answered from the phone".
 */
export const FROM_ME_GRACE_MS = 8_000
const SYNC_PAGE = 100
/** Pages one sync reads (oldest first); more than that continues in the next round. */
const SYNC_PAGES = 10
/** Rounds in a row when the backlog is bigger than one sync. */
const SYNC_ROUNDS = 20
const QR_EXPIRED = 'O QR code expirou sem leitura. Clique em Conectar para gerar outro.'

/** Ids seen lately, oldest out first. */
class Recent {
  private set = new Set<string>()
  constructor(private max: number) {}
  has(k: string): boolean {
    return this.set.has(k)
  }
  add(k: string): void {
    this.set.delete(k)
    this.set.add(k)
    if (this.set.size > this.max) this.set.delete(this.set.values().next().value as string)
  }
}

export interface EvolutionEventsDeps {
  store: CrmStore
  conversations: ConversationStore
  broadcast(e: OfficeEvent): void
  /** Opens the WebSocket (the tests pass a fake). */
  socket?: SocketFactory
  /** The local Evolution answers on the network too (CR-10)? Only asked for a local address. */
  lan?: (client: EvolutionClient) => Promise<boolean>
  now?: () => number
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export class EvolutionEvents implements ConnectionView {
  /**
   * A customer's message entered the conversation. The coordinator hooks the exit and alert
   * words (crm-portao) and the bots here; a failure in it never stops the next message.
   */
  onInbound?: (customerId: string, item: ConversationItem) => void

  private conn: CrmConnection = { state: 'off' }
  private client: EvolutionClient | null = null
  private ws: SocketLike | null = null
  private wsReady = false
  private attempt = 0
  private pingMs = 45_000
  private reconnectTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private deferred = new Map<string, NodeJS.Timeout>()
  private own: string | undefined
  private seen = new Recent(5_000)
  /** waIds the server announced as sent through the API (send.message): the app's own. */
  private appSent = new Recent(1_000)
  private syncRun: Promise<number> | null = null
  private syncAgain = false
  /** Bumped on start and stop: an answer from an older link is ignored. */
  private generation = 0
  private now: () => number

  constructor(private deps: EvolutionEventsDeps) {
    this.now = deps.now ?? Date.now
  }

  // ---------- ConnectionView ----------

  connected(): boolean {
    return this.conn.state === 'open'
  }

  ownNumber(): string | undefined {
    return this.own
  }

  current(): CrmConnection {
    return { ...this.conn }
  }

  /** The client of the link now (null while not configured). */
  evolution(): EvolutionClient | null {
    return this.client
  }

  /** What the Outbox sends through (CR-12, wired by the coordinator). */
  sender(): EvolutionSender | null {
    return this.client
  }

  // ---------- ligar e desligar ----------

  /** Starts the link with this client (null = not configured), dropping the previous one. */
  start(client: EvolutionClient | null): void {
    this.stop()
    this.client = client
    this.conn = { state: 'off' }
    if (!client) return this.publish()
    this.conn = { state: 'connecting', instance: client.instance, via: 'polling' }
    this.publish()
    this.startPolling()
    void this.boot(this.generation)
  }

  /** Not configured, with the reason (a stored address the app no longer accepts). */
  fail(error: string): void {
    this.stop()
    this.client = null
    this.conn = { state: 'off', error }
    this.publish()
  }

  stop(): void {
    this.generation++
    for (const t of [this.reconnectTimer, this.pingTimer]) if (t) clearTimeout(t)
    if (this.pollTimer) clearInterval(this.pollTimer)
    for (const t of this.deferred.values()) clearTimeout(t)
    this.deferred.clear()
    this.reconnectTimer = this.pingTimer = this.pollTimer = null
    this.closeSocket()
    this.wsReady = false
    this.attempt = 0
  }

  private async boot(gen: number): Promise<void> {
    const c = this.client
    if (!c) return
    // The instance's WebSocket with the CRM's events; a server with WebSocket off stays on polling.
    await c.setWebsocket().catch(() => false)
    if (gen !== this.generation) return
    this.openSocket()
    await this.refresh()
    const version = await c.version().catch(() => undefined)
    if (gen !== this.generation) return
    if (version) this.set({ version })
    if (c.local && this.deps.lan) {
      const exposed = await this.deps.lan(c).catch(() => false)
      if (gen !== this.generation) return
      this.set({ lanExposed: exposed })
    }
    await this.sync()
  }

  // ---------- estado ----------

  private publish(): void {
    this.deps.broadcast({ type: 'crm:connection', connection: this.current() })
  }

  private set(patch: Partial<CrmConnection>): void {
    const next = { ...this.conn, ...patch } as CrmConnection
    for (const k of Object.keys(next) as (keyof CrmConnection)[]) if (next[k] === undefined) delete next[k]
    if (JSON.stringify(next) === JSON.stringify(this.conn)) return
    if (next.state !== this.conn.state) log.info(`CRM: WhatsApp ${next.state}${next.via ? ` (${next.via})` : ''}`)
    this.conn = next
    this.publish()
  }

  /** Asks the server the WhatsApp state now. */
  async refresh(): Promise<CrmConnection> {
    const c = this.client
    if (!c) return this.current()
    const gen = this.generation
    try {
      const state = await c.state()
      if (gen !== this.generation) return this.current()
      if (state !== 'open') this.own = undefined
      this.set({ state, error: undefined })
      if (state === 'open' && !this.own) {
        const own = await c.ownNumber().catch(() => undefined)
        if (gen === this.generation) this.own = own
      }
    } catch (err) {
      if (gen === this.generation) this.set({ state: 'error', error: errorText(err) })
    }
    return this.current()
  }

  /** "Conectar" answered: the state it reported. */
  noteQr(qr: CrmQr): void {
    if (this.client) this.set({ state: qr.state, error: undefined })
  }

  /** The port check of CR-10. */
  setLan(exposed: boolean): void {
    if (this.client) this.set({ lanExposed: exposed })
  }

  // ---------- WebSocket ----------

  private openSocket(): void {
    const c = this.client
    if (!c || this.ws) return
    const gen = this.generation
    let ws: SocketLike
    try {
      ws = c.openEvents(this.deps.socket ?? nodeSocket)
    } catch (err) {
      log.warn(`CRM: não abri o canal de eventos (${errorText(err)})`)
      return this.socketDown(gen)
    }
    this.ws = ws
    ws.onmessage = (ev) => {
      if (gen === this.generation && this.ws === ws) this.onFrame(ws, gen, ev.data)
    }
    ws.onclose = () => {
      if (gen === this.generation && this.ws === ws) this.socketDown(gen)
    }
    // The close event follows an error.
    ws.onerror = () => undefined
  }

  private closeSocket(): void {
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null
    try {
      ws.close()
    } catch {
      // already closed
    }
  }

  private onFrame(ws: SocketLike, gen: number, data: unknown): void {
    if (typeof data !== 'string') return
    if (data.length > MAX_FRAME) return log.warn('CRM: um evento da Evolution passou de 2 MB e ficou de fora')
    const inst = this.client!.instance
    const f = readSocketFrame(data, inst)
    switch (f.type) {
      case 'open':
        this.pingMs = f.pingInterval + f.pingTimeout
        ws.send(namespaceFrame(inst))
        return this.watchPing(gen)
      case 'ping':
        ws.send('3')
        return this.watchPing(gen)
      case 'connected':
        return this.socketUp()
      case 'refused':
        log.warn(`CRM: a Evolution recusou o canal de eventos${f.message ? ` (${f.message})` : ''}`)
        return this.socketDown(gen)
      case 'disconnected':
      case 'close':
        return this.socketDown(gen)
      case 'event':
        return this.handleEvent(f.name, f.payload)
    }
  }

  private watchPing(gen: number): void {
    if (this.pingTimer) clearTimeout(this.pingTimer)
    this.pingTimer = setTimeout(() => {
      this.pingTimer = null
      if (gen !== this.generation) return
      log.info('CRM: o canal de eventos parou de responder; reconectando')
      this.socketDown(gen)
    }, this.pingMs)
    this.pingTimer.unref?.()
  }

  private socketUp(): void {
    if (!this.wsReady) log.info('CRM: eventos do WhatsApp chegando pelo WebSocket')
    this.wsReady = true
    this.attempt = 0
    this.stopPolling()
    this.set({ via: 'websocket' })
    // Opened or reconnected: what arrived meanwhile comes now.
    void this.refresh().then(() => this.sync())
  }

  private socketDown(gen: number): void {
    if (gen !== this.generation) return
    if (this.wsReady) log.info('CRM: o WebSocket caiu; buscando mensagens a cada 20 s até ele voltar')
    this.closeSocket()
    this.wsReady = false
    if (this.pingTimer) clearTimeout(this.pingTimer)
    this.pingTimer = null
    this.set({ via: 'polling' })
    this.startPolling()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (gen === this.generation) this.openSocket()
    }, reconnectDelay(this.attempt++))
    this.reconnectTimer.unref?.()
  }

  // ---------- busca periódica ----------

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.poll(), POLL_MS)
    this.pollTimer.unref?.()
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async poll(): Promise<void> {
    if (this.wsReady) return this.stopPolling()
    await this.refresh()
    if (this.conn.state !== 'error') await this.sync()
  }

  /**
   * Fetches what arrived since the last message seen (minus a margin, for late deliveries),
   * oldest first; one at a time. Returns how many messages entered the conversations.
   */
  sync(): Promise<number> {
    if (this.syncRun) {
      this.syncAgain = true
      return this.syncRun
    }
    const run = this.syncRounds().finally(() => {
      this.syncRun = null
      if (this.syncAgain) {
        this.syncAgain = false
        void this.sync()
      }
    })
    this.syncRun = run
    return run
  }

  private async syncRounds(): Promise<number> {
    let total = 0
    for (let round = 0; round < SYNC_ROUNDS; round++) {
      const before = this.deps.conversations.lastSeen()
      const r = await this.syncOnce(round > 0)
      total += r.added
      // A backlog bigger than one round goes on, as long as it moves forward.
      if (!r.more || (this.deps.conversations.lastSeen() ?? 0) <= (before ?? 0)) break
    }
    return total
  }

  private async syncOnce(continuation: boolean): Promise<{ added: number; more: boolean }> {
    const c = this.client
    if (!c) return { added: 0, more: false }
    const gen = this.generation
    const now = this.now()
    const last = this.deps.conversations.lastSeen()
    // The first link ever starts now: the CRM does not import the number's history.
    if (last === undefined) {
      this.deps.conversations.markSeen(now)
      return { added: 0, more: false }
    }
    const since = continuation ? last - 1_000 : syncSince(last, now)
    const until = now + 60_000
    const skipped: Partial<Record<WaSkip, number>> = {}
    let added = 0
    let newest = 0
    try {
      const first = await c.findMessages({ since, until, page: 1, size: SYNC_PAGE })
      if (gen !== this.generation) return { added, more: false }
      const pages = Math.max(1, first.pages)
      const stop = Math.max(1, pages - SYNC_PAGES + 1)
      for (let p = pages; p >= stop; p--) {
        const records = p === 1 ? first.records : (await c.findMessages({ since, until, page: p, size: SYNC_PAGE })).records
        if (gen !== this.generation) return { added, more: false }
        // Each page comes newest first: reversed, the whole round goes oldest first.
        for (const raw of [...records].reverse()) {
          const r = this.handleRecord(raw)
          if (r === true) added++
          else if (r) skipped[r] = (skipped[r] ?? 0) + 1
          const t = recordTime(raw, now)
          if (t !== undefined && t <= until) newest = Math.max(newest, t)
        }
      }
      if (newest) this.deps.conversations.markSeen(newest)
      const left = Object.entries(skipped)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')
      if (added || left) log.info(`CRM: sincronização trouxe ${added} mensagem(ns)${left ? `; fora: ${left}` : ''}`)
      return { added, more: stop > 1 }
    } catch (err) {
      if (newest) this.deps.conversations.markSeen(newest)
      if (gen === this.generation) log.debug(`CRM: sincronização falhou (${errorText(err)})`)
      return { added, more: false }
    }
  }

  // ---------- eventos ----------

  /** One event of the socket (public for the tests). */
  handleEvent(name: SocketEvent, payload: Record<string, unknown>): void {
    const inst = this.client?.instance
    // Only the instance's own channel is joined; an event naming another instance is not ours.
    if (!inst || (typeof payload.instance === 'string' && payload.instance !== inst)) return
    const data = payload.data
    const list = Array.isArray(data) ? data : [data]
    switch (name) {
      case 'messages.upsert':
        for (const raw of list) {
          const r = this.handleRecord(raw)
          const t = r === true ? recordTime(raw, this.now()) : undefined
          if (t !== undefined) this.deps.conversations.markSeen(t)
        }
        return
      case 'send.message':
        for (const raw of list) {
          const id = readWaId(raw)
          if (id) this.appSent.add(id)
        }
        return
      case 'messages.update':
        for (const raw of list) this.handleUpdate(raw)
        return
      case 'connection.update':
        return this.handleConnection(data)
      case 'qrcode.updated':
        if (this.conn.state !== 'open') this.set({ state: 'connecting' })
        return
    }
  }

  private handleConnection(data: unknown): void {
    const u = readConnectionUpdate(data)
    if (!u) return
    const was = this.conn.state
    if (u.state === 'open') {
      if (u.phone) this.own = u.phone
      this.set({ state: 'open', error: undefined })
      if (was !== 'open') void this.sync()
      if (!this.own) {
        const gen = this.generation
        void this.client
          ?.ownNumber()
          .then((own) => {
            if (gen === this.generation) this.own = own
          })
          .catch(() => undefined)
      }
    } else if (u.state === 'connecting') this.set({ state: 'connecting', error: undefined })
    else {
      this.own = undefined
      this.set({ state: 'close', error: u.refused ? QR_EXPIRED : undefined })
    }
  }

  private handleUpdate(raw: unknown): void {
    const u = readWaUpdate(raw)
    if (!u || !u.fromMe) return
    const { store, conversations } = this.deps
    const customerId = (u.phone ? store.ownerOfPhone(u.phone)?.id : undefined) ?? conversations.customerOfWa(u.waId)
    if (!customerId) return
    const item = conversations.findByWaId(customerId, u.waId)
    if (!item || item.kind !== 'out') return
    const status = nextStatus(item.status, u.status)
    if (status === item.status) return
    const next: ConversationItem = { ...item, status }
    conversations.put(customerId, next)
    this.emitItem(customerId, next)
  }

  /**
   * A message (event or findMessages record) into the conversation. True = it entered; a skip
   * reason when it was left out; false when it was already there or waits.
   */
  private handleRecord(raw: unknown): true | false | WaSkip {
    const r = readWaMessage(raw, this.now())
    if (!r.ok) return r.skip
    const m = r.message
    if (this.seen.has(m.waId)) return false
    const owner = this.deps.store.ownerOfPhone(m.phone)
    return m.fromMe ? this.fromMe(m, owner, raw) : this.fromCustomer(m, owner)
  }

  private fromMe(m: WaMessage, owner: Customer | undefined, raw: unknown): boolean {
    const { store, conversations } = this.deps
    // The player's message to a number outside the CRM stays outside.
    if (!owner) {
      this.seen.add(m.waId)
      return false
    }
    const sentByApp = (waId: string) => this.appSent.has(waId) || !!conversations.findByWaId(owner.id, waId)
    if (sentByApp(m.waId)) {
      this.seen.add(m.waId)
      return false
    }
    const age = this.now() - m.t
    if (age < FROM_ME_GRACE_MS) {
      if (!this.deferred.has(m.waId)) {
        const timer = setTimeout(
          () => {
            this.deferred.delete(m.waId)
            if (this.handleRecord(raw) === true) this.deps.conversations.markSeen(m.t)
          },
          FROM_ME_GRACE_MS - age + 50,
        )
        timer.unref?.()
        this.deferred.set(m.waId, timer)
      }
      return false
    }
    const item = inboundItem(m, sentByApp)
    if (!item) return false
    conversations.put(owner.id, item)
    this.seen.add(m.waId)
    // The bot keeps quiet for 12 h after the player answers from the phone (gate rule 9).
    const saved = store.patchCustomer(owner.id, { phoneReplyAt: Math.max(owner.phoneReplyAt ?? 0, m.t), lastContactAt: m.t })
    this.deps.broadcast({ type: 'crm', delta: saved.delta })
    this.emitItem(owner.id, item)
    log.info(`CRM: resposta pelo celular para ${maskPhone(m.phone)}`)
    return true
  }

  private fromCustomer(m: WaMessage, owner: Customer | undefined): boolean {
    const { store, conversations } = this.deps
    let customer = owner
    let created = false
    if (!customer) {
      try {
        customer = store.contactFromWhatsapp(m.phone, m.pushName).item
        created = true
        log.info(`CRM: novo contato pelo WhatsApp (${maskPhone(m.phone)})`)
      } catch (err) {
        log.warn(`CRM: não criei o contato de ${maskPhone(m.phone)} (${errorText(err)})`)
        return false
      }
    }
    if (conversations.get(customer.id, waItemId(m.waId))) {
      this.seen.add(m.waId)
      return false
    }
    const item = inboundItem(m, () => false)
    if (!item) return false
    conversations.put(customer.id, item)
    this.seen.add(m.waId)
    if (created) conversations.setWaiting(customer.id, 'new-contact')
    // A message from the first phone proves it has WhatsApp (gate rule 2).
    const saved = store.patchCustomer(customer.id, {
      lastContactAt: m.t,
      ...(customer.phones[0] === m.phone ? { phoneChecked: true } : {}),
    })
    this.deps.broadcast({ type: 'crm', delta: saved.delta })
    this.emitItem(customer.id, item)
    try {
      this.onInbound?.(customer.id, item)
    } catch (err) {
      log.warn(`CRM: o gancho de mensagem recebida falhou (${errorText(err)})`)
    }
    return true
  }

  private emitItem(customerId: string, item: ConversationItem): void {
    this.deps.broadcast({ type: 'crm:item', customerId, item })
    const summary = this.deps.conversations.summary(customerId)
    if (summary) this.deps.broadcast({ type: 'crm:summary', summary })
  }
}
