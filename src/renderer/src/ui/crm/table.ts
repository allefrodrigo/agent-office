import {
  ariaSort,
  gridTemplate,
  hasFilters,
  moveRow,
  nextSort,
  parseColumnPrefs,
  scrollForRow,
  sumColumn,
  tableAnnouncement,
  tableFooter,
  tableRows,
  toggleColumn,
  virtualWindow,
  visibleColumns,
  type CrmColumn,
  type Noun,
  type TableSort,
} from '@shared/crm-view'
import { h, icon } from '../dom'

// A tabela das abas Clientes e Pagamentos (CR-04): filtro por coluna, ordenação com aria-sort,
// "Colunas" (guardado no localStorage), rodapé com a quantidade e a soma, lista virtual acima de
// 200 linhas, estado vazio, teclado nas linhas (↑ ↓ Home End PageUp PageDown, Enter abre) e uma
// região aria-live que diz o resultado de cada ordenação e filtro. As contas são de crm-view.ts.

/** Row height (px): the same as .crm-row in crm.css; the virtual list counts on it. */
const ROW_H = 40
/** Rows drawn beyond each edge of the view: a scroll of up to this many rows redraws nothing. */
const OVERSCAN = 12
/** Filter typing is announced once it stops. */
const ANNOUNCE_MS = 600

export interface TableOptions<T> {
  /** localStorage prefix: `${key}:colunas`. */
  key: string
  /** Accessible name of the grid: "Clientes". */
  label: string
  columns: CrmColumn<T>[]
  rowId(row: T): string
  noun: Noun
  /** Column whose cents the footer sums. */
  sumColumn?: string
  sort?: TableSort | null
  open(row: T): void
  /** The empty state; `filtered` = a filter hides every row. */
  empty(filtered: boolean): HTMLElement
  rowClass?(row: T): string
  /** Buttons of the view, at the right of the toolbar ("Importar CSV", "Exportar"). */
  tools?: HTMLElement[]
}

export class CrmTable<T> {
  readonly el: HTMLElement
  private rows: T[] = []
  private shown: T[] = []
  private filters: Record<string, string> = {}
  private sort: TableSort | null
  private chosen: string[] | null
  private active = 0
  private win = { start: 0, end: 0 }
  private frame = 0
  private announceTimer = 0
  private readonly scroll: HTMLElement
  private readonly wrap: HTMLElement
  private readonly head: HTMLElement
  private readonly list: HTMLElement
  private readonly emptyBox: HTMLElement
  private readonly foot: HTMLElement
  private readonly live: HTMLElement
  private readonly clear: HTMLButtonElement
  private readonly colsBtn: HTMLButtonElement
  private menu: HTMLElement | null = null

