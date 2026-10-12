import { AGENT_NAMES, HAIR_COLORS, HAIR_STYLES, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES } from '@shared/describe'
import { floorNameFor, MAX_PROJECT_FLOORS, projectFor } from '@shared/projects'
import { DEFAULT_BRAND } from '../world/brand'
import type { AgentBrain, AgentSummary, EffortLevel, Look, OfficePermissionMode, ProjectFloor, SessionEntry } from '@shared/types'
import type { State } from '../state'
import { accountField, openAccounts } from './accounts'
import { h, icon, timeAgo } from './dom'
import { portrait } from './portrait'

export const LAST_CWD = 'agent-office:last-cwd'

const MODES: { value: OfficePermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Pedir permissão', hint: 'Ele vem até você antes de editar arquivos ou rodar comandos.' },
  { value: 'acceptEdits', label: 'Editar livremente', hint: 'Edita arquivos sozinho; pede antes de rodar comandos.' },
  { value: 'auto', label: 'Automático', hint: 'Um classificador aprova o que é seguro e só traz o resto para você.' },
  { value: 'plan', label: 'Planejar primeiro', hint: 'Só lê o projeto e traz um plano para você aprovar.' },
  { value: 'bypassPermissions', label: 'Sem pedir nada', hint: 'PERIGOSO: roda qualquer comando sem perguntar. Use só em pastas descartáveis.' },
]

export const MODELS = [
  { value: '', label: 'Padrão do Claude Code', hint: 'O modelo configurado no seu Claude Code (/model).' },
  { value: 'fable', label: 'Fable', hint: 'O mais capaz e o mais caro. Pode exigir créditos de uso.' },
  { value: 'opus', label: 'Opus', hint: 'Forte em tarefas longas e código difícil.' },
  { value: 'sonnet', label: 'Sonnet', hint: 'Equilíbrio entre qualidade, velocidade e custo.' },
  { value: 'haiku', label: 'Haiku', hint: 'Rápido e barato, para tarefas simples.' },
]

export const EFFORTS: { value: EffortLevel | ''; label: string; title: string; hint: string; stats?: [depth: number, speed: number, cost: number] }[] = [
  { value: '', label: 'Padrão do modelo', title: 'Auto', hint: 'O modelo usa o esforço padrão dele.' },
  { value: 'low', label: 'Baixo', title: 'Passeio', hint: 'Pensa pouco. Bom para perguntas rápidas e ajustes pequenos.', stats: [1, 5, 1] },
  { value: 'medium', label: 'Médio', title: 'Trote', hint: 'Pensa o suficiente para o trabalho do dia a dia.', stats: [2, 4, 2] },
  { value: 'high', label: 'Alto', title: 'Foco', hint: 'Pensa com cuidado antes de agir. Bom para features e bugs chatos.', stats: [3, 3, 3] },
  { value: 'xhigh', label: 'Extra alto', title: 'Turbo', hint: 'Pensa bastante. Para refatorações grandes e problemas difíceis.', stats: [4, 2, 4] },
  { value: 'max', label: 'Máximo', title: 'Modo lenda', hint: 'Sem economia. O Claude Code rebaixa se o modelo não aceitar.', stats: [5, 1, 5] },
]

/**
 * Effort as a charge meter: bars that light up to the chosen level, cool to hot,
 * with depth/speed/cost pips so the trade-off is visible before hiring.
 * Arrow keys move the charge; hovering previews a level without picking it.
 */
