process.env.TZ = 'America/Sao_Paulo'

import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentResult, AgentSummary, AgentTemplate, Bot, HireRequest, OfficeEvent, PermissionRequest, Routine, RoutineDraft, RunTrigger, Settings } from '@shared/types'
import { routinesLed, routinesView } from '@shared/routines'
import { BOT_GONE, RoutineScheduler, RoutineStore, type BotRunEnd, type BotRunHost, type BotRunStart, type RoutineHost } from '../src/main/routines'
import { cleanRoutineDraft } from '../src/main/validate'
import { importSet, parseExport } from '../src/main/backups'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

let dir: string
let project: string

/** Just enough of the AgentManager: agents, hiring, messages, and the events it sends. */
class FakeManager extends EventEmitter implements RoutineHost {
  agents = new Map<string, AgentSummary>()
  busy = new Set<string>()
  sent: { id: string; text: string }[] = []
  hired: HireRequest[] = []
  cleared: string[] = []
  pending: PermissionRequest[] = []
  results: AgentResult[] = []
  private n = 0

  add(name: string, extra: Partial<AgentSummary> = {}): AgentSummary {
    const a = { id: `a${++this.n}`, name, source: 'office', cwd: project, permissionMode: 'default', status: 'idle', activity: '', desk: 0, look: {}, costUsd: 0, createdAt: 0, ...extra } as AgentSummary
    this.agents.set(a.id, a)
    return a
  }
  agent = (id: string) => this.agents.get(id)
  list = () => [...this.agents.values()]
  isBusy = (id: string) => this.busy.has(id)
  async hire(req: HireRequest): Promise<AgentSummary> {
    this.hired.push(req)
    const a = this.add(req.name || 'Ada', { cwd: req.cwd, permissionMode: req.permissionMode })
    this.sent.push({ id: a.id, text: req.task })
    return a
  }
  sendMessage(id: string, text: string): void {
    this.sent.push({ id, text })
  }
  clearContext(id: string): void {
    this.cleared.push(id)
  }
  configure(id: string, patch: { permissionMode?: AgentSummary['permissionMode'] }): void {
    const a = this.agents.get(id)
    if (a && patch.permissionMode) a.permissionMode = patch.permissionMode
  }
  pendingRequests = () => this.pending
  pendingResults = () => this.results

  // ---------- what the real manager would emit ----------
  finish(agentId: string, isError = false, spent = 0): AgentResult {
    const a = this.agents.get(agentId)!
    a.spentUsd = (a.spentUsd ?? 0) + spent
    const result = { id: `r-${agentId}-${Date.now()}`, agentId, text: isError ? 'Deu errado\nno meio' : 'Feito', isError, costUsd: 0, durationMs: 0, turns: 1, createdAt: Date.now() }
    this.emit('event', { type: 'result:new', result } satisfies OfficeEvent)
    return result
  }
  ask(agentId: string): void {
    const request = { id: `p-${agentId}`, agentId, kind: 'tool', toolName: 'Bash', title: 'Rodar', detail: '', input: {}, canAlwaysAllow: false, createdAt: 0 } as PermissionRequest
    this.pending.push(request)
    this.emit('event', { type: 'permission:new', request } satisfies OfficeEvent)
  }
  answer(agentId: string): void {
    this.pending = this.pending.filter((p) => p.agentId !== agentId)
    this.emit('event', { type: 'permission:resolved', requestId: `p-${agentId}`, agentId } satisfies OfficeEvent)
  }
  leave(agentId: string): void {
    this.agents.delete(agentId)
    this.emit('event', { type: 'agent:removed', agentId } satisfies OfficeEvent)
  }
}

const templates: AgentTemplate[] = [{ id: 'tpl', name: 'Revisor', permissionMode: 'bypassPermissions', instruction: 'Você revisa {pasta}.', model: 'sonnet' }]
const settings = (): Pick<Settings, 'projects' | 'templates'> => ({ projects: [{ id: 'p1', name: 'Loja', cwd: project }], templates })

