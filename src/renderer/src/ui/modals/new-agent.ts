import { AGENT_NAMES } from '@shared/describe'
import { projectFor } from '@shared/projects'
import type { AgentBrain, OfficePermissionMode, ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { accountField } from '../accounts'
import { h, icon } from '../dom'
import { templatesTab } from '../templates'
import { cleanError, field, LAST_CWD, modal } from './common'
import { brainFields, meterField, MODES } from './brain'

// "Novo agente": call an agent into a folder (Conversar), hire one with a task, or a template.

const LAST_SUMMON_MODE = 'agent-office:summon-mode'

/**
 * The folder row of the hire and summon forms. On a project floor the folder is the
 * project's and cannot change; downstairs you pick one, and a folder that belongs to
 * a project floor says so, since the agent will work up there.
 */
function folderField(
  state: State,
  project: ProjectFloor | null | undefined,
  onChange?: (cwd: string) => void,
): { el: HTMLElement; cwd(): string; ensure(): Promise<boolean> } {
  if (project) {
    return {
      el: field(
        'Projeto',
        h('div', { class: 'path-row path-fixed', title: project.cwd }, icon('folder', 15), h('span', { class: 'path-name' }, project.name), h('span', { class: 'path-label' }, project.cwd)),
        `Andar ${project.name}: quem você chama aqui trabalha nesta pasta.`,
      ),
      cwd: () => project.cwd,
      ensure: async () => true,
    }
  }
  let cwd = localStorage.getItem(LAST_CWD) ?? ''
  const label = h('span', { class: 'path-label' }, cwd || 'Nenhuma pasta escolhida')
  const hint = h('span', {})
  const set = (p: string) => {
    cwd = p
    label.textContent = p
    const floor = projectFor(state.settings.projects, p)
    hint.textContent = floor ? `Essa pasta é do andar ${floor.name}: o agente vai trabalhar lá.` : ''
    onChange?.(p)
  }
  if (cwd) set(cwd)
  const pick = h('button', { class: 'btn', type: 'button' }, icon('folder', 15), 'Escolher…')
  pick.addEventListener('click', async () => {
    const p = await window.office.pickFolder(cwd || undefined)
    if (p) set(p)
  })
  return {
    el: field('Pasta do projeto', h('div', { class: 'path-row' }, label, pick), hint),
    cwd: () => cwd,
    ensure: async () => {
      if (cwd) return true
      const p = await window.office.pickFolder()
      if (p) set(p)
      return !!p
    },
  }
}

/**
 * "Trabalhar numa cópia isolada (worktree)": shown only when the folder is a git repo,
 * and on by default there, unless the folder's floor turned worktrees off (Bastidores →
 * Worktrees). value() is undefined while the folder is unknown, so the main process decides.
 */
export function worktreeToggle(projects: () => ProjectFloor[] = () => []): { el: HTMLElement; set(cwd: string | undefined): void; value(): boolean | undefined } {
  const box = h('input', { type: 'checkbox' }) as HTMLInputElement
  box.checked = true
  const el = h(
    'label',
    { class: 'check worktree-check hidden', title: 'O agente ganha um branch agent/… numa pasta própria em .agent-office/worktrees. Outros agentes no mesmo repo não mexem nos arquivos dele.' },
    box,
    'Trabalhar numa cópia isolada (worktree)',
  )
  let git: boolean | undefined
  let asked = ''
  return {
    el,
    set: (cwd) => {
      asked = cwd ?? ''
      git = undefined
      box.checked = projectFor(projects(), cwd)?.worktrees !== false
      el.classList.add('hidden')
      if (!cwd) return
      void window.office.isGitRepo(cwd).then((yes) => {
        if (asked !== cwd) return
        git = yes
        el.classList.toggle('hidden', !yes)
      })
    },
    value: () => (git === false ? false : git ? box.checked : box.checked ? undefined : false),
  }
}

const LAST_NEW_AGENT_TAB = 'agent-office:new-agent-tab'

type NewAgentTab = 'summon' | 'hire' | 'templates'

export type NewAgentChoice = { kind: 'summon'; cwd: string; permissionMode: OfficePermissionMode; brain: AgentBrain; worktree?: boolean } | { kind: 'hire' }

/**
 * "Novo agente": one dialog for every way of getting an agent.
 * - Conversar: folder and freedom only; resolves the choice so the caller summons the
 *   agent and opens the panel.
 * - Com tarefa: adds a name and a task; hires right here and resolves `{ kind: 'hire' }`.
 * - Modelos: a saved template fills everything but the folder and account; hires right
 *   here (see ./templates.ts) and resolves `{ kind: 'hire' }`.
 * - Squad: only on a project floor with squads; closes and hands over to `hireSquad`.
 * The fields are built once, so switching tabs keeps whatever was typed. On a project
 * floor the folder is the project's. Resolves null if the player gave up.
 */
export function openNewAgent(
  root: HTMLElement,
  state: State,
  project: ProjectFloor | null | undefined,
  opts: { toast: (t: string, k?: 'info' | 'ok' | 'err') => void; hireSquad?: () => void; tab?: NewAgentTab },
): Promise<NewAgentChoice | null> {
  return new Promise((resolve) => {
    const { toast } = opts
    const used = new Set([...state.agents.values()].map((a) => a.name))
    const name = h('input', { class: 'input', value: AGENT_NAMES.find((n) => !used.has(n)) ?? `Agente ${used.size + 1}`, maxlength: 40 })
    const isolated = worktreeToggle(() => state.settings.projects)
    const folder = folderField(state, project, (p) => isolated.set(p))
    isolated.set(folder.cwd())
    const task = h('textarea', { class: 'input', rows: 5, placeholder: 'Ex.: Adicione testes para o módulo de pagamentos e corrija o que quebrar.' })
    const brain = brainFields({ model: state.settings.defaultModel, effort: state.settings.defaultEffort })
    const account = accountField(state, () => folder.cwd())
    const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label)))
    const savedMode = localStorage.getItem(LAST_SUMMON_MODE)
    mode.value = MODES.some((m) => m.value === savedMode) ? savedMode! : state.settings.defaultPermissionMode
    const modeHint = h('span', {})
    const syncHint = () => {
      const m = MODES.find((x) => x.value === mode.value)!
      modeHint.textContent = m.hint
      modeHint.className = m.value === 'bypassPermissions' ? 'warn' : ''
    }
    mode.addEventListener('change', syncHint)
    syncHint()

    let done = false
    const finish = (v: NewAgentChoice | null) => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }

    const savedTab = localStorage.getItem(LAST_NEW_AGENT_TAB)
    let tab: NewAgentTab = opts.tab ?? (savedTab === 'hire' || savedTab === 'templates' ? savedTab : 'summon')
    const templates = templatesTab(root, state, project, { toast, cwd: () => folder.cwd(), ensureFolder: () => folder.ensure(), accounts: () => account.value(), worktree: () => isolated.value() })
    const go = h('button', { class: 'btn btn-primary' })
    const nameField = field('Nome', name)
    const taskField = field('Tarefa', task)
    const tabHint = h('div', { class: 'field-hint' })
    const send = state.platform === 'darwin' ? '⌘↩' : 'Ctrl+Enter'

    const segBtn = (label: string, title: string, onclick: () => void) => h('button', { class: 'seg-btn', type: 'button', title, onclick }, label)
    const talkBtn = segBtn('Conversar', 'Sem tarefa: ele chega e o painel abre para você digitar', () => setTab('summon', true))
    const taskBtn = segBtn('Com tarefa', 'Nome, tarefa e modelo: ele já chega trabalhando', () => setTab('hire', true))
    const templatesBtn = segBtn('Modelos', 'Contrate com as escolhas salvas num modelo', () => setTab('templates', true))
    // The orchestrator is optional: plain agents work on a project floor too.
    const squads = project ? state.squads.filter((q) => q.cwd === project.cwd).length : 0
    const squadBtn =
      squads && opts.hireSquad
        ? segBtn(squads === 1 ? 'Squad' : `Squad (${squads})`, 'Um orquestrador que sobe com o squad inteiro e roda o pipeline', () => {
            finish(null)
            opts.hireSquad!()
          })
        : null
    const seg = h('div', { class: 'seg', role: 'tablist' }, talkBtn, taskBtn, templatesBtn, squadBtn)
    const modelField = field('Modelo', brain.model, brain.hint)
    const effortField = meterField('Esforço', brain.meter)
    const modeField = field('Permissões', mode, modeHint)

    // Hidden with the class, not the attribute: .field sets display and would win over [hidden].
    const setTab = (next: NewAgentTab, remember: boolean) => {
      tab = next
      if (remember) localStorage.setItem(LAST_NEW_AGENT_TAB, next)
      const hire = next === 'hire'
      const byTemplate = next === 'templates'
      talkBtn.classList.toggle('on', next === 'summon')
      taskBtn.classList.toggle('on', hire)
      templatesBtn.classList.toggle('on', byTemplate)
      nameField.classList.toggle('hidden', !hire)
      taskField.classList.toggle('hidden', !hire)
      // a template brings its own brain and freedom
      for (const f of [modelField, effortField, modeField]) f.classList.toggle('hidden', byTemplate)
      templates.el.classList.toggle('hidden', !byTemplate)
      go.replaceChildren(...(hire || byTemplate ? [icon('plus', 16), 'Contratar'] : [icon('terminal', 15), 'Chamar']))
      tabHint.textContent = byTemplate
        ? `Ele chega com as escolhas do modelo; sem instrução base, digite a tarefa. ${send} contrata.`
        : hire
          ? `Ele sobe pelo elevador e já começa. ${send} contrata.`
          : 'Sem tarefa: ele chega e o painel abre para você digitar.'
      if (hire) task.focus()
      else if (byTemplate) templates.focus()
      else go.focus()
    }

    const summon = async () => {
      if (!(await folder.ensure())) return
      if (mode.value === 'bypassPermissions' && !confirm('Esse agente vai rodar qualquer comando sem perguntar. Continuar?')) return
      if (!project) localStorage.setItem(LAST_CWD, folder.cwd())
      localStorage.setItem(LAST_SUMMON_MODE, mode.value)
      finish({ kind: 'summon', cwd: folder.cwd(), permissionMode: mode.value as OfficePermissionMode, brain: { ...brain.value(), accounts: account.value() }, worktree: isolated.value() })
    }
    const hire = async () => {
      const cwd = folder.cwd()
      if (!cwd) return toast('Escolha a pasta do projeto.', 'err')
      if (!task.value.trim()) return toast('Descreva a tarefa.', 'err')
      if (mode.value === 'bypassPermissions' && !confirm('Esse agente vai rodar qualquer comando sem perguntar. Continuar?')) return
      go.setAttribute('disabled', '')
      try {
        if (!project) localStorage.setItem(LAST_CWD, cwd)
        localStorage.setItem(LAST_SUMMON_MODE, mode.value)
        const a = await window.office.hire({
          name: name.value.trim() || 'Agente',
          cwd,
          task: task.value.trim(),
          ...brain.value(),
          accounts: account.value(),
          permissionMode: mode.value as OfficePermissionMode,
          worktree: isolated.value(),
        })
        toast(`${a.name} está subindo pelo elevador.`, 'ok')
        finish({ kind: 'hire' })
      } catch (err) {
        toast(cleanError(err), 'err')
        go.removeAttribute('disabled')
      }
    }
    const byTemplate = async () => {
      go.setAttribute('disabled', '')
      if (await templates.submit()) finish({ kind: 'hire' })
      else go.removeAttribute('disabled')
    }
    const submit = () => {
      if (go.hasAttribute('disabled')) return
      void (tab === 'templates' ? byTemplate() : tab === 'hire' ? hire() : summon())
    }
    go.addEventListener('click', submit)

    const el = modal(
      project ? `Novo agente · ${project.name}` : 'Novo agente',
      [
        seg,
        nameField,
        folder.el,
        isolated.el,
        taskField,
        templates.el,
        modelField,
        effortField,
        ...(account.el ? [account.el] : []),
        modeField,
        tabHint,
      ],
      [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'), go],
      () => finish(null),
    )
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return
      const t = e.target
      if (tab === 'hire' || tab === 'templates') {
        // Enter breaks lines in the task; ⌘/Ctrl+Enter sends from anywhere.
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault()
          submit()
        }
      } else if (!(t instanceof HTMLSelectElement || t instanceof HTMLButtonElement || t instanceof HTMLTextAreaElement)) {
        submit()
      }
    })
    root.append(el)
    setTab(tab, false)
  })
}
