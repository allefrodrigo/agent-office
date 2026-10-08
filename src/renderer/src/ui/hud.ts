import type { AgentStatus, AgentSummary } from '@shared/types'
import type { State } from '../state'
import { formatCost, h, icon, timeAgo } from './dom'
import { osText } from './os-text'
import { contextLevel } from './panel'
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
  summon(): void
  board(ticketId?: string): void
}

/** 1.2 GB, 640 MB */
function bytes(n: number, gbDigits = 1): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(gbDigits).replace('.', ',')} GB`
  return `${Math.round(n / 1024 ** 2)} MB`
}

/** "23:00" today, "amanhã 07:00", or "qui 07:00". */
function resetText(t: number): string {
  const d = new Date(t)
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
  if (days <= 0) return hm
  if (days === 1) return `amanhã ${hm}`
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${hm}`
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
  private usage: HTMLDivElement
  private system: HTMLDivElement
  private boardBtn: HTMLButtonElement
  private boardBadge: HTMLSpanElement

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
    this.bridgeBtn = h('button', { class: 'dock-btn', title: 'Sessões do terminal', onclick: () => actions.bridge() }, icon('plug'))
    this.boardBadge = h('span', { class: 'badge badge-review hidden' })
    this.boardBtn = h('button', { class: 'dock-btn', title: 'Quadro de tickets (T)', onclick: () => actions.board() }, icon('kanban'), this.boardBadge)
    this.dockName = h('span', { class: 'dock-name' })
    this.dockPortrait = h('span', { class: 'dock-portrait' })
    const dock = h(
      'div',
      { class: 'dock card' },
      h('button', { class: 'dock-me', onclick: () => actions.settings(), title: 'Seu avatar' }, this.dockPortrait, h('span', { class: 'dot dot-you' }), this.dockName),
      h('div', { class: 'dock-sep' }),
      h('button', { class: 'dock-primary', onclick: () => actions.hire() }, icon('plus'), 'Contratar agente'),
      this.inboxBtn,
      this.boardBtn,
      h('button', { class: 'dock-btn', title: 'Chamar agente: só escolher a pasta e conversar', onclick: () => actions.summon() }, icon('terminal')),
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
    this.usage = h('div', { class: 'usage card' })
    this.system = h('div', { class: 'usage card hidden' })
    const side = h('div', { class: 'hud-side' + (mac ? ' hud-side-mac' : '') }, this.usage, this.system)
    this.inbox = h('div', { class: 'inbox card hidden' })
    this.toasts = h('div', { class: 'toasts' })
    this.empty = h(
      'div',
      { class: 'empty card hidden' },
      h('div', { class: 'empty-title' }, 'Seu escritório está vazio'),
      h('div', { class: 'empty-text' }, 'Contrate um agente do Claude Code: ele chega pelo elevador, senta no computador e trabalha na tarefa. Quando precisar de você, ele vem até a sua sala.'),
      h('button', { class: 'btn btn-primary', onclick: () => actions.hire() }, icon('plus', 16), 'Contratar o primeiro agente'),
      h('button', { class: 'btn', onclick: () => actions.summon() }, icon('terminal', 16), 'Chamar um agente sem tarefa'),
      h('button', { class: 'btn', onclick: () => actions.resume() }, icon('history', 16), 'Retomar uma sessão recente'),
      h('button', { class: 'btn', onclick: () => actions.board() }, icon('kanban', 16), 'Abrir o quadro de tickets'),
      h('div', { class: 'empty-hint' }, 'Clique no chão para andar · WASD · arraste com o botão direito · roda do mouse = zoom'),
    )
    root.append(brand, side, this.roster, dock, zoom, this.inbox, this.toasts, this.empty, this.armed)
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
    const review = this.state.reviewCount
    this.boardBadge.textContent = String(review)
    this.boardBadge.classList.toggle('hidden', review === 0)
    this.boardBtn.title = review ? `Quadro de tickets (T): ${review} esperando revisão` : 'Quadro de tickets (T)'
    const b = this.state.bridge
    this.bridgeBtn.classList.toggle('on', b.installed && b.listening)
    this.bridgeBtn.title = b.installed ? (b.listening ? 'Sessões do terminal conectadas' : 'Ponte do terminal com erro') : 'Conectar sessões do terminal'
    this.dockName.textContent = this.state.settings.playerName
    this.dockPortrait.replaceChildren(portrait(this.state.settings.playerLook, 26))
    if (!this.inbox.classList.contains('hidden')) this.renderInbox()
    this.renderUsage()
    this.renderSystem()
  }

  /** CPU and memory: the whole computer, the office itself, and every claude process. */
  renderSystem(): void {
    const st = this.state.system
    this.system.classList.toggle('hidden', !st)
    if (!st) return
    const memPct = Math.round((st.memUsed / st.memTotal) * 100)
    const text = osText(this.state.platform)
    const bar = (label: string, pct: number, value: string, title: string) =>
      h(
        'div',
        { class: `usage-row ctx-${contextLevel(pct)}`, title },
        h('span', { class: 'usage-label' }, label),
        h('div', { class: 'ctx-bar' }, h('div', { class: 'ctx-fill', style: `width:${Math.min(100, pct)}%` })),
        h('span', { class: 'ctx-num' }, `${pct}%`),
        h('span', { class: 'usage-reset' }, value),
      )
    const line = (label: string, cpu: number | null, mem: number, title: string) =>
      h('div', { class: 'sys-line', title }, h('span', {}, label), h('span', { class: 'sys-val' }, `${cpu === null ? '' : `${cpu}% · `}${bytes(mem)}`))
    this.system.replaceChildren(
      h('div', { class: 'usage-head' }, h('span', {}, 'Sistema')),
      bar('CPU', st.cpu, '', text.cpuTitle),
      bar('RAM', memPct, `${bytes(st.memUsed)}/${bytes(st.memTotal, 0)}`, text.ramTitle),
      h(
        'div',
        { class: 'sys-split' },
        line('Escritório', st.app.cpu, st.app.mem, 'Este app: o jogo e a interface'),
        line(`Agentes (${st.claude.count})`, st.claude.cpu, st.claude.mem, text.agentsTitle),
      ),
    )
  }

  /** Plan limits: 5-hour window, week and per-model weeks, as in /usage. */
  private renderUsage(): void {
    const u = this.state.usage
    this.usage.classList.toggle('hidden', !u.windows.length && !u.error)
    const refresh = h('button', {
      class: 'icon-btn usage-refresh',
      title: u.error ? `Não consegui atualizar: ${u.error}` : `Atualizado ${timeAgo(u.updatedAt)}. Clique para atualizar.`,
      onclick: async () => {
        refresh.classList.add('spin')
        await window.office.refreshUsage().catch(() => undefined)
      },
    }, icon('history', 13))
    this.usage.replaceChildren(
      h('div', { class: 'usage-head' }, h('span', {}, 'Limites do plano'), u.error ? h('span', { class: 'usage-stale' }, 'desatualizado') : null, refresh),
      ...u.windows.map((w) =>
        h(
          'div',
          { class: `usage-row ctx-${contextLevel(w.percent)}`, title: w.resetsAt ? `Renova ${resetText(w.resetsAt)}` : '' },
          h('span', { class: 'usage-label' }, w.label),
          h('div', { class: 'ctx-bar' }, h('div', { class: 'ctx-fill', style: `width:${Math.min(100, w.percent)}%` })),
          h('span', { class: 'ctx-num' }, `${w.percent}%`),
          h('span', { class: 'usage-reset' }, w.resetsAt ? resetText(w.resetsAt) : ''),
        ),
      ),
    )
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
          this.ticketChip(a.id),
        ),
        h('div', { class: 'roster-activity' }, pending ? (items.permissions.length ? 'Esperando sua decisão' : 'Quer te entregar o resultado') : a.activity),
        a.context
          ? h('div', { class: `ctx-mini ctx-${contextLevel(a.context.percent)}`, title: `Contexto: ${a.context.percent}%` }, h('div', { class: 'ctx-fill', style: `width:${Math.min(100, a.context.percent)}%` }))
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