/** Just enough of the BotRunner: the bots, runScheduled and 'run:end'. */
class FakeBots extends EventEmitter implements BotRunHost {
  bots: Pick<Bot, 'id' | 'name' | 'floor'>[] = [{ id: 'chefe', name: 'Chefe de gabinete', floor: 'p1' }]
  busy = new Set<string>()
  calls: { botId: string; task: string; trigger: RunTrigger; runId?: string }[] = []
  private n = 0
  list = () => this.bots
  async runScheduled(botId: string, task: string, trigger: RunTrigger): Promise<BotRunStart> {
    const call: (typeof this.calls)[number] = { botId, task, trigger }
    this.calls.push(call)
    if (this.busy.has(botId)) return { skipped: 'Pulei a rodada das 09:00: Chefe de gabinete estava ocupado.' }
    call.runId = `run-${++this.n}`
    return { runId: call.runId }
  }
  end(runId: string, status: BotRunEnd['status'] = 'ok', extra: Partial<BotRunEnd> = {}): void {
    const call = this.calls.find((c) => c.runId === runId)!
    this.emit('run:end', { botId: call.botId, runId, threadId: call.botId, trigger: call.trigger, status, ...extra } satisfies BotRunEnd)
  }
}

function setup(opts: { bots?: FakeBots } = {}) {
  const manager = new FakeManager()
  const store = new RoutineStore(dir)
  const notices: string[] = []
  const broadcasts: Routine[][] = []
  const scheduler = new RoutineScheduler({ store, manager, settings, bots: opts.bots, broadcast: (l) => broadcasts.push(l), notify: (title, body) => notices.push(`${title}: ${body}`) })
  const save = (draft: Partial<RoutineDraft>) =>
    scheduler.save(
      cleanRoutineDraft(
        { name: 'Relatório', prompt: 'Resuma o dia.', who: { kind: 'new' }, cwd: project, schedule: { kind: 'daily', time: '09:00' }, ...draft },
        { settings: settings(), agents: manager.list(), bots: opts.bots?.bots ?? [] },
      ),
    )
  return { manager, store, scheduler, notices, broadcasts, save }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-routines-'))
  project = mkdtempSync(join(tmpdir(), 'ao-project-'))
  vi.useFakeTimers()
  vi.setSystemTime(at(2026, 10, 13, 8, 0))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

describe('running on time', () => {
  it('todo dia às 09:00: runs at 9, hands the result to the history', async () => {
    const { manager, scheduler, save } = setup()
    const r = save({})
    scheduler.start()
    expect(r.nextAt).toBe(at(2026, 10, 13, 9, 0))
    await vi.advanceTimersByTimeAsync(59 * 60_000)
    expect(manager.hired).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(manager.hired).toHaveLength(1)
    // the task carries the routine and the date in its header
    expect(manager.hired[0].task).toMatch(/^Rotina "Relatório" · execução de 13\/10\/2026,? 09:00\n\nResuma o dia\.$/)
    // never "Sem pedir nada" unless asked
    expect(manager.hired[0].permissionMode).toBe('default')
    const run = scheduler.get(r.id)!.history[0]
    expect(run.status).toBe('running')
    const agentId = run.agentId!
    const result = manager.finish(agentId, false, 0.42)
    const done = scheduler.get(r.id)!.history[0]
    expect(done).toMatchObject({ status: 'ok', resultId: result.id, costUsd: 0.42, agentId, scheduledFor: at(2026, 10, 13, 9, 0) })
    expect(scheduler.get(r.id)!.nextAt).toBe(at(2026, 10, 14, 9, 0))
  })

  it('reuses its own agent with a fresh conversation the next day', async () => {
    const { manager, scheduler, save } = setup()
    const r = save({ who: { kind: 'new', name: 'Rita', model: 'haiku' } })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)
    const first = scheduler.get(r.id)!.history[0].agentId!
    manager.finish(first)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(manager.hired).toHaveLength(1)
    expect(manager.cleared).toEqual([first])
    expect(manager.sent.at(-1)).toMatchObject({ id: first })
    expect(manager.sent.at(-1)!.text).toMatch(/execução de 14\/10\/2026/)
  })

  it('a template: its instruction comes first, with the folder filled in', async () => {
    const { manager, scheduler, save } = setup()
    save({ who: { kind: 'template', templateId: 'tpl' }, floor: 'p1', cwd: undefined })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)
    expect(manager.hired[0]).toMatchObject({ name: 'Revisor', cwd: project, model: 'sonnet', permissionMode: 'default' })
    expect(manager.hired[0].task).toContain(`Você revisa ${project}.\n\nResuma o dia.`)
  })

  it('waits for you while a permission is open, then goes on', async () => {
    const { manager, scheduler, save } = setup()
    const r = save({})
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)
    const id = scheduler.get(r.id)!.history[0].agentId!
    manager.ask(id)
    expect(scheduler.get(r.id)!.history[0].status).toBe('waiting')
    expect(routinesView(scheduler.list())).toMatchObject({ led: 'wait', dots: ['wait'] })
    manager.answer(id)
    expect(scheduler.get(r.id)!.history[0].status).toBe('running')
    manager.finish(id, true)
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'failed', error: 'Deu errado' })
    expect(routinesLed(scheduler.list())).toBe('fail')
    expect(routinesView(scheduler.list()).dots).toEqual(['fail'])
  })

  it('an agent that leaves mid-run fails it and notifies', async () => {
    const { manager, scheduler, notices, save } = setup()
    const r = save({})
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)
    manager.leave(scheduler.get(r.id)!.history[0].agentId!)
    expect(scheduler.get(r.id)!.history[0].status).toBe('failed')
    expect(scheduler.get(r.id)!.agentId).toBeUndefined()
    expect(notices[0]).toMatch(/Rotina Relatório falhou/)
  })
})

