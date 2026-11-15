process.env.TZ = 'America/Sao_Paulo'

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SENSITIVE_KINDS, type AgentResult, type AgentSummary, type Bot, type ChatSettings, type OfficeEvent, type ThreadItem, type WorktreeInfo } from '@shared/types'
import { BotRunner, type BotRunEnd, type BotRunWait } from '../src/main/bots/runner'
import { BotStore } from '../src/main/bots/store'
import { FakeManager, makeBot as baseBot } from './helpers/bots'

const makeBot = (extra: Partial<Bot> = {}): Bot => baseBot(project, extra)

let dir: string
let project: string

let store: BotStore
let manager: FakeManager
let runner: BotRunner
let events: OfficeEvent[]
let notes: { title: string; body: string; threadId: string }[]
let chat: Partial<ChatSettings>
let projects: { id: string; name: string; cwd: string }[]

const thread = (id = 'gabi'): ThreadItem[] => store.thread(id).all()
const kinds = (id = 'gabi') => thread(id).map((i) => i.kind)
const lastOf = <K extends ThreadItem['kind']>(kind: K, id = 'gabi') => thread(id).filter((i) => i.kind === kind).at(-1) as Extract<ThreadItem, { kind: K }> | undefined
const bot = (id = 'gabi') => store.bot(id)!
const tick = () => new Promise((r) => setImmediate(r))

