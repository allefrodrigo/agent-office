import { randomUUID } from 'node:crypto'
import { isPast, nextRun, runsBetween } from '@shared/schedule'
import { renderInstruction } from '@shared/templates'
import { ROUTINE_LIMITS } from '@shared/types'
import type { AgentResult, AgentSummary, EffortLevel, HireRequest, OfficeEvent, OfficePermissionMode, PermissionRequest, Routine, RoutineRun, Settings } from '@shared/types'
import { isDir } from '../squads'
import type { CleanRoutineDraft } from '../validate'
import type { RoutineStore } from './store'

/** A run started this late after its time counts as missed (app closed, Mac asleep). */
export const GRACE_MS = 2 * 60_000
/** The timer wakes at least this often, so a changed clock or time zone is caught soon. */
const MAX_SLEEP_MS = 5 * 60_000

/** What the scheduler needs from the AgentManager (a fake one in the tests). */
export interface RoutineHost {
  on(event: 'event', listener: (e: OfficeEvent) => void): unknown
  agent(id: string): AgentSummary | undefined
  list(): AgentSummary[]
  isBusy(id: string): boolean
  hire(req: HireRequest, display?: string): Promise<AgentSummary>
  sendMessage(id: string, text: string, display?: string): void
  clearContext(id: string): void
  configure(id: string, patch: { permissionMode?: OfficePermissionMode; model?: string; effort?: EffortLevel }): void
  pendingRequests(): PermissionRequest[]
  pendingResults(): AgentResult[]
}

export interface SchedulerDeps {
  store: RoutineStore
  manager: RoutineHost
  settings(): Pick<Settings, 'projects' | 'templates'>
  /** The list changed: send it to the renderer. */
  broadcast(routines: Routine[]): void
  /** System notification for a run that failed before an agent could answer. */
  notify(title: string, body: string, target?: { agentId: string; itemId: string }): void
  now?: () => number
}

/** A run the scheduler follows until its result arrives. */
interface Active {
  routineId: string
  run: RoutineRun
  /** What the agent had spent before the run, to tell this run's cost. */
  spentBefore: number
}

const stamp = (t: number) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const firstLine = (text: string) => (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 300)

/** Thrown by launch when the run should be recorded as skipped, not failed. */
class Skip extends Error {}

/**
 * Runs the routines on time. One timer, set for the earliest next run of all of them and
 * set again after every change. At startup and when the Mac wakes, runs whose time passed
 * while the app was closed (or asleep) follow the routine's choice: run once now, or be
 * recorded as missed. A routine never runs twice at once: a slot that comes while the
 * last run is still going is recorded as skipped.
 *
 * The task goes to the agent like any message, so the cost cap per agent and the account
 * rotation apply as usual, and the result reaches the player's room like any other.
 */
export class RoutineScheduler {
  private timer: NodeJS.Timeout | null = null
  /** routineId -> its run in progress. */
  private active = new Map<string, Active>()
  private now: () => number
  /** Demo mode: plays the run instead of messaging a real agent. */
  demoSend?: (agentId: string, text: string) => void

  constructor(private d: SchedulerDeps) {
    this.now = d.now ?? (() => Date.now())
    d.manager.on('event', (e) => this.onEvent(e))
  }

  // ---------- reads ----------

  list(): Routine[] {
    return this.d.store.routines
  }

  get(id: string): Routine | undefined {
    return this.list().find((r) => r.id === id)
  }

  /** The routine run an agent is doing right now, if any. */
  activeRun(agentId: string): { routine: Routine; run: RoutineRun } | undefined {
    for (const a of this.active.values()) {
      const routine = this.get(a.routineId)
      if (routine && a.run.agentId === agentId) return { routine, run: a.run }
    }
    return undefined
  }

  // ---------- timer ----------

