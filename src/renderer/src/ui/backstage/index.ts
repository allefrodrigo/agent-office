import './backstage.css'
import type { BgProcess, McpServerView, PluginView, SkillView, ToolsView } from '@shared/types'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { cleanError, confirmDialog, modal } from '../modals'
import { worktreesView } from './worktrees'
import { ageText, byOwner, isOld, isOrphan, isStopping, kindTag, stopProcess, type Toast } from './shared'

export type BackstageTab = 'bg' | 'mcp' | 'skills' | 'wt'

type BgFilter = 'all' | 'gone' | 'server' | 'monitor' | 'shell'
type McpFilter = 'all' | 'idle' | 'attention' | 'off'
type SkillFilter = 'week' | 'user' | 'project' | 'plugin' | 'builtin' | 'plugins'

const SCOPE: Record<string, string> = {
  user: 'seu',
  project: 'do projeto',
  local: 'local',
  plugin: 'de plugin',
  claudeai: 'claude.ai',
  sdk: 'do escritório',
  dynamic: 'dinâmico',
  managed: 'da empresa',
  enterprise: 'da empresa',
}
const SOURCE: Record<SkillView['source'], string> = { user: 'sua', project: 'do projeto', plugin: 'plugin', builtin: 'do Claude Code' }

let redrawOpen: (() => void) | null = null
let switchTab: ((tab: BackstageTab) => void) | null = null

/** A new scan arrived: the open window redraws its process list. */
export function refreshBackstage(): void {
  redrawOpen?.()
}

