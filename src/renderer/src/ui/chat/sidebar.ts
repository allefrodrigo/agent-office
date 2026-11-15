import {
  badgeText,
  botAutomations,
  botState,
  botStatusLine,
  botsOnFloor,
  itemPreview,
  listTime,
  nextAutomation,
  reorderBots,
  sortBots,
} from '@shared/bots-view'
import type { Bot, ThreadHit } from '@shared/types'
import { arrowList, keepFocus } from '../a11y'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import { botAvatar } from './avatar'
import { showMenu, type MenuItem } from './menu'
import { chatStore } from './store'
import { botAgent, botPending, chatError, floorChoices, type ChatCtx } from './util'

// A lateral do Chat: andar, busca, Bots (arrastar reordena; menu de contexto), Canais (fase 3) e,
// no pé, Automações e Conexões (fase 2) e "＋ Novo bot". Docs: chat-de-bots.md ("Layout").

export interface SidebarCtx extends ChatCtx {
  host: HTMLElement
  selected(): string | null
  floor(): string
  setFloor(floor: string): void
  select(botId: string, itemId?: string): void
  newBot(): void
  /** The selected bot went away (deleted, hidden). */
  removed(botId: string): void
  /** The footer's screens (phase 2), and which one is on. */
  openAutomations(): void
  openConnections(): void
  screen(): 'automations' | 'connections' | null
}

/** Search waits this long after the last key before asking the main process. */
const SEARCH_MS = 250

export class ChatSidebar {
  readonly el: HTMLElement
  readonly heading: HTMLHeadingElement
  private floorSel: HTMLSelectElement
  private search: HTMLInputElement
  private botsEl: HTMLDivElement
  private hitsEl: HTMLDivElement
  private channelsEl: HTMLElement
  private autosBtn: HTMLButtonElement
  private connBtn: HTMLButtonElement
  private showHidden = false
  private hits: ThreadHit[] | null = null
  private searchTimer = 0
  private searchToken = 0
  private dragId: string | null = null

