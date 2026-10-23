import type { CaffeineMode } from '@shared/types'
import './coffee-quit.css'
import type { State } from '../state'
import { h, icon } from './dom'
import { cleanError, modal } from './modals'

// The café corner (Copa): keep the screen from going dark while agents work, or always.

const OPTIONS: [CaffeineMode, string, string][] = [
  ['off', 'Desligada', 'A tela apaga e o computador dorme como sempre.'],
  [
    'agents',
    'Enquanto agentes trabalham',
    'A tela fica acordada só enquanto algum agente trabalha ou espera você. Quando todos param, volta ao normal.',
  ],
  ['on', 'Sempre ligada', 'A tela não apaga e o computador não dorme enquanto o Agent Office estiver aberto.'],
]

export function openCoffee(root: HTMLElement, state: State, toast: (text: string, kind?: 'info' | 'ok' | 'err') => void): void {
  if (root.querySelector('.backdrop-coffee')) return
  const list = h('div', { class: 'coffee-options', role: 'radiogroup', 'aria-label': 'Cafeteira' })
  const status = h('p', { class: 'coffee-status' })
  const render = () => {
    const mode = state.settings.caffeine ?? 'off'
    list.replaceChildren(
      ...OPTIONS.map(([k, label, text]) =>
        h(
          'button',
          {
            class: `coffee-option${mode === k ? ' on' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': String(mode === k),
            onclick: () => void choose(k),
          },
          h('span', { class: 'coffee-radio', 'aria-hidden': 'true' }),
          h('span', {}, h('b', {}, label), h('small', {}, text)),
        ),
      ),
    )
    status.className = `coffee-status${state.caffeineAwake ? ' awake' : ''}`
    status.textContent = state.caffeineAwake
      ? 'Agora: a tela está acordada.'
      : mode === 'agents'
        ? 'Agora: ninguém trabalhando, a tela pode apagar.'
        : 'Agora: a tela pode apagar.'
  }
  const choose = async (mode: CaffeineMode) => {
    try {
      await window.office.setCaffeine(mode)
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }
  const off = state.onChange(render)
  const close = () => {
    off()
    el.remove()
  }
  const el = modal(
    'Cantinho do café',
    [
      h(
        'p',
        { class: 'coffee-intro' },
        icon('coffee', 16),
        'A cafeteira mantém a tela acordada, como o caffeinate, no Mac e no Windows. Não precisa de terminal.',
      ),
      list,
      status,
    ],
    [h('button', { class: 'btn btn-primary', type: 'button', onclick: close }, 'Pronto')],
    close,
  )
  el.classList.add('backdrop-coffee')
  root.append(el)
  render()
  list.querySelector<HTMLElement>('.coffee-option.on')?.focus()
}
