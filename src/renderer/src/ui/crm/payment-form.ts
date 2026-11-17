import { formatCents, nextRecurrence, paymentStatus } from '@shared/crm'
import {
  brDate,
  customerTitle,
  fieldOfError,
  paymentDraftError,
  paymentStateText,
  recurrenceDraftError,
  recurrenceLabel,
} from '@shared/crm-view'
import {
  CRM_LIMITS,
  PAYMENT_METHOD_LABEL,
  type Payment,
  type PaymentDraft,
  type PaymentMethod,
  type Recurrence,
  type RecurrenceDraft,
} from '@shared/types'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import { busy, crmModal, customerSelect, field, formError, moneyInput, selectInput, textInput, type Field } from './fields'
import { crmStore } from './store'
import { crmError, todayIso, type CrmCtx } from './util'

// Pagamentos (CR-06): novo pagamento, a janela de um pagamento ("Marcar como pago" com a data),
// a recorrência ("todo dia 20, R$ 480, Manutenção") e a lista das recorrências. Anexo em PDF fica
// para a fase 4.

const METHODS = (Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))
const METHOD_HINT = 'PIX é o único que o CRM cobra, com a chave fixa de Configurações. Os outros ficam só como registro.'

function fail(err: unknown, fields: Partial<Record<string, Field>>, form: ReturnType<typeof formError>): void {
  const text = crmError(err)
  const f = fieldOfError(text)
  const target = f ? fields[f] : undefined
  if (target) target.error(text)
  else form.set(text)
}

const currentMonth = () => todayIso().slice(0, 7)

// ---------- novo pagamento ----------

export function paymentForm(ctx: CrmCtx, existing?: Payment, preset: { customerId?: string } = {}): void {
  const data = crmStore.data
  if (!data) return ctx.toast('Os dados do CRM ainda não chegaram. Espere um instante e tente de novo.', 'err')
  if (!data.customers.length) return ctx.toast('Crie um cliente primeiro: todo pagamento é de um cliente.', 'err')
  const p = existing
  const presetCustomer = data.customers.find((c) => c.id === (p?.customerId ?? preset.customerId))
  const customer = customerSelect(data.customers, presetCustomer?.id ?? '')
  const amount = moneyInput(p?.amountCents)
  const due = textInput(p?.due ?? todayIso(), { type: 'date' })
  const reference = textInput(p?.reference ?? '', { maxlength: CRM_LIMITS.reference, placeholder: 'Ex.: Manutenção · novembro/2026' })
  const method = selectInput(METHODS, p?.method ?? 'pix')
  const owner = textInput(p?.owner ?? presetCustomer?.owner ?? '', {
    maxlength: CRM_LIMITS.owner,
    placeholder: 'Quem acompanha este pagamento',
  })
  const state =
    p && p.state !== 'paid'
      ? selectInput(
          [
            { value: 'open', label: 'Aberto' },
            { value: 'disputed', label: 'Em disputa' },
            { value: 'canceled', label: 'Cancelado' },
          ],
          p.state,
        )
      : null
  const f = {
    customer: field('Cliente', customer),
    amount: field('Valor', amount.el),
    due: field('Vencimento', due),
    reference: field('Referente a', reference),
  }
  const form = formError()
  customer.addEventListener('change', () => {
    const c = crmStore.data?.customers.find((x) => x.id === customer.value)
    if (c?.owner && !owner.value.trim()) owner.value = c.owner
  })
  const close = () => el.remove()
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, p ? 'Salvar' : 'Criar pagamento')
  save.addEventListener(
    'click',
    () =>
      void busy(save, async () => {
        form.set(null)
        for (const x of Object.values(f)) x.error(null)
        const cents = amount.cents()
        const draft: PaymentDraft = {
          ...(p ? { id: p.id, dealId: p.dealId } : {}),
          customerId: customer.value,
          amountCents: cents ?? 0,
          due: due.value,
          reference: reference.value.trim(),
          method: method.value as PaymentMethod,
          owner: owner.value.trim() || undefined,
          ...(state ? { state: state.value as PaymentDraft['state'] } : {}),
        }
        const bad = paymentDraftError(draft)
        if (bad) {
          f[bad.field].error(bad.text)
          return ({ customer, amount: amount.el, due, reference } as Record<string, HTMLElement>)[bad.field]?.focus()
        }
        try {
          const saved = await window.office.savePayment(draft)
          crmStore.put({ payments: [saved] })
          close()
          ctx.toast(
            p
              ? `Fatura ${saved.invoice} foi salva.`
              : `Fatura ${saved.invoice} criada: ${formatCents(saved.amountCents)}, vence ${brDate(saved.due)}.`,
            'ok',
          )
        } catch (err) {
          fail(err, f, form)
        }
      }),
  )
  const el = crmModal(
    ctx.root,
    p ? `Editar a fatura ${p.invoice}` : 'Novo pagamento',
    [
      f.customer.el,
      h('div', { class: 'field-row' }, f.amount.el, f.due.el),
      f.reference.el,
      h('div', { class: 'field-row' }, field('Método', method, METHOD_HINT).el, field('Responsável', owner).el),
      state ? field('Estado', state, 'Para marcar como pago, use "Marcar como pago" na janela do pagamento.').el : null,
      form.el,
    ].filter((x): x is HTMLElement => x !== null),
    [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), save],
    close,
  )
  ;(customer.value ? amount.el : customer).focus()
}

