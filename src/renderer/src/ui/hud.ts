import type { AgentStatus, AgentSummary } from '@shared/types'
import type { State } from '../state'
import { formatCost, h, icon, timeAgo } from './dom'
import { portrait } from './portrait'

export interface HudActions {
  openAgent(id: string): void
  focusAgent(id: string): void
  openItem(agentId: string, itemId: string): void
  hire(): void
  settings(): void
  goHome(): void
  bridge(): void
  zoom(delta: number): void
  dropGun(): void
  resume(): void
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  starting: 'Chegando',
  working: 'Trabalhando',
  waiting: 'Esperando você',
  done: 'Terminou',
  idle: 'Livre',
  error: 'Com problema',
  stopped: 'Parado',
}

/** Brand bar, agent roster, bottom dock, inbox popover and toasts. */
export class Hud {
  private roster: HTMLDivElement
  private rosterList: HTMLDivElement
  private rosterCount: HTMLSpanElement
  private stats: HTMLDivElement
  private inboxBtn: HTMLButtonElement
  private inboxBadge: HTMLSpanElement
  private inbox: HTMLDivElement
  private bridgeBtn: HTMLButtonElement
  private dockName: HTMLSpanElement
  private dockPortrait: HTMLSpanElement
  private toasts: HTMLDivElement
  private empty: HTMLDivElement
  private armed: HTMLDivElement

  constructor(
    root: HTMLElement,
    private state: State,
    private actions: HudActions,
  ) {
    const mac = state.platform === 'darwin'
    this.stats = h('div', { class: 'brand-stats' })
    const brand = h(
      'div',
      { class: 'brand' + (mac ? ' brand-mac' : '') },
      h('div', { class: 'brand-row' }, h('span', { class: 'brand-mark' }, '✳'), h('span', { class: 'brand-name' }, 'Agent Office')),
      this.stats,
    )

    this.rosterCount = h('span', { class: 'roster-count' })
    this.rosterList = h('div', { class: 'roster-list' })
    this.roster = h(
      'div',
      { class: 'roster card' },
      h('div', { class: 'roster-head' }, icon('users', 16), h('span', {}, 'Agentes'), this.rosterCount),
      this.rosterList,
    )

    this.inboxBadge = h('span', { class: 'badge hidden' })
    this.inboxBtn = h('button', { class: 'dock-btn', title: 'Caixa de entrada', onclick: () => this.toggleInbox() }, icon('inbox'), this.inboxBadge)
    this.bridgeBtn = h('button', { class: 'dock-btn', title: 'Sessões do terminal', onclick: () => actions.bridge() }, icon('terminal'))
    this.dockName = h('span', { class: 'dock-name' })
    this.dockPortrait = h('span', { class: 'dock-portrait' })
    const dock = h(
      'div',
      { class: 'dock card' },
      h('button', { class: 'dock-me', onclick: () => actions.settings(), title: 'Seu avatar' }, this.dockPortrait, h('span', { class: 'dot dot-you' }), this.dockName),
      h('div', { class: 'dock-sep' }),
      h('button', { class: 'dock-primary', onclick: () => actions.hire() }, icon('plus'), 'Contratar agente'),
      this.inboxBtn,
      h('button', { class: 'dock-btn', title: 'Central de resume: retomar sessões recentes', onclick: () => actions.resume() }, icon('history')),
      h('button', { class: 'dock-btn', title: 'Ir para minha sala', onclick: () => actions.goHome() }, icon('home')),
      this.bridgeBtn,
      h('button', { class: 'dock-btn', title: 'Configurações', onclick: () => actions.settings() }, icon('gear')),
    )
    const zoom = h(
      'div',
      { class: 'zoom card' },
      h('button', { title: 'Aproximar', onclick: () => actions.zoom(1) }, icon('zoomIn', 16)),
      h('button', { title: 'Afastar', onclick: () => actions.zoom(-1) }, icon('zoomOut', 16)),
    )
    this.armed = h(
      'div',
      { class: 'armed card hidden' },
      h('span', { class: 'armed-dot' }),
      'Airsoft na mão: clique num agente para atirar · WASD anda',
      h('button', { class: 'btn btn-small', onclick: () => actions.dropGun() }, h('kbd', {}, 'Q'), 'Largar'),
    )
    this.inbox = h('div', { class: 'inbox card hidden' })
    this.toasts = h('div', { class: 'toasts' })
    this.empty = h(
      'div',
      { class: 'empty card hidden' },
      h('div', { class: 'empty-title' }, 'Seu escritório está vazio'),
      h('div', { class: 'empty-text' }, 'Contrate um agente do Claude Code: ele chega pelo elevador, senta no computador e trabalha na tarefa. Quando precisar de você, ele vem até a sua sala.'),
      h('button', { class: 'btn btn-primary', onclick: () => actions.hire() }, icon('plus', 16), 'Contratar o primeiro agente'),
      h('button', { class: 'btn', onclick: () => actions.resume() }, icon('history', 16), 'Retomar uma sessão recente'),
      h('div', { class: 'empty-hint' }, 'Clique no chão para andar · WASD · arraste com o botão direito · roda do mouse = zoom'),
    )
    root.append(brand, this.roster, dock, zoom, this.inbox, this.toasts, this.empty, this.armed)
    document.addEventListener('pointerdown', (e) => {
      if (!this.inbox.classList.contains('hidden') && !this.inbox.contains(e.target as Node) && !this.inboxBtn.contains(e.target as Node)) {
        this.inbox.classList.add('hidden')
      }
    })
    this.render()
  }

