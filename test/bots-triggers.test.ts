process.env.TZ = 'America/Sao_Paulo'

import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { Actor, Bot, BotEventTrigger, Meeting, RunTrigger, Ticket } from '@shared/types'
import { BotTriggers } from '../src/main/bots/triggers'
import type { CleanBotTriggerDraft } from '../src/main/bots/automation-validate'
import type { BotRunEnd, BotRunHost, BotRunStart } from '../src/main/routines'

const T0 = new Date(2026, 10, 15, 10, 0).getTime()
const HOUR = 3_600_000

/** Just enough of the BotRunner: the bots, runScheduled and 'run:end'. */
class FakeBots extends EventEmitter implements BotRunHost {
  bots: Pick<Bot, 'id' | 'name' | 'floor'>[] = [
    { id: 'A', name: 'Chefe', floor: 'p1' },
    { id: 'B', name: 'Revisor', floor: 'p1' },
    { id: 'C', name: 'Vigia', floor: 'p2' },
  ]
  busy = new Set<string>()
  calls: { botId: string; task: string; trigger: RunTrigger; runId?: string }[] = []
  private n = 0

  list = () => this.bots
  async runScheduled(botId: string, task: string, trigger: RunTrigger): Promise<BotRunStart> {
    const call: (typeof this.calls)[number] = { botId, task, trigger }
    this.calls.push(call)
    if (this.busy.has(botId)) return { skipped: 'Pulei a rodada das 10:00: o bot estava ocupado.' }
    call.runId = `run-${++this.n}`
    return { runId: call.runId }
  }
  end(botId: string, runId: string, status: BotRunEnd['status'] = 'ok', text = 'Feito.'): void {
    this.emit('run:end', { botId, runId, threadId: botId, trigger: { kind: 'manual' }, status, text } satisfies BotRunEnd)
  }
}

/** The runs start after an await: let them. */
const settle = () => new Promise((r) => setImmediate(r))

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1',
  key: 'AO-44',
  title: 'Checkout quebra no pix',
  type: 'bug',
  priority: 'high',
  status: 'todo',
  description: 'Passos no carrinho.',
  acceptance: [],
  cwd: '/proj/loja',
  tags: ['bug'],
  reporter: { kind: 'player', name: 'Você' },
  order: 0,
  createdAt: T0,
  updatedAt: T0,
  comments: [],
  activity: [],
  ...over,
})

const meeting = (status: Meeting['status'], floor = 'p1'): Meeting => ({
  id: 'm1',
  floor,
  title: 'Kickoff do checkout',
  template: 'geral',
  attendees: [],
  sources: { mic: true, system: false },
  status,
  startedAt: T0,
  pauses: [],
  counts: { segments: 0, actions: 0, open: 0 },
})

function setup(opts: { tickets?: Ticket[] } = {}) {
  const bots = new FakeBots()
  const store = { eventTriggers: [] as BotEventTrigger[], saves: 0, save() {
    this.saves++
  } }
  let now = T0
  const atas = new Map<string, { markdown: string; actions: string[] }>()
  const agents = new Map<string, string>([
    ['agA', 'A'],
    ['agB', 'B'],
  ])
  const broadcasts: BotEventTrigger[][] = []
  const triggers = new BotTriggers({
    store,
    bots,
    settings: () => ({ projects: [{ id: 'p1', cwd: '/proj/loja' }, { id: 'p2', cwd: '/proj/blog' }] }),
    tickets: () => opts.tickets ?? [],
    ata: (id) => atas.get(id) ?? null,
    botOfAgent: (id) => agents.get(id),
    broadcast: (list) => broadcasts.push(list),
    now: () => now,
  })
  const add = (over: Partial<CleanBotTriggerDraft> = {}) =>
    triggers.save({ botId: 'A', name: 'Gatilho', kind: 'ticket-created', filter: {}, prompt: 'Olhe {ticket}', enabled: true, maxPerHour: 6, ...over })
  const upsert = (t: Ticket) => triggers.handle({ type: 'ticket:upsert', ticket: t })
  return { bots, store, triggers, atas, broadcasts, add, upsert, tick: (ms: number) => (now += ms) }
}

const agent = (id: string): Actor => ({ kind: 'agent', name: 'Agente', id })