  constructor(private ctx: SidebarCtx) {
    this.heading = h('h1', { class: 'ch-title' }, 'Chat')
    this.floorSel = h('select', { class: 'ch-select ch-floor', 'aria-label': 'Andar' })
    this.floorSel.addEventListener('change', () => ctx.setFloor(this.floorSel.value))
    this.search = h('input', {
      class: 'ch-side-search',
      type: 'search',
      placeholder: 'Buscar',
      'aria-label': 'Buscar bots e conversas',
      spellcheck: false,
    })
    this.search.addEventListener('input', () => this.onSearch())
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.search.value) {
        e.preventDefault()
        e.stopPropagation()
        this.search.value = ''
        this.onSearch()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.el.querySelector<HTMLElement>('.ch-row-btn, .ch-hit-btn')?.focus()
      }
    })
    this.botsEl = h('div', { class: 'ch-rows', role: 'list', 'aria-label': 'Bots' })
    arrowList(this.botsEl, '.ch-row-btn')
    this.hitsEl = h('div', { class: 'ch-hits', hidden: true })
    this.channelsEl = h(
      'section',
      { class: 'ch-group', 'aria-label': 'Canais' },
      h('div', { class: 'ch-group-title' }, h('span', {}, 'Canais')),
      h(
        'p',
        { class: 'ch-group-empty' },
        h('b', {}, 'Em breve. '),
        'Canais com vários bots e você, como #lançamento, chegam na próxima fase.',
      ),
    )
    this.autosBtn = h(
      'button',
      { type: 'button', class: 'ch-foot-btn', title: 'A agenda e os eventos de todos os bots', onclick: () => ctx.openAutomations() },
      icon('spark', 16),
      'Automações',
    )
    this.connBtn = h(
      'button',
      { type: 'button', class: 'ch-foot-btn', title: 'Quais servidores MCP cada bot enxerga', onclick: () => ctx.openConnections() },
      icon('plug', 16),
      'Conexões',
    )
    this.el = h(
      'aside',
      { class: 'ch-side', 'aria-label': 'Bots e canais' },
      h('div', { class: 'ch-side-head' }, h('div', { class: 'ch-side-brand' }, icon('message', 18), this.heading), this.floorSel),
      h('div', { class: 'ch-side-search-wrap' }, icon('search', 15), this.search),
      h(
        'nav',
        { class: 'ch-side-scroll', 'aria-label': 'Conversas' },
        this.hitsEl,
        h(
          'section',
          { class: 'ch-group', 'aria-label': 'Bots' },
          h('div', { class: 'ch-group-title' }, h('span', {}, 'Bots')),
          this.botsEl,
        ),
        this.channelsEl,
      ),
      h(
        'div',
        { class: 'ch-side-foot' },
        this.autosBtn,
        this.connBtn,
        h('button', { type: 'button', class: 'ch-foot-btn ch-new', onclick: () => ctx.newBot() }, icon('plus', 16), 'Novo bot'),
      ),
    )
  }

  focusSearch(): void {
    this.search.focus()
    this.search.select()
  }

  render(): void {
    // the floor picker: the floors, plus "Todos"
    const floors = floorChoices(this.ctx.state)
    const want = this.ctx.floor()
    const opts = [...floors.map((f) => ({ id: f.id, name: f.name })), { id: 'all', name: 'Todos os andares' }]
    if (
      this.floorSel.options.length !== opts.length ||
      [...this.floorSel.options].some((o, i) => o.value !== opts[i].id || o.textContent !== opts[i].name)
    ) {
      this.floorSel.replaceChildren(...opts.map((o) => h('option', { value: o.id }, o.name)))
    }
    this.floorSel.value = opts.some((o) => o.id === want) ? want : 'all'
    const on = this.ctx.screen()
    this.autosBtn.setAttribute('aria-current', String(on === 'automations'))
    this.connBtn.setAttribute('aria-current', String(on === 'connections'))
    keepFocus(this.botsEl, () => this.drawBots())
    if (this.hits) this.drawHits()
  }

  private visibleBots(): Bot[] {
    const q = this.search.value.trim().toLocaleLowerCase('pt-BR')
    const list = sortBots(botsOnFloor(chatStore.bots, this.ctx.floor(), this.showHidden))
    return q ? list.filter((b) => b.name.toLocaleLowerCase('pt-BR').includes(q)) : list
  }

  private drawBots(): void {
    const s = this.ctx.state
    const bots = this.visibleBots()
    const hidden = botsOnFloor(chatStore.bots, this.ctx.floor(), true).filter((b) => b.hidden).length
    const rows: HTMLElement[] = []
    if (chatStore.error && !chatStore.bots.length) {
      rows.push(h('p', { class: 'ch-group-empty err' }, chatStore.error))
    } else if (!chatStore.loaded) {
      rows.push(h('p', { class: 'ch-group-empty' }, 'Carregando…'))
    } else if (!bots.length) {
      rows.push(
        h(
          'p',
          { class: 'ch-group-empty' },
          this.search.value.trim() ? 'Nenhum bot com esse nome.' : chatStore.bots.length ? 'Nenhum bot neste andar.' : 'Nenhum bot ainda.',
        ),
      )
    }
    const selected = this.ctx.selected()
    for (const b of bots) {
      const agent = botAgent(s, b)
      const pending = botPending(s, b)
      const last = chatStore.last(b.id)
      const line = botStatusLine(b, agent, pending, nextAutomation(botAutomations(b.id, s.routines, chatStore.triggers)), Date.now(), last)
      const unread = chatStore.unread(b.id)
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'ch-row-btn',
          'data-focus-key': b.id,
          'aria-current': b.id === selected ? 'true' : undefined,
          'aria-label': `${b.name}${unread ? `, ${unread} não lidas` : ''}. ${line.text}`,
          onclick: () => this.ctx.select(b.id),
        },
        botAvatar(b, botState(b, agent, pending), 38),
        h(
          'span',
          { class: 'ch-row-main' },
          h(
            'span',
            { class: 'ch-row-top' },
            h(
              'span',
              { class: 'ch-row-name' },
              b.pinned ? h('span', { class: 'ch-pin', title: 'Fixado', 'aria-hidden': 'true' }, '•') : null,
              b.name,
            ),
            last ? h('span', { class: 'ch-row-time' }, listTime(last.t)) : null,
          ),
          h(
            'span',
            { class: 'ch-row-bottom' },
            h('span', { class: `ch-row-status tone-${line.tone}` }, line.text),
            unread ? h('span', { class: 'ch-unread', 'aria-hidden': 'true' }, badgeText(unread)) : null,
          ),
        ),
      )
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        this.menu(b, { x: e.clientX, y: e.clientY })
      })
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault()
          this.menu(b, btn)
        }
      })
      const more = h(
        'button',
        {
          type: 'button',
          class: 'ch-row-more',
          tabindex: -1,
          title: 'Mais ações',
          'aria-label': `Mais ações de ${b.name}`,
          onclick: () => this.menu(b, more),
        },
        h('span', { 'aria-hidden': 'true' }, '⋯'),
      )
      const row = h(
        'div',
        {
          class: `ch-row${b.id === selected ? ' on' : ''}${unread ? ' unread' : ''}${b.hidden ? ' is-hidden' : ''}`,
          role: 'listitem',
          draggable: 'true',
          'data-id': b.id,
        },
        btn,
        more,
      )
      this.dragHandlers(row, b)
      rows.push(row)
    }
    if (hidden) {
      rows.push(
        h(
          'button',
          {
            type: 'button',
            class: 'ch-show-hidden',
            onclick: () => {
              this.showHidden = !this.showHidden
              this.render()
            },
          },
          this.showHidden ? 'Esconder os escondidos' : hidden === 1 ? 'Mostrar 1 escondido' : `Mostrar ${hidden} escondidos`,
        ),
      )
    }
    this.botsEl.replaceChildren(...rows)
    const btns = [...this.botsEl.querySelectorAll<HTMLElement>('.ch-row-btn')]
    const current = Math.max(
      0,
      btns.findIndex((x) => x.getAttribute('aria-current') === 'true'),
    )
    btns.forEach((x, i) => (x.tabIndex = i === current ? 0 : -1))
  }

  // ---------- drag to reorder ----------

  private dragHandlers(row: HTMLElement, b: Bot): void {
    row.addEventListener('dragstart', (e) => {
      this.dragId = b.id
      row.classList.add('dragging')
      e.dataTransfer?.setData('text/plain', b.name)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => {
      this.dragId = null
      row.classList.remove('dragging')
      for (const r of this.botsEl.querySelectorAll('.drop-before, .drop-after')) r.classList.remove('drop-before', 'drop-after')
    })
    row.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === b.id) return
      e.preventDefault()
      const r = row.getBoundingClientRect()
      const after = e.clientY > r.top + r.height / 2
      row.classList.toggle('drop-after', after)
      row.classList.toggle('drop-before', !after)
    })
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'))
    row.addEventListener('drop', (e) => {
      if (!this.dragId) return
      e.preventDefault()
      const after = row.classList.contains('drop-after')
      row.classList.remove('drop-before', 'drop-after')
      void this.reorder(this.dragId, b.id, after ? 'after' : 'before')
    })
  }

  private async reorder(dragId: string, targetId: string, place: 'before' | 'after'): Promise<void> {
    const sorted = sortBots(chatStore.bots)
    const changes = reorderBots(sorted, dragId, targetId, place)
    if (!changes.length) return
    // shown in the new order at once; the `bots` event confirms it
    for (const c of changes) {
      const bot = chatStore.bot(c.id)
      if (bot) bot.order = c.order
    }
    this.render()
    try {
      await Promise.all(changes.map((c) => window.office.setBotFlags(c.id, { order: c.order })))
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
      void chatStore.reload()
    }
  }

  // ---------- context menu ----------

  private menu(b: Bot, at: HTMLElement | { x: number; y: number }): void {
    const flag = async (patch: { pinned?: boolean; hidden?: boolean }, done: string) => {
      try {
        await window.office.setBotFlags(b.id, patch)
        this.ctx.toast(done, 'ok')
        if (patch.hidden && !this.showHidden) this.ctx.removed(b.id)
      } catch (err) {
        this.ctx.toast(chatError(err), 'err')
      }
    }
    const items: (MenuItem | 'sep')[] = [
      {
        label: b.pinned ? 'Desafixar' : 'Fixar',
        icon: 'expand',
        run: () => void flag({ pinned: !b.pinned }, b.pinned ? `${b.name} saiu do topo.` : `${b.name} fica no topo.`),
      },
      {
        label: 'Marcar como não lido',
        icon: 'inbox',
        run: () =>
          void chatStore.markUnread(b.id).catch((err: unknown) => {
            this.ctx.toast(chatError(err), 'err')
          }),
      },
      {
        label: 'Duplicar',
        icon: 'copy',
        run: async () => {
          try {
            const copy = await window.office.duplicateBot(b.id)
            this.ctx.toast(`${copy.name} criado, sem conversa e com as automações pausadas.`, 'ok')
            this.ctx.select(copy.id)
          } catch (err) {
            this.ctx.toast(chatError(err), 'err')
          }
        },
      },
      {
        label: b.hidden ? 'Mostrar' : 'Esconder',
        icon: 'eye',
        run: () =>
          void flag(
            { hidden: !b.hidden },
            b.hidden ? `${b.name} voltou para a lista.` : `${b.name} saiu da lista. "Mostrar escondidos" traz de volta.`,
          ),
      },
      'sep',
      { label: 'Apagar…', icon: 'trash', danger: true, run: () => void this.remove(b) },
    ]
    showMenu(this.ctx.host, at, items, `Ações de ${b.name}`)
  }

  private async remove(b: Bot): Promise<void> {
    const inOffice = !!botAgent(this.ctx.state, b)
    const yes = await confirmDialog(this.ctx.root, {
      title: `Apagar ${b.name}?`,
      text: `O bot sai do Chat com a conversa, a memória e as automações dele. Não dá para desfazer.${inOffice ? '\n\nO agente dele está no escritório agora e vai ser dispensado.' : ''}`,
      confirm: 'Apagar',
      cancel: 'Cancelar',
      danger: true,
    })
    if (!yes) return
    try {
      await window.office.deleteBot(b.id)
      this.ctx.toast(`${b.name} foi apagado.`, 'ok')
      this.ctx.removed(b.id)
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
    }
  }

  // ---------- search ----------

  private onSearch(): void {
    clearTimeout(this.searchTimer)
    const q = this.search.value.trim()
    keepFocus(this.botsEl, () => this.drawBots())
    if (q.length < 2) {
      this.hits = null
      this.hitsEl.hidden = true
      this.hitsEl.replaceChildren()
      return
    }
    const token = ++this.searchToken
    this.searchTimer = window.setTimeout(async () => {
      const floor = this.ctx.floor()
      try {
        const hits = await window.office.searchBots(q, floor === 'all' ? undefined : floor)
        if (token !== this.searchToken) return
        this.hits = hits
      } catch (err) {
        if (token !== this.searchToken) return
        this.hits = []
        this.hitsEl.hidden = false
        this.hitsEl.replaceChildren(h('p', { class: 'ch-group-empty err' }, chatError(err)))
        return
      }
      this.drawHits()
    }, SEARCH_MS)
  }

  private drawHits(): void {
    const hits = this.hits ?? []
    this.hitsEl.hidden = false
    this.hitsEl.replaceChildren(
      h('div', { class: 'ch-group-title' }, h('span', {}, 'Nas conversas')),
      hits.length
        ? h(
            'div',
            { class: 'ch-hit-list' },
            hits.slice(0, 30).map((hit) => {
              const b = chatStore.bot(hit.threadId)
              return h(
                'button',
                { type: 'button', class: 'ch-hit-btn', onclick: () => this.ctx.select(hit.threadId, hit.item.id) },
                h(
                  'span',
                  { class: 'ch-hit-top' },
                  h('b', {}, b?.name ?? 'Canal'),
                  h('span', { class: 'ch-row-time' }, listTime(hit.item.t)),
                ),
                h('span', { class: 'ch-hit-text' }, itemPreview(hit.item)),
              )
            }),
          )
        : h('p', { class: 'ch-group-empty' }, 'Nada nas conversas com essa busca.'),
    )
  }
}
