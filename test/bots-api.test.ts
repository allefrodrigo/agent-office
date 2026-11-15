process.env.TZ = 'America/Sao_Paulo'

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOT_COLORS, BOT_LIMITS, SENSITIVE_KINDS, type Bot, type BotEventTrigger, type Channel, type ChatSettings, type OfficeEvent } from '@shared/types'
import { botsApi, type BotsApi } from '../src/main/bots/api'
import { BotRunner } from '../src/main/bots/runner'
import { BotStore } from '../src/main/bots/store'
import { startBotDemo } from '../src/main/demo'
import type { AgentManager } from '../src/main/agents'
import { FakeManager, makeBot } from './helpers/bots'

let dir: string
let project: string
let store: BotStore
let manager: FakeManager
let runner: BotRunner
let api: BotsApi
let events: OfficeEvent[]

const draft = (extra: Record<string, unknown> = {}) => ({ name: 'Rita', role: 'Resume o dia.', floor: 'terreo', cwd: project, ...extra })
const kindsOf = (type: OfficeEvent['type']) => events.filter((e) => e.type === type)

function setup(bots: Bot[] = [makeBot(project)]): void {
  store = new BotStore(dir)
  store.bots = bots
  manager = new FakeManager(project)
  events = []
  runner = new BotRunner({
    store,
    manager,
    settings: () => ({ projects: [], chat: {} as ChatSettings }),
    broadcast: (e) => events.push(e),
    notify: () => undefined,
  })
  api = botsApi({ store, runner, settings: () => ({ projects: [], accounts: [] }), broadcast: (e) => events.push(e), now: () => 1_000 })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bots-api-'))
  project = join(dir, 'projeto')
  mkdirSync(project)
  setup()
})

