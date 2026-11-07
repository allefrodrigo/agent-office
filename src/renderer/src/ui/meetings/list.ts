import { clockTime, groupMeetings, isLive, shortDuration, statusLabel } from '@shared/meeting-room'
import type { Meeting } from '@shared/types/meetings'
import { arrowList, keepFocus } from '../a11y'
import { h, icon } from '../dom'

// A lista da esquerda: as reuniões do andar por Hoje, Semana e Antes, com busca, e "+ Nova".

export interface MeetingListView {
  el: HTMLElement
  render(meetings: readonly Meeting[], selected: string | null): void
  focus(): void
}

const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })

function when(m: Meeting): string {
  const day = new Date(m.startedAt)
  const today = new Date()
  const time = clockTime(m.startedAt)
  return day.toDateString() === today.toDateString() ? time : `${DATE.format(day).replace('.', '')} · ${time}`
}

export function meetingList(opts: { onSelect(id: string): void; onNew(): void }): MeetingListView {
  const search = h('input', { class: 'input mr-search', type: 'search', placeholder: 'Buscar', 'aria-label': 'Buscar reuniões' })
  const groups = h('nav', { class: 'mr-groups', 'aria-label': 'Reuniões do andar' })
  const add = h('button', { class: 'btn mr-add', type: 'button', onclick: () => opts.onNew() }, icon('plus', 15), 'Nova')
  const el = h('div', { class: 'mr-list' }, h('div', { class: 'mr-search-wrap' }, icon('search', 14), search), groups, add)
  arrowList(groups, '.mr-item')
  let last: { meetings: readonly Meeting[]; selected: string | null } = { meetings: [], selected: null }

  const draw = () => {
    const { meetings, selected } = last
    const parts = groupMeetings(meetings, search.value)
    if (!parts.length) {
      groups.replaceChildren(
        h('p', { class: 'mr-empty' }, meetings.length ? 'Nenhuma reunião com essa busca.' : 'Nenhuma reunião neste andar ainda.'),
      )
      return
    }
    const items: HTMLElement[] = []
    groups.replaceChildren(
      ...parts.map((g) =>
        h(
          'div',
          { class: 'mr-group', role: 'group', 'aria-label': g.group },
          h('div', { class: 'mr-group-title', 'aria-hidden': 'true' }, g.group),
          g.items.map((m) => {
            const live = isLive(m.status)
            const meta = live
              ? statusLabel(m.status)
              : m.status === 'ready' && m.durationMs
                ? shortDuration(m.durationMs)
                : m.status === 'ready'
                  ? ''
                  : statusLabel(m.status)
            const b = h(
              'button',
              {
                class: `mr-item s-${m.status}${m.id === selected ? ' on' : ''}`,
                type: 'button',
                'aria-current': m.id === selected ? 'true' : undefined,
                'data-focus-key': m.id,
                onclick: () => opts.onSelect(m.id),
              },
              live ? h('span', { class: 'mr-item-dot', 'aria-hidden': 'true' }) : null,
              h('span', { class: 'mr-item-title' }, m.title),
              h('span', { class: 'mr-item-meta' }, when(m), meta ? ` · ${meta}` : ''),
            )
            items.push(b)
            return b
          }),
        ),
      ),
    )
    // Só um item na ordem do Tab (setas andam entre eles): o aberto, ou o primeiro.
    const current = Math.max(
      0,
      items.findIndex((b) => b.classList.contains('on')),
    )
    items.forEach((b, i) => (b.tabIndex = i === current ? 0 : -1))
  }

  search.addEventListener('input', () => draw())
  // ↓ da busca vai para a lista.
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return
    e.preventDefault()
    groups.querySelector<HTMLElement>('.mr-item')?.focus()
  })

  return {
    el,
    render(meetings, selected) {
      last = { meetings, selected }
      keepFocus(groups, draw)
    },
    focus: () => search.focus(),
  }
}
