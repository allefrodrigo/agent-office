import { customerColumns, customerStage, dealsByCustomer } from '@shared/crm-view'
import type { Customer, Deal } from '@shared/types'
import { h, icon } from '../dom'
import { busy } from './fields'
import { customerForm, importCustomers } from './forms'
import { crmStore } from './store'
import { CrmTable } from './table'
import { crmError, floorName, type CrmCtx } from './util'

// A aba Clientes (CR-05): a tabela com Cliente, Empresa, Telefone, Etiquetas, Etapa, Último
// contato, Próximo passo, Responsável e Andar; "Importar CSV" com prévia e "Exportar" do filtro.
// Enter (ou um clique) numa linha abre a ficha.

export class CustomersView {
  readonly el: HTMLElement
  private readonly table: CrmTable<Customer>
  private deals = new Map<string, Deal[]>()
  private dealsOf: Deal[] | null = null

  constructor(private readonly ctx: CrmCtx) {
    const importBtn = h('button', { class: 'btn btn-small', type: 'button' }, 'Importar CSV')
    importBtn.addEventListener('click', () => void busy(importBtn, () => importCustomers(ctx)))
    const exportBtn = h('button', { class: 'btn btn-small', type: 'button' }, icon('download', 14), 'Exportar')
    exportBtn.addEventListener('click', () => void busy(exportBtn, () => this.export()))
    this.table = new CrmTable<Customer>({
      key: 'agent-office:crm-clientes',
      label: 'Clientes',
      noun: ['cliente', 'clientes'],
      columns: customerColumns({
        stage: (c) => customerStage(this.deals.get(c.id), crmStore.data?.pipelines ?? []),
        floor: (c) => floorName(ctx.state, c.floor),
      }),
      rowId: (c) => c.id,
      sort: { col: 'name', dir: 'asc' },
      open: (c) => ctx.openCustomer(c.id),
      empty: (filtered) => this.empty(filtered),
      tools: [importBtn, exportBtn],
    })
    this.el = h('div', { class: 'crm-view crm-customers' }, this.table.el)
  }

  render(): void {
    const data = crmStore.data
    if (!data) return
    // the stage column reads the deals of each customer: indexed once per change of deals
    if (this.dealsOf !== data.deals) {
      this.dealsOf = data.deals
      this.deals = dealsByCustomer(data.deals)
    }
    this.table.setRows(data.customers)
  }

  focus(): void {
    this.table.focus()
  }

  create(): void {
    customerForm(this.ctx, undefined, (c) => this.ctx.openCustomer(c.id))
  }

  reveal(id: string): boolean {
    return this.table.reveal(id)
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
    const ids = this.table.shownRows().map((c) => c.id)
    if (!ids.length) return this.ctx.toast('Nenhum cliente no filtro para exportar.', 'err')
    try {
      const path = await window.office.exportCrmCsv('customers', ids)
      if (path) this.ctx.toast(`${ids.length === 1 ? '1 cliente salvo' : `${ids.length} clientes salvos`} em ${path}.`, 'ok')
    } catch (err) {
      this.ctx.toast(crmError(err), 'err')
    }
  }

  private empty(filtered: boolean): HTMLElement {
    if (filtered)
      return h(
        'div',
        { class: 'crm-empty' },
        h('p', { class: 'crm-empty-title' }, 'Nenhum cliente corresponde'),
        h('p', {}, 'Mude ou limpe os filtros das colunas.'),
        h('button', { class: 'btn', type: 'button', onclick: () => this.table.clearFilters() }, 'Limpar filtros'),
      )
    return h(
      'div',
      { class: 'crm-empty' },
      h('p', { class: 'crm-empty-title' }, 'Nenhum cliente ainda'),
      h('p', {}, 'Cadastre o primeiro ou traga uma planilha. Quem chega por planilha fica sem permissão de oferta.'),
      h(
        'div',
        { class: 'crm-inline center' },
        h('button', { class: 'btn crm-btn-accent', type: 'button', onclick: () => this.create() }, icon('plus', 15), 'Novo cliente'),
        h('button', { class: 'btn', type: 'button', onclick: () => void importCustomers(this.ctx) }, 'Importar CSV'),
      ),
    )
  }
}
