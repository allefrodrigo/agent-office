import { dealAge, formatCents } from '@shared/crm'
import {
  boardColumns,
  brDate,
  countOf,
  customerTitle,
  dealCardLabel,
  daysLabel,
  filterDeals,
  neighborStage,
  pipelineOf,
  type BoardColumn,
} from '@shared/crm-view'
import type { Customer, Deal, Pipeline } from '@shared/types'
import { keepFocus, rove } from '../a11y'
import { h, icon } from '../dom'
import { dealForm } from './forms'
import { crmStore } from './store'
import { crmError, floorName, type CrmCtx } from './util'

// A aba Negócios (CR-05): o funil em quadro, uma coluna por etapa. Cartão com cliente, serviço,
// valor, dias na etapa e próximo passo. Arrastar muda a etapa; no teclado, as setas andam entre os
// cartões e ⌥←/⌥→ movem para a etapa ao lado, como no quadro de tickets. Enter abre o negócio
// (andar, tickets ligados, "Criar ticket").

const STORAGE_PIPELINE = 'agent-office:crm-funil'

function beforeCard(list: HTMLElement, y: number): HTMLElement | undefined {
  for (const c of list.querySelectorAll<HTMLElement>('.crm-deal:not(.dragging)')) {
    const r = c.getBoundingClientRect()
    if (y < r.top + r.height / 2) return c
  }
  return undefined
}

export class DealsView {
  readonly el: HTMLElement
  private readonly cols: HTMLElement
  private readonly search: HTMLInputElement
  private readonly pipelineSel: HTMLSelectElement
  private readonly count: HTMLElement
  private readonly live: HTMLElement
  private dragging: string | null = null
  private stale = false
  /** The card Tab lands on (roving tabindex). */
  private active: string | null = null
  private pipelineId = localStorage.getItem(STORAGE_PIPELINE) ?? ''

