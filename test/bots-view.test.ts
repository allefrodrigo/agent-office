import { describe, expect, it } from 'vitest'
import type { AutomationDraft, Bot, BotEventTrigger, BotRun, McpServerView, Routine, ThreadItem } from '@shared/types'
import { BOT_LIMITS } from '@shared/types'
import {
  appsLabel,
  approvalHeading,
  approvalOutcome,
  atBottom,
  automationCounts,
  automationEntries,
  automationPreview,
  badgeText,
  botAutomations,
  botRoutineDraft,
  botsSeeing,
  clampPerHour,
  cleanApps,
  isOfficeServer,
  listedLastItem,
  mcpStatus,
  missingApps,
  newerItem,
  parseTags,
  routineBotId,
  scheduleDraftError,
  scopeAutomations,
  shiftWeek,
  triggerDraftError,
  unreadFor,
  weekGrid,
  weekStartOf,
  weekTitle,
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
    expect(eventLabel('bot-done', { onlyOk: true })).toBe('Quando qualquer outro bot termina bem')
    expect(eventLabel('bot-done')).toBe('Quando qualquer outro bot termina')
    expect(eventLabel('bot-done', { botId: 'b2', onlyOk: true }, 'Relator')).toBe('Quando Relator termina bem')
    expect(eventLabel('bot-done', {}, 'Relator')).toBe('Quando qualquer outro bot termina')
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

// ---------- fase 2: automações, semana, formulários, conexões (CB-14 a CB-16) ----------

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'rt1',
  name: 'Chefe de gabinete',
  prompt: 'Abra o dia.',
  who: { kind: 'bot', botId: 'b1' },
  permissionMode: 'default',
  schedule: { kind: 'daily', time: '09:00' },
  enabled: true,
  missed: 'run',
  createdAt: 1,
  updatedAt: 1,
  nextAt: null,
  history: [],
  ...over,
})

const trigger = (over: Partial<BotEventTrigger> = {}): BotEventTrigger => ({
  id: 't1',
  botId: 'b1',
  name: 'Caçador de bugs',
  kind: 'ticket-created',
  filter: { tags: ['bug'] },
  prompt: 'Reproduza {ticket}.',
  enabled: true,
  maxPerHour: 6,
  createdAt: 1,
  updatedAt: 1,
  history: [],
  ...over,
})

/** Segunda, 16/11/2026, 00:00: a semana que vem, vista do NOW (domingo). */
const MON16 = at(16, 0)

