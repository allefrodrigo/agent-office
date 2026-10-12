import { HAIR_COLORS, HAIR_STYLES, lookFromSeed, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES } from '@shared/describe'
import { projectFor } from '@shared/projects'
import { renderInstruction, TEMPLATE_LIMITS, TEMPLATE_VARS, templatesFor, ticketRef, usesTicket } from '@shared/templates'
import type { AgentSummary, AgentTemplate, Look, OfficePermissionMode, ProjectFloor, Ticket } from '@shared/types'
import type { State } from '../state'
import { h, icon } from './dom'
import { brainFields, cleanError, confirmDialog, EFFORTS, field, MODELS, modal, MODES } from './modals'
import { portrait } from './portrait'
import './templates.css'

type Toast = (t: string, k?: 'info' | 'ok' | 'err') => void

const BYPASS_CONFIRM = 'Esse agente vai rodar qualquer comando sem perguntar. Continuar?'
const LAST_TEMPLATE = 'agent-office:last-template'

/** "Opus · alto · Editar livremente · Global": what a template does, in one line. */
function templateMeta(t: AgentTemplate, state: State): string {
  const model = MODELS.find((m) => m.value === (t.model ?? ''))?.label ?? t.model ?? ''
  const effort = t.effort ? EFFORTS.find((e) => e.value === t.effort)?.label.toLowerCase() : null
  const mode = MODES.find((m) => m.value === t.permissionMode)?.label ?? t.permissionMode
  const floor = t.floor ? `Andar ${state.settings.projects.find((p) => p.id === t.floor)?.name ?? '?'}` : 'Todos os andares'
  return [model, effort, mode, floor].filter(Boolean).join(' · ')
}

/** Skin, hair, cut, shirt and pants, with a preview and a dice to draw a new one. */
function lookEditor(initial: Look): { el: HTMLElement; value(): Look } {
  const look: Look = { ...initial }
  const preview = h('div', { class: 'look-preview' })
  const rows: (() => void)[] = []
  const repaint = () => {
    preview.replaceChildren(portrait(look, 72))
    rows.forEach((r) => r())
  }
  const swatches = (key: 'skin' | 'hair' | 'shirt' | 'pants', colors: string[]) => {
    const row = h('div', { class: 'swatches' })
    for (const c of colors) {
      const b = h('button', { class: 'swatch', style: `background:${c}`, type: 'button', title: c })
      b.addEventListener('click', () => {
        look[key] = c
        repaint()
      })
      row.append(b)
    }
    rows.push(() => row.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', colors[i] === look[key])))
    return row
  }
  const styles = h('div', { class: 'swatches' })
  for (let i = 0; i < HAIR_STYLES; i++) {
    const b = h('button', { class: 'swatch swatch-style', type: 'button' }, String(i + 1))
    b.addEventListener('click', () => {
      look.hairStyle = i
      repaint()
    })
    styles.append(b)
  }
  rows.push(() => styles.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === look.hairStyle)))
  const dice = h('button', { class: 'btn btn-small', type: 'button', title: 'Sortear outra aparência' }, icon('reset', 13), 'Sortear')
  dice.addEventListener('click', () => {
    Object.assign(look, lookFromSeed(String(Math.random())))
    repaint()
  })
  const el = h(
    'div',
    { class: 'look-editor tpl-look' },
    h('div', { class: 'tpl-look-side' }, preview, dice),
    h(
      'div',
      { class: 'look-fields' },
      field('Pele', swatches('skin', SKIN_TONES)),
      field('Cabelo', swatches('hair', HAIR_COLORS)),
      field('Corte', styles),
      field('Camiseta', swatches('shirt', SHIRT_COLORS)),
      field('Calça', swatches('pants', PANTS_COLORS)),
    ),
  )
  repaint()
  return { el, value: () => ({ ...look }) }
}

/**
 * Create or edit a template in its own dialog, above whatever is open. `initial.id`
 * set = edit that one. Resolves the template as stored, or null if the player gave up.
 */
