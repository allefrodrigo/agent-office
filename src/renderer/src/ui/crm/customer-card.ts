import { dealAge, formatCents, formatPhone } from '@shared/crm'
import {
  brDate,
  brDateOf,
  consentLines,
  customerTimeline,
  customerToDraft,
  daysLabel,
  deleteCustomerText,
  paymentStateText,
  recurrenceLabel,
  stageName,
} from '@shared/crm-view'
import { CRM_LIMITS, type Customer } from '@shared/types'
import { modalA11y } from '../a11y'
import { chatStore } from '../chat/store'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import { busy } from './fields'
import { customerForm, dealForm } from './forms'
import { paymentDialog, paymentForm, recurrenceForm } from './payment-form'
import { crmStore } from './store'
import { crmError, floorName, todayIso, type CrmCtx } from './util'

// A ficha do cliente (CR-05): dados, permissões de contato, negócios, pagamentos, notas, tickets
// ligados e a linha do tempo, numa gaveta à direita da tela do CRM. No rodapé, "Exportar os dados
// deste cliente" e "Apagar este cliente" (LGPD). Texto de cliente sempre como texto.

const SOURCE: Record<Customer['source'], string> = {
  manual: 'Cadastro à mão',
  import: 'Planilha (CSV)',
  whatsapp: 'WhatsApp',
  demo: 'Demonstração',
}

let open: { id: string; close(): void; refresh(): void } | null = null

/** The card on screen follows the store; a removed customer closes it. */
export function refreshCustomerCard(): void {
  open?.refresh()
}

export function closeCustomerCard(): boolean {
  if (!open) return false
  open.close()
  return true
}

export function customerCardOpen(): boolean {
  return open !== null
}