describe('weekGrid', () => {
  it('põe uma diária nos sete dias, na linha do horário', () => {
    const g = weekGrid([routine()], [], MON16, NOW)
    expect(g.start).toBe(MON16)
    expect(g.days.map((d) => d.label)).toEqual(['Seg 16', 'Ter 17', 'Qua 18', 'Qui 19', 'Sex 20', 'Sáb 21', 'Dom 22'])
    expect(g.rows).toHaveLength(1)
    expect(g.rows[0].time).toBe('09:00')
    expect(g.rows[0].cells.map((c) => c.length)).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(g.rows[0].cells[0][0]).toMatchObject({
      kind: 'schedule',
      id: 'rt1',
      botId: 'b1',
      label: 'Todo dia às 09:00',
      at: at(16, 9),
      paused: false,
    })
    expect(g.every).toEqual([])
    expect(g.events).toEqual([])
  })

  it('põe dias úteis de segunda a sexta, e nada no fim de semana', () => {
    const g = weekGrid([routine({ schedule: { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30' } })], [], MON16, NOW)
    expect(g.rows.map((r) => r.time)).toEqual(['07:30'])
    expect(g.rows[0].cells.map((c) => c.length)).toEqual([1, 1, 1, 1, 1, 0, 0])
    expect(g.rows[0].cells[4][0].label).toBe('Dias úteis às 07:30')
  })

  it('manda o intervalo para a faixa "A cada…"', () => {
    const g = weekGrid(
      [routine({ name: 'Triagem', schedule: { kind: 'interval', every: 30, unit: 'minutes', anchor: 0 } })],
      [],
      MON16,
      NOW,
    )
    expect(g.rows).toEqual([])
    expect(g.every).toEqual([expect.objectContaining({ name: 'Triagem', label: 'A cada 30 min', paused: false })])
  })

  it('põe o cron no dia e na hora em que ele roda', () => {
    const g = weekGrid([routine({ schedule: { kind: 'cron', expr: '0 10 * * 1' } })], [], MON16, NOW)
    expect(g.rows.map((r) => r.time)).toEqual(['10:00'])
    expect(g.rows[0].cells.map((c) => c.length)).toEqual([1, 0, 0, 0, 0, 0, 0])
    expect(g.rows[0].cells[0][0].label).toBe('Cron 0 10 * * 1')
  })

  it('manda o cron que roda muitas vezes por dia para a faixa', () => {
    const g = weekGrid(
      [
        routine({ id: 'a', name: 'A', schedule: { kind: 'cron', expr: '*/30 8-18 * * *' } }),
        routine({ id: 'b', name: 'B', schedule: { kind: 'cron', expr: '*/30 * * * *' } }),
      ],
      [],
      MON16,
      NOW,
    )
    expect(g.rows).toEqual([])
    expect(g.every.map((c) => c.label)).toEqual(['Conforme o cron "*/30 8-18 * * *"', 'A cada 30 minutos'])
  })

  it('põe uma vez dentro da semana no dia dela, e deixa de fora a que cai em outra semana', () => {
    const inside = routine({ id: 'in', schedule: { kind: 'once', at: '2026-11-20T17:00' } })
    const outside = routine({ id: 'out', schedule: { kind: 'once', at: '2026-12-01T09:00' } })
    const g = weekGrid([inside, outside], [], MON16, NOW)
    expect(g.rows.map((r) => r.time)).toEqual(['17:00'])
    expect(g.rows[0].cells.map((c) => c.map((x) => x.id))).toEqual([[], [], [], [], ['in'], [], []])
    expect(g.every).toEqual([])
    expect(weekGrid([outside], [], MON16, NOW).rows).toEqual([])
  })

  it('mostra a rotina pausada, marcada para aparecer apagada', () => {
    const g = weekGrid(
      [routine({ enabled: false, schedule: { kind: 'weekly', days: [5], time: '17:00' } })],
      [trigger({ enabled: false })],
      MON16,
      NOW,
    )
    expect(g.rows[0].cells[4][0].paused).toBe(true)
    expect(g.events[0].paused).toBe(true)
  })

  it('manda os gatilhos de evento para a faixa "Em eventos", por nome', () => {
    const g = weekGrid([], [trigger({ id: 't2', name: 'Ata em tickets', kind: 'meeting-ata', filter: {} }), trigger()], MON16, NOW)
    expect(g.events.map((e) => [e.name, e.label])).toEqual([
      ['Ata em tickets', 'Quando uma ata fica pronta'],
      ['Caçador de bugs', 'Quando nasce um ticket #bug'],
    ])
    expect(g.rows).toEqual([])
  })

  it('ordena as linhas pelo horário e, na mesma célula, pelo nome', () => {
    const g = weekGrid(
      [
        routine({ id: 'r', name: 'Revisor', schedule: { kind: 'weekly', days: [1], time: '18:00' } }),
        routine({ id: 'c', name: 'Chefe', schedule: { kind: 'weekly', days: [1], time: '07:30' } }),
        routine({ id: 'a', name: 'Arquivista', schedule: { kind: 'daily', time: '07:30' } }),
      ],
      [],
      MON16,
      NOW,
    )
    expect(g.rows.map((r) => r.time)).toEqual(['07:30', '18:00'])
    expect(g.rows[0].cells[0].map((c) => c.name)).toEqual(['Arquivista', 'Chefe'])
  })

  it('marca o dia de hoje e as rodadas que já passaram; começa sempre na segunda', () => {
    const wed = at(18, 12)
    const g = weekGrid([routine({ schedule: { kind: 'weekly', days: [1, 5], time: '09:00' } })], [], wed, wed)
    expect(g.start).toBe(MON16)
    expect(g.days.map((d) => d.today)).toEqual([false, false, true, false, false, false, false])
    expect(g.rows[0].cells[0][0].past).toBe(true)
    expect(g.rows[0].cells[4][0].past).toBe(false)
  })

  it('ignora o cron que não lê, sem quebrar a semana', () => {
    const g = weekGrid([routine({ schedule: { kind: 'cron', expr: 'isso não é cron' } }), routine({ id: 'ok' })], [], MON16, NOW)
    expect(g.rows[0].cells[0].map((c) => c.id)).toEqual(['ok'])
  })
})

describe('semanas', () => {
  it('acha a segunda da semana e anda de semana em semana', () => {
    expect(weekStartOf(NOW)).toBe(at(9, 0))
    expect(weekStartOf(MON16)).toBe(MON16)
    expect(weekStartOf(at(22, 23, 59))).toBe(MON16)
    expect(shiftWeek(at(9, 0), 1)).toBe(MON16)
    expect(shiftWeek(MON16, -1)).toBe(at(9, 0))
    expect(shiftWeek(at(18, 15), 2)).toBe(at(30, 0))
  })

  it('dá o título da semana, com o mês quando muda e o ano quando é outro', () => {
    expect(weekTitle(at(9, 0), NOW)).toBe('Esta semana · 9 a 15 nov')
    expect(weekTitle(MON16, NOW)).toBe('Semana que vem · 16 a 22 nov')
    expect(weekTitle(at(2, 0), NOW)).toBe('Semana passada · 2 a 8 nov')
    expect(weekTitle(at(30, 0), NOW)).toBe('30 nov a 6 dez')
    expect(weekTitle(at(4, 0, 0, 0, 2027), NOW)).toBe('4 a 10 jan 2027')
  })
})

describe('lista de automações', () => {
  const bots = [bot({ id: 'b1', floor: 'ao' }), bot({ id: 'b2', floor: 'site' })]
  const routines = [
    routine({ id: 'r1', name: 'Resumo', nextAt: at(16, 9) }),
    routine({ id: 'r2', name: 'Revisor', who: { kind: 'bot', botId: 'b2' }, nextAt: at(16, 8) }),
    routine({ id: 'r3', name: 'Rotina antiga', who: { kind: 'new' } }),
    routine({ id: 'r4', name: 'Pausada', enabled: false, nextAt: null }),
  ]
  const triggers = [trigger({ id: 't1' }), trigger({ id: 't2', botId: 'b2', name: 'Ata', kind: 'meeting-ata', filter: {} })]

  it('sabe qual bot roda a rotina', () => {
    expect(routineBotId(routines[0])).toBe('b1')
    expect(routineBotId(routines[2])).toBeNull()
  })

  it('filtra por andar e por bot, e deixa de fora as rotinas que não são de bot', () => {
    const all = scopeAutomations(routines, triggers, bots, { floor: 'all' })
    expect(all.routines.map((r) => r.id)).toEqual(['r1', 'r2', 'r4'])
    expect(all.triggers.map((t) => t.id)).toEqual(['t1', 't2'])
    const ao = scopeAutomations(routines, triggers, bots, { floor: 'ao' })
    expect(ao.routines.map((r) => r.id)).toEqual(['r1', 'r4'])
    expect(ao.triggers.map((t) => t.id)).toEqual(['t1'])
    const one = scopeAutomations(routines, triggers, bots, { floor: 'all', botId: 'b2' })
    expect(one.routines.map((r) => r.id)).toEqual(['r2'])
    expect(scopeAutomations(routines, triggers, bots, { floor: 'ao', botId: 'b2' }).routines).toEqual([])
  })

  it('lista as ativas primeiro, agenda pela próxima execução, depois eventos e pausadas', () => {
    const list = automationEntries(routines, triggers)
    expect(list.map((e) => e.id)).toEqual(['r2', 'r1', 't2', 't1', 'r4'])
    expect(list[0]).toEqual({
      kind: 'schedule',
      id: 'r2',
      botId: 'b2',
      name: 'Revisor',
      label: 'Todo dia às 09:00',
      enabled: true,
      nextAt: at(16, 8),
    })
    expect(list[3].label).toBe('Quando nasce um ticket #bug')
    expect(list[4].nextAt).toBeNull()
  })

  it('dá nome ao bot de "quando outro bot termina"', () => {
    const done = [trigger({ id: 't9', botId: 'b1', kind: 'bot-done', filter: { botId: 'b2' } })]
    const names = (id: string) => ({ b2: 'Revisor' })[id]
    expect(automationEntries([], done, names)[0].label).toBe('Quando Revisor termina')
    expect(automationEntries([], done)[0].label).toBe('Quando outro bot termina')
    expect(weekGrid([], done, MON16, NOW, names).events[0].label).toBe('Quando Revisor termina')
  })

  it('conta as ativas e as pausadas de um bot', () => {
    expect(automationCounts('b1', routines, triggers)).toEqual({ active: 2, paused: 1 })
    expect(automationCounts('b2', routines, [])).toEqual({ active: 1, paused: 0 })
    expect(automationCounts('nada', routines, triggers)).toEqual({ active: 0, paused: 0 })
  })
})

describe('formulários de automação', () => {
  it('monta a rotina do bot com o andar dele, ou a pasta no térreo', () => {
    const d = botRoutineDraft(bot({ floor: 'ao', permissionMode: 'acceptEdits' }), {
      name: ' Resumo ',
      prompt: ' Resuma. ',
      schedule: { kind: 'daily', time: '09:00' },
    })
    expect(d).toEqual({
      name: 'Resumo',
      prompt: 'Resuma.',
      who: { kind: 'bot', botId: 'b1' },
      floor: 'ao',
      permissionMode: 'acceptEdits',
      schedule: { kind: 'daily', time: '09:00' },
      enabled: true,
      missed: 'run',
    })
    const ground = botRoutineDraft(bot({ floor: 'terreo', cwd: '/tmp/x' }), {
      id: 'rt9',
      name: 'A',
      prompt: 'B',
      schedule: { kind: 'daily', time: '09:00' },
      enabled: false,
      missed: 'skip',
    })
    expect(ground).toMatchObject({ id: 'rt9', cwd: '/tmp/x', enabled: false, missed: 'skip' })
    expect(ground.floor).toBeUndefined()
  })

  it('diz o que falta na agenda', () => {
    const ok = { name: 'A', prompt: 'B', schedule: { kind: 'daily', time: '09:00' } as const }
    expect(scheduleDraftError(ok)).toBeNull()
    expect(scheduleDraftError({ ...ok, name: ' ' })).toBe('Dê um nome à automação.')
    expect(scheduleDraftError({ ...ok, name: 'x'.repeat(61) })).toMatch(/cabe em 60/)
    expect(scheduleDraftError({ ...ok, prompt: '' })).toBe('Escreva a tarefa: o que o bot faz em cada rodada.')
    expect(scheduleDraftError({ ...ok, schedule: { kind: 'interval', every: 5, unit: 'minutes' } })).toBe('O mínimo é a cada 15 minutos.')
  })

  it('diz o que falta no gatilho de evento, e nunca deixa um bot disparar a si mesmo', () => {
    const ok = { botId: 'b1', name: 'Caçador', kind: 'ticket-created' as const, filter: {}, prompt: 'Faça.', maxPerHour: 6 }
    expect(triggerDraftError(ok)).toBeNull()
    expect(triggerDraftError({ ...ok, botId: '' })).toBe('Escolha o bot que roda esta automação.')
    expect(triggerDraftError({ ...ok, prompt: ' ' })).toBe('Escreva a tarefa: o que o bot faz quando o evento acontece.')
    // no bot chosen = any other bot
    expect(triggerDraftError({ ...ok, kind: 'bot-done' })).toBeNull()
    expect(triggerDraftError({ ...ok, kind: 'bot-done', filter: { botId: 'b1' } })).toBe(
      'Um bot nunca dispara a si mesmo. Escolha outro bot.',
    )
    expect(triggerDraftError({ ...ok, kind: 'bot-done', filter: { botId: 'b2' } })).toBeNull()
    expect(triggerDraftError({ ...ok, maxPerHour: BOT_LIMITS.perHourMax + 1 })).toBe('O limite vai de 1 a 30 rodadas por hora.')
    expect(triggerDraftError({ ...ok, maxPerHour: 0 })).toMatch(/de 1 a 30/)
    expect(triggerDraftError({ ...ok, maxPerHour: 2.5 })).toMatch(/de 1 a 30/)
  })

  it('lê as tags sem # e sem repetir', () => {
    expect(parseTags('bug, #urgente  api;Bug')).toEqual(['bug', 'urgente', 'api'])
    expect(parseTags('  ')).toEqual([])
    expect(parseTags(Array.from({ length: 12 }, (_, i) => `t${i}`).join(' '))).toHaveLength(10)
    expect(parseTags('x'.repeat(50))[0]).toHaveLength(40)
  })

  it('segura o limite por hora entre 1 e o máximo (proteção contra laço)', () => {
    expect(clampPerHour(6)).toBe(6)
    expect(clampPerHour(99)).toBe(BOT_LIMITS.perHourMax)
    expect(clampPerHour(0)).toBe(1)
    expect(clampPerHour(-3)).toBe(1)
    expect(clampPerHour(4.6)).toBe(5)
    expect(clampPerHour(Number.NaN)).toBe(BOT_LIMITS.perHourDefault)
  })
})

describe('automationPreview (automação a partir de uma frase)', () => {
  const draft = (over: Partial<AutomationDraft> = {}): AutomationDraft => ({
    bot: { kind: 'existing', botId: 'b1' },
    name: 'Resumo da semana',
    prompt: 'Resuma a semana.',
    when: { kind: 'schedule', schedule: { kind: 'weekly', days: [5], time: '17:00' } },
    why: 'Toda sexta às 17h.',
    ...over,
  })

  it('mostra a frase da agenda e as próximas 3 execuções', () => {
    const p = automationPreview(draft(), NOW)
    expect(p.when).toBe('Roda toda sexta às 17:00.')
    expect(p.next).toEqual([at(20, 17), at(27, 17), at(4, 17, 0, 11)])
    expect(p.line).toBe('Roda toda sexta às 17:00 · próximas: 20/11, 27/11, 4/12')
    expect(p.error).toBeNull()
  })

  it('conta o intervalo novo a partir de agora', () => {
    const p = automationPreview(draft({ when: { kind: 'schedule', schedule: { kind: 'interval', every: 2, unit: 'hours' } } }), NOW)
    expect(p.next).toEqual([at(15, 14), at(15, 16), at(15, 18)])
  })

  it('recusa a agenda impossível e a data que já passou', () => {
    const bad = automationPreview(draft({ when: { kind: 'schedule', schedule: { kind: 'interval', every: 5, unit: 'minutes' } } }), NOW)
    expect(bad.error).toBe('O mínimo é a cada 15 minutos.')
    expect(bad.next).toEqual([])
    const past = automationPreview(draft({ when: { kind: 'schedule', schedule: { kind: 'once', at: '2026-11-10T09:00' } } }), NOW)
    expect(past.error).toMatch(/já passou/)
  })

  it('mostra o evento e o filtro, e pega o laço de um bot consigo', () => {
    const ev = automationPreview(draft({ when: { kind: 'event', event: 'ticket-created', filter: { tags: ['bug'] } } }), NOW)
    expect(ev).toEqual({ when: 'Quando nasce um ticket #bug', next: [], line: 'Quando nasce um ticket #bug', error: null })
    const self = automationPreview(draft({ when: { kind: 'event', event: 'bot-done', filter: { botId: 'b1' } } }), NOW)
    expect(self.error).toMatch(/nunca dispara a si mesmo/)
    const any = automationPreview(draft({ when: { kind: 'event', event: 'bot-done', filter: {} } }), NOW)
    expect(any).toMatchObject({ line: 'Quando qualquer outro bot termina', error: null })
  })

  it('aponta o que falta no bot novo proposto', () => {
    const p = automationPreview(draft({ bot: { kind: 'new', draft: { name: 'Relator', role: '', floor: 'ao' } } }), NOW)
    expect(p.error).toBe('O bot novo não fecha: escreva a função do bot: o que ele faz e o que nunca faz.')
    const ok = automationPreview(draft({ bot: { kind: 'new', draft: { name: 'Relator', role: 'Relata.', floor: 'ao' } } }), NOW)
    expect(ok.error).toBeNull()
    expect(automationPreview(draft({ prompt: '' }), NOW).error).toMatch(/Escreva a tarefa/)
  })
})

describe('não lidas e última linha a partir da lista', () => {
  const items: ThreadItem[] = [botItem('a', at(15, 9)), userItem('b', at(15, 10)), botItem('c', at(15, 11))]

  it('sem o número da lista, conta pelos itens', () => {
    expect(unreadFor({ listed: undefined, listedAt: 0, items, lastReadAt: at(15, 8) })).toBe(2)
  })

  it('com o número da lista, soma só o que chegou depois dela', () => {
    expect(unreadFor({ listed: 5, listedAt: at(15, 10, 30), items, lastReadAt: at(15, 8) })).toBe(6)
    expect(unreadFor({ listed: 5, listedAt: at(15, 12), items, lastReadAt: at(15, 8) })).toBe(5)
    expect(unreadFor({ listed: 0, listedAt: at(15, 8), items: [], lastReadAt: 0 })).toBe(0)
  })

  it('depois de ler aqui conta só o que veio depois; marcado como não lido fica com o maior', () => {
    expect(unreadFor({ listed: 5, listedAt: at(15, 8), items, lastReadAt: 0, override: at(15, 10) })).toBe(1)
    expect(unreadFor({ listed: 5, listedAt: at(15, 8), items, lastReadAt: at(15, 12), override: 0 })).toBe(5)
    expect(unreadFor({ listed: undefined, listedAt: 0, items, lastReadAt: at(15, 12), override: 0 })).toBe(2)
  })

  it('transforma Bot.last num item e fica com o mais novo', () => {
    const fromBot = listedLastItem('b1', { t: at(15, 7), text: 'Feito', from: 'bot' })
    expect(fromBot).toEqual({ id: 'listed-last-b1', t: at(15, 7), kind: 'bot', botId: 'b1', text: 'Feito' })
    expect(listedLastItem('b1', { t: 1, text: 'oi', from: 'user' })?.kind).toBe('user')
    expect(listedLastItem('b1', { t: 1, text: 'Nova conversa', from: 'notice' })?.kind).toBe('notice')
    expect(listedLastItem('b1', undefined)).toBeUndefined()
    expect(newerItem(items[2], fromBot)).toBe(items[2])
    expect(newerItem(items[0], listedLastItem('b1', { t: at(15, 10), text: 'x', from: 'bot' }))?.t).toBe(at(15, 10))
    expect(newerItem(undefined, fromBot)).toBe(fromBot)
    expect(newerItem(items[0], undefined)).toBe(items[0])
  })
})

describe('conexões', () => {
  const server = (over: Partial<McpServerView> = {}): McpServerView => ({
    name: 'github',
    status: 'connected',
    agents: 1,
    uses: 3,
    ...over,
  })

  it('diz o estado do servidor em poucas palavras', () => {
    expect(mcpStatus(server())).toEqual({ text: 'Conectado', tone: 'ok' })
    expect(mcpStatus(server({ status: 'failed', error: 'ECONNREFUSED' }))).toEqual({ text: 'Falhou: ECONNREFUSED', tone: 'fail' })
    expect(mcpStatus(server({ status: 'failed' })).text).toBe('Falhou ao conectar')
    expect(mcpStatus(server({ status: 'needs-auth' })).tone).toBe('warn')
    expect(mcpStatus(server({ status: 'pending' })).tone).toBe('warn')
    expect(mcpStatus(server({ status: 'disabled' })).tone).toBe('off')
    expect(mcpStatus(server({ status: 'unknown' })).tone).toBe('idle')
    expect(mcpStatus(server({ off: true })).text).toBe('Desligado no escritório')
  })

  it('diz quais bots enxergam cada servidor; o office, todos', () => {
    const bots = [bot({ id: 'a', apps: 'all' }), bot({ id: 'b', apps: ['github'] }), bot({ id: 'c', apps: [] })]
    expect(botsSeeing(bots, server()).map((b) => b.id)).toEqual(['a', 'b'])
    expect(botsSeeing(bots, server({ name: 'linear' })).map((b) => b.id)).toEqual(['a'])
    expect(botsSeeing(bots, server({ name: 'office', locked: true })).map((b) => b.id)).toEqual(['a', 'b', 'c'])
    expect(botsSeeing(bots, server({ off: true }))).toEqual([])
    expect(isOfficeServer({ name: 'office' })).toBe(true)
    expect(isOfficeServer({ name: 'x', locked: true })).toBe(true)
    expect(isOfficeServer({ name: 'github' })).toBe(false)
  })

  it('resume e limpa a lista de servidores do bot', () => {
    expect(appsLabel('all')).toBe('Todos os servidores')
    expect(appsLabel([])).toBe('Só o office')
    expect(appsLabel(['office'])).toBe('Só o office')
    expect(appsLabel(['github'])).toBe('office + github')
    expect(appsLabel(['github', 'linear', 'slack'])).toBe('office + github, linear e slack')
    expect(cleanApps('all', ['github'])).toBe('all')
    expect(cleanApps('list', ['github', ' office', 'github', ' linear ', ''])).toEqual(['github', 'linear'])
    expect(missingApps(['github', 'velho', 'office'], [server()])).toEqual(['velho'])
    expect(missingApps('all', [])).toEqual([])
  })
})
