import { labelOf, PRIORITIES, STATUSES, ticketBrief, TYPES } from '@shared/tickets'
import type { Actor, AgentSummary, OfficePermissionMode, Ticket, TicketPatch, TicketPriority, TicketStatus, TicketType } from '@shared/types'
import type { State } from '../state'
import { h, icon, timeAgo } from './dom'
import { STATUS_LABEL } from './hud'
import { renderMarkdown } from './markdown'
import { cleanError, confirmDialog, field, LAST_CWD, modal } from './modals'
import { portrait } from './portrait'

export interface BoardActions {
  openAgent(id: string): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
}

type Who = 'all' | 'me' | 'agents' | 'none'

/** "Sem pedir nada" is left out on purpose: a ticket may come from someone else. */
const DELEGATE_MODES: { value: OfficePermissionMode; label: string }[] = [
  { value: 'default', label: 'Pedir permissão' },
  { value: 'acceptEdits', label: 'Editar livremente' },
  { value: 'auto', label: 'Automático' },
  { value: 'plan', label: 'Planejar primeiro' },
]

const EMPTY: Record<TicketStatus, string> = {
  backlog: 'Ideias e pedidos ainda sem prioridade.',
  todo: 'Pronto para pegar. Arraste para cá o que vem a seguir.',
  doing: 'Delegue um ticket e ele aparece aqui.',
  review: 'Entregas dos agentes esperando sua revisão.',
  done: 'Nada fechado ainda.',
}

const DONE_SHOWN = 40

/** Full-screen kanban: columns, filters and a detail drawer to edit, delegate and review. */
export class Board {
  readonly el: HTMLDivElement
  private cols: HTMLDivElement
  private detail: HTMLDivElement
  private count: HTMLSpanElement
  private search: HTMLInputElement
  private typeFilter: HTMLSelectElement
  private prioFilter: HTMLSelectElement
  private whoFilter: HTMLSelectElement
  private selected: string | null = null
  private dragging: string | null = null
  /** Something changed while the user was dragging or typing; render when they stop. */
  private stale = false
  private commentBox: HTMLTextAreaElement
  private descDraft: string | null = null
  private briefOpen = false