describe('no overlap', () => {
  it('a slot that comes while the last run goes on is skipped', async () => {
    const { manager, scheduler, save } = setup()
    const r = save({ schedule: { kind: 'interval', every: 15, unit: 'minutes' } })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1000)
    expect(manager.hired).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1000)
    const h = scheduler.get(r.id)!.history
    expect(h.map((x) => x.status)).toEqual(['skipped', 'running'])
    expect(h[0].error).toMatch(/anterior ainda estava rodando/)
    expect(manager.hired).toHaveLength(1)
    // "Rodar agora" says so instead
    await expect(scheduler.runNow(r.id)).rejects.toThrow(/ainda está rodando/)
  })

  it('an agent busy with something else: skipped, not interrupted', async () => {
    const { manager, scheduler, save } = setup()
    const ada = manager.add('Ada')
    manager.busy.add(ada.id)
    const r = save({ who: { kind: 'agent', agentId: ada.id }, cwd: undefined })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)
    expect(manager.sent).toHaveLength(0)
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'skipped', error: 'Ada estava ocupado com outra tarefa.' })
  })

  it('an existing agent gets the task in its own conversation', async () => {
    const { manager, scheduler, save } = setup()
    const ada = manager.add('Ada', { spentUsd: 1 })
    const r = save({ who: { kind: 'agent', agentId: ada.id }, cwd: undefined })
    await scheduler.runNow(r.id)
    expect(manager.cleared).toEqual([])
    expect(manager.sent[0]).toMatchObject({ id: ada.id })
    expect(manager.sent[0].text).toMatch(/\(rodada à mão\)/)
    manager.finish(ada.id, false, 0.1)
    // only what this run spent
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'ok', manual: true, costUsd: 0.1 })
  })
})

