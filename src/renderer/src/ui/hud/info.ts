import type { PlanUsage, UsageWindow } from '@shared/types'
import type { State } from '../../state'
import { h, icon, timeAgo } from '../dom'
import { contextLevel } from '../panel'

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

/** The HUD's card of plan limits (per account) and the Mac's load, closed or open. */
export class InfoCard {
  /** Plan limits and system load; see renderInfo. */
  readonly info: HTMLDivElement = h('div', { class: 'info card hidden', 'data-tour': 'info' })
  private infoOpen = localStorage.getItem(INFO_OPEN_KEY) === '1'

  constructor(
    private state: State,
    private actions: { accounts(): void },
  ) {}

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
}
