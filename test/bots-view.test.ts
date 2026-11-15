import { describe, expect, it } from 'vitest'
import type { Bot, BotEventTrigger, BotRun, ThreadItem } from '@shared/types'
import { BOT_LIMITS } from '@shared/types'
import {
  approvalHeading,
  approvalOutcome,
  atBottom,
  badgeText,
  botAutomations,
  botSpending,
  botState,
  botStatusLine,
  botsOnFloor,
  clockTime,
  countsAsUnread,
  dayLabel,
  draftError,
  draftFromBot,
  eventLabel,
  itemPreview,
  itemText,
  keepNewest,
  lastMessage,
  listTime,
  memorySizeLabel,
  nextAutomation,
  prependPage,
  reorderBots,
  replyIntent,
  runLive,
  runSummary,
  sameDay,
  scheduleLabel,
  searchItems,
  shortDuration,
  snippet,
  sortBots,
  stepsLabel,
  threadMarkdown,
  triggerLabel,
  unreadCount,
  upsertItem,
  usd,
  utf8Bytes,
} from '@shared/bots-view'

// CB-08 a CB-10: as regras puras da tela do Chat (docs/prd/chat-de-bots.md, "Experiência").

/** Domingo, 15/11/2026, 12:00 no fuso local. */
const NOW = new Date(2026, 10, 15, 12, 0).getTime()
const at = (day: number, h: number, m = 0, month = 10, year = 2026) => new Date(year, month, day, h, m).getTime()

const bot = (over: Partial<Bot> = {}): Bot => ({
  id: 'b1',
  name: 'Chefe de gabinete',
  tagline: 'Abre o dia',
  role: 'Você é o chefe de gabinete.',
  color: '#d97757',
  look: { skin: '#f6d3b3', hair: '#2b1d16', hairStyle: 0, shirt: '#e2574c', pants: '#2f3b5c', shoes: '#1e1e24' },
  floor: 'ao',
  permissionMode: 'default',
  askBefore: ['send', 'publish', 'delete', 'pay', 'push'],
  apps: 'all',
  worktree: false,
  dailyBudgetUsd: 0,
  pinned: false,
  hidden: false,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  lastReadAt: 0,
  runs: [],
  ...over,
})

const run = (over: Partial<BotRun> = {}): BotRun => ({
  id: 'r1',
  trigger: { kind: 'manual' },
  startedAt: at(15, 9),
  status: 'ok',
  steps: 3,
  threadId: 'b1',
  itemId: 'i-run',
  ...over,
})

const userItem = (id: string, t: number, text = 'oi'): ThreadItem => ({ id, t, kind: 'user', text })
const botItem = (id: string, t: number, text = 'Feito.'): ThreadItem => ({ id, t, kind: 'bot', botId: 'b1', text })
const runItem = (over: Partial<Extract<ThreadItem, { kind: 'run' }>> = {}): Extract<ThreadItem, { kind: 'run' }> => ({
  id: 'run1',
  t: at(15, 9),
  kind: 'run',
  botId: 'b1',
  runId: 'r1',
  trigger: { kind: 'manual' },
  label: 'Rodar agora',
  status: 'ok',
  steps: 12,
  ...over,
})
const approval = (over: Partial<Extract<ThreadItem, { kind: 'approval' }>> = {}): Extract<ThreadItem, { kind: 'approval' }> => ({
  id: 'ap1',
  t: at(15, 7, 31),
  kind: 'approval',
  botId: 'b1',
  requestId: 'p1',
  request: {
    kind: 'tool',
    toolName: 'mcp__office__ticket_update',
    title: 'Mover o AO-31 para Fazendo',
    detail: 'AO-31 → Fazendo',
    canAlwaysAllow: false,
  },
  status: 'pending',
  ...over,
})

