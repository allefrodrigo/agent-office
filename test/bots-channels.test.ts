process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import { BOT_LIMITS, type Channel, type ThreadItem } from '@shared/types'
import { floorChannelId } from '@shared/bots-mentions'
import { channelName, cleanChannelDraft, cleanPost, cleanTopic } from '../src/main/bots/channels-validate'
import { runnerHost } from '../src/main/bots/channels'
import { registerBotChannelsIpc } from '../src/main/ipc/bots-channels'
import { FLOORS, items, makeBot, setup, type Setup } from './mocks/channels'

const ada = makeBot('ada', 'Ada', 'p1', { createdAt: 10 })
const chefe = makeBot('chefe', 'Chefe de gabinete', 'p1', { createdAt: 11, tagline: 'Resumo da manhã' })
const rev = makeBot('rev', 'Revisor do dia', 'p1', { createdAt: 12 })
const loja = makeBot('loja', 'Vendedor', 'p2', { createdAt: 13 })

const floors = FLOORS.map((f) => f.id)
const draft = (s: Setup, d: Record<string, unknown>) =>
  cleanChannelDraft({ floor: 'p1', members: ['ada'], ...d }, { bots: s.store.bots, channels: s.store.channels, floors })

function withChannel(members = ['ada', 'chefe', 'rev']): Setup & { c: Channel } {
  const s = setup([ada, chefe, rev, loja])
  s.svc.list()
  const c = s.svc.save(draft(s, { name: 'lançamento', topic: 'A versão 0.5', members }))
  s.events.length = 0
  return { ...s, c }
}

const user = (s: Setup, threadId: string) => items(s, threadId).filter((i): i is Extract<ThreadItem, { kind: 'user' }> => i.kind === 'user')
const notices = (s: Setup, threadId: string) =>
  items(s, threadId).filter((i): i is Extract<ThreadItem, { kind: 'notice' }> => i.kind === 'notice')

describe('canal do andar', () => {
  it('nasce no primeiro uso, com o nome do andar e os bots dele', () => {
    const s = setup([ada, chefe, loja])
    const list = s.svc.list()
    expect(list.map((c) => [c.id, c.name, c.members])).toEqual([
      ['andar-p1', 'agent-office', ['ada', 'chefe']],
      ['andar-p2', 'loja', ['loja']],
    ])
    expect(s.events.filter((e) => e.type === 'channels')).toHaveLength(1)
    // o térreo não tem bots: sem canal
    expect(list.some((c) => c.floor === 'terreo')).toBe(false)
    s.svc.list()
    expect(s.store.channels).toHaveLength(2)
    expect(s.events.filter((e) => e.type === 'channels')).toHaveLength(1)
  })

  it('bots novos entram; quem você tirou fica fora; quem mudou de andar ou foi apagado sai', () => {
    const s = setup([ada, chefe])
    s.svc.list()
    const id = floorChannelId('p1')
    // você tira a Ada do canal do andar
    s.svc.save(draft(s, { id, name: 'agent-office', members: ['chefe'] }))
    s.store.bots.push(makeBot('novo', 'Novo', 'p1', { createdAt: s.clock.t + 100 }))
    s.svc.botsChanged()
    expect(s.svc.channel(id)?.members).toEqual(['chefe', 'novo'])
    // o Chefe muda de andar, o Novo é apagado
    s.store.bots = s.store.bots.filter((b) => b.id !== 'novo').map((b) => (b.id === 'chefe' ? { ...b, floor: 'p2' } : b))
    s.svc.botsChanged()
    expect(s.svc.channel(id)?.members).toEqual([])
  })

  it('não pode ser apagado enquanto o andar existe', () => {
    const s = setup([ada])
    s.svc.list()
    expect(() => s.svc.remove(floorChannelId('p1'))).toThrow('canal do andar')
  })

  it('o nome do andar já usado por outro canal ganha um número', () => {
    const s = setup([ada])
    s.store.channels = [
      { id: 'x', name: 'agent-office', floor: 'p1', topic: '', members: [], createdAt: 0, updatedAt: 0, lastReadAt: 0, order: 1 },
    ]
    expect(s.svc.list().find((c) => c.id === 'andar-p1')?.name).toBe('agent-office-2')
  })
})

