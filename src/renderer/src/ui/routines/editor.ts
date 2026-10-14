import { describeSchedule, formatWhen, isPast, MIN_INTERVAL_MIN, nextRuns, scheduleError } from '@shared/schedule'
import { ROUTINE_LIMITS } from '@shared/types'
import type { OfficePermissionMode, ProjectFloor, Routine, RoutineDraft, RoutineWho, Schedule } from '@shared/types'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { brainFields, meterField, MODES } from '../modals/brain'
import { field, LAST_CWD } from '../modals/common'

// The routine form: who runs it, where, when (with a live sentence and the next 3 runs).

/** Two ready-made routines for the empty list: a click fills the form. */
export const EXAMPLES: { title: string; hint: string; draft: Partial<RoutineDraft> }[] = [
  {
    title: 'Relatório diário',
    hint: 'Todo dia às 09:00, um resumo do que mudou no repositório.',
    draft: {
      name: 'Relatório diário',
      prompt: 'Resuma o que mudou no repositório desde ontem: commits, PRs abertos e testes falhando. Entregue em tópicos curtos, com o mais importante primeiro.',
      schedule: { kind: 'daily', time: '09:00' },
    },
  },
  {
    title: 'Revisar dependências',
    hint: 'Toda segunda às 10:00, o que atualizar primeiro. Sem mexer em arquivos.',
    draft: {
      name: 'Revisar dependências',
      prompt: 'Liste as dependências desatualizadas ou com falhas de segurança conhecidas (npm outdated, npm audit) e diga quais atualizar primeiro e por quê. Não altere arquivos.',
      schedule: { kind: 'weekly', days: [1], time: '10:00' },
    },
  },
]

