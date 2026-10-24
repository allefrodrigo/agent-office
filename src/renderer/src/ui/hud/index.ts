import { canAddFloor } from '@shared/projects'
import type { AgentStatus, AgentSummary } from '@shared/types'
import type { State } from '../../state'
import { DEFAULT_BRAND } from '../../world/brand'
import { arrowList, asDialog, keepFocus, rove } from '../a11y'
import { accountChip } from '../accounts'
import { formatCost, h, icon, timeAgo } from '../dom'
import { memoryLevel } from '@shared/economy'
import { helpersChip, tokensLabel, warnTokens } from '../panel'
import { portrait } from '../portrait'
import type { Radio } from '../radio'
import { InfoCard } from './info'

export interface HudActions {
  openAgent(id: string): void
  focusAgent(id: string): void
  openItem(agentId: string, itemId: string): void
  /** Configurações; `'bridge'` opens it scrolled to the terminal sessions. */
  settings(section?: 'bridge'): void
  goHome(): void
  zoom(delta: number): void
  /** Modo noturno on or off; returns the new state. */
  toggleNight(): boolean
  resume(): void
  /** "Novo agente": talk, give a task or bring up a squad. */
  newAgent(): void
  board(ticketId?: string): void
  /** Take the elevator to a floor (0 = térreo). */
  goFloor(n: number): void
  /** Add a floor for a project folder. */
  newFloor(): void
  /** Claude accounts: logins and which floor uses which. */
  accounts(): void
  /** Relatórios: spend by project, from the cost book. */
  reports(): void
  /** Sobre: version, machine and "Pedir para um agente me atualizar" (the version chip). */
  about(): void
  /** Bastidores: background processes, MCP servers and skills. */
  backstage(tab?: 'bg' | 'mcp' | 'skills' | 'wt'): void
  /** Sair do Agent Office: asks, waits for the agents or interrupts them. */
  quit(): void
}

const COMPACT_KEY = 'roster-compact'