describe('missed while the app was closed', () => {
  /** A routine saved yesterday whose 09:00 passed with the app closed. */
  function closedSince(missed: 'run' | 'skip') {
    const first = setup()
    vi.setSystemTime(at(2026, 10, 12, 20, 0))
    const r = first.save({ missed })
    first.store.flush()
    expect(r.nextAt).toBe(at(2026, 10, 13, 9, 0))
    // opened again at 11:30
    vi.setSystemTime(at(2026, 10, 13, 11, 30))
    const again = setup()
    again.scheduler.start()
    return { ...again, id: r.id }
  }

  it('"rodar ao abrir": runs once now, marked late', () => {
    const { manager, scheduler, id } = closedSince('run')
    expect(manager.hired).toHaveLength(1)
    const run = scheduler.get(id)!.history[0]
    expect(run).toMatchObject({ status: 'running', scheduledFor: at(2026, 10, 13, 9, 0) })
    expect(run.note).toMatch(/Atrasada/)
    expect(scheduler.get(id)!.nextAt).toBe(at(2026, 10, 14, 9, 0))
  })

  it('"pular": recorded as missed, nothing runs', () => {
    const { manager, scheduler, id } = closedSince('skip')
    expect(manager.hired).toHaveLength(0)
    expect(scheduler.get(id)!.history[0]).toMatchObject({ status: 'missed', scheduledFor: at(2026, 10, 13, 9, 0) })
    expect(scheduler.get(id)!.nextAt).toBe(at(2026, 10, 14, 9, 0))
  })

  it('many slots missed run only once', () => {
    const first = setup()
    const r = first.save({ schedule: { kind: 'interval', every: 1, unit: 'hours' } })
    first.store.flush()
    vi.setSystemTime(at(2026, 10, 13, 20, 10))
    const again = setup()
    again.scheduler.start()
    expect(again.manager.hired).toHaveLength(1)
    expect(again.scheduler.get(r.id)!.history[0].note).toMatch(/12 horários/)
  })

  it('waking the Mac late counts as missed too', async () => {
    const { manager, scheduler, save } = setup()
    const r = save({ missed: 'skip' })
    scheduler.start()
    // asleep from 08:00 to 10:00: the timer did not fire, resume calls check()
    vi.setSystemTime(at(2026, 10, 13, 10, 0))
    scheduler.check()
    expect(manager.hired).toHaveLength(0)
    expect(scheduler.get(r.id)!.history[0].status).toBe('missed')
  })

  it('paused while the time passed: resuming does not count it as missed', () => {
    const { scheduler, save } = setup()
    const r = save({ enabled: false })
    vi.setSystemTime(at(2026, 10, 13, 12, 0))
    scheduler.check()
    const back = scheduler.setEnabled(r.id, true)
    expect(back.history).toEqual([])
    expect(back.nextAt).toBe(at(2026, 10, 14, 9, 0))
  })
})

describe('changes survive a restart', () => {
  it('edit, pause, duplicate and delete are saved in routines.json', () => {
    const { scheduler, store, save } = setup()
    const r = save({})
    save({ id: r.id, name: 'Relatório da manhã', schedule: { kind: 'daily', time: '08:30' } })
    scheduler.setEnabled(r.id, false)
    const copy = scheduler.duplicate(r.id)
    const gone = save({ name: 'Apagar' })
    scheduler.remove(gone.id)
    store.flush()
    const again = new RoutineStore(dir).routines
    expect(again.map((x) => x.name)).toEqual(['Relatório da manhã', 'Relatório da manhã (cópia)'])
    expect(again[0]).toMatchObject({ enabled: false, nextAt: null, schedule: { kind: 'daily', time: '08:30' } })
    expect(again[1]).toMatchObject({ id: copy.id, enabled: false, history: [] })
  })

  it('demo routines are never written', () => {
    const { scheduler, store } = setup()
    scheduler.addDemo([{ ...setup().save({}), id: 'demo-1' }])
    store.flush()
    const file = JSON.parse(readFileSync(join(dir, 'routines.json'), 'utf8'))
    expect(file.routines.some((r: Routine) => r.id === 'demo-1')).toBe(false)
  })

  it('a run the app was following when it closed reads as failed', () => {
    writeFileSync(
      join(dir, 'routines.json'),
      JSON.stringify({ routines: [{ id: 'x', name: 'R', prompt: 'p', who: { kind: 'new' }, schedule: { kind: 'daily', time: '09:00' }, history: [{ id: 'h', startedAt: 1, status: 'running' }] }] }),
    )
    expect(new RoutineStore(dir).routines[0].history[0]).toMatchObject({ status: 'failed', error: /fechou/ })
  })
})