describe('criar, editar e apagar', () => {
  it('cria com nome de canal, tema numa linha e membros do andar', () => {
    const s = setup([ada, chefe, loja])
    const c = s.svc.save(draft(s, { name: '  # Lançamento 2026! ', topic: 'linha\n  dois', members: ['ada', 'chefe', 'ada'] }))
    expect(c).toMatchObject({ name: 'lançamento-2026', floor: 'p1', topic: 'linha dois', members: ['ada', 'chefe'] })
    expect(c.id).toMatch(/^canal-/)
    expect(s.events.at(-1)).toMatchObject({ type: 'channels' })
  })

  it('recusa o que não serve, com mensagem que diz o que fazer', () => {
    const s = setup([ada, chefe, loja])
    s.svc.save(draft(s, { name: 'suporte' }))
    expect(() => draft(s, { name: 'Suporte' })).toThrow('Já existe um #suporte')
    expect(() => draft(s, { name: '!!!' })).toThrow('Dê um nome')
    expect(() => draft(s, { name: 'x', members: ['loja'] })).toThrow('Só bots do andar')
    expect(() => draft(s, { name: 'x', members: ['sumiu'] })).toThrow('não existe mais')
    expect(() => draft(s, { name: 'x', members: [] })).toThrow('pelo menos um bot')
    expect(() => draft(s, { name: 'x', floor: 'p9' })).toThrow('andar não existe')
    expect(() => draft(s, { id: 'nao-existe', name: 'x' })).toThrow('não existe mais')
    expect(() => cleanChannelDraft('lixo', { bots: [], channels: [], floors })).toThrow('incompleto')
    expect(() => cleanChannelDraft({ name: 'x', floor: 'p1', members: 'ada' }, { bots: s.store.bots, channels: [], floors })).toThrow(
      'incompleto',
    )
  })

  it('para no limite de canais', () => {
    const s = setup([ada])
    s.store.channels = Array.from({ length: BOT_LIMITS.channels }, (_, i) => ({
      id: `c${i}`,
      name: `c${i}`,
      floor: 'p1',
      topic: '',
      members: [],
      createdAt: 0,
      updatedAt: 0,
      lastReadAt: 0,
      order: i,
    }))
    expect(() => draft(s, { name: 'mais-um' })).toThrow(`limite de ${BOT_LIMITS.channels} canais`)
  })

  it('editar mantém id e andar', () => {
    const { svc, c, store } = withChannel()
    const s2 = svc.save(
      cleanChannelDraft(
        { id: c.id, name: 'lançamento', floor: 'p2', topic: 'novo', members: ['rev'] },
        { bots: store.bots, channels: store.channels, floors },
      ),
    )
    expect(s2).toMatchObject({ id: c.id, floor: 'p1', topic: 'novo', members: ['rev'] })
  })

  it('apagar tira o canal e o fio', () => {
    const s = withChannel()
    s.svc.remove(s.c.id)
    expect(s.svc.channel(s.c.id)).toBeUndefined()
    expect(s.store.removed).toEqual([s.c.id])
    expect(() => s.svc.remove(s.c.id)).toThrow('não existe mais')
  })

  it('ler marca lastReadAt sem mexer em updatedAt', () => {
    const { svc, c } = withChannel()
    expect(svc.markRead(c.id, 999)).toBe(true)
    expect(svc.channel(c.id)).toMatchObject({ lastReadAt: 999, updatedAt: c.updatedAt })
    expect(svc.markRead('outro', 1)).toBe(false)
  })

  it('nome e tema limpos', () => {
    expect(channelName('Ação  Rápida')).toBe('ação-rápida')
    expect(channelName('x'.repeat(80))).toHaveLength(BOT_LIMITS.channelName)
    expect(cleanTopic('a'.repeat(500))).toHaveLength(BOT_LIMITS.topic)
    expect(cleanTopic(undefined)).toBe('')
  })
})