  /** Startup: deals with what was missed while the app was closed and sets the timer. */
  start(): void {
    this.check()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Runs what is due (or deals with it as missed) and sets the timer for the next one. Also on wake. */
  check(): void {
    const now = this.now()
    let changed = false
    for (const r of this.list()) {
      if (!r.enabled || r.nextAt === null || r.nextAt > now) continue
      const due = r.nextAt
      changed = true
      if (now - due <= GRACE_MS) {
        void this.fire(r, due)
      } else {
        const missed = runsBetween(r.schedule, due, now)
        const what =
          missed.count > 1 && missed.first !== null && missed.last !== null
            ? `${missed.count >= 1000 ? 'mais de 999' : missed.count} horários (de ${stamp(missed.first)} a ${stamp(missed.last)}) passaram`
            : `o horário de ${stamp(due)} passou`
        const why = `${what} com o app fechado ou o computador dormindo.`
        if (r.missed === 'run') void this.fire(r, missed.last ?? due, { note: `Atrasada: ${why}` })
        else this.record(r, { status: 'missed', scheduledFor: missed.first ?? due, error: why.charAt(0).toUpperCase() + why.slice(1) })
      }
      r.nextAt = nextRun(r.schedule, now)
    }
    if (changed) this.changed()
    this.arm()
  }

  private arm(): void {
    this.stop()
    const next = Math.min(...this.list().map((r) => (r.enabled && r.nextAt !== null ? r.nextAt : Infinity)))
    if (next === Infinity) return
    const delay = Math.max(0, Math.min(MAX_SLEEP_MS, next - this.now())) + 5
    this.timer = setTimeout(() => this.check(), delay)
    this.timer.unref?.()
  }

  // ---------- changes from the form ----------

  /** Creates (no id, or an unknown one) or replaces a routine. */
  save(d: CleanRoutineDraft): Routine {
    const now = this.now()
    const old = d.id ? this.get(d.id) : undefined
    const scheduleChanged = !old || JSON.stringify(old.schedule) !== JSON.stringify(d.schedule)
    if (scheduleChanged && d.enabled && isPast(d.schedule, now)) throw new Error('Esse horário já passou. Escolha uma data no futuro.')
    if (!old && this.list().length >= ROUTINE_LIMITS.count) throw new Error(`Limite de ${ROUTINE_LIMITS.count} rotinas atingido. Apague alguma antes.`)
    // An interval keeps its old start unless its length changed.
    const schedule =
      old && d.schedule.kind === 'interval' && old.schedule.kind === 'interval' && old.schedule.every === d.schedule.every && old.schedule.unit === d.schedule.unit
        ? { ...d.schedule, anchor: old.schedule.anchor }
        : d.schedule
    const r: Routine = {
      id: old?.id ?? randomUUID(),
      name: d.name,
      prompt: d.prompt,
      who: d.who,
      ...(d.cwd ? { cwd: d.cwd } : {}),
      ...(d.floor ? { floor: d.floor } : {}),
      permissionMode: d.permissionMode,
      schedule,
      enabled: d.enabled,
      missed: d.missed,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      nextAt: d.enabled ? (!scheduleChanged && old?.enabled && old.nextAt !== null ? old.nextAt : nextRun(schedule, now)) : null,
      // Its own agent stays only while it still fits: same kind of runner.
      ...(old?.agentId && old.who.kind === d.who.kind && d.who.kind !== 'agent' ? { agentId: old.agentId } : {}),
      history: old?.history ?? [],
      ...(old?.demo ? { demo: true } : {}),
    }
    this.d.store.routines = old ? this.list().map((x) => (x.id === r.id ? r : x)) : [...this.list(), r]
    this.changed()
    this.arm()
    return r
  }

  remove(id: string): void {
    this.active.delete(id)
    this.d.store.routines = this.list().filter((r) => r.id !== id)
    this.changed()
    this.arm()
  }

  /** Pause or resume. Resuming counts from now: what passed while paused is not missed. */
  setEnabled(id: string, enabled: boolean): Routine {
    const r = this.must(id)
    r.enabled = enabled
    r.updatedAt = this.now()
    r.nextAt = enabled ? nextRun(r.schedule, this.now()) : null
    this.d.store.save()
    this.changed()
    this.arm()
    return r
  }

  /** A paused copy with no history: two copies of a routine never start running together by surprise. */
  duplicate(id: string): Routine {
    const r = this.must(id)
    if (this.list().length >= ROUTINE_LIMITS.count) throw new Error(`Limite de ${ROUTINE_LIMITS.count} rotinas atingido. Apague alguma antes.`)
    const now = this.now()
    const copy: Routine = {
      ...structuredClone(r),
      id: randomUUID(),
      name: `${r.name} (cópia)`.slice(0, ROUTINE_LIMITS.name),
      enabled: false,
      nextAt: null,
      agentId: undefined,
      history: [],
      demo: undefined,
      createdAt: now,
      updatedAt: now,
    }
    this.d.store.routines = [...this.list(), copy]
    this.changed()
    return copy
  }

  /** "Rodar agora": one run outside the schedule, even when paused. */
  async runNow(id: string): Promise<Routine> {
    const r = this.must(id)
    if (this.active.has(r.id)) throw new Error(`${r.name} ainda está rodando. Espere terminar.`)
    await this.fire(r, undefined, { manual: true })
    return r
  }

  // ---------- running ----------

  private async fire(r: Routine, scheduledFor: number | undefined, opts: { manual?: boolean; note?: string } = {}): Promise<void> {
    if (this.active.has(r.id)) {
      this.record(r, { status: 'skipped', scheduledFor, error: 'A execução anterior ainda estava rodando.' })
      return
    }
    const run: RoutineRun = {
      id: randomUUID(),
      ...(scheduledFor !== undefined ? { scheduledFor } : {}),
      startedAt: this.now(),
      status: 'running',
      ...(opts.manual ? { manual: true } : {}),
      ...(opts.note ? { note: opts.note } : {}),
    }
    const active: Active = { routineId: r.id, run, spentBefore: 0 }
    this.active.set(r.id, active)
    this.push(r, run)
    try {
      await this.launch(r, active)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof Skip) this.finish(active, 'skipped', { error: message })
      else {
        this.finish(active, 'failed', { error: message })
        this.d.notify(`Rotina ${r.name} falhou`, message)
      }
    }
  }