describe('corrupt routines.json', () => {
  it('is moved aside, never written over, and the .bak loads', () => {
    const good = JSON.stringify({ routines: [{ id: 'x', name: 'R', prompt: 'p', who: { kind: 'new' }, schedule: { kind: 'daily', time: '09:00' }, history: [] }] })
    writeFileSync(join(dir, 'routines.json.bak'), good)
    writeFileSync(join(dir, 'routines.json'), good.slice(0, 30))
    const store = new RoutineStore(dir)
    expect(store.routines.map((r) => r.name)).toEqual(['R'])
    const kept = readdirSync(dir).find((n) => n.startsWith('routines.corrupt-'))!
    expect(readFileSync(join(dir, kept), 'utf8')).toBe(good.slice(0, 30))
    // and the copy is back under its name
    expect(JSON.parse(readFileSync(join(dir, 'routines.json'), 'utf8')).routines[0].id).toBe('x')
  })

  it('with no good copy: starts empty but keeps the bad file', () => {
    writeFileSync(join(dir, 'routines.json'), '{"routines": {"not": "a list"}}')
    const store = new RoutineStore(dir)
    expect(store.routines).toEqual([])
    store.flush()
    expect(readdirSync(dir).some((n) => n.startsWith('routines.corrupt-'))).toBe(true)
  })

  it('a broken entry is dropped, the others load', () => {
    writeFileSync(join(dir, 'routines.json'), JSON.stringify({ routines: [{ id: 'ok', name: 'R', prompt: '', who: { kind: 'new' }, schedule: { kind: 'daily', time: '09:00' } }, { id: 2 }, { id: 'y', name: 'S' }] }))
    expect(new RoutineStore(dir).routines.map((r) => r.id)).toEqual(['ok'])
  })
})

