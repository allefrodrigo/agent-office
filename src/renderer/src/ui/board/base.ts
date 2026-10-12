import { PRIORITIES, TYPES } from '@shared/tickets'
import type { ProjectFloor, Ticket, TicketStatus } from '@shared/types'
import type { State } from '../../state'
import { asDialog, FocusReturn } from '../a11y'
import { h, icon } from '../dom'
import { filterSelect, GROUND } from './helpers'

export interface BoardActions {
  openAgent(id: string): void
  /** Project of the floor the player is on; null on the ground floor. */
  currentProject(): ProjectFloor | null
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
}

/**
 * The board window, its filters and which ticket is open. Each part (columns, detail,
 * closing) extends the previous one; Board (index.ts) is the last.
 */
export abstract class BoardBase {
  readonly el: HTMLDivElement
  protected cols: HTMLDivElement
  protected detail: HTMLDivElement
  protected count: HTMLSpanElement
  protected search: HTMLInputElement
  protected typeFilter: HTMLSelectElement
  protected prioFilter: HTMLSelectElement
  protected whoFilter: HTMLSelectElement
  /** '' = every floor, GROUND, or a project id. Set to the player's floor each time the board opens. */
  protected floorFilter: HTMLSelectElement
  protected selected: string | null = null
  protected dragging: string | null = null
  /** Something changed while the user was dragging or typing; render when they stop. */
  protected stale = false
  protected commentBox: HTMLTextAreaElement
  protected descDraft: string | null = null
  protected briefOpen = false
  /** Card that Tab lands on (roving tabindex); the arrows move it. */
  protected cardActive: string | null = null
  protected focusBack = new FocusReturn()

  constructor(
    protected root: HTMLElement,
    protected state: State,
    protected actions: BoardActions,
  ) {
    this.count = h('span', { class: 'board-count' })
    this.search = h('input', { class: 'input board-search', placeholder: 'Buscar por chave, título, tag…' })
    this.typeFilter = filterSelect('Todos os tipos', TYPES)
    this.prioFilter = filterSelect('Todas as prioridades', PRIORITIES)
    this.whoFilter = filterSelect('Qualquer responsável', [
      { value: 'me', label: 'Comigo' },
      { value: 'agents', label: 'Com agentes' },
      { value: 'none', label: 'Sem responsável' },
    ])
    this.floorFilter = h('select', { class: 'input board-filter board-floor', title: 'Cada andar tem o seu quadro: os tickets cuja pasta fica no projeto do andar' })
    for (const c of [this.search, this.typeFilter, this.prioFilter, this.whoFilter, this.floorFilter]) c.addEventListener('input', () => this.renderColumns())

    this.cols = h('div', { class: 'board-cols' })
    this.detail = h('div', { class: 'tdetail hidden' })
    this.detail.addEventListener('focusout', () =>
      setTimeout(() => {
        if (this.stale && !this.typing()) this.render()
      }),
    )
    this.commentBox = h('textarea', { class: 'input', rows: 2, placeholder: 'Comente, peça ajustes, registre uma decisão…' })

    const heading = h('span', {}, 'Quadro de tickets')
    const title = h('div', { class: 'board-title' }, icon('kanban', 18), heading, this.count)
    this.el = h(
      'div',
      { class: 'board card hidden', tabindex: -1 },
      h(
        'div',
        { class: 'board-head' },
        title,
        this.floorFilter,
        this.search,
        this.typeFilter,
        this.prioFilter,
        this.whoFilter,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', title: 'Tickets fechados: buscar, ler e reabrir', onclick: () => this.openClosed() }, icon('archive', 16), 'Fechados'),
        h('button', { class: 'btn btn-primary', onclick: () => this.create('todo') }, icon('plus', 16), 'Novo ticket'),
        h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => this.close() }, icon('x', 18)),
      ),
      h('div', { class: 'board-body' }, this.cols, this.detail),
    )
    asDialog(this.el, { title: heading })
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement)) {
        if (this.selected) this.select(null)
        else this.close()
      }
      // Keep WASD and shortcuts from reaching the office while the board is open.
      e.stopPropagation()
    })
    root.append(this.el)
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden')
  }

  open(ticketId?: string): void {
    const wasOpen = this.isOpen
    this.el.classList.remove('hidden')
    this.syncFloors()
    // A linked ticket shows on its own floor; otherwise the board follows the player.
    const linked = ticketId ? this.state.tickets.get(ticketId) : undefined
    if (linked) {
      if (this.floorFilter.value) this.floorFilter.value = this.floorOf(linked)
    } else if (!wasOpen) this.floorFilter.value = this.actions.currentProject()?.id ?? GROUND
    if (ticketId) this.selected = ticketId
    if (!wasOpen) this.focusBack.save(this.el)
    this.render()
    this.el.focus()
  }

  close(): void {
    this.el.classList.add('hidden')
    this.select(null)
    this.focusBack.restore(this.el)
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  render(): void {
    if (!this.isOpen) return
    if (this.dragging || this.typing()) {
      this.stale = true
      // Columns are safe to redraw while typing in the drawer.
      if (!this.dragging) this.renderColumns()
      return
    }
    this.stale = false
    this.renderColumns()
    this.renderDetail()
  }

  protected typing(): boolean {
    const a = document.activeElement
    return this.detail.contains(a) && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement)
  }

  protected select(id: string | null): void {
    if (id !== this.selected) {
      this.commentBox.value = ''
      this.descDraft = null
      this.briefOpen = false
    }
    this.selected = id
    this.stale = false
    this.renderColumns()
    this.renderDetail()
  }

  // ---------- implemented by the later parts ----------
  protected abstract floorOf(t: Ticket): string
  protected abstract syncFloors(): void
  protected abstract renderColumns(): void
  protected abstract renderDetail(): void
  protected abstract autoCloseText(t: Ticket): string
  protected abstract closeOne(t: Ticket): Promise<void>
  protected abstract closeAll(): Promise<void>
  protected abstract openClosed(): void
  protected abstract remove(t: Ticket): Promise<void>
  protected abstract floorTag(t: Ticket): HTMLElement
  abstract create(status?: TicketStatus): void
}
