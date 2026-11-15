import { clockTime, type WeekChip, type WeekGrid } from '@shared/bots-view'
import type { Bot } from '@shared/types'
import { h, icon } from '../../dom'

// A semana de Automações: uma tabela com os dias nas colunas e os horários nas linhas. Agenda
// diária, dias da semana, cron e "uma vez" viram fichas nas células; intervalos vão para a faixa
// "A cada…" e eventos para "Em eventos". Pausadas aparecem apagadas. Cada ficha abre o formulário.

export interface CalendarCtx {
  bot(id: string | null): Bot | undefined
  open(chip: WeekChip): void
  shift(weeks: number): void
  today(): void
  title: string
  isThisWeek: boolean
}

function chipLabel(c: WeekChip, bot: Bot | undefined, extra?: string): string {
  return [c.name, bot && bot.name !== c.name ? bot.name : '', extra, c.label, c.paused ? 'pausada' : '', c.past ? 'já passou' : '']
    .filter(Boolean)
    .join(' · ')
}

function chip(ctx: CalendarCtx, c: WeekChip, text: string, extra?: string): HTMLElement {
  const bot = ctx.bot(c.botId)
  return h(
    'button',
    {
      type: 'button',
      class: `ch-wchip${c.paused ? ' paused' : ''}${c.past ? ' past' : ''}`,
      style: `--av: ${bot?.color ?? '#9a98b4'}`,
      title: chipLabel(c, bot, extra),
      'aria-label': chipLabel(c, bot, extra),
      onclick: () => ctx.open(c),
    },
    c.paused ? icon('pause', 11) : null,
    h('span', {}, text),
  )
}

/** The grid of the week, then the two strips. */
export function weekView(grid: WeekGrid, ctx: CalendarCtx): HTMLElement {
  const nameOf = (c: WeekChip) => ctx.bot(c.botId)?.name ?? c.name
  const head = h(
    'tr',
    {},
    h('th', { scope: 'col', class: 'ch-week-time' }, h('span', { class: 'sr-only' }, 'Horário')),
    ...grid.days.map((d) =>
      h('th', { scope: 'col', class: d.today ? 'today' : '', 'aria-current': d.today ? 'date' : undefined }, d.label),
    ),
  )
  const body = grid.rows.length
    ? grid.rows.map((r) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row', class: 'ch-week-time' }, r.time),
          ...r.cells.map((cell, i) =>
            h(
              'td',
              { class: grid.days[i].today ? 'today' : '' },
              ...cell.map((c) => chip(ctx, c, nameOf(c), c.at !== undefined ? `${grid.days[i].label} às ${clockTime(c.at)}` : undefined)),
            ),
          ),
        ),
      )
    : [
        h(
          'tr',
          {},
          h(
            'td',
            { colspan: 8, class: 'ch-week-none' },
            'Nada com hora marcada nesta semana. Intervalos e eventos ficam nas faixas abaixo.',
          ),
        ),
      ]
  const strip = (title: string, chips: WeekChip[], text: (c: WeekChip) => string, empty: string) =>
    h(
      'section',
      { class: 'ch-week-strip', 'aria-label': title },
      h('h3', { class: 'ch-week-strip-title' }, title),
      chips.length
        ? h('div', { class: 'ch-week-chips' }, ...chips.map((c) => chip(ctx, c, text(c))))
        : h('p', { class: 'ch-field-hint' }, empty),
    )
  return h(
    'div',
    { class: 'ch-week' },
    h(
      'div',
      { class: 'ch-week-nav' },
      h(
        'button',
        { type: 'button', class: 'ch-icon-btn', title: 'Semana anterior', 'aria-label': 'Semana anterior', onclick: () => ctx.shift(-1) },
        h('span', { class: 'ch-flip', 'aria-hidden': 'true' }, icon('chevron', 17)),
      ),
      h('h3', { class: 'ch-week-title', 'aria-live': 'polite' }, ctx.title),
      h(
        'button',
        { type: 'button', class: 'ch-icon-btn', title: 'Próxima semana', 'aria-label': 'Próxima semana', onclick: () => ctx.shift(1) },
        icon('chevron', 17),
      ),
      ctx.isThisWeek ? null : h('button', { type: 'button', class: 'btn btn-small', onclick: () => ctx.today() }, 'Esta semana'),
    ),
    h(
      'div',
      { class: 'ch-week-scroll' },
      h(
        'table',
        { class: 'ch-week-grid', 'aria-label': `Automações da semana: ${ctx.title}` },
        h('thead', {}, head),
        h('tbody', {}, ...body),
      ),
    ),
    strip('A cada…', grid.every, (c) => `${c.label}: ${nameOf(c)}`, 'Nenhuma automação por intervalo.'),
    strip('Em eventos', grid.events, (c) => `${c.label} → ${nameOf(c)}`, 'Nenhuma automação por evento.'),
  )
}