describe('ticket criado', () => {
  it('fires with the ticket in the task and a run line', async () => {
    const { bots, triggers, add, upsert } = setup()
    const t = add({ filter: { tags: ['bug'] } })
    upsert(ticket())
    await settle()
    expect(bots.calls).toHaveLength(1)
    expect(bots.calls[0]).toMatchObject({ botId: 'A', trigger: { kind: 'event', triggerId: t.id, label: '🎫 AO-44 criado' } })
    expect(bots.calls[0].task).toMatch(/^Olhe <ticket>\nAO-44 · Checkout quebra no pix/)
    expect(triggers.get(t.id)!.history).toEqual([{ t: T0, status: 'ran' }])
  })

  it('the filters hold: tags, floor, paused', async () => {
    const { bots, add, upsert } = setup()
    add({ filter: { tags: ['feature'] } })
    add({ enabled: false })
    upsert(ticket({ id: 'x1' }))
    // a ticket created on another floor never fires
    add({})
    upsert(ticket({ id: 'x2', cwd: '/proj/blog' }))
    await settle()
    expect(bots.calls).toHaveLength(0)
  })

  it('a bot on another floor sees its own floor; the ground floor has the tickets outside every project', async () => {
    const { bots, add, upsert } = setup()
    add({ botId: 'C' })
    add({ botId: 'B', filter: { floor: 'terreo' } })
    upsert(ticket({ id: 'x1', cwd: '/proj/blog/src' }))
    upsert(ticket({ id: 'x2', cwd: undefined }))
    await settle()
    expect(bots.calls.map((c) => c.botId)).toEqual(['C', 'B'])
  })

  it('an old ticket the board shows again (reopened) is not new', async () => {
    const { bots, add, upsert } = setup()
    add({})
    upsert(ticket({ createdAt: T0 - 2 * 86_400_000 }))
    await settle()
    expect(bots.calls).toHaveLength(0)
  })

  it('a bot never fires on a ticket its own agent created', async () => {
    const { bots, triggers, add, upsert } = setup()
    const own = add({ botId: 'A' })
    add({ botId: 'B' })
    upsert(ticket({ reporter: agent('agA') }))
    await settle()
    expect(bots.calls.map((c) => c.botId)).toEqual(['B'])
    // not news: nothing in its history
    expect(triggers.get(own.id)!.history).toEqual([])
  })
})

describe('ticket mudou de coluna', () => {
  it('fires when the column changes, never on an edit in the same column', async () => {
    const { bots, add, upsert } = setup({ tickets: [ticket()] })
    add({ kind: 'ticket-moved', filter: { column: 'review' } })
    upsert(ticket({ title: 'Outro título', updatedAt: T0 + 1 }))
    upsert(ticket({ status: 'doing' }))
    await settle()
    expect(bots.calls).toHaveLength(0)
    upsert(ticket({ status: 'review', activity: [{ id: 'x', t: T0, actor: { kind: 'player', name: 'Você' }, text: 'moveu' }] }))
    await settle()
    expect(bots.calls).toHaveLength(1)
    expect(bots.calls[0].trigger).toMatchObject({ label: '🎫 AO-44 → Revisão' })
    expect(bots.calls[0].task).toContain('Coluna: Revisão (veio de Fazendo)')
    // an edit after the move does not fire again
    upsert(ticket({ status: 'review', title: 'De novo' }))
    await settle()
    expect(bots.calls).toHaveLength(1)
  })

  it('a ticket created is not "moved"; a removed one starts over', async () => {
    const { bots, triggers, add, upsert } = setup()
    add({ kind: 'ticket-moved' })
    upsert(ticket())
    await settle()
    expect(bots.calls).toHaveLength(0)
    triggers.handle({ type: 'ticket:removed', ticketId: 't1' })
    upsert(ticket({ status: 'doing' }))
    await settle()
    expect(bots.calls).toHaveLength(0)
  })

  it('the bot that moved it is not woken by it', async () => {
    const { bots, add, upsert } = setup({ tickets: [ticket()] })
    add({ kind: 'ticket-moved', botId: 'B' })
    upsert(ticket({ status: 'doing', activity: [{ id: 'x', t: T0, actor: agent('agB'), text: 'moveu' }] }))
    await settle()
    expect(bots.calls).toHaveLength(0)
  })
})

