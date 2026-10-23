import { FLOW_TEMPLATES } from '@shared/creative'
import { FLOW_NAME_MAX, MAX_FLOWS, type FlowTab } from '@shared/creative-library'
import { h, icon } from '../dom'

// The studio's tab bar: one tab per flow of the floor. Click switches, double-click renames,
// the ⋯ menu duplicates or deletes, + starts a new flow (blank or from a template).

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
  const el = h('div', { class: 'st-tabs', role: 'tablist', 'aria-label': 'Fluxos do andar' })
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

  const render = (tabs: FlowTab[], current: string) => {
    const items = tabs.map((t) => {
      const on = t.id === current
      const label = h('span', { class: 'st-tab-name' }, t.name)
      const more = h('button', { class: 'st-tab-more', title: 'Mais', 'aria-label': `Opções de ${t.name}` }, '⋯')
      const tab = h(
        'div',
        { class: `st-tab${on ? ' on' : ''}`, role: 'tab', 'aria-selected': String(on), tabindex: on ? 0 : -1, title: 'Clique para abrir · duplo clique renomeia' },
        actions.busy(t.id) ? h('span', { class: 'st-tab-dot', title: 'Rodando' }) : null,
        label,
        more,
      )
      tab.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.st-tab-more, input')) return
        if (!on) actions.switch(t.id)
      })
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !on) actions.switch(t.id)
      })
      const startRename = () => {
        const input = h('input', { class: 'st-tab-input', value: t.name, maxlength: FLOW_NAME_MAX })
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
      tab.addEventListener('dblclick', (e) => {
        if (!(e.target as HTMLElement).closest('.st-tab-more')) startRename()
      })
      more.addEventListener('click', (e) => {
        e.stopPropagation()
        openMenu(more, [
          ['Renomear', '', startRename],
          ['Duplicar', 'Copia nós, ligações e resultados', () => actions.duplicate(t.id)],
          ['Apagar', tabs.length > 1 ? 'O arquivo vai para a lixeira do andar' : 'Fica um fluxo em branco no lugar', () => actions.remove(t.id), true],
        ])
      })
      return tab
    })
    const add = h('button', { class: 'st-tab-add', title: tabs.length >= MAX_FLOWS ? `No máximo ${MAX_FLOWS} fluxos por andar` : 'Novo fluxo', 'aria-label': 'Novo fluxo', disabled: tabs.length >= MAX_FLOWS }, icon('plus', 14))
    add.addEventListener('click', () =>
      openMenu(add, [
        ['Em branco', 'Monte do zero', () => actions.create(null)],
        ...FLOW_TEMPLATES.filter((t) => t.id !== 'blank').map((t): [string, string, () => void] => [t.title, t.hint, () => actions.create(t.id)]),
      ]),
    )
    el.replaceChildren(...items, add)
  }
  return { el, render }
}
