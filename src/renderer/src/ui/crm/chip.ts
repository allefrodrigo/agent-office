import { h } from '../dom'

// Os chips da barra do CRM que abrem uma caixa embaixo deles: o servidor local da Evolution e o
// WhatsApp. Clique (ou Enter) abre e fecha; Esc e um clique fora fecham. A caixa nasce ao abrir e
// é descartada ao fechar, para não ficar ouvindo o main com o chip fechado.

export interface ChipBox {
  el: HTMLElement
  dispose(): void
}

export interface Chip {
  /** The anchor: the chip and its box. */
  el: HTMLElement
  btn: HTMLButtonElement
  dot: HTMLElement
  close(): void
  dispose(): void
}

export function chipPopover(o: { label: string; title: string; box(): ChipBox; wide?: boolean }): Chip {
  const dot = h('span', { class: 'dot dot-idle', 'aria-hidden': 'true' })
  const btn = h(
    'button',
    { class: 'crm-chip', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: o.title },
    dot,
    h('span', {}, o.label),
  ) as HTMLButtonElement
  const pop = h('div', { class: `crm-chip-pop${o.wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': o.title, hidden: true })
  const el = h('div', { class: 'crm-chip-anchor' }, btn, pop)
  let box: ChipBox | null = null

  function close(): void {
    pop.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    box?.dispose()
    box = null
    pop.replaceChildren()
  }

  btn.addEventListener('click', () => {
    if (!pop.hidden) return close()
    box = o.box()
    pop.replaceChildren(box.el)
    pop.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    pop.querySelector<HTMLElement>('button:not(.hidden), input')?.focus()
  })
  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    close()
    btn.focus()
  })
  // A click outside closes, but not one in a dialog the box opened ("Desconectar o WhatsApp?").
  const outside = (e: PointerEvent) => {
    const target = e.target as Element | null
    if (pop.hidden || el.contains(target) || target?.closest?.('.backdrop:not(.crm-backdrop)')) return
    close()
  }
  document.addEventListener('pointerdown', outside, true)

  return {
    el,
    btn,
    dot,
    close,
    dispose: () => {
      close()
      document.removeEventListener('pointerdown', outside, true)
    },
  }
}
