import { modalA11y } from '../a11y'
import { h, icon } from '../dom'

// The window frame every modal uses, form fields and the yes/no dialog.

export const LAST_CWD = 'agent-office:last-cwd'

/** Every window of the app. It is a labelled dialog that holds the focus and gives it back on close (see ../a11y.ts). */
export function modal(title: string, body: HTMLElement[], footer: HTMLElement[], onClose: () => void): HTMLDivElement {
  const heading = h('div', { class: 'modal-title' }, title)
  const box = h(
    'div',
    { class: 'modal card' },
    h('div', { class: 'modal-head' }, heading, h('button', { class: 'icon-btn', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: onClose }, icon('x', 18))),
    h('div', { class: 'modal-body' }, ...body),
    h('div', { class: 'modal-foot' }, ...footer),
  )
  const backdrop = h('div', { class: 'backdrop' }, box)
  modalA11y(backdrop, box, heading)
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) onClose()
  })
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose()
    e.stopPropagation()
  })
  return backdrop
}

export function field(label: string, control: HTMLElement, hint?: HTMLElement | string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null)
}

/** Styled yes/no dialog. Resolves true on confirm, false on cancel/Esc/backdrop, or when `signal` aborts. */
export function confirmDialog(
  root: HTMLElement,
  opts: { title: string; text: string; confirm: string; cancel: string; danger?: boolean; warn?: string; signal?: AbortSignal },
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }
    const ok = h('button', { class: opts.danger ? 'btn btn-danger-solid' : 'btn btn-primary', onclick: () => finish(true) }, opts.confirm)
    const body = [h('div', { class: 'confirm-text' }, opts.text)]
    if (opts.warn) body.unshift(h('div', { class: 'confirm-warn' }, icon('alert', 16), h('span', {}, opts.warn)))
    const el = modal(opts.title, body, [h('button', { class: 'btn', onclick: () => finish(false) }, opts.cancel), ok], () => finish(false))
    el.classList.add('backdrop-confirm')
    root.append(el)
    ok.focus()
    opts.signal?.addEventListener('abort', () => finish(false), { once: true })
  })
}

export function cleanError(err: unknown): string {
  return err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
}
