import { describeMacJob, macJobState } from '@shared/mac-jobs'
import { lastFinished } from '@shared/routines'
import { countdown, describeSchedule, formatWhen, nextRuns } from '@shared/schedule'
import { RUN_STATUS_LABEL } from '@shared/types'
import type { MacJob, ProjectFloor, Routine, RoutineRun } from '@shared/types'
import type { State } from '../../state'
import { arrowList, keepFocus } from '../a11y'
import { h, icon } from '../dom'
import { cleanError, confirmDialog, modal } from '../modals/common'
import { MODES } from '../modals/brain'
import { EXAMPLES, routineEditor } from './editor'
import './routines.css'

// "Rotinas": the totem's window. A list, one routine's history, and the form.

export interface RoutinesHooks {
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  /** Opens the agent's panel and points the camera at it. */
  openAgent(agentId: string): void
  /** Opens a result card still waiting in the room. */
  openResult(agentId: string, resultId: string): void
  /** The floor on screen: a new routine runs there by default. */
  project(): ProjectFloor | null | undefined
}

const CHIP: Record<RoutineRun['status'], string> = {
  ok: 'chip-done',
  failed: 'chip-err',
  waiting: 'chip-wait',
  running: 'chip-run',
  missed: 'chip-muted',
  skipped: 'chip-muted',
}
const usd = (n: number) => `$${n.toFixed(2)}`
const duration = (run: RoutineRun) => {
  if (!run.endedAt || run.status === 'missed' || run.status === 'skipped') return ''
  const s = Math.round((run.endedAt - run.startedAt) / 1000)
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`
}

function statusChip(run: RoutineRun | undefined): HTMLElement | null {
  if (!run) return h('span', { class: 'chip chip-muted' }, 'nunca rodou')
  return h('span', { class: `chip ${CHIP[run.status]}` }, RUN_STATUS_LABEL[run.status])
}

/** "Próxima: amanhã, 09:00 (em 14h02)", or why there is none. */
function nextText(r: Routine, now = Date.now()): string {
  if (!r.enabled) return 'Pausada'
  if (r.nextAt === null) return 'Sem próxima execução'
  return `Próxima: ${formatWhen(r.nextAt, now)} (${countdown(r.nextAt, now)})`
}

const MAC_CHIP: Record<ReturnType<typeof macJobState>, [string, string]> = {
  ok: ['chip-done', 'rodou'],
  fail: ['chip-err', 'falhou'],
  run: ['chip-run', 'rodando'],
  none: ['chip-muted', 'nunca rodou'],
  off: ['chip-muted', 'não carregado'],
}

function macChip(j: MacJob): HTMLElement {
  const st = macJobState(j)
  const [cls, text] = MAC_CHIP[st]
  return h('span', { class: `chip ${cls}`, title: j.lastExit !== null ? `Código de saída da última vez: ${j.lastExit}` : '' }, st === 'fail' ? `${text} (código ${j.lastExit})` : text)
}

/** "Próxima: hoje, 13:00 (em 2h14)"; interval jobs only know it from the log. */
function macNextText(j: MacJob, now = Date.now()): string {
  if (!j.loaded) return 'Não carregado no launchd: não roda'
  if (j.nextAt !== null) return `Próxima: ${formatWhen(j.nextAt, now)} (${countdown(j.nextAt, now)})`
  return j.lastLogAt ? `Último registro no log: ${formatWhen(j.lastLogAt, now)}` : 'Sem próxima execução conhecida'
}

/** Who runs it, in a few words. */
function whoText(state: State, r: Routine): string {
  const who = r.who
  const agentId = who.kind === 'agent' ? who.agentId : r.agentId
  const a = agentId ? state.agents.get(agentId) : undefined
  const where = r.floor ? `andar ${state.settings.projects.find((p) => p.id === r.floor)?.name ?? '(removido)'}` : r.cwd ? `…/${r.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/')}` : ''
  const mode = MODES.find((m) => m.value === r.permissionMode)?.label ?? ''
  if (who.kind === 'agent') return a ? `${a.name}, na conversa atual dele` : 'Um agente que saiu do escritório'
  const base = who.kind === 'template' ? `Modelo ${state.settings.templates.find((t) => t.id === who.templateId)?.name ?? '(apagado)'}` : 'Agente próprio'
  return `${base}${a ? ` (${a.name})` : ''} em ${where} · ${mode}`
}

/**
 * Opens the Rotinas window. The list refreshes as runs move along; the countdowns tick
 * every second without redrawing the rows.
 */
export function openRoutines(root: HTMLElement, state: State, hooks: RoutinesHooks): void {
  const content = h('div', { class: 'rt-body' })
  const foot = h('div', { class: 'rt-foot' })
  let view: { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'mac'; label: string } | { kind: 'edit' } = { kind: 'list' }
  let stopped = false
  const close = () => {
    stopped = true
    clearInterval(ticker)
    off()
    el.remove()
  }
  const el = modal('Rotinas', [content], [foot], close)
  el.classList.add('backdrop-routines')
  const title = el.querySelector<HTMLElement>('.modal-title')!

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) hooks.toast(ok, 'ok')
    } catch (err) {
      hooks.toast(cleanError(err), 'err')
    }
  }
  const runNow = (r: Routine) =>
    act(async () => {
      const after = await window.office.runRoutineNow(r.id)
      const run = after.history[0]
      if (run?.status === 'failed' || run?.status === 'skipped') hooks.toast(`${r.name}: ${run.error ?? RUN_STATUS_LABEL[run.status]}`, 'err')
      else hooks.toast(`${r.name} começou a rodar. O resultado vem até a sua sala.`, 'ok')
    })
  const toggle = (r: Routine) => act(() => window.office.setRoutineEnabled(r.id, !r.enabled), r.enabled ? `${r.name} pausada.` : `${r.name} retomada.`)
  const duplicate = (r: Routine) => act(() => window.office.duplicateRoutine(r.id), `Cópia de ${r.name} criada, pausada. Edite e ative quando quiser.`)
  const remove = async (r: Routine) => {
    const yes = await confirmDialog(root, {
      title: `Apagar ${r.name}?`,
      text: 'A rotina e o histórico dela somem. O agente que ela contratou continua no escritório.',
      confirm: 'Apagar',
      cancel: 'Cancelar',
      danger: true,
    })
    if (!yes) return
    await act(() => window.office.deleteRoutine(r.id), `${r.name} apagada.`)
    if (view.kind === 'detail' && view.id === r.id) show({ kind: 'list' })
  }

  // ---------- the Mac's own jobs (launchd): shown and started, never changed ----------
  const runMac = (j: MacJob) =>
    act(async () => {
      state.macJobs = await window.office.runMacJobNow(j.label)
      hooks.toast(`${j.name} começou a rodar pelo launchd.`, 'ok')
      if (view.kind !== 'edit') show(view)
    })
  const openMacLog = (j: MacJob) => act(() => window.office.openMacJobLog(j.label))
  const macActions = (j: MacJob, labels: boolean): HTMLElement[] => {
    const btn = (label: string, ic: string, fn: () => void, disabled = false) =>
      h('button', { class: 'btn btn-small', type: 'button', title: label, 'aria-label': `${label}: ${j.name}`, disabled, onclick: (e: Event) => (e.stopPropagation(), fn()) }, icon(ic, 14), labels ? label : null)
    return [btn('Rodar agora', 'send', () => void runMac(j), !j.loaded || j.running), btn('Abrir log', 'file', () => void openMacLog(j), !j.log)]
  }
  const macSection = (): HTMLElement | null => {
    if (!state.macJobs.length) return null
    const rows = state.macJobs.map((j) => {
      const st = macJobState(j)
      const led = st === 'off' ? 'none' : st
      return h(
        'div',
        { class: `rt-item${j.loaded ? '' : ' rt-paused'}`, 'data-focus-key': `mac:${j.label}` },
        h(
          'button',
          { class: 'rt-item-main', type: 'button', 'data-focus-key': `open-mac:${j.label}`, onclick: () => show({ kind: 'mac', label: j.label }) },
          h('span', { class: `rt-led rt-led-${led}`, 'aria-hidden': 'true' }),
          h(
            'span',
            { class: 'rt-item-text' },
            h('span', { class: 'rt-item-name' }, j.name),
            h('span', { class: 'rt-item-when' }, describeMacJob(j)),
            h('span', { class: 'rt-item-next', 'data-mac-next': j.label }, macNextText(j)),
          ),
          h('span', { class: 'rt-item-status' }, macChip(j)),
        ),
        h('div', { class: 'rt-item-actions' }, ...macActions(j, false)),
      )
    })
    const list = h('div', { class: 'rt-list' }, ...rows)
    arrowList(list, '.rt-item-main')
    return h(
      'section',
      { class: 'rt-mac', 'aria-label': 'Agendadas no Mac' },
      h('div', { class: 'rt-section-head' }, h('span', { class: 'field-label' }, 'Agendadas no Mac'), h('span', { class: 'chip chip-muted' }, 'launchd')),
      h('div', { class: 'field-hint' }, 'O macOS roda estas sozinho, mesmo com o app fechado. Aqui você acompanha e roda na hora; para mudar o horário, edite o plist em ~/Library/LaunchAgents.'),
      list,
    )
  }

  const macView = (label: string) => {
    const j = state.macJobs.find((x) => x.label === label)
    if (!j) return show({ kind: 'list' })
    title.textContent = j.name
    const now = Date.now()
    const upcoming = j.schedules
      .flatMap((s) => nextRuns(s, now, 3))
      .sort((a, b) => a - b)
      .slice(0, 3)
    const logBox = h('pre', { class: 'rt-log', tabindex: '0', 'aria-label': 'Fim do log' }, 'Lendo o log…')
    content.replaceChildren(
      h(
        'div',
        { class: 'rt-detail' },
        h('div', { class: 'rt-sentence' }, describeMacJob(j)),
        h('div', { class: 'rt-item-next', 'data-mac-next': j.label }, macNextText(j)),
        upcoming.length ? h('div', { class: 'field-hint' }, `Próximas: ${upcoming.map((t) => formatWhen(t)).join(' · ')}`) : null,
        h('div', { class: 'rt-run-head' }, macChip(j), j.lastLogAt ? h('span', { class: 'rt-run-when' }, `log escrito ${formatWhen(j.lastLogAt)}`) : null),
        h('div', { class: 'field-label' }, 'Comando'),
        h('div', { class: 'rt-prompt rt-mono' }, j.command || '(sem comando no plist)'),
        h('div', { class: 'field-hint' }, `${j.label}${j.log ? ` · log em ${j.log}` : ''}`),
        h('div', { class: 'rt-item-actions' }, ...macActions(j, true)),
        h('div', { class: 'field-label' }, 'Fim do log'),
        logBox,
      ),
    )
    foot.replaceChildren(h('button', { class: 'btn', onclick: () => show({ kind: 'list' }) }, 'Voltar'))
    void window.office.macJobLog(j.label).then(
      (text) => {
        logBox.textContent = text
        logBox.scrollTop = logBox.scrollHeight
      },
      (err) => (logBox.textContent = cleanError(err)),
    )
  }

  const actions = (r: Routine, labels: boolean, withEdit = true): HTMLElement[] => {
    const btn = (label: string, ic: string, fn: () => void, extra = '') =>
      h('button', { class: `btn btn-small ${extra}`, type: 'button', title: label, 'aria-label': `${label}: ${r.name}`, onclick: (e: Event) => (e.stopPropagation(), fn()) }, icon(ic, 14), labels ? label : null)
    return [
      btn('Rodar agora', 'send', () => void runNow(r)),
      btn(r.enabled ? 'Pausar' : 'Retomar', r.enabled ? 'stop' : 'reset', () => void toggle(r)),
      withEdit ? btn('Editar', 'edit', () => edit(r)) : null,
      btn('Duplicar', 'copy', () => void duplicate(r)),
      btn('Apagar', 'trash', () => void remove(r), 'btn-danger'),
    ].filter((b): b is HTMLButtonElement => !!b)
  }

  // ---------- list ----------
  const listView = () => {
    title.textContent = 'Rotinas'
    const routines = [...state.routines].sort((a, b) => (a.enabled === b.enabled ? (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) : a.enabled ? -1 : 1))
    const add = h('button', { class: 'btn btn-primary', type: 'button' }, icon('plus', 15), 'Nova rotina')
    add.addEventListener('click', () => edit())
    if (!routines.length) {
      content.replaceChildren(
        h('div', { class: 'rt-empty' }, h('div', { class: 'rt-empty-title' }, 'Nenhuma rotina ainda'), h('div', { class: 'field-hint' }, 'Uma rotina entrega uma tarefa a um agente num horário: todo dia, em certos dias da semana ou a cada tantas horas. Comece por um exemplo:')),
        h(
          'div',
          { class: 'rt-examples' },
          ...EXAMPLES.map((x) =>
            h('button', { class: 'rt-example', type: 'button', onclick: () => edit(x.draft as Partial<Routine>) }, h('span', { class: 'rt-example-title' }, x.title), h('span', { class: 'rt-example-hint' }, x.hint)),
          ),
        ),
        macSection() ?? '',
      )
      foot.replaceChildren(h('button', { class: 'btn', onclick: close }, 'Fechar'), add)
      return
    }
    const rows = routines.map((r) => {
      const last = r.history[0]
      const finished = lastFinished(r)
      const cost = finished?.costUsd
      const led = last?.status === 'waiting' ? 'wait' : last?.status === 'running' ? 'run' : finished?.status === 'failed' ? 'fail' : finished ? 'ok' : 'none'
      return h(
        'div',
        { class: `rt-item${r.enabled ? '' : ' rt-paused'}`, 'data-focus-key': r.id },
        h(
          'button',
          { class: 'rt-item-main', type: 'button', 'data-focus-key': `open:${r.id}`, onclick: () => show({ kind: 'detail', id: r.id }) },
          h('span', { class: `rt-led rt-led-${led}`, 'aria-hidden': 'true' }),
          h(
            'span',
            { class: 'rt-item-text' },
            h('span', { class: 'rt-item-name' }, r.name, r.demo ? h('span', { class: 'chip chip-muted' }, 'demo') : null),
            h('span', { class: 'rt-item-when' }, describeSchedule(r.schedule)),
            h('span', { class: 'rt-item-next', 'data-next': r.id }, nextText(r)),
          ),
          h('span', { class: 'rt-item-status' }, statusChip(last), cost ? h('span', { class: 'rt-cost' }, usd(cost)) : null),
        ),
        h('div', { class: 'rt-item-actions' }, ...actions(r, false)),
      )
    })
    const list = h('div', { class: 'rt-list' }, ...rows)
    arrowList(list, '.rt-item-main')
    content.replaceChildren(list, macSection() ?? '')
    foot.replaceChildren(h('button', { class: 'btn', onclick: close }, 'Fechar'), add)
  }

  // ---------- one routine ----------
  const detailView = (id: string) => {
    const r = state.routines.find((x) => x.id === id)
    if (!r) return show({ kind: 'list' })
    title.textContent = r.name
    const upcoming = r.enabled ? nextRuns(r.schedule, Date.now(), 3) : []
    const runRow = (run: RoutineRun) => {
      const agentHere = run.agentId ? state.agents.get(run.agentId) : undefined
      const links: HTMLElement[] = []
      if (run.resultId && run.agentId && state.results.has(run.resultId)) {
        links.push(h('button', { class: 'rt-link', type: 'button', onclick: () => (close(), hooks.openResult(run.agentId!, run.resultId!)) }, 'Ver resultado'))
      } else if (run.resultId && agentHere) {
        // already read: the result stays in the agent's conversation
        links.push(h('button', { class: 'rt-link', type: 'button', title: 'O resultado já foi lido; ele está na conversa do agente.', onclick: () => (close(), hooks.openAgent(agentHere.id)) }, 'Ver resultado na conversa'))
      }
      if (agentHere) links.push(h('button', { class: 'rt-link', type: 'button', onclick: () => (close(), hooks.openAgent(agentHere.id)) }, `Ver ${agentHere.name}`))
      else if (run.agentName) links.push(h('span', { class: 'field-hint' }, `${run.agentName} saiu do escritório`))
      const when = run.scheduledFor ?? run.startedAt
      return h(
        'li',
        { class: 'rt-run' },
        h(
          'div',
          { class: 'rt-run-head' },
          statusChip(run),
          h('span', { class: 'rt-run-when' }, formatWhen(when), run.manual ? ' · rodada à mão' : ''),
          duration(run) ? h('span', { class: 'rt-run-meta' }, duration(run)) : null,
          run.costUsd ? h('span', { class: 'rt-cost' }, usd(run.costUsd)) : null,
        ),
        run.error ? h('div', { class: `rt-run-note${run.status === 'failed' ? ' rt-danger' : ''}` }, run.error) : null,
        run.note ? h('div', { class: 'rt-run-note' }, run.note) : null,
        links.length ? h('div', { class: 'rt-run-links' }, ...links) : null,
      )
    }
    content.replaceChildren(
      h(
        'div',
        { class: 'rt-detail' },
        h('div', { class: 'rt-sentence' }, describeSchedule(r.schedule)),
        h('div', { class: 'rt-item-next', 'data-next': r.id }, nextText(r)),
        upcoming.length ? h('div', { class: 'field-hint' }, `Próximas: ${upcoming.map((t) => formatWhen(t)).join(' · ')}`) : null,
        h('div', { class: 'field-hint' }, whoText(state, r), ' · ', r.missed === 'run' ? 'Se o app estiver fechado, roda ao abrir.' : 'Se o app estiver fechado, pula.'),
        h('div', { class: 'rt-prompt' }, r.prompt || '(só a instrução do modelo)'),
        h('div', { class: 'rt-item-actions' }, ...actions(r, true, false)),
        h('div', { class: 'field-label' }, 'Histórico (últimas 20)'),
        r.history.length ? h('ul', { class: 'rt-history' }, ...r.history.map(runRow)) : h('div', { class: 'field-hint' }, 'Ainda não rodou.'),
      ),
    )
    foot.replaceChildren(h('button', { class: 'btn', onclick: () => show({ kind: 'list' }) }, 'Voltar'), h('button', { class: 'btn btn-primary', onclick: () => edit(r) }, icon('edit', 15), 'Editar'))
  }

  // ---------- the form ----------
  const edit = (initial?: Partial<Routine>) => {
    view = { kind: 'edit' }
    title.textContent = initial?.id ? `Editar ${initial.name}` : 'Nova rotina'
    const back = initial?.id ? () => show({ kind: 'detail', id: initial.id! }) : () => show({ kind: 'list' })
    const form = routineEditor(state, initial, {
      project: hooks.project(),
      toast: hooks.toast,
      onCancel: back,
      onSaved: (r) => {
        hooks.toast(initial?.id ? `${r.name} salva.` : `${r.name} criada. ${r.enabled && r.nextAt ? `Próxima: ${formatWhen(r.nextAt)}.` : ''}`, 'ok')
        // the routines event may come a moment later: show the saved copy right away
        state.routines = state.routines.some((x) => x.id === r.id) ? state.routines.map((x) => (x.id === r.id ? r : x)) : [...state.routines, r]
        show({ kind: 'detail', id: r.id })
      },
      confirmBypass: () =>
        confirmDialog(root, {
          title: 'Rodar sem pedir nada?',
          text: 'No modo "Sem pedir nada" o agente da rotina roda qualquer comando sozinho, no horário, sem você por perto. Use só em pastas descartáveis.',
          warn: 'Perigoso: nada passa por você antes de acontecer.',
          confirm: 'Salvar assim mesmo',
          cancel: 'Voltar',
          danger: true,
        }),
    })
    content.replaceChildren(form.body)
    foot.replaceChildren(...form.foot)
    content.scrollTop = 0
    form.focus()
  }

  const show = (v: typeof view) => {
    view = v
    if (v.kind === 'list') listView()
    else if (v.kind === 'detail') detailView(v.id)
    else if (v.kind === 'mac') macView(v.label)
  }

  // Runs move along while the window is open; the form is never redrawn under the cursor.
  let seen = state.routines
  let seenJobs = state.macJobs
  const off = state.onChange(() => {
    if (stopped || (state.routines === seen && state.macJobs === seenJobs)) return
    seen = state.routines
    seenJobs = state.macJobs
    // the log tail would reload on every minute's read: the job view redraws on demand only
    if (view.kind === 'list' || view.kind === 'detail') keepFocus(content, () => show(view))
  })
  const ticker = setInterval(() => {
    for (const span of content.querySelectorAll<HTMLElement>('[data-next]')) {
      const r = state.routines.find((x) => x.id === span.dataset.next)
      if (r) span.textContent = nextText(r)
    }
    for (const span of content.querySelectorAll<HTMLElement>('[data-mac-next]')) {
      const j = state.macJobs.find((x) => x.label === span.dataset.macNext)
      if (j) span.textContent = macNextText(j)
    }
  }, 1000)
  // the minute's read may be up to 60 s old: read the Mac's jobs again on opening
  void window.office.listMacJobs().then((jobs) => {
    if (stopped) return
    state.macJobs = jobs
    if (view.kind === 'list') keepFocus(content, () => show(view))
  }, () => undefined)

  show({ kind: 'list' })
  root.append(el)
  content.querySelector<HTMLElement>('.rt-item-main, .rt-example')?.focus()
}