describe('IPC validation', () => {
  const ctx = () => ({ settings: settings(), agents: [] as AgentSummary[], now: at(2026, 10, 13, 8, 7) })
  const base = () => ({ name: 'R', prompt: 'Faça', who: { kind: 'new' }, cwd: project, schedule: { kind: 'daily', time: '09:00' } })

  it('fills the defaults: "Pedir permissão", active, run when opening', () => {
    expect(cleanRoutineDraft(base(), ctx())).toMatchObject({ permissionMode: 'default', enabled: true, missed: 'run', cwd: project })
  })

  it('refuses what the form could never send', () => {
    expect(() => cleanRoutineDraft(null, ctx())).toThrow(/nome/)
    expect(() => cleanRoutineDraft({ ...base(), name: '  ' }, ctx())).toThrow(/nome/)
    expect(() => cleanRoutineDraft({ ...base(), prompt: ' ' }, ctx())).toThrow(/tarefa/)
    expect(() => cleanRoutineDraft({ ...base(), permissionMode: 'root' }, ctx())).toThrow(/inválida/)
    expect(() => cleanRoutineDraft({ ...base(), schedule: { kind: 'daily', time: '9h' } }, ctx())).toThrow(/inválida/)
    expect(() => cleanRoutineDraft({ ...base(), schedule: { kind: 'hourly' } }, ctx())).toThrow(/inválida/)
    expect(() => cleanRoutineDraft({ ...base(), who: { kind: 'root' } }, ctx())).toThrow(/inválida/)
    expect(() => cleanRoutineDraft({ ...base(), prompt: 'x'.repeat(20_001) }, ctx())).toThrow(/inválida/)
    expect(() => cleanRoutineDraft({ ...base(), id: '../x' }, ctx())).toThrow(/inválida/)
  })

  it('says what is wrong with the schedule', () => {
    expect(() => cleanRoutineDraft({ ...base(), schedule: { kind: 'cron', expr: '0 25 * * *' } }, ctx())).toThrow(/Campo hora: 25/)
    expect(() => cleanRoutineDraft({ ...base(), schedule: { kind: 'interval', every: 5, unit: 'minutes' } }, ctx())).toThrow(/15 minutos/)
  })

  it('checks the folder, the floor, the template and the agent', () => {
    expect(() => cleanRoutineDraft({ ...base(), cwd: '/nao/existe' }, ctx())).toThrow(/pasta/)
    expect(() => cleanRoutineDraft({ ...base(), cwd: 'relativa' }, ctx())).toThrow(/pasta/)
    expect(() => cleanRoutineDraft({ ...base(), cwd: undefined, floor: 'p9' }, ctx())).toThrow(/andar/)
    expect(cleanRoutineDraft({ ...base(), cwd: undefined, floor: 'p1' }, ctx())).toMatchObject({ floor: 'p1' })
    expect(() => cleanRoutineDraft({ ...base(), who: { kind: 'template', templateId: 'nope' } }, ctx())).toThrow(/modelo/)
    // a template with an instruction needs no extra task
    expect(cleanRoutineDraft({ ...base(), prompt: '', who: { kind: 'template', templateId: 'tpl' } }, ctx()).prompt).toBe('')
    expect(() => cleanRoutineDraft({ ...base(), who: { kind: 'agent', agentId: 'a1' } }, ctx())).toThrow(/não está mais/)
    const term = { id: 'a1', name: 'T', source: 'terminal' } as AgentSummary
    expect(() => cleanRoutineDraft({ ...base(), who: { kind: 'agent', agentId: 'a1' } }, { ...ctx(), agents: [term] })).toThrow(/terminal/)
  })

  it('an interval starts counting at the minute it was saved', () => {
    const d = cleanRoutineDraft({ ...base(), schedule: { kind: 'interval', every: 2, unit: 'hours' } }, ctx())
    expect(d.schedule).toEqual({ kind: 'interval', every: 2, unit: 'hours', anchor: at(2026, 10, 13, 8, 7) })
  })

  it('a "uma vez" in the past is refused on save', () => {
    const { scheduler } = setup()
    const d = cleanRoutineDraft({ ...base(), schedule: { kind: 'once', at: '2026-10-12T09:00' } }, ctx())
    expect(() => scheduler.save(d)).toThrow(/já passou/)
  })
})