type Preset = Schedule['kind']
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'daily', label: 'Todo dia' },
  { value: 'weekly', label: 'Dias da semana' },
  { value: 'interval', label: 'A cada N horas ou minutos' },
  { value: 'once', label: 'Uma vez' },
  { value: 'cron', label: 'Avançado (cron)' },
]
/** Monday first, as the week reads. */
const WEEK: [number, string][] = [
  [1, 'Seg'],
  [2, 'Ter'],
  [3, 'Qua'],
  [4, 'Qui'],
  [5, 'Sex'],
  [6, 'Sáb'],
  [0, 'Dom'],
]
const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The schedule part of the form: preset, its fields, and the preview below. */
function scheduleFields(initial: Schedule | undefined): { el: HTMLElement; value(): Schedule; error(): string | null } {
  const preset = h('select', { class: 'input', 'aria-label': 'Tipo de agenda' }, ...PRESETS.map((p) => h('option', { value: p.value }, p.label))) as HTMLSelectElement
  preset.value = initial?.kind ?? 'daily'
  const time = h('input', { class: 'input rt-time', type: 'time', value: '09:00', 'aria-label': 'Horário' }) as HTMLInputElement
  const tomorrow = new Date(Date.now() + 86_400_000)
  const date = h('input', { class: 'input rt-date', type: 'date', value: localDate(tomorrow), 'aria-label': 'Data' }) as HTMLInputElement
  const days = WEEK.map(([d, label]) => {
    const box = h('input', { type: 'checkbox', value: String(d) }) as HTMLInputElement
    box.checked = d >= 1 && d <= 5
    return { d, box, el: h('label', { class: 'rt-day' }, box, h('span', {}, label)) }
  })
  const every = h('input', { class: 'input rt-every', type: 'number', min: 1, step: 1, value: 2, 'aria-label': 'A cada' }) as HTMLInputElement
  const unit = h('select', { class: 'input rt-unit', 'aria-label': 'Unidade' }, h('option', { value: 'hours' }, 'horas'), h('option', { value: 'minutes' }, 'minutos')) as HTMLSelectElement
  const cron = h('input', { class: 'input rt-cron', placeholder: '0 9 * * 1-5', spellcheck: 'false', 'aria-label': 'Expressão cron' }) as HTMLInputElement
  let anchor: number | undefined

  if (initial?.kind === 'daily' || initial?.kind === 'weekly') time.value = initial.time
  if (initial?.kind === 'weekly') for (const x of days) x.box.checked = initial.days.includes(x.d)
  if (initial?.kind === 'once') [date.value, time.value] = initial.at.split('T')
  if (initial?.kind === 'interval') {
    every.value = String(initial.every)
    unit.value = initial.unit
    anchor = initial.anchor
  }
  if (initial?.kind === 'cron') cron.value = initial.expr

  const rows: Record<Preset, HTMLElement> = {
    daily: h('div', { class: 'rt-row' }, h('span', {}, 'às'), time),
    weekly: h('div', { class: 'rt-row rt-wrap' }, h('div', { class: 'rt-days', role: 'group', 'aria-label': 'Dias da semana' }, ...days.map((x) => x.el)), h('span', {}, 'às')),
    interval: h('div', { class: 'rt-row' }, h('span', {}, 'a cada'), every, unit),
    once: h('div', { class: 'rt-row' }, h('span', {}, 'em'), date, h('span', {}, 'às')),
    cron: h('div', { class: 'rt-col' }, cron, h('span', { class: 'field-hint' }, 'Cinco campos: minuto hora dia mês dia-da-semana. Ex.: 0 9 * * 1-5 (dias úteis às 09:00), */30 8-18 * * * (a cada 30 min, das 8h às 18h).')),
  }
  const slot = h('div', { class: 'rt-schedule' })
  const sentence = h('div', { class: 'rt-sentence' })
  const upcoming = h('ul', { class: 'rt-next', 'aria-label': 'Próximas execuções' })
  const problem = h('div', { class: 'rt-error hidden', role: 'alert' })
  const nextLabel = h('div', { class: 'rt-next-label' }, 'Próximas 3 execuções')

  const value = (): Schedule => {
    switch (preset.value as Preset) {
      case 'daily':
        return { kind: 'daily', time: time.value }
      case 'weekly':
        return { kind: 'weekly', days: days.filter((x) => x.box.checked).map((x) => x.d), time: time.value }
      case 'interval':
        return { kind: 'interval', every: Number(every.value), unit: unit.value as 'hours' | 'minutes', ...(anchor !== undefined ? { anchor } : {}) }
      case 'once':
        return { kind: 'once', at: `${date.value}T${time.value}` }
      case 'cron':
        return { kind: 'cron', expr: cron.value }
    }
  }
  const error = (): string | null => {
    const s = value()
    if (s.kind === 'cron' && !s.expr.trim()) return 'Escreva a expressão cron, por exemplo 0 9 * * 1-5.'
    return scheduleError(s) ?? (isPast(s) && s.kind === 'once' && (initial?.kind !== 'once' || initial.at !== s.at) ? 'Esse horário já passou. Escolha uma data no futuro.' : null)
  }
  const preview = () => {
    const kind = preset.value as Preset
    // the time field moves to the row of the preset that uses it
    if (kind === 'daily') rows.daily.append(time)
    if (kind === 'weekly') rows.weekly.append(time)
    if (kind === 'once') rows.once.append(time)
    slot.replaceChildren(rows[kind])
    every.min = unit.value === 'minutes' ? String(MIN_INTERVAL_MIN) : '1'
    const s = value()
    const err = error()
    problem.textContent = err ?? ''
    problem.classList.toggle('hidden', !err)
    nextLabel.classList.toggle('hidden', !!err)
    if (err) {
      sentence.textContent = ''
      upcoming.replaceChildren()
      return
    }
    // a new interval counts from the moment it is saved
    const shown: Schedule = s.kind === 'interval' && s.anchor === undefined ? { ...s, anchor: Math.floor(Date.now() / 60_000) * 60_000 } : s
    const next = nextRuns(shown, Date.now(), 3)
    sentence.textContent = describeSchedule(shown)
    upcoming.replaceChildren(...(next.length ? next.map((t) => h('li', {}, formatWhen(t))) : [h('li', {}, 'Nenhuma execução pela frente.')]))
  }
  for (const el of [preset, time, date, every, unit, cron, ...days.map((x) => x.box)]) {
    el.addEventListener('input', preview)
    el.addEventListener('change', preview)
  }
  preview()
  const el = h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, 'Quando'),
    h('div', { class: 'rt-row rt-wrap' }, preset, slot),
    h('div', { class: 'rt-preview', 'aria-live': 'polite' }, sentence, problem, nextLabel, upcoming),
  )
  return { el, value, error }
}

/**
 * The routine form, inside the Rotinas window. `initial` is a routine to edit, an example
 * or nothing. Resolves the saved routine through `onSaved`; `onCancel` goes back.
 */
