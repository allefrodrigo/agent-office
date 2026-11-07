import { actionToDraft } from '@shared/meetings'
import { PRIORITIES, STATUSES } from '@shared/tickets'
import {
  agentChoices,
  actionBlocks,
  draftToForm,
  formToDraft,
  needsFloorPick,
  splitQuote,
  ticketChip,
  type AgentChoice,
} from '@shared/meetings-view'
import type { AtaBlock, MeetingDetail, MeetingTicketResult, ProjectFloor, TicketPriority, TicketStatus } from '@shared/types'
import { h, icon } from '../dom'
import { renderMarkdown } from '../markdown'
import { cleanError, field, modal } from '../modals'
import type { MeetingViewCtx } from './ctx'
import { modalRoot, office } from './office'

// RN-18: itens de ação viram tickets (prévia editável) ou vão a um agente do andar. Nada é criado
// sem o clique da pessoa; a citação da reunião o main refaz ao criar.

/** Colunas da prévia: um item novo não nasce Feito. */
const COLUMNS = STATUSES.filter((s) => s.value !== 'done')

export interface ActionsOpts {
  /** O texto do item, já com o clique para editar (da ata). */
  text(block: AtaBlock): HTMLElement
  /** Um ticket foi criado: a ata atualizou o bloco. */
  created(result: MeetingTicketResult): void
}

/** A seção "Itens de ação" da ata. */
export function actionsSection(detail: MeetingDetail, ctx: MeetingViewCtx, opts: ActionsOpts): HTMLElement | null {
  const items = actionBlocks(detail.ata)
  if (!items.length) return null
  const open = items.filter((b) => !b.ticket)
  return h(
    'section',
    { class: 'mt-actions', 'aria-label': 'Itens de ação' },
    h(
      'div',
      { class: 'mt-actions-head' },
      h('h3', { class: 'mt-actions-title' }, `Itens de ação · ${items.length}`),
      open.length > 1
        ? h(
            'button',
            { class: 'btn btn-small', type: 'button', onclick: () => openCreateAll(detail, ctx, opts.created) },
            icon('list', 14),
            'Criar todos',
          )
        : null,
    ),
    h('ul', { class: 'mt-action-list' }, ...items.map((b) => actionRow(detail, b, ctx, opts))),
  )
}

function actionRow(detail: MeetingDetail, b: AtaBlock, ctx: MeetingViewCtx, opts: ActionsOpts): HTMLElement {
  const meta = [
    b.owner ? h('span', { class: 'mt-action-meta' }, icon('users', 12), b.owner) : null,
    b.due ? h('span', { class: 'mt-action-meta' }, icon('history', 12), b.due) : null,
  ]
  const ticket = b.ticket
    ? h(
        'span',
        { class: 'mt-ticket-chip', title: 'Ticket criado a partir deste item' },
        icon('kanban', 12),
        ticketChip(b.ticket, office.tickets.get(b.ticket)?.status),
      )
    : null
  const buttons = b.ticket
    ? null
    : h(
        'div',
        { class: 'mt-action-btns' },
        h(
          'button',
          { class: 'btn btn-small', type: 'button', onclick: () => openTicketPreview(detail, b, ctx, 'ticket', opts.created) },
          icon('plus', 13),
          'Criar ticket',
        ),
        h(
          'button',
          { class: 'btn btn-small', type: 'button', onclick: () => openTicketPreview(detail, b, ctx, 'agent', opts.created) },
          icon('walk', 13),
          'Entregar a um agente',
        ),
      )
  return h(
    'li',
    { class: `mt-action mt-block-${b.origin}` },
    h('span', { class: 'mt-action-box', 'aria-hidden': 'true' }, b.ticket ? icon('check', 12) : null),
    h('div', { class: 'mt-action-main' }, opts.text(b), h('div', { class: 'mt-action-foot' }, ...meta, ticket, buttons)),
  )
}

/** Os andares de projeto, para o ticket de uma reunião do térreo. */
function projectFloors(): ProjectFloor[] {
  return office.projects
}

function floorSelect(projects: ProjectFloor[]): HTMLSelectElement {
  const s = h(
    'select',
    { class: 'input' },
    h('option', { value: '' }, 'Escolha o andar'),
    ...projects.map((p) => h('option', { value: p.id }, p.name)),
  )
  if (projects.length === 1) s.value = projects[0].id
  return s
}

/** A escolha do agente: os que não podem aparecem desabilitados, com o motivo. */
function agentSelect(choices: AgentChoice[], placeholder: string): HTMLSelectElement {
  const s = h(
    'select',
    { class: 'input' },
    h('option', { value: '' }, placeholder),
    ...choices.map((c) =>
      h(
        'option',
        { value: c.agent.id, disabled: !!c.reason },
        `${c.agent.name}${c.reason ? ` · ${c.reason}` : c.note ? ` · ${c.note}` : ''}`,
      ),
    ),
  )
  const free = choices.filter((c) => !c.reason)
  if (free.length === 1) s.value = free[0].agent.id
  return s
}

