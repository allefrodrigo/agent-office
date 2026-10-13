import type { AgentSummary, SubagentInfo } from '@shared/types'
import { helperActivity } from '@shared/describe'
import { h, icon } from './dom'
import './panel-helpers.css'

/**
 * "Ajudantes" in the agent panel (AO-46): the subagents of the agent, running first,
 * with what each is doing now. A click opens the helper's own log in the panel.
 */

const OPEN_KEY = 'panel-helpers-open'

const STATUS: Record<NonNullable<SubagentInfo['status']> | 'running', { label: string; dot: string }> = {
  running: { label: 'Rodando', dot: 'working' },
  completed: { label: 'Terminou', dot: 'done' },
  failed: { label: 'Falhou', dot: 'error' },
  stopped: { label: 'Interrompido', dot: 'stopped' },
}

/** The section, or null when the agent never had a helper. `viewing` = helper whose log is open. */
export function helpersSection(a: AgentSummary, viewing: string | null, pick: (subId: string | null) => void): HTMLElement | null {
  const running = a.subagents ?? []
  const done = [...(a.subagentsDone ?? [])].reverse()
  if (!running.length && !done.length) return null
  const open = viewing !== null || localStorage.getItem(OPEN_KEY) !== '0'
  const count = [running.length ? `${running.length} rodando` : '', done.length ? `${done.length} ${done.length === 1 ? 'terminou' : 'terminaram'}` : ''].filter(Boolean).join(' · ')
  const toggle = h(
    'button',
    {
      class: `helpers-head${open ? ' open' : ''}`,
      'aria-expanded': open ? 'true' : 'false',
      title: open ? 'Esconder a lista' : 'Mostrar o que cada ajudante está fazendo',
      onclick: () => {
        localStorage.setItem(OPEN_KEY, open ? '0' : '1')
        // pick(viewing) re-renders without leaving the log on screen.
        pick(viewing)
      },
    },
    icon('chevron', 13),
    h('span', { class: 'helpers-title' }, 'Ajudantes'),
    h('span', { class: 'helpers-count' }, count),
  )
  const back = viewing
    ? h('button', { class: 'btn btn-small helpers-back', title: `Voltar ao log de ${a.name}`, onclick: () => pick(null) }, h('span', { class: 'arrow-back' }, icon('chevron', 13)), `Log de ${a.name}`)
    : null
  return h(
    'div',
    { class: 'panel-helpers' },
    h('div', { class: 'helpers-bar' }, toggle, back),
    open ? h('div', { class: 'helpers-list', role: 'list' }, ...[...running, ...done].map((s) => helperRow(s, s.id === viewing, () => pick(s.id === viewing ? null : s.id)))) : null,
  )
}

/** Fills the panel's helpers slot again, keeping the list where it was scrolled to. */
export function renderHelpers(slot: HTMLElement, a: AgentSummary, viewing: string | null, pick: (subId: string | null) => void): void {
  const scroll = slot.querySelector('.helpers-list')?.scrollTop ?? 0
  const section = helpersSection(a, viewing, pick)
  slot.replaceChildren(...(section ? [section] : []), ...(viewing ? [helperBanner(a, viewing)] : []))
  const list = slot.querySelector('.helpers-list')
  if (list) list.scrollTop = scroll
}

/** Banner over the feed while a helper's log is open. */
export function helperBanner(a: AgentSummary, subId: string): HTMLElement {
  const sub = findHelper(a, subId)
  return h(
    'div',
    { class: 'helper-banner' },
    icon('users', 13),
    h('span', {}, sub ? `Log do ajudante · ${sub.description}` : 'Log do ajudante'),
  )
}

export function findHelper(a: AgentSummary, subId: string): SubagentInfo | undefined {
  return a.subagents?.find((x) => x.id === subId) ?? a.subagentsDone?.find((x) => x.id === subId)
}

function helperRow(s: SubagentInfo, on: boolean, onclick: () => void): HTMLElement {
  const st = STATUS[s.status ?? 'running']
  const live = !s.status
  const meta = [
    s.type ? s.type : '',
    s.toolUses ? `${s.toolUses} ${s.toolUses === 1 ? 'ferramenta' : 'ferramentas'}` : '',
    s.tokens ? `${Math.round(s.tokens / 1000)}k tokens` : '',
    s.background ? 'em segundo plano' : '',
  ].filter(Boolean)
  return h(
    'button',
    {
      class: `helper-row${on ? ' on' : ''}${live ? ' live' : ''}`,
      role: 'listitem',
      'aria-current': on ? 'true' : null,
      title: `${s.description}\n${st.label}${live ? ` · ${helperActivity(s)}` : ''}\nClique para ver o log deste ajudante`,
      onclick,
    },
    h('span', { class: `dot dot-${st.dot}`, 'aria-hidden': 'true' }),
    h(
      'span',
      { class: 'helper-main' },
      h('span', { class: 'helper-desc' }, s.description),
      h('span', { class: 'helper-act' }, live ? helperActivity(s) : s.summary || st.label),
    ),
    h(
      'span',
      { class: 'helper-side' },
      timeEl(s),
      h('span', { class: 'helper-meta' }, live ? meta.join(' · ') : [st.label, ...meta].join(' · ')),
    ),
  )
}

/** Running: ticks every second. Ended: how long it took. Resumed from disk: no time known. */
function timeEl(s: SubagentInfo): HTMLElement | null {
  if (!s.startedAt) return null
  if (s.endedAt) return h('span', { class: 'helper-time' }, duration(s.endedAt - s.startedAt))
  startTicking()
  return h('span', { class: 'helper-time', 'data-since': s.startedAt }, duration(Date.now() - s.startedAt))
}

/** 42 s · 3 min 05 s · 1 h 02 min */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

let ticking: ReturnType<typeof setInterval> | null = null

/** One timer for every running clock on screen; it stops when none is left. */
function startTicking(): void {
  if (ticking) return
  ticking = setInterval(() => {
    const clocks = document.querySelectorAll<HTMLElement>('.helper-time[data-since]')
    if (!clocks.length && ticking) {
      clearInterval(ticking)
      ticking = null
      return
    }
    const now = Date.now()
    for (const el of clocks) el.textContent = duration(now - Number(el.dataset.since))
  }, 1000)
}