  /** Hands the task to the routine's agent (hiring it first when needed). */
  private async launch(r: Routine, active: Active): Promise<void> {
    const m = this.d.manager
    const settings = this.d.settings()
    const at = active.run.scheduledFor ?? active.run.startedAt
    const header = `Rotina "${r.name}" · execução de ${stamp(at)}${active.run.manual ? ' (rodada à mão)' : ''}`

    if (r.who.kind === 'agent') {
      const a = m.agent(r.who.agentId)
      if (!a) throw new Error('O agente desta rotina não está mais no escritório. Edite a rotina e escolha outro.')
      if (a.source !== 'office' || a.role === 'orchestrator') throw new Error(`${a.name} não recebe tarefas de rotinas. Edite a rotina e escolha outro agente.`)
      if (m.isBusy(a.id)) throw new Skip(`${a.name} estava ocupado com outra tarefa.`)
      this.send(active, a, `${header}\n\n${r.prompt}`)
      return
    }

    const project = r.floor ? settings.projects.find((p) => p.id === r.floor) : undefined
    if (r.floor && !project) throw new Error('O andar desta rotina não existe mais. Edite a rotina e escolha outro.')
    const cwd = project?.cwd ?? r.cwd ?? ''
    if (!cwd || !isDir(cwd)) throw new Error(`A pasta ${cwd || '(nenhuma)'} não existe mais. Edite a rotina e escolha outra.`)
    const who = r.who
    const template = who.kind === 'template' ? settings.templates.find((t) => t.id === who.templateId) : undefined
    if (who.kind === 'template' && !template) throw new Error('O modelo salvo desta rotina foi apagado. Edite a rotina e escolha outro.')
    const task = [template?.instruction ? renderInstruction(template.instruction, { folder: cwd }) : '', r.prompt].filter(Boolean).join('\n\n')
    const text = `${header}\n\n${task}`
    const brain = who.kind === 'new' ? { model: who.model, effort: who.effort } : { model: template?.model, effort: template?.effort }

    const own = r.agentId ? m.agent(r.agentId) : undefined
    if (own && own.source === 'office' && own.cwd === cwd) {
      if (m.isBusy(own.id)) throw new Skip(`${own.name} estava ocupado com outra tarefa.`)
      // Each run starts a fresh conversation, so the context does not grow day after day.
      m.clearContext(own.id)
      m.configure(own.id, { permissionMode: r.permissionMode, ...brain })
      this.send(active, own, text)
      return
    }
    const base = who.kind === 'new' ? who.name || '' : (template?.name ?? '')
    const a = await m.hire({ name: this.freeName(base), cwd, task: text, ...brain, permissionMode: r.permissionMode, ...(template?.look ? { look: template.look } : {}) })
    r.agentId = a.id
    this.d.store.save()
    active.run.agentId = a.id
    active.run.agentName = a.name
    this.changed()
    // A run that ended inside hire (no Claude Code, say) delivered before we knew the agent.
    const early = m.pendingResults().find((x) => x.agentId === a.id)
    if (early) this.delivered(early)
  }