export function effortMeter(initial: string, compact = false): { el: HTMLElement; value(): EffortLevel | '' } {
  let current = EFFORTS.findIndex((e) => e.value === initial)
  if (current < 0) current = 0
  const tiles = EFFORTS.map((e, i) =>
    h(
      'button',
      { type: 'button', class: `emeter-tile emeter-l${i}`, role: 'radio', title: `${e.label}: ${e.hint}`, 'aria-label': e.label },
      i === 0 ? h('span', { class: 'emeter-auto' }, 'A') : h('span', { class: 'emeter-bar' }),
    ),
  )
  const name = h('span', { class: 'emeter-name' })
  const tag = h('span', { class: 'emeter-tag' })
  const hint = h('span', { class: 'emeter-hint' })
  const pips = (label: string) => {
    const row = h('div', { class: 'emeter-stat' }, h('span', { class: 'emeter-stat-label' }, label), h('span', { class: 'emeter-pips' }, ...Array.from({ length: 5 }, () => h('i', {}))))
    return row
  }
  const stats = [pips('Profundidade'), pips('Velocidade'), pips('Custo')]
  const card = h('div', { class: 'emeter-card' }, h('div', { class: 'emeter-head' }, name, tag), compact ? null : h('div', { class: 'emeter-stats' }, ...stats), hint)
  const track = h('div', { class: 'emeter-track', role: 'radiogroup', 'aria-label': 'Esforço' }, ...tiles)
  const el = h('div', { class: `emeter${compact ? ' emeter-compact' : ''}` }, track, card)

  const paint = (shown: number) => {
    const e = EFFORTS[shown]
    el.dataset.level = String(shown)
    tiles.forEach((t, i) => {
      t.classList.toggle('lit', shown > 0 && i > 0 && i <= shown)
      t.classList.toggle('on', i === current)
      t.setAttribute('aria-checked', String(i === current))
      t.tabIndex = i === current ? 0 : -1
    })
    name.textContent = e.title
    tag.textContent = shown === 0 ? 'padrão' : `nível ${shown} · ${e.label.toLowerCase()}`
    hint.textContent = e.hint
    stats.forEach((row, k) => row.querySelectorAll('i').forEach((pip, j) => pip.classList.toggle('on', !!e.stats && j < e.stats[k])))
    card.classList.toggle('emeter-unknown', !e.stats)
  }
  const pick = (i: number, focus = false) => {
    current = Math.max(0, Math.min(EFFORTS.length - 1, i))
    paint(current)
    if (focus) tiles[current].focus()
    // replay the "charge" pop on the new level
    el.classList.remove('emeter-pop')
    void el.offsetWidth
    el.classList.add('emeter-pop')
  }
  tiles.forEach((t, i) => {
    t.addEventListener('click', () => pick(i))
    t.addEventListener('pointerenter', () => paint(i))
  })
  track.addEventListener('pointerleave', () => paint(current))
  track.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    pick(current + step, true)
  })
  paint(current)
  return { el, value: () => EFFORTS[current].value }
}

/**
 * Model picker plus the effort meter, so nobody hires a Haiku on low effort
 * for a migration by mistake.
 */
export function brainFields(initial: { model: string; effort: string }, compact = false): { model: HTMLSelectElement; meter: HTMLElement; hint: HTMLElement; value(): AgentBrain } {
  const model = h('select', { class: 'input' }, ...MODELS.map((m) => h('option', { value: m.value }, m.label))) as HTMLSelectElement
  model.value = MODELS.some((m) => m.value === initial.model) ? initial.model : ''
  const effort = effortMeter(initial.effort, compact)
  const hint = h('span', {})
  const sync = () => {
    const m = MODELS.find((x) => x.value === model.value)!
    hint.textContent = `${m.label}: ${m.hint}`
  }
  model.addEventListener('change', sync)
  sync()
  // '' is sent on purpose: it means "Claude Code's default", not the office default.
  return { model, meter: effort.el, hint, value: () => ({ model: model.value || undefined, effort: effort.value() || undefined }) }
}

/** Not a <label>: a label would forward clicks on its blank space to the first tile. */
function meterField(label: string, meter: HTMLElement): HTMLElement {
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), meter)
}

export function modal(title: string, body: HTMLElement[], footer: HTMLElement[], onClose: () => void): HTMLDivElement {
  const box = h(
    'div',
    { class: 'modal card' },
    h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title), h('button', { class: 'icon-btn', onclick: onClose }, icon('x', 18))),
    h('div', { class: 'modal-body' }, ...body),
    h('div', { class: 'modal-foot' }, ...footer),
  )
  const backdrop = h('div', { class: 'backdrop' }, box)
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) onClose()
  })
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose()
    e.stopPropagation()
  })
  return backdrop
}