  constructor(private readonly ctx: CrmCtx) {
    this.search = h('input', {
      class: 'crm-input crm-deal-search',
      type: 'search',
      placeholder: 'Filtrar por cliente ou serviço',
      'aria-label': 'Filtrar negócios por cliente ou serviço',
    }) as HTMLInputElement
    this.search.addEventListener('input', () => this.render())
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        this.focusCard()
      }
    })
    this.pipelineSel = h('select', { class: 'crm-input', 'aria-label': 'Funil', hidden: true }) as HTMLSelectElement
    this.pipelineSel.addEventListener('change', () => {
      this.pipelineId = this.pipelineSel.value
      localStorage.setItem(STORAGE_PIPELINE, this.pipelineId)
      this.render()
    })
    this.count = h('span', { class: 'crm-board-count' })
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })
    this.cols = h('div', { class: 'crm-board' })
    this.el = h(
      'div',
      { class: 'crm-view crm-deals' },
      h(
        'div',
        { class: 'crm-table-tools' },
        this.pipelineSel,
        this.search,
        this.count,
        h('span', { class: 'grow' }),
        h('span', { class: 'crm-keys-hint' }, '⌥← ⌥→ move o cartão de etapa'),
      ),
      this.cols,
      this.live,
    )
  }

  private pipeline(): Pipeline {
    return pipelineOf(crmStore.data?.pipelines ?? [], this.pipelineId || undefined)
  }

  render(): void {
    const data = crmStore.data
    if (!data) return
    if (this.dragging) {
      this.stale = true
      return
    }
    this.stale = false
    const pipeline = this.pipeline()
    // the funnel picker shows only with more than one pipeline
    this.pipelineSel.hidden = data.pipelines.length < 2
    if (data.pipelines.length > 1) {
      this.pipelineSel.replaceChildren(...data.pipelines.map((p) => h('option', { value: p.id }, p.name)))
      this.pipelineSel.value = pipeline.id
    }
    const customers = new Map(data.customers.map((c) => [c.id, c]))
    const inPipeline = data.deals.filter((d) => d.pipelineId === pipeline.id)
    const shown = filterDeals(inPipeline, this.search.value, (id) => customers.get(id))
    this.count.textContent =
      shown.length === inPipeline.length
        ? countOf(shown.length, ['negócio', 'negócios'])
        : `${shown.length} de ${countOf(inPipeline.length, ['negócio', 'negócios'])}`
    const now = Date.now()
    keepFocus(this.cols, () => this.cols.replaceChildren(...boardColumns(pipeline, shown).map((col) => this.column(col, customers, now))))
    const cards = [...this.cols.querySelectorAll<HTMLElement>('.crm-deal')]
    const at = cards.findIndex((c) => c.dataset.id === this.active)
    rove(cards, at >= 0 ? at : 0)
  }

  focus(): void {
    if (!this.focusCard()) this.search.focus()
  }

  private focusCard(): boolean {
    const cards = [...this.cols.querySelectorAll<HTMLElement>('.crm-deal')]
    const card = cards.find((c) => c.tabIndex === 0) ?? cards[0]
    if (!card) return false
    card.focus()
    return true
  }

  create(stageId?: string): void {
    dealForm(this.ctx, undefined, { stageId })
  }

  /** The search opened a deal: show its card and open it. */
  reveal(id: string): boolean {
    const d = crmStore.data?.deals.find((x) => x.id === id)
    if (!d) return false
    if (d.pipelineId !== this.pipeline().id) {
      this.pipelineId = d.pipelineId
      this.search.value = ''
      this.render()
    }
    this.active = id
    this.render()
    this.cols.querySelector<HTMLElement>(`.crm-deal[data-id="${CSS.escape(id)}"]`)?.focus()
    dealForm(this.ctx, d)
    return true
  }

  private say(text: string): void {
    this.live.textContent = ''
    window.setTimeout(() => (this.live.textContent = text), 60)
  }

  private async move(d: Deal, stageId: string, beforeId?: string): Promise<void> {
    try {
      const saved = await window.office.moveDeal(d.id, stageId, beforeId)
      crmStore.put({ deals: [saved] })
      const stage = this.pipeline().stages.find((s) => s.id === stageId)
      if (stageId !== d.stageId) this.say(`${d.title} foi para ${stage?.name ?? 'outra etapa'}.`)
    } catch (err) {
      this.ctx.toast(crmError(err), 'err')
    }
  }

  private column(col: BoardColumn, customers: Map<string, Customer>, now: number): HTMLElement {
    const { stage, deals } = col
    const list = h(
      'div',
      { class: 'crm-col-list', role: 'group', 'aria-label': `Etapa ${stage.name}, ${countOf(deals.length, ['negócio', 'negócios'])}` },
      ...deals.map((d) => this.card(d, customers.get(d.customerId), stage.name, now)),
      deals.length
        ? null
        : h(
            'div',
            { class: 'crm-col-empty' },
            stage.kind === 'won'
              ? 'Negócios fechados aparecem aqui.'
              : stage.kind === 'lost'
                ? 'Negócios perdidos aparecem aqui.'
                : 'Arraste um negócio para cá.',
          ),
    )
    list.addEventListener('dragover', (e) => {
      if (!this.dragging) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'
      this.clearMarks()
      const before = beforeCard(list, e.clientY)
      if (before) before.classList.add('drop-before')
      else list.classList.add('drop-end')
    })
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget as Node)) this.clearMarks()
    })
    list.addEventListener('drop', (e) => {
      e.preventDefault()
      const id = this.dragging
      this.clearMarks()
      const d = id ? crmStore.data?.deals.find((x) => x.id === id) : undefined
      if (!d) return
      const before = beforeCard(list, e.clientY)?.dataset.id
      if (before === d.id) return
      void this.move(d, stage.id, before)
    })
    const add =
      stage.kind === 'open'
        ? h(
            'button',
            {
              class: 'crm-icon-btn',
              type: 'button',
              title: `Novo negócio em ${stage.name}`,
              'aria-label': `Novo negócio em ${stage.name}`,
              onclick: () => this.create(stage.id),
            },
            icon('plus', 15),
          )
        : null
    return h(
      'section',
      { class: `crm-col kind-${stage.kind}` },
      h(
        'header',
        { class: 'crm-col-head' },
        h('h3', { class: 'crm-col-name' }, stage.name),
        h('span', { class: 'crm-col-count' }, String(deals.length)),
        h('span', { class: 'crm-col-total' }, formatCents(col.totalCents)),
        add,
      ),
      list,
    )
  }

  private card(d: Deal, customer: Customer | undefined, stageName: string, now: number): HTMLElement {
    const days = dealAge(d, now)
    const el = h(
      'div',
      {
        class: `crm-deal${days >= 14 ? ' still' : ''}`,
        role: 'button',
        tabindex: -1,
        draggable: 'true',
        'data-id': d.id,
        'data-focus-key': d.id,
        'aria-label': dealCardLabel(d, customer, stageName, now),
        'aria-keyshortcuts': 'Alt+ArrowLeft Alt+ArrowRight',
      },
      h('div', { class: 'crm-deal-who' }, customer ? customerTitle(customer) : 'Cliente removido'),
      h('div', { class: 'crm-deal-title' }, d.title),
      h(
        'div',
        { class: 'crm-deal-row' },
        h('span', { class: 'crm-deal-value' }, formatCents(d.valueCents)),
        h('span', { class: 'crm-deal-age' }, `${daysLabel(days)} na etapa`),
      ),
      d.nextStep
        ? h('div', { class: 'crm-deal-next' }, `→ ${d.nextStep}${d.nextStepOn ? ` · ${brDate(d.nextStepOn).slice(0, 5)}` : ''}`)
        : null,
      d.floor || d.tickets.length
        ? h(
            'div',
            { class: 'crm-deal-links' },
            d.floor ? h('span', { class: 'crm-chip' }, floorName(this.ctx.state, d.floor)) : null,
            d.tickets.length ? h('span', { class: 'crm-chip' }, d.tickets.length === 1 ? '1 ticket' : `${d.tickets.length} tickets`) : null,
          )
        : null,
    )
    el.addEventListener('focus', () => (this.active = d.id))
    el.addEventListener('click', () => {
      this.active = d.id
      dealForm(this.ctx, crmStore.data?.deals.find((x) => x.id === d.id) ?? d)
    })
    el.addEventListener('keydown', (e) => {
      if (e.target !== el || e.metaKey || e.ctrlKey) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        dealForm(this.ctx, crmStore.data?.deals.find((x) => x.id === d.id) ?? d)
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        e.stopPropagation()
        const to = neighborStage(this.pipeline(), d.stageId, e.key === 'ArrowLeft' ? -1 : 1)
        if (to) void this.move(d, to.id)
        else this.say(e.key === 'ArrowLeft' ? 'Já está na primeira etapa.' : 'Já está na última etapa.')
      } else if (!e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        this.focusNeighbor(el, e.key)
      }
    })
    el.addEventListener('dragstart', (e) => {
      this.dragging = d.id
      e.dataTransfer!.setData('text/plain', d.title)
      e.dataTransfer!.effectAllowed = 'move'
      requestAnimationFrame(() => el.classList.add('dragging'))
    })
    el.addEventListener('dragend', () => {
      this.dragging = null
      el.classList.remove('dragging')
      this.clearMarks()
      if (this.stale) this.render()
    })
    return el
  }

  /** ↑/↓ in the column, ←/→ to the nearest card of the next column with any. */
  private focusNeighbor(card: HTMLElement, key: string): void {
    const columns = [...this.cols.querySelectorAll<HTMLElement>('.crm-col')].map((c) => [...c.querySelectorAll<HTMLElement>('.crm-deal')])
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
    this.active = target.dataset.id ?? null
    const all = [...this.cols.querySelectorAll<HTMLElement>('.crm-deal')]
    rove(all, all.indexOf(target))
    target.focus()
  }

  private clearMarks(): void {
    this.cols.querySelectorAll('.drop-before, .drop-end').forEach((n) => n.classList.remove('drop-before', 'drop-end'))
  }
}
