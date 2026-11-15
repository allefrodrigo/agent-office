process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it, vi } from 'vitest'
import type { Bot, BotEventTrigger, ProjectFloor } from '@shared/types'
import type { AutomationResponse } from '@shared/bots-automation'
import { cleanAutomationText, cleanBotId, cleanBotTriggerDraft, cleanFloorId } from '../src/main/bots/automation-validate'
import type { ClaudeRun } from '../src/main/claude-run'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) },
  app: { getPath: () => '/tmp' },
}))

const { botAutomationHandlers, registerBotAutomationsIpc } = await import('../src/main/ipc/bots-automations')

const NOW = new Date(2026, 10, 15, 10, 0).getTime()
const projects: ProjectFloor[] = [{ id: 'p1', name: 'Loja', cwd: '/proj/loja' }]
const bots = [
  { id: 'A', name: 'Chefe', tagline: 'Manhã do andar', floor: 'p1' },
  { id: 'B', name: 'Revisor', tagline: '', floor: 'p1' },
] as Bot[]
const ctx = { bots, projects }
const draft = (over: Record<string, unknown> = {}) => ({ botId: 'A', name: 'Caçar bugs', kind: 'ticket-created', filter: {}, prompt: 'Reproduza {ticket}', ...over })

describe('cleanBotTriggerDraft', () => {
  it('fills the defaults: on, the Chat cap per hour', () => {
    expect(cleanBotTriggerDraft(draft(), ctx)).toEqual({ botId: 'A', name: 'Caçar bugs', kind: 'ticket-created', filter: {}, prompt: 'Reproduza {ticket}', enabled: true, maxPerHour: 6 })
    expect(cleanBotTriggerDraft(draft(), { ...ctx, perHourDefault: 10 }).maxPerHour).toBe(10)
    expect(cleanBotTriggerDraft(draft({ maxPerHour: 99 }), ctx).maxPerHour).toBe(30)
    expect(cleanBotTriggerDraft(draft({ maxPerHour: 0, enabled: false }), ctx)).toMatchObject({ maxPerHour: 1, enabled: false })
  })

  it('refuses what the form could never send', () => {
    expect(() => cleanBotTriggerDraft(null, ctx)).toThrow(/nome/)
    expect(() => cleanBotTriggerDraft(draft({ name: ' ' }), ctx)).toThrow(/nome/)
    expect(() => cleanBotTriggerDraft(draft({ name: 'x'.repeat(61) }), ctx)).toThrow(/nome/)
    expect(() => cleanBotTriggerDraft(draft({ kind: 'webhook' }), ctx)).toThrow(/inválida/)
    expect(() => cleanBotTriggerDraft(draft({ botId: '../x' }), ctx)).toThrow(/inválida/)
    expect(() => cleanBotTriggerDraft(draft({ id: 'a b' }), ctx)).toThrow(/inválida/)
    expect(() => cleanBotTriggerDraft(draft({ filter: { column: 'lixo' } }), ctx)).toThrow(/inválida/)
    expect(() => cleanBotTriggerDraft(draft({ prompt: 'x'.repeat(20_001) }), ctx)).toThrow(/inválida/)
    expect(() => cleanBotTriggerDraft(draft({ prompt: '  ' }), ctx)).toThrow(/Descreva/)
  })

  it('checks the bot and the floor', () => {
    expect(() => cleanBotTriggerDraft(draft({ botId: 'Z' }), ctx)).toThrow(/não existe mais/)
    expect(() => cleanBotTriggerDraft(draft({ filter: { floor: 'p9' } }), ctx)).toThrow(/andar/)
    expect(cleanBotTriggerDraft(draft({ filter: { floor: 'terreo' } }), ctx).filter).toEqual({ floor: 'terreo' })
  })

  it('keeps only the filters the kind uses; tags trimmed, lower case, once', () => {
    const all = { floor: 'p1', tags: [' #Bug', 'bug', '', 'UI'], column: 'review', botId: 'B', onlyOk: true }
    expect(cleanBotTriggerDraft(draft({ filter: all }), ctx).filter).toEqual({ floor: 'p1', tags: ['bug', 'ui'] })
    expect(cleanBotTriggerDraft(draft({ kind: 'ticket-moved', filter: all }), ctx).filter).toEqual({ floor: 'p1', tags: ['bug', 'ui'], column: 'review' })
    expect(cleanBotTriggerDraft(draft({ kind: 'meeting-ata', filter: all }), ctx).filter).toEqual({ floor: 'p1' })
    expect(cleanBotTriggerDraft(draft({ kind: 'bot-done', filter: all }), ctx).filter).toEqual({ botId: 'B', onlyOk: true })
    expect(() => cleanBotTriggerDraft(draft({ filter: { tags: ['x'.repeat(41)] } }), ctx)).toThrow(/40 letras/)
    expect(() => cleanBotTriggerDraft(draft({ filter: { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) } }), ctx)).toThrow(/20 tags/)
  })

  it('a bot never waits on itself, nor on a bot that is gone', () => {
    expect(() => cleanBotTriggerDraft(draft({ kind: 'bot-done', filter: { botId: 'A' } }), ctx)).toThrow(/a si mesmo/)
    expect(() => cleanBotTriggerDraft(draft({ kind: 'bot-done', filter: { botId: 'Z' } }), ctx)).toThrow(/não existe mais/)
  })
})

