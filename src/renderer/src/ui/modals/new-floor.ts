import { creativeReady } from '@shared/creative'
import { canAddFloor, floorNameFor } from '@shared/projects'
import type { ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { integrationsView, readStatus } from '../studio/integrations'
import { cleanError, field, modal } from './common'

// "Novo andar": a project folder becomes a floor. With Codex signed in, every floor has its
// Estúdio criativo too (in <pasta>/social-media); no separate creative floor anymore.

/** Resolves the floor as saved, or null if the player gave up. */
export function openNewFloor(root: HTMLElement, state: State, toast: (t: string, k?: 'info' | 'ok' | 'err') => void): Promise<ProjectFloor | null> {
  return new Promise((resolve) => {
    let cwd = ''
    let named = false
    const label = h('span', { class: 'path-label' }, 'Nenhuma pasta escolhida')
    const pick = h('button', { class: 'btn', type: 'button' }, icon('folder', 15), 'Escolher…')
    const name = h('input', { class: 'input', maxlength: 32, placeholder: 'Ex.: Apetit Studios' })
    name.addEventListener('input', () => (named = !!name.value.trim()))
    const hint = h('span', {})
    const choose = async (p: string) => {
      cwd = p
      label.textContent = p
      if (!named) name.value = floorNameFor(p)
      const taken = state.settings.projects.find((x) => x.cwd === p)
      if (taken) {
        hint.textContent = `Essa pasta já é o andar ${taken.name}.`
        hint.className = 'warn'
        return
      }
      const found = await window.office.listSquads(p)
      if (cwd !== p) return
      hint.className = ''
      hint.textContent = found.length
        ? `${found.length === 1 ? '1 squad' : `${found.length} squads`} para contratar na Diretoria: ${found.map((q) => `${q.icon} ${q.name}`).join(' · ')}`
        : 'Sem squads (squads/<code>/squad.yaml). O andar funciona igual: só não tem orquestrador para contratar.'
    }
    pick.addEventListener('click', async () => {
      const p = await window.office.pickFolder(cwd || undefined)
      if (p) await choose(p)
    })

    let done = false
    const finish = (v: ProjectFloor | null) => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }
    const go = h('button', { class: 'btn btn-primary' }, icon('plus', 15), 'Criar andar')
    if (!canAddFloor(state.settings.projects)) {
      go.setAttribute('disabled', '')
      go.title = 'O prédio chegou ao máximo de andares. Tire um em Configurações.'
    }
    go.addEventListener('click', async () => {
      if (!cwd) return toast('Escolha a pasta do projeto.', 'err')
      if (state.settings.projects.some((x) => x.cwd === cwd)) return toast('Essa pasta já tem um andar.', 'err')
      go.setAttribute('disabled', '')
      try {
        const next: ProjectFloor = { id: `p-${Date.now().toString(36)}`, name: name.value.trim() || floorNameFor(cwd), cwd }
        const saved = await window.office.saveSettings({ projects: [...state.settings.projects, next] })
        const floor = saved.projects.find((x) => x.cwd === cwd)
        if (!floor) throw new Error('Não consegui criar o andar: a pasta não existe mais?')
        state.apply({ type: 'settings', settings: saved })
        finish(floor)
      } catch (err) {
        go.removeAttribute('disabled')
        toast(cleanError(err), 'err')
      }
    })

    // The studio comes with the floor once Codex is signed in; connecting it is optional here.
    const studioNote = h('span', { class: 'field-hint' })
    const codex = h('details', { class: 'floor-studio' }, h('summary', {}, '🎨 Estúdio criativo'), studioNote)
    const syncStudio = (ready: boolean) => {
      studioNote.textContent = ready
        ? 'Pronto: o andar já vem com a sala do estúdio criativo. Ele salva fluxos, referências e imagens em <pasta>/social-media.'
        : 'Conecte o ChatGPT (Codex) e todo andar ganha a sala do estúdio criativo, que salva em <pasta>/social-media. Sem o Codex a sala não aparece.'
    }
    let shownView = false
    codex.addEventListener('toggle', () => {
      if (!codex.open || shownView) return
      shownView = true
      codex.append(integrationsView({ toast, compact: true, onChange: (st) => syncStudio(creativeReady(st)) }))
    })
    syncStudio(false)
    void readStatus()
      .then((st) => syncStudio(creativeReady(st)))
      .catch(() => undefined)

    const el = modal(
      'Novo andar',
      [
        h('div', { class: 'field-hint' }, 'Todo agente que você contratar ou chamar nesse andar trabalha na pasta do projeto, sem escolher pasta. Agentes de tickets, do resume ou do terminal nessa pasta também sobem para lá.'),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Pasta do projeto'), h('div', { class: 'path-row' }, label, pick), hint),
        field('Nome do andar', name),
        codex,
      ],
      [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'), go],
      () => finish(null),
    )
    root.append(el)
    pick.focus()
  })
}
