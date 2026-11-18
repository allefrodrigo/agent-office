import { conversationsWaiting, putItem, putSummary } from '@shared/crm-chat-view'
import type { ConversationItem, ConversationSummary, OfficeEvent } from '@shared/types'
import { crmError } from './util'

// As conversas de WhatsApp no renderer (CR-14): a lista (um resumo por cliente) e o fio aberto.
// Lê com crmConversations() e crmConversation(); segue os eventos crm:summary e crm:item.
// Texto de cliente: a tela desenha com textContent, nunca como HTML.

type Listener = () => void

export interface Thread {
  items: ConversationItem[]
  /** Older items exist on the main side. */
  more: boolean
  loading: boolean
  error: string | null
}

class ChatStore {
  summaries: ConversationSummary[] = []
  loaded = false
  error: string | null = null
  private threads = new Map<string, Thread>()
  private subscribed = false
  private loading: Promise<void> | null = null
  private listeners = new Set<Listener>()
  private frame = 0

  start(): Promise<void> {
    if (!this.subscribed) {
      this.subscribed = true
      window.office.onEvent((e) => this.apply(e))
    }
    if (!this.loading) this.loading = this.reload()
    return this.loading
  }

  async reload(): Promise<void> {
    try {
      const list = await window.office.crmConversations()
      // events that came while the list was on its way stay: they are newer
      let next = list
      for (const s of this.summaries) if (!list.some((x) => x.customerId === s.customerId && x.t >= s.t)) next = putSummary(next, s)
      this.summaries = next
      this.error = null
      this.loaded = true
    } catch (err) {
      this.error = crmError(err)
    }
    this.changed()
  }

  /** The thread of a customer, when it was opened this session. */
  thread(customerId: string): Thread | undefined {
    return this.threads.get(customerId)
  }

  /** Opens (or reopens) a conversation: the newest page; the main marks it read. */
  async open(customerId: string): Promise<void> {
    const t: Thread = this.threads.get(customerId) ?? { items: [], more: false, loading: false, error: null }
    t.loading = true
    this.threads.set(customerId, t)
    this.changed()
    try {
      const page = await window.office.crmConversation(customerId)
      // items that arrived by event while the page came are kept
      let items = page.items
      for (const x of t.items) if (!items.some((y) => y.id === x.id) && x.t >= (page.items[0]?.t ?? 0)) items = putItem(items, x)
      t.items = items
      t.more = page.more
      t.error = null
    } catch (err) {
      t.error = crmError(err)
    } finally {
      t.loading = false
    }
    this.changed()
  }

  /** "Mensagens anteriores". */
  async older(customerId: string): Promise<void> {
    const t = this.threads.get(customerId)
    if (!t || t.loading || !t.more || !t.items.length) return
    t.loading = true
    this.changed()
    try {
      const page = await window.office.crmConversation(customerId, t.items[0].id)
      const seen = new Set(t.items.map((x) => x.id))
      t.items = page.items.filter((x) => !seen.has(x.id)).concat(t.items)
      t.more = page.more
    } catch (err) {
      t.error = crmError(err)
    } finally {
      t.loading = false
    }
    this.changed()
  }

  /** Conversations waiting for the player (the "CRM" button counts them). */
  waiting(): number {
    return conversationsWaiting(this.summaries)
  }

  /** What the screen just did (a send, a draft decided): shown before the event brings it. */
  put(customerId: string, item: ConversationItem): void {
    const t = this.threads.get(customerId)
    if (!t) return
    t.items = putItem(t.items, item)
    this.changed()
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      for (const fn of this.listeners) fn()
    })
  }

  private apply(e: OfficeEvent): void {
    if (e.type === 'crm:summary') {
      this.summaries = putSummary(this.summaries, e.summary)
      this.changed()
    } else if (e.type === 'crm:item') {
      this.put(e.customerId, e.item)
    } else if (e.type === 'crm' && e.delta.removed?.customers?.length) {
      const gone = new Set(e.delta.removed.customers)
      this.summaries = this.summaries.filter((s) => !gone.has(s.customerId))
      for (const id of gone) this.threads.delete(id)
      this.changed()
    }
  }
}

export const crmChatStore = new ChatStore()