export function field(label: string, control: HTMLElement, hint?: HTMLElement | string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null)
}

/** Styled yes/no dialog. Resolves true on confirm, false on cancel/Esc/backdrop. */
export function confirmDialog(
  root: HTMLElement,
  opts: { title: string; text: string; confirm: string; cancel: string; danger?: boolean; warn?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }
    const ok = h('button', { class: opts.danger ? 'btn btn-danger-solid' : 'btn btn-primary', onclick: () => finish(true) }, opts.confirm)
    const body = [h('div', { class: 'confirm-text' }, opts.text)]
    if (opts.warn) body.unshift(h('div', { class: 'confirm-warn' }, icon('alert', 16), h('span', {}, opts.warn)))
    const el = modal(opts.title, body, [h('button', { class: 'btn', onclick: () => finish(false) }, opts.cancel), ok], () => finish(false))
    el.classList.add('backdrop-confirm')
    root.append(el)
    ok.focus()
  })
}

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
 * and on by default there. value() is undefined while the folder is unknown, so the
 * main process decides (yes when it is a repo).
 */
export function worktreeToggle(): { el: HTMLElement; set(cwd: string | undefined): void; value(): boolean | undefined } {
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

type NewAgentTab = 'summon' | 'hire'

export type NewAgentChoice = { kind: 'summon'; cwd: string; permissionMode: OfficePermissionMode; brain: AgentBrain; worktree?: boolean } | { kind: 'hire' }

/**
 * "Novo agente": one dialog for every way of getting an agent.
 * - Conversar: folder and freedom only; resolves the choice so the caller summons the
 *   agent and opens the panel.
 * - Com tarefa: adds a name and a task; hires right here and resolves `{ kind: 'hire' }`.
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
    const isolated = worktreeToggle()
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
    let tab: NewAgentTab = opts.tab ?? (savedTab === 'hire' ? 'hire' : 'summon')
    const go = h('button', { class: 'btn btn-primary' })
    const nameField = field('Nome', name)
    const taskField = field('Tarefa', task)
    const tabHint = h('div', { class: 'field-hint' })
    const send = state.platform === 'darwin' ? '⌘↩' : 'Ctrl+Enter'

    const segBtn = (label: string, title: string, onclick: () => void) => h('button', { class: 'seg-btn', type: 'button', title, onclick }, label)
    const talkBtn = segBtn('Conversar', 'Sem tarefa: ele chega e o painel abre para você digitar', () => setTab('summon', true))
    const taskBtn = segBtn('Com tarefa', 'Nome, tarefa e modelo: ele já chega trabalhando', () => setTab('hire', true))
    // The orchestrator is optional: plain agents work on a project floor too.
    const squads = project ? state.squads.filter((q) => q.cwd === project.cwd).length : 0
    const squadBtn =
      squads && opts.hireSquad
        ? segBtn(squads === 1 ? 'Squad' : `Squad (${squads})`, 'Um orquestrador que sobe com o squad inteiro e roda o pipeline', () => {
            finish(null)
            opts.hireSquad!()
          })
        : null
    const seg = h('div', { class: 'seg', role: 'tablist' }, talkBtn, taskBtn, squadBtn)

    // Hidden with the class, not the attribute: .field sets display and would win over [hidden].
    const setTab = (next: NewAgentTab, remember: boolean) => {
      tab = next
      if (remember) localStorage.setItem(LAST_NEW_AGENT_TAB, next)
      const hire = next === 'hire'
      talkBtn.classList.toggle('on', !hire)
      taskBtn.classList.toggle('on', hire)
      nameField.classList.toggle('hidden', !hire)
      taskField.classList.toggle('hidden', !hire)
      go.replaceChildren(...(hire ? [icon('plus', 16), 'Contratar'] : [icon('terminal', 15), 'Chamar']))
      tabHint.textContent = hire ? `Ele sobe pelo elevador e já começa. ${send} contrata.` : 'Sem tarefa: ele chega e o painel abre para você digitar.'
      if (hire) task.focus()
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
    const submit = () => {
      if (go.hasAttribute('disabled')) return
      void (tab === 'hire' ? hire() : summon())
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
        field('Modelo', brain.model, brain.hint),
        meterField('Esforço', brain.meter),
        ...(account.el ? [account.el] : []),
        field('Permissões', mode, modeHint),
        tabHint,
      ],
      [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'), go],
      () => finish(null),
    )
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return
      const t = e.target
      if (tab === 'hire') {
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

/** `section: 'bridge'` opens scrolled to the terminal sessions box (the dock's gear does it when the bridge fails). */
export function openSettings(root: HTMLElement, state: State, toast: (t: string, k?: 'info' | 'ok' | 'err') => void, opts: { section?: 'bridge' } = {}): void {
  const s = state.settings
  const look: Look = { ...s.playerLook }
  const name = h('input', { class: 'input', value: s.playerName, maxlength: 24 })
  const preview = h('div', { class: 'look-preview' })
  const renderPreview = () => preview.replaceChildren(portrait(look, 96))
  renderPreview()

  const swatches = (key: keyof Look, colors: string[]) => {
    const row = h('div', { class: 'swatches' })
    const paint = () => row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === look[key]))
    for (const c of colors) {
      const b = h('button', { class: 'swatch', style: `background:${c}`, type: 'button' })
      b.dataset.c = c
      b.addEventListener('click', () => {
        ;(look[key] as string) = c
        paint()
        renderPreview()
      })
      row.append(b)
    }
    paint()
    return row
  }
  const styles = h('div', { class: 'swatches' })
  for (let i = 0; i < HAIR_STYLES; i++) {
    const b = h('button', { class: 'swatch swatch-style', type: 'button' }, String(i + 1))
    b.classList.toggle('on', look.hairStyle === i)
    b.addEventListener('click', () => {
      look.hairStyle = i
      styles.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i))
      renderPreview()
    })
    styles.append(b)
  }

  const pixel = h('select', { class: 'input' }, ...[2, 3, 4, 5].map((n) => h('option', { value: n }, `${n}px${n === 3 ? ' (padrão)' : ''}`)))
  pixel.value = String(s.pixelSize)
  const notify = h('input', { type: 'checkbox' }) as HTMLInputElement
  notify.checked = s.notifications
  const brain = brainFields({ model: s.defaultModel, effort: s.defaultEffort })
  const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label)))
  mode.value = s.defaultPermissionMode
  const maxSubs = h('input', { class: 'input', type: 'number', min: 0, max: 100, step: 1, value: s.maxSubagents ?? 10 }) as HTMLInputElement
  const budget = h('input', { class: 'input', type: 'number', min: 0, step: 0.5, value: s.agentBudgetUsd ?? 0 }) as HTMLInputElement

  const b = state.bridge
  const bridgeStatus = h(
    'div',
    { class: 'bridge-status' },
    h('span', { class: `dot ${b.installed && b.listening ? 'dot-working' : b.installed ? 'dot-error' : 'dot-stopped'}` }),
    b.installed ? (b.listening ? `Conectado (porta ${b.port})` : `Hooks instalados, servidor parado${b.error ? `: ${b.error}` : ''}`) : 'Desconectado',
  )
  // project floors: one per folder; renaming keeps whatever else a floor carries
  let floors: ProjectFloor[] = s.projects.map((p) => ({ ...p }))
  const floorList = h('div', { class: 'floor-list' })
  const addFloor = h('button', { class: 'btn', type: 'button' }, icon('plus', 15), 'Adicionar andar')
  const renderFloors = () => {
    floorList.replaceChildren(
      ...(floors.length
        ? floors.map((p, i) => {
            const nameIn = h('input', { class: 'input', value: p.name, maxlength: 32, title: 'Nome do andar' })
            nameIn.addEventListener('input', () => (floors[i] = { ...floors[i], name: nameIn.value }))
            const squads = state.squads.filter((q) => q.cwd === p.cwd).length
            const remove = h('button', { class: 'icon-btn', type: 'button', title: 'Tirar o andar: os agentes dele descem para o térreo' }, icon('x', 15))
            const set = (patch: Partial<ProjectFloor>) => (floors[i] = { ...floors[i], ...patch })
            remove.addEventListener('click', () => {
              floors = floors.filter((_, j) => j !== i)
              renderFloors()
            })
            return h(
              'div',
              { class: 'floor-row' },
              h('span', { class: 'floor-num' }, String(i + 1)),
              h('div', { class: 'floor-row-main' }, nameIn, h('span', { class: 'floor-row-path', title: p.cwd }, p.cwd, squads ? ` · ${squads === 1 ? '1 squad' : `${squads} squads`}` : ''), brandFields(floors[i], set, toast)),
              remove,
            )
          })
        : [h('div', { class: 'field-hint' }, 'Nenhum andar: o escritório fica só no térreo.')]),
    )
    addFloor.classList.toggle('hidden', floors.length >= MAX_PROJECT_FLOORS)
  }
  addFloor.addEventListener('click', async () => {
    const p = await window.office.pickFolder()
    if (!p) return
    if (floors.some((x) => x.cwd === p)) return toast('Essa pasta já tem um andar.', 'err')
    floors = [...floors, { id: `p-${Date.now().toString(36)}`, name: floorNameFor(p), cwd: p }]
    renderFloors()
  })
  renderFloors()

  const bridgeBtn = h('button', { class: 'btn' }, b.installed ? 'Desconectar' : 'Conectar')
  bridgeBtn.addEventListener('click', async () => {
    const next = b.installed ? await window.office.uninstallBridge() : await window.office.installBridge()
    toast(next.installed ? 'Sessões do terminal conectadas. Abra um novo `claude` no terminal.' : 'Sessões do terminal desconectadas.', 'ok')
    close()
  })

  const close = () => el.remove()
  const save = h('button', { class: 'btn btn-primary' }, icon('check', 16), 'Salvar')
  save.addEventListener('click', async () => {
    await window.office.saveSettings({
      playerName: name.value.trim() || 'Você',
      playerLook: look,
      pixelSize: Number(pixel.value),
      notifications: notify.checked,
      defaultModel: brain.model.value,
      defaultEffort: brain.value().effort ?? '',
      defaultPermissionMode: mode.value as OfficePermissionMode,
      maxSubagents: Math.max(0, Math.round(Number(maxSubs.value) || 0)),
      agentBudgetUsd: Math.max(0, Number(budget.value) || 0),
      projects: floors.map((p) => ({ ...p, name: p.name.trim() || floorNameFor(p.cwd) })),
    })
    close()
  })

  const el = modal(
    'Configurações',
    [
      h(
        'div',
        { class: 'look-editor' },
        preview,
        h(
          'div',
          { class: 'look-fields' },
          field('Seu nome', name),
          field('Pele', swatches('skin', SKIN_TONES)),
          field('Cabelo', swatches('hair', HAIR_COLORS)),
          field('Corte', styles),
          field('Camiseta', swatches('shirt', SHIRT_COLORS)),
          field('Calça', swatches('pants', PANTS_COLORS)),
        ),
      ),
      h('div', { class: 'field-row' }, field('Pixel art', pixel), field('Modelo padrão', brain.model), field('Permissão padrão', mode)),
      meterField('Esforço padrão', brain.meter),
      h('label', { class: 'check' }, notify, 'Notificar quando um agente precisar de mim ou terminar'),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('users', 16), 'Andares por projeto'),
        h(
          'div',
          { class: 'field-hint' },
          'Cada andar é uma pasta de projeto: quem você contrata ou chama lá trabalha nela. Se a pasta tiver squads (squads/<code>/squad.yaml), a Diretoria do andar contrata um orquestrador com o squad.',
        ),
        floorList,
        addFloor,
      ),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('coin', 16), 'Limites dos agentes'),
        h(
          'div',
          { class: 'field-row' },
          field('Subagentes ao mesmo tempo', maxSubs, 'Por agente. 0 = limite do Claude Code (20).'),
          field('Teto de custo por agente (US$)', budget, 'Ao chegar nele, o agente para e avisa. 0 = sem teto.'),
        ),
      ),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('users', 16), 'Contas do Claude'),
        h(
          'div',
          { class: 'field-hint' },
          `${s.accounts.length === 1 ? 'Uma conta' : `${s.accounts.length} contas`}. Adicione outras para separar projetos ou revezar quando uma bater o limite de 5h.`,
        ),
        h('div', { class: 'bridge-row' }, h('button', { class: 'btn', type: 'button', onclick: () => openAccounts(root, state, toast) }, 'Gerenciar contas')),
      ),
      h(
        'div',
        { class: 'bridge-box bridge-terminal' },
        h('div', { class: 'bridge-title' }, icon('terminal', 16), 'Sessões do Claude Code no terminal'),
        h(
          'div',
          { class: 'field-hint' },
          'Adiciona hooks HTTP em ~/.claude/settings.json. Cada `claude` aberto no terminal aparece como agente, e os pedidos de permissão vêm até você aqui. Com o app fechado, o terminal funciona normal.',
        ),
        h('div', { class: 'bridge-row' }, bridgeStatus, bridgeBtn),
      ),
    ],
    [
      h('span', { class: 'app-version', title: `Build de ${__APP_BUILD__}` }, `Agent Office v${__APP_VERSION__} · build ${__APP_BUILD__}`),
      h('button', { class: 'btn', onclick: close }, 'Cancelar'),
      save,
    ],
    close,
  )
  root.append(el)
  if (opts.section === 'bridge') el.querySelector('.bridge-terminal')?.scrollIntoView({ block: 'start' })
}

