import { h, icon } from '../dom'

// Floating widgets over the studio canvas. Each one does one job (fluxos, nós, execução, uso,
// integrações, navegação) and can shrink to a pill that still shows its state. Whether a widget
// is open or minimized is kept per widget in localStorage, for every floor.

export interface WidgetOpts {
  id: string
  title: string
  icon: string
  /** 'panel' has a title bar; 'bar' is a one-row toolbar with the minimize button at the end. */
  variant?: 'panel' | 'bar'
  /** Minimized when nothing was saved yet. */
  startMini?: boolean
  /** Extra buttons in the title bar of a panel, before minimize. */
  actions?: HTMLElement[]
  /** Replaces the default pill when minimized (e.g. the node rail). */
  mini?: HTMLElement
}

export interface Widget {
  el: HTMLElement
  body: HTMLElement
  readonly mini: boolean
  setMini(on: boolean): void
  /** Short state shown in the pill while minimized (and as the pill tooltip). */
  setSummary(text: string, tone?: 'ok' | 'warn' | 'bad' | 'busy' | ''): void
}

const KEY = (id: string) => `agent-office:studio-widget:${id}`

export function widget(o: WidgetOpts): Widget {
  const variant = o.variant ?? 'panel'
  const saved = localStorage.getItem(KEY(o.id))
  let mini = saved ? saved === 'mini' : !!o.startMini
  const summary = h('span', { class: 'st-w-sum' })
  const body = h('div', { class: 'st-w-body' })
  const minBtn = h('button', { class: 'icon-btn st-w-min', title: `Minimizar ${o.title}`, 'aria-label': `Minimizar ${o.title}`, 'aria-expanded': 'true' }, icon('compact', 14))
  const pill = h('button', { class: 'st-w-pill', title: `Abrir ${o.title}`, 'aria-label': `Abrir ${o.title}`, 'aria-expanded': 'false' }, icon(o.icon, 15), h('span', { class: 'st-w-pill-name' }, o.title), summary)
  const head =
    variant === 'panel'
      ? h('div', { class: 'st-w-head' }, h('span', { class: 'st-w-icon' }, icon(o.icon, 14)), h('b', { class: 'st-w-title' }, o.title), ...(o.actions ?? []), minBtn)
      : null
  const el = h('section', { class: `st-w st-w-${variant} st-w-${o.id}`, 'aria-label': o.title }, head, body, variant === 'bar' ? minBtn : null, o.mini ?? pill)
  if (o.mini) o.mini.classList.add('st-w-pill-custom')

  const apply = () => {
    el.classList.toggle('mini', mini)
    minBtn.setAttribute('aria-expanded', String(!mini))
  }
  const setMini = (on: boolean) => {
    if (on === mini) return
    mini = on
    localStorage.setItem(KEY(o.id), on ? 'mini' : 'open')
    apply()
    // focus follows the toggle so the keyboard never lands on a hidden button
    ;(on ? (o.mini?.querySelector('button') ?? pill) : minBtn).focus({ preventScroll: true })
  }
  minBtn.addEventListener('click', () => setMini(true))
  pill.addEventListener('click', () => setMini(false))
  apply()

  return {
    el,
    body,
    get mini() {
      return mini
    },
    setMini,
    setSummary(text, tone = '') {
      summary.textContent = text
      summary.className = `st-w-sum${tone ? ` ${tone}` : ''}`
      pill.title = `Abrir ${o.title}${text ? ` · ${text}` : ''}`
    },
  }
}