describe('dayLabel e horários', () => {
  it('diz Hoje, Ontem e o dia da semana com a data', () => {
    expect(dayLabel(at(15, 7, 30), NOW)).toBe('Hoje')
    expect(dayLabel(at(14, 23, 59), NOW)).toBe('Ontem')
    expect(dayLabel(at(9, 10), NOW)).toBe('Seg, 9 nov')
    expect(dayLabel(at(10, 10), NOW)).toBe('Ter, 10 nov')
  })

  it('põe o ano quando é de outro ano', () => {
    expect(dayLabel(at(10, 10, 0, 10, 2025), NOW)).toBe('Seg, 10 nov 2025')
  })

  it('formata a hora e compara dias', () => {
    expect(clockTime(at(15, 7, 5))).toBe('07:05')
    expect(sameDay(at(15, 0, 1), at(15, 23, 59))).toBe(true)
    expect(sameDay(at(14, 23, 59), at(15, 0, 1))).toBe(false)
  })

  it('mostra a hora da lateral como agora, hora, ontem, dia da semana ou data', () => {
    expect(listTime(NOW - 20_000, NOW)).toBe('agora')
    expect(listTime(at(15, 7, 30), NOW)).toBe('07:30')
    expect(listTime(at(14, 9), NOW)).toBe('ontem')
    expect(listTime(at(11, 9), NOW)).toBe('qua')
    expect(listTime(at(2, 9), NOW)).toBe('2 nov')
  })
})

