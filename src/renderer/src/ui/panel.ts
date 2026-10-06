import type { AgentSummary, LogEntry } from '@shared/types'
import type { State } from '../state'
import { formatCost, h, icon } from './dom'
import { STATUS_LABEL } from './hud'
import { renderMarkdown } from './markdown'
import { portrait } from './portrait'

export interface PanelActions {
  goTo(id: string): void
  closeTerminal(id: string): void
  openItem(agentId: string, itemId: string): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
}

/** Right-hand drawer with an agent's live log and a message box. */
export class AgentPanel {
  readonly el: HTMLDivElement
  private head: HTMLDivElement
  private banner: HTMLDivElement
  private feed: HTMLDivElement
  private composer: HTMLDivElement
  private input: HTMLTextAreaElement
  agentId: string | null = null
  private stickToBottom = true

  constructor(
    root: HTMLElement,
    private state: State,
    private actions: PanelActions,
  ) {
    this.head = h('div', { class: 'panel-head' })
    this.banner = h('div', { class: 'panel-banner hidden' })
    this.feed = h('div', { class: 'panel-feed' })
    this.feed.addEventListener('scroll', () => {
      this.stickToBottom = this.feed.scrollTop + this.feed.clientHeight >= this.feed.scrollHeight - 30
    })
    this.input = h('textarea', { class: 'composer-input', rows: 2, placeholder: 'Mande uma nova instrução…' })
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        this.send()
      }
      e.stopPropagation()
    })
    this.composer = h(
      'div',
      { class: 'composer' },
      this.input,
      h('button', { class: 'btn btn-primary btn-icon', title: 'Enviar (Enter)', onclick: () => this.send() }, icon('send', 16)),
    )
    this.el = h('div', { class: 'panel card hidden' }, this.head, this.banner, this.feed, this.composer)
    root.append(this.el)

    state.onLog((agentId, entry) => {
      if (agentId === this.agentId) this.append(entry)
    })
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.agentId && document.activeElement !== this.input) this.close()
    })
  }

  async open(agentId: string): Promise<void> {
    const changed = agentId !== this.agentId
    this.agentId = agentId
    this.el.classList.remove('hidden')
    this.render()
    if (changed) {
      this.feed.replaceChildren(h('div', { class: 'feed-loading' }, 'Carregando…'))
      const log = await this.state.log(agentId)
      if (this.agentId !== agentId) return
      this.feed.replaceChildren()
      for (const e of log) this.append(e, false)
      this.feed.scrollTop = this.feed.scrollHeight
      this.stickToBottom = true
    }
  }

  close(): void {
    this.agentId = null
    this.el.classList.add('hidden')
  }

  get isOpen(): boolean {
    return this.agentId !== null
  }

  focusInput(): void {
    this.input.focus()
  }

  render(): void {
    if (!this.agentId) return
    const a = this.state.agents.get(this.agentId)
    if (!a) {
      this.close()
      return
    }
    this.renderHead(a)
    const items = this.state.itemsFor(a.id)
    const first = items.permissions[0] ?? items.results[0]
    if (first) {
      const isPerm = 'kind' in first
      this.banner.className = `panel-banner ${isPerm ? 'banner-wait' : 'banner-done'}`
      this.banner.replaceChildren(
        h('span', {}, isPerm ? `${a.name} está esperando sua decisão` : `${a.name} trouxe o resultado`),
        h('button', { class: 'btn btn-small', onclick: () => this.actions.openItem(a.id, first.id) }, isPerm ? 'Responder' : 'Ver resultado'),
      )
    } else this.banner.className = 'panel-banner hidden'

    const terminal = a.source === 'terminal'
    this.composer.classList.toggle('disabled', terminal)
    this.input.disabled = terminal
    this.input.placeholder = terminal
      ? 'Sessão do terminal: responda por lá. Permissões chegam aqui.'
      : a.status === 'working' || a.status === 'starting'
        ? 'Mande uma instrução (entra na fila do agente)…'
        : 'Mande uma nova tarefa…'
  }

  private renderHead(a: AgentSummary): void {
    const busy = a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
    this.head.replaceChildren(
      h(
        'div',
        { class: 'panel-title' },
        portrait(a.look, 44),
        h(
          'div',
          { class: 'panel-id' },
          h('div', { class: 'panel-name' }, a.name, a.source === 'terminal' ? h('span', { class: 'chip chip-term' }, 'terminal') : null),
          h('div', { class: 'panel-status' }, h('span', { class: `dot dot-${a.status}` }), STATUS_LABEL[a.status], h('span', { class: 'sep' }, '·'), a.activity),
        ),
        h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => this.close() }, icon('x', 18)),
      ),
      h(
        'div',
        { class: 'panel-meta' },
        h('button', { class: 'meta-path', title: 'Mostrar no Finder', onclick: () => window.office.revealPath(a.cwd) }, icon('folder', 13), shortPath(a.cwd)),
        a.model ? h('span', { class: 'meta-item' }, a.model) : null,
        a.costUsd ? h('span', { class: 'meta-item' }, formatCost(a.costUsd)) : null,
      ),
      h(
        'div',
        { class: 'panel-actions' },
        h('button', { class: 'btn btn-small', onclick: () => this.actions.goTo(a.id) }, icon('walk', 14), 'Ir até'),
        a.source === 'office' && busy
          ? h('button', { class: 'btn btn-small', onclick: () => window.office.interrupt(a.id) }, icon('stop', 14), 'Interromper')
          : null,
        a.source === 'office'
          ? h('button', { class: 'btn btn-small btn-danger', onclick: () => this.fire(a) }, icon('fire', 14), 'Demitir')
          : h('button', { class: 'btn btn-small btn-danger', onclick: () => this.actions.closeTerminal(a.id) }, icon('x', 14), 'Fechar sessão'),
      ),
    )
  }

  private async fire(a: AgentSummary): Promise<void> {
    if (!confirm(`Demitir ${a.name}? A sessão para e o agente vai embora pelo elevador.`)) return
    await window.office.fire(a.id)
    this.close()
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim()
    if (!text || !this.agentId) return
    this.input.value = ''
    try {
      await window.office.send(this.agentId, text)
    } catch (err) {
      this.actions.toast(String(err), 'err')
    }
  }

  private append(e: LogEntry, scroll = true): void {
    this.feed.querySelector('.feed-loading')?.remove()
    this.feed.append(entryView(e))
    while (this.feed.childElementCount > 400) this.feed.firstElementChild?.remove()
    if (scroll && this.stickToBottom) this.feed.scrollTop = this.feed.scrollHeight
  }
}