export function openTemplateEditor(root: HTMLElement, state: State, initial: Partial<AgentTemplate>, toast: Toast): Promise<AgentTemplate | null> {
  return new Promise((resolve) => {
    const editing = !!initial.id && state.settings.templates?.some((t) => t.id === initial.id)
    const name = h('input', { class: 'input', value: initial.name ?? '', maxlength: TEMPLATE_LIMITS.name, placeholder: 'Ex.: Revisor de PR' })
    const look = lookEditor(initial.look ?? lookFromSeed(initial.name || String(Math.random())))
    const brain = brainFields({ model: initial.model ?? '', effort: initial.effort ?? '' }, true)
    const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label)))
    mode.value = initial.permissionMode ?? state.settings.defaultPermissionMode
    const modeHint = h('span', {})
    const syncMode = () => {
      const m = MODES.find((x) => x.value === mode.value)!
      modeHint.textContent = m.hint
      modeHint.className = m.value === 'bypassPermissions' ? 'warn' : ''
    }
    mode.addEventListener('change', syncMode)
    syncMode()
    const instruction = h('textarea', {
      class: 'input',
      rows: 5,
      maxlength: TEMPLATE_LIMITS.instruction,
      placeholder: `Ex.: Revise o ticket ${TEMPLATE_VARS.ticket} em ${TEMPLATE_VARS.folder}: rode os testes e aponte o que quebrar.`,
    })
    instruction.value = initial.instruction ?? ''
    const floor = h(
      'select',
      { class: 'input' },
      h('option', { value: '' }, 'Todos os andares'),
      ...state.settings.projects.map((p) => h('option', { value: p.id }, `Só no andar ${p.name}`)),
    )
    floor.value = initial.floor && state.settings.projects.some((p) => p.id === initial.floor) ? initial.floor : ''

    let done = false
    const finish = (v: AgentTemplate | null) => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }
    const save = h('button', { class: 'btn btn-primary' }, icon('check', 15), 'Salvar modelo')
    save.addEventListener('click', async () => {
      if (!name.value.trim()) return toast('Dê um nome ao modelo.', 'err')
      const b = brain.value()
      const draft: AgentTemplate = {
        id: editing ? initial.id! : '',
        name: name.value.trim(),
        look: look.value(),
        permissionMode: mode.value as OfficePermissionMode,
        instruction: instruction.value.trim(),
        ...(b.model ? { model: b.model } : {}),
        ...(b.effort ? { effort: b.effort } : {}),
        ...(floor.value ? { floor: floor.value } : {}),
      }
      save.setAttribute('disabled', '')
      try {
        const stored = await window.office.saveTemplate(draft)
        toast(editing ? `Modelo ${stored.name} atualizado.` : `Modelo ${stored.name} salvo.`, 'ok')
        finish(stored)
      } catch (err) {
        toast(cleanError(err), 'err')
        save.removeAttribute('disabled')
      }
    })
    const el = modal(
      editing ? `Editar modelo · ${initial.name}` : 'Novo modelo',
      [
        field('Nome do agente', name, 'Quem você contratar por este modelo chega com esse nome.'),
        look.el,
        h('div', { class: 'field-row' }, field('Modelo', brain.model, brain.hint), field('Andar', floor, 'Num andar só, ou em todos.')),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Esforço'), brain.meter),
        field('Permissões', mode, modeHint),
        field(
          'Instrução base',
          instruction,
          `${TEMPLATE_VARS.folder} vira a pasta do projeto e ${TEMPLATE_VARS.ticket} o ticket escolhido na hora. Com instrução, o agente já chega trabalhando; sem ela, você digita a tarefa.`,
        ),
      ],
      [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'), save],
      () => finish(null),
    )
    el.classList.add('backdrop-confirm')
    root.append(el)
    name.focus()
  })
}

/** "Salvar como modelo" in the agent panel: the agent's name, looks, brain, freedom and first task. */
export function saveAgentAsTemplate(root: HTMLElement, state: State, a: AgentSummary, toast: Toast): Promise<AgentTemplate | null> {
  const first = state.logs.get(a.id)?.find((e) => e.kind === 'user')?.text ?? ''
  return openTemplateEditor(
    root,
    state,
    {
      name: a.name,
      look: a.look,
      model: a.model,
      effort: a.effort,
      permissionMode: a.permissionMode,
      // the folder becomes {pasta}, so the template works in other projects too
      instruction: first.split(a.cwd).join(TEMPLATE_VARS.folder).slice(0, TEMPLATE_LIMITS.instruction),
      floor: a.project,
    },
    toast,
  )
}