const RECENT_MS = 2 * 60 * 1000

/** Resume center: recent Claude Code sessions, with a way to call each one back. */
export function openResume(
  root: HTMLElement,
  state: State,
  actions: { openAgent(id: string): void; toast(t: string, k?: 'info' | 'ok' | 'err'): void },
): void {
  let sessions: SessionEntry[] = []
  const search = h('input', { class: 'input resume-search', placeholder: 'Buscar por título, pedido ou pasta…' })
  const list = h('div', { class: 'resume-list' }, h('div', { class: 'resume-empty' }, 'Carregando sessões…'))
  const close = () => el.remove()

  const callBack = async (s: SessionEntry, btn: HTMLButtonElement) => {
    if (Date.now() - s.lastModified < RECENT_MS) {
      const go = await confirmDialog(root, {
        title: 'Essa sessão pode estar aberta',
        text: 'Ela foi usada há menos de 2 minutos, talvez num terminal. Retomar a mesma sessão em dois lugares ao mesmo tempo mistura as conversas.',
        confirm: 'Chamar mesmo assim',
        cancel: 'Cancelar',
      })
      if (!go) return
    }
    btn.setAttribute('disabled', '')
    try {
      const a = await window.office.recall(s.sessionId)
      close()
      actions.toast(`${a.name} voltou com a sessão "${clip(s.title, 40)}".`, 'ok')
      actions.openAgent(a.id)
    } catch (err) {
      actions.toast(cleanError(err), 'err')
      btn.removeAttribute('disabled')
    }
  }

  const row = (s: SessionEntry): HTMLElement => {
    const owner = [...state.agents.values()].find((a) => a.sessionId === s.sessionId)
    const recent = Date.now() - s.lastModified < RECENT_MS
    const folder = s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() : 'pasta desconhecida'
    const command = `cd '${(s.cwd ?? '.').replace(/'/g, `'\\''`)}' && claude --resume ${s.sessionId}`
    const badge = owner
      ? h('span', { class: owner.source === 'office' ? 'chip chip-done' : 'chip chip-term' }, owner.source === 'office' ? `no escritório: ${owner.name}` : 'aberta no terminal')
      : recent
        ? h('span', { class: 'chip chip-wait' }, 'usada agora')
        : null
    const callBtn = h('button', { class: 'btn btn-small btn-primary' }, icon('walk', 14), 'Chamar')
    callBtn.addEventListener('click', () => callBack(s, callBtn))
    const actionsEl = owner
      ? h('button', {
          class: 'btn btn-small',
          onclick: () => {
            close()
            actions.openAgent(owner.id)
          },
        }, icon('eye', 14), 'Ver')
      : h(
          'div',
          { class: 'resume-actions' },
          s.cwd ? callBtn : null,
          state.platform === 'darwin' && s.cwd
            ? h('button', {
                class: 'icon-btn',
                title: 'Abrir no Terminal',
                onclick: async () => {
                  const r = await window.office.openInTerminal(s.sessionId)
                  if (r.ok) actions.toast('Abrindo a sessão no Terminal.', 'ok')
                  else actions.toast(r.message ?? 'Não consegui abrir o Terminal.', 'err')
                },
              }, icon('terminal', 15))
            : null,
          h('button', {
            class: 'icon-btn',
            title: `Copiar: claude --resume ${s.sessionId}`,
            onclick: async () => {
              await navigator.clipboard.writeText(command)
              actions.toast('Comando copiado. Cole no terminal.', 'ok')
            },
          }, icon('copy', 15)),
        )
    const prompt = s.firstPrompt && s.firstPrompt !== s.title && !s.title.startsWith(s.firstPrompt.slice(0, 30)) ? s.firstPrompt : null
    return h(
      'div',
      { class: 'resume-row' },
      h(
        'div',
        { class: 'resume-main' },
        h('div', { class: 'resume-title' }, h('span', { class: 'resume-title-text' }, s.title), badge),
        h(
          'div',
          { class: 'resume-meta' },
          icon('folder', 12),
          h('span', { title: s.cwd ?? '' }, folder ?? ''),
          s.branch ? h('span', { class: 'resume-branch' }, s.branch) : null,
          h('span', {}, '·'),
          h('span', {}, timeAgo(s.lastModified)),
          h('span', { class: 'resume-id', title: s.sessionId }, s.sessionId.slice(0, 8)),
        ),
        prompt ? h('div', { class: 'resume-prompt' }, prompt) : null,
      ),
      actionsEl,
    )
  }

  const render = () => {
    const q = search.value.trim().toLowerCase()
    const shown = sessions.filter((s) => !q || [s.title, s.firstPrompt, s.cwd, s.branch, s.sessionId].some((v) => v?.toLowerCase().includes(q)))
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'resume-empty' }, sessions.length ? 'Nenhuma sessão com esse texto.' : 'Nenhuma sessão salva ainda.'))
      return
    }
    const groups = new Map<string, SessionEntry[]>()
    for (const s of shown) {
      const g = dayGroup(s.lastModified)
      groups.set(g, [...(groups.get(g) ?? []), s])
    }
    list.replaceChildren(...[...groups].flatMap(([g, items]) => [h('div', { class: 'resume-group' }, g), ...items.map(row)]))
  }

  search.addEventListener('input', render)
  const el = modal(
    'Central de resume',
    [h('div', { class: 'field-hint' }, 'Sessões recentes do Claude Code nesta máquina, do terminal ou do escritório. "Chamar" traz a sessão de volta como agente, com o histórico.'), search, list],
    [h('button', { class: 'btn', onclick: close }, 'Fechar')],
    close,
  )
  el.classList.add('backdrop-resume')
  root.append(el)
  search.focus()

  window.office
    .listSessions()
    .then((s) => {
      sessions = s
      render()
    })
    .catch((err) => list.replaceChildren(h('div', { class: 'resume-empty' }, cleanError(err))))
}

function dayGroup(t: number): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(new Date()) - day(new Date(t))) / 86400000)
  if (diff <= 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  if (diff < 7) return 'Esta semana'
  return 'Mais antigas'
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function cleanError(err: unknown): string {
  return err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
}

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

const MAX_LOGO_PX = 256

/**
 * Reads an image file into a PNG data URL no bigger than 256 px, plus its most
 * common vivid color. Re-encoding drops anything that is not pixels.
 */
async function readLogo(file: File): Promise<{ logo: string; color: string | null }> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use uma imagem PNG, JPG, WebP ou GIF.')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, MAX_LOGO_PX / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k))
    c.height = Math.max(1, Math.round(img.naturalHeight * k))
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return { logo: c.toDataURL('image/png'), color: vividColor(ctx.getImageData(0, 0, c.width, c.height).data) }
  } catch (err) {
    throw new Error(err instanceof Error && err.message.startsWith('Use') ? err.message : 'Não consegui abrir essa imagem.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The most frequent saturated color (opaque, not near white/black/gray), or null. */
function vividColor(px: Uint8ClampedArray): string | null {
  const counts = new Map<number, number>()
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (a < 200 || max < 40 || min > 225 || max - min < 50) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = -1
  let n = 0
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c]
  if (best < 0) return null
  const ch = (v: number) => ((v << 4) | 8).toString(16).padStart(2, '0')
  return `#${ch(best >> 8)}${ch((best >> 4) & 15)}${ch(best & 15)}`
}

/** Logo, brand color and the uniform toggle of one floor in Configurações. */
function brandFields(p: ProjectFloor, set: (patch: Partial<ProjectFloor>) => void, toast: (t: string, k?: 'info' | 'ok' | 'err') => void): HTMLElement {
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden' }) as HTMLInputElement
  const thumb = h('button', { class: 'floor-brand-logo', type: 'button', title: 'Logo da empresa (placa do andar e farda)' })
  const clear = h('button', { class: 'icon-btn floor-brand-clear', type: 'button', title: 'Tirar o logo' }, icon('x', 12))
  const color = h('input', { type: 'color', class: 'floor-brand-color', value: p.brandColor ?? DEFAULT_BRAND, title: 'Cor da empresa' }) as HTMLInputElement
  const uniform = h('input', { type: 'checkbox' }) as HTMLInputElement
  uniform.checked = !!p.uniform
  const showLogo = (logo: string | undefined) => {
    thumb.replaceChildren(logo ? h('img', { src: logo, alt: '' }) : icon('image', 16))
    clear.classList.toggle('hidden', !logo)
  }
  showLogo(p.logo)
  thumb.addEventListener('click', () => file.click())
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    try {
      const { logo, color: found } = await readLogo(f)
      // the logo's color becomes the brand color until the player picks one
      const patch: Partial<ProjectFloor> = { logo }
      if (found && !p.brandColor) {
        patch.brandColor = found
        color.value = found
      }
      set(patch)
      p = { ...p, ...patch }
      showLogo(logo)
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  })
  clear.addEventListener('click', () => {
    set({ logo: undefined })
    p = { ...p, logo: undefined }
    showLogo(undefined)
  })
  color.addEventListener('input', () => {
    set({ brandColor: color.value })
    p = { ...p, brandColor: color.value }
  })
  uniform.addEventListener('change', () => set({ uniform: uniform.checked }))
  return h(
    'div',
    { class: 'floor-brand-row' },
    h('span', { class: 'floor-brand-logo-wrap' }, thumb, clear),
    file,
    color,
    h('label', { class: 'check' }, uniform, 'Agentes com a farda da empresa'),
  )
}

/**
 * "Novo andar": a project folder becomes a floor. Resolves the floor as saved, or
 * null if the player gave up.
 */
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
    go.addEventListener('click', async () => {
      if (!cwd) return toast('Escolha a pasta do projeto.', 'err')
      if (state.settings.projects.some((x) => x.cwd === cwd)) return toast('Essa pasta já tem um andar.', 'err')
      go.setAttribute('disabled', '')
      try {
        const projects = [...state.settings.projects, { id: `p-${Date.now().toString(36)}`, name: name.value.trim() || floorNameFor(cwd), cwd }]
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
    const el = modal(
      'Novo andar de projeto',
      [
        h('div', { class: 'field-hint' }, 'Todo agente que você contratar ou chamar nesse andar trabalha na pasta do projeto, sem escolher pasta. Agentes de tickets, do resume ou do terminal nessa pasta também sobem para lá.'),
        field('Pasta do projeto', h('div', { class: 'path-row' }, label, pick), hint),
        field('Nome do andar', name),
      ],
      [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'), go],
      () => finish(null),
    )
    root.append(el)
    pick.focus()
  })
}