// ---------- a janela de um pagamento ----------

export function paymentDialog(ctx: CrmCtx, id: string): void {
  const p = crmStore.data?.payments.find((x) => x.id === id)
  if (!p) return ctx.toast('Esse pagamento não existe mais.', 'err')
  const today = todayIso()
  const status = paymentStatus(p, today)
  const c = crmStore.data?.customers.find((x) => x.id === p.customerId)
  const recurrence = p.recurrenceId ? crmStore.data?.recurrences.find((r) => r.id === p.recurrenceId) : undefined
  const form = formError()
  const close = () => el.remove()
  const row = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)]
  const details = h(
    'dl',
    { class: 'crm-dl crm-dl-modal' },
    ...row('Cliente', c ? customerTitle(c) : 'Cliente removido'),
    ...row('Valor', formatCents(p.amountCents)),
    ...row('Vencimento', brDate(p.due)),
    ...row('Referente a', p.reference),
    ...row('Método', PAYMENT_METHOD_LABEL[p.method] ?? p.method),
    ...(p.owner ? row('Responsável', p.owner) : []),
    ...row('Estado', paymentStateText(p, today)),
    ...(recurrence ? row('Recorrência', recurrenceLabel(recurrence)) : []),
  )

  const payable = status === 'open' || status === 'overdue' || status === 'disputed'
  const paidOn = textInput(today, { type: 'date', max: today })
  const pay = h('button', { class: 'btn btn-primary', type: 'button' }, icon('check', 15), 'Marcar como pago')
  pay.addEventListener(
    'click',
    () =>
      void busy(pay, async () => {
        form.set(null)
        if (!paidOn.value) {
          form.set('Escolha a data em que o pagamento entrou.')
          return paidOn.focus()
        }
        try {
          const saved = await window.office.markPaid(p.id, paidOn.value)
          crmStore.put({ payments: [saved] })
          close()
          ctx.toast(`Fatura ${saved.invoice} paga em ${brDate(saved.paidOn ?? paidOn.value)}. Ela foi para o Histórico.`, 'ok')
        } catch (err) {
          form.set(crmError(err))
        }
      }),
  )
  const setState = async (state: 'open' | 'canceled', done: string) => {
    try {
      const saved = await window.office.savePayment({
        id: p.id,
        customerId: p.customerId,
        dealId: p.dealId,
        amountCents: p.amountCents,
        due: p.due,
        reference: p.reference,
        method: p.method,
        owner: p.owner,
        state,
      })
      crmStore.put({ payments: [saved] })
      close()
      ctx.toast(done, 'ok')
    } catch (err) {
      form.set(crmError(err))
    }
  }
  const edit = h('button', { class: 'btn', type: 'button', disabled: status === 'paid' }, 'Editar')
  edit.addEventListener('click', () => {
    close()
    paymentForm(ctx, p)
  })
  const cancel =
    status === 'canceled'
      ? h('button', { class: 'btn', type: 'button', onclick: () => void setState('open', `Fatura ${p.invoice} reaberta.`) }, 'Reabrir')
      : status !== 'paid'
        ? h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                const ok = await confirmDialog(ctx.root, {
                  title: `Cancelar a fatura ${p.invoice}?`,
                  text: 'Ela sai de Próximos e Atrasados e fica no Histórico como cancelada. A cobrança dela para.',
                  confirm: 'Cancelar a fatura',
                  cancel: 'Manter',
                  danger: true,
                })
                if (ok) void setState('canceled', `Fatura ${p.invoice} cancelada.`)
              },
            },
            'Cancelar a fatura',
          )
        : null
  const remove = h(
    'button',
    {
      class: 'btn btn-danger crm-foot-left',
      type: 'button',
      onclick: async () => {
        const ok = await confirmDialog(ctx.root, {
          title: `Apagar a fatura ${p.invoice}?`,
          text: 'Ela some do CRM, do histórico e da linha do tempo do cliente. Para só parar a cobrança, cancele em vez de apagar.',
          confirm: 'Apagar',
          cancel: 'Manter',
          danger: true,
        })
        if (!ok) return
        try {
          await window.office.deletePayment(p.id)
          crmStore.put({ removed: { payments: [p.id] } })
          close()
          ctx.toast(`Fatura ${p.invoice} apagada.`, 'ok')
        } catch (err) {
          form.set(crmError(err))
        }
      },
    },
    'Apagar',
  )
  const el = crmModal(
    ctx.root,
    `Fatura ${p.invoice}`,
    [
      details,
      payable
        ? h('div', { class: 'crm-pay-box' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Pago em'), paidOn), pay)
        : status === 'paid'
          ? h('p', { class: 'field-hint' }, `Pago em ${brDate(p.paidOn)}.`)
          : null,
      c
        ? h(
            'button',
            { class: 'btn btn-small crm-link-btn', type: 'button', onclick: () => (close(), ctx.openCustomer(c.id)) },
            `Abrir a ficha de ${c.name}`,
          )
        : null,
      form.el,
    ].filter((x): x is HTMLElement => x !== null),
    [remove, cancel, edit, h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')].filter(
      (x): x is HTMLButtonElement => x !== null,
    ),
    close,
  )
  ;(payable ? pay : edit).focus()
}

// ---------- recorrência ----------

/** "Próximo: vence 20/12/2026 (dezembro)", or why there is none. */
function nextText(r: Recurrence): string {
  if (!r.active) return 'Pausada: não cria pagamentos.'
  const next = nextRecurrence(r, todayIso())
  return next ? `Próximo vencimento: ${brDate(next.due)}.` : 'Terminou: não há mais meses.'
}

export function recurrenceForm(ctx: CrmCtx, existing?: Recurrence, preset: { customerId?: string } = {}): void {
  const data = crmStore.data
  if (!data) return ctx.toast('Os dados do CRM ainda não chegaram. Espere um instante e tente de novo.', 'err')
  if (!data.customers.length) return ctx.toast('Crie um cliente primeiro: toda recorrência é de um cliente.', 'err')
  const r = existing
  const lead = data.settings.recurrenceLeadDays
  const customer = customerSelect(data.customers, r?.customerId ?? preset.customerId ?? '')
  const amount = moneyInput(r?.amountCents)
  const day = textInput(r ? String(r.day) : '', { type: 'number', min: 1, max: 31, step: 1, inputmode: 'numeric', placeholder: '20' })
  const reference = textInput(r?.reference ?? '', { maxlength: CRM_LIMITS.reference, placeholder: 'Ex.: Manutenção' })
  const method = selectInput(METHODS, r?.method ?? 'pix')
  const start = textInput(r?.start ?? currentMonth(), { type: 'month' })
  const end = textInput(r?.end ?? '', { type: 'month' })
  const active = h('input', { type: 'checkbox', checked: r ? r.active : true }) as HTMLInputElement
  const preview = h('p', { class: 'crm-preview', 'aria-live': 'polite' })
  const f = {
    customer: field('Cliente', customer),
    amount: field('Valor de cada mês', amount.el),
    day: field('Todo dia', day, 'De 1 a 31. Num mês mais curto, cai no último dia.'),
    reference: field('Referente a', reference, 'O mês entra sozinho: "Manutenção · novembro/2026".'),
    start: field('Primeiro mês', start),
    end: field('Último mês', end, 'Vazio: sem fim.'),
  }
  const form = formError()
  const draft = (): RecurrenceDraft => ({
    ...(r ? { id: r.id, dealId: r.dealId } : {}),
    customerId: customer.value,
    amountCents: amount.cents() ?? 0,
    day: Number(day.value),
    reference: reference.value.trim(),
    method: method.value as PaymentMethod,
    start: start.value,
    end: end.value || undefined,
    active: active.checked,
  })
  const syncPreview = () => {
    const d = draft()
    preview.textContent =
      d.amountCents > 0 && d.day >= 1 && d.day <= 31 && d.reference && d.start
        ? `${recurrenceLabel(d)}. O pagamento de cada mês aparece em Próximos ${lead} dias antes do vencimento.`
        : `Preencha o dia, o valor e a que se refere. O pagamento de cada mês aparece ${lead} dias antes do vencimento.`
  }
  for (const input of [customer, amount.el, day, reference, start, end]) input.addEventListener('input', syncPreview)
  amount.el.addEventListener('blur', syncPreview)
  syncPreview()

  const close = () => el.remove()
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, r ? 'Salvar' : 'Criar recorrência')
  save.addEventListener(
    'click',
    () =>
      void busy(save, async () => {
        form.set(null)
        for (const x of Object.values(f)) x.error(null)
        const d = draft()
        const bad = recurrenceDraftError(d)
        if (bad) {
          f[bad.field].error(bad.text)
          return ({ customer, amount: amount.el, day, reference, start, end } as Record<string, HTMLElement>)[bad.field]?.focus()
        }
        try {
          const saved = await window.office.saveRecurrence(d)
          crmStore.put({ recurrences: [saved] })
          close()
          ctx.toast(`Recorrência salva. ${nextText(saved)}`, 'ok')
        } catch (err) {
          fail(err, f, form)
        }
      }),
  )
  const remove = r
    ? h(
        'button',
        {
          class: 'btn btn-danger crm-foot-left',
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog(ctx.root, {
              title: 'Apagar a recorrência?',
              text: `${recurrenceLabel(r)}. Ela para de criar pagamentos; os que já foram criados ficam. Para parar por um tempo, desligue "Ligada" em vez de apagar.`,
              confirm: 'Apagar',
              cancel: 'Manter',
              danger: true,
            })
            if (!ok) return
            try {
              await window.office.deleteRecurrence(r.id)
              crmStore.put({ removed: { recurrences: [r.id] } })
              close()
              ctx.toast('Recorrência apagada. Os pagamentos já criados ficaram.', 'ok')
            } catch (err) {
              form.set(crmError(err))
            }
          },
        },
        'Apagar',
      )
    : null
  const el = crmModal(
    ctx.root,
    r ? 'Editar a recorrência' : 'Nova recorrência',
    [
      f.customer.el,
      h('div', { class: 'field-row' }, h('div', { class: 'crm-field-narrow' }, f.day.el), f.amount.el),
      f.reference.el,
      h('div', { class: 'field-row' }, f.start.el, f.end.el),
      h('div', { class: 'field-row' }, field('Método', method, METHOD_HINT).el),
      r
        ? h(
            'label',
            { class: 'check crm-check' },
            active,
            h('span', {}, 'Ligada', h('small', {}, 'Desligada, não cria os próximos pagamentos.')),
          )
        : null,
      preview,
      form.el,
    ].filter((x): x is HTMLElement => x !== null),
    [remove, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), save].filter(
      (x): x is HTMLButtonElement => x !== null,
    ),
    close,
  )
  ;(customer.value ? day : customer).focus()
}