describe('ata pronta', () => {
  it('fires when a new ata is written, with its action items, on the floor', async () => {
    const { bots, triggers, atas, add } = setup()
    add({ kind: 'meeting-ata', prompt: 'Proponha tickets: {ata}' })
    add({ kind: 'meeting-ata', botId: 'C' })
    triggers.handle({ type: 'meeting:upsert', meeting: meeting('ready') })
    triggers.handle({ type: 'meeting:upsert', meeting: meeting('enhancing') })
    atas.set('m1', { markdown: '# Kickoff\n\n- Pix primeiro', actions: ['Bruno integra o pix'] })
    triggers.handle({ type: 'meeting:upsert', meeting: meeting('ready') })
    await settle()
    expect(bots.calls).toHaveLength(1)
    expect(bots.calls[0]).toMatchObject({ botId: 'A', trigger: { label: '📝 Ata: Kickoff do checkout' } })
    expect(bots.calls[0].task).toContain('<ata>\nReunião: Kickoff do checkout\n\n# Kickoff\n\n- Pix primeiro\n\nItens de ação:\n- Bruno integra o pix\n</ata>')
  })

  it('a rewrite that failed (same ata) and an edit of the meeting do not fire', async () => {
    const { bots, triggers, atas, add } = setup()
    add({ kind: 'meeting-ata' })
    atas.set('m1', { markdown: '# Ata antiga', actions: [] })
    triggers.handle({ type: 'meeting:upsert', meeting: meeting('enhancing') })
    triggers.handle({ type: 'meeting:upsert', meeting: meeting('enhancing') })
    triggers.handle({ type: 'meeting:upsert', meeting: meeting('ready') })
    triggers.handle({ type: 'meeting:upsert', meeting: { ...meeting('ready'), title: 'Renomeada' } })
    await settle()
    expect(bots.calls).toHaveLength(0)
    // a meeting deleted and seen again starts over
    triggers.handle({ type: 'meeting:removed', meetingId: 'm1' })
    triggers.handle({ type: 'meeting:upsert', meeting: meeting('ready') })
    await settle()
    expect(bots.calls).toHaveLength(0)
  })
})

describe('outro bot terminou', () => {
  it('fires with the other bot\'s final text; only ok when asked', async () => {
    const { bots, add } = setup()
    add({ kind: 'bot-done', botId: 'A', filter: { botId: 'B', onlyOk: true }, prompt: 'Revise {saida}' })
    bots.end('B', 'manual-1', 'failed')
    await settle()
    expect(bots.calls).toHaveLength(0)
    bots.end('B', 'manual-2', 'ok', 'Três riscos no PR.')
    await settle()
    expect(bots.calls).toHaveLength(1)
    expect(bots.calls[0].trigger).toMatchObject({ label: '🤖 Revisor terminou' })
    expect(bots.calls[0].task).toContain('<saida>\nRevisor terminou:\n\nTrês riscos no PR.\n</saida>')
    // a skipped run never ran: it does not end anything
    bots.end('B', 'manual-3', 'skipped')
    await settle()
    expect(bots.calls).toHaveLength(1)
  })

  it('"any bot" never answers the bot\'s own runs', async () => {
    const { bots, triggers, add } = setup()
    const t = add({ kind: 'bot-done', botId: 'A' })
    bots.end('B', 'manual-1')
    await settle()
    expect(bots.calls.map((c) => c.botId)).toEqual(['A'])
    // A's own run ends: nothing, and nothing in its history
    bots.end('A', bots.calls[0].runId!)
    await settle()
    expect(bots.calls).toHaveLength(1)
    expect(triggers.get(t.id)!.history.map((h) => h.status)).toEqual(['ran'])
  })

  it('a loop A→B→A stops at the third link', async () => {
    const { bots, triggers, add } = setup()
    const aAfterB = add({ kind: 'bot-done', botId: 'A', filter: { botId: 'B' } })
    add({ kind: 'bot-done', botId: 'B', filter: { botId: 'A' } })
    // the player ran A by hand: not a triggered run (depth 0)
    bots.end('A', 'manual-1')
    for (let i = 0; i < 6; i++) {
      await settle()
      const last = bots.calls.at(-1)
      if (!last?.runId || last.runId === 'done') break
      const runId = last.runId
      last.runId = 'done'
      bots.end(last.botId, runId)
    }
    await settle()
    expect(bots.calls.map((c) => c.botId)).toEqual(['B', 'A', 'B'])
    expect(triggers.get(aAfterB.id)!.history[0]).toMatchObject({ status: 'skipped', note: expect.stringMatching(/3º elo/) })
  })

  it('a chain through tickets counts too: a triggered run that creates a ticket passes its depth on', async () => {
    const { bots, triggers, add, upsert } = setup()
    const a = add({ botId: 'A' })
    add({ botId: 'B' })
    // the player creates a ticket: both bots run (depth 1)
    upsert(ticket({ id: 'k0' }))
    await settle()
    expect(bots.calls.map((c) => c.botId)).toEqual(['A', 'B'])
    // each bot's run creates a ticket in turn; the other one answers, one link deeper
    let n = 0
    const create = async (by: string) => {
      upsert(ticket({ id: `k${++n}`, reporter: agent(by) }))
      await settle()
    }
    await create('agB') // A runs at depth 2
    expect(bots.calls.map((c) => c.botId)).toEqual(['A', 'B', 'A'])
    await create('agA') // B runs at depth 3
    expect(bots.calls.map((c) => c.botId)).toEqual(['A', 'B', 'A', 'B'])
    await create('agB') // A would be depth 4: stopped
    expect(bots.calls).toHaveLength(4)
    expect(triggers.get(a.id)!.history[0]).toMatchObject({ status: 'skipped', note: expect.stringMatching(/elo/) })
  })
})

