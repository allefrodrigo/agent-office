import { formatPhone, normalizePhone } from '@shared/crm'
import {
  brDateOf,
  customerTitle,
  customerToDraft,
  dealTicketDraft,
  dealToDraft,
  fieldOfError,
  importButtonLabel,
  importRequest,
  importStats,
  pipelineOf,
  splitList,
  stageName,
} from '@shared/crm-view'
import {
  CRM_LIMITS,
  type Customer,
  type CustomerDraft,
  type CustomerImportPreview,
  type Deal,
  type DealDraft,
  type ImportChoice,
} from '@shared/types'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import { busy, crmModal, customerSelect, field, floorSelect, formError, moneyInput, selectInput, textInput, type Field } from './fields'
import { crmStore } from './store'
import { crmError, floorProject, type CrmCtx } from './util'

// Formulários de Clientes e Negócios (CR-05): cliente, negócio (com os tickets ligados e "Criar
// ticket") e a prévia da importação de CSV.

/** The error of the main process goes to its field; the rest above the buttons. */
function showError(err: unknown, fields: Partial<Record<string, Field>>, form: ReturnType<typeof formError>): void {
  const text = crmError(err)
  const f = fieldOfError(text)
  const target = f ? fields[f] : undefined
  if (target) {
    target.error(text)
    form.set(null)
  } else form.set(text)
}

/** "(11) 98765-4321, +1 415 555 0100" → the digits of each, or the first one it did not understand. */
function readPhones(text: string): { phones: string[]; bad?: string } {
  const phones: string[] = []
  for (const raw of splitList(text, CRM_LIMITS.phones, 40)) {
    const n = normalizePhone(raw)
    if (!n) return { phones, bad: raw }
    if (!phones.includes(n)) phones.push(n)
  }
  return { phones }
}

const phoneHelp = (raw: string) =>
  `Não reconheci o telefone "${raw}". Escreva com o DDD, por exemplo (11) 98765-4321; de fora do Brasil, comece com + e o código do país.`

// ---------- cliente ----------

