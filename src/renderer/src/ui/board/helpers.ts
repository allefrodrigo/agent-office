import type { AgentSummary, OfficePermissionMode, Ticket, TicketStatus } from '@shared/types'
import { h } from '../dom'
import { renderMarkdown } from '../markdown'

// Board constants and small DOM helpers shared by its parts.

export type Who = 'all' | 'me' | 'agents' | 'none'

/** Floor filter value for tickets outside every project folder. */
export const GROUND = 'ground'

/** "Sem pedir nada" is left out on purpose: a ticket may come from someone else. */
export const DELEGATE_MODES: { value: OfficePermissionMode; label: string }[] = [
  { value: 'default', label: 'Pedir permissão' },
  { value: 'acceptEdits', label: 'Editar livremente' },
  { value: 'auto', label: 'Automático' },
  { value: 'plan', label: 'Planejar primeiro' },
]

export const EMPTY: Record<TicketStatus, string> = {
  backlog: 'Ideias e pedidos ainda sem prioridade.',
  todo: 'Pronto para pegar. Arraste para cá o que vem a seguir.',
  doing: 'Delegue um ticket e ele aparece aqui.',
  review: 'Entregas dos agentes esperando sua revisão.',
  done: 'Aprovados ficam aqui até você fechar.',
}

export const DONE_SHOWN = 40

/** Auto-close choices, in days; 0 = only by hand. */
export const AUTO_CLOSE = [0, 1, 3, 7, 14, 30]

/** What a closed ticket was about and how it ended: context, criteria, the last comments. */
export function closedBody(t: Ticket): HTMLElement {
  const last = t.comments.slice(-3)
  return h(
    'div',
    { class: 'closed-body' },
    t.description.trim() ? renderMarkdown(t.description) : h('div', { class: 'field-hint' }, 'Sem contexto.'),
    t.acceptance.length ? h('ul', { class: 'closed-criteria' }, ...t.acceptance.map((c) => h('li', {}, `${c.done ? '✓' : '○'} ${c.text}`))) : null,
    ...last.map((c) => h('div', { class: 'closed-comment' }, h('div', { class: 'closed-comment-who' }, `${c.author.name} · ${new Date(c.t).toLocaleDateString('pt-BR')}`), renderMarkdown(c.text))),
  )
}

export function filterSelect(all: string, options: { value: string; label: string }[]): HTMLSelectElement {
  return h('select', { class: 'input board-filter' }, h('option', { value: '' }, all), ...options.map((o) => h('option', { value: o.value }, o.label)))
}

export function select<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = h('select', { class: 'input' }, ...options.map((o) => h('option', { value: o.value }, o.label)))
  s.value = value
  s.addEventListener('change', () => onChange(s.value as T))
  return s
}

export function beforeCard(list: HTMLElement, y: number): HTMLElement | undefined {
  for (const c of list.querySelectorAll<HTMLElement>('.tcard:not(.dragging)')) {
    const r = c.getBoundingClientRect()
    if (y < r.top + r.height / 2) return c
  }
  return undefined
}

export function clearDropMarks(root: HTMLElement): void {
  root.querySelectorAll('.drop-before, .drop-end').forEach((n) => n.classList.remove('drop-before', 'drop-end'))
}

export function isBusy(a: AgentSummary): boolean {
  return a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function overdue(t: Ticket): boolean {
  return !!t.dueDate && t.status !== 'done' && t.dueDate < new Date().toISOString().slice(0, 10)
}