/** Open tickets of this floor (null = ground floor), most recently touched first. */
function floorTickets(state: State, project: ProjectFloor | null | undefined): Ticket[] {
  return [...state.tickets.values()]
    .filter((t) => !t.closedAt && t.status !== 'done' && (projectFor(state.settings.projects, t.cwd ?? '')?.id ?? null) === (project?.id ?? null))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** A free name: the template's, or "Revisor 2", "Revisor 3"… if someone already has it. */
function freeName(state: State, base: string): string {
  const used = new Set([...state.agents.values()].map((a) => a.name))
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`
}

export interface TemplatesTab {
  el: HTMLElement
  focus(): void
  /** Hires from the picked template. Resolves true when the agent is on its way. */
  submit(): Promise<boolean>
}

/**
 * The "Modelos" tab of Novo agente: pick a saved template, add the task (or nothing,
 * if the template has a brief) and hire. Creating, editing and deleting templates
 * happen here too. The folder and account rows stay the dialog's own.
 */
export function templatesTab(
  root: HTMLElement,
  state: State,
  project: ProjectFloor | null | undefined,
  ctx: { toast: Toast; cwd(): string; ensureFolder(): Promise<boolean>; accounts(): string[] | undefined },
): TemplatesTab {
  const { toast } = ctx
  let selected = localStorage.getItem(LAST_TEMPLATE) ?? ''
  const list = h('div', { class: 'tpl-list', role: 'listbox', 'aria-label': 'Modelos' })
  const ticket = h('select', { class: 'input' }) as HTMLSelectElement
  const ticketField = field('Ticket', ticket, `Entra no lugar de ${TEMPLATE_VARS.ticket} na instrução.`)
  const task = h('textarea', { class: 'input', rows: 3 })
  const taskLabel = h('span', { class: 'field-label' })
  const taskField = h('label', { class: 'field' }, taskLabel, task)
  const preview = h('div', { class: 'tpl-preview' })
  const add = h('button', { class: 'btn btn-small', type: 'button' }, icon('plus', 13), 'Novo modelo')

  const visible = () => templatesFor(state.settings.templates, project?.id)
  const current = () => visible().find((t) => t.id === selected)

  const fillTickets = () => {
    const prev = ticket.value
    const tickets = floorTickets(state, project)
    ticket.replaceChildren(
      h('option', { value: '' }, tickets.length ? 'Escolha o ticket…' : 'Nenhum ticket aberto neste andar'),
      ...tickets.map((t) => h('option', { value: t.id }, `${t.key} · ${t.title}`)),
    )
    if (tickets.some((t) => t.id === prev)) ticket.value = prev
  }

  /** The brief as the agent will get it, or '' while something is missing. */
  const brief = (t: AgentTemplate): string => {
    const tk = state.tickets.get(ticket.value)
    const base = t.instruction ? renderInstruction(t.instruction, { folder: ctx.cwd() || TEMPLATE_VARS.folder, ticket: tk ? ticketRef(tk) : TEMPLATE_VARS.ticket }) : ''
    const extra = task.value.trim()
    return [base, extra].filter(Boolean).join('\n\n')
  }

  const syncDetail = () => {
    const t = current()
    taskField.classList.toggle('hidden', !t)
    ticketField.classList.toggle('hidden', !t || !usesTicket(t.instruction))
    preview.classList.toggle('hidden', !t || !t.instruction)
    if (!t) return
    taskLabel.textContent = t.instruction ? 'Complemento (opcional)' : 'Tarefa'
    task.placeholder = t.instruction ? 'Algo a mais para esta vez. Pode deixar vazio.' : 'Este modelo não tem instrução base: descreva a tarefa.'
    preview.textContent = t.instruction ? brief(t) : ''
  }

  const edit = async (t?: AgentTemplate) => {
    const stored = await openTemplateEditor(root, state, t ?? { floor: project?.id }, toast)
    if (!stored) return
    // the settings event follows; mirror it now so the list is right at once
    const all = state.settings.templates ?? []
    state.settings.templates = all.some((x) => x.id === stored.id) ? all.map((x) => (x.id === stored.id ? stored : x)) : [...all, stored]
    select(stored.id)
  }
  const remove = async (t: AgentTemplate) => {
    const ok = await confirmDialog(root, { title: 'Apagar modelo', text: `Apagar o modelo ${t.name}? Quem já foi contratado por ele continua no escritório.`, confirm: 'Apagar', cancel: 'Cancelar', danger: true })
    if (!ok) return
    try {
      await window.office.deleteTemplate(t.id)
      state.settings.templates = (state.settings.templates ?? []).filter((x) => x.id !== t.id)
      render()
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  const select = (id: string) => {
    selected = id
    localStorage.setItem(LAST_TEMPLATE, id)
    render()
  }

  const render = () => {
    const items = visible()
    if (!items.some((t) => t.id === selected)) selected = items[0]?.id ?? ''
    list.replaceChildren(
      ...(items.length
        ? items.map((t) => {
            const row = h(
              'div',
              { class: `tpl-item${t.id === selected ? ' on' : ''}`, role: 'option', tabindex: 0, 'aria-selected': String(t.id === selected) },
              portrait(t.look ?? lookFromSeed(t.name), 34),
              h(
                'div',
                { class: 'tpl-item-main' },
                h('div', { class: 'tpl-item-name' }, t.name, t.permissionMode === 'bypassPermissions' ? h('span', { class: 'tpl-danger', title: 'Roda qualquer comando sem perguntar' }, 'sem pedir nada') : null),
                h('div', { class: 'tpl-item-meta' }, templateMeta(t, state)),
                h('div', { class: 'tpl-item-brief' }, t.instruction ? t.instruction.slice(0, 140) : 'Sem instrução base: pede a tarefa.'),
              ),
              h('button', { class: 'icon-btn', type: 'button', title: 'Editar modelo', onclick: (e: Event) => (e.stopPropagation(), void edit(t)) }, icon('edit', 15)),
              h('button', { class: 'icon-btn', type: 'button', title: 'Apagar modelo', onclick: (e: Event) => (e.stopPropagation(), void remove(t)) }, icon('trash', 15)),
            )
            row.addEventListener('click', () => select(t.id))
            row.addEventListener('keydown', (e) => {
              if (e.key === ' ' && e.target === row) {
                e.preventDefault()
                select(t.id)
              }
            })
            return row
          })
        : [h('div', { class: 'tpl-empty' }, 'Nenhum modelo ainda. Salve as escolhas de sempre (nome, modelo, permissões, instrução) e contrate com um clique.')]),
    )
    fillTickets()
    syncDetail()
  }

  add.addEventListener('click', () => void edit())
  ticket.addEventListener('change', syncDetail)
  task.addEventListener('input', syncDetail)

  const el = h(
    'div',
    { class: 'tpl-tab' },
    h('div', { class: 'tpl-head' }, h('span', { class: 'field-label' }, 'Modelos'), add),
    list,
    ticketField,
    taskField,
    preview,
  )
  render()

  return {
    el,
    focus: () => {
      const t = current()
      if (t && !t.instruction) task.focus()
      else (list.querySelector('.tpl-item.on') as HTMLElement | null)?.focus()
    },
    submit: async () => {
      // re-render first: the folder may have changed since the preview
      render()
      const t = current()
      if (!t) {
        toast('Escolha ou crie um modelo.', 'err')
        return false
      }
      if (!(await ctx.ensureFolder())) return false
      const cwd = ctx.cwd()
      if (usesTicket(t.instruction) && !state.tickets.get(ticket.value)) {
        toast('Escolha o ticket para este modelo.', 'err')
        return false
      }
      const text = brief(t)
      if (!text) {
        toast('Descreva a tarefa.', 'err')
        task.focus()
        return false
      }
      // Same guard as the other tabs: a saved template never skips it.
      if (t.permissionMode === 'bypassPermissions' && !confirm(BYPASS_CONFIRM)) return false
      try {
        const a = await window.office.hire({
          name: freeName(state, t.name),
          cwd,
          task: text,
          model: t.model,
          effort: t.effort,
          accounts: ctx.accounts(),
          permissionMode: t.permissionMode,
          look: t.look,
        })
        toast(`${a.name} está subindo pelo elevador.`, 'ok')
        return true
      } catch (err) {
        toast(cleanError(err), 'err')
        return false
      }
    },
  }
}
