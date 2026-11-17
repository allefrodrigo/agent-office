import { formatAmount, parseMoney } from '@shared/crm'
import { customerTitle } from '@shared/crm-view'
import type { Customer } from '@shared/types'
import { idOf } from '../a11y'
import { h } from '../dom'
import { modal } from '../modals'
import type { State } from '../../state'

// Campos dos formulários do CRM: rótulo, controle e o erro embaixo dele (o do main também cai
// no campo certo). As janelas usam o modal do app, abertas sobre a tela do CRM.

export interface Field {
  el: HTMLElement
  /** Shows (or clears) the error under the control, and marks it aria-invalid. */
  error(text: string | null): void
}

export function field(label: string, control: HTMLElement, hint?: string): Field {
  const err = h('span', { class: 'crm-field-error', role: 'alert', hidden: true })
  const hintEl = hint ? h('span', { class: 'field-hint' }, hint) : null
  const described = [hintEl ? idOf(hintEl) : '', idOf(err)].filter(Boolean).join(' ')
  control.setAttribute('aria-describedby', described)
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hintEl, err)
  return {
    el,
    error(text) {
      err.hidden = !text
      err.textContent = text ?? ''
      if (text) control.setAttribute('aria-invalid', 'true')
      else control.removeAttribute('aria-invalid')
    },
  }
}

export function textInput(value = '', attrs: Record<string, string | number | undefined> = {}): HTMLInputElement {
  const el = h('input', { class: 'input', ...attrs }) as HTMLInputElement
  el.value = value
  return el
}

export function selectInput(options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const el = h('select', { class: 'input' }, ...options.map((o) => h('option', { value: o.value }, o.label)))
  el.value = value
  return el
}

/** Money as typed in Brazil ("1.250,00", "480"); on leaving the field it shows the formatted value. */
export function moneyInput(cents?: number): { el: HTMLInputElement; cents(): number | null } {
  const el = textInput(cents ? formatAmount(cents) : '', { inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off' })
  el.addEventListener('blur', () => {
    const c = parseMoney(el.value)
    if (c !== null && c > 0) el.value = formatAmount(c)
  })
  return { el, cents: () => (el.value.trim() ? parseMoney(el.value) : null) }
}

/** Every customer, by name, for the deal and payment forms. */
export function customerSelect(customers: readonly Customer[], value: string, empty = 'Escolha o cliente'): HTMLSelectElement {
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })
  const sorted = [...customers].sort((a, b) => collator.compare(a.name, b.name))
  const el = h(
    'select',
    { class: 'input' },
    h('option', { value: '' }, empty),
    ...sorted.map((c) => h('option', { value: c.id }, customerTitle(c))),
  )
  el.value = value
  return el
}

/** "Nenhum" and the project floors. */
export function floorSelect(state: State, value: string | undefined): HTMLSelectElement {
  return selectInput(
    [{ value: '', label: 'Nenhum andar' }, ...state.settings.projects.map((p) => ({ value: p.id, label: p.name }))],
    value ?? '',
  )
}

/** The form-level error (what has no field), above the buttons. */
export function formError(): { el: HTMLElement; set(text: string | null): void } {
  const el = h('p', { class: 'crm-form-error', role: 'alert', hidden: true })
  return {
    el,
    set(text) {
      el.hidden = !text
      el.textContent = text ?? ''
    },
  }
}

/** A window over the CRM screen, wider than the app's default. */
export function crmModal(
  root: HTMLElement,
  title: string,
  body: HTMLElement[],
  footer: HTMLElement[],
  onClose: () => void,
  wide = false,
): HTMLDivElement {
  const el = modal(title, body, footer, onClose)
  // Enter in a one-line field confirms, like a form: the keyboard reaches "Salvar" without Tab
  el.addEventListener('keydown', (e) => {
    const t = e.target
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.isComposing) return
    if (!(t instanceof HTMLInputElement) || ['checkbox', 'radio', 'button', 'submit'].includes(t.type)) return
    const primary = el.querySelector<HTMLButtonElement>('.modal-foot .btn-primary:not([disabled])')
    if (!primary) return
    e.preventDefault()
    t.dispatchEvent(new Event('blur'))
    primary.click()
  })
  el.classList.add('backdrop-crm-form')
  if (wide) el.classList.add('wide')
  root.append(el)
  return el
}

/** A button that waits for its promise: disabled meanwhile, so a double click saves once. */
export async function busy<T>(btn: HTMLButtonElement, run: () => Promise<T>): Promise<T | undefined> {
  if (btn.disabled) return undefined
  btn.disabled = true
  try {
    return await run()
  } finally {
    btn.disabled = false
  }
}