describe('você escreve no canal', () => {
  it('@menção manda só para quem foi chamado, com o gatilho do canal', async () => {
    const s = withChannel()
    await s.svc.post(s.c.id, '@Revisor do dia olha o PR')
    expect(user(s, s.c.id)).toHaveLength(1)
    await s.svc.idle()
    expect(s.routes).toHaveLength(0)
    expect(s.host.sent).toHaveLength(1)
    expect(s.host.sent[0]).toMatchObject({ botId: 'rev', trigger: { kind: 'channel', channelId: s.c.id }, threadId: s.c.id })
    expect(user(s, s.c.id)[0]).toMatchObject({ to: ['rev'], route: { by: 'mention' } })
    // o mesmo item, atualizado no lugar
    expect(items(s, s.c.id).filter((i) => i.kind === 'user')).toHaveLength(1)
  })

  it('o bot recebe o tema, os membros, as últimas mensagens e a nova', async () => {
    const s = withChannel()
    const thread = s.store.thread(s.c.id)
    for (let i = 0; i < 30; i++)
      thread.put({ id: `m${i}`, t: i, kind: i % 2 ? 'bot' : 'user', botId: 'ada', text: `mensagem ${i}` } as ThreadItem)
    await s.svc.post(s.c.id, '@Ada resume')
    await s.svc.idle()
    const text = s.host.sent[0].text
    expect(text).toContain('#lançamento')
    expect(text).toContain('Tema do canal: A versão 0.5')
    expect(text).toContain('Membros: Ada (você), Chefe de gabinete, Revisor do dia')
    expect(text).toContain('mensagem 29')
    expect(text).toContain(`mensagem ${30 - BOT_LIMITS.context}`)
    expect(text).not.toMatch(new RegExp(`mensagem ${29 - BOT_LIMITS.context}\\b`))
    expect(text).toContain('<mensagem>\n@Ada resume\n</mensagem>')
  })

  it('várias menções vão para cada um, até o limite', async () => {
    const s = withChannel()
    await s.svc.post(s.c.id, '@Ada e @Chefe de gabinete, vejam')
    await s.svc.idle()
    expect(s.host.sent.map((x) => x.botId).sort()).toEqual(['ada', 'chefe'])
  })

  it('sem menção, o roteador escolhe; o porquê fica na mensagem', async () => {
    const s = withChannel()
    s.answer.next = { bots: ['chefe'], why: 'é resumo' }
    await s.svc.post(s.c.id, 'como foi a manhã?')
    await s.svc.idle()
    expect(s.routes[0].members.map((b) => b.id)).toEqual(['ada', 'chefe', 'rev'])
    expect(s.routes[0].message).toBe('como foi a manhã?')
    expect(s.routes[0].items.some((i) => i.kind === 'user' && i.text === 'como foi a manhã?')).toBe(false)
    expect(user(s, s.c.id)[0]).toMatchObject({ to: ['chefe'], route: { by: 'router', why: 'é resumo' } })
    expect(s.host.sent.map((x) => x.botId)).toEqual(['chefe'])
  })

  it('o que o roteador devolver fora dos membros é descartado', async () => {
    const s = withChannel(['ada', 'chefe'])
    s.answer.next = { bots: ['rev', 'loja'], why: '' }
    await s.svc.post(s.c.id, 'oi')
    await s.svc.idle()
    expect(s.host.sent).toHaveLength(0)
    expect(user(s, s.c.id)[0].to).toEqual([])
  })

  it('ninguém: o canal pergunta "Para quem é?" com os membros', async () => {
    const s = withChannel()
    await s.svc.post(s.c.id, 'qual o clima?')
    await s.svc.idle()
    const n = notices(s, s.c.id)
    expect(n).toHaveLength(1)
    expect(n[0].text).toContain('Para quem é?')
    expect(n[0].text).toContain('Ada, Chefe de gabinete, Revisor do dia')
    expect(s.host.sent).toHaveLength(0)
  })

  it('roteador com erro também pergunta, e diz o que houve', async () => {
    const s = withChannel()
    s.answer.next = () => {
      throw new Error('Claude Code não encontrado.')
    }
    await s.svc.post(s.c.id, 'oi')
    await s.svc.idle()
    expect(notices(s, s.c.id)[0]).toMatchObject({ tone: 'warn' })
    expect(notices(s, s.c.id)[0].text).toContain('Claude Code não encontrado')
  })

  it('canal sem bots recusa a mensagem', async () => {
    const s = withChannel(['ada'])
    s.store.bots = s.store.bots.filter((b) => b.id !== 'ada')
    await expect(s.svc.post(s.c.id, '@Ada oi')).rejects.toThrow('não tem bots')
    await expect(s.svc.post('sumiu', 'oi')).rejects.toThrow('não existe mais')
  })

  it('anexos vão para o bot; o fio guarda só nome e tamanho', async () => {
    const s = withChannel()
    await s.svc.post(s.c.id, '@Ada lê', [{ name: 'a.txt', path: '/tmp/a.txt' }])
    await s.svc.idle()
    expect(user(s, s.c.id)[0].attachments).toEqual([{ name: 'a.txt', kind: 'file', size: 10 }])
    expect(s.host.sent[0].attachments).toEqual([{ name: 'a.txt', path: '/tmp/a.txt' }])
    expect(s.host.sent[0].text).toContain('1 anexo vai junto')
  })

  it('bot ocupado: a mensagem espera a rodada dele terminar', async () => {
    const s = withChannel()
    s.host.busy.set('ada', 'ada')
    await s.svc.post(s.c.id, '@Ada oi')
    await s.svc.idle()
    expect(s.host.sent).toHaveLength(0)
    s.host.end({ botId: 'ada', text: '', attachments: [], trigger: { kind: 'message' }, threadId: 'ada', runId: 'dm' })
    await Promise.resolve()
    await s.svc.idle()
    expect(s.host.sent.map((x) => x.botId)).toEqual(['ada'])
  })

  it('o runner pulou (agente ocupado): só o aviso dele, sem outro do canal', async () => {
    const s = withChannel()
    s.host.skipWith = 'Pulei a mensagem das 10:00: Ada estava ocupado com outra rodada.'
    await s.svc.post(s.c.id, '@Ada oi')
    await s.svc.idle()
    expect(notices(s, s.c.id)).toHaveLength(0)
    expect(s.host.sent).toHaveLength(0)
  })

  it('o runner recusou: aviso de erro no canal', async () => {
    const s = withChannel()
    s.host.failWith = new Error('Teto de custo atingido.')
    await s.svc.post(s.c.id, '@Ada oi')
    await s.svc.idle()
    expect(notices(s, s.c.id)[0]).toMatchObject({ tone: 'error', text: 'Ada não recebeu a mensagem: Teto de custo atingido.' })
  })
})

