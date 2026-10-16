import { labelOf, PRIORITIES, STATUSES, ticketBrief, TYPES } from '@shared/tickets'
import type { AgentSummary, OfficePermissionMode, Ticket, TicketPatch, TicketPriority, TicketType } from '@shared/types'
import { h, icon, timeAgo } from '../dom'
import { STATUS_LABEL } from '../hud'
import { renderMarkdown } from '../markdown'
import { brainFields, cleanError, field, LAST_CWD, worktreeToggle } from '../modals'
import { DELEGATE_MODES, isBusy, select } from './helpers'
import { BoardColumns } from './columns'

/** The detail drawer: edit, assign, delegate, criteria, comments and activity. */
export abstract class BoardDetail extends BoardColumns {
  // ---------- detail ----------

  protected renderDetail(): void {
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

  protected section(label: string, content: HTMLElement): HTMLElement {
    return h('div', { class: 'tsection' }, h('div', { class: 'tsection-label' }, label), content)
  }

  /** Who has the ticket, and the controls to hand it over or review what came back. */
  protected assignSection(t: Ticket): HTMLElement {
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

    if (t.status === 'done') {
      rows.push(
        h(
          'div',
          { class: 'treview' },
          h('div', { class: 'treview-text' }, this.autoCloseText(t)),
          h('div', { class: 'treview-actions' }, h('button', { class: 'btn btn-small', onclick: () => void this.closeOne(t) }, icon('archive', 14), 'Fechar agora')),
        ),
      )
    }
    return this.section('Responsável', h('div', { class: 'tassign' }, ...rows))
  }

  protected delegateControls(t: Ticket, current: AgentSummary | undefined): HTMLElement {
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
    const brain = brainFields({ model: this.state.settings.defaultModel, effort: this.state.settings.defaultEffort }, true)
    brain.model.title = 'Modelo do agente novo'
    const brainRow = h('div', { class: 'tdelegate-row' }, brain.model)
    const brainHint = h('div', { class: 'tdelegate-brain' }, h('div', { class: 'field-hint' }, brain.hint), brain.meter)
    const isolated = worktreeToggle(() => this.state.settings.projects)
    isolated.set(t.cwd)
    // Model and effort only matter for a new hire; an agent already here keeps its own.
    const syncMode = () => {
      for (const el of [mode, brainRow, brainHint]) el.classList.toggle('hidden', !!who.value)
      isolated.el.classList.toggle('tdelegate-off', !!who.value)
    }
    who.addEventListener('change', syncMode)
    syncMode()

    const go = h('button', { class: 'btn btn-primary btn-small' }, icon('walk', 14), 'Delegar')
    go.addEventListener('click', async () => {
      if (!t.cwd && !who.value) return this.actions.toast('Escolha a pasta do projeto antes de contratar um agente para o ticket.', 'err')
      go.setAttribute('disabled', '')
      try {
        const a = await window.office.delegateTicket(t.id, who.value ? { agentId: who.value } : { hire: { ...brain.value(), permissionMode: mode.value as OfficePermissionMode, worktree: isolated.value() } })
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
      brainRow,
      brainHint,
      isolated.el,
      h('div', { class: 'field-hint' }, 'O agente recebe o ticket completo (veja "O que o agente lê"), o ticket vai para Fazendo e, quando ele termina, o relatório chega aqui e o ticket vai para Revisão.'),
    )
  }

  protected async requestChanges(t: Ticket, agent: AgentSummary | undefined): Promise<void> {
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

  protected descriptionView(t: Ticket, set: (p: TicketPatch) => void): HTMLElement {
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

  protected criteriaView(t: Ticket, set: (p: TicketPatch) => void): HTMLElement {
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

  protected briefView(t: Ticket): HTMLElement {
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

  protected commentsView(t: Ticket): HTMLElement {
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

  protected activityView(t: Ticket): HTMLElement {
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

  protected async unassign(t: Ticket): Promise<void> {
    try {
      await window.office.assignTicket(t.id, null)
    } catch (err) {
      this.actions.toast(cleanError(err), 'err')
    }
  }
}
