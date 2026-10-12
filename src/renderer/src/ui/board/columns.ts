import { projectFor } from '@shared/projects'
import { labelOf, neighborStatus, PRIORITIES, STATUSES, TYPES } from '@shared/tickets'
import type { Actor, Ticket, TicketStatus } from '@shared/types'
import { announce, keepFocus, rove } from '../a11y'
import { h, icon } from '../dom'
import { cleanError } from '../modals'
import { portrait } from '../portrait'
import { beforeCard, clearDropMarks, DONE_SHOWN, EMPTY, GROUND, initials, overdue, shortDate, type Who } from './helpers'
import { BoardBase } from './base'

/** The kanban columns and cards: filters, drag and drop, moving by keyboard. */
export abstract class BoardColumns extends BoardBase {
  // ---------- columns ----------

  /** The floor a ticket belongs to: the project holding its folder, or the ground floor. */
  protected floorOf(t: Ticket): string {
    return projectFor(this.state.settings.projects, t.cwd)?.id ?? GROUND
  }

  /** Floor options follow the projects; the choice survives when its floor still exists. */
  protected syncFloors(): void {
    const projects = this.state.settings.projects
    const keep = this.floorFilter.value
    const options = [{ value: '', label: 'Todos os andares' }, { value: GROUND, label: 'Térreo' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]
    if (this.floorFilter.options.length !== options.length || options.some((o, i) => this.floorFilter.options[i].value !== o.value || this.floorFilter.options[i].text !== o.label)) {
      this.floorFilter.replaceChildren(...options.map((o) => h('option', { value: o.value }, o.label)))
    }
    this.floorFilter.value = options.some((o) => o.value === keep) ? keep : ''
  }

  protected onFloor(): Ticket[] {
    const floor = this.floorFilter.value
    return [...this.state.tickets.values()].filter((t) => !floor || this.floorOf(t) === floor)
  }

  protected visible(): Ticket[] {
    const q = this.search.value.trim().toLowerCase()
    const type = this.typeFilter.value
    const prio = this.prioFilter.value
    const who = this.whoFilter.value as Who | ''
    return this.onFloor().filter((t) => {
      if (type && t.type !== type) return false
      if (prio && t.priority !== prio) return false
      if (who === 'me' && t.assignee?.kind !== 'player') return false
      if (who === 'agents' && t.assignee?.kind !== 'agent') return false
      if (who === 'none' && t.assignee) return false
      return !q || [t.key, t.title, t.description, ...t.tags].some((v) => v.toLowerCase().includes(q))
    })
  }

  protected renderColumns(): void {
    this.syncFloors()
    const shown = this.visible()
    const total = this.onFloor().length
    this.count.textContent = shown.length === total ? String(total) : `${shown.length} de ${total}`
    // A card moved with ⌥←/→ keeps the focus in its new column.
    keepFocus(this.cols, () =>
      this.cols.replaceChildren(
        ...STATUSES.map((s) => {
          let list = shown.filter((t) => t.status === s.value).sort((a, b) => a.order - b.order)
          const hidden = s.value === 'done' && list.length > DONE_SHOWN ? list.length - DONE_SHOWN : 0
          if (hidden) list = list.slice(-DONE_SHOWN)
          return this.column(s.value, s.label, list, hidden)
        }),
      ),
    )
    const cards = [...this.cols.querySelectorAll<HTMLElement>('.tcard')]
    const at = cards.findIndex((c) => c.dataset.id === this.cardActive)
    rove(cards, at >= 0 ? at : Math.max(0, cards.findIndex((c) => c.dataset.id === this.selected)))
  }

  /** ⌥←/⌥→ on a card: the column next door, at the end, like a drop on its blank space. */
  protected moveByKey(t: Ticket, dir: -1 | 1): void {
    const to = neighborStatus(t.status, dir)
    if (!to) return
    const label = labelOf(STATUSES, to)
    window.office
      .moveTicket(t.id, to)
      .then(() => announce(`${t.key} foi para ${label}.`))
      .catch((err) => this.actions.toast(cleanError(err), 'err'))
  }

  /** Arrows on a card: ↑/↓ in its column, ←/→ to the nearest card of the next column with any. */
  protected focusNeighbor(card: HTMLElement, key: string): void {
    const columns = [...this.cols.querySelectorAll<HTMLElement>('.tcol')].map((c) => [...c.querySelectorAll<HTMLElement>('.tcard')])
    const col = columns.findIndex((list) => list.includes(card))
    if (col < 0) return
    const row = columns[col].indexOf(card)
    let target: HTMLElement | undefined
    if (key === 'ArrowUp' || key === 'ArrowDown') target = columns[col][row + (key === 'ArrowDown' ? 1 : -1)]
    else {
      const dir = key === 'ArrowRight' ? 1 : -1
      for (let c = col + dir; c >= 0 && c < columns.length && !target; c += dir) target = columns[c][Math.min(row, columns[c].length - 1)]
    }
    if (!target) return
    this.cardActive = target.dataset.id ?? null
    rove([...this.cols.querySelectorAll<HTMLElement>('.tcard')], [...this.cols.querySelectorAll('.tcard')].indexOf(target))
    target.focus()
  }

  protected column(status: TicketStatus, label: string, tickets: Ticket[], hidden: number): HTMLElement {
    const list = h(
      'div',
      { class: 'tcol-list' },
      hidden ? h('div', { class: 'tcol-more' }, `+${hidden} mais antigos`) : null,
      ...tickets.map((t) => this.card(t)),
      tickets.length ? null : h('div', { class: 'tcol-empty' }, EMPTY[status]),
    )
    list.addEventListener('dragover', (e) => {
      if (!this.dragging) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'
      this.markDrop(list, beforeCard(list, e.clientY))
    })
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget as Node)) clearDropMarks(this.cols)
    })
    list.addEventListener('drop', (e) => {
      e.preventDefault()
      const id = this.dragging
      if (!id) return
      const before = beforeCard(list, e.clientY)?.dataset.id
      clearDropMarks(this.cols)
      window.office.moveTicket(id, status, before).catch((err) => this.actions.toast(cleanError(err), 'err'))
    })
    list.setAttribute('role', 'group')
    list.setAttribute('aria-label', `Coluna ${label}`)
    return h(
      'div',
      { class: `tcol tcol-${status}` },
      h(
        'div',
        { class: 'tcol-head' },
        h('span', { class: 'tcol-dot' }),
        h('span', { class: 'tcol-label' }, label),
        h('span', { class: 'tcol-count' }, String(tickets.length + hidden)),
        status === 'backlog' || status === 'todo'
          ? h('button', { class: 'icon-btn', title: `Novo ticket em ${label}`, onclick: () => this.create(status) }, icon('plus', 15))
          : null,
        status === 'done' && tickets.length + hidden
          ? h('button', { class: 'icon-btn', title: 'Fechar todos: saem do quadro e ficam em Fechados', onclick: () => void this.closeAll() }, icon('archive', 15))
          : null,
      ),
      list,
    )
  }

  protected card(t: Ticket): HTMLElement {
    const ok = t.acceptance.filter((c) => c.done).length
    const agent = t.assignee?.id ? this.state.agents.get(t.assignee.id) : undefined
    const el = h(
      'div',
      {
        class: `tcard prio-${t.priority}${t.id === this.selected ? ' on' : ''}`,
        draggable: 'true',
        role: 'button',
        tabindex: -1,
        'data-focus-key': t.id,
        'aria-label': `${t.key}: ${t.title}. ${labelOf(STATUSES, t.status)}, prioridade ${labelOf(PRIORITIES, t.priority).toLowerCase()}`,
        'aria-keyshortcuts': 'Alt+ArrowLeft Alt+ArrowRight',
        'aria-pressed': String(t.id === this.selected),
        onclick: () => this.select(t.id),
      },
      h(
        'div',
        { class: 'tcard-top' },
        h('span', { class: 'tkey' }, t.key),
        h('span', { class: `ttype ttype-${t.type}` }, labelOf(TYPES, t.type)),
        this.floorFilter.value ? null : this.floorTag(t),
        h('span', { class: `tprio tprio-${t.priority}`, title: `Prioridade ${labelOf(PRIORITIES, t.priority).toLowerCase()}` }),
      ),
      h('div', { class: 'tcard-title' }, t.title),
      agent && t.status === 'doing' ? h('div', { class: 'tcard-live' }, h('span', { class: `dot dot-${agent.status}` }), agent.activity) : null,
      t.tags.length ? h('div', { class: 'tcard-tags' }, ...t.tags.slice(0, 4).map((tag) => h('span', { class: 'ttag' }, tag))) : null,
      h(
        'div',
        { class: 'tcard-foot' },
        t.acceptance.length ? h('span', { class: 'tmeta' + (ok === t.acceptance.length ? ' tmeta-ok' : ''), title: 'Critérios de aceite' }, icon('check', 12), `${ok}/${t.acceptance.length}`) : null,
        t.comments.length ? h('span', { class: 'tmeta', title: 'Comentários' }, icon('message', 12), String(t.comments.length)) : null,
        t.estimate ? h('span', { class: 'tmeta', title: 'Pontos' }, `${t.estimate} pts`) : null,
        t.dueDate ? h('span', { class: 'tmeta' + (overdue(t) ? ' tmeta-late' : ''), title: 'Prazo' }, shortDate(t.dueDate)) : null,
        h('span', { class: 'grow' }),
        t.assignee ? this.avatar(t.assignee, 22) : null,
      ),
    )
    el.dataset.id = t.id
    // Enter abre, setas andam entre cartões, ⌥←/⌥→ muda de coluna (o arrastar pelo teclado).
    el.addEventListener('focus', () => (this.cardActive = t.id))
    el.addEventListener('keydown', (e) => {
      if (e.target !== el || e.metaKey || e.ctrlKey) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.select(t.id)
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        this.moveByKey(t, e.key === 'ArrowLeft' ? -1 : 1)
      } else if (!e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        this.focusNeighbor(el, e.key)
      }
    })
    el.addEventListener('dragstart', (e) => {
      this.dragging = t.id
      e.dataTransfer!.setData('text/plain', t.key)
      e.dataTransfer!.effectAllowed = 'move'
      requestAnimationFrame(() => el.classList.add('dragging'))
    })
    el.addEventListener('dragend', () => {
      this.dragging = null
      el.classList.remove('dragging')
      clearDropMarks(this.cols)
      if (this.stale) this.render()
    })
    return el
  }

  protected markDrop(list: HTMLElement, before: HTMLElement | undefined): void {
    clearDropMarks(this.cols)
    if (before) before.classList.add('drop-before')
    else list.classList.add('drop-end')
  }

  /** Portrait of who it is: the agent if still in the office, the player, or a stand-in. */
  protected avatar(who: Actor, size: number): HTMLElement {
    const agent = who.id ? this.state.agents.get(who.id) : undefined
    const look = agent?.look ?? (who.kind === 'player' && who.name === this.state.settings.playerName ? this.state.settings.playerLook : null)
    const face = look ? portrait(look, size) : h('span', { class: 'avatar-stub', style: `width:${size}px;height:${size}px` }, who.kind === 'agent' ? icon('bot', size * 0.6) : initials(who.name))
    return h('span', { class: 'tavatar', title: who.name + (who.kind === 'agent' && !agent ? ' (saiu do escritório)' : '') }, face)
  }
}