function setup(bots: Bot[] = [makeBot()]): void {
  runner?.dispose()
  store?.flush()
  store = new BotStore(dir)
  store.bots = bots
  manager = new FakeManager(project)
  events = []
  notes = []
  runner = new BotRunner({
    store,
    manager,
    settings: () => ({ projects: projects as never, chat: chat as ChatSettings }),
    broadcast: (e) => events.push(e),
    notify: (title, body, threadId) => notes.push({ title, body, threadId }),
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bots-runner-'))
  project = join(dir, 'projeto')
  mkdirSync(project)
  chat = {}
  projects = []
  setup()
})

afterEach(() => {
  runner.dispose()
  store.flush()
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
  // The next test's setup must not write into this folder.
  store = undefined as unknown as BotStore
  runner = undefined as unknown as BotRunner
})

describe('BotRunner: mensagens e rodadas', () => {
  it('a primeira mensagem contrata o agente; a segunda reaproveita', async () => {
    await runner.send('gabi', 'Bom dia')
    expect(manager.summoned).toHaveLength(1)
    expect(manager.summoned[0].as).toMatchObject({ bot: 'gabi', name: 'Gabi' })
    const agentId = bot().agentId!
    expect(manager.agent(agentId)?.bot).toBe('gabi')
    expect(kinds()).toEqual(['user', 'run'])
    manager.result(agentId, 'Feito.')
    await runner.send('gabi', 'De novo')
    expect(manager.summoned).toHaveLength(1)
    expect(manager.sent.map((s) => s.id)).toEqual([agentId, agentId])
  })

  it('a rodada conta os passos, mostra a atividade e fecha com o balão e o custo', async () => {
    await runner.send('gabi', 'Resuma o dia')
    const agentId = bot().agentId!
    manager.log(agentId, 'tool', 'npm test', 'Bash')
    manager.setBusy(agentId, 'working', 'Rodando npm test')
    manager.log(agentId, 'assistant', 'Vou ler os tickets.')
    manager.log(agentId, 'tool', 'tickets_list', 'mcp__office__tickets_list')
    let run = lastOf('run')!
    expect(run).toMatchObject({ status: 'running', steps: 2, activity: 'Rodando npm test', label: 'Mensagem' })
    manager.result(agentId, 'Tudo certo: 3 tickets novos.', false, 0.0812)
    run = lastOf('run')!
    expect(run).toMatchObject({ status: 'ok', steps: 2, costUsd: 0.0812 })
    expect(run.activity).toBeUndefined()
    expect(lastOf('bot')).toMatchObject({ text: 'Tudo certo: 3 tickets novos.', runId: run.runId })
    expect(bot().runs[0]).toMatchObject({ status: 'ok', steps: 2, costUsd: 0.0812, itemId: run.id, threadId: 'gabi' })
    expect(bot().sessionId).toBe(manager.agent(agentId)!.sessionId)
    expect(events.some((e) => e.type === 'bot:item')).toBe(true)
    expect(events.some((e) => e.type === 'bots')).toBe(true)
  })

  it('resultado vazio usa o que o bot disse por último; erro vira aviso vermelho e notifica', async () => {
    await runner.send('gabi', 'Oi')
    const agentId = bot().agentId!
    manager.log(agentId, 'assistant', 'Olá! Tudo pronto.')
    manager.result(agentId, '')
    expect(lastOf('bot')?.text).toBe('Olá! Tudo pronto.')
    await runner.send('gabi', 'Quebre')
    manager.result(agentId, 'Tive um problema e parei', true)
    expect(lastOf('run')).toMatchObject({ status: 'failed', error: 'Tive um problema e parei' })
    expect(lastOf('notice')).toMatchObject({ tone: 'error' })
    expect(notes.at(-1)).toMatchObject({ title: 'Gabi: a rodada falhou', threadId: 'gabi' })
  })

  it('notifica respostas só com chat.notify = all; off cala tudo', async () => {
    chat = { notify: 'all' }
    await runner.send('gabi', 'Oi')
    manager.result(bot().agentId!, 'Oi!')
    expect(notes.at(-1)).toMatchObject({ title: 'Gabi respondeu', body: 'Oi!' })
    chat = { notify: 'off' }
    await runner.send('gabi', 'Oi')
    manager.result(bot().agentId!, 'Erro', true)
    expect(notes).toHaveLength(1)
  })

  it('mensagem enquanto trabalha entra na fila e vira a rodada seguinte', async () => {
    await runner.send('gabi', 'Primeira')
    const agentId = bot().agentId!
    await runner.send('gabi', 'Segunda')
    expect(kinds()).toEqual(['user', 'run', 'user'])
    manager.result(agentId, 'Resposta 1')
    expect(kinds()).toEqual(['user', 'run', 'user', 'bot', 'run'])
    expect(lastOf('run')?.status).toBe('running')
    manager.result(agentId, 'Resposta 2')
    expect(thread().filter((i) => i.kind === 'run').map((i) => (i as { status: string }).status)).toEqual(['ok', 'ok'])
    expect(bot().runs).toHaveLength(2)
  })

  it('mensagem escrita no painel do escritório também abre rodada', async () => {
    await runner.send('gabi', 'Oi')
    const agentId = bot().agentId!
    manager.result(agentId, 'Oi!')
    manager.log(agentId, 'user', 'Pelo painel')
    manager.setBusy(agentId, 'working', 'Lendo')
    expect(lastOf('user')?.text).toBe('Pelo painel')
    expect(lastOf('run')?.status).toBe('running')
  })

  it('anexo que não pode ir: a rodada some e o erro volta para o compositor', async () => {
    manager.failAttachments = true
    await expect(runner.send('gabi', 'Veja', [{ name: 'x.bin', dataBase64: 'AA==' }])).rejects.toThrow('não pode ir')
    expect(thread()).toEqual([])
    expect(bot().runs).toEqual([])
  })

  it('teto do agente atingido no envio fecha a rodada na hora', async () => {
    await runner.ensureAgent('gabi')
    manager.broke.add(bot().agentId!)
    await runner.send('gabi', 'Oi')
    expect(kinds()).toEqual(['user', 'run', 'notice'])
    expect(lastOf('run')?.status).toBe('failed')
    expect(runner.activeRun('gabi')).toBeUndefined()
  })

  it('!comando roda na pasta do bot e a saída volta como aviso', async () => {
    await runner.send('gabi', '!ls')
    expect(manager.commands).toEqual(['ls'])
    expect(kinds()).toEqual(['user', 'notice'])
    expect(lastOf('user')?.text).toBe('! ls')
    expect(lastOf('notice')?.text).toContain('README.md')
    expect(bot().runs).toEqual([])
  })

  it('mensagem vazia não faz nada; bot que não existe dá erro em português', async () => {
    await runner.send('gabi', '   ')
    expect(manager.summoned).toHaveLength(0)
    await expect(runner.send('nada', 'oi')).rejects.toThrow('Esse bot não existe mais')
  })

  it('pasta que sumiu: erro que diz o que fazer', async () => {
    store.update({ ...bot(), cwd: join(dir, 'sumiu') })
    await expect(runner.send('gabi', 'oi')).rejects.toThrow('Abra o perfil do bot e escolha outra')
    store.update({ ...bot(), floor: 'andar-x' })
    await expect(runner.send('gabi', 'oi')).rejects.toThrow('O andar de Gabi não existe mais')
  })

  it('bot de andar usa a pasta do andar', async () => {
    projects = [{ id: 'loja', name: 'Loja', cwd: project }]
    store.update({ ...bot(), floor: 'loja', cwd: undefined })
    await runner.send('gabi', 'oi')
    expect(manager.summoned[0].cwd).toBe(project)
  })
})

describe('BotRunner: o agente sai e volta', () => {
  it('depois da caveira, chama de volta com a mesma conversa', async () => {
    await runner.send('gabi', 'Oi')
    const agentId = bot().agentId!
    manager.result(agentId, 'Oi!')
    const sessionId = bot().sessionId!
    manager.fire(agentId)
    expect(bot().agentId).toBeUndefined()
    await runner.send('gabi', 'Voltei')
    expect(manager.recalled).toEqual([{ sessionId, worktree: undefined }])
    expect(manager.summoned).toHaveLength(1)
  })

  it('agente que sai no meio da rodada fecha a rodada como falha', async () => {
    await runner.send('gabi', 'Oi')
    manager.fire(bot().agentId!)
    expect(lastOf('run')).toMatchObject({ status: 'failed', error: 'O agente do bot saiu do escritório antes de terminar.' })
  })

  it('worktree: volta na mesma cópia isolada; sem ela, começa conversa nova', async () => {
    const wt: WorktreeInfo = { path: project, root: project, repo: project, branch: 'agent/gabi', base: 'abc' }
    store.update({ ...bot(), worktree: true, sessionId: 's-velha' })
    store.setWorktree('gabi', wt)
    await runner.ensureAgent('gabi')
    expect(manager.recalled).toEqual([{ sessionId: 's-velha', worktree: wt }])
    manager.fire(bot().agentId!)
    store.setWorktree('gabi', { ...wt, path: join(dir, 'sumiu') })
    await runner.ensureAgent('gabi')
    expect(manager.summoned).toHaveLength(1)
    expect(manager.summoned[0].worktree).toBe(true)
  })

  it('no começo, acha o agente do bot que voltou com o escritório', () => {
    const a = manager.add({ bot: 'gabi' })
    setup([makeBot()])
    manager.agents.set(a.id, a)
    runner.start()
    expect(bot().agentId).toBe(a.id)
  })

  it('agente parado há chat.idleLeaveMin sai do escritório; com resultado pendente, fica', async () => {
    chat = { idleLeaveMin: 30 }
    await runner.send('gabi', 'Oi')
    const agentId = bot().agentId!
    manager.result(agentId, 'Oi!')
    const a = manager.agent(agentId)!
    a.lastTurnAt = Date.now() - 31 * 60_000
    a.createdAt = 0
    // touched by the runner just now: rewind it through a fresh runner clock
    const later = Date.now() + 31 * 60_000
    ;(runner as unknown as { now: () => number }).now = () => later
    manager.results = [{ agentId } as AgentResult]
    runner.sweep()
    expect(manager.fired).toEqual([])
    manager.results = []
    runner.sweep()
    expect(manager.fired).toEqual([agentId])
    expect(bot().agentId).toBeUndefined()
    expect(bot().sessionId).toBe(a.sessionId)
  })

  it('idleLeaveMin = 0 nunca dispensa', async () => {
    chat = { idleLeaveMin: 0 }
    await runner.ensureAgent('gabi')
    ;(runner as unknown as { now: () => number }).now = () => Date.now() + 10 * 3600_000
    runner.sweep()
    expect(manager.fired).toEqual([])
  })
})

describe('BotRunner: aprovações', () => {
  it('pedido sensível vira item sem "Sempre permitir"; a rodada espera; a decisão atualiza o item', async () => {
    await runner.send('gabi', 'Publique')
    const agentId = bot().agentId!
    const req = manager.ask(agentId, {}, 'push')
    const item = lastOf('approval')!
    expect(item).toMatchObject({ status: 'pending', requestId: req.id, botId: 'gabi' })
    expect(item.request).toMatchObject({ sensitive: 'push', canAlwaysAllow: false, title: 'Rodar git push' })
    expect(item.request).not.toHaveProperty('input')
    expect(lastOf('run')?.status).toBe('waiting')
    expect(bot().runs[0].status).toBe('waiting')
    expect(notes.at(-1)).toMatchObject({ title: 'Gabi espera seu sim', threadId: 'gabi' })
    manager.decide(req, { behavior: 'allow' })
    expect(lastOf('approval')).toMatchObject({ status: 'allowed' })
    expect(lastOf('approval')?.decidedAt).toBeTypeOf('number')
    expect(lastOf('run')?.status).toBe('running')
  })

  it('run:wait e run:resume saem quando a rodada para no seu sim e quando volta', async () => {
    const waits: string[] = []
    runner.on('run:wait', (e: BotRunWait) => waits.push(`wait:${e.botId}:${e.runId}`))
    runner.on('run:resume', (e: BotRunWait) => waits.push(`resume:${e.botId}:${e.runId}`))
    const start = await runner.send('gabi', 'Publique')
    const runId = 'runId' in start ? start.runId : ''
    const req = manager.ask(bot().agentId!, {}, 'push')
    manager.decide(req, { behavior: 'allow' })
    await tick()
    expect(waits).toEqual([`wait:gabi:${runId}`, `resume:gabi:${runId}`])
  })

  it('negado com motivo, pergunta respondida e pedido cancelado', async () => {
    await runner.send('gabi', 'x')
    const agentId = bot().agentId!
    const a = manager.ask(agentId)
    manager.decide(a, { behavior: 'deny', message: 'Agora não' })
    expect(lastOf('approval')).toMatchObject({ status: 'denied', note: 'Agora não' })
    const q = manager.ask(agentId, { kind: 'question', title: 'Qual?' })
    expect(notes.at(-1)?.title).toBe('Gabi tem uma pergunta')
    manager.decide(q, { behavior: 'allow', answers: { Qual: 'A' } })
    expect(lastOf('approval')).toMatchObject({ status: 'answered', note: 'A' })
    const c = manager.ask(agentId)
    manager.decide(c, { behavior: 'deny', message: 'Interrompido pelo usuário.' }, true)
    expect(lastOf('approval')).toMatchObject({ status: 'expired' })
  })
})

describe('BotRunner: parar, rodar agora, automações, conversa nova', () => {
  it('Parar interrompe; o resultado do turno interrompido fecha a rodada sem balão', async () => {
    await runner.send('gabi', 'Longo')
    const agentId = bot().agentId!
    await runner.stop('gabi')
    expect(manager.interrupted).toEqual([agentId])
    manager.result(agentId, 'Parei: error_during_execution', true)
    expect(lastOf('run')).toMatchObject({ status: 'failed', error: 'Você parou esta rodada.' })
    expect(lastOf('notice')).toMatchObject({ text: 'Você parou esta rodada.', tone: 'info' })
    expect(lastOf('bot')).toBeUndefined()
    expect(notes).toEqual([])
  })

  it('Parar sem resultado fecha a rodada depois de um tempo; o resultado atrasado é ignorado', async () => {
    vi.useFakeTimers()
    await runner.send('gabi', 'Longo')
    const agentId = bot().agentId!
    await runner.stop('gabi')
    vi.advanceTimersByTime(5_100)
    expect(lastOf('run')?.status).toBe('failed')
    const before = thread().length
    manager.result(agentId, 'atrasado')
    expect(thread()).toHaveLength(before)
  })

  it('Rodar agora manda o cabeçalho sem mostrar como mensagem sua; ocupado dá erro', async () => {
    await runner.runNow('gabi')
    const sent = manager.sent.at(-1)!
    expect(sent.text).toMatch(/^Rodar agora · \d\d\/\d\d \d\d:\d\d/)
    expect(sent.display).toBe('Rodar agora')
    expect(kinds()).toEqual(['run'])
    expect(lastOf('run')).toMatchObject({ label: 'Rodar agora', trigger: { kind: 'manual' } })
    await expect(runner.runNow('gabi')).rejects.toThrow('Gabi está trabalhando')
  })

  it('automação: conversa nova, cabeçalho, tarefa e as últimas mensagens do fio', async () => {
    await runner.send('gabi', 'Prefiro tópicos curtos')
    manager.result(bot().agentId!, 'Anotado.')
    const start = await runner.runScheduled('gabi', 'Resuma a manhã.', { kind: 'schedule', routineId: 'r1', label: 'Dias úteis às 07:30' })
    expect(start).toEqual({ runId: lastOf('run')!.runId })
    expect(manager.cleared).toEqual([bot().agentId])
    expect(manager.configured.at(-1)?.patch).toMatchObject({ permissionMode: 'default' })
    const text = manager.sent.at(-1)!.text
    expect(text).toContain('Automação "Dias úteis às 07:30"')
    expect(text).toContain('Resuma a manhã.')
    expect(text).toContain('Você: Prefiro tópicos curtos')
    expect(text).toContain('Gabi: Anotado.')
    expect(lastOf('run')?.label).toBe('⚡ Dias úteis às 07:30')
    // The cleared conversation is not the one to resume.
    expect(bot().sessionId).toBeUndefined()
  })

  it('automação com o bot ocupado vira rodada pulada com aviso', async () => {
    await runner.send('gabi', 'Longo')
    const start = await runner.runScheduled('gabi', 'x', { kind: 'event', triggerId: 't1', label: '🎫 AO-44 criado' })
    expect(start).toEqual({ skipped: lastOf('notice')!.text })
    expect(thread().filter((i) => i.kind === 'run').map((i) => (i as { status: string }).status)).toEqual(['running', 'skipped'])
    expect(lastOf('notice')?.text).toMatch(/^Pulei a rodada das \d\d:\d\d: Gabi estava ocupado\.$/)
    expect(bot().runs[0]).toMatchObject({ status: 'skipped' })
  })

  it('automação com a pasta sumida vira falha com aviso e notificação', async () => {
    store.update({ ...bot(), cwd: join(dir, 'sumiu') })
    const ends: BotRunEnd[] = []
    runner.on('run:end', (e: BotRunEnd) => ends.push(e))
    const start = await runner.runScheduled('gabi', 'x', { kind: 'manual' })
    expect(start).toEqual({ runId: lastOf('run')!.runId })
    expect(lastOf('run')?.status).toBe('failed')
    expect(notes.at(-1)?.title).toBe('Gabi: a rodada falhou')
    await tick()
    expect(ends).toEqual([expect.objectContaining({ botId: 'gabi', status: 'failed', threadId: 'gabi' })])
    expect(await runner.runScheduled('nada', 'x', { kind: 'manual' })).toEqual({ skipped: 'Esse bot não existe mais.' })
  })

  it('Nova conversa limpa o contexto e avisa; com o bot trabalhando, recusa', async () => {
    await runner.send('gabi', 'Oi')
    const agentId = bot().agentId!
    expect(() => runner.newConversation('gabi')).toThrow('Pare a rodada antes')
    manager.result(agentId, 'Oi!')
    runner.newConversation('gabi')
    expect(manager.cleared).toEqual([agentId])
    expect(bot().sessionId).toBeUndefined()
    expect(lastOf('notice')?.text).toContain('Nova conversa')
  })

  it('configure troca modelo e esforço do bot e do agente', async () => {
    await runner.ensureAgent('gabi')
    const b = runner.configure('gabi', { model: 'opus', effort: 'high' })
    expect(b).toMatchObject({ model: 'opus', effort: 'high' })
    expect(manager.configured.at(-1)).toEqual({ id: b.agentId, patch: { model: 'opus', effort: 'high' } })
    expect(runner.configure('gabi', { model: '' }).model).toBeUndefined()
  })

  it('perfil salvo: mesmo lugar reconfigura; outro lugar dispensa o agente e esquece a conversa', async () => {
    await runner.ensureAgent('gabi')
    const before = { ...bot() }
    store.update({ ...bot(), permissionMode: 'acceptEdits' })
    runner.updated(before, bot())
    expect(manager.configured.at(-1)?.patch).toMatchObject({ permissionMode: 'acceptEdits' })
    const agentId = bot().agentId!
    store.update({ ...bot(), sessionId: 's1' })
    const moved = { ...bot() }
    store.update({ ...bot(), worktree: true })
    runner.updated(moved, bot())
    expect(manager.fired).toEqual([agentId])
    expect(bot().sessionId).toBeUndefined()
  })

  it('forget dispensa o agente do bot apagado', async () => {
    await runner.send('gabi', 'Oi')
    const agentId = bot().agentId!
    runner.forget('gabi')
    expect(manager.fired).toEqual([agentId])
    expect(runner.activeRun('gabi')).toBeUndefined()
  })
})

describe('BotRunner: teto do dia', () => {
  it('passou do teto: a mensagem fica no fio, não vai para o agente, e o fio avisa', async () => {
    const today = Date.now()
    setup([makeBot({ dailyBudgetUsd: 0.1, runs: [{ id: 'r0', trigger: { kind: 'manual' }, startedAt: today, status: 'ok', steps: 1, costUsd: 0.12, threadId: 'gabi', itemId: 'x' }] })])
    expect(runner.spentToday(bot())).toBeCloseTo(0.12)
    await runner.send('gabi', 'Oi')
    expect(manager.sent).toEqual([])
    expect(kinds()).toEqual(['user', 'notice'])
    expect(lastOf('notice')?.text).toContain('Teto de custo atingido: Gabi gastou US$ 0,12 hoje')
    expect(await runner.runScheduled('gabi', 'x', { kind: 'manual' })).toHaveProperty('skipped')
    await runner.runNow('gabi')
    expect(manager.sent).toEqual([])
  })

  it('o gasto do dia soma as rodadas que terminam; ontem não conta', async () => {
    setup([makeBot({ dailyBudgetUsd: 0.1, runs: [{ id: 'r0', trigger: { kind: 'manual' }, startedAt: Date.now() - 2 * 86_400_000, status: 'ok', steps: 1, costUsd: 5, threadId: 'gabi', itemId: 'x' }] })])
    await runner.send('gabi', 'Oi')
    manager.agent(bot().agentId!)!.spentUsd = 0.04
    expect(runner.spentToday(bot())).toBeCloseTo(0.04)
    manager.result(bot().agentId!, 'ok', false, 0.07)
    expect(runner.spentToday(bot())).toBeCloseTo(0.11)
    await runner.send('gabi', 'De novo')
    expect(manager.sent).toHaveLength(1)
  })
})

describe('BotRunner: ganchos do gerente', () => {
  it('prompt com papel e memória; guarda e conexões do bot; resultado quieto até ligar a entrega no escritório', async () => {
    store.setMemory('gabi', '- Prefere tópicos.\n')
    const hooks = runner.hooks()
    const s = { bot: 'gabi' } as AgentSummary
    const prompt = hooks.prompt(s)!
    expect(prompt).toContain('Você é o chefe de gabinete do andar.')
    expect(prompt).toContain('- Prefere tópicos.')
    expect(prompt).toContain('"Gabi"')
    expect(prompt).toContain('Térreo')
    expect(hooks.askBefore(s)).toEqual(SENSITIVE_KINDS)
    expect(hooks.apps(s)).toBe('all')
    expect(hooks.quietResult(s)).toBe(true)
    chat = { deliverInOffice: true }
    expect(hooks.quietResult(s)).toBe(false)
    const gone = { bot: 'apagado' } as AgentSummary
    expect(hooks.prompt(gone)).toBeUndefined()
    expect(hooks.askBefore(gone)).toBeUndefined()
    expect(hooks.apps(gone)).toEqual([])
    expect(hooks.quietResult(gone)).toBe(false)
  })

  it('com a entrega no escritório, result:new fecha a rodada', async () => {
    chat = { deliverInOffice: true }
    await runner.send('gabi', 'Oi')
    manager.result(bot().agentId!, 'Oi!', false, 0, false)
    expect(lastOf('run')?.status).toBe('ok')
    expect(lastOf('bot')?.text).toBe('Oi!')
  })

  it('resultado que o runner não seguia ainda chega ao fio', async () => {
    await runner.ensureAgent('gabi')
    manager.result(bot().agentId!, 'Sozinho')
    expect(lastOf('bot')?.text).toBe('Sozinho')
    manager.result(bot().agentId!, 'Falhou sozinho', true)
    expect(lastOf('notice')).toMatchObject({ tone: 'error', text: 'Falhou sozinho' })
  })
})

describe('BotRunner: demonstração', () => {
  it('bot de demonstração usa um agente de mentira e o demoReply fecha a rodada', async () => {
    setup([makeBot({ demo: true })])
    const played: string[] = []
    runner.demoSend = (_botId, text) => played.push(text)
    await runner.send('gabi', 'Oi')
    expect(played).toEqual(['Oi'])
    expect(kinds()).toEqual(['user', 'run'])
    runner.demoReply('gabi', 'Olá da demonstração')
    expect(lastOf('bot')?.text).toBe('Olá da demonstração')
    await runner.send('gabi', 'Oi')
    await runner.stop('gabi')
    expect(lastOf('run')?.status).toBe('failed')
    await runner.send('gabi', '!ls')
    expect(lastOf('notice')?.text).toContain('modo demonstração')
  })
})

describe('BotRunner: canais, perguntas entre bots e o fim da rodada', () => {
  const channel = { id: 'geral', name: 'geral', floor: 'terreo', topic: '', members: ['gabi'], createdAt: 0, updatedAt: 0, lastReadAt: 0, order: 0 }

  it('rodada de canal: os itens vão para o fio do canal; a mensagem do jogador não se repete', async () => {
    store.channels = [channel]
    const start = await runner.send('gabi', 'Alguém viu o deploy?', [], { kind: 'channel', channelId: 'geral' })
    expect(start).toHaveProperty('runId')
    const agentId = bot().agentId!
    manager.log(agentId, 'tool', 'git log', 'Bash')
    const req = manager.ask(agentId, {}, 'push')
    manager.decide(req, { behavior: 'deny', message: 'Não' })
    manager.result(agentId, 'O deploy saiu às 10h.')
    expect(kinds('geral')).toEqual(['run', 'approval', 'bot'])
    expect(lastOf('approval', 'geral')).toMatchObject({ status: 'denied' })
    expect(lastOf('bot', 'geral')?.text).toBe('O deploy saiu às 10h.')
    expect(thread('gabi')).toEqual([])
    expect(bot().runs[0]).toMatchObject({ threadId: 'geral', status: 'ok' })
    expect(events.some((e) => e.type === 'bot:item' && e.threadId === 'geral')).toBe(true)
  })

  it('canal com o bot ocupado: pulada no canal, sem erro; DM entra na fila', async () => {
    store.channels = [channel]
    await runner.send('gabi', 'Longo')
    const start = await runner.send('gabi', 'Oi canal', [], { kind: 'channel', channelId: 'geral' })
    expect(start).toEqual({ skipped: expect.stringMatching(/Gabi estava ocupado/) })
    expect(lastOf('run', 'geral')?.status).toBe('skipped')
    expect(await runner.send('gabi', 'Mais uma')).toMatchObject({ queued: true })
  })

  it('pergunta de outro bot: a rodada vai para o fio de quem perguntou; o run:end traz a resposta', async () => {
    store.bots = [...store.bots, makeBot({ id: 'leo', name: 'Leo' })]
    const ends: BotRunEnd[] = []
    runner.on('run:end', (e: BotRunEnd) => ends.push(e))
    const start = await runner.send('gabi', 'Qual o status do AO-44?', [], { kind: 'ask', fromBotId: 'leo' })
    const runId = (start as { runId: string }).runId
    manager.result(bot().agentId!, 'Em revisão.', false, 0.01)
    await tick()
    expect(ends).toEqual([{ botId: 'gabi', runId, threadId: 'leo', trigger: { kind: 'ask', fromBotId: 'leo' }, status: 'ok', costUsd: 0.01, text: 'Em revisão.' }])
    expect(kinds('leo')).toEqual(['run', 'bot'])
    expect(thread('gabi')).toEqual([])
  })

  it('canal com a pasta sumida: falha no canal, sem exceção', async () => {
    store.channels = [channel]
    store.update({ ...bot(), cwd: join(dir, 'sumiu') })
    const start = await runner.send('gabi', 'Oi', [], { kind: 'channel', channelId: 'geral' })
    expect(start).toHaveProperty('runId')
    expect(lastOf('run', 'geral')?.status).toBe('failed')
  })

  it('run:end chega depois de o chamador ter o runId, mesmo quando a rodada fecha na hora', async () => {
    await runner.ensureAgent('gabi')
    manager.broke.add(bot().agentId!)
    const ends: BotRunEnd[] = []
    runner.on('run:end', (e: BotRunEnd) => ends.push(e))
    const start = await runner.send('gabi', 'Oi')
    expect(ends).toEqual([])
    await tick()
    expect(ends).toEqual([expect.objectContaining({ runId: (start as { runId: string }).runId, status: 'failed', error: 'Teto de custo do agente atingido.' })])
  })
})

describe('BotRunner: a lista leva não lidas e a última mensagem', () => {
  it('conta respostas e pedidos depois de lastReadAt e mostra a mensagem mais nova', async () => {
    expect(runner.list()[0]).toMatchObject({ unread: 0 })
    expect(runner.list()[0].last).toBeUndefined()
    await runner.send('gabi', 'Oi')
    const agentId = bot().agentId!
    manager.ask(agentId)
    manager.result(agentId, 'Olá!')
    expect(runner.list()[0]).toMatchObject({ unread: 2, last: { text: 'Olá!', from: 'bot' } })
    store.update({ ...bot(), lastReadAt: Date.now() + 1 })
    expect(runner.list()[0]).toMatchObject({ unread: 0, last: { text: 'Olá!' } })
    const sent = events.filter((e) => e.type === 'bots').at(-1) as Extract<OfficeEvent, { type: 'bots' }>
    expect(sent.bots[0]).toHaveProperty('unread')
  })
})
