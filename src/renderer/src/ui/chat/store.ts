import { keepNewest, lastMessage, listedLastItem, newerItem, unreadFor, upsertItem } from '@shared/bots-view'
import type { Bot, BotEventTrigger, OfficeEvent, ThreadItem } from '@shared/types'
import { chatError } from './util'

// O espelho do Chat no renderer: a lista de bots, as automações de evento e os últimos itens de
// cada fio (para as não lidas e a linha de estado da lateral). Começa no boot, para o botão
// "Chat" do topo mostrar as não lidas com a tela fechada, e segue os eventos do office.
// Quando a lista já traz Bot.unread e Bot.last, o fio de cada bot não é lido no boot: a conta
// parte do número da lista e soma o que chega depois. Sem eles (um main antigo), lê os fios.

/** Items kept per thread for the sidebar: enough for the unread count and the last line. */
const RECENT = 50

type Listener = () => void
type ItemListener = (threadId: string, item: ThreadItem, added: boolean) => void

class ChatStore {
  bots: Bot[] = []
  triggers: BotEventTrigger[] = []
  /** Why the list could not load (a main process without the Chat, for one); null = fine. */
  error: string | null = null
  /** Why the event triggers could not load; the Automações screen says it. */
  triggersError: string | null = null
  loaded = false
  private recent = new Map<string, ThreadItem[]>()
  /** When the list carrying Bot.unread arrived, per bot: what comes after it adds up. */
  private listedAt = new Map<string, number>()
  private gotTriggersEvent = false
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
      if (!this.gotBotsEvent) this.setBots(bots)
      this.error = null
      this.loaded = true
      void this.reloadTriggers()
      await Promise.all(this.bots.filter((b) => b.unread === undefined).map((b) => this.loadRecent(b.id)))
    } catch (err) {
      this.error = chatError(err)
    }
    this.changed()
  }

  /** The event triggers (Automações); the `botTriggers` event keeps them current. */
  async reloadTriggers(): Promise<void> {
    try {
      const triggers = await window.office.listBotTriggers()
      if (!this.gotTriggersEvent) this.triggers = triggers
      this.triggersError = null
    } catch (err) {
      this.triggersError = chatError(err)
    }
    this.changed()
  }

  private setBots(bots: Bot[]): void {
    this.bots = bots
    const now = Date.now()
    for (const b of bots) this.listedAt.set(b.id, now)
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
    this.listedAt.set(bot.id, Date.now())
    if (!this.recent.has(bot.id)) this.recent.set(bot.id, [])
    this.changed()
  }

  trigger(id: string | null | undefined): BotEventTrigger | undefined {
    return id ? this.triggers.find((t) => t.id === id) : undefined
  }

  /** A trigger the form just saved (or paused): shown before the `botTriggers` event brings it. */
  upsertTrigger(t: BotEventTrigger): void {
    const i = this.triggers.findIndex((x) => x.id === t.id)
    this.triggers = i >= 0 ? this.triggers.map((x) => (x.id === t.id ? t : x)) : [...this.triggers, t]
    this.changed()
  }

  removeTrigger(id: string): void {
    this.triggers = this.triggers.filter((t) => t.id !== id)
    this.changed()
  }

  lastReadAt(bot: Bot): number {
    return this.readOverride.get(bot.id) ?? bot.lastReadAt
  }

  unread(id: string): number {
    const b = this.bot(id)
    if (!b) return 0
    return unreadFor({
      listed: b.unread,
      listedAt: this.listedAt.get(id) ?? Date.now(),
      items: this.recent.get(id) ?? [],
      lastReadAt: b.lastReadAt,
      override: this.readOverride.get(id),
    })
  }

  /** Sum over the bots that are not hidden: the number on the "Chat" button. */
  totalUnread(): number {
    let n = 0
    for (const b of this.bots) if (!b.hidden) n += this.unread(b.id)
    return n
  }

  /** The newest message: from the items at hand, or the list's Bot.last when that is newer. */
  last(id: string): ThreadItem | undefined {
    return newerItem(lastMessage(this.recent.get(id) ?? []), listedLastItem(id, this.bot(id)?.last))
  }

  /** The player saw the thread up to now. */
  markRead(id: string): void {
    const b = this.bot(id)
    if (!b) return
    const newest = (this.recent.get(id) ?? []).reduce((m, it) => Math.max(m, it.t), b.last?.t ?? 0)
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
        this.setBots(e.bots)
        for (const b of e.bots) {
          const o = this.readOverride.get(b.id)
          if (o !== undefined && (o === 0 ? b.lastReadAt === 0 : b.lastReadAt >= o)) this.readOverride.delete(b.id)
          if (!known.has(b.id) && !this.recent.has(b.id) && b.unread === undefined) void this.loadRecent(b.id).then(() => this.changed())
        }
        const ids = new Set(e.bots.map((b) => b.id))
        for (const id of [...this.recent.keys()]) if (!ids.has(id)) this.recent.delete(id)
        for (const id of [...this.listedAt.keys()]) if (!ids.has(id)) this.listedAt.delete(id)
        break
      }
      case 'bot:item': {
        const { items, added } = upsertItem(this.recent.get(e.threadId) ?? [], e.item)
        this.recent.set(e.threadId, keepNewest(items, RECENT))
        for (const fn of this.itemListeners) fn(e.threadId, e.item, added)
        break
      }
      case 'botTriggers':
        this.gotTriggersEvent = true
        this.triggers = e.triggers
        this.triggersError = null
        break
      default:
        return
    }
    this.changed()
  }
}

export const chatStore = new ChatStore()