  constructor(
    private root: HTMLElement,
    private state: State,
    private actions: BoardActions,
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
    for (const c of [this.search, this.typeFilter, this.prioFilter, this.whoFilter]) c.addEventListener('input', () => this.renderColumns())

    this.cols = h('div', { class: 'board-cols' })
    this.detail = h('div', { class: 'tdetail hidden' })
    this.detail.addEventListener('focusout', () =>
      setTimeout(() => {
        if (this.stale && !this.typing()) this.render()
      }),
    )
    this.commentBox = h('textarea', { class: 'input', rows: 2, placeholder: 'Comente, peça ajustes, registre uma decisão…' })

    this.el = h(
      'div',
      { class: 'board card hidden', tabindex: -1 },
      h(
        'div',
        { class: 'board-head' },
        h('div', { class: 'board-title' }, icon('kanban', 18), 'Quadro de tickets', this.count),
        this.search,
        this.typeFilter,
        this.prioFilter,
        this.whoFilter,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-primary', onclick: () => this.create('todo') }, icon('plus', 16), 'Novo ticket'),
        h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => this.close() }, icon('x', 18)),
      ),
      h('div', { class: 'board-body' }, this.cols, this.detail),
    )
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
    this.el.classList.remove('hidden')
    if (ticketId) this.selected = ticketId
    this.render()
    this.el.focus()
  }

  close(): void {
    this.el.classList.add('hidden')
    this.select(null)
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

  private typing(): boolean {
    const a = document.activeElement
    return this.detail.contains(a) && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement)
  }

  private select(id: string | null): void {
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

  // ---------- columns ----------

  private visible(): Ticket[] {
    const q = this.search.value.trim().toLowerCase()
    const type = this.typeFilter.value
    const prio = this.prioFilter.value
    const who = this.whoFilter.value as Who | ''
    return [...this.state.tickets.values()].filter((t) => {
      if (type && t.type !== type) return false
      if (prio && t.priority !== prio) return false
      if (who === 'me' && t.assignee?.kind !== 'player') return false
      if (who === 'agents' && t.assignee?.kind !== 'agent') return false
      if (who === 'none' && t.assignee) return false
      return !q || [t.key, t.title, t.description, ...t.tags].some((v) => v.toLowerCase().includes(q))
    })
  }

  private renderColumns(): void {
    const shown = this.visible()
    const total = this.state.tickets.size
    this.count.textContent = shown.length === total ? String(total) : `${shown.length} de ${total}`
    this.cols.replaceChildren(
      ...STATUSES.map((s) => {
        let list = shown.filter((t) => t.status === s.value).sort((a, b) => a.order - b.order)
        const hidden = s.value === 'done' && list.length > DONE_SHOWN ? list.length - DONE_SHOWN : 0
        if (hidden) list = list.slice(-DONE_SHOWN)
        return this.column(s.value, s.label, list, hidden)
      }),
    )
  }

  private column(status: TicketStatus, label: string, tickets: Ticket[], hidden: number): HTMLElement {
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
      ),
      list,
    )
  }

  private card(t: Ticket): HTMLElement {
    const ok = t.acceptance.filter((c) => c.done).length
    const agent = t.assignee?.id ? this.state.agents.get(t.assignee.id) : undefined
    const el = h(
      'div',
      { class: `tcard prio-${t.priority}${t.id === this.selected ? ' on' : ''}`, draggable: 'true', onclick: () => this.select(t.id) },
      h(
        'div',
        { class: 'tcard-top' },
        h('span', { class: 'tkey' }, t.key),
        h('span', { class: `ttype ttype-${t.type}` }, labelOf(TYPES, t.type)),
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

  private markDrop(list: HTMLElement, before: HTMLElement | undefined): void {
    clearDropMarks(this.cols)
    if (before) before.classList.add('drop-before')
    else list.classList.add('drop-end')
  }

  /** Portrait of who it is: the agent if still in the office, the player, or a stand-in. */
  private avatar(who: Actor, size: number): HTMLElement {
    const agent = who.id ? this.state.agents.get(who.id) : undefined
    const look = agent?.look ?? (who.kind === 'player' && who.name === this.state.settings.playerName ? this.state.settings.playerLook : null)
    const face = look ? portrait(look, size) : h('span', { class: 'avatar-stub', style: `width:${size}px;height:${size}px` }, who.kind === 'agent' ? icon('bot', size * 0.6) : initials(who.name))
    return h('span', { class: 'tavatar', title: who.name + (who.kind === 'agent' && !agent ? ' (saiu do escritório)' : '') }, face)
  }

  // ---------- detail ----------

  private renderDetail(): void {
    const t = this.selected ? this.state.tickets.get(this.selected) : undefined
    if (!t) {
      this.selected = null
      this.detail.classList.add('hidden')
      return
    }
    this.detail.classList.remove('hidden')
    const scroll = this.detail.querySelector('.tdetail-scroll')?.scrollTop ?? 0
    const set = (patch: TicketPatch) => window.office.updateTicket(t.id, patch).catch((err) => this.actions.toast(cleanError(err), 'err'))

    const title = h('textarea', { class: 'tdetail-title', rows: 2, maxlength: 160, spellcheck: 'false' })
    title.value = t.title
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        title.blur()
      }
    })
    title.addEventListener('change', () => {
      if (title.value.trim() && title.value.trim() !== t.title) set({ title: title.value })
      else title.value = t.title
    })

    const status = select(STATUSES, t.status, (v) => window.office.moveTicket(t.id, v).catch((err) => this.actions.toast(cleanError(err), 'err')))
    const type = select(TYPES, t.type, (v: TicketType) => set({ type: v }))
    const prio = select(PRIORITIES, t.priority, (v: TicketPriority) => set({ priority: v }))

    const estimate = h('input', { class: 'input', type: 'number', min: 0, step: 0.5, placeholder: '—' }) as HTMLInputElement
    estimate.value = t.estimate ? String(t.estimate) : ''
    estimate.addEventListener('change', () => set({ estimate: estimate.value ? Number(estimate.value) : null }))
    const due = h('input', { class: 'input', type: 'date' }) as HTMLInputElement
    due.value = t.dueDate ?? ''
    due.addEventListener('change', () => set({ dueDate: due.value || null }))
    const tags = h('input', { class: 'input', placeholder: 'ex.: backend, ofx' }) as HTMLInputElement
    tags.value = t.tags.join(', ')
    tags.addEventListener('change', () => set({ tags: tags.value.split(',') }))

    const folder = h(
      'div',
      { class: 'path-row' },
      h('span', { class: 'path-label', title: t.cwd ?? '' }, t.cwd ?? 'Sem pasta: o agente não sabe onde trabalhar'),
      h('button', {
        class: 'btn btn-small',
        onclick: async () => {
          const p = await window.office.pickFolder(t.cwd ?? localStorage.getItem(LAST_CWD) ?? undefined)
          if (p) set({ cwd: p })
        },
      }, icon('folder', 14), 'Escolher'),
    )

    const body = h(
      'div',
      { class: 'tdetail-scroll' },
      title,
      h(
        'div',
        { class: 'tdetail-grid' },
        field('Coluna', status),
        field('Tipo', type),
        field('Prioridade', prio),
        field('Pontos', estimate),
        field('Prazo', due),
        field('Tags', tags),
      ),
      field('Pasta do projeto', folder),
      this.assignSection(t),
      this.section('Contexto', this.descriptionView(t, set)),
      this.section(`Critérios de aceite${t.acceptance.length ? ` · ${t.acceptance.filter((c) => c.done).length}/${t.acceptance.length}` : ''}`, this.criteriaView(t, set)),
      this.briefView(t),
      this.section(`Comentários${t.comments.length ? ` · ${t.comments.length}` : ''}`, this.commentsView(t)),
      this.activityView(t),
      h(
        'div',
        { class: 'tdetail-foot' },
        h('span', {}, `Aberto por ${t.reporter.name} · ${timeAgo(t.createdAt)}`),
        h('button', { class: 'btn btn-small btn-danger', onclick: () => this.remove(t) }, icon('trash', 13), 'Excluir'),
      ),
    )
    this.detail.replaceChildren(
      h(
        'div',
        { class: 'tdetail-head' },
        h('span', { class: 'tkey tkey-lg' }, t.key),
        h('span', { class: `ttype ttype-${t.type}` }, labelOf(TYPES, t.type)),
        h('span', { class: 'grow' }),
        h('button', {
          class: 'icon-btn',
          title: 'Copiar a chave',
          onclick: () => {
            navigator.clipboard.writeText(t.key)
            this.actions.toast(`${t.key} copiado.`, 'ok')
          },
        }, icon('copy', 15)),
        h('button', { class: 'icon-btn', title: 'Fechar', onclick: () => this.select(null) }, icon('x', 18)),
      ),
      body,
    )
    body.scrollTop = scroll
  }

  private section(label: string, content: HTMLElement): HTMLElement {
    return h('div', { class: 'tsection' }, h('div', { class: 'tsection-label' }, label), content)
  }

  /** Who has the ticket, and the controls to hand it over or review what came back. */
  private assignSection(t: Ticket): HTMLElement {
    const agent = t.assignee?.id ? this.state.agents.get(t.assignee.id) : undefined
    const busy = agent ? isBusy(agent) : false
    const rows: (HTMLElement | null)[] = []

    if (t.assignee) {
      rows.push(
        h(
          'div',
          { class: 'tassignee' },
          this.avatar(t.assignee, 34),
          h(
            'div',
            { class: 'tassignee-main' },
            h('div', { class: 'tassignee-name' }, t.assignee.name, t.assignee.kind === 'agent' ? h('span', { class: 'chip' }, 'agente') : null),
            h(
              'div',
              { class: 'tassignee-sub' },
              agent
                ? [h('span', { class: `dot dot-${agent.status}` }), ` ${STATUS_LABEL[agent.status]} · ${agent.activity}`]
                : t.assignee.kind === 'agent'
                  ? 'Saiu do escritório'
                  : 'Pessoa do time',
            ),
          ),
          agent
            ? h('button', {
                class: 'btn btn-small',
                onclick: () => {
                  this.close()
                  this.actions.openAgent(agent.id)
                },
              }, icon('eye', 14), 'Ver conversa')
            : null,
          h('button', { class: 'icon-btn', title: 'Tirar o responsável', onclick: () => this.unassign(t) }, icon('x', 15)),
        ),
      )
    }

    if (t.status === 'review') {
      const ask = h('button', { class: 'btn btn-small' }, icon('message', 14), agent && !busy ? 'Pedir ajustes ao agente' : 'Devolver para A fazer')
      ask.addEventListener('click', () => this.requestChanges(t, agent))
      rows.push(
        h(
          'div',
          { class: 'treview' },
          h('div', { class: 'treview-text' }, 'Entrega pronta para revisão. Leia o relatório nos comentários.'),
          h(
            'div',
            { class: 'treview-actions' },
            h('button', { class: 'btn btn-small btn-primary', onclick: () => window.office.moveTicket(t.id, 'done') }, icon('check', 14), 'Aprovar'),
            ask,
          ),
          h('div', { class: 'field-hint' }, 'Para pedir ajustes, escreva o que mudar no campo de comentário abaixo e clique no botão.'),
        ),
      )
    } else if (t.status !== 'done' && !(agent && busy)) {
      rows.push(this.delegateControls(t, agent))
    }

    return this.section('Responsável', h('div', { class: 'tassign' }, ...(rows.length ? rows : [h('div', { class: 'field-hint' }, 'Ticket fechado.')])))
  }

  private delegateControls(t: Ticket, current: AgentSummary | undefined): HTMLElement {
    const free = [...this.state.agents.values()].filter((a) => a.source === 'office' && a.permissionMode !== 'bypassPermissions' && !isBusy(a) && (!t.cwd || a.cwd === t.cwd))
    const who = h(
      'select',
      { class: 'input' },
      h('option', { value: '' }, 'Contratar um agente novo'),
      ...free.map((a) => h('option', { value: a.id }, `${a.name} · ${STATUS_LABEL[a.status].toLowerCase()}`)),
    )
    if (current && free.includes(current)) who.value = current.id
    const mode = h('select', { class: 'input' }, ...DELEGATE_MODES.map((m) => h('option', { value: m.value }, m.label)))
    mode.value = DELEGATE_MODES.some((m) => m.value === this.state.settings.defaultPermissionMode) ? this.state.settings.defaultPermissionMode : 'default'
    const syncMode = () => mode.classList.toggle('hidden', !!who.value)
    who.addEventListener('change', syncMode)
    syncMode()

    const go = h('button', { class: 'btn btn-primary btn-small' }, icon('walk', 14), 'Delegar')
    go.addEventListener('click', async () => {
      if (!t.cwd && !who.value) return this.actions.toast('Escolha a pasta do projeto antes de contratar um agente para o ticket.', 'err')
      go.setAttribute('disabled', '')
      try {
        const a = await window.office.delegateTicket(t.id, who.value ? { agentId: who.value } : { hire: { permissionMode: mode.value as OfficePermissionMode } })
        this.actions.toast(who.value ? `${a.name} pegou o ${t.key}.` : `${a.name} foi contratado para o ${t.key} e está subindo.`, 'ok')
      } catch (err) {
        this.actions.toast(cleanError(err), 'err')
        go.removeAttribute('disabled')
      }
    })
    const mine = t.assignee?.kind === 'player' && t.assignee.name === this.state.settings.playerName
    const take = mine
      ? null
      : h('button', {
          class: 'btn btn-small',
          title: 'Você mesmo vai fazer este ticket',
          onclick: () => window.office.assignTicket(t.id, 'me').catch((err) => this.actions.toast(cleanError(err), 'err')),
        }, 'Eu pego')
    return h(
      'div',
      { class: 'tdelegate' },
      h('div', { class: 'tdelegate-row' }, who, mode, go, take),
      h('div', { class: 'field-hint' }, 'O agente recebe o ticket completo (veja "O que o agente lê"), o ticket vai para Fazendo e, quando ele termina, o relatório chega aqui e o ticket vai para Revisão.'),
    )
  }

  private async requestChanges(t: Ticket, agent: AgentSummary | undefined): Promise<void> {
    const note = this.commentBox.value.trim()
    if (!note) {
      this.commentBox.focus()
      return this.actions.toast('Escreva no comentário o que precisa mudar.', 'info')
    }
    try {
      await window.office.commentTicket(t.id, note)
      this.commentBox.value = ''
      if (agent && !isBusy(agent)) {
        // The brief carries the latest comments, so the agent sees the request.
        await window.office.delegateTicket(t.id, { agentId: agent.id })
        this.actions.toast(`${agent.name} voltou ao ${t.key} com seus ajustes.`, 'ok')
      } else {
        await window.office.moveTicket(t.id, 'todo')
      }
    } catch (err) {
      this.actions.toast(cleanError(err), 'err')
    }
  }

  private descriptionView(t: Ticket, set: (p: TicketPatch) => void): HTMLElement {
    if (this.descDraft !== null) {
      const area = h('textarea', { class: 'input tdesc-edit', rows: 10, placeholder: 'Contexto, arquivos relevantes, passos para reproduzir, trechos de erro. Markdown funciona.' })
      area.value = this.descDraft
      area.addEventListener('input', () => (this.descDraft = area.value))
      setTimeout(() => area.focus())
      return h(
        'div',
        { class: 'tdesc' },
        area,
        h(
          'div',
          { class: 'tdesc-actions' },
          h('button', {
            class: 'btn btn-small',
            onclick: () => {
              this.descDraft = null
              this.renderDetail()
            },
          }, 'Cancelar'),
          h('button', {
            class: 'btn btn-small btn-primary',
            onclick: () => {
              set({ description: area.value })
              this.descDraft = null
              this.renderDetail()
            },
          }, 'Salvar'),
        ),
      )
    }
    const edit = () => {
      this.descDraft = t.description
      this.renderDetail()
    }
    return h(
      'div',
      { class: 'tdesc' },
      t.description.trim() ? renderMarkdown(t.description) : h('div', { class: 'field-hint' }, 'Sem contexto. O agente vai ter que descobrir sozinho o que você quer.'),
      h('button', { class: 'btn btn-small tdesc-btn', onclick: edit }, icon('edit', 13), t.description.trim() ? 'Editar' : 'Escrever'),
    )
  }

  private criteriaView(t: Ticket, set: (p: TicketPatch) => void): HTMLElement {
    const items = t.acceptance.map((c, i) => {
      const box = h('input', { type: 'checkbox' }) as HTMLInputElement
      box.checked = c.done
      box.addEventListener('change', () => set({ acceptance: t.acceptance.map((x, j) => (j === i ? { ...x, done: box.checked } : x)) }))
      return h(
        'label',
        { class: 'tcrit' + (c.done ? ' done' : '') },
        box,
        h('span', { class: 'tcrit-text' }, c.text),
        h('button', {
          class: 'icon-btn tcrit-del',
          title: 'Remover',
          onclick: (e: Event) => {
            e.preventDefault()
            set({ acceptance: t.acceptance.filter((_, j) => j !== i) })
          },
        }, icon('x', 13)),
      )
    })
    const add = h('input', { class: 'input', placeholder: 'Novo critério verificável, Enter para adicionar' }) as HTMLInputElement
    add.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !add.value.trim()) return
      set({ acceptance: [...t.acceptance, { text: add.value, done: false }] })
      add.value = ''
    })
    return h('div', { class: 'tcrits' }, ...items, add)
  }

  private briefView(t: Ticket): HTMLElement {
    const brief = ticketBrief(t)
    const d = h(
      'details',
      { class: 'tbrief' },
      h('summary', {}, icon('bot', 14), 'O que o agente lê'),
      h('div', { class: 'field-hint' }, 'É isto que o agente recebe ao pegar o ticket. Se algo importante falta aqui, falta para ele também.'),
      h('pre', { class: 'code' }, brief),
      h('button', {
        class: 'btn btn-small',
        onclick: () => {
          navigator.clipboard.writeText(brief)
          this.actions.toast('Brief copiado. Cole em qualquer sessão do Claude Code.', 'ok')
        },
      }, icon('copy', 13), 'Copiar'),
    )
    d.open = this.briefOpen
    d.addEventListener('toggle', () => (this.briefOpen = d.open))
    return d
  }

  private commentsView(t: Ticket): HTMLElement {
    const send = async () => {
      const text = this.commentBox.value.trim()
      if (!text) return
      try {
        await window.office.commentTicket(t.id, text)
        this.commentBox.value = ''
      } catch (err) {
        this.actions.toast(cleanError(err), 'err')
      }
    }
    this.commentBox.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void send()
      }
    }
    return h(
      'div',
      { class: 'tcomments' },
      ...t.comments.map((c) =>
        h(
          'div',
          { class: 'tcomment' + (c.author.kind === 'agent' ? ' by-agent' : '') },
          this.avatar(c.author, 24),
          h(
            'div',
            { class: 'tcomment-main' },
            h('div', { class: 'tcomment-head' }, h('b', {}, c.author.name), h('span', {}, timeAgo(c.t))),
            renderMarkdown(c.text),
          ),
        ),
      ),
      h(
        'div',
        { class: 'tcomment-new' },
        this.commentBox,
        h('button', { class: 'btn btn-small', title: 'Comentar (⌘/Ctrl + Enter)', onclick: () => void send() }, icon('send', 13), 'Comentar'),
      ),
    )
  }

  private activityView(t: Ticket): HTMLElement {
    return h(
      'details',
      { class: 'tactivity' },
      h('summary', {}, `Histórico · ${t.activity.length}`),
      ...t.activity
        .slice()
        .reverse()
        .map((a) => h('div', { class: 'tactivity-row' }, h('b', {}, a.actor.name), ` ${a.text}`, h('span', {}, timeAgo(a.t)))),
    )
  }

  private async unassign(t: Ticket): Promise<void> {
    try {
      await window.office.assignTicket(t.id, null)
    } catch (err) {
      this.actions.toast(cleanError(err), 'err')
    }
  }

  private async remove(t: Ticket): Promise<void> {
    const yes = await confirmDialog(this.root, {
      title: `Excluir ${t.key}?`,
      text: `"${t.title}" sai do quadro com comentários e histórico. Não dá para desfazer.`,
      confirm: 'Excluir',
      cancel: 'Manter',
      danger: true,
    })
    if (!yes) return
    await window.office.deleteTicket(t.id)
    this.select(null)
  }

  // ---------- create ----------

  create(status: TicketStatus = 'todo'): void {
    const title = h('input', { class: 'input', maxlength: 160, placeholder: 'Ex.: Corrigir FITID duplicado na importação OFX' }) as HTMLInputElement
    const type = select(TYPES, 'task', () => undefined)
    const prio = select(PRIORITIES, 'medium', () => undefined)
    const column = select(
      STATUSES.filter((s) => s.value === 'backlog' || s.value === 'todo'),
      status === 'backlog' ? 'backlog' : 'todo',
      () => undefined,
    )
    let cwd = localStorage.getItem(LAST_CWD) ?? ''
    const cwdLabel = h('span', { class: 'path-label' }, cwd || 'Nenhuma pasta')
    const pick = h('button', { class: 'btn', type: 'button' }, icon('folder', 15), 'Escolher…')
    pick.addEventListener('click', async () => {
      const p = await window.office.pickFolder(cwd || undefined)
      if (p) {
        cwd = p
        cwdLabel.textContent = p
      }
    })
    const desc = h('textarea', { class: 'input', rows: 5, placeholder: 'Contexto: o que está errado ou o que falta, onde olhar (arquivos, telas), como reproduzir. Markdown funciona.' })
    const crit = h('textarea', { class: 'input', rows: 3, placeholder: 'Um critério por linha. Ex.:\nImportar o mesmo OFX duas vezes não duplica lançamentos\nTestes do importador passam' })
    const tags = h('input', { class: 'input', placeholder: 'backend, ofx' }) as HTMLInputElement

    const close = () => el.remove()
    const submit = async (delegate: boolean, btn: HTMLButtonElement) => {
      if (!title.value.trim()) {
        title.focus()
        return this.actions.toast('Dê um título ao ticket.', 'err')
      }
      if (delegate && !cwd) return this.actions.toast('Escolha a pasta do projeto para o agente saber onde trabalhar.', 'err')
      btn.setAttribute('disabled', '')
      try {
        const t = await window.office.createTicket({
          title: title.value,
          type: type.value as TicketType,
          priority: prio.value as TicketPriority,
          status: column.value as TicketStatus,
          cwd: cwd || undefined,
          description: desc.value,
          acceptance: crit.value
            .split('\n')
            .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])?\s*(?:\[[ x]\]\s*)?/i, '').trim())
            .filter(Boolean)
            .map((text) => ({ text, done: false })),
          tags: tags.value.split(','),
        })
        if (cwd) localStorage.setItem(LAST_CWD, cwd)
        close()
        this.open(t.id)
        if (delegate) {
          const a = await window.office.delegateTicket(t.id, { hire: {} })
          this.actions.toast(`${t.key} criado. ${a.name} foi contratado e está subindo.`, 'ok')
        } else this.actions.toast(`${t.key} criado.`, 'ok')
      } catch (err) {
        this.actions.toast(cleanError(err), 'err')
        btn.removeAttribute('disabled')
      }
    }
    const create = h('button', { class: 'btn' }, 'Criar')
    create.addEventListener('click', () => submit(false, create))
    const createGo = h('button', { class: 'btn btn-primary' }, icon('walk', 15), 'Criar e delegar')
    createGo.addEventListener('click', () => submit(true, createGo))

    const el = modal(
      'Novo ticket',
      [
        field('Título', title),
        h('div', { class: 'field-row' }, field('Tipo', type), field('Prioridade', prio), field('Coluna', column)),
        field('Pasta do projeto', h('div', { class: 'path-row' }, cwdLabel, pick)),
        field('Contexto', desc),
        field('Critérios de aceite', crit, 'O agente marca cada um ao cumprir. Critérios claros = entrega que você aprova de primeira.'),
        field('Tags', tags),
      ],
      [h('button', { class: 'btn', onclick: close }, 'Cancelar'), create, createGo],
      close,
    )
    el.classList.add('backdrop-ticket')
    this.root.append(el)
    title.focus()
  }
}

// ---------- helpers ----------

function filterSelect(all: string, options: { value: string; label: string }[]): HTMLSelectElement {
  return h('select', { class: 'input board-filter' }, h('option', { value: '' }, all), ...options.map((o) => h('option', { value: o.value }, o.label)))
}

function select<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = h('select', { class: 'input' }, ...options.map((o) => h('option', { value: o.value }, o.label)))
  s.value = value
  s.addEventListener('change', () => onChange(s.value as T))
  return s
}

function beforeCard(list: HTMLElement, y: number): HTMLElement | undefined {
  for (const c of list.querySelectorAll<HTMLElement>('.tcard:not(.dragging)')) {
    const r = c.getBoundingClientRect()
    if (y < r.top + r.height / 2) return c
  }
  return undefined
}

function clearDropMarks(root: HTMLElement): void {
  root.querySelectorAll('.drop-before, .drop-end').forEach((n) => n.classList.remove('drop-before', 'drop-end'))
}

function isBusy(a: AgentSummary): boolean {
  return a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function overdue(t: Ticket): boolean {
  return !!t.dueDate && t.status !== 'done' && t.dueDate < new Date().toISOString().slice(0, 10)
}