  render(): void {
    const agents = [...this.state.agents.values()].sort((a, b) => a.desk - b.desk)
    const working = agents.filter((a) => a.status === 'working' || a.status === 'starting').length
    const waiting = this.state.inboxCount
    this.stats.textContent = agents.length
      ? `${working} trabalhando${waiting ? ` · ${waiting} esperando você` : ''}`
      : 'Nenhum agente ainda'
    this.rosterCount.textContent = String(agents.length)
    this.roster.classList.toggle('hidden', agents.length === 0)
    this.empty.classList.toggle('hidden', agents.length > 0)

    this.rosterList.replaceChildren(...agents.map((a) => this.rosterRow(a)))

    const n = this.state.inboxCount
    this.inboxBadge.textContent = String(n)
    this.inboxBadge.classList.toggle('hidden', n === 0)
    this.inboxBtn.classList.toggle('pulse', n > 0)
    const b = this.state.bridge
    this.bridgeBtn.classList.toggle('on', b.installed && b.listening)
    this.bridgeBtn.title = b.installed ? (b.listening ? 'Sessões do terminal conectadas' : 'Ponte do terminal com erro') : 'Conectar sessões do terminal'
    this.dockName.textContent = this.state.settings.playerName
    this.dockPortrait.replaceChildren(portrait(this.state.settings.playerLook, 26))
    if (!this.inbox.classList.contains('hidden')) this.renderInbox()
  }

  private rosterRow(a: AgentSummary): HTMLElement {
    const items = this.state.itemsFor(a.id)
    const pending = items.permissions.length + items.results.length
    return h(
      'div',
      { class: `roster-row status-${a.status}`, onclick: () => this.actions.openAgent(a.id) },
      portrait(a.look, 34),
      h(
        'div',
        { class: 'roster-main' },
        h(
          'div',
          { class: 'roster-name' },
          h('span', { class: `dot dot-${a.status}` }),
          h('span', { class: 'name' }, a.name),
          a.source === 'terminal' ? h('span', { class: 'chip chip-term' }, 'terminal') : null,
        ),
        h('div', { class: 'roster-activity' }, pending ? (items.permissions.length ? 'Esperando sua decisão' : 'Quer te entregar o resultado') : a.activity),
      ),
      h(
        'div',
        { class: 'roster-side' },
        pending ? h('span', { class: 'badge' }, String(pending)) : h('span', { class: 'roster-cost' }, formatCost(a.costUsd)),
        h('button', {
          class: 'icon-btn',
          title: 'Ver no mapa',
          onclick: (e: Event) => {
            e.stopPropagation()
            this.actions.focusAgent(a.id)
          },
        }, icon('eye', 15)),
      ),
    )
  }

  private toggleInbox(): void {
    this.inbox.classList.toggle('hidden')
    if (!this.inbox.classList.contains('hidden')) this.renderInbox()
  }

  private renderInbox(): void {
    const rows: HTMLElement[] = []
    const nameOf = (id: string) => this.state.agents.get(id)
    for (const p of [...this.state.permissions.values()].sort((a, b) => a.createdAt - b.createdAt)) {
      const a = nameOf(p.agentId)
      if (!a) continue
      rows.push(
        h(
          'button',
          { class: 'inbox-row', onclick: () => this.pick(p.agentId, p.id) },
          portrait(a.look, 30),
          h('div', { class: 'inbox-main' }, h('div', { class: 'inbox-name' }, a.name, h('span', { class: 'chip chip-wait' }, p.kind === 'question' ? 'pergunta' : p.kind === 'plan' ? 'plano' : 'permissão')), h('div', { class: 'inbox-text' }, p.title)),
          h('span', { class: 'inbox-time' }, timeAgo(p.createdAt)),
        ),
      )
    }
    for (const r of this.state.results.values()) {
      const a = nameOf(r.agentId)
      if (!a) continue
      rows.push(
        h(
          'button',
          { class: 'inbox-row', onclick: () => this.pick(r.agentId, r.id) },
          portrait(a.look, 30),
          h('div', { class: 'inbox-main' }, h('div', { class: 'inbox-name' }, a.name, h('span', { class: r.isError ? 'chip chip-err' : 'chip chip-done' }, r.isError ? 'erro' : 'resultado')), h('div', { class: 'inbox-text' }, r.text.slice(0, 90))),
          h('span', { class: 'inbox-time' }, timeAgo(r.createdAt)),
        ),
      )
    }
    this.inbox.replaceChildren(
      h('div', { class: 'inbox-head' }, 'Caixa de entrada'),
      ...(rows.length ? rows : [h('div', { class: 'inbox-empty' }, 'Nada pendente. Seus agentes estão trabalhando.')]),
    )
  }

  private pick(agentId: string, itemId: string): void {
    this.inbox.classList.add('hidden')
    this.actions.openItem(agentId, itemId)
  }

  setArmed(armed: boolean): void {
    this.armed.classList.toggle('hidden', !armed)
  }

  toast(text: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
    const el = h('div', { class: `toast toast-${kind}` }, text)
    this.toasts.append(el)
    setTimeout(() => el.classList.add('out'), 3800)
    setTimeout(() => el.remove(), 4300)
  }
}