describe('scheduleLabel e eventLabel', () => {
  it('escreve cada tipo de agenda em poucas palavras', () => {
    expect(scheduleLabel({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30' })).toBe('Dias úteis às 07:30')
    expect(scheduleLabel({ kind: 'weekly', days: [5], time: '17:00' })).toBe('Sextas às 17:00')
    expect(scheduleLabel({ kind: 'weekly', days: [0, 6], time: '10:00' })).toBe('Fins de semana às 10:00')
    expect(scheduleLabel({ kind: 'weekly', days: [5, 1, 3], time: '09:00' })).toBe('Seg, Qua e Sex às 09:00')
    expect(scheduleLabel({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '08:00' })).toBe('Todo dia às 08:00')
    expect(scheduleLabel({ kind: 'daily', time: '09:00' })).toBe('Todo dia às 09:00')
    expect(scheduleLabel({ kind: 'interval', every: 30, unit: 'minutes' })).toBe('A cada 30 min')
    expect(scheduleLabel({ kind: 'interval', every: 1, unit: 'hours' })).toBe('A cada hora')
    expect(scheduleLabel({ kind: 'interval', every: 4, unit: 'hours' })).toBe('A cada 4 h')
    expect(scheduleLabel({ kind: 'once', at: '2026-11-21T17:00' })).toBe('Em 21/11 às 17:00')
    expect(scheduleLabel({ kind: 'once', at: 'quebrado' })).toBe('Uma vez')
    expect(scheduleLabel({ kind: 'cron', expr: ' 0 9 * * 1 ' })).toBe('Cron 0 9 * * 1')
  })

  it('escreve os eventos do escritório', () => {
    expect(eventLabel('ticket-created', { tags: ['bug'] })).toBe('Quando nasce um ticket #bug')
    expect(eventLabel('ticket-created')).toBe('Quando nasce um ticket')
    expect(eventLabel('ticket-moved', { column: 'review' })).toBe('Quando um ticket vai para Revisão')
    expect(eventLabel('ticket-moved', {})).toBe('Quando um ticket muda de coluna')
    expect(eventLabel('meeting-ata')).toBe('Quando uma ata fica pronta')
    expect(eventLabel('bot-done', { onlyOk: true })).toBe('Quando outro bot termina bem')
    expect(eventLabel('bot-done')).toBe('Quando outro bot termina')
  })

  it('junta as automações do bot e escolhe a próxima', () => {
    const trigger = {
      id: 't1',
      botId: 'b1',
      name: 'bugs',
      kind: 'ticket-created',
      filter: { tags: ['bug'] },
      enabled: true,
    } as BotEventTrigger
    const routines = [
      { who: { kind: 'bot', botId: 'b1' }, schedule: { kind: 'daily', time: '09:00' } as const, enabled: true, nextAt: at(16, 9) },
      { who: { kind: 'bot', botId: 'b1' }, schedule: { kind: 'daily', time: '08:00' } as const, enabled: true, nextAt: at(16, 8) },
      { who: { kind: 'bot', botId: 'b1' }, schedule: { kind: 'daily', time: '07:00' } as const, enabled: false, nextAt: at(16, 7) },
      { who: { kind: 'bot', botId: 'b2' }, schedule: { kind: 'daily', time: '06:00' } as const, enabled: true, nextAt: at(16, 6) },
      { who: { kind: 'new' }, schedule: { kind: 'daily', time: '05:00' } as const, enabled: true, nextAt: at(16, 5) },
    ]
    const list = botAutomations('b1', routines, [trigger, { ...trigger, id: 't2', enabled: false }])
    expect(list.map((a) => a.label)).toEqual(['Todo dia às 09:00', 'Todo dia às 08:00', 'Quando nasce um ticket #bug'])
    expect(nextAutomation(list)?.label).toBe('Todo dia às 08:00')
    expect(nextAutomation([{ label: 'evento', nextAt: null }])?.label).toBe('evento')
    expect(nextAutomation([])).toBeNull()
  })
})

describe('botStatusLine', () => {
  const working = { status: 'working' as const, activity: 'Lendo app.ts' }
  const next = { label: 'Dias úteis às 07:30', nextAt: at(16, 7, 30) }

  it('1. pedido pendente vem antes de tudo', () => {
    const line = botStatusLine(bot({ runs: [run({ status: 'failed' })] }), working, [{ kind: 'tool' }], next, NOW)
    expect(line).toEqual({ text: 'Esperando seu sim', tone: 'wait' })
    expect(botStatusLine(bot(), working, [{ kind: 'question' }], null, NOW).text).toBe('Esperando sua resposta')
    expect(botStatusLine(bot(), working, [{ kind: 'plan' }], null, NOW).text).toBe('Esperando você aprovar o plano')
    expect(botStatusLine(bot(), { status: 'waiting', activity: '' }, [], null, NOW).tone).toBe('wait')
  })

  it('2. trabalhando, com o que está fazendo', () => {
    expect(botStatusLine(bot({ runs: [run({ status: 'failed' })] }), working, [], next, NOW)).toEqual({
      text: 'Trabalhando · Lendo app.ts',
      tone: 'work',
    })
    expect(botStatusLine(bot({ runs: [run({ status: 'running' })] }), undefined, [], next, NOW)).toEqual({
      text: 'Trabalhando',
      tone: 'work',
    })
  })

  it('3. a última rodada falhou', () => {
    expect(botStatusLine(bot({ runs: [run({ status: 'failed', endedAt: at(15, 9) })] }), undefined, [], next, NOW)).toEqual({
      text: 'Falhou às 09:00',
      tone: 'fail',
    })
    expect(botStatusLine(bot({ runs: [run({ status: 'failed', endedAt: at(14, 9) })] }), undefined, [], next, NOW).text).toBe(
      'Falhou ontem às 09:00',
    )
    expect(botStatusLine(bot({ runs: [run({ status: 'failed', startedAt: at(3, 9) })] }), undefined, [], next, NOW).text).toBe(
      'Falhou em 03/11',
    )
  })

  it('4. a próxima automação', () => {
    expect(botStatusLine(bot({ runs: [run()] }), { status: 'idle', activity: '' }, [], next, NOW)).toEqual({
      text: 'Dias úteis às 07:30',
      tone: 'next',
    })
  })

  it('5. o começo da última mensagem, e por fim a frase do bot', () => {
    expect(botStatusLine(bot(), undefined, [], null, NOW, botItem('x', at(15, 7), '## Três coisas\npedem você hoje'))).toEqual({
      text: 'Três coisas',
      tone: 'last',
    })
    expect(botStatusLine(bot(), undefined, [], null, NOW, userItem('y', at(15, 7), 'rode agora')).text).toBe('Você: rode agora')
    expect(botStatusLine(bot(), undefined, [], null, NOW)).toEqual({ text: 'Abre o dia', tone: 'none' })
    expect(botStatusLine(bot({ tagline: '' }), undefined, [], null, NOW).text).toBe('Sem mensagens ainda')
  })

  it('dá o estado do avatar', () => {
    expect(botState(bot(), undefined, [{}])).toBe('waiting')
    expect(botState(bot(), { status: 'starting' }, [])).toBe('working')
    expect(botState(bot({ runs: [run({ status: 'failed' })] }), { status: 'idle' }, [])).toBe('failed')
    expect(botState(bot({ runs: [run()] }), undefined, [])).toBe('idle')
  })
})

describe('não lidas, ordem e o fio', () => {
  it('conta só o que o bot disse depois da última leitura', () => {
    const items: ThreadItem[] = [
      botItem('a', 100),
      userItem('b', 300),
      botItem('c', 400),
      runItem({ id: 'd', t: 500 }),
      approval({ id: 'e', t: 600 }),
      { id: 'f', t: 700, kind: 'notice', text: 'Nova conversa' },
      { id: 'g', t: 800, kind: 'notice', text: 'Teto de custo atingido', tone: 'error' },
      { id: 'h', t: 900, kind: 'side', fromBotId: 'b1', toBotId: 'b2', question: '?', status: 'asked' },
      { id: 'i', t: 950, kind: 'side', fromBotId: 'b1', toBotId: 'b2', question: '?', answer: 'sim', status: 'answered' },
    ]
    expect(unreadCount(items, 200)).toBe(4)
    expect(unreadCount(items, 0)).toBe(5)
    expect(unreadCount(items, 1000)).toBe(0)
    expect(countsAsUnread({ id: 'w', t: 1, kind: 'notice', text: '', tone: 'warn' })).toBe(true)
    expect(badgeText(0)).toBe('')
    expect(badgeText(7)).toBe('7')
    expect(badgeText(120)).toBe('99+')
  })

  it('ordena com os fixados no topo e filtra o andar', () => {
    const list = [
      bot({ id: 'a', order: 2 }),
      bot({ id: 'b', order: 0, pinned: true }),
      bot({ id: 'c', order: 1 }),
      bot({ id: 'd', order: 1, createdAt: 0 }),
      bot({ id: 'e', order: 5, pinned: true }),
    ]
    expect(sortBots(list).map((b) => b.id)).toEqual(['b', 'e', 'd', 'c', 'a'])
    const floors = [bot({ id: 'x', floor: 'ao' }), bot({ id: 'y', floor: 'terreo' }), bot({ id: 'z', floor: 'ao', hidden: true })]
    expect(botsOnFloor(floors, 'ao').map((b) => b.id)).toEqual(['x'])
    expect(botsOnFloor(floors, 'ao', true).map((b) => b.id)).toEqual(['x', 'z'])
    expect(botsOnFloor(floors, 'all').map((b) => b.id)).toEqual(['x', 'y'])
  })

  it('reordena ao arrastar, sem tirar o bot do grupo dele', () => {
    const sorted = [
      { id: 'p', pinned: true, order: 0 },
      { id: 'a', pinned: false, order: 0 },
      { id: 'b', pinned: false, order: 1 },
      { id: 'c', pinned: false, order: 2 },
    ]
    expect(reorderBots(sorted, 'c', 'a', 'before')).toEqual([
      { id: 'c', order: 0 },
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ])
    expect(reorderBots(sorted, 'a', 'c', 'after')).toEqual([
      { id: 'b', order: 0 },
      { id: 'c', order: 1 },
      { id: 'a', order: 2 },
    ])
    // dropped on the pinned one: goes to the top of the unpinned
    expect(reorderBots(sorted, 'b', 'p', 'after')).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1 },
    ])
    expect(reorderBots(sorted, 'a', 'a', 'after')).toEqual([])
    expect(reorderBots(sorted, 'zz', 'a', 'after')).toEqual([])
  })

  it('atualiza no lugar o item que volta com o mesmo id', () => {
    const items = [userItem('a', 1), runItem({ id: 'r', t: 2, status: 'running' })]
    const up = upsertItem(items, runItem({ id: 'r', t: 2, status: 'ok' }))
    expect(up.added).toBe(false)
    expect(up.items.map((x) => x.id)).toEqual(['a', 'r'])
    expect((up.items[1] as Extract<ThreadItem, { kind: 'run' }>).status).toBe('ok')
    const add = upsertItem(items, botItem('b', 3))
    expect(add.added).toBe(true)
    expect(add.items.map((x) => x.id)).toEqual(['a', 'r', 'b'])
  })

  it('junta a página antiga na frente sem repetir', () => {
    expect(prependPage([userItem('a', 1), userItem('b', 2)], [userItem('b', 2), userItem('c', 3)]).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(keepNewest([userItem('a', 1), userItem('b', 2), userItem('c', 3)], 2).map((x) => x.id)).toEqual(['b', 'c'])
    expect(keepNewest([userItem('a', 1)], 2)).toHaveLength(1)
  })

  it('acha a última mensagem e sabe quando a rolagem está no fim', () => {
    expect(lastMessage([botItem('a', 1), runItem({ id: 'r', t: 2 })])?.id).toBe('a')
    expect(lastMessage([runItem({ id: 'r', t: 2 })])?.id).toBe('r')
    expect(lastMessage([])).toBeUndefined()
    expect(atBottom(560, 400, 1000)).toBe(true)
    expect(atBottom(500, 400, 1000)).toBe(false)
  })
})

describe('rodadas e aprovações', () => {
  it('resume a rodada recolhida e a que roda', () => {
    expect(runSummary({ steps: 12, durationMs: 100_000, costUsd: 0.08 })).toBe('12 passos · 1min40 · US$ 0,08')
    expect(runSummary({ steps: 1 })).toBe('1 passo')
    expect(runLive({ steps: 12, activity: 'Rodando npm test', status: 'running' })).toBe('Trabalhando · Rodando npm test · 12 passos')
    expect(runLive({ steps: 0, status: 'running' }, 'Lendo app.ts')).toBe('Trabalhando · Lendo app.ts')
    expect(runLive({ steps: 2, status: 'waiting' })).toBe('Esperando você · 2 passos')
  })

  it('formata duração, custo e passos', () => {
    expect(shortDuration(12_000)).toBe('12s')
    expect(shortDuration(7_500_000)).toBe('2h05')
    expect(usd(0)).toBe('')
    expect(usd(0.004)).toBe('< US$ 0,01')
    expect(usd(1.5)).toBe('US$ 1,50')
    expect(stepsLabel(1)).toBe('1 passo')
  })

  it('diz o gatilho de cada rodada', () => {
    expect(triggerLabel({ kind: 'message' })).toBe('Mensagem')
    expect(triggerLabel({ kind: 'manual' })).toBe('Rodar agora')
    expect(triggerLabel({ kind: 'schedule', routineId: 'r', label: '⚡ Dias úteis às 07:30' })).toBe('⚡ Dias úteis às 07:30')
    expect(triggerLabel({ kind: 'event', triggerId: 't', label: '🎫 AO-44 criado' })).toBe('🎫 AO-44 criado')
    expect(triggerLabel({ kind: 'channel', channelId: 'c' })).toBe('Canal')
    expect(triggerLabel({ kind: 'ask', fromBotId: 'b2' })).toBe('Pedido de outro bot')
  })

  it('vira uma linha depois de decidido', () => {
    expect(approvalOutcome(approval({ status: 'allowed', decidedAt: at(15, 7, 41) }))).toBe('Você permitiu às 07:41')
    expect(approvalOutcome(approval({ status: 'denied', decidedAt: at(15, 7, 41), note: 'só depois das 15h' }))).toBe(
      'Você negou às 07:41 · só depois das 15h',
    )
    expect(approvalOutcome(approval({ status: 'answered', decidedAt: at(15, 7, 41), note: 'Pix' }))).toBe('Você respondeu às 07:41: Pix')
    expect(approvalOutcome(approval({ status: 'expired' }))).toBe('O pedido expirou sem resposta')
    expect(approvalOutcome(approval())).toBe('Esperando você')
    const plan = approval({
      request: { kind: 'plan', toolName: 'ExitPlanMode', title: 'Plano', detail: '', canAlwaysAllow: false, plan: '1. ler' },
    })
    expect(approvalOutcome({ ...plan, status: 'allowed' })).toBe('Você aprovou o plano')
    expect(approvalOutcome({ ...plan, status: 'denied' })).toBe('Você pediu mudanças')
    expect(approvalHeading(plan.request)).toBe('Plano')
    expect(approvalHeading({ ...plan.request, kind: 'question' })).toBe('Pergunta')
    expect(approvalHeading(approval().request)).toBe('Aprovação')
    expect(approvalHeading({ ...approval().request, sensitive: 'push' })).toBe('Aprovação · Git remoto')
  })
})

describe('replyIntent', () => {
  const allow = [
    'pode',
    'Pode!',
    'sim',
    'Sim, pode',
    'ok',
    'OK!!',
    'manda',
    'Manda ver',
    'manda bala',
    'pode mover',
    'pode mover o AO-31',
    'beleza',
    'claro',
    'vai',
    'aprovado',
    '👍',
    's',
    'tá bom',
    'pode seguir',
    'segue',
    'fechado',
    'bora',
    'pode sim',
    'autorizo',
    'confirmo',
    'tudo bem',
    'pode, obrigado',
  ]
  const deny = [
    'não',
    'Não!',
    'nao',
    'n',
    'no',
    'pare',
    'para',
    'espera',
    'espere um pouco',
    'não pode',
    'não, use o branch dev',
    'cancela',
    'negado',
    'agora não',
    'melhor não',
    'ainda não',
    '👎',
    'nem pensar',
    'não faça isso',
    'não mexa no ticket ainda',
    'nunca faça push',
    'não precisa',
  ]
  const ask = [
    '',
    '   ',
    'pode?',
    'pode mover, mas só depois das 15h',
    'sim, mas espera',
    'talvez',
    'não sei',
    'n sei',
    'acho que sim',
    'acho que não',
    'depende',
    'use o arquivo config.ts em vez disso',
    'o que isso faz?',
    'hmm',
    'ok, pare',
    'pode parar',
    'depois das 15h',
    'só se os testes passarem',
    'primeiro rode os testes',
    'não, pode sim',
    'para mim tudo bem',
    'continua sem mexer no banco',
    'pode, não mexe no banco',
    'pode apagar tudo do banco de produção agora mesmo',
    'no branch dev, pode',
    'vamos com calma',
  ]

  it.each(allow)('"%s" permite', (t) => expect(replyIntent(t)).toBe('allow'))
  it.each(deny)('"%s" nega', (t) => expect(replyIntent(t)).toBe('deny'))
  it.each(ask)('"%s" pergunta', (t) => expect(replyIntent(t)).toBe('ask'))

  it('tem mais de 30 frases no corpus', () => {
    expect(allow.length + deny.length + ask.length).toBeGreaterThan(30)
  })
})

describe('perfil', () => {
  it('mostra o tamanho da memória', () => {
    expect(memorySizeLabel('')).toBe('0 de 16 KB')
    expect(memorySizeLabel('a'.repeat(3277))).toBe('3,2 de 16 KB')
    expect(utf8Bytes('ção')).toBe(5)
    expect(memorySizeLabel('a'.repeat(BOT_LIMITS.memoryBytes))).toBe('16 de 16 KB')
  })

  it('soma os gastos de hoje, 7 e 30 dias', () => {
    const runs = [
      { startedAt: at(15, 9), costUsd: 0.1 },
      { startedAt: at(12, 9), endedAt: at(12, 9, 5), costUsd: 0.2 },
      { startedAt: at(1, 9), costUsd: 0.4 },
      { startedAt: at(1, 9, 0, 8), costUsd: 1 },
      { startedAt: at(15, 10) },
    ]
    const s = botSpending(runs, NOW)
    expect(s.today).toBeCloseTo(0.1)
    expect(s.week).toBeCloseTo(0.3)
    expect(s.month).toBeCloseTo(0.7)
  })

  it('monta o rascunho a partir do bot', () => {
    const b = bot({ apps: ['office', 'github'], model: 'sonnet', templateId: 'chefe-de-gabinete' })
    const d = draftFromBot(b)
    expect(d).toMatchObject({
      id: 'b1',
      name: b.name,
      role: b.role,
      floor: 'ao',
      model: 'sonnet',
      apps: ['office', 'github'],
      templateId: 'chefe-de-gabinete',
    })
    d.askBefore!.pop()
    expect(b.askBefore).toHaveLength(5)
    expect(draftFromBot(bot()).apps).toBe('all')
  })

  it('diz o que falta no formulário', () => {
    const ok = { name: 'Bot', role: 'Faz algo', floor: 'ao' }
    expect(draftError(ok)).toBeNull()
    expect(draftError({ ...ok, name: '  ' })).toMatch(/nome/)
    expect(draftError({ ...ok, name: 'x'.repeat(BOT_LIMITS.name + 1) })).toMatch(/40 caracteres/)
    expect(draftError({ ...ok, role: '' })).toMatch(/função/)
    expect(draftError({ ...ok, role: 'x'.repeat(BOT_LIMITS.role + 1) })).toMatch(/função passa/)
    expect(draftError({ ...ok, floor: '' })).toMatch(/andar/)
    expect(draftError({ ...ok, floor: 'terreo' })).toMatch(/pasta/)
    expect(draftError({ ...ok, floor: 'terreo', cwd: '/tmp/x' })).toBeNull()
  })
})

describe('busca e exportação', () => {
  const items: ThreadItem[] = [
    userItem('u', at(14, 18), 'Rode agora para eu ver'),
    runItem({
      id: 'r',
      t: at(15, 7, 30),
      label: '⚡ Dias úteis às 07:30',
      durationMs: 100_000,
      costUsd: 0.08,
      log: [{ t: 1, kind: 'tool', text: 'Lendo o quadro', tool: 'mcp__office__tickets_list' }],
    }),
    botItem('b', at(15, 7, 31), 'Três coisas pedem você hoje: a revisão do AO-31.'),
    approval({ id: 'a', t: at(15, 7, 32), status: 'allowed', decidedAt: at(15, 7, 41) }),
    { id: 'n', t: at(15, 8), kind: 'notice', text: 'Nova conversa' },
    {
      id: 's',
      t: at(15, 9),
      kind: 'side',
      fromBotId: 'b1',
      toBotId: 'b2',
      question: 'O deploy é hoje?',
      answer: 'Às 14h',
      status: 'answered',
    },
    { id: 'q', t: at(15, 10), kind: 'user', text: 'segue', attachments: [{ name: 'print.png', kind: 'image', size: 10 }] },
  ]

  it('busca sem ligar para acento e caixa', () => {
    expect(searchItems(items, 'REVISAO')).toEqual(['b'])
    expect(searchItems(items, 'quadro')).toEqual(['r'])
    expect(searchItems(items, 'ao-31')).toEqual(['b', 'a'])
    expect(searchItems(items, 'deploy')).toEqual(['s'])
    expect(searchItems(items, 'print')).toEqual(['q'])
    expect(searchItems(items, '  ')).toEqual([])
    expect(
      itemText({
        ...approval(),
        request: {
          ...approval().request,
          questions: [{ question: 'Qual?', header: 'h', multiSelect: false, options: [{ label: 'Pix', description: '' }] }],
        },
      }),
    ).toContain('Pix')
  })

  it('resume cada item numa linha', () => {
    expect(itemPreview(items[0])).toBe('Você: Rode agora para eu ver')
    expect(itemPreview(items[1])).toBe('⚡ Dias úteis às 07:30 · pronto')
    expect(itemPreview(items[3])).toBe('Pedido: Mover o AO-31 para Fazendo')
    expect(itemPreview(items[5])).toBe('Às 14h')
    expect(itemPreview({ id: 'z', t: 1, kind: 'user', text: '', attachments: [{ name: 'a', kind: 'file', size: 1 }] })).toBe(
      'Você: 1 anexo(s)',
    )
    expect(snippet('x'.repeat(100), 10)).toBe('xxxxxxxxx…')
  })

  it('exporta o fio em Markdown com os dias e cada tipo de item', () => {
    const md = threadMarkdown('Chefe de gabinete', items, NOW)
    expect(md).toMatch(/^# Chefe de gabinete\n/)
    expect(md).toContain('7 itens')
    expect(md).toContain('## 14/11/2026')
    expect(md).toContain('## 15/11/2026')
    expect(md).toContain('**18:00 · Você**')
    expect(md).toContain('**07:31 · Chefe de gabinete**')
    expect(md).toContain('> 07:30 · Rodada: ⚡ Dias úteis às 07:30 · 12 passos · 1min40 · US$ 0,08 · pronto')
    expect(md).toContain('Você permitiu às 07:41')
    expect(md).toContain('_08:00 · Nova conversa_')
    expect(md).toContain('Resposta: Às 14h')
    expect(md).toContain('Anexos: print.png')
    const running = threadMarkdown(
      'X',
      [runItem({ status: 'running', error: undefined }), runItem({ id: 'f', status: 'failed', error: 'Teto de custo' })],
      NOW,
    )
    expect(running).toContain('· trabalhando')
    expect(running).toContain('Teto de custo')
  })
})
