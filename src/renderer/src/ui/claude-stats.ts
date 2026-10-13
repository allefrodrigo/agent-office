import type { ClaudeStats, DayStats, ModelTokens, PlanUsage, StatsBucket, UsageWindow } from '@shared/types'
import { h, icon, timeAgo } from './dom'
import { modal } from './modals'

/**
 * Claude Code statistics (AO-18): activity per day, tokens and API-equivalent cost per
 * model, streaks, and the plan limits, one account at a time. Everything comes from
 * disk (transcripts read by the main process) and from the plan numbers already in
 * memory: opening this never calls the API.
 */

const PICK_KEY = 'cs-account'
const WEEKS = 53
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const intFmt = new Intl.NumberFormat('pt-BR')
const compactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const usdFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const usdWhole = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const int = (n: number) => intFmt.format(Math.round(n))
const compact = (n: number) => compactFmt.format(n)
const usd = (n: number) => (n > 0 && n < 0.01 ? '< US$ 0,01' : usdFmt.format(n))
/** Whole dollars from 100 up, to fit a tile. */
const usdShort = (n: number) => (n >= 100 ? usdWhole.format(n) : usd(n))
const tokensOf = (m: ModelTokens) => m.input + m.output + m.cacheRead + m.cacheWrite5m + m.cacheWrite1h

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "claude-haiku-4-5-20251001" -> "Haiku 4.5". */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-([\d-]+?)(?:-\d{8})?(\[1m\])?$/i.exec(id)
  if (!m) return id
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, '.')}${m[3] ? ' (1M)' : ''}`
}

function duration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const hrs = Math.floor(min / 60)
  if (hrs < 48) return `${hrs} h ${min % 60} min`
  return `${Math.floor(hrs / 24)} d ${hrs % 24} h`
}

function resetIn(t: number | undefined): string {
  if (!t) return ''
  const ms = t - Date.now()
  if (ms <= 0) return 'renova agora'
  const min = Math.round(ms / 60000)
  if (min < 60) return `renova em ${min} min`
  const hrs = Math.round(min / 60)
  return hrs < 48 ? `renova em ${hrs} h` : `renova em ${Math.round(hrs / 24)} d`
}

const level = (p: number) => (p >= 90 ? 'full' : p >= 70 ? 'warn' : 'ok')

/**
 * Fills `host` with the statistics and keeps them live. Returns the cleanup:
 * call it when the host goes away (tab change, dialog closed).
 */
export function mountClaudeStats(host: HTMLElement): () => void {
  let data: ClaudeStats | null = null
  let pick = localStorage.getItem(PICK_KEY) || 'all'
  let gone = false
  host.classList.add('cs')
  host.replaceChildren(h('div', { class: 'cs-empty' }, 'Lendo as estatísticas…'))

  const render = () => {
    if (gone || !data) return
    const keepScroll = host.querySelector<HTMLElement>('.cs-heat-scroll')?.scrollLeft
    const bucket = data.buckets.find((b) => b.accountId === pick) ?? data.buckets[0]
    if (!bucket) {
      host.replaceChildren(h('div', { class: 'cs-empty' }, 'Nenhum dado do Claude Code ainda.'))
      return
    }
    host.style.setProperty('--cs-c', bucket.color)
    host.replaceChildren(
      toolbar(data, bucket),
      tiles(bucket),
      heatmap(bucket),
      h('div', { class: 'cs-split' }, models(bucket), h('div', { class: 'cs-col' }, plan(data, bucket), hours(bucket))),
      notes(data, bucket),
    )
    const scroll = host.querySelector<HTMLElement>('.cs-heat-scroll')
    if (scroll) scroll.scrollLeft = keepScroll ?? scroll.scrollWidth
  }

  const toolbar = (s: ClaudeStats, current: StatsBucket): HTMLElement => {
    const refresh = h(
      'button',
      { class: 'btn btn-small cs-refresh', title: 'Lê de novo os transcripts no disco (não usa tokens)', disabled: s.reading, onclick: () => void window.office.refreshStats() },
      icon('reset', 13),
      s.reading ? 'Lendo…' : 'Atualizar',
    )
    return h(
      'div',
      { class: 'cs-bar' },
      h(
        'div',
        { class: 'cs-picks', role: 'tablist' },
        ...s.buckets.map((b) =>
          h(
            'button',
            {
              class: `cs-pick${b.accountId === current.accountId ? ' on' : ''}${b.totals.messages ? '' : ' empty'}`,
              style: `--pc:${b.color}`,
              title: b.accountId === 'terminal' ? 'Sessões sem conta registrada pelo escritório: terminal e sessões anteriores ao livro-caixa' : b.label,
              onclick: () => {
                pick = b.accountId
                localStorage.setItem(PICK_KEY, pick)
                render()
              },
            },
            h('i', { class: 'cs-pip' }),
            b.label,
          ),
        ),
      ),
      h('span', { class: 'cs-sp' }),
      h('span', { class: 'cs-age' }, s.lastRead ? `lido ${timeAgo(s.lastRead.at) === 'agora' ? 'agora' : `há ${timeAgo(s.lastRead.at)}`}` : 'ainda não lido'),
      refresh,
    )
  }

  const tile = (label: string, value: string, sub?: string, title?: string) =>
    h('div', { class: 'cs-tile', title: title ?? '' }, h('div', { class: 'cs-tile-k' }, label), h('div', { class: 'cs-tile-v' }, value), sub ? h('div', { class: 'cs-tile-s' }, sub) : null)

  const tiles = (b: StatsBucket): HTMLElement =>
    h(
      'div',
      { class: 'cs-tiles' },
      tile('Sessões', int(b.totals.sessions), `${int(b.totals.activeDays)} dias ativos`),
      tile('Respostas', compact(b.totals.messages), `${compact(b.totals.toolCalls)} ferramentas`, `${int(b.totals.messages)} respostas do modelo · ${int(b.totals.toolCalls)} chamadas de ferramenta`),
      tile('Tokens', compact(b.totals.tokens), 'entrada + saída + cache', `${int(b.totals.tokens)} tokens`),
      tile('Custo', usdShort(b.totals.costUsd), 'equivalente em API', `${usd(b.totals.costUsd)}. Preço de tabela da API para estes tokens. Quem usa assinatura não paga esse valor.`),
      tile('Sequência', `${b.streak.current} ${b.streak.current === 1 ? 'dia' : 'dias'}`, `recorde: ${b.streak.longest}`),
      tile(
        'Maior sessão',
        b.longestSession ? duration(b.longestSession.durationMs) : '—',
        b.longestSession ? `${int(b.longestSession.messages)} respostas` : undefined,
        b.longestSession ? `Sessão ${b.longestSession.sessionId}` : undefined,
      ),
    )

  const heatmap = (b: StatsBucket): HTMLElement => {
    const byDate = new Map(b.days.map((d) => [d.date, d]))
    const counts = b.days.map((d) => d.messages).filter((n) => n > 0).sort((x, y) => x - y)
    const q = (f: number) => counts[Math.min(counts.length - 1, Math.floor(f * counts.length))] ?? 0
    const cuts = [q(0.25), q(0.5), q(0.75)]
    const lvl = (n: number) => (n <= 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4)

    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const start = new Date(today)
    start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7)
    const cells: HTMLElement[] = []
    const months: HTMLElement[] = []
    let lastMonth = -1
    for (let w = 0; w < WEEKS; w++) {
      for (let wd = 0; wd < 7; wd++) {
        const d = new Date(start)
        d.setDate(start.getDate() + w * 7 + wd)
        if (wd === 0 && d.getMonth() !== lastMonth && d.getDate() <= 7) {
          lastMonth = d.getMonth()
          months.push(h('span', { style: `grid-column:${w + 1}` }, d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')))
        }
        if (d > today) {
          cells.push(h('i', { class: 'cs-cell future' }))
          continue
        }
        const key = localDate(d)
        const day = byDate.get(key)
        cells.push(h('i', { class: `cs-cell l${lvl(day?.messages ?? 0)}${day?.legacy ? ' legacy' : ''}${key === localDate(today) ? ' today' : ''}`, title: cellTitle(d, day) }))
      }
    }
    return h(
      'section',
      { class: 'cs-sec' },
      h('div', { class: 'cs-sec-head' }, h('span', {}, 'Atividade por dia'), h('span', { class: 'cs-sp' }), legend()),
      h(
        'div',
        { class: 'cs-heat-wrap' },
        h('div', { class: 'cs-heat-days' }, h('span', {}), ...WEEKDAYS.map((d, i) => h('span', {}, i % 2 ? d : ''))),
        h('div', { class: 'cs-heat-scroll' }, h('div', { class: 'cs-heat-months', style: `--weeks:${WEEKS}` }, ...months), h('div', { class: 'cs-heat', style: `--weeks:${WEEKS}` }, ...cells)),
      ),
    )
  }

  const cellTitle = (d: Date, day: DayStats | undefined): string => {
    const when = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    if (!day) return `${when}: sem atividade`
    const parts = [`${int(day.messages)} respostas`, `${int(day.sessions)} ${day.sessions === 1 ? 'sessão' : 'sessões'}`, `${compact(day.tokens)} tokens`]
    if (!day.legacy) parts.push(usd(day.costUsd))
    return `${when}\n${parts.join(' · ')}${day.legacy ? '\n(do cache do /stats: sem custo nem modelos)' : ''}`
  }

  const legend = () => h('div', { class: 'cs-legend' }, 'menos', ...[0, 1, 2, 3, 4].map((l) => h('i', { class: `cs-cell l${l}` })), 'mais')

  const models = (b: StatsBucket): HTMLElement => {
    const rows = Object.entries(b.byModel).sort(([, x], [, y]) => (y.costUsd ?? -1) - (x.costUsd ?? -1) || tokensOf(y) - tokensOf(x))
    const max = Math.max(1, ...rows.map(([, m]) => tokensOf(m)))
    return h(
      'section',
      { class: 'cs-sec cs-models' },
      h('div', { class: 'cs-sec-head' }, h('span', {}, 'Uso por modelo')),
      rows.length
        ? h(
            'table',
            { class: 'cs-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Modelo'), h('th', { title: 'Respostas do modelo' }, 'Resp.'), h('th', { title: 'Entrada sem cache' }, 'Entrada'), h('th', {}, 'Saída'), h('th', { title: 'Lido do cache' }, 'Cache'), h('th', { title: 'Equivalente em preço de API' }, 'Custo'))),
            h(
              'tbody',
              {},
              ...rows.map(([name, m]) =>
                h(
                  'tr',
                  {
                    title: `${name}\nentrada ${int(m.input)} · saída ${int(m.output)}\ncache lido ${int(m.cacheRead)} · cache escrito ${int(m.cacheWrite5m + m.cacheWrite1h)}${m.webSearch ? `\nbuscas na web ${int(m.webSearch)}` : ''}`,
                  },
                  h('td', {}, h('div', { class: 'cs-model' }, modelName(name)), h('div', { class: 'cs-meter' }, h('i', { style: `width:${(tokensOf(m) / max) * 100}%` }))),
                  h('td', {}, compact(m.messages)),
                  h('td', {}, compact(m.input + m.cacheWrite5m + m.cacheWrite1h)),
                  h('td', {}, compact(m.output)),
                  h('td', {}, compact(m.cacheRead)),
                  h('td', { class: 'cs-usd' }, m.costUsd === undefined ? h('span', { class: 'cs-dim', title: 'Modelo sem preço na tabela local' }, 's/ preço') : usd(m.costUsd)),
                ),
              ),
            ),
          )
        : h('div', { class: 'cs-empty' }, 'Nenhuma resposta registrada para esta conta.'),
    )
  }

  const planRows = (s: ClaudeStats, b: StatsBucket): { name: string; color: string; u: PlanUsage }[] => {
    const named = (u: PlanUsage) => {
      const acc = s.buckets.find((x) => x.accountId === u.accountId)
      return { name: acc?.label ?? 'Conta', color: acc?.color ?? 'var(--accent)', u }
    }
    if (b.accountId === 'all' || b.accountId === 'terminal') return s.plan.map(named)
    return s.plan.filter((u) => u.accountId === b.accountId).map(named)
  }

  const windowRow = (w: UsageWindow) =>
    h(
      'div',
      { class: `cs-win ctx-${level(w.percent)}` },
      h('span', { class: 'cs-win-k' }, w.label),
      h('div', { class: 'cs-blocks' }, ...Array.from({ length: 20 }, (_, i) => h('i', { class: i < Math.round(w.percent / 5) ? 'on' : '' }))),
      h('span', { class: 'cs-win-v' }, `${w.percent}%`),
      h('small', {}, resetIn(w.resetsAt)),
    )

  const plan = (s: ClaudeStats, b: StatsBucket): HTMLElement => {
    const rows = planRows(s, b)
    return h(
      'section',
      { class: 'cs-sec' },
      h('div', { class: 'cs-sec-head' }, h('span', {}, 'Uso do plano'), h('span', { class: 'cs-sp' }), h('span', { class: 'cs-dim', title: 'Os números que o escritório já tinha. Abrir esta tela não faz nova consulta.' }, 'última leitura')),
      ...(rows.length
        ? rows.map((r) =>
            h(
              'div',
              { class: 'cs-plan' },
              rows.length > 1 || b.accountId === 'all' || b.accountId === 'terminal'
                ? h('div', { class: 'cs-plan-name', style: `--pc:${r.color}` }, h('i', { class: 'cs-pip' }), r.name, r.u.updatedAt ? h('span', { class: 'cs-dim' }, ` · ${timeAgo(r.u.updatedAt)}`) : null)
                : null,
              r.u.windows.length
                ? r.u.windows.map(windowRow)
                : h('div', { class: 'cs-dim' }, r.u.error ? `Sem dados: ${r.u.error}` : r.u.updatedAt ? 'Sem limites informados.' : 'Ainda não lido.'),
            ),
          )
        : [h('div', { class: 'cs-dim' }, 'Sem limites para esta conta.')]),
    )
  }

  const hours = (b: StatsBucket): HTMLElement => {
    const max = Math.max(1, ...b.hourCounts)
    return h(
      'section',
      { class: 'cs-sec' },
      h('div', { class: 'cs-sec-head' }, h('span', {}, 'Horário')),
      h(
        'div',
        { class: 'cs-hours' },
        ...b.hourCounts.map((n, i) => h('i', { style: `height:${Math.max(n ? 8 : 2, (n / max) * 100)}%`, title: `${String(i).padStart(2, '0')}h: ${int(n)} respostas` })),
      ),
      h('div', { class: 'cs-hours-axis' }, h('span', {}, '0h'), h('span', {}, '6h'), h('span', {}, '12h'), h('span', {}, '18h'), h('span', {}, '23h')),
    )
  }

  const notes = (s: ClaudeStats, b: StatsBucket): HTMLElement => {
    const since = s.since ? new Date(`${s.since}T12:00:00`).toLocaleDateString('pt-BR') : null
    return h(
      'div',
      { class: 'cs-notes' },
      h('p', {}, 'Custo = equivalente em preço de API, calculado com uma tabela local. Assinaturas (Pro/Max) não pagam esse valor.'),
      since ? h('p', {}, `Totais contam desde ${since}, quando o escritório começou a ler os transcripts.${b.accountId === 'all' && b.days.some((d) => d.legacy) ? ' Dias anteriores no mapa vêm do cache do /stats.' : ''}`) : null,
      b.accountId === 'terminal' ? h('p', {}, 'Terminal: sessões sem conta registrada pelo escritório (terminal e sessões anteriores ao livro-caixa).') : null,
      s.unpricedModels.length ? h('p', {}, `Sem preço na tabela: ${s.unpricedModels.map(modelName).join(', ')}.`) : null,
      s.error ? h('p', { class: 'cs-err' }, `Última leitura falhou: ${s.error}`) : null,
    )
  }

  const off = window.office.onEvent((e) => {
    if (e.type === 'stats') {
      data = e.stats
      render()
    } else if (e.type === 'usage' && data) {
      data = { ...data, plan: e.usage }
      render()
    }
  })

  window.office
    .getStats()
    .then((s) => {
      data = s
      render()
    })
    .catch((err) => {
      if (!gone) host.replaceChildren(h('div', { class: 'cs-empty cs-err' }, `Não deu para ler as estatísticas: ${err instanceof Error ? err.message : String(err)}`))
    })

  return () => {
    gone = true
    off()
    host.classList.remove('cs')
    host.replaceChildren()
  }
}

/** The statistics in their own dialog. Returns the close function. */
export function openClaudeStats(root: HTMLElement): () => void {
  const body = h('div', { class: 'cs-host' })
  let cleanup = () => {}
  const close = () => {
    cleanup()
    el.remove()
  }
  const el = modal('Estatísticas do Claude Code', [body], [h('button', { class: 'btn', onclick: close }, 'Fechar')], close)
  el.querySelector('.modal')?.classList.add('cs-modal')
  root.append(el)
  cleanup = mountClaudeStats(body)
  return close
}