/** Roster order: amber (waiting on you) on top, then red (failed, busy), grey, and green (free) at the bottom. */
function rosterRank(a: AgentSummary, pending: boolean): number {
  if (pending || a.status === 'waiting') return 0
  switch (a.status) {
    case 'error':
      return 1
    case 'working':
    case 'starting':
      return 2
    case 'stopped':
      return 3
    default:
      return 4
  }
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
  /** Moon by day (turns the lights off), sun by night. */
  private nightBtn: HTMLButtonElement
  private inboxBadge: HTMLSpanElement
  private inbox: HTMLDivElement
  /** Amber dot on the gear while the terminal bridge is installed but not listening. */
  private gearAlert: HTMLSpanElement
  private gearBtn: HTMLButtonElement
  private dockName: HTMLSpanElement
  private dockPortrait: HTMLSpanElement
  private toasts: HTMLDivElement
  /** Plan limits and system load. */
  private infoCard: InfoCard
  private boardBtn: HTMLButtonElement
  private boardBadge: HTMLSpanElement
  private floorsEl: HTMLDivElement
  private floorNames: string[] = ['Térreo']
  private floor = 0
  /** Roster row that Tab lands on (roving tabindex); kept across redraws. */
  private rosterActive: string | null = null

  constructor(
    root: HTMLElement,
    private state: State,
    private actions: HudActions,
    radio: Radio,
  ) {
    const mac = state.platform === 'darwin'
    this.nightBtn = h('button', { onclick: () => this.setNight(actions.toggleNight()) })
    this.stats = h('div', { class: 'brand-stats' })
    const brand = h(
      'div',
      { class: 'brand' + (mac ? ' brand-mac' : '') },
      h('div', { class: 'brand-row' }, h('span', { class: 'brand-mark' }, '✳'), h('span', { class: 'brand-name' }, 'Agent Office'), h('button', { class: 'brand-version', title: `Sobre o Agent Office (build de ${__APP_BUILD__})`, onclick: () => actions.about() }, `v${__APP_VERSION__}`)),
      this.stats,
    )

    this.rosterCount = h('span', { class: 'roster-count' })
    this.rosterList = h('div', { class: 'roster-list', role: 'list', 'aria-label': 'Agentes: setas para escolher, Enter abre o painel' })
    arrowList(this.rosterList, '.roster-row')
    this.rosterList.addEventListener('focusin', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.roster-row')
      if (row) this.rosterActive = row.dataset.focusKey ?? null
    })
    const compact = localStorage.getItem(COMPACT_KEY) === '1'
    const compactBtn = h('button', {
      class: 'icon-btn roster-compact-btn',
      title: 'Modo compacto',
      'aria-pressed': String(compact),
      onclick: () => {
        const on = this.roster.classList.toggle('compact')
        compactBtn.setAttribute('aria-pressed', String(on))
        localStorage.setItem(COMPACT_KEY, on ? '1' : '0')
      },
    }, icon('compact', 14))
    this.roster = h(
      'div',
      { class: 'roster card' + (compact ? ' compact' : ''), 'data-tour': 'roster' },
      h('div', { class: 'roster-head' }, icon('users', 16), h('span', {}, 'Agentes'), this.rosterCount, compactBtn),
      this.rosterList,
    )

    this.inboxBadge = h('span', { class: 'badge hidden' })
    this.inboxBtn = h('button', { class: 'dock-btn', 'data-tour': 'inbox', title: 'Caixa de entrada (I)', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => this.toggleInbox() }, icon('inbox'), this.inboxBadge)
    this.gearAlert = h('span', { class: 'dock-alert hidden' })
    this.gearBtn = h('button', { class: 'dock-btn', title: 'Configurações', onclick: () => actions.settings(this.bridgeFailing() ? 'bridge' : undefined) }, icon('gear'), this.gearAlert)
    this.boardBadge = h('span', { class: 'badge badge-review hidden' })
    this.boardBtn = h('button', { class: 'dock-btn', 'data-tour': 'board', title: 'Quadro de tickets (T)', onclick: () => actions.board() }, icon('kanban'), this.boardBadge)
    this.dockName = h('span', { class: 'dock-name' })
    this.dockPortrait = h('span', { class: 'dock-portrait' })
    const dock = h(
      'div',
      { class: 'dock card' },
      // Identity only: Configurações has one door, the gear.
      h('span', { class: 'dock-me', title: 'Você' }, this.dockPortrait, h('span', { class: 'dot dot-you' }), this.dockName),
      h('div', { class: 'dock-sep' }),
      h('button', { class: 'dock-primary', 'data-tour': 'new-agent', title: 'Conversar, dar uma tarefa ou subir um squad (N)', onclick: () => actions.newAgent() }, icon('plus'), 'Novo agente'),
      this.inboxBtn,
      this.boardBtn,
      h('button', { class: 'dock-btn', title: 'Relatórios: gasto por projeto, agente e modelo (R)', onclick: () => actions.reports() }, icon('report')),
      h('button', { class: 'dock-btn', title: 'Bastidores: segundo plano, MCP e skills (B)', onclick: () => actions.backstage() }, icon('rack')),
      h('button', { class: 'dock-btn', 'data-tour': 'resume', title: 'Central de resume: retomar sessões recentes', onclick: () => actions.resume() }, icon('history')),
      h('button', { class: 'dock-btn', 'data-tour': 'home', title: 'Ir para minha sala', onclick: () => actions.goHome() }, icon('home')),
      radio.button,
      this.gearBtn,
      h('button', { class: 'dock-btn dock-quit', title: 'Sair do Agent Office', 'aria-label': 'Sair do Agent Office', onclick: () => actions.quit() }, icon('power')),
    )
    const zoom = h(
      'div',
      { class: 'zoom card' },
      h('button', { title: 'Aproximar', onclick: () => actions.zoom(1) }, icon('zoomIn', 16)),
      h('button', { title: 'Afastar', onclick: () => actions.zoom(-1) }, icon('zoomOut', 16)),
      this.nightBtn,
    )
    this.floorsEl = h('div', { class: 'floors card', 'data-tour': 'floors' })
    // The roster ends above the elevator panel, which grows with every floor.
    new ResizeObserver(() => document.documentElement.style.setProperty('--floors-h', `${this.floorsEl.offsetHeight}px`)).observe(this.floorsEl)
    this.infoCard = new InfoCard(state, actions, (t, k) => this.toast(t, k))
    const side = h('div', { class: 'hud-side' + (mac ? ' hud-side-mac' : '') }, this.infoCard.info)
    this.inbox = h('div', { class: 'inbox card hidden' })
    // A popover, not a modal: the office goes on behind it. ↑/↓ pick, Enter opens, Esc closes.
    asDialog(this.inbox, { modal: false, label: 'Caixa de entrada' })
    arrowList(this.inbox, '.inbox-row')
    this.inbox.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      this.hideInbox()
      this.inboxBtn.focus()
    })
    // Read by screen readers as they come, without interrupting.
    this.toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })
    root.append(brand, side, this.roster, dock, zoom, this.floorsEl, this.inbox, this.toasts)
    document.addEventListener('pointerdown', (e) => {
      if (!this.inbox.classList.contains('hidden') && !this.inbox.contains(e.target as Node) && !this.inboxBtn.contains(e.target as Node)) {
        this.hideInbox()
      }
    })
    this.render()
  }

  /** Hooks installed but the bridge server is not listening: terminal sessions are lost. */
  private bridgeFailing(): boolean {
    const b = this.state.bridge
    return b.installed && !b.listening
  }

  render(): void {
    const rank = (a: AgentSummary) => {
      const items = this.state.itemsFor(a.id)
      return rosterRank(a, items.permissions.length + items.results.length > 0)
    }
    const agents = [...this.state.agents.values()].sort((a, b) => rank(a) - rank(b) || a.desk - b.desk)
    const working = agents.filter((a) => a.status === 'working' || a.status === 'starting').length
    const waiting = this.state.inboxCount
    this.stats.textContent = agents.length
      ? `${working} trabalhando${waiting ? ` · ${waiting} esperando você` : ''}`
      : 'Nenhum agente ainda'
    this.rosterCount.textContent = String(agents.length)
    this.roster.classList.toggle('hidden', agents.length === 0)

    keepFocus(this.rosterList, () => this.rosterList.replaceChildren(...agents.map((a) => this.rosterRow(a))))
    const rows = [...this.rosterList.querySelectorAll<HTMLElement>('.roster-row')]
    const active = rows.findIndex((r) => r.dataset.focusKey === this.rosterActive)
    rove(rows, Math.max(0, active))

    const n = this.state.inboxCount
    this.inboxBadge.textContent = String(n)
    this.inboxBadge.classList.toggle('hidden', n === 0)
    this.inboxBtn.classList.toggle('pulse', n > 0)
    const review = this.state.reviewCount
    this.boardBadge.textContent = String(review)
    this.boardBadge.classList.toggle('hidden', review === 0)
    this.boardBtn.title = review ? `Quadro de tickets (T): ${review} esperando revisão` : 'Quadro de tickets (T)'
    const failing = this.bridgeFailing()
    this.gearAlert.classList.toggle('hidden', !failing)
    this.gearBtn.title = failing ? 'Ponte do terminal com erro: abra Configurações' : 'Configurações'
    this.dockName.textContent = this.state.settings.playerName
    this.dockPortrait.replaceChildren(portrait(this.state.settings.playerLook, 26))
    if (!this.inbox.classList.contains('hidden')) this.renderInbox()
    this.renderInfo()
    this.renderFloors()
  }

  /** Floors the elevator serves and the one the player is on. */
  setFloors(names: string[], current: number): void {
    this.floorNames = names
    this.floor = current
    this.renderFloors()
  }

  /** Agents busy or waiting on a floor: each one on its project's floor, or downstairs. */
  private floorActivity(n: number): { count: number; waiting: boolean } {
    let count = 0
    let waiting = false
    for (const a of this.state.agents.values()) {
      const items = this.state.itemsFor(a.id)
      const pending = items.permissions.length + items.results.length > 0 || a.status === 'waiting'
      // A project agent with something for you takes the elevator to wherever you are.
      const home = this.state.floorOf(a)
      const floor = home > 0 && pending ? this.floor : home
      if (floor !== n) continue
      if (pending || a.status === 'working' || a.status === 'starting' || a.subagents?.length) count++
      waiting ||= pending
    }
    return { count, waiting }
  }

  /** Elevator panel: one button per floor, top floor first, with a badge for activity elsewhere. */
  private renderFloors(): void {
    const names = this.floorNames
    const rows = names
      .map((name, n) => {
        const act = this.floorActivity(n)
        const badge = n !== this.floor && act.count ? h('span', { class: `badge${act.waiting ? '' : ' badge-review'}`, title: act.waiting ? 'Alguém esperando você neste andar' : 'Agentes trabalhando neste andar' }, String(act.count)) : null
        return h(
          'button',
          { class: `floor-btn${n === this.floor ? ' on' : ''}${badge && act.waiting ? ' pulse' : ''}`, title: n === this.floor ? `Você está no ${name}` : `Ir para ${name} pelo elevador`, onclick: () => this.actions.goFloor(n) },
          h('span', { class: 'floor-num' }, n === 0 ? 'T' : String(n)),
          h('span', { class: 'floor-name' }, n > 0 && this.state.settings.projects[n - 1]?.kind === 'creative' ? `🎨 ${name}` : name),
          badge,
        )
      })
      .reverse()
    const add =
      canAddFloor(this.state.settings.projects, 'project') || canAddFloor(this.state.settings.projects, 'creative')
        ? h('button', { class: 'floor-btn floor-add', title: 'Um andar para um projeto (quem você contrata ou chama lá trabalha na pasta dele) ou o andar criativo, com o estúdio de imagens e posts', onclick: () => this.actions.newFloor() }, h('span', { class: 'floor-num' }, icon('plus', 12)), h('span', { class: 'floor-name' }, 'Novo andar'))
        : null
    this.floorsEl.replaceChildren(h('div', { class: 'floors-head' }, 'Elevador'), ...rows, ...(add ? [add] : []))
  }

  /** Redraws the limits and load card (also when usage or system numbers arrive). */
  renderInfo(): void {
    this.infoCard.renderInfo()
  }

  /** The ticket key an agent is working on; opens it on the board. */
  private ticketChip(agentId: string): HTMLElement | null {
    const t = this.state.ticketFor(agentId)
    if (!t) return null
    return h('button', {
      class: 'chip chip-ticket',
      title: `Trabalhando em ${t.key}: ${t.title}`,
      onclick: (e: Event) => {
        e.stopPropagation()
        this.actions.board(t.id)
      },
    }, t.key)
  }

  /** Project floor the agent works on, in the company color; click takes the elevator there. Nothing on the ground floor. */
  private floorChip(a: AgentSummary): HTMLElement | null {
    const n = this.state.floorOf(a)
    const p = this.state.settings.projects[n - 1]
    if (!p) return null
    return h('button', {
      class: 'chip chip-floor',
      style: `--floor:${p.brandColor ?? DEFAULT_BRAND}`,
      title: `Trabalhando no ${n}º andar: ${p.name} (${p.cwd})`,
      onclick: (e: Event) => {
        e.stopPropagation()
        this.actions.goFloor(n)
      },
    }, h('span', { class: 'chip-floor-num' }, String(n)), h('span', { class: 'chip-floor-name' }, p.name))
  }

  private rosterRow(a: AgentSummary): HTMLElement {
    const items = this.state.itemsFor(a.id)
    const pending = items.permissions.length + items.results.length
    const activity = pending ? (items.permissions.length ? 'Esperando sua decisão' : 'Quer te entregar o resultado') : a.activity
    const row = h(
      'div',
      {
        class: `roster-row status-${a.status}${pending ? ' has-pending' : ''}`,
        role: 'listitem',
        tabindex: -1,
        'data-focus-key': a.id,
        'aria-label': `${a.name}, ${STATUS_LABEL[a.status].toLowerCase()}: ${activity}`,
        onclick: () => this.actions.openAgent(a.id),
      },
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
          helpersChip(a, true),
          this.floorChip(a),
          accountChip(this.state, a),
          this.ticketChip(a.id),
        ),
        h('div', { class: 'roster-activity' }, activity),
        a.context
          ? h('div', { class: `ctx-mini ctx-${memoryLevel(a.context, warnTokens(this.state.settings))}`, title: `Contexto: ${a.context.percent}% · ${tokensLabel(a.context.used)}` }, h('div', { class: 'ctx-fill', style: `width:${Math.min(100, a.context.percent)}%` }))
          : null,
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
    row.addEventListener('keydown', (e) => {
      if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault()
      e.stopPropagation()
      this.actions.openAgent(a.id)
    })
    return row
  }

  /** Bastidores from the keyboard (B). */
  openBackstage(): void {
    this.actions.backstage()
  }

  /** Shows the night button's state: the icon is what a click does next. */
  setNight(on: boolean): void {
    this.nightBtn.replaceChildren(icon(on ? 'sun' : 'moon', 16))
    this.nightBtn.title = on ? 'Acender as luzes (L)' : 'Apagar as luzes: modo noturno (L)'
    this.nightBtn.setAttribute('aria-pressed', String(on))
  }

  /** Opens or closes the inbox popover (dock button or I). */
  toggleInbox(): void {
    if (!this.inbox.classList.contains('hidden')) return this.hideInbox()
    this.inbox.classList.remove('hidden')
    this.inboxBtn.setAttribute('aria-expanded', 'true')
    this.renderInbox()
    // Focus on the first item, so ↓ and Enter work right away.
    const first = this.inbox.querySelector<HTMLElement>('.inbox-row')
    if (first) first.focus()
    else this.inbox.focus()
  }

  private hideInbox(): void {
    this.inbox.classList.add('hidden')
    this.inboxBtn.setAttribute('aria-expanded', 'false')
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
          { class: 'inbox-row', 'data-focus-key': p.id, onclick: () => this.pick(p.agentId, p.id) },
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
          { class: 'inbox-row', 'data-focus-key': r.id, onclick: () => this.pick(r.agentId, r.id) },
          portrait(a.look, 30),
          h('div', { class: 'inbox-main' }, h('div', { class: 'inbox-name' }, a.name, h('span', { class: r.isError ? 'chip chip-err' : 'chip chip-done' }, r.isError ? 'erro' : 'resultado')), h('div', { class: 'inbox-text' }, r.text.slice(0, 90))),
          h('span', { class: 'inbox-time' }, timeAgo(r.createdAt)),
        ),
      )
    }
    keepFocus(this.inbox, () =>
      this.inbox.replaceChildren(
        h('div', { class: 'inbox-head' }, 'Caixa de entrada'),
        ...(rows.length ? rows : [h('div', { class: 'inbox-empty' }, 'Nada pendente. Seus agentes estão trabalhando.')]),
      ),
    )
    const all = [...this.inbox.querySelectorAll<HTMLElement>('.inbox-row')]
    const at = all.indexOf(document.activeElement as HTMLElement)
    rove(all, Math.max(0, at))
  }

  private pick(agentId: string, itemId: string): void {
    // The card gives the focus back to the inbox button when it closes.
    if (this.inbox.contains(document.activeElement)) this.inboxBtn.focus()
    this.hideInbox()
    this.actions.openItem(agentId, itemId)
  }

  toast(text: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
    const el = h('div', { class: `toast toast-${kind}` }, text)
    this.toasts.append(el)
    setTimeout(() => el.classList.add('out'), 3800)
    setTimeout(() => el.remove(), 4300)
  }
}
