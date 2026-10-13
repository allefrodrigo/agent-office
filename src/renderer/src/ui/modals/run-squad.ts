import type { AgentSummary, OfficePermissionMode, ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { h } from '../dom'
import { cleanError, field, modal } from './common'
import { MODES } from './brain'

// "Contratar squad": start a squad cycle on a project floor.

const RUN_MODES = MODES.filter((m) => m.value !== 'bypassPermissions')
const LAST_RUN_MODE = 'agent-office:squad-mode'

/**
 * "Contratar squad": pick a squad of the project and an orchestrator comes up to the
 * Diretoria with the whole team to run its pipeline. Hiring it again for the same
 * squad just starts another cycle. Squad cycles never run with "Sem pedir nada".
 */
export function openRunSquad(root: HTMLElement, state: State, project: ProjectFloor, toast: (t: string, k?: 'info' | 'ok' | 'err') => void, onStarted: (a: AgentSummary) => void): void {
  const squads = state.squads.filter((q) => q.cwd === project.cwd)
  if (!squads.length) return toast(`${project.name} não tem squads: nenhum squads/<code>/squad.yaml na pasta do projeto.`, 'err')
  const here = new Map([...state.agents.values()].filter((a) => a.role === 'orchestrator' && a.cwd === project.cwd).map((a) => [a.squad, a]))
  const busy = (a: AgentSummary | undefined) => !!a && a.status !== 'idle' && a.status !== 'done' && a.status !== 'error'
  let chosen = squads[0]
  const cards = squads.map((q) => {
    const boss = here.get(q.code)
    const inline = q.members.filter((m) => m.execution === 'inline').length
    const card = h(
      'button',
      { class: 'squad-card', type: 'button' },
      h('span', { class: 'squad-icon' }, q.icon),
      h(
        'span',
        { class: 'squad-main' },
        h('span', { class: 'squad-name' }, q.name, boss ? h('span', { class: `chip ${busy(boss) ? 'chip-wait' : ''}` }, busy(boss) ? 'rodando' : 'na Diretoria') : null),
        h('span', { class: 'squad-meta' }, `${q.members.length} membros${inline ? ` (${inline} inline)` : ''} · ${q.steps.length} passos · ${q.steps.filter((x) => x.type === 'checkpoint').length} checkpoints`),
        q.description ? h('span', { class: 'squad-desc' }, q.description) : null,
      ),
    )
    card.addEventListener('click', () => {
      chosen = q
      paint()
    })
    return card
  })

  const mode = h('select', { class: 'input' }, ...RUN_MODES.map((m) => h('option', { value: m.value }, m.label)))
  const saved = localStorage.getItem(LAST_RUN_MODE)
  mode.value = RUN_MODES.some((m) => m.value === saved) ? saved! : RUN_MODES.some((m) => m.value === state.settings.defaultPermissionMode) ? state.settings.defaultPermissionMode : 'default'
  const modeHint = h('span', {})
  const syncHint = () => (modeHint.textContent = RUN_MODES.find((x) => x.value === mode.value)!.hint)
  mode.addEventListener('change', syncHint)
  syncHint()
  const note = h('textarea', { class: 'input', rows: 2, placeholder: 'Recado para o orquestrador (opcional)' })

  const close = () => el.remove()
  const go = h('button', { class: 'btn btn-primary' })
  const paint = () => {
    cards.forEach((c, i) => c.classList.toggle('on', squads[i] === chosen))
    go.textContent = here.has(chosen.code) ? '▶ Rodar ciclo' : '▶ Contratar e rodar ciclo'
  }
  paint()
  go.addEventListener('click', async () => {
    go.setAttribute('disabled', '')
    try {
      localStorage.setItem(LAST_RUN_MODE, mode.value)
      const a = await window.office.runSquad(chosen.cwd, chosen.code, mode.value as OfficePermissionMode, note.value)
      close()
      toast(`${a.name} subiu para a Diretoria com o squad e começou o ciclo.`, 'ok')
      onStarted(a)
    } catch (err) {
      go.removeAttribute('disabled')
      toast(cleanError(err), 'err')
    }
  })
  const el = modal(
    `Contratar squad · ${project.name}`,
    [
      h('div', { class: 'squad-list' }, ...cards),
      field('Permissões', mode, modeHint),
      field('Recado', note, 'Os checkpoints do ciclo vêm até você como perguntas. Sem resposta, o ciclo espera.'),
    ],
    [h('button', { class: 'btn', onclick: close }, 'Cancelar'), go],
    close,
  )
  root.append(el)
  go.focus()
}
