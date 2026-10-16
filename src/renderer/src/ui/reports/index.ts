import { projectFor, floorNameFor } from '@shared/projects'
import type { Ledger, LedgerAgent, Look, ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { DEFAULT_BRAND } from '../../world/brand'
import { mountClaudeStats } from '../claude-stats'
import { h, icon } from '../dom'
import { cleanError, modal } from '../modals'
import { saveMarkdown } from '../export'
import { slug } from '@shared/export-md'
import { portrait } from '../portrait'
import { dayKey, dateOf, dayLong, usd, int, workTime, modelName, type Group, zero, type Report, add, sum, variation, tokens } from './data'
import { reportMarkdown } from './markdown'
import { economy } from './economy'
import { spendSplit } from '@shared/economy'

// Relatórios: what the office spent, read from the cost book (AO-16), shown like the
// results screen at the end of a level, not a spreadsheet.

type Period = 1 | 7 | 30

const PERIODS: { n: Period; label: string; long: string; prev: string }[] = [
  { n: 1, label: 'Hoje', long: 'Hoje', prev: 'ontem' },
  { n: 7, label: '7 dias', long: 'Últimos 7 dias', prev: 'os 7 dias antes' },
  { n: 30, label: '30 dias', long: 'Últimos 30 dias', prev: 'os 30 dias antes' },
]

/** Enough history for the longest period and the one before it. */
const HISTORY_DAYS = 60
const PERIOD_KEY = 'reports-period'
const ALL = '*'
/** For agents the book saw before it kept looks. */
const NO_LOOK: Look = { skin: '#e0b48c', hair: '#3a2a20', hairStyle: 0, shirt: '#6f6d8a', pants: '#2c2d40', shoes: '#1a1b2b' }

export interface ReportsOptions {
  /** The floor the player is on: the report opens filtered to it. */
  project: ProjectFloor | null
  /** Which tab to open on. */
  tab?: 'projects' | 'claude'
  /** Avisos do HUD (exportação). */
  toast?: (text: string, kind?: 'info' | 'ok' | 'err') => void
}

/** The Relatórios dialog: spend by project (Projetos) and Claude Code's own stats (Claude Code). */
export function openReports(root: HTMLElement, state: State, opts: ReportsOptions): void {
  let ledger: Ledger | null = null
  let error = ''
  const stored = Number(localStorage.getItem(PERIOD_KEY))
  let period: Period = stored === 1 || stored === 30 ? stored : 7
  let filter = opts.project?.id ?? ALL
  let tab = opts.tab ?? 'projects'
  let unmountStats: (() => void) | null = null
  /** Where the next count-up starts: a refresh rolls from the old total, not from zero. */
  let shownTotal = 0

  const groupCache = new Map<string, Group>()
  const groupOf = (cwd: string): Group => {
    let g = groupCache.get(cwd)
    if (g) return g
    const p = projectFor(state.settings.projects, cwd)
    g = p
      ? { key: p.id, name: p.name, color: p.brandColor ?? DEFAULT_BRAND, title: p.cwd }
      : { key: cwd, name: floorNameFor(cwd), color: '#6f6d8a', title: `${cwd} (fora dos andares)` }
    groupCache.set(cwd, g)
    return g
  }

  const body = h('div', { class: 'rep' })
  const host = h('div', { class: 'rep-host' })
  const tabs = h('div', { class: 'seg rep-tabs' })
  const close = () => {
    unmountStats?.()
    unmountStats = null
    off()
    el.remove()
  }

  const renderTabs = () => {
    const btn = (key: typeof tab, label: string, ic: string) =>
      h('button', { class: `seg-btn${tab === key ? ' on' : ''}`, onclick: () => setTab(key) }, icon(ic, 15), label)
    tabs.replaceChildren(btn('projects', 'Projetos', 'coin'), btn('claude', 'Claude Code', 'terminal'))
  }

  const setTab = (next: typeof tab) => {
    if (next === tab && host.childElementCount) return
    tab = next
    unmountStats?.()
    unmountStats = null
    renderTabs()
    // Exportar vale para a aba Projetos.
    exportBtn.classList.toggle('hidden', tab !== 'projects')
    if (tab === 'claude') {
      const pane = h('div', { class: 'rep-claude' })
      host.replaceChildren(pane)
      try {
        unmountStats = mountClaudeStats(pane)
      } catch (err) {
        pane.replaceChildren(h('div', { class: 'rep-empty' }, cleanError(err)))
      }
    } else {
      host.replaceChildren(body)
      render()
    }
  }

  const load = async () => {
    try {
      ledger = await window.office.getLedger({ from: dayKey(-(HISTORY_DAYS - 1)), to: dayKey() })
      error = ''
    } catch (err) {
      error = cleanError(err)
    }
    if (tab === 'projects') render()
  }

  // Live: a result lands while the report is open.
  let reloading: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = window.office.onEvent((e) => {
    if (e.type !== 'ledger:today' || reloading) return
    reloading = setTimeout(() => {
      reloading = null
      void load()
    }, 1500)
  })
  const off = () => {
    unsubscribe()
    if (reloading) clearTimeout(reloading)
  }

  const compute = (book: Ledger): Report => {
    const days = Array.from({ length: period }, (_, i) => dayKey(i - period + 1))
    const first = days[0]
    const prevFirst = dayKey(-(2 * period) + 1)
    const r: Report = {
      days,
      total: zero(),
      prevCost: 0,
      byDay: new Map(days.map((d) => [d, new Map()])),
      groups: new Map(),
      agents: new Map(),
      models: new Map(),
      split: { read: 0, write: 0, output: 0, input: 0, readTokens: 0 },
    }
    for (const [cwd, byDay] of Object.entries(book.days)) {
      const g = groupOf(cwd)
      if (filter !== ALL && g.key !== filter) continue
      for (const [day, d] of Object.entries(byDay)) {
        if (day < first) {
          if (day >= prevFirst) r.prevCost += d.costUsd
          continue
        }
        if (day > days[days.length - 1]) continue
        add(r.total, d)
        const gt = r.groups.get(g.key) ?? { ...zero(), byDay: new Map<string, number>() }
        r.groups.set(g.key, gt)
        add(gt, d)
        gt.byDay.set(day, (gt.byDay.get(day) ?? 0) + d.costUsd)
        const slot = r.byDay.get(day)
        slot?.set(g.key, (slot.get(g.key) ?? 0) + d.costUsd)
        for (const [id, a] of Object.entries(d.agents)) {
          const at = r.agents.get(id) ?? { ...zero(), groups: new Set<string>() }
          r.agents.set(id, at)
          add(at, a)
          at.groups.add(g.key)
        }
        for (const [name, m] of Object.entries(d.models)) {
          const mt = r.models.get(name) ?? { cost: 0, output: 0 }
          r.models.set(name, mt)
          mt.cost += m.costUsd
          mt.output += m.outputTokens
          const sp = spendSplit(name, m)
          r.split.read += sp.read
          r.split.write += sp.write
          r.split.output += sp.output
          r.split.input += sp.input
          r.split.readTokens += m.cacheReadTokens
        }
      }
    }
    return r
  }

  const groupsKnown = (): Group[] => {
    const seen = new Map<string, Group>()
    for (const p of state.settings.projects) seen.set(p.id, groupOf(p.cwd))
    for (const cwd of Object.keys(ledger?.days ?? {})) {
      const g = groupOf(cwd)
      if (!seen.has(g.key)) seen.set(g.key, g)
    }
    return [...seen.values()]
  }

  const render = () => {
    const per = PERIODS.find((p) => p.n === period)!
    const periodSeg = h(
      'div',
      { class: 'rep-period' },
      ...PERIODS.map((p) =>
        h('button', {
          class: `rep-pill${p.n === period ? ' on' : ''}`,
          onclick: () => {
            period = p.n
            localStorage.setItem(PERIOD_KEY, String(p.n))
            render()
          },
        }, p.label),
      ),
    )
    const known = groupsKnown()
    if (filter !== ALL && !known.some((g) => g.key === filter)) filter = ALL
    const select = h(
      'select',
      { class: 'input rep-filter', title: 'Projeto do relatório' },
      h('option', { value: ALL }, 'Todos os projetos'),
      ...known.map((g) => h('option', { value: g.key }, g.name)),
    ) as HTMLSelectElement
    select.value = filter
    select.addEventListener('change', () => {
      filter = select.value
      render()
    })
    const controls = h('div', { class: 'rep-controls' }, periodSeg, h('div', { class: 'grow' }), select)

    if (!ledger) {
      body.replaceChildren(controls, h('div', { class: 'rep-empty' }, error || 'Abrindo o livro-caixa…'))
      return
    }
    const r = compute(ledger)
    const scope = filter === ALL ? 'Todos os projetos' : (known.find((g) => g.key === filter)?.name ?? '')
    const parts: HTMLElement[] = [controls, scoreboard(r, per.long, scope, per.prev)]
    if (!r.total.cost && !r.total.results) {
      parts.push(h('div', { class: 'rep-empty' }, emptyText(ledger, filter !== ALL)))
      body.replaceChildren(...parts)
      return
    }
    parts.push(highlights(r, per.prev, filter === ALL))
    parts.push(economy(root, state, r, filter === ALL ? null : filter, groupOf))
    if (period > 1) parts.push(dayChart(r))
    if (filter === ALL) parts.push(projectList(r))
    parts.push(h('div', { class: 'rep-ranks' }, agentRank(r, ledger.agents, filter === ALL), modelRank(r)))
    body.replaceChildren(...parts)
  }

  /** O relatório na tela (período e projeto escolhidos) em Markdown. */
  const exportReport = () => {
    if (!ledger) return
    const per = PERIODS.find((p) => p.n === period)!
    const known = groupsKnown()
    const scope = filter === ALL ? 'Todos os projetos' : (known.find((g) => g.key === filter)?.name ?? '')
    const md = reportMarkdown(compute(ledger), per.long, scope, per.prev, ledger.agents, (key) => groupByKey(key)?.name ?? key, (cwd) => groupOf(cwd).name)
    void saveMarkdown(`relatorio-${slug(scope)}-${dayKey()}.md`, md, opts.toast ?? (() => {}))
  }

  const emptyText = (book: Ledger, filtered: boolean) => {
    const anything = Object.values(book.days).some((d) => Object.keys(d).length)
    if (!anything) return 'O livro-caixa ainda está vazio. Os gastos aparecem aqui quando os agentes do escritório terminarem as primeiras respostas.'
    return filtered ? 'Nenhum gasto deste projeto no período. Tente outro período ou veja todos os projetos.' : 'Nenhum gasto no período. Tente um período maior.'
  }

  const scoreboard = (r: Report, label: string, scope: string, prevLabel: string): HTMLElement => {
    const total = h('div', { class: 'rep-total' }, usd(shownTotal))
    rollUp(total, shownTotal, r.total.cost)
    shownTotal = r.total.cost
    const delta = variation(r.total.cost, r.prevCost)
    const stat = (k: string, v: string, title: string) => h('div', { class: 'rep-stat', title }, h('span', { class: 'rep-stat-k' }, k), h('span', { class: 'rep-stat-v' }, v))
    const spenders = [...r.agents.values()].filter((a) => a.cost > 0).length
    return h(
      'div',
      { class: 'rep-board' },
      h('div', { class: 'rep-board-label' }, `${label} · ${scope}`.toUpperCase()),
      h(
        'div',
        { class: 'rep-board-row' },
        total,
        delta ? h('span', { class: `rep-delta rep-delta-${delta.tone}`, title: `Comparado com ${prevLabel}: ${usd(r.prevCost)}` }, delta.text, h('small', {}, `vs ${prevLabel}`)) : null,
      ),
      h(
        'div',
        { class: 'rep-board-stats' },
        stat('Turnos', int(r.total.turns), 'Idas e voltas do modelo nas respostas do período'),
        stat('Tempo', workTime(r.total.durationMs), 'Tempo dos agentes trabalhando nas respostas'),
        stat('Respostas', int(r.total.results), 'Respostas que os agentes terminaram'),
        stat('Agentes', int(spenders), 'Agentes que gastaram no período, dispensados incluídos'),
      ),
    )
  }

  const highlights = (r: Report, prevLabel: string, all: boolean): HTMLElement => {
    const tiles: HTMLElement[] = []
    const tile = (kind: string, ic: string, k: string, v: string, sub: string, title = '') =>
      h('div', { class: `rep-tile rep-tile-${kind}`, title }, h('div', { class: 'rep-tile-k' }, icon(ic, 14), k), h('div', { class: 'rep-tile-v' }, v), h('div', { class: 'rep-tile-sub' }, sub))
    if (r.days.length > 1) {
      let best = ''
      let bestUsd = 0
      for (const [day, m] of r.byDay) {
        const s = sum(m.values())
        if (s > bestUsd) [best, bestUsd] = [day, s]
      }
      if (best) tiles.push(tile('day', 'coin', 'Dia mais caro', usd(bestUsd), dayLong(best)))
    }
    if (all) {
      const top = [...r.groups].sort((a, b) => b[1].cost - a[1].cost)[0]
      if (top && top[1].cost > 0) {
        const g = groupByKey(top[0])
        tiles.push(tile('project', 'folder', 'Projeto mais caro', usd(top[1].cost), g?.name ?? '', g?.title))
      }
    }
    const delta = variation(r.total.cost, r.prevCost)
    tiles.push(
      tile(
        `delta rep-delta-${delta?.tone ?? 'flat'}`,
        'gauge',
        `Contra ${prevLabel}`,
        delta?.text ?? 'sem base',
        r.prevCost ? `antes: ${usd(r.prevCost)}` : 'nada gasto no período anterior',
      ),
    )
    if (tiles.length < 3) {
      const m = [...r.models].sort((a, b) => b[1].cost - a[1].cost)[0]
      if (m) tiles.push(tile('model', 'cpu', 'Modelo mais usado', modelName(m[0]), usd(m[1].cost), m[0]))
    }
    return h('div', { class: 'rep-tiles' }, ...tiles)
  }

  const groupByKey = (key: string) => [...groupCache.values()].find((g) => g.key === key)

  /** One stacked bar per day, colored by project; the record day gets a crown. */
  const dayChart = (r: Report): HTMLElement => {
    const totals = r.days.map((d) => sum(r.byDay.get(d)?.values() ?? []))
    const max = Math.max(...totals)
    const dense = r.days.length > 10
    const cols = r.days.map((day, i) => {
      const t = totals[i]
      const segs = [...(r.byDay.get(day) ?? new Map<string, number>())]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([key, v]) => h('i', { style: `height:${(v / t) * 100}%;background:${groupByKey(key)?.color ?? 'var(--accent)'}` }))
      const record = t > 0 && t === max
      const tip = [dayLong(day), usd(t), ...[...(r.byDay.get(day) ?? [])].filter(([, v]) => v > 0).map(([k, v]) => `${groupByKey(k)?.name ?? k}: ${usd(v)}`)].join('\n')
      const d = dateOf(day)
      const label = dense ? (i % 5 === 4 || i === r.days.length - 1 ? String(d.getDate()) : '') : d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
      return h(
        'div',
        { class: `rep-col${record ? ' record' : ''}${i === r.days.length - 1 ? ' today' : ''}`, title: tip },
        h('div', { class: 'rep-col-val' }, record && !dense ? usd(t) : ''),
        h('div', { class: 'rep-col-track' }, h('div', { class: 'rep-col-bar', style: `height:${max ? Math.max(t > 0 ? 3 : 0, (t / max) * 100) : 0}%` }, ...segs)),
        h('div', { class: 'rep-col-day' }, label),
      )
    })
    return section('Gasto por dia', h('div', { class: `rep-chart${dense ? ' dense' : ''}` }, ...cols))
  }

  const projectList = (r: Report): HTMLElement => {
    const rows = [...r.groups].filter(([, t]) => t.cost > 0 || t.results > 0).sort((a, b) => b[1].cost - a[1].cost)
    const max = Math.max(0.0001, ...rows.map(([, t]) => t.cost))
    return section(
      'Por projeto',
      h(
        'div',
        { class: 'rep-projects' },
        ...rows.map(([key, t]) => {
          const g = groupByKey(key)
          const sparkTop = Math.max(0.0001, ...t.byDay.values())
          const spark =
            r.days.length > 1
              ? h('div', { class: 'rep-spark', title: 'Gasto por dia' }, ...r.days.map((d) => {
                  const v = t.byDay.get(d) ?? 0
                  return h('i', { style: `height:${v > 0 ? Math.max(8, (v / sparkTop) * 100) : 0}%` })
                }))
              : h('span')
          return h(
            'button',
            { class: 'rep-project', style: `--brand:${g?.color ?? 'var(--accent)'}`, title: `${g?.title ?? key}\nClique para ver só este projeto`, onclick: () => {
              filter = key
              render()
            } },
            h('span', { class: 'rep-project-pip' }),
            h('div', { class: 'rep-project-main' }, h('div', { class: 'rep-project-name' }, g?.name ?? key), h('div', { class: 'rep-share' }, h('i', { style: `width:${(t.cost / max) * 100}%` }))),
            spark,
            h('div', { class: 'rep-project-meta' }, h('span', {}, `${int(t.turns)} turnos`), h('span', {}, workTime(t.durationMs))),
            h('div', { class: 'rep-project-usd' }, usd(t.cost)),
          )
        }),
      ),
    )
  }

  const agentRank = (r: Report, who: Record<string, LedgerAgent>, all: boolean): HTMLElement => {
    const rows = [...r.agents].filter(([, a]) => a.cost > 0).sort((a, b) => b[1].cost - a[1].cost)
    const shown = rows.slice(0, 8)
    const max = Math.max(0.0001, ...shown.map(([, a]) => a.cost))
    return section(
      'Funcionário do período',
      h(
        'div',
        { class: 'rep-rank' },
        ...(shown.length
          ? shown.map(([id, a], i) => {
              const ag = who[id]
              const g = all && ag ? groupOf(ag.cwd) : null
              const gone = !!ag?.dismissedAt
              return h(
                'div',
                { class: `rep-rank-row${i < 3 ? ` medal-${i + 1}` : ''}${gone ? ' gone' : ''}` },
                h('span', { class: 'rep-rank-pos' }, String(i + 1)),
                portrait(ag?.look ?? NO_LOOK, 28),
                h(
                  'div',
                  { class: 'rep-rank-main' },
                  h(
                    'div',
                    { class: 'rep-rank-name' },
                    h('span', { class: 'name' }, ag?.name ?? 'Agente'),
                    gone ? h('span', { class: 'chip rep-gone', title: `Dispensado em ${new Date(ag!.dismissedAt!).toLocaleDateString('pt-BR')}` }, 'dispensado') : null,
                    g ? h('span', { class: 'rep-rank-proj', style: `--brand:${g.color}` }, g.name) : null,
                  ),
                  h('div', { class: 'rep-share' }, h('i', { style: `width:${(a.cost / max) * 100}%` })),
                ),
                h('div', { class: 'rep-rank-side' }, h('b', {}, usd(a.cost)), h('small', {}, `${int(a.turns)} turnos`)),
              )
            })
          : [h('div', { class: 'rep-empty small' }, 'Ninguém gastou no período.')]),
        rows.length > shown.length ? h('div', { class: 'rep-more' }, `+${rows.length - shown.length} com gasto menor`) : null,
      ),
    )
  }

  const modelRank = (r: Report): HTMLElement => {
    const rows = [...r.models].filter(([, m]) => m.cost > 0).sort((a, b) => b[1].cost - a[1].cost)
    const total = sum(rows.map(([, m]) => m.cost)) || 1
    return section(
      'Modelos',
      h(
        'div',
        { class: 'rep-rank' },
        ...(rows.length
          ? rows.map(([name, m], i) =>
              h(
                'div',
                { class: `rep-rank-row rep-model${i === 0 ? ' medal-1' : ''}`, title: name },
                h('span', { class: 'rep-rank-pos' }, String(i + 1)),
                h(
                  'div',
                  { class: 'rep-rank-main' },
                  h('div', { class: 'rep-rank-name' }, h('span', { class: 'name' }, modelName(name)), h('span', { class: 'rep-pct' }, `${Math.round((m.cost / total) * 100)}%`)),
                  h('div', { class: 'rep-share' }, h('i', { style: `width:${(m.cost / total) * 100}%` })),
                ),
                h('div', { class: 'rep-rank-side' }, h('b', {}, usd(m.cost)), h('small', { title: 'Tokens de saída' }, `${tokens(m.output)} saída`)),
              ),
            )
          : [h('div', { class: 'rep-empty small' }, 'Sem gasto por modelo no período.')]),
      ),
    )
  }

  renderTabs()
  const exportBtn = h('button', { class: 'btn', title: 'Salvar o relatório deste período e projeto em Markdown (.md)', onclick: exportReport }, icon('file', 15), 'Exportar .md')
  const el = modal('Relatórios', [tabs, host], [exportBtn, h('div', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Fechar')], close)
  el.classList.add('backdrop-reports')
  // The tab bar sits under the title; the X of modal() calls close().
  root.append(el)
  setTab(tab)
  void load()
}


function section(title: string, content: HTMLElement): HTMLElement {
  return h('div', { class: 'rep-section' }, h('div', { class: 'rep-section-head' }, title), content)
}

/** The total counts up like a score at the end of a level. */
function rollUp(el: HTMLElement, from: number, target: number): void {
  if (Math.abs(target - from) < 0.005 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = usd(target)
    return
  }
  const start = performance.now()
  const dur = 700
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / dur)
    el.textContent = usd(from + (target - from) * (1 - (1 - k) ** 3))
    if (k < 1 && el.isConnected) requestAnimationFrame(step)
    else el.textContent = usd(target)
  }
  requestAnimationFrame(step)
}