export function customerForm(ctx: CrmCtx, existing?: Customer, onSaved?: (c: Customer) => void): void {
  const c = existing
  const kind = selectInput(
    [
      { value: 'person', label: 'Pessoa' },
      { value: 'company', label: 'Empresa' },
    ],
    c?.kind ?? 'person',
  )
  const name = textInput(c?.name ?? '', { maxlength: CRM_LIMITS.name, placeholder: 'Ex.: Maria Souza', autocomplete: 'off' })
  const company = textInput(c?.company ?? '', { maxlength: CRM_LIMITS.company, placeholder: 'Ex.: Padaria Trigo', autocomplete: 'off' })
  const phones = textInput(c ? c.phones.map(formatPhone).join(', ') : '', {
    placeholder: '(11) 98765-4321',
    inputmode: 'tel',
    autocomplete: 'off',
  })
  const email = textInput(c?.email ?? '', { type: 'email', maxlength: CRM_LIMITS.email, placeholder: 'maria@padariatrigo.com.br' })
  const tags = textInput(c?.tags.join(', ') ?? '', { placeholder: 'site, manutenção' })
  const owner = textInput(c?.owner ?? '', { maxlength: CRM_LIMITS.owner, placeholder: 'Quem cuida deste cliente' })
  const floor = floorSelect(ctx.state, c?.floor)
  const nextStep = textInput(c?.nextStep ?? '', { maxlength: CRM_LIMITS.nextStep, placeholder: 'Ex.: Mandar a proposta' })
  const nextStepOn = textInput(c?.nextStepOn ?? '', { type: 'date' })
  const lastContact = textInput(c?.lastContactAt ? new Date(c.lastContactAt).toLocaleDateString('sv-SE') : '', { type: 'date' })
  const service = h('input', { type: 'checkbox', checked: c ? c.consent.service : true }) as HTMLInputElement
  const billing = h('input', { type: 'checkbox', checked: c ? c.consent.billing : true }) as HTMLInputElement
  const offers = h('input', { type: 'checkbox', checked: c ? c.consent.offers && !c.consent.optOutAt : false }) as HTMLInputElement
  const source = textInput(c?.consent.offersSource ?? '', {
    maxlength: CRM_LIMITS.consentSource,
    placeholder: 'Como aceitou: "pediu por WhatsApp em 12/11", "formulário do site"',
  })

  const f = {
    name: field('Nome', name),
    company: field('Empresa', company),
    phones: field('Telefones', phones, 'O primeiro é o do WhatsApp. Separe vários com vírgula.'),
    email: field('E-mail', email),
    source: field('Origem do consentimento', source, 'A LGPD pede de onde veio o sim. Guarde a data e o canal.'),
  }
  const form = formError()
  phones.addEventListener('blur', () => {
    const read = readPhones(phones.value)
    if (read.bad) return f.phones.error(phoneHelp(read.bad))
    f.phones.error(null)
    phones.value = read.phones.map(formatPhone).join(', ')
  })
  name.addEventListener('input', () => f.name.error(null))
  const syncSource = () => (source.disabled = !offers.checked)
  offers.addEventListener('change', syncSource)
  syncSource()

  const optOut = c?.consent.optOutAt
  const close = () => el.remove()
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, c ? 'Salvar' : 'Criar cliente')
  save.addEventListener(
    'click',
    () =>
      void busy(save, async () => {
        form.set(null)
        for (const x of Object.values(f)) x.error(null)
        if (!name.value.trim()) {
          f.name.error('Escreva o nome do cliente.')
          return name.focus()
        }
        const read = readPhones(phones.value)
        if (read.bad) {
          f.phones.error(phoneHelp(read.bad))
          return phones.focus()
        }
        let clearOptOut = false
        if (offers.checked && optOut) {
          const ok = await confirmDialog(ctx.root, {
            title: 'Religar as ofertas?',
            text: `${c ? customerTitle(c) : 'O cliente'} pediu para sair das ofertas em ${brDateOf(optOut)}. Religue só se ele pediu de novo, e anote como pediu em "Origem do consentimento".`,
            warn: 'Mandar oferta para quem pediu para sair pode bloquear o número e fere a LGPD.',
            confirm: 'Religar ofertas',
            cancel: 'Deixar desligado',
            danger: true,
          })
          if (!ok) {
            offers.checked = false
            syncSource()
            return
          }
          if (!source.value.trim()) {
            f.source.error('Diga como o cliente pediu para voltar a receber ofertas.')
            return source.focus()
          }
          clearOptOut = true
        }
        const base: CustomerDraft = c ? customerToDraft(c) : { name: '' }
        const draft: CustomerDraft = {
          ...base,
          kind: kind.value === 'company' ? 'company' : 'person',
          name: name.value.trim(),
          company: company.value.trim() || undefined,
          phones: read.phones,
          email: email.value.trim() || undefined,
          tags: splitList(tags.value),
          owner: owner.value.trim() || undefined,
          floor: floor.value || undefined,
          nextStep: nextStep.value.trim() || undefined,
          nextStepOn: nextStepOn.value || undefined,
          lastContactAt: lastContact.value ? new Date(`${lastContact.value}T12:00:00`).getTime() : undefined,
          consent: {
            service: service.checked,
            billing: billing.checked,
            offers: offers.checked,
            offersSource: source.value.trim() || undefined,
            ...(clearOptOut ? { clearOptOut } : {}),
          },
        }
        try {
          const saved = await window.office.saveCustomer(draft)
          crmStore.put({ customers: [saved] })
          close()
          ctx.toast(c ? `${saved.name} foi salvo.` : `${saved.name} entrou no CRM.`, 'ok')
          onSaved?.(saved)
        } catch (err) {
          showError(err, f, form)
        }
      }),
  )
  const check = (box: HTMLInputElement, label: string, hint: string) =>
    h('label', { class: 'check crm-check' }, box, h('span', {}, label, h('small', {}, hint)))
  const el = crmModal(
    ctx.root,
    c ? `Editar ${c.name}` : 'Novo cliente',
    [
      h(
        'div',
        { class: 'field-row' },
        h('label', { class: 'field crm-field-narrow' }, h('span', { class: 'field-label' }, 'Tipo'), kind),
        f.name.el,
      ),
      f.company.el,
      h('div', { class: 'field-row' }, f.phones.el, f.email.el),
      h('div', { class: 'field-row' }, field('Etiquetas', tags, 'Separe com vírgula.').el, field('Responsável', owner).el),
      h(
        'div',
        { class: 'field-row' },
        field('Próximo passo', nextStep).el,
        h('label', { class: 'field crm-field-narrow' }, h('span', { class: 'field-label' }, 'Até'), nextStepOn),
      ),
      h(
        'div',
        { class: 'field-row' },
        field('Andar', floor, 'O projeto do escritório ligado a este cliente.').el,
        field('Último contato', lastContact).el,
      ),
      h(
        'fieldset',
        { class: 'crm-fieldset' },
        h('legend', {}, 'Permissões de contato'),
        check(service, 'Atendimento', 'Responder quem escreveu.'),
        check(billing, 'Cobrança', 'Lembrar pagamentos em aberto.'),
        check(offers, 'Ofertas', optOut ? `Pediu para sair em ${brDateOf(optOut)}.` : 'Só com o sim do cliente.'),
        f.source.el,
      ),
      form.el,
    ],
    [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), save],
    close,
    true,
  )
  name.focus()
}