function entryView(e: LogEntry): HTMLElement {
  switch (e.kind) {
    case 'user':
      return h('div', { class: 'entry entry-user' }, h('div', { class: 'entry-bubble' }, e.text))
    case 'assistant':
      return h('div', { class: 'entry entry-assistant' }, renderMarkdown(e.text))
    case 'tool':
      return h('div', { class: 'entry entry-tool' }, h('span', { class: 'tool-name' }, e.tool ?? 'tool'), h('span', { class: 'tool-text' }, e.text))
    case 'tool_result': {
      const pre = h('pre', { class: 'entry-pre' + (e.isError ? ' err' : '') }, e.text)
      const wrap = h('div', { class: 'entry entry-result collapsed' }, pre)
      wrap.addEventListener('click', () => wrap.classList.toggle('collapsed'))
      return wrap
    }
    case 'decision':
      return h('div', { class: 'entry entry-decision' }, icon('check', 13), e.text)
    case 'result':
      return h('div', { class: 'entry entry-final' + (e.isError ? ' err' : '') }, h('div', { class: 'final-label' }, e.isError ? 'Erro' : 'Resultado entregue'), renderMarkdown(e.text))
    case 'error':
      return h('div', { class: 'entry entry-error' }, e.text)
    default:
      return h('div', { class: 'entry entry-system' }, e.text)
  }
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}
