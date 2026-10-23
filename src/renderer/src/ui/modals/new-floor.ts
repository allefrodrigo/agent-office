import { creativeReady } from '@shared/creative'
import { canAddFloor, floorNameFor } from '@shared/projects'
import type { ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { integrationsView, readStatus } from '../studio/integrations'
import { cleanError, field, modal } from './common'

// "Novo andar": a project folder becomes a floor, or a creative floor (Estúdio criativo, needs Codex).

/**
 * "Novo andar": a project folder becomes a floor. Resolves the floor as saved, or
 * null if the player gave up. A creative floor needs Codex signed in first.
 */
export function openNewFloor(root: HTMLElement, state: State, toast: (t: string, k?: 'info' | 'ok' | 'err') => void, start: 'project' | 'creative' = 'project'): Promise<ProjectFloor | null> {
  return new Promise((resolve) => {
    let cwd = ''
    let named = false
    let kind: 'project' | 'creative' = start
    let ready = false
    const label = h('span', { class: 'path-label' }, 'Nenhuma pasta escolhida')
    const pick = h('button', { class: 'btn', type: 'button' }, icon('folder', 15), 'Escolher…')
    const name = h('input', { class: 'input', maxlength: 32, placeholder: 'Ex.: Apetit Studios' })
    name.addEventListener('input', () => (named = !!name.value.trim()))
    const hint = h('span', {})
    const choose = async (p: string) => {
      cwd = p
      label.textContent = p
      if (!named) name.value = kind === 'creative' ? 'Estúdio Criativo' : floorNameFor(p)
      const taken = state.settings.projects.find((x) => x.cwd === p)
      if (taken) {
        hint.textContent = `Essa pasta já é o andar ${taken.name}.`
        hint.className = 'warn'
        return
      }
      if (kind === 'creative') {
        hint.className = ''
        hint.textContent = 'Imagens em criativos/imagens e análises em criativos/analises.'
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
    go.addEventListener('click', async () => {
      if (kind === 'creative' && !ready) return toast('Conecte o ChatGPT (Codex) antes de criar o andar criativo.', 'err')
      if (!cwd) return toast('Escolha a pasta do projeto.', 'err')
      if (state.settings.projects.some((x) => x.cwd === cwd)) return toast('Essa pasta já tem um andar.', 'err')
      go.setAttribute('disabled', '')
      try {
        const next: ProjectFloor =
          kind === 'creative'
            ? { id: `p-${Date.now().toString(36)}`, name: name.value.trim() || 'Estúdio Criativo', cwd, kind: 'creative', brandColor: '#9b7bf0', worktrees: false }
            : { id: `p-${Date.now().toString(36)}`, name: name.value.trim() || floorNameFor(cwd), cwd }
        const projects = [...state.settings.projects, next]
        const saved = await window.office.saveSettings({ projects })
        const floor = saved.projects.find((x) => x.cwd === cwd)
        if (!floor) throw new Error('Não consegui criar o andar: a pasta não existe mais?')
        state.apply({ type: 'settings', settings: saved })
        finish(floor)
      } catch (err) {
        go.removeAttribute('disabled')
        toast(cleanError(err), 'err')
      }
    })
    // ---------- kind: project or creative ----------
    const projectBtn = h('button', { class: 'floor-kind', type: 'button' }, h('b', {}, 'Projeto'), h('small', {}, 'Agentes trabalham na pasta de um projeto, com squads e worktrees.'))
    const creativeBtn = h('button', { class: 'floor-kind', type: 'button' }, h('b', {}, '🎨 Criativo'), h('small', {}, 'Estúdio de nós: analisa vídeos, gera imagens com ChatGPT e monta posts.'))
    const intro = h('div', { class: 'field-hint' })
    const codexBox = h('div', {})
    const useDefault = h('button', { class: 'btn btn-small', type: 'button' }, 'Usar Documentos/Agent Office/Criativo')
    useDefault.addEventListener('click', async () => choose(await window.office.creativeFolder()))
    const folderLabel = h('span', { class: 'field-label' })
    const setKind = (k: 'project' | 'creative') => {
      kind = k
      projectBtn.classList.toggle('on', k === 'project')
      creativeBtn.classList.toggle('on', k === 'creative')
      intro.textContent =
        k === 'creative'
          ? 'O andar criativo abre o Estúdio: um quadro de nós ligados (vídeo → análise → imagem → post). Ele usa o Codex logado na sua conta ChatGPT para gerar imagens e rodar os agentes.'
          : 'Todo agente que você contratar ou chamar nesse andar trabalha na pasta do projeto, sem escolher pasta. Agentes de tickets, do resume ou do terminal nessa pasta também sobem para lá.'
      folderLabel.textContent = k === 'creative' ? 'Pasta do estúdio' : 'Pasta do projeto'
      useDefault.hidden = k !== 'creative'
      codexBox.replaceChildren(...(k === 'creative' ? [integrationsView({ toast, compact: true, onChange: (st) => ((ready = creativeReady(st)), sync()) })] : []))
      if (k === 'creative' && !named) name.value = 'Estúdio Criativo'
      if (k === 'project' && !named) name.value = cwd ? floorNameFor(cwd) : ''
      sync()
    }
    const sync = () => go.toggleAttribute('disabled', kind === 'creative' && !ready)
    projectBtn.addEventListener('click', () => setKind('project'))
    creativeBtn.addEventListener('click', () => setKind('creative'))
    const room = { project: canAddFloor(state.settings.projects, 'project'), creative: canAddFloor(state.settings.projects, 'creative') }
    projectBtn.toggleAttribute('disabled', !room.project)
    creativeBtn.toggleAttribute('disabled', !room.creative)
    if (!room.project) projectBtn.title = 'O prédio já tem o máximo de andares de projeto. Tire um em Configurações.'
    if (!room.creative) creativeBtn.title = 'Já tem o máximo de andares criativos.'
    if (!room[start]) start = room.project ? 'project' : 'creative'
    void readStatus().then((st) => {
      ready = creativeReady(st)
      sync()
    })

    const el = modal(
      'Novo andar',
      [
        h('div', { class: 'floor-kinds' }, projectBtn, creativeBtn),
        intro,
        codexBox,
        h('div', { class: 'field' }, folderLabel, h('div', { class: 'path-row' }, label, pick), useDefault, hint),
        field('Nome do andar', name),
      ],
      [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'), go],
      () => finish(null),
    )
    setKind(start)
    root.append(el)
    pick.focus()
  })
}