describe('a bot runs the routine (Chat dos bots, CB-12)', () => {
  const botRoutine = (extra: Partial<RoutineDraft> = {}): Partial<RoutineDraft> => ({ name: 'Manhã', prompt: 'Diga as três prioridades.', who: { kind: 'bot', botId: 'chefe' }, cwd: undefined, ...extra })

  it("runs on time through the Chat, and the run's end (with its cost) closes the history", async () => {
    const bots = new FakeBots()
    const { manager, scheduler, save } = setup({ bots })
    const r = save(botRoutine({ schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' } }))
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)
    // never an office agent of its own
    expect(manager.hired).toHaveLength(0)
    expect(bots.calls).toEqual([{ botId: 'chefe', task: 'Diga as três prioridades.', trigger: { kind: 'schedule', routineId: r.id, label: 'De segunda a sexta às 09:00' }, runId: 'run-1' }])
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'running', agentName: 'Chefe de gabinete', scheduledFor: at(2026, 10, 13, 9, 0) })
    bots.end('run-1', 'ok', { costUsd: 0.08123 })
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'ok', costUsd: 0.0812 })
    expect(scheduler.get(r.id)!.history[0].agentId).toBeUndefined()
    // the next one is tomorrow, as for any routine
    expect(scheduler.get(r.id)!.nextAt).toBe(at(2026, 10, 14, 9, 0))
  })

  it("a run that failed keeps its reason; another run's end changes nothing", async () => {
    const bots = new FakeBots()
    const { scheduler, notices, save } = setup({ bots })
    const r = save(botRoutine({ prompt: '' }))
    await scheduler.runNow(r.id)
    // no task: the bot does its job
    expect(bots.calls[0].task).toBe('Faça agora o seu trabalho, como o seu papel descreve.')
    expect(bots.calls[0].trigger).toMatchObject({ label: 'Manhã (rodada à mão)' })
    bots.emit('run:end', { botId: 'chefe', runId: 'outra', threadId: 'chefe', trigger: { kind: 'message' }, status: 'ok' } satisfies BotRunEnd)
    expect(scheduler.get(r.id)!.history[0].status).toBe('running')
    bots.end('run-1', 'failed', { error: 'Teto de custo atingido\nmais linhas' })
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'failed', manual: true, error: 'Teto de custo atingido' })
    // the Chat notifies a bot's failure itself: the scheduler does not repeat it
    expect(notices).toEqual([])
  })

  it('a run that ended before runScheduled answered is still closed', async () => {
    const bots = new FakeBots()
    const { scheduler, save } = setup({ bots })
    const r = save(botRoutine())
    const real = bots.runScheduled.bind(bots)
    bots.runScheduled = async (botId, task, trigger) => {
      const start = await real(botId, task, trigger)
      if ('runId' in start) bots.end(start.runId, 'failed', { error: 'A pasta do andar não existe mais.' })
      return start
    }
    await scheduler.runNow(r.id)
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'failed', error: 'A pasta do andar não existe mais.' })
  })

  it("a bot busy with something else: skipped, with the Chat's reason", async () => {
    const bots = new FakeBots()
    bots.busy.add('chefe')
    const { scheduler, save } = setup({ bots })
    const r = save(botRoutine())
    scheduler.start()
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'skipped', error: expect.stringMatching(/ocupado/) })
  })

  it('a run of its own still going: the next slot is skipped', async () => {
    const bots = new FakeBots()
    const { scheduler, save } = setup({ bots })
    const r = save(botRoutine({ schedule: { kind: 'interval', every: 15, unit: 'minutes' } }))
    scheduler.start()
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 2000)
    expect(bots.calls).toHaveLength(1)
    expect(scheduler.get(r.id)!.history.map((h) => h.status)).toEqual(['skipped', 'running'])
  })

  it.each(['run', 'skip'] as const)('missed with the app closed (%s): runs once on opening, or is recorded as missed', (missed) => {
    const bots = new FakeBots()
    const first = setup({ bots })
    vi.setSystemTime(at(2026, 10, 12, 20, 0))
    const r = first.save(botRoutine({ missed }))
    first.store.flush()
    vi.setSystemTime(at(2026, 10, 13, 11, 30))
    const again = setup({ bots })
    again.scheduler.start()
    const run = again.scheduler.get(r.id)!.history[0]
    if (missed === 'run') {
      expect(bots.calls).toHaveLength(1)
      expect(run).toMatchObject({ status: 'running', note: expect.stringMatching(/Atrasada/) })
    } else {
      expect(bots.calls).toHaveLength(0)
      expect(run).toMatchObject({ status: 'missed', scheduledFor: at(2026, 10, 13, 9, 0) })
    }
  })

  it('the bot was deleted: the run fails with what to do', async () => {
    const bots = new FakeBots()
    const { scheduler, notices, save } = setup({ bots })
    const r = save(botRoutine())
    bots.bots = []
    await scheduler.runNow(r.id)
    expect(scheduler.get(r.id)!.history[0]).toMatchObject({ status: 'failed', error: BOT_GONE })
    expect(BOT_GONE).toBe('O bot desta rotina foi apagado. Edite a rotina ou apague-a.')
    expect(notices[0]).toMatch(/Rotina Manhã falhou/)
    // without the Chat at all, the same
    const none = setup()
    const draft = cleanRoutineDraft({ name: 'Manhã', prompt: 'p', who: { kind: 'bot', botId: 'chefe' }, schedule: { kind: 'daily', time: '09:00' } }, { settings: settings(), agents: [], bots: [{ id: 'chefe' }] })
    const lone = none.scheduler.save(draft)
    await none.scheduler.runNow(lone.id)
    expect(none.scheduler.get(lone.id)!.history[0].error).toBe(BOT_GONE)
  })

  it("pausing a bot's automations pauses its routines; deleting the bot deletes them", () => {
    const bots = new FakeBots()
    const { scheduler, store, save } = setup({ bots })
    const mine = save(botRoutine())
    const other = save({})
    expect(scheduler.setEnabledForBot('chefe', false)).toBe(1)
    expect(scheduler.get(mine.id)).toMatchObject({ enabled: false, nextAt: null })
    expect(scheduler.get(other.id)!.enabled).toBe(true)
    expect(scheduler.setEnabledForBot('chefe', false)).toBe(0)
    expect(scheduler.setEnabledForBot('chefe', true)).toBe(1)
    expect(scheduler.get(mine.id)!.nextAt).toBe(at(2026, 10, 13, 9, 0))
    expect(scheduler.removeForBot('chefe')).toBe(1)
    expect(scheduler.removeForBot('chefe')).toBe(0)
    store.flush()
    expect(new RoutineStore(dir).routines.map((x) => x.id)).toEqual([other.id])
  })

  it('saved and loaded with its runner, with no folder of its own', () => {
    const bots = new FakeBots()
    const { store, save } = setup({ bots })
    const r = save(botRoutine())
    store.flush()
    expect(new RoutineStore(dir).routines[0]).toMatchObject({ id: r.id, who: { kind: 'bot', botId: 'chefe' } })
    expect(r.floor).toBeUndefined()
    expect(r.cwd).toBeUndefined()
    writeFileSync(join(dir, 'routines.json'), JSON.stringify({ routines: [{ id: 'x', name: 'R', prompt: 'p', who: { kind: 'bot' }, schedule: { kind: 'daily', time: '09:00' } }] }))
    expect(new RoutineStore(dir).routines).toEqual([])
  })

  it('validation: a bot that exists, no folder needed, an empty task allowed', () => {
    const base = { name: 'R', prompt: '', who: { kind: 'bot', botId: 'chefe' }, schedule: { kind: 'daily', time: '09:00' } }
    const c = { settings: settings(), agents: [] as AgentSummary[], bots: [{ id: 'chefe' }] }
    expect(cleanRoutineDraft(base, c)).toMatchObject({ who: { kind: 'bot', botId: 'chefe' }, prompt: '' })
    expect(() => cleanRoutineDraft(base, { ...c, bots: [] })).toThrow(/Esse bot não existe mais/)
    expect(() => cleanRoutineDraft(base, { settings: settings(), agents: [] })).toThrow(/Esse bot não existe mais/)
    expect(() => cleanRoutineDraft({ ...base, who: { kind: 'bot', botId: '' } }, c)).toThrow(/inválida/)
  })
})

describe('import', () => {
  it('imported routines arrive paused and never without approvals', () => {
    const exp = parseExport(
      JSON.stringify({
        format: 'agent-office-dados',
        version: 1,
        files: { 'office.json': { settings: {} }, 'routines.json': { routines: [{ id: 'r', enabled: true, nextAt: 5, permissionMode: 'bypassPermissions' }] } },
      }),
    )
    const r = JSON.parse(importSet(exp, '/home/x')['routines.json']!).routines[0]
    expect(r).toMatchObject({ enabled: false, nextAt: null, permissionMode: 'default' })
    expect(existsSync(dir)).toBe(true)
  })
})