describe('trocar quem responde', () => {
  it('manda para outro membro e marca que foi você', async () => {
    const s = withChannel()
    s.answer.next = { bots: ['ada'], why: 'x' }
    await s.svc.post(s.c.id, 'revisa o PR')
    await s.svc.idle()
    const msg = user(s, s.c.id)[0]
    await s.svc.reroute(s.c.id, msg.id, 'rev')
    await s.svc.idle()
    expect(user(s, s.c.id)[0]).toMatchObject({ to: ['rev'], route: { by: 'player' } })
    expect(s.host.last()).toMatchObject({ botId: 'rev', threadId: s.c.id })
    expect(s.host.last().text).toContain('o usuário escolheu você')
  })

  it('recusa quem não é membro, quem já recebeu e o que não é mensagem sua', async () => {
    const s = withChannel(['ada', 'chefe'])
    await s.svc.post(s.c.id, '@Ada oi')
    await s.svc.idle()
    const msg = user(s, s.c.id)[0]
    await expect(s.svc.reroute(s.c.id, msg.id, 'rev')).rejects.toThrow('não é membro')
    await expect(s.svc.reroute(s.c.id, msg.id, 'ada')).rejects.toThrow('já foi para Ada')
    await expect(s.svc.reroute(s.c.id, 'nada', 'chefe')).rejects.toThrow('não está mais no canal')
  })

  it('anexos perdidos depois de reiniciar: avisa', async () => {
    const s = withChannel()
    s.store
      .thread(s.c.id)
      .put({ id: 'velha', t: 1, kind: 'user', text: 'veja', attachments: [{ name: 'a.png', kind: 'image', size: 1 }], to: ['ada'] })
    await s.svc.reroute(s.c.id, 'velha', 'chefe')
    await s.svc.idle()
    expect(notices(s, s.c.id)[0].text).toContain('anexos dessa mensagem não vão')
    expect(s.host.last().attachments).toEqual([])
  })
})

