import type { WorktreeEntry, WorktreeFloor } from '@shared/types'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { cleanError } from '../modals'
import { ageText, type Toast } from './shared'

// Bastidores → Worktrees: every agent copy, floor by floor, with its size and what removing it loses.

export type WtFilter = 'all' | 'loose' | 'work' | 'busy'

export const isBusy = (w: WorktreeEntry) => !!w.agentId
/** Work that lives only in the copy: uncommitted changes or commits on no other branch. */
export const hasWork = (w: WorktreeEntry) => !w.broken && (w.dirty > 0 || w.unique > 0)
/** Nobody in it and nothing to lose: the "limpar" button takes these. */
export const isLoose = (w: WorktreeEntry) => !w.agentId && !hasWork(w)
export const isSafe = (w: WorktreeEntry) => isLoose(w) && !w.broken

export const sizeText = (n?: number) =>
  n === undefined
    ? '—'
    : n >= 1024 ** 3
      ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB`
      : `${Math.max(n ? 1 : 0, Math.round(n / 1024 ** 2))} MB`

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What the copy holds, in one line. */
export function statusText(w: WorktreeEntry): { text: string; tone: 'ok' | 'warn' | 'fail' | 'idle' } {
  if (w.broken)
    return { text: w.exists ? 'pasta solta: o git não a conhece mais, só ocupa espaço' : 'o git lista, mas a pasta sumiu', tone: 'fail' }
  if (w.agentId) return { text: `${w.agentName ?? 'um agente'} trabalha aqui`, tone: 'ok' }
  const parts = [
    w.dirty ? plural(w.dirty, 'mudança sem commit', 'mudanças sem commit') : '',
    w.unique ? plural(w.unique, 'commit só nela', 'commits só nela') : '',
  ].filter(Boolean)
  if (parts.length) return { text: `sem agente · ${parts.join(' · ')}`, tone: 'warn' }
  if (w.ahead) return { text: `sem agente · ${plural(w.ahead, 'commit', 'commits')} já em outro branch, nada se perde`, tone: 'idle' }
  return { text: 'sem agente · nada pendente, pode remover', tone: 'idle' }
}

export interface WorktreesView {
  body(): HTMLElement[]
  foot(): HTMLElement[]
  /** Loose copies, for the tab badge; null until the first load. */
  loose(): number | null
  load(force?: boolean): void
}

export function worktreesView(
  root: HTMLElement,
  state: State,
  opts: { toast: Toast; openAgent(id: string): void; close(): void; render(): void },
): WorktreesView {
  let floors: WorktreeFloor[] | null = null
  let error = ''
  let loading = false
  let filter: WtFilter = 'all'
  const busy = new Set<string>()

  const load = (force = false) => {
    if (loading || (floors && !force)) return
    loading = true
    error = ''
    window.office
      .listWorktrees()
      .then((f) => void (floors = f))
      .catch((err) => void (error = cleanError(err)))
      .finally(() => {
        loading = false
        opts.render()
      })
    opts.render()
  }
  const all = () => (floors ?? []).flatMap((f) => f.items)

  const run = async (key: string, fn: () => Promise<string | null>) => {
    busy.add(key)
    opts.render()
    try {
      const msg = await fn()
      if (msg) {
        opts.toast(msg, 'ok')
        floors = null
        load(true)
      }
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    } finally {
      busy.delete(key)
      opts.render()
    }
  }

  const setFloorDefault = async (floorId: string, on: boolean) => {
    const projects = state.settings.projects.map((p) => {
      if (p.id !== floorId) return p
      const { worktrees: _w, ...rest } = p
      return on ? rest : { ...rest, worktrees: false as const }
    })
    try {
      await window.office.saveSettings({ projects })
      for (const f of floors ?? []) if (f.floorId === floorId) f.worktrees = on
      opts.toast(
        on
          ? 'Agentes novos deste andar ganham uma cópia isolada (worktree).'
          : 'Agentes novos deste andar mexem direto na pasta do projeto.',
        'ok',
      )
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    }
    opts.render()
  }

  const row = (w: WorktreeEntry): HTMLElement => {
    const st = statusText(w)
    const name = w.branch ? w.branch.replace(/^agent\//, '') : (w.root.split(/[\\/]/).pop() ?? w.root)
    const removing = busy.has(w.root)
    return h(
      'div',
      { class: `bs-row bs-wt${removing ? ' stopping' : ''}` },
      h('span', { class: `bs-led bs-led-${st.tone}`, 'aria-hidden': 'true' }),
      h(
        'span',
        { class: 'bs-name' },
        h('b', { title: `${w.branch}\n${w.root}` }, name),
        h('small', { class: st.tone === 'warn' || st.tone === 'fail' ? 'bs-warn' : '' }, st.text),
      ),
      h('span', { class: 'r' }, sizeText(w.size)),
      h(
        'span',
        { class: 'r', title: w.createdAt ? `Criada em ${new Date(w.createdAt).toLocaleString('pt-BR')}` : '' },
        w.createdAt ? ageText(w.createdAt) : '—',
      ),
      h(
        'span',
        { class: 'bs-acts' },
        w.exists
          ? h(
              'button',
              {
                class: 'icon-btn',
                type: 'button',
                title: 'Mostrar a pasta',
                'aria-label': 'Mostrar a pasta',
                onclick: () => void window.office.revealPath(w.root),
              },
              icon('folder', 14),
            )
          : null,
        w.agentId
          ? h(
              'button',
              { class: 'btn btn-small', type: 'button', onclick: () => (opts.close(), opts.openAgent(w.agentId!)) },
              icon('eye', 13),
              'Ver agente',
            )
          : h(
              'button',
              {
                class: 'btn btn-small bs-stop',
                type: 'button',
                disabled: removing,
                onclick: () => void run(w.root, () => window.office.removeWorktreeAt(w.root)),
              },
              icon('trash', 12),
              removing ? 'Removendo…' : 'Remover',
            ),
      ),
    )
  }

  const floorSection = (f: WorktreeFloor): HTMLElement | null => {
    const is: Record<WtFilter, (w: WorktreeEntry) => boolean> = { all: () => true, loose: isLoose, work: hasWork, busy: isBusy }
    const items = f.items.filter(is[filter])
    if (!items.length && filter !== 'all') return null
    const total = f.items.reduce((n, w) => n + (w.size ?? 0), 0)
    const color = state.settings.projects.find((p) => p.id === f.floorId)?.brandColor ?? 'var(--accent)'
    return h(
      'section',
      { class: 'bs-group' },
      h(
        'div',
        { class: 'bs-own bs-wt-floor' },
        h('span', { class: 'info-px', style: `background:${f.floorId ? color : 'var(--dim)'}` }),
        h('span', { class: 'bs-own-name', title: f.repo }, f.name),
        h(
          'span',
          { class: 'bs-own-kind' },
          f.items.length ? `${plural(f.items.length, 'cópia', 'cópias')} · ${sizeText(total)}` : 'nenhuma cópia',
        ),
        f.floorId
          ? h(
              'label',
              { class: 'bs-wt-default', title: 'Vale para agentes novos deste andar. No contratar dá para mudar caso a caso.' },
              h('span', {}, f.worktrees ? 'agentes novos em worktree' : 'agentes novos direto no projeto'),
              h('button', {
                class: `bs-switch${f.worktrees ? ' on' : ''}`,
                type: 'button',
                role: 'switch',
                'aria-checked': String(f.worktrees),
                'aria-label': `Worktree para agentes novos em ${f.name}`,
                onclick: () => void setFloorDefault(f.floorId!, !f.worktrees),
              }),
            )
          : h('span', { class: 'bs-own-kind' }, 'fora dos andares'),
      ),
      ...(items.length
        ? items.map(row)
        : [
            h(
              'div',
              { class: 'bs-empty-small bs-wt-none' },
              f.worktrees ? 'Nenhuma cópia agora.' : 'Nenhuma cópia: os agentes daqui mexem direto na pasta do projeto.',
            ),
          ]),
    )
  }

  const chips = () => {
    const list = all()
    const tab = (k: WtFilter, label: string, n: number) =>
      h(
        'button',
        {
          class: `bs-filter${filter === k ? ' on' : ''}`,
          type: 'button',
          'aria-pressed': String(filter === k),
          onclick: () => ((filter = k), opts.render()),
        },
        label,
        h('b', {}, String(n)),
      )
    return h(
      'div',
      { class: 'bs-filters' },
      tab('all', 'Todas', list.length),
      tab('loose', 'Esquecidas', list.filter(isLoose).length),
      tab('work', 'Com trabalho guardado', list.filter(hasWork).length),
      tab('busy', 'Em uso', list.filter(isBusy).length),
    )
  }

  return {
    load,
    loose: () => (floors ? all().filter(isLoose).length : null),
    body: () => {
      if (error)
        return [
          h(
            'div',
            { class: 'bs-empty' },
            icon('alert', 22),
            h('b', {}, 'Não consegui ler as cópias.'),
            h('span', {}, error),
            h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, 'Tentar de novo'),
          ),
        ]
      if (!floors)
        return [
          h(
            'div',
            { class: 'bs-empty' },
            h('span', { class: 'bs-spin' }, icon('history', 20)),
            h('span', {}, 'Medindo as cópias dos agentes…'),
          ),
        ]
      if (!floors.length)
        return [
          h(
            'div',
            { class: 'bs-empty' },
            icon('branch', 22),
            h('b', {}, 'Nenhum andar com repositório git.'),
            h('span', {}, 'As cópias isoladas (worktrees) só existem em projetos com git. Crie um andar para a pasta do projeto.'),
          ),
        ]
      const list = all()
      const total = list.reduce((n, w) => n + (w.size ?? 0), 0)
      const loose = list.filter(isSafe)
      const looseSize = loose.reduce((n, w) => n + (w.size ?? 0), 0)
      const banner = loose.length
        ? h(
            'div',
            { class: 'bs-banner' },
            icon('alert', 14),
            h(
              'span',
              {},
              `${plural(loose.length, 'cópia esquecida ocupa', 'cópias esquecidas ocupam')} ${sizeText(looseSize)}: sem agente e sem trabalho guardado só nelas.`,
            ),
          )
        : null
      const sections = floors.map(floorSection).filter(Boolean) as HTMLElement[]
      return [
        h(
          'p',
          { class: 'bs-wt-intro' },
          `Cada agente em worktree trabalha numa cópia do repositório, num branch próprio: ${plural(list.length, 'cópia', 'cópias')}, ${sizeText(total)} no disco.`,
        ),
        ...(banner ? [banner] : []),
        chips(),
        h(
          'div',
          { class: 'bs-cols bs-wt', 'aria-hidden': 'true' },
          h('span', {}),
          h('span', {}, 'cópia'),
          h('span', { class: 'r' }, 'disco'),
          h('span', { class: 'r' }, 'idade'),
          h('span', {}),
        ),
        ...(sections.length ? sections : [h('div', { class: 'bs-empty bs-empty-small' }, 'Nenhuma cópia deste tipo.')]),
      ]
    },
    foot: () => {
      const safe = all().filter(isSafe)
      const size = safe.reduce((n, w) => n + (w.size ?? 0), 0)
      return [
        h('span', { class: 'bs-hint' }, 'Remover apaga a pasta. O branch só sai quando todos os commits dele já estão em outro lugar.'),
        h('button', { class: 'btn', type: 'button', disabled: loading, onclick: () => load(true) }, icon('reset', 13), 'Atualizar'),
        safe.length
          ? h(
              'button',
              {
                class: 'btn btn-danger-soft',
                type: 'button',
                disabled: busy.has('clean'),
                onclick: () => void run('clean', () => window.office.cleanWorktrees()),
              },
              icon('trash', 13),
              `Limpar esquecidas (${safe.length} · ${sizeText(size)})`,
            )
          : null,
      ].filter(Boolean) as HTMLElement[]
    },
  }
}
