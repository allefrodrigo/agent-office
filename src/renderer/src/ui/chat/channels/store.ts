import { keepNewest, lastMessage, unreadCount, upsertItem } from '@shared/bots-view'
import { sortChannels } from '@shared/bots-mentions'
import type { Bot, Channel, OfficeEvent, ThreadItem } from '@shared/types'
import { chatError } from '../util'

// O espelho dos canais no renderer (CB-20): a lista, os últimos itens de cada fio (para as não
// lidas e a hora na lateral) e o que você leu. Começa quando o Chat abre e segue os eventos
// `channels` e `bot:item` do office.

/** Items kept per channel for the sidebar. */
const RECENT = 50

type Listener = () => void

class ChannelMirror {
  channels: Channel[] = []
  /** Why the list could not load; null = fine. */
  error: string | null = null
  loaded = false
  private recent = new Map<string, ThreadItem[]>()
  /** lastReadAt set here before the `channels` event confirms it. */
  private readOverride = new Map<string, number>()
  private loading: Promise<void> | null = null
  private listeners = new Set<Listener>()
  private frame = 0
  /** The bots last seen (id and floor): a change may bring a floor's channel. */
  private botsKey = ''

  /** Loads once and follows the events; later calls return the same promise. */
  start(): Promise<void> {
    if (!this.loading) {
      window.office.onEvent((e) => this.apply(e))
      this.loading = this.reload()
    }
    return this.loading
  }

  async reload(): Promise<void> {
    try {
      this.setChannels(await window.office.listChannels())
      this.error = null
      this.loaded = true
      await Promise.all(this.channels.filter((c) => !this.recent.has(c.id)).map((c) => this.loadRecent(c.id)))
    } catch (err) {
      this.error = chatError(err)
    }
    this.changed()
  }

  /** The bots changed: when one was made, moved or deleted, the floors' channels may change too. */
  botsSeen(bots: readonly Pick<Bot, 'id' | 'floor'>[]): void {
    const key = bots
      .map((b) => `${b.id}:${b.floor}`)
      .sort()
      .join(',')
    if (key === this.botsKey) return
    const first = !this.botsKey
    this.botsKey = key
    if (!first && this.loading) void this.reload()
  }

  private async loadRecent(id: string): Promise<void> {
    try {
      const page = await window.office.botThread(id, { limit: RECENT })
      let items = page.items
      for (const it of this.recent.get(id) ?? []) items = upsertItem(items, it).items
      this.recent.set(id, keepNewest(items, RECENT))
    } catch {
      // the row goes without a count; the open thread shows the error
    }
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

  channel(id: string | null | undefined): Channel | undefined {
    return id ? this.channels.find((c) => c.id === id) : undefined
  }

  /** The channels of a floor ('all' = every floor), in the sidebar's order. */
  onFloor(floor: string): Channel[] {
    return sortChannels(floor === 'all' ? this.channels : this.channels.filter((c) => c.floor === floor))
  }

  /** A channel the form just saved: shown before the `channels` event brings it. */
  upsert(c: Channel): void {
    const i = this.channels.findIndex((x) => x.id === c.id)
    this.setChannels(i >= 0 ? this.channels.map((x) => (x.id === c.id ? c : x)) : [...this.channels, c])
    if (!this.recent.has(c.id)) this.recent.set(c.id, [])
    this.changed()
  }

  remove(id: string): void {
    this.setChannels(this.channels.filter((c) => c.id !== id))
    this.recent.delete(id)
    this.changed()
  }

  lastReadAt(c: Channel): number {
    return this.readOverride.get(c.id) ?? c.lastReadAt
  }

  unread(id: string): number {
    const c = this.channel(id)
    return c ? unreadCount(this.recent.get(id) ?? [], this.lastReadAt(c)) : 0
  }

  last(id: string): ThreadItem | undefined {
    return lastMessage(this.recent.get(id) ?? [])
  }

  /** The player saw the channel up to now. */
  markRead(id: string): void {
    const c = this.channel(id)
    if (!c) return
    const newest = (this.recent.get(id) ?? []).reduce((m, it) => Math.max(m, it.t), 0)
    const at = Math.max(Date.now(), newest)
    if (!this.unread(id) && this.lastReadAt(c) >= newest) return
    this.readOverride.set(id, at)
    this.changed()
    window.office.markBotRead(id, at).catch(() => undefined)
  }

  markUnread(id: string): Promise<void> {
    this.readOverride.set(id, 0)
    this.changed()
    return window.office.markBotRead(id, 0)
  }

  private setChannels(list: Channel[]): void {
    this.channels = list
    for (const c of list) {
      const o = this.readOverride.get(c.id)
      if (o !== undefined && (o === 0 ? c.lastReadAt === 0 : c.lastReadAt >= o)) this.readOverride.delete(c.id)
    }
  }

  apply(e: OfficeEvent): void {
    switch (e.type) {
      case 'channels': {
        const known = new Set(this.channels.map((c) => c.id))
        this.setChannels(e.channels)
        this.loaded = true
        this.error = null
        for (const c of e.channels) if (!known.has(c.id) && !this.recent.has(c.id)) void this.loadRecent(c.id).then(() => this.changed())
        const ids = new Set(e.channels.map((c) => c.id))
        for (const id of [...this.recent.keys()]) if (!ids.has(id)) this.recent.delete(id)
        break
      }
      case 'bot:item': {
        if (!this.channel(e.threadId)) return
        this.recent.set(e.threadId, keepNewest(upsertItem(this.recent.get(e.threadId) ?? [], e.item).items, RECENT))
        break
      }
      default:
        return
    }
    this.changed()
  }
}

export const channelStore = new ChannelMirror()
