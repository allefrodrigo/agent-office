import type { AgentSummary } from '@shared/types'
import { accountChip } from '../accounts'
import { formatCost, h, icon } from '../dom'
import { STATUS_LABEL } from '../hud'
import { cleanError, confirmDialog, EFFORTS } from '../modals'
import { renderHelpers } from '../panel-helpers'
import { osText } from '../os-text'
import { portrait } from '../portrait'
import { saveAgentAsTemplate } from '../templates'
import { BADGE_OPEN_KEY, branchChip, contextLevel, helpersChip, modelLabel, shortPath } from './helpers'
import { PanelSearch } from './search'

/** The agent badge: photo with the memory ring, details, memory menu and the rarer actions. */
export abstract class PanelHead extends PanelSearch {
  render(): void {
    if (!this.agentId) return
    const a = this.state.agents.get(this.agentId)
    if (!a) {
      this.close()
      return
    }
    renderHelpers(this.helpersEl, a, this.helper, (id) => void this.open(a.id, id))
    const items = this.state.itemsFor(a.id)
    // A pending permission shows as "Responder" on the badge itself.
    this.renderHead(a, items.permissions[0]?.id)
    const result = items.results[0]
    if (result) {
      this.banner.className = 'panel-banner banner-done'
      this.banner.replaceChildren(
        h('span', {}, `${a.name} trouxe o resultado`),
        h('button', { class: 'btn btn-small', onclick: () => this.actions.openItem(a.id, result.id) }, 'Ver resultado'),
      )
    } else this.banner.className = 'panel-banner hidden'

    const terminal = a.source === 'terminal'
    this.terminal = terminal
    this.composer.classList.toggle('disabled', terminal)
    this.input.disabled = terminal
    const busy = this.busy()
    this.stopBtn.classList.toggle('hidden', !busy)
    // The agent finished while "Interromper?" was open: nothing left to stop.
    if (!busy) this.interruptAsk?.abort()
    this.input.placeholder = terminal
      ? 'Sessão do terminal: responda por lá. Permissões chegam aqui.'
      : a.status === 'working' || a.status === 'starting'
        ? 'Mande uma instrução (entra na fila do agente)…'
        : 'Mande uma nova tarefa…'
  }

  /** Esc on a busy agent: confirm first, so a stray Esc does not stop the work. */
  protected async askInterrupt(): Promise<void> {
    const a = this.agentId ? this.state.agents.get(this.agentId) : undefined
    if (!a || this.interruptAsk) return
    const ask = new AbortController()
    this.interruptAsk = ask
    const yes = await confirmDialog(this.root, {
      title: `Interromper ${a.name}?`,
      text: 'O trabalho em andamento para agora. O que já foi feito fica salvo e você pode mandar uma nova instrução.',
      confirm: 'Interromper',
      cancel: 'Continuar trabalhando',
      danger: true,
      signal: ask.signal,
    })
    this.interruptAsk = null
    if (yes && this.agentId === a.id) await this.interruptNow()
    else if (this.agentId === a.id) this.input.focus()
  }

  /** The red button: a click is deliberate, so it stops without asking. */
  protected async interruptNow(): Promise<void> {
    if (!this.agentId || !this.busy()) return
    await window.office.interrupt(this.agentId).catch((err) => this.actions.toast(cleanError(err), 'err'))
  }