/** "Recorrências": every rule, with the next due date; a click edits. */
export function recurrencesDialog(ctx: CrmCtx): void {
  const data = crmStore.data
  if (!data) return ctx.toast('Os dados do CRM ainda não chegaram. Espere um instante e tente de novo.', 'err')
  const customers = new Map(data.customers.map((c) => [c.id, c]))
  const list = [...data.recurrences].sort((a, b) => Number(b.active) - Number(a.active) || a.day - b.day)
  const close = () => el.remove()
  const body = list.length
    ? h(
        'ul',
        { class: 'crm-mini-list crm-rec-list' },
        ...list.map((r) => {
          const c = customers.get(r.customerId)
          return h(
            'li',
            {},
            h(
              'button',
              { type: 'button', class: 'crm-mini', onclick: () => (close(), recurrenceForm(ctx, r)) },
              h('span', { class: 'crm-mini-main' }, c ? customerTitle(c) : 'Cliente removido'),
              h('span', { class: 'crm-mini-meta' }, `${recurrenceLabel(r)} · ${nextText(r)}`),
            ),
          )
        }),
      )
    : h(
        'p',
        { class: 'field-hint' },
        'Nenhuma recorrência. Crie uma para o pagamento de todo mês entrar sozinho, por exemplo "todo dia 20, R$ 480, Manutenção".',
      )
  const add = h(
    'button',
    { class: 'btn btn-primary', type: 'button', onclick: () => (close(), recurrenceForm(ctx)) },
    icon('plus', 15),
    'Nova recorrência',
  )
  const el = crmModal(
    ctx.root,
    'Recorrências',
    [body],
    [h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar'), add],
    close,
    true,
  )
  ;(el.querySelector<HTMLElement>('.crm-mini') ?? add).focus()
}
