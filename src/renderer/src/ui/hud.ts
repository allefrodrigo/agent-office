import { MAX_PROJECT_FLOORS } from '@shared/projects'
import type { AgentStatus, AgentSummary, PlanUsage, UsageWindow } from '@shared/types'
import type { State } from '../state'
import { DEFAULT_BRAND } from '../world/brand'
import { accountChip } from './accounts'
import { formatCost, h, icon, timeAgo } from './dom'
import { contextLevel, helpersChip } from './panel'
import { portrait } from './portrait'
import type { Radio } from './radio'

export interface HudActions {
  openAgent(id: string): void
  focusAgent(id: string): void
  openItem(agentId: string, itemId: string): void
  /** Configurações; `'bridge'` opens it scrolled to the terminal sessions. */
  settings(section?: 'bridge'): void
  goHome(): void
  zoom(delta: number): void
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
}

const INFO_OPEN_KEY = 'hud-info-open'

/** One account's line in the info card. */
interface InfoRow {
  u: PlanUsage
  name: string
  color: string
  email?: string
  /** Office agents running on it now. */
  agents: number
  loggedOut: boolean
  /** Out of room until then (ms). */
  limitedUntil?: number
}

/** Time until a reset: "42min", "1h12", "4d". */
function leftText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 60) return `${min}min`
  if (min < 24 * 60) return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
  return `${Math.round(min / 1440)}d`
}

/** "4% · 705 MB"; cpu is null where unknown (Windows). */
function procText(cpu: number | null, mem: number): string {
  return `${cpu === null ? '' : `${cpu}% · `}${bytes(mem)}`
}

