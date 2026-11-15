import { atBottom, dayLabel, prependPage, sameDay, searchItems, upsertItem } from '@shared/bots-view'
import { FIRST_MESSAGES } from '@shared/bot-templates'
import { BOT_LIMITS, type Bot, type ThreadItem } from '@shared/types'
import { h, icon } from '../dom'
import { dayDivider, itemView, type ItemCtx } from './items'
import { chatError, reducedMotion } from './util'

// O fio de um bot: abre no fim, carrega 200 itens por vez ao subir, segue no fim só se você já
// estava lá (senão, a pílula "1 nova ↓"), e ⌘F busca no que está carregado (e no resto, se pedir).

/** Scroll this close to the top loads the older page. */
const LOAD_AT_PX = 320
/** The bot's message that was on screen briefly flashes when a link points at it. */
const FLASH_MS = 1600

export interface ThreadCtx extends Omit<ItemCtx, 'expanded'> {
  /** The thread is at the bottom with new items on screen: mark it read. */
  onSeen(): void
  /** A suggested first message was clicked. */
  suggest(text: string): void
}

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export class ThreadView {
  readonly el: HTMLElement
  private scroller: HTMLDivElement
  private list: HTMLDivElement
  private pill: HTMLButtonElement
  private searchBar: HTMLDivElement
  private searchInput: HTMLInputElement
  private searchCount: HTMLSpanElement
  private searchAll: HTMLButtonElement
  private items: ThreadItem[] = []
  private nodes = new Map<string, HTMLElement>()
  private expanded = new Set<string>()
  private more = false
  private loadingOlder: Promise<void> | null = null
  private stick = true
  private unseen = 0
  private hits: string[] = []
  private hit = -1
  private botId: string | null = null
  /** Bumped on every load: answers for an older thread are dropped. */
  private token = 0
  /** Items that arrived while the first page was on its way; drawn right after it. */
  private buffer: ThreadItem[] | null = null

  constructor(private ctx: ThreadCtx) {
    // not a live region: runs update in place all the time; the screen announces new messages itself
    this.list = h('div', { class: 'ch-list', 'aria-label': 'Conversa' })
    this.scroller = h('div', { class: 'ch-scroll', tabindex: 0 }, this.list)
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true })
    this.pill = h('button', { type: 'button', class: 'ch-newpill', hidden: true, onclick: () => this.toBottom(true) })
    this.searchInput = h('input', {
      class: 'ch-search-input',
      type: 'search',
      placeholder: 'Buscar no fio',
      'aria-label': 'Buscar no fio',
      spellcheck: false,
    })
    this.searchCount = h('span', { class: 'ch-search-count', 'aria-live': 'polite' })
    this.searchAll = h(
      'button',
      { type: 'button', class: 'btn btn-small', hidden: true, onclick: () => void this.searchEverything() },
      'Buscar nas mais antigas',
    )
    this.searchInput.addEventListener('input', () => this.runSearch())
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.closeSearch()
      } else if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        this.step(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1)
      }
    })
    this.searchBar = h(
      'div',
      { class: 'ch-search-bar', hidden: true, role: 'search' },
      icon('search', 15),
      this.searchInput,
      this.searchCount,
      this.searchAll,
      h(
        'button',
        { type: 'button', class: 'icon-btn', title: 'Anterior (↑)', 'aria-label': 'Ocorrência anterior', onclick: () => this.step(-1) },
        h('span', { class: 'ch-up' }, icon('chevron', 15)),
      ),
      h(
        'button',
        { type: 'button', class: 'icon-btn', title: 'Próxima (↓)', 'aria-label': 'Próxima ocorrência', onclick: () => this.step(1) },
        h('span', { class: 'ch-down' }, icon('chevron', 15)),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          title: 'Fechar a busca (Esc)',
          'aria-label': 'Fechar a busca',
          onclick: () => this.closeSearch(),
        },
        icon('x', 15),
      ),
    )
    this.el = h('div', { class: 'ch-thread' }, this.searchBar, this.scroller, this.pill)
  }

  private itemCtx(): ItemCtx {
    return { ...this.ctx, expanded: this.expanded }
  }

  get atBottom(): boolean {
    return atBottom(this.scroller.scrollTop, this.scroller.clientHeight, this.scroller.scrollHeight)
  }

  // ---------- loading ----------

  /** Opens a bot's thread at the end. */
  async load(bot: Bot): Promise<void> {
    const token = ++this.token
    this.botId = bot.id
    this.items = []
    this.nodes.clear()
    this.expanded.clear()
    this.more = false
    this.loadingOlder = null
    this.unseen = 0
    this.buffer = []
    this.closeSearch()
    this.list.replaceChildren(h('div', { class: 'ch-loading' }, 'Abrindo a conversa…'))
    const t0 = performance.now()
    try {
      const page = await window.office.botThread(bot.id, { limit: BOT_LIMITS.page })
      if (token !== this.token) return
      this.items = page.items
      this.more = page.more
      this.renderAll()
      const early = this.buffer ?? []
      this.buffer = null
      for (const it of early) this.add(it)
      this.toBottom(false)
      this.ctx.onSeen()
      if (import.meta.env.DEV) console.debug(`[chat] fio ${bot.id}: ${page.items.length} itens em ${Math.round(performance.now() - t0)} ms`)
    } catch (err) {
      if (token !== this.token) return
      this.buffer = null
      this.list.replaceChildren(
        h(
          'div',
          { class: 'ch-empty ch-error', role: 'alert' },
          h('p', {}, chatError(err)),
          h('button', { type: 'button', class: 'btn', onclick: () => void this.load(bot) }, 'Tentar de novo'),
        ),
      )
    }
  }

  private async loadOlder(): Promise<void> {
    if (this.loadingOlder || !this.more || !this.botId || !this.items.length) return this.loadingOlder ?? undefined
    const token = this.token
    const botId = this.botId
    this.loadingOlder = (async () => {
      const marker = h('div', { class: 'ch-loading ch-older' }, 'Carregando mensagens mais antigas…')
      this.list.prepend(marker)
      try {
        const page = await window.office.botThread(botId, { before: this.items[0].id, limit: BOT_LIMITS.page })
        if (token !== this.token) return
        const fromBottom = this.scroller.scrollHeight - this.scroller.scrollTop
        marker.remove()
        const older = page.items.filter((x) => !this.nodes.has(x.id))
        this.items = prependPage(older, this.items)
        this.more = page.more && older.length > 0
        this.prependNodes(older)
        this.scroller.scrollTop = this.scroller.scrollHeight - fromBottom
      } catch (err) {
        // no retry loop on every scroll: the marker offers it
        this.more = false
        marker.replaceChildren(
          h('span', {}, chatError(err)),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small',
              onclick: () => {
                marker.remove()
                this.more = true
                void this.loadOlder()
              },
            },
            'Tentar de novo',
          ),
        )
      } finally {
        if (token === this.token) this.loadingOlder = null
      }
    })()
    return this.loadingOlder
  }

  // ---------- drawing ----------

  private node(item: ThreadItem, prev: ThreadItem | undefined): HTMLElement {
    const el = itemView(item, this.itemCtx(), prev)
    this.nodes.set(item.id, el)
    return el
  }

  private renderAll(): void {
    this.nodes.clear()
    if (!this.items.length) {
      this.list.replaceChildren(this.emptyView())
      return
    }
    const out: HTMLElement[] = []
    if (this.more) out.push(h('div', { class: 'ch-older-hint' }, 'Role para cima para ver as mais antigas'))
    let prev: ThreadItem | undefined
    for (const it of this.items) {
      if (!prev || !sameDay(prev.t, it.t)) out.push(dayDivider(dayLabel(it.t), dayKey(it.t)))
      out.push(this.node(it, prev))
      prev = it
    }
    this.list.replaceChildren(...out)
  }

  private prependNodes(older: ThreadItem[]): void {
    if (!older.length) return
    this.list.querySelector('.ch-older-hint')?.remove()
    const frag = document.createDocumentFragment()
    if (this.more) frag.append(h('div', { class: 'ch-older-hint' }, 'Role para cima para ver as mais antigas'))
    let prev: ThreadItem | undefined
    for (const it of older) {
      if (!prev || !sameDay(prev.t, it.t)) frag.append(dayDivider(dayLabel(it.t), dayKey(it.t)))
      frag.append(this.node(it, prev))
      prev = it
    }
    // the old first day divider goes when the page ends on that same day
    const first = this.list.querySelector<HTMLElement>('.ch-day')
    if (prev && first?.dataset.day === dayKey(prev.t)) first.remove()
    this.list.prepend(frag)
  }

  private emptyView(): HTMLElement {
    return h(
      'div',
      { class: 'ch-empty' },
      h('p', { class: 'ch-empty-title' }, 'Nada por aqui ainda.'),
      h('p', {}, 'Comece com uma destas, ou escreva o que precisar:'),
      h(
        'div',
        { class: 'ch-suggestions' },
        FIRST_MESSAGES.map((m) => h('button', { type: 'button', class: 'ch-suggestion', onclick: () => this.ctx.suggest(m) }, m)),
      ),
    )
  }

  /** A bot:item for this thread: same id = updated in place; new = at the end. */
  add(item: ThreadItem): void {
    if (this.buffer) return void this.buffer.push(item)
    const { items, added } = upsertItem(this.items, item)
    this.items = items
    if (!added) {
      const old = this.nodes.get(item.id)
      if (!old) return
      const i = this.items.findIndex((x) => x.id === item.id)
      const was = this.stick && this.atBottom
      old.replaceWith(this.node(item, this.items[i - 1]))
      if (was) this.toBottom(false)
      return
    }
    const wasBottom = this.atBottom
    if (this.items.length === 1) this.list.replaceChildren()
    const prev = this.items[this.items.length - 2]
    if (!prev || !sameDay(prev.t, item.t)) this.list.append(dayDivider(dayLabel(item.t), dayKey(item.t)))
    this.list.append(this.node(item, prev))
    if (wasBottom || item.kind === 'user') {
      this.toBottom(false)
      this.ctx.onSeen()
    } else {
      this.unseen++
      this.syncPill()
    }
    if (!this.searchBar.hidden) this.runSearch(false)
  }

  /** The office changed (agents, requests): redraw what depends on it (cards, runs in progress). */
  refresh(): void {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]
      const live =
        (it.kind === 'approval' && it.status === 'pending') || (it.kind === 'run' && (it.status === 'running' || it.status === 'waiting'))
      if (!live) continue
      const old = this.nodes.get(it.id)
      // a card with something typed in it stays as it is
      if (!old || old.contains(document.activeElement)) continue
      old.replaceWith(this.node(it, this.items[i - 1]))
    }
  }

  // ---------- scrolling ----------

  private onScroll(): void {
    const bottom = this.atBottom
    this.stick = bottom
    if (bottom && this.unseen) {
      this.unseen = 0
      this.syncPill()
      this.ctx.onSeen()
    }
    if (this.scroller.scrollTop < LOAD_AT_PX && this.more) void this.loadOlder()
  }

  private syncPill(): void {
    this.pill.hidden = !this.unseen
    this.pill.replaceChildren(this.unseen === 1 ? '1 nova' : `${this.unseen} novas`, h('span', { 'aria-hidden': 'true' }, ' ↓'))
  }

  toBottom(smooth: boolean): void {
    this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
    this.stick = true
    if (this.unseen) {
      this.unseen = 0
      this.syncPill()
      this.ctx.onSeen()
    }
  }

  /** The approval item of a pending request, among the loaded items. */
  itemForRequest(requestId: string): string | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      if (it.kind === 'approval' && it.requestId === requestId) return it.id
    }
    return null
  }

  /** Brings an item into view, loading older pages until it shows (the profile's run history, a search hit). */
  async reveal(itemId: string): Promise<boolean> {
    let guard = Math.ceil(BOT_LIMITS.threadItems / BOT_LIMITS.page)
    while (!this.nodes.has(itemId) && this.more && guard-- > 0) await this.loadOlder()
    const el = this.nodes.get(itemId)
    if (!el) return false
    el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
    setTimeout(() => el.classList.remove('flash'), FLASH_MS)
    return true
  }

  // ---------- ⌘F ----------

  openSearch(): void {
    this.searchBar.hidden = false
    this.searchInput.focus()
    this.searchInput.select()
    this.runSearch()
  }

  closeSearch(): void {
    if (this.searchBar.hidden) return
    this.searchBar.hidden = true
    this.searchInput.value = ''
    this.paintHits([], -1)
    this.searchCount.textContent = ''
  }

  get searching(): boolean {
    return !this.searchBar.hidden
  }

  private runSearch(jump = true): void {
    const q = this.searchInput.value
    const hits = searchItems(this.items, q)
    // the newest hit first, as in a chat you read from the bottom
    const hit = jump ? hits.length - 1 : Math.min(this.hit, hits.length - 1)
    this.paintHits(hits, hit)
    this.searchAll.hidden = !q.trim() || !this.more
    if (jump && hit >= 0) this.nodes.get(hits[hit])?.scrollIntoView({ block: 'center' })
  }

  private paintHits(hits: string[], current: number): void {
    for (const id of this.hits) this.nodes.get(id)?.classList.remove('ch-hit', 'ch-hit-current')
    this.hits = hits
    this.hit = current
    hits.forEach((id, i) => this.nodes.get(id)?.classList.add('ch-hit', ...(i === current ? ['ch-hit-current'] : [])))
    const q = this.searchInput.value.trim()
    this.searchCount.textContent = !q ? '' : hits.length ? `${current + 1} de ${hits.length}` : 'Nada encontrado'
  }

  private step(d: 1 | -1): void {
    if (!this.hits.length) return
    const next = (this.hit + d + this.hits.length) % this.hits.length
    this.paintHits(this.hits, next)
    this.nodes.get(this.hits[next])?.scrollIntoView({ block: 'center' })
  }

  /** Loads the whole thread (up to the kept items) and searches it all. */
  private async searchEverything(): Promise<void> {
    this.searchAll.disabled = true
    this.searchAll.textContent = 'Carregando…'
    let guard = Math.ceil(BOT_LIMITS.threadItems / BOT_LIMITS.page)
    while (this.more && guard-- > 0) await this.loadOlder()
    this.searchAll.disabled = false
    this.searchAll.textContent = 'Buscar nas mais antigas'
    this.runSearch()
  }
}
