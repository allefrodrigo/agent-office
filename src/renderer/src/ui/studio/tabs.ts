import { FLOW_TEMPLATES } from '@shared/creative'
import { FLOW_NAME_MAX, MAX_FLOWS, type FlowTab } from '@shared/creative-library'
import { h, icon } from '../dom'

// The studio's tab bar: one tab per flow of the floor, in a single row that scrolls sideways
// when it overflows (the + stays put). Click switches, double-click renames, the chevron on the
// open tab (or a right-click on any tab) duplicates or deletes, + starts a new flow.

export interface TabActions {
  switch(id: string): void
  create(templateId: string | null): void
  rename(id: string, name: string): void
  duplicate(id: string): void
  remove(id: string): void
  /** A flow of the tab is running (dot on the tab). */
  busy(id: string): boolean
}

export function tabBar(actions: TabActions): { el: HTMLElement; render(tabs: FlowTab[], current: string): void } {
  const strip = h('div', { class: 'st-tabs-strip', role: 'tablist', 'aria-label': 'Fluxos do andar' })
  const el = h('div', { class: 'st-tabs' }, strip)
  let menu: HTMLElement | null = null
  const closeMenu = () => {
    menu?.remove()
    menu = null
  }
  const openMenu = (anchor: HTMLElement, items: [string, string, () => void, boolean?][]) => {
    closeMenu()
    menu = h(
      'div',
      { class: 'st-menu', role: 'menu' },
      ...items.map(([label, hint, run, danger]) =>
        h(
          'button',
          {
            class: `st-menu-item${danger ? ' danger' : ''}`,
            role: 'menuitem',
            onclick: () => {
              closeMenu()
              run()
            },
          },
          h('b', {}, label),
          hint ? h('small', {}, hint) : null,
        ),
      ),
    )
    const r = anchor.getBoundingClientRect()
    const host = el.closest('.st-box') ?? document.body
    const hr = host.getBoundingClientRect()
    menu.style.left = `${Math.min(r.left - hr.left, hr.width - 280)}px`
    menu.style.top = `${r.bottom - hr.top + 4}px`
    host.append(menu)
    setTimeout(() => document.addEventListener('pointerdown', (e) => (menu && !menu.contains(e.target as Node) ? closeMenu() : undefined), { once: true }))
  }

  // Fade the edge that hides more tabs; the wheel scrolls the row sideways.
  const fade = () => {
    const max = strip.scrollWidth - strip.clientWidth
    strip.classList.toggle('fade-l', strip.scrollLeft > 1)
    strip.classList.toggle('fade-r', strip.scrollLeft < max - 1)
  }
  strip.addEventListener('scroll', fade, { passive: true })
  new ResizeObserver(fade).observe(strip)
  strip.addEventListener(
    'wheel',
    (e) => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      strip.scrollLeft += e.deltaY
    },
    { passive: false },
  )
  const reveal = (tab: HTMLElement) => {
    const pad = 24
    if (tab.offsetLeft < strip.scrollLeft + pad) strip.scrollLeft = tab.offsetLeft - pad
    else if (tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth - pad) strip.scrollLeft = tab.offsetLeft + tab.offsetWidth - strip.clientWidth + pad
  }

  const render = (tabs: FlowTab[], current: string) => {
    const hadFocus = strip.contains(document.activeElement)
    const items = tabs.map((t) => {
      const on = t.id === current
      const label = h('span', { class: 'st-tab-name' }, t.name)
      const more = on ? h('button', { class: 'st-tab-more', title: 'Renomear, duplicar ou apagar', 'aria-label': `Opções de ${t.name}`, 'aria-haspopup': 'menu', tabindex: -1 }, icon('chevron', 12)) : null
      const tab = h(
        'div',
        { class: `st-tab${on ? ' on' : ''}`, role: 'tab', 'aria-selected': String(on), tabindex: on ? 0 : -1, title: on ? `${t.name} · duplo clique renomeia` : `Abrir ${t.name}` },
        actions.busy(t.id) ? h('span', { class: 'st-tab-dot', title: 'Rodando' }) : null,
        label,
        more,
      )
      const startRename = () => {
        const input = h('input', { class: 'st-tab-input', value: t.name, maxlength: FLOW_NAME_MAX, 'aria-label': 'Nome do fluxo' })
        label.replaceWith(input)
        input.focus()
        input.select()
        let done = false
        const finish = (save: boolean) => {
          if (done) return
          done = true
          const v = input.value.trim()
          if (save && v && v !== t.name) actions.rename(t.id, v)
          else input.replaceWith(label)
        }
        input.addEventListener('keydown', (e) => {
          e.stopPropagation()
          if (e.key === 'Enter') finish(true)
          if (e.key === 'Escape') finish(false)
        })
        input.addEventListener('blur', () => finish(true))
      }
      const options = (anchor: HTMLElement) =>
        openMenu(anchor, [
          ['Renomear', '', startRename],
          ['Duplicar', 'Copia nós, ligações e resultados', () => actions.duplicate(t.id)],
          ['Apagar', tabs.length > 1 ? 'O arquivo vai para a lixeira do andar' : 'Fica um fluxo em branco no lugar', () => actions.remove(t.id), true],
        ])
      tab.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.st-tab-more, input')) return
        if (!on) actions.switch(t.id)
      })
      tab.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !on) {
          e.preventDefault()
          actions.switch(t.id)
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          const next = (e.key === 'ArrowRight' ? tab.nextElementSibling : tab.previousElementSibling) as HTMLElement | null
          next?.focus()
          if (next) reveal(next)
        } else if (e.key === 'F2') startRename()
      })
      tab.addEventListener('dblclick', (e) => {
        if (on && !(e.target as HTMLElement).closest('.st-tab-more')) startRename()
      })
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        options(tab)
      })
      more?.addEventListener('click', (e) => {
        e.stopPropagation()
        options(tab)
      })
      return tab
    })
    const full = tabs.length >= MAX_FLOWS
    const add = h('button', { class: 'st-tab-add', title: full ? `No máximo ${MAX_FLOWS} fluxos por andar` : 'Novo fluxo', 'aria-label': 'Novo fluxo', 'aria-haspopup': 'menu', disabled: full }, icon('plus', 16))
    add.addEventListener('click', () =>
      openMenu(add, [
        ['Em branco', 'Monte do zero', () => actions.create(null)],
        ...FLOW_TEMPLATES.filter((t) => t.id !== 'blank').map((t): [string, string, () => void] => [t.title, t.hint, () => actions.create(t.id)]),
      ]),
    )
    const active = items.find((t) => t.classList.contains('on'))
    strip.replaceChildren(...items)
    el.querySelector('.st-tab-add')?.remove()
    el.append(add)
    requestAnimationFrame(() => {
      if (active) reveal(active)
      fade()
    })
    if (hadFocus) active?.focus({ preventScroll: true })
  }
  return { el, render }
}