/**
 * A prévia de um item: título, descrição, critérios, prioridade e coluna, editáveis; a citação da
 * reunião só de leitura. Térreo pede o andar. `agent` pede também o agente e entrega ao criar.
 */
export function openTicketPreview(
  detail: MeetingDetail,
  block: AtaBlock,
  ctx: MeetingViewCtx,
  mode: 'ticket' | 'agent',
  created: (r: MeetingTicketResult) => void,
): void {
  void office.ready().catch(() => undefined)
  const base = actionToDraft(detail.meeting, block, detail.segments)
  const form = draftToForm(base)
  const { own, quote } = splitQuote(form.description)

  const title = h('input', { class: 'input', maxlength: 160, spellcheck: 'false' }) as HTMLInputElement
  title.value = form.title
  const desc = h('textarea', { class: 'input', rows: 4 }) as HTMLTextAreaElement
  desc.value = own
  const crit = h('textarea', { class: 'input', rows: 4, placeholder: 'Um critério verificável por linha' }) as HTMLTextAreaElement
  crit.value = form.criteria
  const prio = h('select', { class: 'input' }, ...PRIORITIES.map((p) => h('option', { value: p.value }, p.label)))
  prio.value = form.priority
  const col = h('select', { class: 'input' }, ...COLUMNS.map((c) => h('option', { value: c.value }, c.label)))
  col.value = form.status

  const ground = needsFloorPick(detail.meeting.floor)
  const floors = ground ? floorSelect(projectFloors()) : null
  const ticketFloor = () => (ground ? (floors?.value ?? '') : detail.meeting.floor)
  const floorCwd = () => office.projects.find((p) => p.id === ticketFloor())?.cwd

  const agentSlot = h('div', { class: 'mt-agent-slot' })
  let agent: HTMLSelectElement | null = null
  const ok = h(
    'button',
    { class: 'btn btn-primary', type: 'button' },
    mode === 'agent' ? icon('walk', 15) : icon('plus', 15),
    mode === 'agent' ? 'Criar e entregar' : 'Criar ticket',
  )
  const sync = () => {
    if (mode === 'agent') {
      const floor = ticketFloor()
      const choices = floor ? agentChoices(office.agents.values(), floor, 'delegate', floorCwd()) : []
      const was = agent?.value
      agent = agentSelect(choices, choices.some((c) => !c.reason) ? 'Escolha o agente' : 'Nenhum agente livre')
      if (was && choices.some((c) => c.agent.id === was && !c.reason)) agent.value = was
      agent.addEventListener('change', sync)
      const hint = !floor
        ? 'Escolha o andar para ver os agentes.'
        : choices.length
          ? 'Ele recebe o ticket, que vai para Fazendo; o relatório volta como comentário e o ticket vai para Revisão.'
          : 'Nenhum agente do escritório neste andar. Contrate um pelo quadro ou crie só o ticket.'
      agentSlot.replaceChildren(field('Agente', agent, hint))
    }
    const ready = !!ticketFloor() && (mode === 'ticket' || !!agent?.value)
    ok.toggleAttribute('disabled', !ready)
  }
  floors?.addEventListener('change', sync)
  const stopMirror = office.on(sync)

  const close = () => {
    stopMirror()
    el.remove()
  }
  ok.addEventListener('click', async () => {
    ok.setAttribute('disabled', '')
    const draft = formToDraft(
      {
        title: title.value,
        description: desc.value,
        criteria: crit.value,
        priority: prio.value as TicketPriority,
        status: col.value as TicketStatus,
      },
      base,
    )
    try {
      const r = await window.office.meetingTicket({
        id: detail.meeting.id,
        blockId: block.id,
        draft,
        ...(mode === 'agent' && agent?.value ? { agentId: agent.value } : {}),
        ...(ground ? { floor: ticketFloor() } : {}),
      })
      close()
      created(r)
      const who = mode === 'agent' && agent ? office.agents.get(agent.value)?.name : undefined
      ctx.toast(r.delegateError ?? (r.delegated && who ? `${who} pegou o ${r.ticket.key}.` : `${r.ticket.key} criado no quadro.`))
      void ctx.refresh()
    } catch (err) {
      ctx.toast(cleanError(err))
      ok.removeAttribute('disabled')
    }
  })

  const body = [
    field('Título', title, 'No imperativo, como no quadro.'),
    h('div', { class: 'mt-preview-grid' }, field('Prioridade', prio), field('Coluna', col), floors ? field('Andar', floors) : null),
    field('Descrição', desc),
    quote
      ? h(
          'div',
          { class: 'mt-quote' },
          h('div', { class: 'mt-quote-label' }, 'Vai junto, como está (o app refaz ao criar):'),
          renderMarkdown(quote),
        )
      : null,
    field('Critérios de aceite', crit),
    agentSlot,
  ].filter((x): x is HTMLElement => !!x)
  const el = modal(
    mode === 'agent' ? 'Entregar a um agente' : 'Criar ticket',
    body,
    [h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'), ok],
    close,
  )
  el.classList.add('backdrop-meeting')
  modalRoot().append(el)
  sync()
  title.focus()
}

/**
 * "Criar todos": a prévia em lista dos itens sem ticket, todos marcados; a pessoa desmarca o que
 * não quer e edita os títulos. Cria um por um e diz o que falhou.
 */
export function openCreateAll(
  detail: MeetingDetail,
  ctx: MeetingViewCtx,
  created: (r: MeetingTicketResult) => void = () => undefined,
): void {
  void office.ready().catch(() => undefined)
  const items = actionBlocks(detail.ata).filter((b) => !b.ticket)
  if (!items.length) {
    ctx.toast(
      detail.ata ? 'Todos os itens de ação já viraram tickets.' : 'Esta reunião ainda não tem ata. Gere a ata para ver os itens de ação.',
    )
    return
  }
  const rows = items.map((b) => {
    const base = actionToDraft(detail.meeting, b, detail.segments)
    const check = h('input', { type: 'checkbox', 'aria-label': 'Criar este ticket' }) as HTMLInputElement
    check.checked = true
    const title = h('input', { class: 'input', maxlength: 160, spellcheck: 'false', 'aria-label': 'Título do ticket' }) as HTMLInputElement
    title.value = base.title
    const status = h('span', { class: 'mt-all-status', role: 'status' })
    const meta = [b.owner, b.due].filter(Boolean).join(' · ')
    const row = h(
      'li',
      { class: 'mt-all-row' },
      check,
      h('div', { class: 'mt-all-main' }, title, meta ? h('span', { class: 'field-hint' }, meta) : null, status),
    )
    check.addEventListener('change', () => {
      row.classList.toggle('off', !check.checked)
      count()
    })
    return { b, base, check, title, status, row, done: false }
  })
  const col = h('select', { class: 'input' }, ...COLUMNS.map((c) => h('option', { value: c.value }, c.label)))
  col.value = 'todo'
  const ground = needsFloorPick(detail.meeting.floor)
  const floors = ground ? floorSelect(projectFloors()) : null

  const ok = h('button', { class: 'btn btn-primary', type: 'button' })
  function count(): void {
    const n = rows.filter((r) => r.check.checked && !r.done).length
    ok.replaceChildren(icon('plus', 15), n === 1 ? 'Criar 1 ticket' : `Criar ${n} tickets`)
    ok.toggleAttribute('disabled', !n || (ground && !floors?.value))
  }
  floors?.addEventListener('change', count)
  const close = () => el.remove()
  ok.addEventListener('click', async () => {
    ok.setAttribute('disabled', '')
    let made = 0
    let failed = 0
    for (const r of rows) {
      if (!r.check.checked || r.done) continue
      r.status.textContent = 'Criando…'
      try {
        const form = draftToForm(r.base)
        const draft = formToDraft(
          { ...form, title: r.title.value, description: splitQuote(form.description).own, status: col.value as TicketStatus },
          r.base,
        )
        const res = await window.office.meetingTicket({
          id: detail.meeting.id,
          blockId: r.b.id,
          draft,
          ...(ground ? { floor: floors?.value ?? '' } : {}),
        })
        r.done = true
        r.check.disabled = true
        r.title.disabled = true
        r.status.textContent = ticketChip(res.ticket.key, res.ticket.status)
        made++
        created(res)
      } catch (err) {
        r.status.textContent = cleanError(err)
        r.status.classList.add('err')
        failed++
      }
    }
    void ctx.refresh()
    if (!failed) {
      close()
      ctx.toast(made === 1 ? '1 ticket criado no quadro.' : `${made} tickets criados no quadro.`)
    } else {
      ctx.toast(`${made} criados, ${failed} com erro. Veja o motivo em cada item.`)
      count()
    }
  })

  const body = [
    h(
      'div',
      { class: 'field-hint' },
      'Desmarque o que não quer. Cada ticket leva a citação da reunião e a tag reuniao; abra-o no quadro para editar o resto.',
    ),
    h('div', { class: 'mt-preview-grid' }, field('Coluna', col), floors ? field('Andar', floors) : null),
    h('ul', { class: 'mt-all-list' }, ...rows.map((r) => r.row)),
  ]
  const el = modal(
    'Criar tickets dos itens de ação',
    body,
    [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'), ok],
    close,
  )
  el.classList.add('backdrop-meeting')
  modalRoot().append(el)
  count()
}