describe('limits and history', () => {
  it('at most maxPerHour runs an hour; the dropped ones fold into one line', async () => {
    const { bots, triggers, add, upsert, tick } = setup()
    const t = add({ maxPerHour: 2 })
    for (let i = 0; i < 5; i++) upsert(ticket({ id: `x${i}` }))
    await settle()
    expect(bots.calls).toHaveLength(2)
    const h = triggers.get(t.id)!.history
    expect(h.map((x) => x.status)).toEqual(['limited', 'ran', 'ran'])
    expect(h[0].note).toMatch(/Limite de 2 rodadas por hora atingido.*3 eventos ignorados/)
    // an hour later it runs again
    tick(HOUR + 1000)
    upsert(ticket({ id: 'x9', createdAt: T0 + HOUR }))
    await settle()
    expect(bots.calls).toHaveLength(3)
  })

  it('a bot busy with something else: skipped with the reason, not counted against the cap', async () => {
    const { bots, triggers, add, upsert } = setup()
    const t = add({ maxPerHour: 1 })
    bots.busy.add('A')
    upsert(ticket({ id: 'x1' }))
    await settle()
    expect(triggers.get(t.id)!.history[0]).toMatchObject({ status: 'skipped', note: expect.stringMatching(/ocupado/) })
    bots.busy.clear()
    upsert(ticket({ id: 'x2' }))
    await settle()
    expect(bots.calls.map((c) => !!c.runId)).toEqual([false, true])
  })

  it('a deleted bot fires nothing', async () => {
    const { bots, add, upsert } = setup()
    add({ botId: 'Z' })
    upsert(ticket())
    await settle()
    expect(bots.calls).toHaveLength(0)
  })

  it('the cap per hour counts what ran before a restart', async () => {
    const first = setup()
    const t = first.add({ maxPerHour: 1 })
    first.upsert(ticket({ id: 'x1' }))
    await settle()
    const again = new BotTriggers({
      store: first.store,
      bots: first.bots,
      settings: () => ({ projects: [{ id: 'p1', cwd: '/proj/loja' }] }),
      tickets: () => [],
      ata: () => null,
      botOfAgent: () => undefined,
      broadcast: () => undefined,
      now: () => T0 + 60_000,
    })
    again.handle({ type: 'ticket:upsert', ticket: ticket({ id: 'x2' }) })
    await settle()
    expect(first.bots.calls).toHaveLength(1)
    expect(again.get(t.id)!.history[0].status).toBe('limited')
  })
})

describe('changes', () => {
  it('save keeps the history when only the details change; edit, pause, delete broadcast the list', () => {
    const { store, triggers, broadcasts, add } = setup()
    const t = add({})
    t.history = [{ t: T0, status: 'ran' }]
    const edited = add({ id: t.id, name: 'Renomeado', prompt: 'Outra coisa {ticket}' })
    expect(edited).toMatchObject({ id: t.id, name: 'Renomeado', createdAt: T0, history: [{ t: T0, status: 'ran' }] })
    // another kind of event starts a new history
    expect(add({ id: t.id, kind: 'meeting-ata' }).history).toEqual([])
    expect(triggers.setEnabled(t.id, false).enabled).toBe(false)
    expect(() => triggers.setEnabled('nada', true)).toThrow(/não existe mais/)
    triggers.remove(t.id)
    expect(store.eventTriggers).toEqual([])
    expect(broadcasts.length).toBeGreaterThanOrEqual(4)
    expect(broadcasts.at(-1)).toEqual([])
  })

  it('at most BOT_LIMITS.eventTriggers', () => {
    const { add } = setup()
    for (let i = 0; i < 100; i++) add({})
    expect(() => add({})).toThrow(/Limite de 100/)
  })

  it('pausing a bot pauses its triggers; deleting it removes them and pauses the ones waiting on it', () => {
    const { triggers, add } = setup()
    const a1 = add({ botId: 'A' })
    const a2 = add({ botId: 'A', kind: 'meeting-ata' })
    const b = add({ botId: 'B', kind: 'bot-done', filter: { botId: 'A' } })
    expect(triggers.setEnabledForBot('A', false)).toBe(2)
    expect(triggers.setEnabledForBot('A', false)).toBe(0)
    expect([triggers.get(a1.id)!.enabled, triggers.get(a2.id)!.enabled, triggers.get(b.id)!.enabled]).toEqual([false, false, true])
    expect(triggers.removeForBot('A')).toBe(2)
    expect(triggers.list().map((t) => t.id)).toEqual([b.id])
    expect(triggers.get(b.id)!.enabled).toBe(false)
    expect(triggers.removeForBot('A')).toBe(0)
  })
})