describe('other arguments', () => {
  it('the sentence, the floor and the bot', () => {
    expect(cleanAutomationText('  toda sexta   às 17h\n resuma ')).toBe('toda sexta às 17h resuma')
    expect(() => cleanAutomationText('oi')).toThrow(/numa frase/)
    expect(() => cleanAutomationText(42)).toThrow(/numa frase/)
    expect(() => cleanAutomationText('x'.repeat(1001))).toThrow(/1.000/)
    expect(cleanFloorId('terreo', projects)).toBe('terreo')
    expect(cleanFloorId('p1', projects)).toBe('p1')
    expect(() => cleanFloorId('p9', projects)).toThrow(/andar/)
    expect(() => cleanFloorId(null, projects)).toThrow(/andar/)
    expect(cleanBotId('A', bots)).toBe('A')
    expect(() => cleanBotId('Z', bots)).toThrow(/não existe mais/)
    expect(() => cleanBotId('../A', bots)).toThrow(/inválido/)
  })
})

describe('IPC handlers', () => {
  function setup() {
    const list: BotEventTrigger[] = []
    const triggers = {
      list: vi.fn(() => list),
      save: vi.fn((d) => ({ ...d, id: 'g1' }) as BotEventTrigger),
      remove: vi.fn(),
      setEnabled: vi.fn((id: string, on: boolean) => ({ id, enabled: on }) as BotEventTrigger),
      setEnabledForBot: vi.fn(() => 1),
    }
    const routines = { setEnabledForBot: vi.fn(() => 2) }
    const book = { recordCategory: vi.fn(() => 0) }
    const runs: ClaudeRun[] = []
    const answer: AutomationResponse = {
      bot: 'Chefe',
      newBot: { name: '', tagline: '', role: '' },
      name: 'Resumo',
      prompt: 'Resuma a semana.',
      when: 'schedule',
      schedule: { kind: 'weekly', at: '', time: '17:00', days: [5], every: 0, unit: 'minutes', expr: '' },
      filter: { tags: [], column: '', bot: '', onlyOk: false },
      why: 'Sextas às 17:00.',
    }
    const deps = {
      triggers,
      routines,
      bots: () => bots,
      settings: () => ({ projects, chat: { maxEventRunsPerHour: 12 } }),
      claudeFor: vi.fn(() => ({ env: { X: '1' }, account: 'conta-2' })),
      scratchDir: () => '/tmp/userdata',
      book,
      run: async (r: ClaudeRun) => {
        runs.push(r)
        return { text: '', structured: answer, costUsd: 0.001 }
      },
      now: () => NOW,
    }
    return { h: botAutomationHandlers(deps), deps, triggers, routines, runs }
  }

  it('registers every phase-2 channel of the preload', () => {
    registerBotAutomationsIpc(setup().deps)
    expect([...handlers.keys()].sort()).toEqual(
      ['office:deleteBotTrigger', 'office:draftAutomation', 'office:listBotTriggers', 'office:saveBotTrigger', 'office:setBotAutomationsEnabled', 'office:setBotTriggerEnabled'].sort(),
    )
    expect(handlers.get('office:listBotTriggers')!({})).toEqual([])
  })

  it('saveBotTrigger cleans the draft first, with the Chat cap as the default', () => {
    const { h, triggers } = setup()
    h['office:saveBotTrigger'](draft())
    expect(triggers.save).toHaveBeenCalledWith(expect.objectContaining({ botId: 'A', maxPerHour: 12, enabled: true }))
    expect(() => h['office:saveBotTrigger'](draft({ botId: 'Z' }))).toThrow(/não existe mais/)
  })

  it('ids and flags are checked', () => {
    const { h, triggers } = setup()
    expect(() => h['office:deleteBotTrigger']('../x')).toThrow(/não existe mais/)
    h['office:deleteBotTrigger']('g1')
    expect(triggers.remove).toHaveBeenCalledWith('g1')
    expect(() => h['office:setBotTriggerEnabled']('g1', 'sim')).toThrow(/inválido/)
    expect(h['office:setBotTriggerEnabled']('g1', false)).toEqual({ id: 'g1', enabled: false })
  })

  it('setBotAutomationsEnabled pauses its routines and its event triggers', () => {
    const { h, triggers, routines } = setup()
    h['office:setBotAutomationsEnabled']('A', false)
    expect(routines.setEnabledForBot).toHaveBeenCalledWith('A', false)
    expect(triggers.setEnabledForBot).toHaveBeenCalledWith('A', false)
    expect(() => h['office:setBotAutomationsEnabled']('Z', false)).toThrow(/não existe mais/)
    expect(() => h['office:setBotAutomationsEnabled']('A', 1)).toThrow(/inválido/)
  })

  it('draftAutomation: on the floor\'s account, in a scratch folder, the cost booked to the floor', async () => {
    const { h, deps, runs } = setup()
    const d = await h['office:draftAutomation']('toda sexta às 17h, resuma a semana', 'p1')
    expect(d).toMatchObject({ bot: { kind: 'existing', botId: 'A' }, when: { kind: 'schedule' } })
    expect(deps.claudeFor).toHaveBeenCalledWith('p1')
    expect(runs[0]).toMatchObject({ cwd: '/tmp/userdata', env: { X: '1' }, model: 'haiku', ledger: { category: 'bots', cwd: '/proj/loja', account: 'conta-2' } })
    expect(runs[0].prompt).toMatch(/^Andar: Loja\n/)
    // the ground floor has no folder: the scratch one books the cost
    await h['office:draftAutomation']('toda sexta às 17h, resuma a semana', 'terreo')
    expect(runs[1].prompt).toMatch(/^Andar: Térreo\n/)
    expect(runs[1].ledger?.cwd).toBe('/tmp/userdata')
    expect(() => h['office:draftAutomation']('oi', 'p1')).toThrow(/numa frase/)
    expect(() => h['office:draftAutomation']('toda sexta às 17h', 'p9')).toThrow(/andar/)
  })
})
