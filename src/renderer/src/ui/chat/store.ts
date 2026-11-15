import { keepNewest, lastMessage, unreadCount, upsertItem } from '@shared/bots-view'
import type { Bot, BotEventTrigger, OfficeEvent, ThreadItem } from '@shared/types'
import { chatError } from './util'

// O espelho do Chat no renderer: a lista de bots, as automações de evento e os últimos itens de
// cada fio (para as não lidas e a linha de estado da lateral). Começa no boot, para o botão
// "Chat" do topo mostrar as não lidas com a tela fechada, e segue os eventos do office.

/** Items kept per thread for the sidebar: enough for the unread count and the last line. */
const RECENT = 50

type Listener = () => void
type ItemListener = (threadId: string, item: ThreadItem, added: boolean) => void

class ChatStore {
  bots: Bot[] = []
  triggers: BotEventTrigger[] = []
  /** Why the list could not load (a main process without the Chat, for one); null = fine. */
  error: string | null = null
  loaded = false
  private recent = new Map<string, ThreadItem[]>()
  /** lastReadAt set here before the `bots` event confirms it (read now, or marked unread). */
  private readOverride = new Map<string, number>()
  private loading: Promise<void> | null = null
  private gotBotsEvent = false
  private listeners = new Set<Listener>()
  private itemListeners = new Set<ItemListener>()
  private frame = 0

  /** Loads once and follows the events; later calls return the same promise. */
  start(): Promise<void> {
    if (!this.loading) {
      window.office.onEvent((e) => this.apply(e))
      this.loading = this.reload()
    }
    return this.loading
  }

  /** Reads the list again (the "Tentar de novo" of the error screen). */
  async reload(): Promise<void> {
    try {
      const bots = await window.office.listBots()
      if (!this.gotBotsEvent) this.bots = bots
      this.error = null
      this.loaded = true
      await Promise.all(this.bots.map((b) => this.loadRecent(b.id)))
    } catch (err) {
      this.error = chatError(err)
    }
    this.changed()
  }

  private async loadRecent(threadId: string): Promise<void> {
    try {
      const page = await window.office.botThread(threadId, { limit: RECENT })
      // items that arrived while the page was on its way win over it
      let items = page.items
      for (const it of this.recent.get(threadId) ?? []) items = upsertItem(items, it).items
      this.recent.set(threadId, keepNewest(items, RECENT))
    } catch {
      // a thread that does not load leaves its row without a count; the open thread shows the error
    }
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onItem(fn: ItemListener): () => void {
    this.itemListeners.add(fn)
    return () => this.itemListeners.delete(fn)
  }

  /** Listeners run once per frame, however many events came in it. */
  private changed(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      for (const fn of this.listeners) fn()
    })
  }

  bot(id: string | null | undefined): Bot | undefined {
    return id ? this.bots.find((b) => b.id === id) : undefined
  }

  /** A bot the form just saved: shown before the `bots` event brings it. */
  upsertBot(bot: Bot): void {
    const i = this.bots.findIndex((b) => b.id === bot.id)
    if (i >= 0) this.bots[i] = bot
    else this.bots = [...this.bots, bot]
    if (!this.recent.has(bot.id)) this.recent.set(bot.id, [])
    this.changed()
  }

  lastReadAt(bot: Bot): number {
    return this.readOverride.get(bot.id) ?? bot.lastReadAt
  }

  unread(id: string): number {
    const b = this.bot(id)
    return b ? unreadCount(this.recent.get(id) ?? [], this.lastReadAt(b)) : 0
  }

  /** Sum over the bots that are not hidden: the number on the "Chat" button. */
  totalUnread(): number {
    let n = 0
    for (const b of this.bots) if (!b.hidden) n += this.unread(b.id)
    return n
  }

  last(id: string): ThreadItem | undefined {
    return lastMessage(this.recent.get(id) ?? [])
  }

  /** The player saw the thread up to now. */
  markRead(id: string): void {
    const b = this.bot(id)
    if (!b) return
    const newest = (this.recent.get(id) ?? []).reduce((m, it) => Math.max(m, it.t), 0)
    const at = Math.max(Date.now(), newest)
    if (!this.unread(id) && this.lastReadAt(b) >= newest) return
    this.readOverride.set(id, at)
    this.changed()
    window.office.markBotRead(id, at).catch(() => undefined)
  }

  /** "Marcar como não lido". */
  markUnread(id: string): Promise<void> {
    this.readOverride.set(id, 0)
    this.changed()
    return window.office.markBotRead(id, 0)
  }

  apply(e: OfficeEvent): void {
    switch (e.type) {
      case 'bots': {
        this.gotBotsEvent = true
        this.loaded = true
        this.error = null
        const known = new Set(this.bots.map((b) => b.id))
        this.bots = e.bots
        for (const b of e.bots) {
          const o = this.readOverride.get(b.id)
          if (o !== undefined && (o === 0 ? b.lastReadAt === 0 : b.lastReadAt >= o)) this.readOverride.delete(b.id)
          if (!known.has(b.id) && !this.recent.has(b.id)) void this.loadRecent(b.id).then(() => this.changed())
        }
        const ids = new Set(e.bots.map((b) => b.id))
        for (const id of [...this.recent.keys()]) if (!ids.has(id)) this.recent.delete(id)
        break
      }
      case 'bot:item': {
        const { items, added } = upsertItem(this.recent.get(e.threadId) ?? [], e.item)
        this.recent.set(e.threadId, keepNewest(items, RECENT))
        for (const fn of this.itemListeners) fn(e.threadId, e.item, added)
        break
      }
      case 'botTriggers':
        this.triggers = e.triggers
        break
      default:
        return
    }
    this.changed()
  }
}

export const chatStore = new ChatStore()
