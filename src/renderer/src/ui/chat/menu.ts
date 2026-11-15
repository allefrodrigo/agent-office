import { h, icon } from '../dom'

// Um menu pequeno que abre num botão ou no ponto do clique direito: o ⋯ do cabeçalho e o menu de
// contexto da lateral. Setas andam, Enter escolhe, Esc e clique fora fecham, o foco volta.

export interface MenuItem {
  label: string
  icon?: string
  /** Shown on the right, dim: "Em breve". */
  hint?: string
  danger?: boolean
  disabled?: boolean
  run?: () => void
}

let openMenu: { close(): void } | null = null

/** Closes the menu on screen, if any. True when there was one. */
export function closeMenu(): boolean {
  if (!openMenu) return false
  openMenu.close()
  return true
}

export function showMenu(host: HTMLElement, at: HTMLElement | { x: number; y: number }, items: (MenuItem | 'sep')[], label: string): void {
  closeMenu()
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const buttons: HTMLButtonElement[] = []
  const el = h(
    'div',
    { class: 'ch-menu', role: 'menu', 'aria-label': label },
    items.map((it) => {
      if (it === 'sep') return h('div', { class: 'ch-menu-sep', role: 'separator' })
      const b = h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          class: `ch-menu-item${it.danger ? ' danger' : ''}`,
          disabled: it.disabled,
          'aria-disabled': it.disabled ? 'true' : undefined,
          tabindex: -1,
          onclick: () => {
            close()
            it.run?.()
          },
        },
        it.icon ? icon(it.icon, 15) : h('span', { class: 'ch-menu-gap' }),
        h('span', { class: 'ch-menu-label' }, it.label),
        it.hint ? h('span', { class: 'ch-menu-hint' }, it.hint) : null,
      )
      if (!it.disabled) buttons.push(b)
      return b
    }),
  )
  host.append(el)
  // place it: under the button, or at the click, kept inside the window
  const box = el.getBoundingClientRect()
  let x: number
  let y: number
  if (at instanceof HTMLElement) {
    const r = at.getBoundingClientRect()
    x = r.right - box.width
    y = r.bottom + 6
    if (y + box.height > innerHeight - 8) y = r.top - box.height - 6
  } else {
    x = at.x
    y = at.y
    if (y + box.height > innerHeight - 8) y = at.y - box.height
  }
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - box.width - 8))}px`
  el.style.top = `${Math.max(8, y)}px`

  const onDown = (e: PointerEvent) => {
    if (!el.contains(e.target as Node)) close()
  }
  function close(): void {
    if (!el.isConnected) return
    el.remove()
    document.removeEventListener('pointerdown', onDown, true)
    if (openMenu === self) openMenu = null
    if (back?.isConnected) back.focus({ preventScroll: true })
  }
  const self = { close }
  openMenu = self
  document.addEventListener('pointerdown', onDown, true)
  el.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = buttons.length
      buttons[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      buttons[e.key === 'Home' ? 0 : buttons.length - 1]?.focus()
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  })
  buttons[0]?.focus()
}
