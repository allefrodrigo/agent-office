import type { AgentSummary } from '@shared/types'
import type { State } from '../state'
import { h } from './dom'
import { STATUS_LABEL } from './hud'
import { confirmDialog, modal } from './modals'
import { portrait } from './portrait'

/** Last two folders of a path: "…/acme/api". */
const shortCwd = (cwd: string) => `…/${cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/')}`

/**
 * The skull's list: every agent with its status. Picking one asks for confirmation;
 * on yes the list closes and `onDismiss` runs. Cancelling changes nothing.
 */
export function openSkull(root: HTMLElement, state: State, onDismiss: (agentId: string) => void): void {
  const close = () => el.remove()

  const pick = async (a: AgentSummary) => {
    const terminal = a.source === 'terminal'
    const busy = a.status === 'working' || a.status === 'starting'
    const yes = await confirmDialog(root, {
      title: `Dispensar ${a.name}?`,
      text: terminal
        ? `A sessão para e o agente sai do escritório. O Claude Code rodando no terminal em ${shortCwd(a.cwd)} vai ser encerrado, como se você fechasse aquela aba.\nA conversa fica salva: dá para voltar com claude --resume.`
        : 'A sessão para e o agente sai do escritório.',
      warn: busy ? `${a.name} está trabalhando agora. O que estiver em andamento se perde.` : undefined,
      confirm: 'Dispensar',
      cancel: 'Cancelar',
      danger: true,
    })
    if (!yes) return
    close()
    // it may have left while the question was open
    if (state.agents.has(a.id)) onDismiss(a.id)
  }

  const row = (a: AgentSummary): HTMLElement =>
    h(
      'button',
      { class: `roster-row skull-row status-${a.status}`, onclick: () => void pick(a) },
      portrait(a.look, 34),
      h(
        'div',
        { class: 'roster-main' },
        h(
          'div',
          { class: 'roster-name' },
          h('span', { class: `dot dot-${a.status}` }),
          h('span', { class: 'name' }, a.name),
          a.source === 'terminal' ? h('span', { class: 'chip chip-term' }, 'terminal') : null,
        ),
        h('div', { class: 'roster-activity' }, `${STATUS_LABEL[a.status]} · ${a.activity}`),
      ),
    )

  const agents = [...state.agents.values()].sort((a, b) => a.desk - b.desk)
  const list = h('div', { class: 'skull-list' }, ...(agents.length ? agents.map(row) : [h('div', { class: 'resume-empty' }, 'Nenhum agente no escritório.')]))
  const closeBtn = h('button', { class: 'btn', onclick: close }, 'Fechar')
  const el = modal(
    'Dispensar um agente',
    [h('div', { class: 'field-hint' }, 'Escolha quem vai embora. A caveira vai até ele, onde estiver, e a sessão é encerrada.'), list],
    [closeBtn],
    close,
  )
  el.classList.add('backdrop-skull')
  root.append(el)
  // so Esc closes the list
  closeBtn.focus()
}
