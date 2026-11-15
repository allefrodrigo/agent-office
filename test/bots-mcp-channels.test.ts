process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { BOT_LIMITS, type AgentSummary, type Bot, type ThreadItem } from '@shared/types'
import type { BotToolFactory } from '../src/main/bots/mcp'
import { items, makeBot, setup, type Sent, type Setup } from './mocks/channels'

// The MCP server is the SDK's business: each tool keeps its schema (parsed here like the SDK does) and handler.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _description: string, schema: unknown, handler: (args: unknown) => Promise<unknown>) => ({ name, schema, handler }),
  createSdkMcpServer: (options: unknown) => options,
}))

const { channelTools } = await import('../src/main/bots/mcp-channels')

type Tool = { name: string; schema: z.ZodRawShape; handler: (args: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }

const ada = makeBot('ada', 'Ada', 'p1')
const chefe = makeBot('chefe', 'Chefe de gabinete', 'p1')
const rev = makeBot('rev', 'Revisor do dia', 'p1')
const solo = makeBot('solo', 'Solitário', 'p1')
const loja = makeBot('loja', 'Vendedor', 'p2')

/** #lançamento: Ada, Chefe, Revisor. #suporte: Ada, Revisor. Solitário só no canal do andar. */
function world(opts: { perHour?: number } = {}): Setup & { lanc: string; sup: string } {
  const s = setup([ada, chefe, rev, solo, loja], opts)
  s.svc.list()
  // o canal do andar fica só com o Solitário, para os escopos ficarem claros
  s.store.channels = s.store.channels.map((c) =>
    c.id === 'andar-p1' ? { ...c, members: ['solo'], updatedAt: Number.MAX_SAFE_INTEGER } : c,
  )
  const lanc = s.svc.save({ name: 'lançamento', floor: 'p1', topic: 'A versão 0.5', members: ['ada', 'chefe', 'rev'] }).id
  const sup = s.svc.save({ name: 'suporte', floor: 'p1', topic: '', members: ['ada', 'rev'] }).id
  return { ...s, lanc, sup }
}

function toolsOf(s: Setup, bot: Bot) {
  const set = channelTools(s.svc)({ id: `agente-${bot.id}`, bot: bot.id } as AgentSummary, bot)
  const tools = set.tools as unknown as Tool[]
  const call = async (name: string, args: Record<string, unknown>) => {
    const t = tools.find((x) => x.name === name)
    if (!t) throw new Error(`sem ${name}`)
    const r = await t.handler(z.object(t.schema).parse(args))
    return { text: r.content[0].text, isError: !!r.isError }
  }
  return { tools, instructions: set.instructions, call }
}

const sides = (s: Setup, id: string) => items(s, id).filter((i): i is Extract<ThreadItem, { kind: 'side' }> => i.kind === 'side')
const asks = (s: Setup) => s.host.sent.filter((x) => x.trigger.kind === 'ask')

describe('ferramentas dos canais', () => {
  it('bot sem canal não recebe nada', () => {
    const s = world()
    const out = toolsOf(s, loja)
    expect(out.tools.map((t) => t.name)).toEqual(['chat_post', 'bot_ask'])
    s.store.channels = s.store.channels.filter((c) => c.floor !== 'p2')
    expect(toolsOf(s, loja).tools).toEqual([])
    expect(toolsOf(s, loja).instructions).toEqual([])
  })

  it('cabe em BotTools.add, o gancho do servidor office', () => {
    const s = world()
    const factory: BotToolFactory = channelTools(s.svc)
    expect(factory({ id: 'agente-ada', bot: 'ada' } as AgentSummary, ada).instructions[0]).toContain('#lançamento')
  })

  it('as instruções dizem os canais e quem está em cada um', () => {
    const s = world()
    const [line] = toolsOf(s, ada).instructions
    expect(line).toContain('#lançamento (com Chefe de gabinete, Revisor do dia)')
    expect(line).toContain('#suporte (com Revisor do dia)')
    expect(line).not.toContain('Solitário')
  })
})

describe('chat_post', () => {
  it('posta num canal de que é membro, com o próprio nome', async () => {
    const s = world()
    const r = await toolsOf(s, ada).call('chat_post', { channel: '#Lançamento', text: '3 tickets novos organizados' })
    expect(r).toEqual({ text: 'Postei em #lançamento.', isError: false })
    const msg = items(s, s.lanc).at(-1)
    expect(msg).toMatchObject({ kind: 'bot', botId: 'ada', text: '3 tickets novos organizados' })
    expect(s.events.at(-1)).toMatchObject({ type: 'bot:item', threadId: s.lanc })
  })

  it('nunca num canal de que não é membro, nem num que não existe', async () => {
    const s = world()
    const chefeTools = toolsOf(s, chefe)
    const r = await chefeTools.call('chat_post', { channel: 'suporte', text: 'oi' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('não é membro')
    expect(r.text).toContain('#lançamento')
    expect((await chefeTools.call('chat_post', { channel: s.sup, text: 'oi' })).isError).toBe(true)
    expect((await chefeTools.call('chat_post', { channel: 'loja', text: 'oi' })).isError).toBe(true)
    expect((await chefeTools.call('chat_post', { channel: 'nada', text: 'oi' })).text).toContain('Não achei o canal')
    expect(items(s, s.sup)).toEqual([])
  })

  it('texto vazio e limite por hora', async () => {
    const s = world()
    const t = toolsOf(s, ada)
    expect((await t.call('chat_post', { channel: 'suporte', text: '  ' })).isError).toBe(true)
    for (let i = 0; i < BOT_LIMITS.perHourMax; i++)
      expect((await t.call('chat_post', { channel: 'suporte', text: `post ${i}` })).isError).toBe(false)
    const over = await t.call('chat_post', { channel: 'suporte', text: 'mais um' })
    expect(over.isError).toBe(true)
    expect(over.text).toContain('limite')
    s.clock.t += 3_600_001
    expect((await t.call('chat_post', { channel: 'suporte', text: 'depois de uma hora' })).isError).toBe(false)
  })
})

describe('bot_ask', () => {
  it('pergunta a quem divide um canal, devolve na hora e grava a conversa recolhida', async () => {
    const s = world()
    const r = await toolsOf(s, chefe).call('bot_ask', { bot: 'Revisor do dia', question: 'Quais riscos no PR?' })
    expect(r).toEqual({ text: 'Perguntei ao Revisor do dia; a resposta chega como mensagem nova.', isError: false })
    const [side] = sides(s, s.lanc)
    expect(side).toMatchObject({ fromBotId: 'chefe', toBotId: 'rev', question: 'Quais riscos no PR?', status: 'asked' })
    await s.svc.idle()
    const q = asks(s)[0]
    // a rodada do Revisor fica no fio dele; o canal mostra só a conversa recolhida
    expect(q).toMatchObject({ botId: 'rev', trigger: { kind: 'ask', fromBotId: 'chefe' }, threadId: 'rev' })
    expect(q.text).toContain('Pergunta de Chefe de gabinete, do canal #lançamento')
    expect(q.text).toContain('Quais riscos no PR?')
  })

  it('a resposta volta para quem perguntou como mensagem nova', async () => {
    const s = world()
    // o Chefe perguntou durante uma rodada no canal
    s.host.busy.set('chefe', s.lanc)
    await toolsOf(s, chefe).call('bot_ask', { bot: 'rev', question: 'Riscos?' })
    await s.svc.idle()
    s.host.busy.delete('chefe')
    s.host.end(asks(s)[0], 'ok', 'Nenhum risco alto.')
    await s.svc.idle()
    expect(sides(s, s.lanc)[0]).toMatchObject({ status: 'answered', answer: 'Nenhum risco alto.' })
    const back = s.host.last()
    expect(back).toMatchObject({ botId: 'chefe', trigger: { kind: 'ask', fromBotId: 'rev' }, threadId: s.lanc })
    expect(back.text).toBe('[Resposta de Revisor do dia] Nenhum risco alto.')
  })

  it('quem perguntou de uma conversa direta recebe a resposta lá', async () => {
    const s = world()
    s.host.busy.set('ada', 'ada')
    await toolsOf(s, ada).call('bot_ask', { bot: 'Revisor', question: 'Riscos?' })
    await s.svc.idle()
    s.host.busy.delete('ada')
    s.host.end(asks(s)[0], 'ok', 'Tudo certo.')
    await s.svc.idle()
    expect(s.host.last()).toMatchObject({ botId: 'ada', threadId: 'ada' })
  })

  it('escolhe o canal pedido, entre os que dividem', async () => {
    const s = world()
    const t = toolsOf(s, ada)
    await t.call('bot_ask', { bot: 'rev', question: 'a', channel: 'suporte' })
    expect(sides(s, s.sup)).toHaveLength(1)
    const r = await t.call('bot_ask', { bot: 'chefe', question: 'b', channel: 'suporte' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('Canais que vocês dividem: #lançamento')
  })

  it('resposta que falhou: a conversa fica sem resposta e ninguém recebe mensagem', async () => {
    const s = world()
    await toolsOf(s, chefe).call('bot_ask', { bot: 'rev', question: 'Riscos?' })
    await s.svc.idle()
    s.host.end(asks(s)[0], 'failed')
    await s.svc.idle()
    expect(sides(s, s.lanc)[0].status).toBe('failed')
    expect(s.host.sent).toHaveLength(1)
  })

  it('nunca a si mesmo, nem a quem não divide um canal', async () => {
    const s = world()
    const t = toolsOf(s, chefe)
    const self = await t.call('bot_ask', { bot: 'Chefe de gabinete', question: 'x' })
    expect(self.isError).toBe(true)
    expect(self.text).toContain('si mesmo')
    expect((await t.call('bot_ask', { bot: 'chefe', question: 'x' })).isError).toBe(true)
    // o Solitário é do mesmo andar, mas não está em nenhum canal do Chefe
    const other = await t.call('bot_ask', { bot: 'Solitário', question: 'x' })
    expect(other.isError).toBe(true)
    expect(other.text).toContain('Você só pode perguntar a bots dos seus canais: Ada, Revisor do dia')
    expect((await t.call('bot_ask', { bot: 'Vendedor', question: 'x' })).isError).toBe(true)
    expect((await t.call('bot_ask', { bot: 'Fulano', question: 'x' })).text).toContain('Não achei')
    expect((await t.call('bot_ask', { bot: 'Ada', question: '   ' })).isError).toBe(true)
    await s.svc.idle()
    expect(s.host.sent).toHaveLength(0)
    expect(sides(s, s.lanc)).toHaveLength(0)
  })

  it('a cadeia de perguntas para no terceiro elo', async () => {
    const s = world()
    // Chefe → Revisor (1º elo)
    await toolsOf(s, chefe).call('bot_ask', { bot: 'rev', question: 'a' })
    await s.svc.idle()
    // o Revisor, respondendo, pergunta à Ada (2º elo)
    expect((await toolsOf(s, rev).call('bot_ask', { bot: 'ada', question: 'b' })).isError).toBe(false)
    await s.svc.idle()
    // a Ada, respondendo, tenta perguntar ao Chefe (3º elo): para
    const third = await toolsOf(s, ada).call('bot_ask', { bot: 'chefe', question: 'c' })
    expect(third.isError).toBe(true)
    expect(third.text).toContain('elos demais')
    // a rodada da Ada termina: ela volta a poder perguntar
    s.host.end(asks(s).find((x) => x.botId === 'ada') as Sent, 'ok', 'resposta')
    await s.svc.idle()
    s.host.busy.clear()
    expect((await toolsOf(s, ada).call('bot_ask', { bot: 'chefe', question: 'd' })).isError).toBe(false)
  })

  it('limite de perguntas por hora, como nas automações de evento', async () => {
    const s = world({ perHour: 3 })
    const t = toolsOf(s, ada)
    for (let i = 0; i < 3; i++) expect((await t.call('bot_ask', { bot: 'rev', question: `q${i}` })).isError).toBe(false)
    const over = await t.call('bot_ask', { bot: 'rev', question: 'q4' })
    expect(over.isError).toBe(true)
    expect(over.text).toContain('3 perguntas')
    s.clock.t += 3_600_001
    expect((await t.call('bot_ask', { bot: 'rev', question: 'q5' })).isError).toBe(false)
  })

  it('pergunta para um bot ocupado espera a rodada dele', async () => {
    const s = world()
    s.host.busy.set('rev', 'rev')
    await toolsOf(s, chefe).call('bot_ask', { bot: 'rev', question: 'Riscos?' })
    await s.svc.idle()
    expect(asks(s)).toHaveLength(0)
    s.host.end({ botId: 'rev', runId: 'dm', threadId: 'rev', text: '', attachments: [], trigger: { kind: 'message' } })
    await Promise.resolve()
    await s.svc.idle()
    expect(asks(s).map((x) => x.botId)).toEqual(['rev'])
    // o fim da rodada da DM não foi tomado como resposta
    expect(sides(s, s.lanc)[0].status).toBe('asked')
  })

  it('pergunta que não chegou: avisa no canal', async () => {
    const s = world()
    s.host.failWith = new Error('O andar de Revisor do dia não existe mais.')
    await toolsOf(s, chefe).call('bot_ask', { bot: 'rev', question: 'x' })
    await s.svc.idle()
    expect(sides(s, s.lanc)[0].status).toBe('failed')
    expect(items(s, s.lanc).at(-1)).toMatchObject({ kind: 'notice', tone: 'error' })
  })

  it('o runner pulou a pergunta (agente ocupado, teto do dia): sem resposta e aviso no canal', async () => {
    const s = world()
    s.host.skipWith = 'Pulei a mensagem das 10:00: Revisor do dia estava ocupado com outra rodada.'
    await toolsOf(s, chefe).call('bot_ask', { bot: 'rev', question: 'x' })
    await s.svc.idle()
    expect(sides(s, s.lanc)[0].status).toBe('failed')
    expect(items(s, s.lanc).at(-1)).toMatchObject({
      kind: 'notice',
      tone: 'warn',
      text: expect.stringContaining('Revisor do dia não recebeu a pergunta'),
    })
  })

  it('bot apagado no meio: a pergunta fica sem resposta', async () => {
    const s = world()
    await toolsOf(s, chefe).call('bot_ask', { bot: 'rev', question: 'x' })
    await s.svc.idle()
    s.store.bots = s.store.bots.filter((b) => b.id !== 'rev')
    s.svc.botsChanged()
    expect(sides(s, s.lanc)[0].status).toBe('failed')
  })
})
