import './a11y.css'

/**
 * Acessibilidade (AO-38): diálogos com role, rótulo e foco preso; foco que volta para
 * quem abriu; setas em listas; e as regiões aria-live que os leitores de tela anunciam.
 */

/** What Tab reaches. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

/** Tab stops inside `root` that are on screen, in document order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
}

/** A text field has the focus: letters and Enter belong to it. */
export function isTyping(el: Element | null = document.activeElement): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable)
}

let nextId = 0
/** The element's id, giving it one if it has none. */
export function idOf(el: HTMLElement): string {
  if (!el.id) el.id = `a11y-${++nextId}`
  return el.id
}

/** Tab and ⇧Tab go round inside `el` instead of leaving it. */
export function trapTab(el: HTMLElement): void {
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented) return
    const list = focusables(el)
    const a = document.activeElement
    if (!list.length) {
      e.preventDefault()
      el.focus()
      return
    }
    const first = list[0]
    const last = list[list.length - 1]
    if (e.shiftKey && (a === first || a === el || !el.contains(a))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (a === last || !el.contains(a))) {
      e.preventDefault()
      first.focus()
    }
  })
}

/**
 * Marks `el` as a dialog labelled by `title` (and described by `description`), focusable
 * as a whole and with Tab kept inside. `modal` false for cards that leave the rest usable.
 */
export function asDialog(el: HTMLElement, opts: { title?: HTMLElement | HTMLElement[]; description?: HTMLElement; modal?: boolean; label?: string } = {}): void {
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', String(opts.modal ?? true))
  el.tabIndex = -1
  labelDialog(el, opts)
  if (!el.dataset.trap) {
    el.dataset.trap = '1'
    trapTab(el)
  }
}

/** Points the dialog's aria-labelledby/-describedby at its current title and text. */
export function labelDialog(el: HTMLElement, opts: { title?: HTMLElement | HTMLElement[]; description?: HTMLElement; label?: string }): void {
  const titles = opts.title ? (Array.isArray(opts.title) ? opts.title : [opts.title]) : []
  if (titles.length) el.setAttribute('aria-labelledby', titles.map(idOf).join(' '))
  else el.removeAttribute('aria-labelledby')
  if (opts.label) el.setAttribute('aria-label', opts.label)
  if (opts.description) el.setAttribute('aria-describedby', idOf(opts.description))
  else el.removeAttribute('aria-describedby')
}

/** Remembers who had the focus before a dialog took it, and gives it back. */
export class FocusReturn {
  private back: HTMLElement | null = null

  /** Call when the dialog opens. Focus already inside `el` is not remembered. */
  save(el: HTMLElement): void {
    const a = document.activeElement
    if (a instanceof HTMLElement && a !== document.body && !el.contains(a)) this.back = a
  }

  /** Call when it closes: focus goes back if it was inside `el` (or got lost) and the old element is still there. */
  restore(el: HTMLElement): void {
    const back = this.back
    this.back = null
    const a = document.activeElement
    if (!back || !back.isConnected || back.getClientRects().length === 0) return
    if (a && a !== document.body && !el.contains(a)) return
    back.focus({ preventScroll: true })
  }
}

// ---------- modals that are created, appended and removed ----------

const watched = new Map<HTMLElement, { seen: boolean; onShown: () => void; onGone: () => void }>()
let observer: MutationObserver | null = null

function checkWatched(): void {
  for (const [el, w] of watched) {
    if (el.isConnected && !w.seen) {
      w.seen = true
      w.onShown()
    } else if (!el.isConnected && w.seen) {
      watched.delete(el)
      w.onGone()
    }
  }
  if (!watched.size && observer) {
    observer.disconnect()
    observer = null
  }
}

/**
 * A modal from modals.ts: `box` becomes the dialog. When the backdrop goes on screen the
 * focus moves into the box (unless the caller already focused something there); when it
 * leaves, the focus returns to whoever had it before.
 */
export function modalA11y(backdrop: HTMLElement, box: HTMLElement, title: HTMLElement): void {
  asDialog(box, { title })
  const focus = new FocusReturn()
  focus.save(box)
  watched.set(backdrop, {
    seen: false,
    // Runs after the caller's own .focus() calls, which happen right after append.
    onShown: () => {
      if (!box.contains(document.activeElement)) box.focus({ preventScroll: true })
    },
    onGone: () => focus.restore(box),
  })
  if (!observer) {
    observer = new MutationObserver(checkWatched)
    observer.observe(document.body, { childList: true, subtree: true })
  }
}

// ---------- lists ----------

/**
 * ↑/↓ (and Home/End) move the focus between the `items` of `list`; only the current one
 * is in the Tab order (roving tabindex), so Tab jumps over the list in one step.
 */
export function arrowList(list: HTMLElement, itemSelector: string): void {
  list.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.metaKey || e.ctrlKey) return
    const items = [...list.querySelectorAll<HTMLElement>(itemSelector)]
    const current = (e.target as HTMLElement).closest<HTMLElement>(itemSelector)
    const i = current ? items.indexOf(current) : -1
    if (i < 0) return
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    // The arrows would also walk the player around the office.
    e.preventDefault()
    e.stopPropagation()
    rove(items, next)
    items[next].focus()
  })
  list.addEventListener('focusin', (e) => {
    const items = [...list.querySelectorAll<HTMLElement>(itemSelector)]
    const i = items.indexOf(e.target as HTMLElement)
    if (i >= 0) rove(items, i)
  })
}

/** Only items[current] is reachable by Tab. */
export function rove(items: HTMLElement[], current: number): void {
  items.forEach((el, i) => (el.tabIndex = i === current ? 0 : -1))
}

/**
 * Redraws `container` with `draw` and puts the focus back on the element with the same
 * `data-focus-key`, so a re-render does not throw a keyboard user out of the list.
 */
export function keepFocus(container: HTMLElement, draw: () => void): void {
  const a = document.activeElement
  const key = a instanceof HTMLElement && container.contains(a) ? a.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey : undefined
  draw()
  if (key === undefined) return
  const again = container.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)
  if (again) again.focus({ preventScroll: true })
}

// ---------- screen reader announcements ----------

let live: { polite: HTMLElement; assertive: HTMLElement } | null = null

/**
 * The two live regions, empty and in the page from the start (a region created together
 * with its text is often not read). Called once at boot.
 */
export function mountLiveRegions(root: HTMLElement = document.body): void {
  if (live) return
  const region = (politeness: 'polite' | 'assertive') => {
    const el = document.createElement('div')
    el.className = 'sr-only'
    el.setAttribute('aria-live', politeness)
    el.setAttribute('aria-atomic', 'true')
    el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status')
    el.dataset.live = politeness
    root.append(el)
    return el
  }
  live = { polite: region('polite'), assertive: region('assertive') }
}

/** Says `text` through a live region: assertive interrupts, for things waiting on the player. */
export function announce(text: string, politeness: 'polite' | 'assertive' = 'polite'): void {
  if (!live) mountLiveRegions()
  const el = live![politeness]
  // Clear first, so the same sentence twice is read twice.
  el.textContent = ''
  setTimeout(() => (el.textContent = text), 60)
}