  private send(active: Active, a: AgentSummary, text: string): void {
    active.run.agentId = a.id
    active.run.agentName = a.name
    active.spentBefore = a.spentUsd ?? 0
    this.changed()
    // Set before sending: an agent over its cost cap answers at once.
    if (this.demoSend) this.demoSend(a.id, text)
    else this.d.manager.sendMessage(a.id, text)
  }

  /** A name nobody in the office uses: the base, or "Base 2"; '' lets the office pick one. */
  private freeName(base: string): string {
    if (!base) return ''
    const used = new Set(this.d.manager.list().map((a) => a.name))
    if (!used.has(base)) return base
    for (let i = 2; i < 100; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`
    return ''
  }

  private onEvent(e: OfficeEvent): void {
    if (e.type === 'result:new') this.delivered(e.result)
    else if (e.type === 'permission:new') {
      const a = this.byAgent(e.request.agentId)
      if (a && a.run.status === 'running') {
        a.run.status = 'waiting'
        this.changed()
      }
    } else if (e.type === 'permission:resolved') {
      const a = this.byAgent(e.agentId)
      if (a && a.run.status === 'waiting' && !this.d.manager.pendingRequests().some((p) => p.agentId === e.agentId)) {
        a.run.status = 'running'
        this.changed()
      }
    } else if (e.type === 'agent:removed') {
      const a = this.byAgent(e.agentId)
      if (a) {
        const r = this.get(a.routineId)
        this.finish(a, 'failed', { error: 'O agente saiu do escritório antes de terminar.' })
        if (r) this.d.notify(`Rotina ${r.name} falhou`, 'O agente saiu do escritório antes de terminar.')
      }
      let forgot = false
      for (const r of this.list()) {
        if (r.agentId !== e.agentId) continue
        r.agentId = undefined
        forgot = true
      }
      if (forgot) this.d.store.save()
    }
  }

  private delivered(result: AgentResult): void {
    const a = this.byAgent(result.agentId)
    if (!a) return
    const spent = (this.d.manager.agent(result.agentId)?.spentUsd ?? 0) - a.spentBefore
    this.finish(a, result.isError ? 'failed' : 'ok', {
      resultId: result.id,
      ...(spent > 0 ? { costUsd: Math.round(spent * 10_000) / 10_000 } : {}),
      ...(result.isError ? { error: firstLine(result.text) || 'O agente parou com um erro.' } : {}),
    })
  }

  private byAgent(agentId: string): Active | undefined {
    for (const a of this.active.values()) if (a.run.agentId === agentId) return a
    return undefined
  }

  private finish(a: Active, status: RoutineRun['status'], extra: Partial<RoutineRun>): void {
    if (this.active.get(a.routineId) === a) this.active.delete(a.routineId)
    Object.assign(a.run, { status, endedAt: this.now(), ...extra })
    this.d.store.save()
    this.changed()
  }

  /** A run that never started (missed, skipped). */
  private record(r: Routine, run: Omit<RoutineRun, 'id' | 'startedAt'>): void {
    const now = this.now()
    this.push(r, { id: randomUUID(), startedAt: now, endedAt: now, ...run })
  }

  private push(r: Routine, run: RoutineRun): void {
    r.history = [run, ...r.history].slice(0, ROUTINE_LIMITS.history)
    this.d.store.save()
    this.changed()
  }

  private must(id: string): Routine {
    const r = this.get(id)
    if (!r) throw new Error('Essa rotina não existe mais.')
    return r
  }

  private changed(): void {
    this.d.broadcast(this.list())
  }

  // ---------- demo ----------

  /** Demo mode: routines shown with their history, never saved. */
  addDemo(routines: Routine[]): void {
    this.d.store.routines = [...this.list(), ...routines.map((r) => ({ ...r, demo: true }))]
    this.changed()
    this.arm()
  }
}
