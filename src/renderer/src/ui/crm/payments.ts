import { paymentStatus } from '@shared/crm'
import {
  defaultPaymentSort,
  isPaymentTab,
  PAYMENT_TABS,
  paymentColumns,
  paymentsIn,
  paymentTabCounts,
  type PaymentTab,
} from '@shared/crm-view'
import type { Payment } from '@shared/types'
import { h, icon } from '../dom'
import { busy } from './fields'
import { paymentDialog, paymentForm, recurrenceForm, recurrencesDialog } from './payment-form'
import { crmStore } from './store'
import { CrmTable } from './table'
import { crmError, todayIso, type CrmCtx } from './util'

// A aba Pagamentos (CR-06): Próximos, Atrasados, Histórico e Todos (dueGroup); a tabela com
// Cliente, Fatura, Valor, Vencimento, Referente a, Método, Responsável e Estado; o rodapé soma o
// filtro. Enter numa linha abre o pagamento ("Marcar como pago"). "Exportar" leva o filtro.

const TAB_KEY = 'agent-office:crm-pagamentos-aba'

export class PaymentsView {
  readonly el: HTMLElement
  private readonly table: CrmTable<Payment>
  private readonly tabs: HTMLElement
  private tab: PaymentTab
  private today = todayIso()

  constructor(private readonly ctx: CrmCtx) {
    const saved = localStorage.getItem(TAB_KEY)
    this.tab = isPaymentTab(saved) ? saved : 'upcoming'
    this.tabs = h('div', { class: 'crm-subtabs', role: 'tablist', 'aria-label': 'Quais pagamentos' })
    this.tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      e.stopPropagation()
      const i = PAYMENT_TABS.findIndex((t) => t.id === this.tab)
      const next = PAYMENT_TABS[(i + (e.key === 'ArrowRight' ? 1 : PAYMENT_TABS.length - 1)) % PAYMENT_TABS.length]
      this.setTab(next.id)
      this.tabs.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus()
    })
    const exportBtn = h('button', { class: 'btn btn-small', type: 'button' }, icon('download', 14), 'Exportar')
    exportBtn.addEventListener('click', () => void busy(exportBtn, () => this.export()))
    const tools = [
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => recurrencesDialog(ctx) }, 'Recorrências'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => recurrenceForm(ctx) }, icon('plus', 14), 'Recorrência'),
      exportBtn,
    ]
    this.table = new CrmTable<Payment>({
      key: 'agent-office:crm-pagamentos',
      label: 'Pagamentos',
      noun: ['pagamento', 'pagamentos'],
      columns: paymentColumns({ customer: (id) => crmStore.data?.customers.find((c) => c.id === id), today: () => this.today }),
      rowId: (p) => p.id,
      sumColumn: 'amount',
      sort: defaultPaymentSort(this.tab),
      open: (p) => paymentDialog(ctx, p.id),
      empty: (filtered) => this.empty(filtered),
      rowClass: (p) => `s-${paymentStatus(p, this.today)}`,
      tools,
    })
    const panel = h('div', { class: 'crm-subpanel', role: 'tabpanel' }, this.table.el)
    this.el = h('div', { class: 'crm-view crm-payments' }, this.tabs, panel)
    panel.setAttribute('aria-labelledby', 'crm-paytab-current')
  }

  setTab(tab: PaymentTab): void {
    if (tab === this.tab) return
    this.tab = tab
    localStorage.setItem(TAB_KEY, tab)
    this.table.setSort(defaultPaymentSort(tab))
    this.render()
  }

  render(): void {
    const data = crmStore.data
    if (!data) return
    this.today = todayIso()
    const counts = paymentTabCounts(data.payments, this.today)
    this.tabs.replaceChildren(
      ...PAYMENT_TABS.map((t) => {
        const on = t.id === this.tab
        return h(
          'button',
          {
            type: 'button',
            class: `crm-subtab${on ? ' on' : ''}${t.id === 'overdue' && counts.overdue ? ' alert' : ''}`,
            role: 'tab',
            id: on ? 'crm-paytab-current' : undefined,
            'aria-selected': String(on),
            tabindex: on ? 0 : -1,
            'data-tab': t.id,
            onclick: () => this.setTab(t.id),
          },
          t.label,
          h('span', { class: 'crm-subtab-count' }, String(counts[t.id])),
        )
      }),
    )
    this.table.setRows(paymentsIn(data.payments, this.tab, this.today))
  }

  focus(): void {
    this.table.focus()
  }

  create(): void {
    paymentForm(this.ctx)
  }

  /** The search opened a payment: "Todos", its row, and its window. */
  reveal(id: string): boolean {
    if (!crmStore.data?.payments.some((p) => p.id === id)) return false
    this.setTab('all')
    this.render()
    this.table.reveal(id)
    paymentDialog(this.ctx, id)
    return true
  }

  get menuOpen(): boolean {
    return this.table.menuOpen
  }

  closeMenu(): void {
    this.table.closeMenu(true)
  }

  dispose(): void {
    this.table.dispose()
  }

  private async export(): Promise<void> {
    const ids = this.table.shownRows().map((p) => p.id)
    if (!ids.length) return this.ctx.toast('Nenhum pagamento no filtro para exportar.', 'err')
    try {
      const path = await window.office.exportCrmCsv('payments', ids)
      if (path) this.ctx.toast(`${ids.length === 1 ? '1 pagamento salvo' : `${ids.length} pagamentos salvos`} em ${path}.`, 'ok')
    } catch (err) {
      this.ctx.toast(crmError(err), 'err')
    }
  }

  private empty(filtered: boolean): HTMLElement {
    return h(
      'div',
      { class: 'crm-empty' },
      h('p', { class: 'crm-empty-title' }, 'Nenhum pagamento corresponde'),
      filtered
        ? h('button', { class: 'btn', type: 'button', onclick: () => this.table.clearFilters() }, 'Limpar filtros')
        : h('button', { class: 'btn crm-btn-accent', type: 'button', onclick: () => this.create() }, icon('plus', 15), 'Novo pagamento'),
    )
  }
}