  constructor(private readonly opts: TableOptions<T>) {
    this.sort = opts.sort ?? null
    this.chosen = parseColumnPrefs(localStorage.getItem(this.prefKey), opts.columns)
    this.colsBtn = h(
      'button',
      { type: 'button', class: 'btn btn-small crm-cols-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
      'Colunas',
    )
    this.colsBtn.addEventListener('click', () => (this.menu ? this.closeMenu(true) : this.openMenu()))
    this.clear = h('button', { type: 'button', class: 'btn btn-small crm-btn-quiet', hidden: true }, icon('x', 14), 'Limpar filtros')
    this.clear.addEventListener('click', () => this.clearFilters())
    this.head = h('div', { class: 'crm-thead', role: 'rowgroup' })
    this.list = h('div', { class: 'crm-rows', role: 'rowgroup' })
    this.emptyBox = h('div', { class: 'crm-table-empty', hidden: true })
    this.wrap = h('div', { class: 'crm-grid', role: 'grid', 'aria-label': opts.label }, this.head, this.list)
    this.scroll = h('div', { class: 'crm-scroll' }, this.wrap, this.emptyBox)
    this.foot = h('div', { class: 'crm-table-foot' })
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })
    this.el = h(
      'section',
      { class: 'crm-table' },
      h('div', { class: 'crm-table-tools' }, this.colsBtn, this.clear, h('span', { class: 'grow' }), ...(opts.tools ?? [])),
      this.scroll,
      this.foot,
      this.live,
    )
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true })
    this.list.addEventListener('keydown', (e) => this.onKey(e))
    this.renderHead()
  }

  private get prefKey(): string {
    return `${this.opts.key}:colunas`
  }

  private get columns(): CrmColumn<T>[] {
    return visibleColumns(this.opts.columns, this.chosen)
  }

  /** New data (the store changed): filters, sort and the focused row stay. */
  setRows(rows: readonly T[]): void {
    const id = this.shown[this.active] ? this.opts.rowId(this.shown[this.active]) : null
    this.rows = [...rows]
    this.recompute()
    if (id) {
      const i = this.shown.findIndex((r) => this.opts.rowId(r) === id)
      if (i >= 0) this.active = i
    }
    this.renderRows(true)
  }

  /** A tab of Pagamentos sorts its own way. */
  setSort(sort: TableSort | null): void {
    this.sort = sort
    this.recompute()
    this.renderHead()
    this.renderRows(true)
  }

  /** The rows that pass the filters, in screen order ("Exportar" sends these). */
  shownRows(): T[] {
    return this.shown
  }

  get filtered(): boolean {
    return hasFilters(this.filters)
  }

  clearFilters(): void {
    this.filters = {}
    this.recompute()
    this.renderHead()
    this.renderRows(true)
    this.say()
    this.head.querySelector<HTMLInputElement>('.crm-filter')?.focus()
  }

  /** Focus goes to the current row, or to the first filter when the table is empty. */
  focus(): void {
    if (!this.shown.length) return void this.head.querySelector<HTMLElement>('.crm-filter, .crm-sort')?.focus()
    this.focusRow(this.active)
  }

  /** Shows a row by its id (the search opened it): scrolls to it and gives it the focus. */
  reveal(id: string): boolean {
    const i = this.shown.findIndex((r) => this.opts.rowId(r) === id)
    if (i < 0) return false
    this.focusRow(i)
    return true
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    clearTimeout(this.announceTimer)
    this.closeMenu(false)
  }

  // ---------- data ----------

  private recompute(): void {
    this.shown = tableRows(this.rows, this.opts.columns, this.filters, this.sort)
    if (this.active >= this.shown.length) this.active = Math.max(0, this.shown.length - 1)
    this.renderFoot()
  }

  private renderFoot(): void {
    const sumCol = this.opts.sumColumn ? this.opts.columns.find((c) => c.id === this.opts.sumColumn) : undefined
    this.foot.textContent = tableFooter(
      this.shown.length,
      this.rows.length,
      this.opts.noun,
      sumCol ? sumColumn(this.shown, sumCol) : undefined,
    )
    this.clear.hidden = !this.filtered
  }

  /** The live region: "12 clientes, ordenados por Último contato, decrescente". */
  private say(): void {
    clearTimeout(this.announceTimer)
    const col = this.sort ? this.opts.columns.find((c) => c.id === this.sort!.col) : undefined
    const text = tableAnnouncement(
      this.shown.length,
      this.rows.length,
      this.opts.noun,
      col && this.sort ? { label: col.label, dir: this.sort.dir } : null,
    )
    this.live.textContent = ''
    window.setTimeout(() => (this.live.textContent = text), 60)
  }

  // ---------- header: sort, filters, "Colunas" ----------

  private renderHead(): void {
    const cols = this.columns
    const template = gridTemplate(cols)
    const minWidth = cols.reduce((s, c) => s + Number(/minmax\((\d+)px/.exec(c.width ?? '')?.[1] ?? 120), 0)
    this.wrap.style.setProperty('--crm-cols', template)
    this.wrap.style.minWidth = `${minWidth + 24}px`
    this.wrap.setAttribute('aria-colcount', String(cols.length))
    const titles = h(
      'div',
      { class: 'crm-tr crm-head-row', role: 'row', 'aria-rowindex': 1 },
      ...cols.map((c) => {
        const sort = ariaSort(this.sort, c.id)
        const btn = h(
          'button',
          { type: 'button', class: 'crm-sort', title: `Ordenar por ${c.label}` },
          h('span', {}, c.label),
          h('span', { class: 'crm-sort-mark', 'aria-hidden': 'true' }, sort === 'ascending' ? '▲' : sort === 'descending' ? '▼' : ''),
        )
        btn.addEventListener('click', () => {
          this.sort = nextSort(this.sort, c)
          this.recompute()
          this.renderHead()
          this.renderRows(true)
          this.say()
          this.head.querySelector<HTMLElement>(`[data-col="${CSS.escape(c.id)}"] .crm-sort`)?.focus()
        })
        return h(
          'div',
          { class: `crm-th${c.align === 'end' ? ' end' : ''}`, role: 'columnheader', 'aria-sort': sort, 'data-col': c.id },
          btn,
        )
      }),
    )
    const filters = h(
      'div',
      { class: 'crm-tr crm-filter-row', role: 'row', 'aria-rowindex': 2 },
      ...cols.map((c) => {
        const input = h('input', {
          class: 'crm-filter',
          type: 'search',
          placeholder: 'Filtrar',
          'aria-label': `Filtrar por ${c.label}`,
          value: this.filters[c.id] ?? '',
          'data-col': c.id,
        }) as HTMLInputElement
        input.value = this.filters[c.id] ?? ''
        input.addEventListener('input', () => {
          this.filters = { ...this.filters, [c.id]: input.value }
          this.active = 0
          this.recompute()
          this.scroll.scrollTop = 0
          this.renderRows(true)
          clearTimeout(this.announceTimer)
          this.announceTimer = window.setTimeout(() => this.say(), ANNOUNCE_MS)
        })
        input.addEventListener('keydown', (e) => {
          // ↓ in a filter goes to the rows
          if (e.key === 'ArrowDown' && this.shown.length) {
            e.preventDefault()
            this.focusRow(this.active)
          }
        })
        return h('div', { class: 'crm-th crm-filter-cell', role: 'gridcell' }, input)
      }),
    )
    // the focused filter survives the redraw
    const a = document.activeElement
    const focusCol = a instanceof HTMLInputElement && this.head.contains(a) ? a.dataset.col : undefined
    this.head.replaceChildren(titles, filters)
    if (focusCol) this.head.querySelector<HTMLInputElement>(`.crm-filter[data-col="${CSS.escape(focusCol)}"]`)?.focus()
  }

  private openMenu(): void {
    const all = this.opts.columns
    const on = new Set(this.columns.map((c) => c.id))
    const menu = h(
      'div',
      { class: 'crm-menu crm-cols-menu', role: 'group', 'aria-label': 'Colunas que aparecem' },
      ...all.map((c, i) => {
        const box = h('input', { type: 'checkbox', checked: on.has(c.id), disabled: i === 0 }) as HTMLInputElement
        box.addEventListener('change', () => {
          this.chosen = toggleColumn(all, this.chosen, c.id)
          localStorage.setItem(this.prefKey, JSON.stringify(this.chosen))
          if (!box.checked && this.filters[c.id]) {
            // a hidden column does not filter in secret
            const next = { ...this.filters }
            delete next[c.id]
            this.filters = next
            this.recompute()
          }
          this.renderHead()
          this.renderRows(true)
        })
        return h('label', { class: 'crm-menu-check' }, box, h('span', {}, c.label), i === 0 ? h('small', {}, 'sempre') : null)
      }),
    )
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.closeMenu(true)
      }
    })
    this.menu = menu
    this.colsBtn.setAttribute('aria-expanded', 'true')
    this.colsBtn.after(menu)
    menu.querySelector<HTMLInputElement>('input:not([disabled])')?.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true))
  }

  private outside = (e: PointerEvent): void => {
    if (this.menu && !this.menu.contains(e.target as Node) && e.target !== this.colsBtn && !this.colsBtn.contains(e.target as Node))
      this.closeMenu(false)
  }

  /** The "Colunas" list is open: Esc closes it before the screen. */
  get menuOpen(): boolean {
    return this.menu !== null
  }

  closeMenu(focusButton: boolean): void {
    if (!this.menu) return
    this.menu.remove()
    this.menu = null
    this.colsBtn.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', this.outside, true)
    if (focusButton) this.colsBtn.focus()
  }

  // ---------- rows: the virtual list and the keys ----------

  private onScroll(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.renderRows(false)
    })
  }

  /**
   * Scroll position in row space. The sticky header covers the top of the view, so the rows on
   * screen go from scrollTop to scrollTop + rowsView().
   */
  private rowsTop(): number {
    return Math.max(0, this.scroll.scrollTop)
  }

  private rowsView(): number {
    return Math.max(ROW_H, (this.scroll.clientHeight || 600) - this.head.offsetHeight)
  }

  private renderRows(force: boolean): void {
    const count = this.shown.length
    this.wrap.setAttribute('aria-rowcount', String(count + 2))
    const empty = count === 0
    this.emptyBox.hidden = !empty
    this.list.hidden = empty
    if (empty) {
      this.emptyBox.replaceChildren(this.opts.empty(this.filtered))
      this.list.replaceChildren()
      this.win = { start: 0, end: 0 }
      return
    }
    if (!force) {
      // while the rows drawn still cover the view, scrolling costs nothing: redraw only near the edge
      const view = virtualWindow(count, ROW_H, this.rowsTop(), this.rowsView(), 0)
      if (view.start >= this.win.start && view.end <= this.win.end) return
    }
    const w = virtualWindow(count, ROW_H, this.rowsTop(), this.rowsView(), OVERSCAN)
    const hadFocus = this.list.contains(document.activeElement)
    this.win = { start: w.start, end: w.end }
    const cols = this.columns
    const rows: HTMLElement[] = []
    for (let i = w.start; i < w.end; i++) rows.push(this.row(this.shown[i], i, cols))
    this.list.style.paddingTop = `${w.top}px`
    this.list.style.paddingBottom = `${w.bottom}px`
    this.list.replaceChildren(...rows)
    if (hadFocus) this.rowEl(this.active)?.focus({ preventScroll: true })
  }

  private row(r: T, i: number, cols: CrmColumn<T>[]): HTMLElement {
    const extra = this.opts.rowClass?.(r)
    const el = h(
      'div',
      {
        class: `crm-tr crm-row${extra ? ` ${extra}` : ''}`,
        role: 'row',
        tabindex: i === this.active ? 0 : -1,
        'aria-rowindex': i + 3,
        'data-index': i,
      },
      ...cols.map((c) => {
        const text = c.text(r)
        return h(
          'div',
          { class: `crm-td${c.align === 'end' ? ' end' : ''}`, role: 'gridcell', title: text.length > 24 ? text : undefined },
          text,
        )
      }),
    )
    el.addEventListener('click', () => {
      this.active = i
      this.opts.open(r)
    })
    el.addEventListener('focus', () => {
      if (this.active === i) return
      this.rowEl(this.active)?.setAttribute('tabindex', '-1')
      this.active = i
      el.tabIndex = 0
    })
    return el
  }

  private rowEl(i: number): HTMLElement | null {
    return this.list.querySelector<HTMLElement>(`.crm-row[data-index="${i}"]`)
  }

  private focusRow(i: number): void {
    if (i < 0 || i >= this.shown.length) return
    this.rowEl(this.active)?.setAttribute('tabindex', '-1')
    this.active = i
    const next = scrollForRow(i, ROW_H, this.rowsTop(), this.rowsView())
    if (next !== this.rowsTop()) this.scroll.scrollTop = next
    this.renderRows(true)
    const el = this.rowEl(i)
    if (el) {
      el.tabIndex = 0
      el.focus({ preventScroll: true })
    }
  }

  private onKey(e: KeyboardEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.crm-row')
    if (!target || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const r = this.shown[this.active]
      if (r) this.opts.open(r)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(e.key)) return
    e.preventDefault()
    // the arrows would also walk the player around the office
    e.stopPropagation()
    if (e.key === 'ArrowUp' && this.active === 0) {
      this.head.querySelector<HTMLInputElement>('.crm-filter')?.focus()
      return
    }
    const page = Math.max(1, Math.floor(this.rowsView() / ROW_H) - 1)
    this.focusRow(moveRow(this.active, this.shown.length, e.key, page))
  }
}