export function routineEditor(
  state: State,
  initial: Partial<Routine> | undefined,
  opts: { project: ProjectFloor | null | undefined; onSaved: (r: Routine) => void; onCancel: () => void; toast: (t: string, k?: 'info' | 'ok' | 'err') => void; confirmBypass: () => Promise<boolean> },
): { body: HTMLElement; foot: HTMLElement[]; focus(): void } {
  const name = h('input', { class: 'input', maxlength: ROUTINE_LIMITS.name, placeholder: 'Relatório diário', value: initial?.name ?? '' }) as HTMLInputElement
  const prompt = h('textarea', { class: 'input', rows: 4, maxlength: ROUTINE_LIMITS.prompt, placeholder: 'O que o agente faz em cada execução.' }) as HTMLTextAreaElement
  prompt.value = initial?.prompt ?? ''

  // ---------- who ----------
  const who: RoutineWho = initial?.who ?? { kind: 'new' }
  const kind = h(
    'select',
    { class: 'input', 'aria-label': 'Quem roda' },
    h('option', { value: 'new' }, 'Um agente novo'),
    h('option', { value: 'template' }, 'Um modelo salvo'),
    h('option', { value: 'agent' }, 'Um agente do escritório'),
  ) as HTMLSelectElement
  kind.value = who.kind
  const newName = h('input', { class: 'input', maxlength: 40, placeholder: 'Nome (opcional)', value: who.kind === 'new' ? (who.name ?? '') : '' }) as HTMLInputElement
  const brain = brainFields({ model: who.kind === 'new' ? (who.model ?? '') : '', effort: who.kind === 'new' ? (who.effort ?? '') : '' }, true)
  const templates = state.settings.templates ?? []
  const template = h(
    'select',
    { class: 'input', 'aria-label': 'Modelo salvo' },
    ...(templates.length ? templates.map((t) => h('option', { value: t.id }, t.name)) : [h('option', { value: '' }, 'Nenhum modelo salvo (crie em Novo agente › Modelos)')]),
  ) as HTMLSelectElement
  if (who.kind === 'template') template.value = who.templateId
  const agents = [...state.agents.values()].filter((a) => a.source === 'office' && a.role !== 'orchestrator')
  const agent = h(
    'select',
    { class: 'input', 'aria-label': 'Agente' },
    ...(agents.length ? agents.map((a) => h('option', { value: a.id }, `${a.name} · …/${a.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/')}`)) : [h('option', { value: '' }, 'Nenhum agente do escritório agora')]),
  ) as HTMLSelectElement
  if (who.kind === 'agent') agent.value = who.agentId
  const whoNew = h('div', { class: 'rt-col' }, newName, field('Modelo', brain.model, brain.hint), meterField('Esforço', brain.meter))
  const whoHint = h('span', { class: 'field-hint' })

  // ---------- where ----------
  const floors = state.settings.projects
  const where = h(
    'select',
    { class: 'input', 'aria-label': 'Onde roda' },
    h('option', { value: '' }, 'Uma pasta'),
    ...floors.map((p) => h('option', { value: p.id }, `Andar ${p.name}`)),
  ) as HTMLSelectElement
  where.value = initial?.floor ?? (!initial?.cwd && opts.project ? opts.project.id : '')
  let cwd = initial?.cwd ?? localStorage.getItem(LAST_CWD) ?? ''
  const pathLabel = h('span', { class: 'path-label' }, cwd || 'Nenhuma pasta escolhida')
  const pick = h('button', { class: 'btn', type: 'button' }, icon('folder', 15), 'Escolher…')
  pick.addEventListener('click', async () => {
    const p = await window.office.pickFolder(cwd || undefined)
    if (!p) return
    cwd = p
    pathLabel.textContent = p
  })
  const pathRow = h('div', { class: 'path-row' }, pathLabel, pick)
  const whereField = field('Onde', h('div', { class: 'rt-col' }, where, pathRow), 'O agente que a rotina contratar trabalha aqui.')

  // ---------- freedom ----------
  const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label))) as HTMLSelectElement
  // "Pedir permissão" unless the routine already says otherwise: never "Sem pedir nada" by default.
  mode.value = initial?.permissionMode ?? 'default'
  const modeHint = h('span', {})
  const modeField = field('Permissões', mode, modeHint)

  const syncWho = () => {
    const k = kind.value as RoutineWho['kind']
    whoNew.classList.toggle('hidden', k !== 'new')
    template.classList.toggle('hidden', k !== 'template')
    agent.classList.toggle('hidden', k !== 'agent')
    whereField.classList.toggle('hidden', k === 'agent')
    modeField.classList.toggle('hidden', k === 'agent')
    pathRow.classList.toggle('hidden', !!where.value)
    whoHint.textContent =
      k === 'agent'
        ? 'A tarefa chega na conversa atual dele, na pasta e com as permissões dele. Se estiver ocupado na hora, a execução é pulada.'
        : 'Contratado na primeira execução e reaproveitado nas seguintes, cada vez com a conversa limpa. Se estiver ocupado na hora, a execução é pulada.'
    const m = MODES.find((x) => x.value === mode.value)!
    modeHint.textContent = m.hint
    modeHint.classList.toggle('rt-danger', m.value === 'bypassPermissions')
  }
  for (const el of [kind, where, mode]) el.addEventListener('change', syncWho)
  syncWho()

  // ---------- when ----------
  const sched = scheduleFields(initial?.schedule)
  const missedRun = h('input', { type: 'radio', name: 'rt-missed', value: 'run' }) as HTMLInputElement
  const missedSkip = h('input', { type: 'radio', name: 'rt-missed', value: 'skip' }) as HTMLInputElement
  ;(initial?.missed === 'skip' ? missedSkip : missedRun).checked = true
  const missed = h(
    'div',
    { class: 'field', role: 'radiogroup', 'aria-label': 'Se o app estiver fechado no horário' },
    h('span', { class: 'field-label' }, 'Se o app estiver fechado no horário'),
    h('label', { class: 'check' }, missedRun, 'Rodar uma vez ao abrir'),
    h('label', { class: 'check' }, missedSkip, 'Pular e registrar como perdida'),
  )
  const enabled = h('input', { type: 'checkbox' }) as HTMLInputElement
  enabled.checked = initial?.enabled ?? true

  const draft = (): RoutineDraft => {
    const k = kind.value as RoutineWho['kind']
    const b = brain.value()
    const w: RoutineWho =
      k === 'agent'
        ? { kind: 'agent', agentId: agent.value }
        : k === 'template'
          ? { kind: 'template', templateId: template.value }
          : { kind: 'new', ...(newName.value.trim() ? { name: newName.value.trim() } : {}), ...(b.model ? { model: b.model } : {}), ...(b.effort ? { effort: b.effort } : {}) }
    return {
      ...(initial?.id ? { id: initial.id } : {}),
      name: name.value,
      prompt: prompt.value,
      who: w,
      ...(k !== 'agent' ? (where.value ? { floor: where.value } : cwd ? { cwd } : {}) : {}),
      permissionMode: mode.value as OfficePermissionMode,
      schedule: sched.value(),
      enabled: enabled.checked,
      missed: missedSkip.checked ? 'skip' : 'run',
    }
  }

  const save = h('button', { class: 'btn btn-primary' }, initial?.id ? 'Salvar' : 'Criar rotina')
  save.addEventListener('click', async () => {
    const err = sched.error()
    if (err) return opts.toast(err, 'err')
    const d = draft()
    if (d.permissionMode === 'bypassPermissions' && d.who.kind !== 'agent' && !(await opts.confirmBypass())) return
    save.setAttribute('disabled', '')
    try {
      const r = await window.office.saveRoutine(d)
      if (d.cwd) localStorage.setItem(LAST_CWD, d.cwd)
      opts.onSaved(r)
    } catch (e) {
      opts.toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), 'err')
    } finally {
      save.removeAttribute('disabled')
    }
  })

  const body = h(
    'div',
    { class: 'rt-form' },
    field('Nome', name),
    field('Tarefa', prompt, 'Cada execução chega ao agente com um cabeçalho: a rotina e a data. O resultado vem até a sua sala.'),
    field('Quem roda', h('div', { class: 'rt-col' }, kind, whoNew, template, agent), whoHint),
    whereField,
    modeField,
    sched.el,
    missed,
    h('label', { class: 'check' }, enabled, 'Ativa (desmarque para salvar pausada)'),
  )
  return { body, foot: [h('button', { class: 'btn', onclick: opts.onCancel }, 'Voltar'), save], focus: () => name.focus() }
}