/** 'YYYY-MM-DD' as "hoje", "ontem" or "13/10". */
function dayText(date: string | undefined): string {
  if (!date) return ''
  const d = new Date(`${date}T12:00:00`)
  const days = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const mb = (n?: number) =>
  n === undefined ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : `${Math.round(n / 1024 ** 2)} MB`

/** A size, not an alarm: share of the busiest one, in four blocks. */
function useBlocks(n: number, max: number): HTMLElement {
  const lit = n ? Math.max(1, Math.round((n / Math.max(max, 1)) * 4)) : 0
  return h(
    'span',
    { class: 'bs-blocks', 'aria-hidden': 'true' },
    ...Array.from({ length: 4 }, (_, i) => h('i', { class: i < lit ? 'on' : '' })),
  )
}

function toggleSwitch(on: boolean, label: string, onchange: (on: boolean) => void, disabled = false): HTMLButtonElement {
  return h('button', {
    class: `bs-switch${on ? ' on' : ''}`,
    type: 'button',
    role: 'switch',
    'aria-checked': String(on),
    'aria-label': label,
    title: label,
    disabled,
    onclick: () => onchange(!on),
  }) as HTMLButtonElement
}

/**
 * Bastidores: what runs behind the agents. Segundo plano lists the processes they left
 * running (from the last scan, pushed every few seconds); MCP and Skills read the tools
 * the office agents have, with 7 days of use, when the tab opens.
 */
export function openBackstage(
  root: HTMLElement,
  state: State,
  opts: { tab?: BackstageTab; toast: Toast; openAgent(id: string): void },
): void {
  if (root.querySelector('.backdrop-backstage')) return switchTab?.(opts.tab ?? 'bg')
  let tab: BackstageTab = opts.tab ?? 'bg'
  let bgFilter: BgFilter = 'all'
  let mcpFilter: McpFilter = 'all'
  let skillFilter: SkillFilter = 'week'
  let query = ''
  let peek: { id: string; text: string | null } | null = null
  let tools: ToolsView | null = null
  let toolsError = ''
  let loading: Promise<void> | null = null
  const busy = new Set<string>()

  const tabsEl = h('div', { class: 'bs-tabs', role: 'tablist', 'aria-label': 'Bastidores' })
  const body = h('div', { class: 'bs-body' })
  const foot = h('div', { class: 'bs-foot' })
  const close = () => {
    redrawOpen = null
    switchTab = null
    el.remove()
  }
  const el = modal('Bastidores', [tabsEl, body], [foot], close)
  el.classList.add('backdrop-backstage')
  const wt = worktreesView(root, state, { toast: opts.toast, openAgent: opts.openAgent, close, render: () => render() })

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) opts.toast(ok, 'ok')
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    }
  }
  const loadTools = (force = false) => {
    if (loading || (tools && !force)) return
    toolsError = ''
    loading = window.office
      .toolsView()
      .then((v) => void (tools = v))
      .catch((err) => void (toolsError = cleanError(err)))
      .finally(() => {
        loading = null
        render()
      })
    render()
  }
  const chips = <T extends string>(list: [T, string, number][], current: T, set: (v: T) => void) =>
    h(
      'div',
      { class: 'bs-filters' },
      ...list.map(([k, label, n]) =>
        h(
          'button',
          { class: `bs-filter${current === k ? ' on' : ''}`, type: 'button', 'aria-pressed': String(current === k), onclick: () => set(k) },
          label,
          h('b', {}, String(n)),
        ),
      ),
    )

  // ---------- Segundo plano ----------
  const bgTab = (): HTMLElement[] => {
    const all = state.backstage
    if (!all.length) {
      const win = state.platform === 'win32' ? ' No Windows, aparecem só os processos dos agentes do escritório.' : ''
      return [
        h(
          'div',
          { class: 'bs-empty' },
          icon('terminal', 22),
          h('b', {}, 'Nada rodando em segundo plano.'),
          h(
            'span',
            {},
            `Quando um agente deixar um servidor, um vigia ou um shell ligado, ele aparece aqui, com a porta, a memória e um botão para parar.${win}`,
          ),
        ),
      ]
    }
    const is: Record<BgFilter, (p: BgProcess) => boolean> = {
      all: () => true,
      gone: isOrphan,
      server: (p) => p.kind === 'server',
      monitor: (p) => p.kind === 'monitor',
      shell: (p) => p.kind === 'shell' || p.kind === 'helper',
    }
    const list = all.filter(is[bgFilter])
    const now = Date.now()
    const groups = byOwner(list).map(([, ps]) => {
      const p0 = ps[0]
      const agent = p0.owner.agentId ? state.agents.get(p0.owner.agentId) : undefined
      const color = isOrphan(p0)
        ? 'var(--amber)'
        : p0.owner.kind === 'terminal'
          ? 'var(--dim)'
          : (state.account(p0.owner.accountId ?? '')?.color ?? 'var(--accent)')
      const status = isOrphan(p0)
        ? h('span', { class: 'bs-flag' }, 'sem dono: o agente saiu ou o shell que o abriu acabou')
        : h('span', { class: 'bs-own-kind' }, p0.owner.kind === 'terminal' ? 'sessão do terminal' : 'agente do escritório')
      // The tag beside the name already says terminal or sem dono.
      const name =
        agent && !isOrphan(p0)
          ? h(
              'button',
              { class: 'bs-own-name', type: 'button', title: `Abrir ${agent.name}`, onclick: () => (close(), opts.openAgent(agent.id)) },
              p0.owner.name,
            )
          : h('span', { class: 'bs-own-name' }, p0.owner.name)
      return h(
        'section',
        { class: 'bs-group' },
        h('div', { class: 'bs-own' }, h('span', { class: 'info-px', style: `background:${color}` }), name, status),
        ...ps.map((p) => bgRow(p, now)),
      )
    })
    return [
      chips<BgFilter>(
        [
          ['all', 'Tudo', all.length],
          ['gone', 'Sem dono', all.filter(isOrphan).length],
          ['server', 'Servidores', all.filter(is.server).length],
          ['monitor', 'Vigias', all.filter(is.monitor).length],
          ['shell', 'Shells e ajudantes', all.filter(is.shell).length],
        ],
        bgFilter,
        (v) => ((bgFilter = v), render()),
      ),
      h(
        'div',
        { class: 'bs-cols bs-proc', 'aria-hidden': 'true' },
        h('span', {}, 'tipo'),
        h('span', {}, 'comando'),
        h('span', { class: 'r' }, 'há'),
        h('span', { class: 'r' }, 'CPU'),
        h('span', { class: 'r' }, 'RAM'),
        h('span', {}),
      ),
      ...(groups.length ? groups : [h('div', { class: 'bs-empty bs-empty-small' }, 'Nada deste tipo agora.')]),
    ]
  }

  const bgRow = (p: BgProcess, now: number): HTMLElement => {
    const stopping = isStopping(p.id)
    const open = peek?.id === p.id
    const row = h(
      'div',
      { class: `bs-row bs-proc${stopping ? ' stopping' : ''}` },
      kindTag(p),
      h(
        'span',
        { class: 'bs-cmd' },
        h('span', { class: 'bs-cmd-text', title: p.label }, p.label),
        p.ports.length ? h('small', {}, p.ports.map((port) => `localhost:${port}`).join(' · ')) : null,
      ),
      h('span', { class: `r${isOld(p, now) ? ' bs-old' : ''}` }, stopping ? 'parando…' : ageText(p.startedAt, now)),
      h('span', { class: 'r' }, p.cpu === undefined ? '—' : `${p.cpu}%`),
      h('span', { class: 'r' }, mb(p.mem)),
      h(
        'span',
        { class: 'bs-acts' },
        p.ports.length
          ? h(
              'button',
              {
                class: 'icon-btn',
                type: 'button',
                title: `Abrir localhost:${p.ports[0]} no navegador`,
                onclick: () => void window.office.openExternal(`http://localhost:${p.ports[0]}`),
              },
              icon('external', 14),
            )
          : null,
        p.output
          ? h(
              'button',
              { class: 'btn btn-small', type: 'button', 'aria-expanded': String(open), onclick: () => togglePeek(p) },
              icon('eye', 13),
              'Saída',
            )
          : null,
        h(
          'button',
          {
            class: 'btn btn-small bs-stop',
            type: 'button',
            disabled: stopping,
            onclick: () => void stopProcess(root, p, opts.toast, render),
          },
          icon('stop', 12),
          'Parar',
        ),
      ),
    )
    if (!open) return row
    const text = peek!.text
    return h('div', {}, row, h('pre', { class: 'bs-out' }, text === null ? 'Lendo…' : text.trim() || 'Ainda não escreveu nada.'))
  }

  const togglePeek = (p: BgProcess) => {
    if (peek?.id === p.id) {
      peek = null
      return render()
    }
    peek = { id: p.id, text: null }
    render()
    window.office
      .processOutput(p.id)
      .then((text) => {
        if (peek?.id === p.id) peek.text = text
      })
      .catch((err) => {
        if (peek?.id === p.id) peek.text = cleanError(err)
      })
      .finally(render)
  }

  const bgFoot = (): (HTMLElement | null)[] => {
    const loose = state.backstage.filter(isOrphan)
    return [
      h('span', { class: 'bs-hint' }, 'Só aparece o que desce de um claude que o app conhece.'),
      loose.length
        ? h(
            'button',
            {
              class: 'btn btn-danger-soft',
              type: 'button',
              onclick: async () => {
                const ok = await confirmDialog(root, {
                  title: `Parar ${loose.length === 1 ? 'o processo sem dono' : `os ${loose.length} processos sem dono`}?`,
                  text: loose.map((p) => `${p.ports.length ? `:${p.ports[0]} ` : ''}${p.label}`).join('\n'),
                  confirm: 'Parar',
                  cancel: 'Deixar rodando',
                  danger: true,
                })
                if (!ok) return
                for (const p of loose) await act(() => window.office.stopProcess(p.id))
                opts.toast(loose.length === 1 ? 'Parei o processo sem dono.' : `Parei os ${loose.length} processos sem dono.`, 'ok')
              },
            },
            icon('stop', 13),
            `Parar os sem dono (${loose.length})`,
          )
        : null,
    ]
  }

  // ---------- MCP ----------
  const mcpIdle = (v: ToolsView) => v.mcp.filter((m) => !m.locked && !m.off && m.status === 'connected' && m.uses === 0)
  const mcpTab = (v: ToolsView): HTMLElement[] => {
    const is: Record<McpFilter, (m: McpServerView) => boolean> = {
      all: () => true,
      idle: (m) => m.uses === 0 && !m.off && !m.locked,
      attention: (m) => m.status === 'failed' || m.status === 'needs-auth',
      off: (m) => !!m.off,
    }
    const list = v.mcp.filter(is[mcpFilter])
    const max = Math.max(1, ...v.mcp.map((m) => m.uses))
    const banner = v.live
      ? null
      : h(
          'div',
          { class: 'bs-banner' },
          icon('alert', 14),
          h(
            'span',
            {},
            'Nenhum agente do escritório está rodando: a lista vem das configurações, sem status. O status aparece quando um agente começar a trabalhar.',
          ),
        )
    return [
      banner,
      chips<McpFilter>(
        [
          ['all', 'Todos', v.mcp.length],
          ['idle', 'Sem uso', v.mcp.filter(is.idle).length],
          ['attention', 'Pedem atenção', v.mcp.filter(is.attention).length],
          ['off', 'Desligados', v.mcp.filter(is.off).length],
        ],
        mcpFilter,
        (f) => ((mcpFilter = f), render()),
      ),
      h(
        'div',
        { class: 'bs-cols bs-tool', 'aria-hidden': 'true' },
        h('span', {}),
        h('span', {}, 'servidor'),
        h('span', {}, 'usos em 7 dias'),
        h('span', { class: 'r' }, 'agentes'),
        h('span', {}),
      ),
      ...(list.length ? list.map((m) => mcpRow(m, max)) : [h('div', { class: 'bs-empty bs-empty-small' }, 'Nenhum servidor aqui.')]),
    ].filter(Boolean) as HTMLElement[]
  }

  const mcpRow = (m: McpServerView, max: number): HTMLElement => {
    const scope = m.scope ? (SCOPE[m.scope] ?? m.scope) : ''
    const led = m.off
      ? 'off'
      : m.status === 'connected'
        ? 'ok'
        : m.status === 'needs-auth' || m.status === 'pending'
          ? 'warn'
          : m.status === 'failed'
            ? 'fail'
            : 'idle'
    const sub = m.off
      ? 'desligado no escritório'
      : m.status === 'needs-auth'
        ? h('span', { class: 'bs-warn' }, 'pede login')
        : m.status === 'failed'
          ? h('span', { class: 'bs-warn' }, m.error ? `falhou: ${m.error}` : 'falhou ao conectar')
          : m.status === 'connected' && !m.uses && !m.locked
            ? h('span', {}, h('span', { class: 'bs-warn' }, 'sem uso em 7 dias'), m.tools ? ` · ${m.tools} ferramentas no contexto` : '')
            : [m.tools ? `${m.tools} ferramentas` : '', scope, m.status === 'unknown' ? 'sem status' : ''].filter(Boolean).join(' · ')
    const working = busy.has(`mcp:${m.name}`)
    const action = m.locked
      ? h('span', { class: 'bs-locked', title: 'Os agentes usam o quadro por ele: fica sempre ligado.' }, 'sempre ligado')
      : h(
          'span',
          { class: 'bs-acts' },
          m.status === 'failed' && !m.off
            ? h(
                'button',
                {
                  class: 'btn btn-small',
                  type: 'button',
                  disabled: working || !tools?.live,
                  onclick: () => mcpAct(m.name, () => window.office.reconnectMcp(m.name), `${m.name} reconectado.`),
                },
                'Reconectar',
              )
            : null,
          m.status === 'needs-auth' && !m.off
            ? h(
                'button',
                {
                  class: 'btn btn-small',
                  type: 'button',
                  onclick: () =>
                    opts.toast(`Para entrar em ${m.name}, abra o claude no terminal e use /mcp. Depois clique em Reconectar.`, 'info'),
                },
                'Como entrar',
              )
            : null,
          toggleSwitch(
            !m.off,
            m.off ? `Ligar ${m.name}` : `Desligar ${m.name}`,
            (on) =>
              mcpAct(
                m.name,
                () => window.office.toggleMcp(m.name, on),
                on ? `${m.name} ligado para os agentes.` : `${m.name} desligado para os agentes do escritório.`,
              ),
            working,
          ),
        )
    return h(
      'div',
      { class: `bs-row bs-tool${m.off ? ' off' : ''}` },
      h('span', { class: `bs-led bs-led-${led}`, 'aria-hidden': 'true' }),
      h('span', { class: 'bs-name' }, h('b', {}, m.name), h('small', {}, sub)),
      h(
        'span',
        { class: 'bs-use', title: m.lastUsed ? `Último uso: ${dayText(m.lastUsed)}` : 'Sem uso em 7 dias' },
        useBlocks(m.uses, max),
        h('span', { class: m.uses ? '' : 'z' }, String(m.uses)),
      ),
      h('span', { class: 'r' }, m.agents ? `${m.agents} ag.` : '—'),
      action,
    )
  }

  const mcpAct = (name: string, fn: () => Promise<ToolsView>, ok: string) => {
    busy.add(`mcp:${name}`)
    render()
    void act(async () => (tools = await fn()), ok).finally(() => {
      busy.delete(`mcp:${name}`)
      render()
    })
  }

  const mcpFoot = (v: ToolsView): (HTMLElement | null)[] => {
    const idle = mcpIdle(v)
    return [
      h(
        'span',
        { class: 'bs-hint' },
        idle.length
          ? `${idle.length === 1 ? '1 servidor ligado' : `${idle.length} servidores ligados`} sem uso em 7 dias: as ferramentas ocupam contexto em cada agente.`
          : 'Desligar vale para todos os agentes do escritório, agora e nos próximos.',
      ),
      idle.length
        ? h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                const ok = await confirmDialog(root, {
                  title: `Desligar ${idle.length === 1 ? idle[0].name : `${idle.length} servidores`}?`,
                  text: `${idle.map((m) => m.name).join(', ')}.\n\nVale para os agentes do escritório; o terminal continua igual. Dá para ligar de novo aqui.`,
                  confirm: 'Desligar',
                  cancel: 'Cancelar',
                })
                if (!ok) return
                for (const m of idle) await act(async () => (tools = await window.office.toggleMcp(m.name, false)))
                opts.toast(`Desliguei ${idle.length === 1 ? idle[0].name : `${idle.length} servidores sem uso`}.`, 'ok')
                render()
              },
            },
            `Desligar os sem uso (${idle.length})`,
          )
        : null,
    ]
  }

  // ---------- Skills ----------
  const skillsTab = (v: ToolsView): HTMLElement[] => {
    const search = h('input', {
      class: 'input bs-search',
      type: 'search',
      placeholder: 'Buscar skill ou descrição',
      value: query,
      'aria-label': 'Buscar skill',
    }) as HTMLInputElement
    search.addEventListener('input', () => {
      query = search.value
      const list = body.querySelector('.bs-skill-list')
      if (list) list.replaceChildren(...skillRows(v))
    })
    const count = (f: SkillFilter) => (f === 'plugins' ? v.plugins.length : v.skills.filter(skillIs[f]).length)
    return [
      search,
      chips<SkillFilter>(
        skillChips
          .map(([k, label]): [SkillFilter, string, number] => [k, label, count(k)])
          .filter(([k, , n]) => n || k === 'week' || k === skillFilter),
        skillFilter,
        (f) => ((skillFilter = f), render()),
      ),
      skillFilter === 'plugins'
        ? h(
            'div',
            { class: 'bs-skill-list' },
            ...(v.plugins.length ? v.plugins.map(pluginRow) : [h('div', { class: 'bs-empty bs-empty-small' }, 'Nenhum plugin instalado.')]),
          )
        : h('div', { class: 'bs-skill-list' }, ...skillRows(v)),
    ]
  }

  const skillChips: [SkillFilter, string][] = [
    ['week', 'Usadas na semana'],
    ['user', 'Suas'],
    ['project', 'Do projeto'],
    ['plugin', 'De plugins'],
    ['builtin', 'Do Claude Code'],
    ['plugins', 'Plugins'],
  ]
  const skillIs: Record<Exclude<SkillFilter, 'plugins'>, (s: SkillView) => boolean> = {
    week: (s) => s.uses > 0,
    user: (s) => s.source === 'user',
    project: (s) => s.source === 'project',
    plugin: (s) => s.source === 'plugin',
    builtin: (s) => s.source === 'builtin',
  }

  const skillRows = (v: ToolsView): HTMLElement[] => {
    const f = skillFilter
    if (f === 'plugins') return []
    const q = query.trim().toLowerCase()
    const list = v.skills.filter((s) =>
      q ? `${s.name} ${s.plugin ?? ''} ${s.description ?? ''}`.toLowerCase().includes(q) : skillIs[f](s),
    )
    const max = Math.max(1, ...v.skills.map((s) => s.uses))
    if (!list.length)
      return [
        h(
          'div',
          { class: 'bs-empty bs-empty-small' },
          q
            ? 'Nenhuma skill com esse nome ou descrição.'
            : skillFilter === 'week'
              ? 'Nenhuma skill usada nos últimos 7 dias.'
              : 'Nenhuma skill aqui.',
        ),
      ]
    return list.map((s) => {
      const key = s.plugin ? `${s.plugin}:${s.name}` : s.name
      return h(
        'div',
        { class: 'bs-row bs-skill' },
        h(
          'span',
          { class: 'bs-name' },
          h('b', {}, s.name, s.plugin ? h('span', { class: 'bs-plugin' }, s.plugin) : null),
          s.description ? h('small', { title: s.description }, s.description) : null,
        ),
        h('span', { class: 'bs-src' }, SOURCE[s.source]),
        h(
          'span',
          { class: 'bs-use', title: s.lastUsed ? `Último uso: ${dayText(s.lastUsed)}` : 'Sem uso em 7 dias' },
          useBlocks(s.uses, max),
          h('span', { class: s.uses ? '' : 'z' }, String(s.uses)),
        ),
        h('span', { class: 'r bs-last' }, dayText(s.lastUsed)),
        h(
          'span',
          { class: 'bs-acts' },
          s.path
            ? h(
                'button',
                {
                  class: 'btn btn-small',
                  type: 'button',
                  title: 'Mostrar o SKILL.md no Finder',
                  onclick: () => void act(() => window.office.revealSkill(key)),
                },
                'Abrir',
              )
            : null,
        ),
      )
    })
  }

  const pluginRow = (p: PluginView): HTMLElement => {
    const [name, market] = p.id.split('@')
    const working = busy.has(`plugin:${p.id}`)
    return h(
      'div',
      { class: `bs-row bs-plugin-row${p.enabled ? '' : ' off'}` },
      h('span', { class: `bs-led bs-led-${p.enabled ? 'ok' : 'off'}`, 'aria-hidden': 'true' }),
      h('span', { class: 'bs-name' }, h('b', {}, name), h('small', {}, market ? `de ${market}` : 'plugin')),
      toggleSwitch(
        p.enabled,
        p.enabled ? `Desligar ${name}` : `Ligar ${name}`,
        (on) => {
          busy.add(`plugin:${p.id}`)
          render()
          void act(
            async () => (tools = await window.office.togglePlugin(p.id, on)),
            on ? `${name} ligado. Os agentes recarregam os plugins agora.` : `${name} desligado. Os agentes recarregam os plugins agora.`,
          ).finally(() => {
            busy.delete(`plugin:${p.id}`)
            render()
          })
        },
        working,
      ),
    )
  }

  const skillsFoot = (v: ToolsView): HTMLElement[] => [
    h(
      'span',
      { class: 'bs-hint' },
      skillFilter === 'plugins'
        ? 'Grava enabledPlugins no ~/.claude/settings.json, que vale também para o terminal.'
        : `Usos dos últimos 7 dias${v.usageSince ? ` (desde ${dayText(v.usageSince)})` : ''}, contados nos transcripts.${v.reading ? ' Ainda lendo: os números podem subir.' : ''}`,
    ),
  ]

  // ---------- frame ----------
  const renderTabs = () => {
    const n = state.backstage.length
    const loose = state.backstage.some(isOrphan)
    const tabBtn = (k: BackstageTab, label: string, ic: string, badge?: HTMLElement | null) =>
      h(
        'button',
        {
          class: `bs-tab${tab === k ? ' on' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': String(tab === k),
          onclick: () => show(k),
        },
        icon(ic, 15),
        label,
        badge,
      )
    tabsEl.replaceChildren(
      tabBtn('bg', 'Segundo plano', 'terminal', n ? h('span', { class: `bs-count${loose ? ' warn' : ''}` }, String(n)) : null),
      tabBtn('mcp', 'MCP', 'rack'),
      tabBtn('skills', 'Skills', 'book'),
      tabBtn('wt', 'Worktrees', 'branch', wt.loose() ? h('span', { class: 'bs-count warn', title: 'Cópias esquecidas' }, String(wt.loose())) : null),
    )
  }

  const render = () => {
    renderTabs()
    if (tab === 'bg') {
      body.replaceChildren(...bgTab())
      foot.replaceChildren(...(bgFoot().filter(Boolean) as HTMLElement[]))
      return
    }
    if (tab === 'wt') {
      body.replaceChildren(...wt.body())
      foot.replaceChildren(...wt.foot())
      return
    }
    if (!tools) {
      body.replaceChildren(
        toolsError
          ? h(
              'div',
              { class: 'bs-empty' },
              icon('alert', 22),
              h('b', {}, 'Não consegui ler as ferramentas.'),
              h('span', {}, toolsError),
              h('button', { class: 'btn', type: 'button', onclick: () => loadTools(true) }, 'Tentar de novo'),
            )
          : h(
              'div',
              { class: 'bs-empty' },
              h('span', { class: 'bs-spin' }, icon('history', 20)),
              h('span', {}, tab === 'mcp' ? 'Perguntando aos agentes pelos servidores…' : 'Lendo as skills…'),
            ),
      )
      foot.replaceChildren()
      return
    }
    const keep = body.querySelector<HTMLInputElement>('.bs-search') === document.activeElement
    body.replaceChildren(...(tab === 'mcp' ? mcpTab(tools) : skillsTab(tools)))
    foot.replaceChildren(...((tab === 'mcp' ? mcpFoot(tools) : skillsFoot(tools)).filter(Boolean) as HTMLElement[]))
    if (keep) body.querySelector<HTMLInputElement>('.bs-search')?.focus()
  }

  const show = (k: BackstageTab) => {
    tab = k
    if (k === 'wt') wt.load()
    else if (k !== 'bg') loadTools()
    render()
  }
  switchTab = show
  // The process list changes every few seconds; the tool tabs only on demand.
  redrawOpen = () => (tab === 'bg' ? render() : renderTabs())
  root.append(el)
  show(tab)
  tabsEl.querySelector<HTMLElement>('.bs-tab.on')?.focus()
}