// ---------- negócio ----------

export interface DealFormPreset {
  customerId?: string
  stageId?: string
}

export function dealForm(ctx: CrmCtx, existing?: Deal, preset: DealFormPreset = {}): void {
  const data = crmStore.data
  if (!data) return ctx.toast('Os dados do CRM ainda não chegaram. Espere um instante e tente de novo.', 'err')
  if (!data.customers.length) return ctx.toast('Crie um cliente primeiro: todo negócio é de um cliente.', 'err')
  const d = existing
  const pipeline = pipelineOf(data.pipelines, d?.pipelineId)
  const customer = customerSelect(data.customers, d?.customerId ?? preset.customerId ?? '')
  const title = textInput(d?.title ?? '', {
    maxlength: CRM_LIMITS.title,
    placeholder: 'Ex.: Site institucional, Manutenção mensal',
    autocomplete: 'off',
  })
  const value = moneyInput(d?.valueCents)
  const stage = selectInput(
    pipeline.stages.map((s) => ({ value: s.id, label: s.name })),
    d?.stageId ?? preset.stageId ?? pipeline.stages[0]?.id ?? '',
  )
  const nextStep = textInput(d?.nextStep ?? '', { maxlength: CRM_LIMITS.nextStep, placeholder: 'Ex.: Ligar na sexta' })
  const nextStepOn = textInput(d?.nextStepOn ?? '', { type: 'date' })
  const floor = floorSelect(
    ctx.state,
    d?.floor ?? (preset.customerId ? data.customers.find((c) => c.id === preset.customerId)?.floor : undefined),
  )
  const f = { customer: field('Cliente', customer), title: field('Serviço', title), amount: field('Valor', value.el) }
  const form = formError()
  let tickets = [...(d?.tickets ?? [])]

  // tickets: what is linked, link one that exists, or create one with the deal's context
  const ticketList = h('ul', { class: 'crm-ticket-list' })
  const pick = h('select', { class: 'input', 'aria-label': 'Ticket do quadro para ligar' })
  const link = h('button', { class: 'btn btn-small', type: 'button' }, 'Ligar')
  const create = h('button', { class: 'btn btn-small', type: 'button' }, icon('plus', 14), 'Criar ticket')
  const current = (): Deal | undefined => (d ? (crmStore.data?.deals.find((x) => x.id === d.id) ?? d) : undefined)

  async function saveTickets(next: string[]): Promise<boolean> {
    const deal = current()
    if (!deal) return false
    try {
      const saved = await window.office.saveDeal({ ...dealToDraft(deal), tickets: next })
      crmStore.put({ deals: [saved] })
      tickets = [...saved.tickets]
      renderTickets()
      return true
    } catch (err) {
      form.set(crmError(err))
      return false
    }
  }

  function renderTickets(): void {
    const all = ctx.state.tickets
    ticketList.replaceChildren(
      ...(tickets.length
        ? tickets.map((id) => {
            const t = all.get(id)
            const open = h('button', { class: 'btn btn-small', type: 'button', disabled: !t }, 'Abrir no quadro')
            open.addEventListener('click', () => {
              close()
              ctx.openTicket(id)
            })
            const unlink = h(
              'button',
              { class: 'btn btn-small crm-btn-quiet', type: 'button', 'aria-label': `Desligar ${t?.key ?? 'o ticket'} do negócio` },
              'Desligar',
            )
            unlink.addEventListener('click', () => void busy(unlink, () => saveTickets(tickets.filter((x) => x !== id))))
            return h(
              'li',
              { class: 'crm-ticket' },
              h('span', { class: 'crm-ticket-key' }, t?.key ?? '—'),
              h('span', { class: 'crm-ticket-title' }, t ? t.title : 'Ticket fechado ou apagado'),
              open,
              unlink,
            )
          })
        : [h('li', { class: 'crm-ticket-none' }, 'Nenhum ticket ligado.')]),
    )
    const cwd = floorProject(ctx.state, floor.value)?.cwd
    const choices = [...all.values()]
      .filter((t) => !tickets.includes(t.id) && (!cwd || (t.cwd ?? '').startsWith(cwd)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 300)
    pick.replaceChildren(
      h('option', { value: '' }, choices.length ? 'Escolha um ticket do quadro' : 'Nenhum ticket para ligar'),
      ...choices.map((t) => h('option', { value: t.id }, `${t.key} · ${t.title}`)),
    )
    pick.disabled = !choices.length
    link.disabled = !choices.length
  }

  link.addEventListener(
    'click',
    () =>
      void busy(link, async () => {
        if (!pick.value) return pick.focus()
        if (tickets.length >= CRM_LIMITS.tickets) return form.set(`Um negócio liga até ${CRM_LIMITS.tickets} tickets. Desligue um antes.`)
        const id = pick.value
        if (await saveTickets([...tickets, id])) ctx.toast(`${ctx.state.tickets.get(id)?.key ?? 'O ticket'} foi ligado ao negócio.`, 'ok')
      }),
  )
  create.addEventListener(
    'click',
    () =>
      void busy(create, async () => {
        const deal = current()
        if (!deal) return
        const who = crmStore.data?.customers.find((c) => c.id === deal.customerId)
        const cwd = floorProject(ctx.state, deal.floor)?.cwd
        try {
          const t = await window.office.createTicket(
            dealTicketDraft(deal, who, stageName(data.pipelines, deal.pipelineId, deal.stageId), cwd),
          )
          if (await saveTickets([...tickets, t.id])) ctx.toast(`${t.key} foi criado${cwd ? '' : ' no térreo'} e ligado ao negócio.`, 'ok')
        } catch (err) {
          form.set(crmError(err))
        }
      }),
  )
  floor.addEventListener('change', renderTickets)
  if (d) renderTickets()

  const close = () => el.remove()
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, d ? 'Salvar' : 'Criar negócio')
  save.addEventListener(
    'click',
    () =>
      void busy(save, async () => {
        form.set(null)
        for (const x of Object.values(f)) x.error(null)
        if (!customer.value) {
          f.customer.error('Escolha o cliente do negócio.')
          return customer.focus()
        }
        if (!title.value.trim()) {
          f.title.error('Diga o serviço, por exemplo "Site institucional".')
          return title.focus()
        }
        const cents = value.cents()
        if (value.el.value.trim() && cents === null) {
          f.amount.error('Não entendi o valor. Escreva só o número, por exemplo 4800 ou 4.800,00.')
          return value.el.focus()
        }
        const draft: DealDraft = {
          ...(current() ? dealToDraft(current()!) : {}),
          customerId: customer.value,
          title: title.value.trim(),
          valueCents: cents ?? 0,
          pipelineId: pipeline.id,
          stageId: stage.value,
          nextStep: nextStep.value.trim() || undefined,
          nextStepOn: nextStepOn.value || undefined,
          floor: floor.value || undefined,
          tickets,
        }
        try {
          const saved = await window.office.saveDeal(draft)
          crmStore.put({ deals: [saved] })
          close()
          ctx.toast(d ? `${saved.title} foi salvo.` : `${saved.title} entrou no funil.`, 'ok')
        } catch (err) {
          showError(err, f, form)
        }
      }),
  )
  const remove = d
    ? h(
        'button',
        {
          class: 'btn btn-danger crm-foot-left',
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog(ctx.root, {
              title: 'Apagar o negócio?',
              text: `${d.title} sai do funil, com o histórico de etapas. Os tickets ligados ficam no quadro.`,
              confirm: 'Apagar negócio',
              cancel: 'Manter',
              danger: true,
            })
            if (!ok) return
            try {
              await window.office.deleteDeal(d.id)
              crmStore.put({ removed: { deals: [d.id] } })
              close()
              ctx.toast(`${d.title} foi apagado.`, 'ok')
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
    d ? `Negócio: ${d.title}` : 'Novo negócio',
    [
      f.customer.el,
      h('div', { class: 'field-row' }, f.title.el, h('div', { class: 'crm-field-narrow' }, f.amount.el)),
      h(
        'div',
        { class: 'field-row' },
        field('Etapa', stage).el,
        field('Andar', floor, '"Criar ticket" abre o ticket na pasta deste andar.').el,
      ),
      h(
        'div',
        { class: 'field-row' },
        field('Próximo passo', nextStep).el,
        h('label', { class: 'field crm-field-narrow' }, h('span', { class: 'field-label' }, 'Até'), nextStepOn),
      ),
      d
        ? h(
            'section',
            { class: 'crm-fieldset' },
            h('h3', { class: 'crm-sub' }, 'Tickets ligados'),
            ticketList,
            h('div', { class: 'crm-inline' }, pick, link, create),
          )
        : h('p', { class: 'field-hint' }, 'Depois de criar o negócio, ligue tickets do quadro ou crie um com o contexto dele.'),
      form.el,
    ],
    [remove, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), save].filter(
      (b): b is HTMLButtonElement => b !== null,
    ),
    close,
    true,
  )
  ;(d ? title : customer.value ? title : customer).focus()
}

// ---------- importar CSV ----------

export async function importCustomers(ctx: CrmCtx): Promise<void> {
  let preview: CustomerImportPreview | null
  try {
    preview = await window.office.pickCustomersCsv()
  } catch (err) {
    return ctx.toast(crmError(err), 'err')
  }
  if (!preview) return
  const rows = preview.rows
  if (!rows.length)
    return ctx.toast(
      `${preview.file} não tem linhas de clientes. Confira se a primeira linha tem os nomes das colunas (nome, telefone…).`,
      'err',
    )
  const choices = new Map<number, ImportChoice>()
  const stats = importStats(rows)
  const customers = new Map((crmStore.data?.customers ?? []).map((c) => [c.id, c]))
  const attention = rows.filter((r) => r.error || r.conflictWith)
  const go = h('button', { class: 'btn btn-primary', type: 'button' })
  const sync = () => {
    go.textContent = importButtonLabel(rows, choices)
    go.disabled = importRequest(rows, choices).every((r) => r.onConflict === 'skip')
  }
  const table = h(
    'table',
    { class: 'crm-import-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, 'Linha'),
        h('th', { scope: 'col' }, 'Cliente'),
        h('th', { scope: 'col' }, 'O que houve'),
        h('th', { scope: 'col' }, 'Fazer'),
      ),
    ),
    h(
      'tbody',
      {},
      ...attention.map((r) => {
        const who = r.draft.name || '(sem nome)'
        let action: HTMLElement
        let what: string
        if (r.error) {
          what = r.error
          action = h('span', { class: 'crm-import-skip' }, 'Fica de fora')
        } else {
          const other = customers.get(r.conflictWith!)
          what = `O telefone já é de ${other ? customerTitle(other) : 'outro cliente'}.`
          const sel = selectInput(
            [
              { value: 'skip', label: 'Pular' },
              { value: 'update', label: 'Atualizar' },
            ],
            'skip',
          )
          sel.setAttribute('aria-label', `Linha ${r.line}, ${who}: pular ou atualizar`)
          sel.addEventListener('change', () => {
            choices.set(r.line, sel.value === 'update' ? 'update' : 'skip')
            sync()
          })
          action = sel
        }
        return h(
          'tr',
          { class: r.error ? 'err' : 'conflict' },
          h('td', {}, String(r.line)),
          h('td', {}, who),
          h('td', {}, what),
          h('td', {}, action),
        )
      }),
    ),
  )
  const close = () => el.remove()
  go.addEventListener(
    'click',
    () =>
      void busy(go, async () => {
        try {
          const res = await window.office.importCustomersCsv(importRequest(rows, choices))
          close()
          const parts = [
            res.created ? `${res.created} criados` : '',
            res.updated ? `${res.updated} atualizados` : '',
            res.skipped ? `${res.skipped} pulados` : '',
          ].filter(Boolean)
          ctx.toast(`Importação de ${preview!.file}: ${parts.join(', ') || 'nada mudou'}.`, 'ok')
        } catch (err) {
          ctx.toast(crmError(err), 'err')
        }
      }),
  )
  sync()
  const el = crmModal(
    ctx.root,
    `Importar ${preview.file}`,
    [
      h(
        'p',
        { class: 'crm-import-sum' },
        `${stats.fresh} ${stats.fresh === 1 ? 'cliente novo' : 'clientes novos'} · ${stats.conflicts} com telefone que já existe · ${stats.errors} com erro`,
      ),
      h('p', { class: 'field-hint' }, 'Os clientes chegam sem permissão de oferta: ligue à mão, na ficha, quem aceitou.'),
      attention.length
        ? h('div', { class: 'crm-import-scroll' }, table)
        : h('p', { class: 'field-hint' }, 'Nenhuma linha com erro ou conflito.'),
    ],
    [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), go],
    close,
    true,
  )
  go.focus()
}