describe('busca nos canais', () => {
  it('acha nos canais do andar, a mais nova primeiro', async () => {
    const s = withChannel()
    s.store.thread(s.c.id).put({ id: 'a', t: 5, kind: 'user', text: 'deploy amanhã' })
    s.store.thread(floorChannelId('p2')).put({ id: 'b', t: 6, kind: 'user', text: 'deploy da loja' })
    expect(s.svc.search('deploy', 'p1').map((h) => h.threadId)).toEqual([s.c.id])
    expect(s.svc.search('deploy').map((h) => h.item.id)).toEqual(['b', 'a'])
  })
})

describe('IPC dos canais', () => {
  function ipc(s: Setup) {
    const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
    registerBotChannelsIpc({ channels: s.svc, bots: () => s.store.bots, floors: () => floors, handle: (ch, fn) => handlers.set(ch, fn) })
    return (ch: string, ...args: unknown[]) => handlers.get(ch)!({}, ...args)
  }

  it('registra os cinco handlers e limpa cada argumento', async () => {
    const s = withChannel()
    const call = ipc(s)
    expect((call('office:listChannels') as Channel[]).map((c) => c.id)).toContain(s.c.id)
    const made = call('office:saveChannel', { name: 'Suporte', floor: 'p1', members: ['ada'] }) as Channel
    expect(made.name).toBe('suporte')
    expect(() => call('office:saveChannel', { name: 'x', floor: 'p1', members: ['loja'] })).toThrow('Só bots do andar')
    expect(() => call('office:deleteChannel', '')).toThrow('não existe mais')
    expect(() => call('office:postToChannel', s.c.id, '   ', [])).toThrow('Escreva uma mensagem')
    expect(() => call('office:postToChannel', s.c.id, 'oi', [{ name: 3 }])).toThrow('anexo chegou estragado')
    expect(() => call('office:postToChannel', 42, 'oi')).toThrow('não existe mais')
    await call('office:postToChannel', s.c.id, '@Ada oi')
    await s.svc.idle()
    expect(s.host.sent).toHaveLength(1)
    expect(() => call('office:rerouteChannelMessage', s.c.id, 'x'.repeat(300), 'ada')).toThrow('não está mais no canal')
    call('office:deleteChannel', made.id)
    expect(s.svc.channel(made.id)).toBeUndefined()
  })

  it('cleanPost aceita só anexos sem texto', () => {
    expect(cleanPost('', [{ name: 'a.png', path: '/a.png' }]).attachments).toHaveLength(1)
    expect(cleanPost('  oi  ', undefined)).toEqual({ text: 'oi', attachments: [] })
  })
})

describe('o BotRunner como host', () => {
  it('manda sem linha do usuário, ouve run:end e diz o fio da rodada em curso', async () => {
    const calls: unknown[][] = []
    const events: string[] = []
    let active: { runId: string } | undefined
    const runner = {
      send: async (...args: unknown[]) => {
        calls.push(args)
        return { runId: 'r1' }
      },
      activeRun: () => active,
      on: (event: string, fn: (e: unknown) => void) => {
        events.push(event)
        fn({ botId: 'ada', runId: 'r1' })
        return runner
      },
    }
    const bot = makeBot('ada', 'Ada', 'p1', {
      runs: [{ id: 'r1', trigger: { kind: 'message' }, startedAt: 1, status: 'running', steps: 0, threadId: 'canal-x', itemId: 'i' }],
    })
    const host = runnerHost(runner as unknown as Parameters<typeof runnerHost>[0], (id) => (id === 'ada' ? bot : undefined))
    const trigger = { kind: 'channel', channelId: 'canal-x' } as const
    expect(await host.send('ada', 'oi', [], trigger, { threadId: 'canal-x', showUser: false })).toEqual({ runId: 'r1' })
    expect(calls[0]).toEqual(['ada', 'oi', [], trigger, { threadId: 'canal-x', showUser: false }])
    const seen: unknown[] = []
    host.onRunEnd((e) => seen.push(e))
    expect(events).toEqual(['run:end'])
    expect(seen).toHaveLength(1)
    expect(host.activeThread('ada')).toBeUndefined()
    active = { runId: 'r1' }
    expect(host.activeThread('ada')).toBe('canal-x')
    active = { runId: 'outra' }
    expect(host.activeThread('ada')).toBe('ada')
  })
})