/** Opens the card of `id` inside `host` (the .crm-screen, for its tokens). */
export function openCustomerCard(host: HTMLElement, ctx: CrmCtx, id: string): void {
  if (open?.id === id) return
  open?.close()
  const customer = (): Customer | undefined => crmStore.data?.customers.find((c) => c.id === id)
  if (!customer()) return ctx.toast('Esse cliente não existe mais.', 'err')

  const heading = h('h2', { class: 'crm-card-name' })
  const sub = h('p', { class: 'crm-card-sub' })
  const actions = h('div', { class: 'crm-card-actions' })
  const body = h('div', { class: 'crm-card-body' })
  // the note box is built once: a refresh never eats what is being typed
  const note = h('textarea', {
    class: 'input crm-note-input',
    rows: 3,
    maxlength: CRM_LIMITS.note,
    placeholder: 'O que combinaram, o que o cliente pediu, o que fazer depois…',
    'aria-label': 'Nova nota',
  }) as HTMLTextAreaElement
  const addNote = h('button', { class: 'btn btn-small', type: 'button' }, 'Adicionar nota')
  addNote.addEventListener(
    'click',
    () =>
      void busy(addNote, async () => {
        const text = note.value.trim()
        if (!text) return note.focus()
        try {
          const saved = await window.office.addCrmNote(id, text)
          crmStore.put({ customers: [saved] })
          note.value = ''
          ctx.toast('Nota salva na linha do tempo.', 'ok')
        } catch (err) {
          ctx.toast(crmError(err), 'err')
        }
      }),
  )
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      addNote.click()
    }
  })
  const notes = h(
    'section',
    { class: 'crm-card-sec' },
    h('h3', { class: 'crm-sec-title' }, 'Notas'),
    note,
    h('div', { class: 'crm-inline end' }, addNote),
  )

  const exportBtn = h('button', { class: 'btn btn-small', type: 'button' }, icon('download', 14), 'Exportar os dados deste cliente')
  exportBtn.addEventListener(
    'click',
    () =>
      void busy(exportBtn, async () => {
        try {
          const path = await window.office.exportCustomerData(id)
          if (path) ctx.toast(`Dados salvos em ${path}.`, 'ok')
        } catch (err) {
          ctx.toast(crmError(err), 'err')
        }
      }),
  )
  const deleteBtn = h('button', { class: 'btn btn-small crm-btn-danger', type: 'button' }, icon('trash', 14), 'Apagar este cliente')
  deleteBtn.addEventListener('click', () => void remove())

  const close = h(
    'button',
    { class: 'crm-icon-btn', type: 'button', title: 'Fechar a ficha (Esc)', 'aria-label': 'Fechar a ficha' },
    icon('x', 18),
  )
  const box = h(
    'aside',
    { class: 'crm-drawer' },
    h('header', { class: 'crm-card-head' }, h('div', { class: 'crm-card-who' }, heading, sub), close),
    actions,
    body,
    h('footer', { class: 'crm-card-foot' }, exportBtn, deleteBtn),
  )
  const backdrop = h('div', { class: 'backdrop crm-drawer-backdrop' }, box)
  modalA11y(backdrop, box, heading)
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) done()
  })
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault()
      done()
    }
    e.stopPropagation()
  })
  close.addEventListener('click', () => done())

  function done(): void {
    if (open?.id === id) open = null
    backdrop.remove()
  }

  async function remove(): Promise<void> {
    const c = customer()
    const data = crmStore.data
    if (!c || !data) return
    const ok = await confirmDialog(ctx.root, {
      title: `Apagar ${c.name}?`,
      text: deleteCustomerText(c, data),
      confirm: 'Apagar este cliente',
      cancel: 'Manter',
      danger: true,
    })
    if (!ok) return
    try {
      await window.office.deleteCustomer(id)
      crmStore.put({
        removed: {
          customers: [id],
          deals: data.deals.filter((d) => d.customerId === id).map((d) => d.id),
          payments: data.payments.filter((p) => p.customerId === id).map((p) => p.id),
          recurrences: data.recurrences.filter((r) => r.customerId === id).map((r) => r.id),
        },
      })
      done()
      ctx.toast(`${c.name} saiu do CRM.`, 'ok')
    } catch (err) {
      ctx.toast(crmError(err), 'err')
    }
  }

  async function touch(): Promise<void> {
    const c = customer()
    if (!c) return
    try {
      const saved = await window.office.saveCustomer({ ...customerToDraft(c), lastContactAt: Date.now() })
      crmStore.put({ customers: [saved] })
      ctx.toast('Último contato: hoje.', 'ok')
    } catch (err) {
      ctx.toast(crmError(err), 'err')
    }
  }

  function render(): void {
    const c = customer()
    const data = crmStore.data
    if (!c || !data) return
    const today = todayIso()
    const now = Date.now()
    heading.textContent = c.name
    sub.textContent = [c.kind === 'company' ? 'Empresa' : 'Pessoa', c.company && c.company !== c.name ? c.company : '']
      .filter(Boolean)
      .join(' · ')
    const btn = (label: string, run: () => void, plus = false) =>
      h('button', { class: 'btn btn-small', type: 'button', onclick: run }, plus ? icon('plus', 14) : null, label)
    actions.replaceChildren(
      btn('Editar', () => customerForm(ctx, customer())),
      btn('Negócio', () => dealForm(ctx, undefined, { customerId: id }), true),
      btn('Pagamento', () => paymentForm(ctx, undefined, { customerId: id }), true),
      btn('Recorrência', () => recurrenceForm(ctx, undefined, { customerId: id }), true),
      btn('Registrar contato hoje', () => void touch()),
    )

    const row = (k: string, v: string | HTMLElement | null) => (v ? [h('dt', {}, k), h('dd', {}, v)] : [])
    const dados = h(
      'dl',
      { class: 'crm-dl' },
      ...row('Telefones', c.phones.length ? c.phones.map(formatPhone).join(' · ') : 'Nenhum'),
      ...row('E-mail', c.email ?? null),
      ...row(
        'Etiquetas',
        c.tags.length ? h('span', { class: 'crm-tags' }, ...c.tags.map((t) => h('span', { class: 'crm-tag' }, t))) : null,
      ),
      ...row('Responsável', c.owner ?? null),
      ...row('Andar', floorName(ctx.state, c.floor) || null),
      ...row('Próximo passo', c.nextStep ? `${c.nextStep}${c.nextStepOn ? ` · até ${brDate(c.nextStepOn)}` : ''}` : null),
      ...row('Último contato', c.lastContactAt ? brDateOf(c.lastContactAt) : 'Nunca registrado'),
      ...row('Origem', SOURCE[c.source] ?? c.source),
    )

    const consent = h(
      'ul',
      { class: 'crm-consent' },
      ...consentLines(c.consent).map((l) =>
        h(
          'li',
          { class: `crm-consent-row${l.on ? ' on' : ''}${l.optedOut ? ' out' : ''}` },
          h('span', { class: 'crm-consent-mark', 'aria-hidden': 'true' }, l.on ? '✓' : '✕'),
          h('span', { class: 'crm-consent-label' }, l.label),
          h('span', { class: 'crm-consent-detail' }, `${l.on ? 'sim' : 'não'} · ${l.detail}`),
        ),
      ),
    )
    const optedOut = c.consent.optOutAt
      ? h(
          'p',
          { class: 'crm-warn' },
          `Pediu para sair das ofertas em ${brDateOf(c.consent.optOutAt)}. Nenhuma oferta vai para ele, nem sua. Religar só se ele pedir de novo: em Editar, marque Ofertas e o app pede confirmação.`,
        )
      : null

    const deals = data.deals.filter((d) => d.customerId === id).sort((a, b) => b.updatedAt - a.updatedAt)
    const dealList = deals.length
      ? h(
          'ul',
          { class: 'crm-mini-list' },
          ...deals.map((d) =>
            h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'crm-mini', onclick: () => dealForm(ctx, crmStore.data?.deals.find((x) => x.id === d.id) ?? d) },
                h('span', { class: 'crm-mini-main' }, d.title),
                h(
                  'span',
                  { class: 'crm-mini-meta' },
                  `${stageName(data.pipelines, d.pipelineId, d.stageId)} · ${daysLabel(dealAge(d, now))} na etapa`,
                ),
                h('span', { class: 'crm-mini-value' }, formatCents(d.valueCents)),
              ),
            ),
          ),
        )
      : h('p', { class: 'crm-none' }, 'Nenhum negócio ainda.')

    const payments = data.payments.filter((p) => p.customerId === id).sort((a, b) => (a.due < b.due ? 1 : a.due > b.due ? -1 : 0))
    const recurrences = data.recurrences.filter((r) => r.customerId === id)
    const paymentList = h(
      'div',
      {},
      payments.length
        ? h(
            'ul',
            { class: 'crm-mini-list' },
            ...payments
              .slice(0, 24)
              .map((p) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    { type: 'button', class: 'crm-mini', onclick: () => paymentDialog(ctx, p.id) },
                    h('span', { class: 'crm-mini-main' }, p.reference || p.invoice),
                    h('span', { class: 'crm-mini-meta' }, `${p.invoice} · vence ${brDate(p.due)} · ${paymentStateText(p, today)}`),
                    h('span', { class: 'crm-mini-value' }, formatCents(p.amountCents)),
                  ),
                ),
              ),
          )
        : h('p', { class: 'crm-none' }, 'Nenhum pagamento ainda.'),
      payments.length > 24 ? h('p', { class: 'crm-none' }, `E mais ${payments.length - 24}: veja todos na aba Pagamentos.`) : null,
      recurrences.length
        ? h(
            'ul',
            { class: 'crm-mini-list' },
            ...recurrences.map((r) =>
              h(
                'li',
                {},
                h(
                  'button',
                  { type: 'button', class: 'crm-mini', onclick: () => recurrenceForm(ctx, r) },
                  h('span', { class: 'crm-mini-main' }, recurrenceLabel(r)),
                  h('span', { class: 'crm-mini-meta' }, r.active ? 'Recorrência ligada' : 'Recorrência pausada'),
                ),
              ),
            ),
          )
        : null,
    )

    const ticketIds = [...new Set([...c.tickets, ...deals.flatMap((d) => d.tickets)])]
    const tickets = ticketIds.length
      ? h(
          'ul',
          { class: 'crm-ticket-list' },
          ...ticketIds.map((tid) => {
            const t = ctx.state.tickets.get(tid)
            return h(
              'li',
              { class: 'crm-ticket' },
              h('span', { class: 'crm-ticket-key' }, t?.key ?? '—'),
              h('span', { class: 'crm-ticket-title' }, t ? t.title : 'Ticket fechado ou apagado'),
              h(
                'button',
                {
                  class: 'btn btn-small',
                  type: 'button',
                  disabled: !t,
                  onclick: () => {
                    done()
                    ctx.openTicket(tid)
                  },
                },
                'Abrir no quadro',
              ),
            )
          }),
        )
      : h('p', { class: 'crm-none' }, 'Nenhum ticket ligado. Ligue pelo negócio: abra um e use "Criar ticket".')

    const entries = customerTimeline(c, deals, payments, data.pipelines, (botId) => chatStore.bot(botId)?.name)
    const timeline = h(
      'ol',
      { class: 'crm-timeline' },
      ...entries
        .slice(0, 200)
        .map((e) =>
          h(
            'li',
            { class: `crm-tl k-${e.kind}` },
            h('span', { class: 'crm-tl-when' }, `${brDateOf(e.t)} · ${e.by}`),
            h('span', { class: 'crm-tl-text' }, e.text),
          ),
        ),
    )

    const sec = (title: string, ...children: (HTMLElement | null)[]) =>
      h('section', { class: 'crm-card-sec' }, h('h3', { class: 'crm-sec-title' }, title), ...children)
    body.replaceChildren(
      sec('Dados', dados),
      sec('Permissões de contato', consent, optedOut),
      sec(`Negócios (${deals.length})`, dealList),
      sec(`Pagamentos (${payments.length})`, paymentList),
      notes,
      sec('Tickets ligados', tickets),
      sec('Linha do tempo', timeline),
    )
  }

  host.append(backdrop)
  render()
  open = {
    id,
    close: done,
    refresh: () => {
      if (!customer()) {
        done()
        return
      }
      render()
    },
  }
}