afterEach(() => {
  runner.dispose()
  store.flush()
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('botsApi: criar, editar, apagar e duplicar', () => {
  it('cria um bot com os padrões e o manda para a lista', () => {
    const bot = api.saveBot(draft())
    expect(bot).toMatchObject({ name: 'Rita', floor: 'terreo', cwd: project, permissionMode: 'default', apps: 'all', worktree: false, pinned: false, runs: [] })
    expect(bot.askBefore).toEqual([...SENSITIVE_KINDS])
    expect(bot.color).toBe(BOT_COLORS[0])
    expect(bot.id).not.toBe('gabi')
    expect(bot.order).toBe(1)
    expect(bot.lastReadAt).toBe(1_000)
    expect(store.bot(bot.id)).toBeDefined()
    expect(api.listBots().map((b) => b.name)).toEqual(['Gabi', 'Rita'])
    expect(kindsOf('bots')).toHaveLength(1)
  })

  it('recusa "Sem pedir nada", nome vazio, pasta que não existe e lixo', () => {
    expect(() => api.saveBot(draft({ permissionMode: 'bypassPermissions' }))).toThrow('Sem pedir nada')
    expect(() => api.saveBot(draft({ name: '  ' }))).toThrow('Dê um nome')
    expect(() => api.saveBot(draft({ cwd: join(dir, 'sumiu') }))).toThrow()
    expect(() => api.saveBot(null)).toThrow()
    expect(() => api.saveBot(draft({ floor: 'andar-que-nao-existe', cwd: undefined }))).toThrow()
    expect(store.bots).toHaveLength(1)
  })

  it('recusa criar além do limite', () => {
    setup(Array.from({ length: BOT_LIMITS.count }, (_, i) => makeBot(project, { id: `b${i}`, name: `B${i}` })))
    expect(() => api.saveBot(draft())).toThrow('Limite')
    expect(() => api.duplicateBot('b0')).toThrow('Limite')
  })

  it('editar guarda as rodadas, a conversa e a leitura; tira o modelo que o formulário não mandou', () => {
    const run = { id: 'r1', trigger: { kind: 'message' as const }, startedAt: 0, status: 'ok' as const, steps: 1, threadId: 'gabi', itemId: 'i1' }
    setup([makeBot(project, { model: 'opus', sessionId: 's1', lastReadAt: 50, runs: [run], pinned: true })])
    const bot = api.saveBot(draft({ id: 'gabi', name: 'Gabi 2' }))
    expect(bot).toMatchObject({ id: 'gabi', name: 'Gabi 2', sessionId: 's1', lastReadAt: 50, pinned: true, updatedAt: 1_000 })
    expect(bot.runs).toHaveLength(1)
    expect(bot).not.toHaveProperty('model')
    expect(store.bots).toHaveLength(1)
  })

  it('apagar leva a pasta, as automações e o lugar nos canais', () => {
    api.saveBotMemory('gabi', 'Prefere tópicos.')
    const folder = join(dir, 'bots', 'gabi')
    store.flush()
    expect(existsSync(folder)).toBe(true)
    const trigger = { id: 't1', botId: 'gabi', name: 'Ticket novo', kind: 'ticket-created', filter: {}, prompt: 'Leia {ticket}', enabled: true, maxPerHour: 6, createdAt: 0 } as unknown as BotEventTrigger
    store.eventTriggers = [trigger]
    const channel: Channel = { id: 'c1', name: 'geral', floor: 'terreo', topic: '', members: ['gabi', 'outro'], createdAt: 0, updatedAt: 0, lastReadAt: 0, order: 0 }
    store.channels = [channel]
    api.deleteBot('gabi')
    expect(store.bots).toHaveLength(0)
    expect(existsSync(folder)).toBe(false)
    expect(store.eventTriggers).toEqual([])
    expect(store.channels[0].members).toEqual(['outro'])
    expect(kindsOf('botTriggers')).toHaveLength(1)
    expect(kindsOf('channels')).toHaveLength(1)
    expect(() => api.deleteBot('gabi')).toThrow('não existe mais')
    expect(() => api.deleteBot('../fora')).toThrow()
  })

  it('duplicar copia o trabalho e a memória, sem conversa nem rodadas', () => {
    setup([makeBot(project, { sessionId: 's1', agentId: 'a9', pinned: true })])
    api.saveBotMemory('gabi', 'Prefere tópicos.')
    const copy = api.duplicateBot('gabi')
    expect(copy.name).toBe('Gabi (cópia)')
    expect(copy).toMatchObject({ role: makeBot(project).role, pinned: false, runs: [] })
    expect(copy).not.toHaveProperty('sessionId')
    expect(copy).not.toHaveProperty('agentId')
    expect(api.botMemory(copy.id)).toBe('Prefere tópicos.')
  })
})

describe('botsApi: o fio e a lista', () => {
  it('marca, lê a página e procura', async () => {
    api.setBotFlags('gabi', { pinned: true, order: 3 })
    expect(store.bot('gabi')).toMatchObject({ pinned: true, order: 3 })
    expect(() => api.setBotFlags('gabi', { pinned: 'sim' })).toThrow('Ajuste inválido')
    expect(() => api.setBotFlags('gabi', { name: 'x' })).toThrow('Ajuste inválido')

    await api.sendToBot('gabi', 'Resumo do checkout', [])
    expect(manager.sent.map((s) => s.text)).toEqual(['Resumo do checkout'])
    await expect(api.sendToBot('gabi', 42, [])).rejects.toThrow('Mensagem')
    await expect(api.sendToBot('gabi', 'x', 'não é lista')).rejects.toThrow('Anexos')

    const page = api.botThread('gabi', {})
    expect(page.items.map((i) => i.kind)).toEqual(['user', 'run'])
    expect(api.botThread('gabi', { limit: 1 }).items).toHaveLength(1)
    expect(() => api.botThread('gabi', { limit: 0 })).toThrow('Página')
    expect(() => api.botThread('sumiu', {})).toThrow('não existe mais')

    expect(api.searchBots('checkout', undefined).map((h) => h.threadId)).toEqual(['gabi'])
    expect(api.searchBots('checkout', 'outro-andar')).toEqual([])
    expect(api.searchBots('  ', undefined)).toEqual([])
    expect(() => api.searchBots(7, undefined)).toThrow('Busca')

    api.markBotRead('gabi', 500)
    expect(store.bot('gabi')?.lastReadAt).toBe(500)
    api.markBotRead('gabi', undefined)
    expect(store.bot('gabi')?.lastReadAt).toBe(1_000)
    expect(() => api.markBotRead('gabi', -1)).toThrow('Hora')
  })

  it('marca um canal como lido', () => {
    store.channels = [{ id: 'c1', name: 'geral', floor: 'terreo', topic: '', members: [], createdAt: 0, updatedAt: 0, lastReadAt: 0, order: 0 }]
    api.markBotRead('c1', 700)
    expect(store.channels[0].lastReadAt).toBe(700)
    expect(kindsOf('channels')).toHaveLength(1)
  })

  it('rodar agora, parar, conversa nova e cérebro', async () => {
    await api.runBotNow('gabi')
    const agentId = store.bot('gabi')!.agentId!
    expect(manager.sent).toHaveLength(1)
    await api.stopBot('gabi')
    expect(manager.interrupted).toEqual([agentId])
    manager.result(agentId, 'Parei.')
    api.newBotConversation('gabi')
    expect(api.configureBot('gabi', { model: 'sonnet', effort: 'high' })).toMatchObject({ model: 'sonnet', effort: 'high' })
    expect(api.configureBot('gabi', { model: '', effort: '' })).not.toHaveProperty('model')
    expect(() => api.configureBot('gabi', { effort: 'turbo' })).toThrow('Modelo ou esforço')
    expect(() => api.runBotNow(42)).toThrow()
  })

  it('memória: lê, salva e recusa segredo', () => {
    expect(api.botMemory('gabi')).toBe('')
    api.saveBotMemory('gabi', 'Fala português.')
    expect(api.botMemory('gabi')).toBe('Fala português.')
    expect(() => api.saveBotMemory('gabi', 'token: abcdef123456')).toThrow('chave, senha ou token')
    expect(() => api.saveBotMemory('gabi', 'x'.repeat(BOT_LIMITS.memoryBytes * 4 + 1))).toThrow('memória')
    expect(() => api.saveBotMemory('gabi', 3)).toThrow()
  })

  it('gasto: as rodadas dizem, sem livro de custos', () => {
    const t = new Date(2026, 10, 15, 12).getTime()
    vi.useFakeTimers({ now: t, toFake: ['Date'] })
    const day = 86_400_000
    const run = (id: string, startedAt: number, costUsd: number) => ({ id, trigger: { kind: 'message' as const }, startedAt, status: 'ok' as const, steps: 0, costUsd, threadId: 'gabi', itemId: id })
    setup([makeBot(project, { runs: [run('a', t - 1000, 0.1), run('b', t - 3 * day, 0.2), run('c', t - 20 * day, 0.3), run('d', t - 40 * day, 1)] })])
    runner = new BotRunner({ store, manager, settings: () => ({ projects: [], chat: {} as ChatSettings }), broadcast: () => undefined, notify: () => undefined, now: () => t })
    api = botsApi({ store, runner, settings: () => ({ projects: [], accounts: [] }), broadcast: () => undefined })
    expect(api.botSpend('gabi')).toEqual({ today: 0.1, week: 0.3, month: 0.6 })
    expect(() => api.botSpend('sumiu')).toThrow('não existe mais')
  })
})

describe('demonstração', () => {
  it('três bots com os fios prontos, nunca salvos', () => {
    vi.useFakeTimers()
    setup([])
    startBotDemo(manager as unknown as AgentManager, store, runner)
    const bots = api.listBots()
    expect(bots.map((b) => b.name)).toEqual(['Aurora', 'Guarda', 'Teo'])
    expect(bots.every((b) => b.demo)).toBe(true)
    const aurora = bots[0]
    expect(aurora.unread).toBe(1)
    expect(aurora.last?.from).toBe('bot')
    expect(api.botThread(aurora.id, {}).items.map((i) => i.kind)).toEqual(['run', 'bot'])
    expect(api.botThread(bots[2].id, {}).items.map((i) => i.kind)).toEqual(['user', 'run', 'bot'])
    expect(api.botSpend(aurora.id).today).toBeGreaterThan(0)
    store.flush()
    expect(new BotStore(dir).bots).toEqual([])
  })
})