/** A bar in square blocks, like the agent badge's memory. */
function blocks(percent: number, count: number): HTMLElement {
  const lit = Math.min(count, Math.round((percent / 100) * count))
  return h('div', { class: 'info-blocks' }, ...Array.from({ length: count }, (_, i) => h('i', { class: i < lit ? 'on' : '' })))
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
  /** Amber dot on the gear while the terminal bridge is installed but not listening. */
  private gearAlert: HTMLSpanElement
  private gearBtn: HTMLButtonElement
  private dockName: HTMLSpanElement
  private dockPortrait: HTMLSpanElement
  private toasts: HTMLDivElement
  /** Plan limits and system load; see renderInfo. */
  private info: HTMLDivElement
  private infoOpen = localStorage.getItem(INFO_OPEN_KEY) === '1'
  private boardBtn: HTMLButtonElement
  private boardBadge: HTMLSpanElement
  private floorsEl: HTMLDivElement
  private floorNames: string[] = ['Térreo']
  private floor = 0

  constructor(
    root: HTMLElement,
    private state: State,
    private actions: HudActions,
    radio: Radio,
  ) {
    const mac = state.platform === 'darwin'
    this.stats = h('div', { class: 'brand-stats' })
    const brand = h(
      'div',
      { class: 'brand' + (mac ? ' brand-mac' : '') },
      h('div', { class: 'brand-row' }, h('span', { class: 'brand-mark' }, '✳'), h('span', { class: 'brand-name' }, 'Agent Office'), h('span', { class: 'brand-version', title: `Build de ${__APP_BUILD__}` }, `v${__APP_VERSION__}`)),
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
    this.gearAlert = h('span', { class: 'dock-alert hidden' })
    this.gearBtn = h('button', { class: 'dock-btn', title: 'Configurações', onclick: () => actions.settings(this.bridgeFailing() ? 'bridge' : undefined) }, icon('gear'), this.gearAlert)
    this.boardBadge = h('span', { class: 'badge badge-review hidden' })
    this.boardBtn = h('button', { class: 'dock-btn', title: 'Quadro de tickets (T)', onclick: () => actions.board() }, icon('kanban'), this.boardBadge)
    this.dockName = h('span', { class: 'dock-name' })
    this.dockPortrait = h('span', { class: 'dock-portrait' })
    const dock = h(
      'div',
      { class: 'dock card' },
      // Identity only: Configurações has one door, the gear.
      h('span', { class: 'dock-me', title: 'Você' }, this.dockPortrait, h('span', { class: 'dot dot-you' }), this.dockName),
      h('div', { class: 'dock-sep' }),
      h('button', { class: 'dock-primary', title: 'Conversar, dar uma tarefa ou subir um squad (N)', onclick: () => actions.newAgent() }, icon('plus'), 'Novo agente'),
      this.inboxBtn,
      this.boardBtn,
      h('button', { class: 'dock-btn', title: 'Relatórios: gasto por projeto, agente e modelo (R)', onclick: () => actions.reports() }, icon('report')),
      h('button', { class: 'dock-btn', title: 'Central de resume: retomar sessões recentes', onclick: () => actions.resume() }, icon('history')),
      h('button', { class: 'dock-btn', title: 'Ir para minha sala', onclick: () => actions.goHome() }, icon('home')),
      radio.button,
      this.gearBtn,
    )
    const zoom = h(
      'div',
      { class: 'zoom card' },
      h('button', { title: 'Aproximar', onclick: () => actions.zoom(1) }, icon('zoomIn', 16)),
      h('button', { title: 'Afastar', onclick: () => actions.zoom(-1) }, icon('zoomOut', 16)),
    )
    this.floorsEl = h('div', { class: 'floors card' })
    // The roster ends above the elevator panel, which grows with every floor.
    new ResizeObserver(() => document.documentElement.style.setProperty('--floors-h', `${this.floorsEl.offsetHeight}px`)).observe(this.floorsEl)
    this.info = h('div', { class: 'info card hidden' })
    const side = h('div', { class: 'hud-side' + (mac ? ' hud-side-mac' : '') }, this.info)
    this.inbox = h('div', { class: 'inbox card hidden' })
    this.toasts = h('div', { class: 'toasts' })
    root.append(brand, side, this.roster, dock, zoom, this.floorsEl, this.inbox, this.toasts)
    document.addEventListener('pointerdown', (e) => {
      if (!this.inbox.classList.contains('hidden') && !this.inbox.contains(e.target as Node) && !this.inboxBtn.contains(e.target as Node)) {
        this.inbox.classList.add('hidden')
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
    const agents =[...this.state.agents.values()].sort((a, b) => a.desk - b.desk)
    const working = agents.filter((a) => a.status === 'working' || a.status === 'starting').length
    const waiting = this.state.inboxCount
    this.stats.textContent = agents.length
      ? `${working} trabalhando${waiting ? ` · ${waiting} esperando você` : ''}`
      : 'Nenhum agente ainda'
    this.rosterCount.textContent = String(agents.length)
    this.roster.classList.toggle('hidden', agents.length === 0)

    this.rosterList.replaceChildren(...agents.map((a) => this.rosterRow(a)))

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
          h('span', { class: 'floor-name' }, name),
          badge,
        )
      })
      .reverse()
    const add =
      names.length - 1 < MAX_PROJECT_FLOORS
        ? h('button', { class: 'floor-btn floor-add', title: 'Um andar para um projeto: quem você contrata ou chama lá trabalha na pasta dele', onclick: () => this.actions.newFloor() }, h('span', { class: 'floor-num' }, icon('plus', 12)), h('span', { class: 'floor-name' }, 'Andar de projeto'))
        : null
    this.floorsEl.replaceChildren(h('div', { class: 'floors-head' }, 'Elevador'), ...rows, ...(add ? [add] : []))
  }

  /**
   * Plan limits and the Mac's load in one card. Closed: a chip per account (its fullest
   * window) and one for the Mac. Open: the most urgent thing, a table of accounts by
   * window (5h, Semana, Fable…), and CPU/RAM.
   */
  renderInfo(): void {
    const list = this.state.usage.filter((u) => u.windows.length || u.error)
    const st = this.state.system
    this.info.classList.toggle('hidden', !list.length && !st)
    this.info.classList.toggle('info-open', this.infoOpen)
    const failed = list.filter((u) => u.error)
    const memPct = st ? Math.round((st.memUsed / st.memTotal) * 100) : 0
    const macPct = st ? Math.max(st.cpu, memPct) : 0
    const rows = list.map((u) => this.infoAccount(u))

    const chips = rows.map((r) => {
      const top = Math.max(0, ...r.u.windows.map((w) => w.percent))
      const lvl = r.loggedOut ? 'warn' : contextLevel(top)
      const title = [r.name, ...r.u.windows.map((w) => `${w.label} ${w.percent}%`), r.loggedOut ? 'sem login' : ''].filter(Boolean).join(' · ')
      return h('span', { class: `info-chip ctx-${lvl}`, title }, h('span', { class: 'info-px', style: `background:${r.color}` }), r.loggedOut ? '!' : `${top}%`)
    })
    if (st) chips.push(h('span', { class: `info-chip ctx-${contextLevel(macPct)}`, title: `CPU ${st.cpu}% · RAM ${memPct}%` }, `MAC ${macPct}%`))

    const strip = h(
      'button',
      { class: 'info-strip', title: this.infoOpen ? 'Recolher' : 'Limites do plano e uso do Mac', onclick: () => this.toggleInfo() },
      h('span', { class: 'info-chips' }, ...chips),
      failed.length ? h('span', { class: 'info-stale', title: `Não consegui atualizar: ${failed.map((u) => u.error).join(' · ')}` }, '!') : null,
      icon('chevron', 14),
    )
    if (!this.infoOpen) {
      this.info.replaceChildren(strip)
      return
    }

    const newest = Math.max(0, ...list.map((u) => u.updatedAt))
    const refresh = h('button', {
      class: 'icon-btn info-tool',
      title: failed.length ? `Não consegui atualizar: ${failed.map((u) => u.error).join(' · ')}` : `Atualizado ${timeAgo(newest)}. Clique para atualizar.`,
      onclick: async () => {
        refresh.classList.add('spin')
        await window.office.refreshUsage().catch(() => undefined)
      },
    }, icon('history', 13))
    const manage = h('button', { class: 'icon-btn info-tool', title: 'Contas do Claude', onclick: () => this.actions.accounts() }, icon('users', 13))

    // One column per window any account has, in the order they first appear.
    const cols = new Map<string, string>()
    for (const u of list) for (const w of u.windows) if (!cols.has(w.key)) cols.set(w.key, w.label)
    const now = Date.now()
    const table = list.length
      ? h(
          'table',
          { class: 'info-table' },
          h('tr', {}, h('th', {}, ''), ...[...cols.values()].map((label) => h('th', {}, label))),
          ...rows.map((r) =>
            h(
              'tr',
              {},
              h(
                'td',
                {},
                h(
                  'div',
                  { class: 'info-name', title: [r.name, r.email].filter(Boolean).join(' · ') },
                  h('span', { class: 'info-px', style: `background:${r.color}` }),
                  h('span', { class: 'info-name-text' }, r.name),
                  r.agents ? h('span', { class: 'info-agents', title: r.agents === 1 ? '1 agente nesta conta' : `${r.agents} agentes nesta conta` }, String(r.agents)) : null,
                ),
              ),
              ...(r.loggedOut || (r.u.error && !r.u.windows.length)
                ? [h('td', { colspan: cols.size }, h('span', { class: 'info-flag' }, r.loggedOut ? 'sem login' : 'sem dados'))]
                : [...cols.keys()].map((key) => {
                    const w = r.u.windows.find((x) => x.key === key)
                    if (!w || !w.percent) return h('td', {}, h('span', { class: 'info-zero', title: w ? `${w.label}: nada usado` : 'Esta conta não tem esta janela' }, '—'))
                    const lvl = contextLevel(w.percent)
                    const full = r.limitedUntil && w.percent >= 100
                    return h(
                      'td',
                      { title: w.resetsAt ? `Renova ${resetText(w.resetsAt)}` : '' },
                      h('div', { class: `info-cell ctx-${lvl}` }, h('span', { class: 'ctx-num' }, `${w.percent}%`), blocks(w.percent, 6)),
                      h('small', {}, full ? `volta ${resetText(r.limitedUntil!)}` : w.resetsAt ? `↻ ${leftText(w.resetsAt - now)}` : ''),
                    )
                  })),
            ),
          ),
        )
      : null

    const sys = st
      ? [
          h('div', { class: 'info-head' }, h('span', {}, 'Sistema')),
          h(
            'div',
            { class: 'info-sys' },
            h('div', { class: `ctx-${contextLevel(st.cpu)}`, title: 'Uso de CPU do Mac inteiro' }, h('div', { class: 'info-sys-k' }, h('span', {}, 'CPU'), h('span', { class: 'ctx-num' }, `${st.cpu}%`)), blocks(st.cpu, 10)),
            h(
              'div',
              { class: `ctx-${contextLevel(memPct)}`, title: `Memória em uso: ${bytes(st.memUsed)} de ${bytes(st.memTotal, 0)}` },
              h('div', { class: 'info-sys-k' }, h('span', {}, 'RAM'), h('span', { class: 'ctx-num' }, `${memPct}%`)),
              blocks(memPct, 10),
            ),
          ),
          h(
            'div',
            { class: 'info-procs' },
            h('span', { title: 'Este app: o jogo e a interface' }, 'escritório'),
            h('b', {}, procText(st.app.cpu, st.app.mem)),
            h('span', { title: 'Todos os processos claude: agentes do escritório e sessões do terminal' }, `agentes (${st.claude.count})`),
            h('b', {}, procText(st.claude.cpu, st.claude.mem)),
          ),
        ]
      : []

    const urgent = this.infoUrgent(rows, st ? { cpu: st.cpu, mem: memPct } : null, now)
    this.info.replaceChildren(
      strip,
      h(
        'div',
        { class: 'info-body' },
        h('div', { class: `info-led ctx-${urgent.level}` }, h('span', { class: 'info-led-dot' }), h('span', { class: 'info-led-text' }, urgent.text)),
        list.length
          ? h('div', { class: 'info-head' }, h('span', {}, 'Limites do plano'), failed.length ? h('span', { class: 'info-stale-tag' }, 'desatualizado') : null, h('span', { class: 'info-sp' }), manage, refresh)
          : null,
        table,
        ...sys,
      ),
    )
  }

  private toggleInfo(): void {
    this.infoOpen = !this.infoOpen
    localStorage.setItem(INFO_OPEN_KEY, this.infoOpen ? '1' : '0')
    this.renderInfo()
  }

  private infoAccount(u: PlanUsage): InfoRow {
    const a = this.state.account(u.accountId)
    const st = this.state.accounts.find((x) => x.id === u.accountId)
    let agents = 0
    for (const ag of this.state.agents.values()) if (ag.source === 'office' && ag.account === u.accountId) agents++
    return {
      u,
      name: a?.name ?? 'Conta',
      color: a?.color ?? 'var(--accent)',
      email: st?.email,
      agents,
      loggedOut: st?.loggedIn === false,
      limitedUntil: st?.limitedUntil && st.limitedUntil > Date.now() ? st.limitedUntil : undefined,
    }
  }

  /** The one thing to know, in order: an account out of room, logged out, close to a limit, the Mac struggling. */
  private infoUrgent(rows: InfoRow[], sys: { cpu: number; mem: number } | null, now: number): { level: 'ok' | 'warn' | 'full'; text: string } {
    const out = rows.find((r) => r.limitedUntil)
    if (out) return { level: 'full', text: `${out.name} cheia · volta ${resetText(out.limitedUntil!)}` }
    const loggedOut = rows.find((r) => r.loggedOut)
    if (loggedOut) return { level: 'warn', text: `${loggedOut.name} sem login` }
    let worst: { r: InfoRow; w: UsageWindow } | null = null
    for (const r of rows) for (const w of r.u.windows) if (!worst || w.percent > worst.w.percent) worst = { r, w }
    if (worst && contextLevel(worst.w.percent) !== 'ok') {
      const left = worst.w.resetsAt ? ` · ↻ ${leftText(worst.w.resetsAt - now)}` : ''
      return { level: contextLevel(worst.w.percent), text: `${worst.r.name} ${worst.w.label} em ${worst.w.percent}%${left}` }
    }
    if (sys) {
      const top = Math.max(sys.cpu, sys.mem)
      if (contextLevel(top) !== 'ok') return { level: contextLevel(top), text: sys.mem >= sys.cpu ? `Mac apertado · RAM ${sys.mem}%` : `Mac apertado · CPU ${sys.cpu}%` }
    }
    return { level: 'ok', text: 'Tudo tranquilo' }
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
    return h(
      'div',
      { class: `roster-row status-${a.status}${pending ? ' has-pending' : ''}`, onclick: () => this.actions.openAgent(a.id) },
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

  toast(text: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
    const el = h('div', { class: `toast toast-${kind}` }, text)
    this.toasts.append(el)
    setTimeout(() => el.classList.add('out'), 3800)
    setTimeout(() => el.remove(), 4300)
  }
}