  /** The agent's badge: photo ringed by memory use, name, and an LED with what it is doing. Opens for details. */
  protected renderHead(a: AgentSummary, permissionId?: string): void {
    const busy = a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
    const office = a.source === 'office'
    const open = this.badgeOpen
    const ctx = office ? a.context : undefined
    const level = ctx ? contextLevel(ctx.percent) : 'ok'
    // A pending permission rides on the LED, so the name keeps its room.
    const led = (withLabel: boolean) =>
      h(
        'div',
        { class: 'ab-led-line' },
        h(
          'div',
          { class: `ab-led ab-led-${a.status}`, title: a.activity },
          h('span', { class: `dot dot-${a.status}` }),
          h('span', { class: 'ab-led-text' }, withLabel ? `${STATUS_LABEL[a.status]} · ${a.activity}` : a.activity),
        ),
        permissionId
          ? h('button', { class: 'btn btn-small btn-warn', onclick: () => this.actions.openItem(a.id, permissionId) }, icon('reply', 13), 'Responder')
          : null,
      )
    const name = h('span', { class: 'ab-name' }, a.name)
    this.head.replaceChildren(
      h(
        'div',
        { class: `ab ab-${level}${open ? ' ab-open' : ''}` },
        h(
          'div',
          { class: 'ab-row' },
          this.photo(a, open ? 62 : 44, busy),
          h(
            'div',
            { class: 'ab-id' },
            h('div', { class: 'ab-name-row' }, name, a.source === 'terminal' ? h('span', { class: 'chip chip-term' }, 'terminal') : null, branchChip(a), open ? null : accountChip(this.state, a), helpersChip(a, !open)),
            open ? h('div', { class: 'ab-role' }, a.role === 'orchestrator' ? 'Orquestrador' : 'Agente', accountChip(this.state, a)) : led(false),
          ),
          h('button', { class: 'icon-btn ab-toggle', title: open ? 'Menos detalhes' : 'Mais detalhes', onclick: () => this.toggleBadge() }, icon('chevron', 16)),
          h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => this.close() }, icon('x', 16)),
        ),
        open ? this.badgeDetails(a, led(true), busy) : null,
      ),
      ...(this.memMenuOpen && ctx ? [this.memMenu(a, busy)] : []),
    )
  }

  /** Portrait inside a ring that fills as the conversation fills; click it to compact or clear. */
  protected photo(a: AgentSummary, size: number, _busy: boolean): HTMLElement {
    const c = a.source === 'office' ? a.context : undefined
    if (!c) return h('div', { class: 'ab-photo' }, portrait(a.look, size - 8))
    const stroke = size > 50 ? 4 : 3
    const r = size / 2 - stroke / 2 - 1
    const len = 2 * Math.PI * r
    const pct = Math.min(100, c.percent)
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    ring.setAttribute('class', 'ab-ring-svg')
    ring.setAttribute('width', String(size))
    ring.setAttribute('height', String(size))
    ring.innerHTML =
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ab-ring-track"/>` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ab-ring-fill" stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - pct / 100)}"/>`
    const pic = portrait(a.look, size - (stroke + 3) * 2)
    pic.classList.add('ab-ring-pic')
    return h(
      'button',
      {
        class: 'ab-ring',
        style: `width:${size}px;height:${size}px`,
        title: `Memória: ${c.percent}% (${c.used.toLocaleString('pt-BR')} de ${c.max.toLocaleString('pt-BR')} tokens). Clique para compactar ou limpar.`,
        onclick: (e: Event) => {
          e.stopPropagation()
          this.memMenuOpen = !this.memMenuOpen
          this.renderHead(a, this.state.itemsFor(a.id).permissions[0]?.id)
        },
      },
      ring,
      pic,
      h('span', { class: 'ab-ring-pct' }, `${c.percent}%`),
    )
  }

  protected memMenu(a: AgentSummary, busy: boolean): HTMLElement {
    const done = () => {
      this.memMenuOpen = false
      this.render()
    }
    return h(
      'div',
      { class: 'ab-menu', onclick: (e: Event) => e.stopPropagation() },
      h('div', { class: 'ab-menu-head' }, `Memória ${a.context!.percent}% usada`),
      h(
        'button',
        {
          disabled: busy,
          title: busy ? 'Espere o agente terminar para compactar.' : 'Resume a conversa até aqui. O agente continua sabendo o essencial.',
          onclick: () => {
            window.office.compact(a.id)
            done()
          },
        },
        icon('compact', 14),
        'Compactar',
        h('small', {}, '/compact'),
      ),
      h(
        'button',
        {
          onclick: () => {
            done()
            this.clear(a)
          },
        },
        icon('reset', 14),
        'Limpar e começar do zero',
        h('small', {}, '/clear'),
      ),
    )
  }

  /** The open half of the badge: status, stamps, memory blocks and the rarer actions. */
  protected badgeDetails(a: AgentSummary, led: HTMLElement, busy: boolean): HTMLElement {
    const office = a.source === 'office'
    const effort = a.effort ? (EFFORTS.find((e) => e.value === a.effort)?.label.toLowerCase() ?? a.effort) : null
    return h(
      'div',
      { class: 'ab-more' },
      led,
      h(
        'div',
        { class: 'ab-stamps' },
        h('button', { class: 'ab-stamp', title: `${a.cwd}\n${osText(this.state.platform).revealTitle}`, onclick: () => window.office.revealPath(a.cwd) }, icon('folder', 12), shortPath(a.cwd)),
        a.worktree ? h('button', { class: 'ab-stamp', title: `Cópia isolada (worktree)\n${a.worktree.root}\n${osText(this.state.platform).revealTitle}`, onclick: () => window.office.revealPath(a.worktree!.root) }, icon('branch', 12), a.worktree.branch) : null,
        a.model ? h('span', { class: 'ab-stamp', title: a.model }, icon('cpu', 12), modelLabel(a.model)) : null,
        effort ? h('span', { class: 'ab-stamp', title: 'Esforço' }, icon('gauge', 12), effort) : null,
        a.costUsd ? h('span', { class: 'ab-stamp', title: 'Gasto nesta sessão' }, icon('coin', 12), formatCost(a.costUsd)) : null,
      ),
      office && a.context ? this.memoryBlocks(a, busy) : null,
      h(
        'div',
        { class: 'ab-foot' },
        h('button', { class: 'btn btn-small', onclick: () => this.actions.goTo(a.id) }, icon('walk', 14), 'Ir até'),
        office
          ? h('button', { class: 'btn btn-small', title: 'Guarda nome, aparência, modelo, permissões e a primeira tarefa para contratar de novo', onclick: () => void saveAgentAsTemplate(this.root, this.state, a, this.actions.toast) }, icon('copy', 14), 'Salvar como modelo')
          : null,
        office
          ? h('button', { class: 'ab-fire', onclick: () => this.fire(a) }, 'Dispensar agente')
          : h('button', { class: 'ab-fire', onclick: () => this.actions.closeTerminal(a.id) }, 'Fechar sessão'),
      ),
    )
  }

  /** How full the agent's memory is, in ten blocks, with ways to free it. */
  protected memoryBlocks(a: AgentSummary, busy: boolean): HTMLElement {
    const c = a.context!
    const level = contextLevel(c.percent)
    const lit = Math.min(10, Math.round(c.percent / 10))
    const hint =
      level === 'full'
        ? 'Quase cheia. Ao encher, o Claude compacta sozinho e pode esquecer detalhes. Compacte agora ou limpe se a próxima tarefa for outra.'
        : level === 'warn'
          ? 'Enchendo. Se a próxima tarefa não tem a ver com esta, limpe.'
          : null
    return h(
      'div',
      { class: `ab-mem ctx-${level}` },
      h(
        'div',
        { class: 'ab-mem-row' },
        h('span', { class: 'ab-mem-label' }, 'Memória'),
        h('div', { class: 'ab-blocks' }, ...Array.from({ length: 10 }, (_, i) => h('i', { class: i < lit ? 'on' : '' }))),
        h('span', { class: 'ctx-num', title: `${c.used.toLocaleString('pt-BR')} de ${c.max.toLocaleString('pt-BR')} tokens` }, `${c.percent}%`),
        h('button', {
          class: 'btn btn-small',
          title: 'Resume a conversa até aqui (/compact). O agente continua sabendo o essencial.',
          disabled: busy,
          onclick: () => window.office.compact(a.id),
        }, 'Compactar'),
        h('button', {
          class: 'btn btn-small',
          title: 'Começa uma conversa nova com o mesmo agente (/clear).',
          onclick: () => this.clear(a),
        }, 'Limpar'),
      ),
      hint ? h('div', { class: 'ctx-hint' }, hint) : null,
    )
  }

  protected toggleBadge(): void {
    this.badgeOpen = !this.badgeOpen
    localStorage.setItem(BADGE_OPEN_KEY, this.badgeOpen ? '1' : '0')
    this.render()
  }

  protected async clear(a: AgentSummary): Promise<void> {
    if (!confirm(`Limpar a memória de ${a.name}? Ele continua no escritório, mas esquece esta conversa. O histórico fica salvo na Central de resume.`)) return
    await window.office.clearContext(a.id)
  }

  protected async fire(a: AgentSummary): Promise<void> {
    // With a worktree the native dialog (keep or remove the copy) is the confirmation.
    const asked = await window.office.prepareFire(a.id)
    if (asked === 'cancelled') return
    if (asked === 'plain' && !confirm(`Dispensar ${a.name}? A sessão para e o agente vai embora pelo elevador.`)) return
    const note = await window.office.fire(a.id)
    if (note) this.actions.toast(note, 'info')
    this.close()
  }
}
