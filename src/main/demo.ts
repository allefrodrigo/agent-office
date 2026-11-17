import { randomUUID } from 'node:crypto'
import { lookFromSeed } from '@shared/describe'
import { nextRun } from '@shared/schedule'
import {
  BOT_COLORS,
  BOT_GROUND_FLOOR,
  DEFAULT_PIPELINE,
  SENSITIVE_KINDS,
  type Bot,
  type BotRun,
  type Customer,
  type Deal,
  type EffortLevel,
  type Payment,
  type PaymentMethod,
  type PaymentState,
  type Recurrence,
  type Routine,
  type RoutineRun,
  type RunStep,
  type Schedule,
  type SquadProgress,
  type ThreadItem,
} from '@shared/types'
import { addDays, addMonths, localDate, recurrenceDue, recurrenceReference } from '@shared/crm'
import type { AgentManager } from './agents'
import { permissionFromTool } from './agents'
import type { BotRunner } from './bots/runner'
import type { BotStore } from './bots/store'
import type { CrmStore } from './crm/store'
import type { RoutineScheduler } from './routines'
import type { SquadDefinition } from './squads'
import type { Store } from './store'

/**
 * Demo mode (AGENT_OFFICE_DEMO=1): fills the office with simulated agents so the
 * world can be previewed without spending tokens. Demo agents are not persisted.
 */
export function startDemo(manager: AgentManager, squads: SquadDefinition[] = []): void {
  // With a squad folder set, the biggest squad plays a cycle on the squad floor too.
  const squad = [...squads].sort((a, b) => b.members.length - a.members.length)[0]
  if (squad) setTimeout(() => startSquadDemo(manager, squad), 1500)
  manager.simulate = (id, prompt) => simulateRun(manager, id, prompt)

  const tools: [string, Record<string, unknown>][] = [
    ['Read', { file_path: 'src/app.tsx' }],
    ['Grep', { pattern: 'useEffect' }],
    ['Edit', { file_path: 'src/routes/api.ts' }],
    ['Bash', { command: 'npm test -- --watch=false' }],
    ['Write', { file_path: 'docs/README.md' }],
    ['WebSearch', { query: 'three.js pixel art' }],
  ]
  const names = ['Ada', 'Turing', 'Grace', 'Linus', 'Hedy', 'Radia']
  // one effort each (Radia on the model's default): the aura shows from high up
  const efforts: (EffortLevel | undefined)[] = ['low', 'medium', 'high', 'xhigh', 'max', undefined]
  const ids = names.map((n, i) => {
    const a = manager.terminalAgent(`demo-${i}`, `/Users/demo/${n}`)
    a.effort = efforts[i]
    return a.id
  })

  ids.forEach((id, i) => {
    manager.terminalPrompt(id, 'Tarefa de demonstração')
    const tick = () => {
      const [tool, input] = tools[Math.floor(Math.random() * tools.length)]
      const summary = manager.list().find((a) => a.id === id)
      if (summary?.status === 'working') manager.terminalUpdate(id, 'working', null, { kind: 'tool', text: `${tool} ${JSON.stringify(input)}`, tool })
      if (summary?.status === 'working') manager.terminalUpdate(id, 'working', describe(tool, input))
      setTimeout(tick, 1800 + Math.random() * 2500)
    }
    setTimeout(tick, 500 + i * 300)
  })

  // Hedy finished earlier and is relaxing in the lounge.
  manager.terminalUpdate(ids[4], 'idle', 'Esperando no terminal')

  setTimeout(() => {
    manager.requestDecision(ids[1], permissionFromTool('Bash', { command: 'npm install three@latest', description: 'Atualiza o three.js' }, undefined, true), () => {
      manager.terminalUpdate(ids[1], 'working', 'Voltando ao trabalho')
    })
  }, 3000)

  // Linus keeps calling subagents (3 at a time), so the helpers show up next to his desk,
  // each with its own log and what it is doing in the balloon (AO-46).
  let round = 0
  const helpers = () => {
    const files = ['agents.ts', 'bridge.ts', 'tickets.ts', 'store.ts', 'usage.ts']
    for (let k = 0; k < 3; k++) {
      const file = files[(round + k) % files.length]
      simulateSubagent(manager, ids[3], { taskId: `demo-sub-${round}-${k}`, description: `Revisar ${file}`, type: k === 2 ? 'general-purpose' : 'Explore', steps: 5 + k * 2, everyMs: 1400, seed: k, fail: round % 4 === 3 && k === 1 })
    }
    round++
    setTimeout(helpers, 26000)
  }
  setTimeout(helpers, 2000)

  setTimeout(() => {
    manager.terminalResult(
      ids[2],
      'Corrigi o bug do login.\n\n- O token expirava antes da hora por causa do fuso.\n- Adicionei 3 testes em `auth.test.ts`.\n- Todos os testes passam.',
    )
  }, 6000)
}

/**
 * A hired or summoned agent in demo mode: reads the request, asks to run the tests, and
 * hands a result after the decision. Same path as a real run (permission card, result card).
 */
function simulateRun(manager: AgentManager, id: string, prompt: string): void {
  manager.terminalUpdate(id, 'working', 'Lendo seu pedido')
  setTimeout(() => {
    manager.terminalUpdate(id, 'working', 'Lendo src/app.tsx', { kind: 'tool', text: 'Read {"file_path":"src/app.tsx"}', tool: 'Read' })
  }, 1200)
  setTimeout(() => {
    manager.requestDecision(id, permissionFromTool('Bash', { command: 'npm test -- --watch=false', description: 'Roda os testes' }, undefined, true), (d) => {
      if (d.behavior === 'deny') return manager.terminalResult(id, `Não rodei os testes, como você pediu.${d.message ? `

Sua orientação: ${d.message}` : ''}`)
      manager.terminalUpdate(id, 'working', 'Rodando os testes')
      setTimeout(() => manager.terminalResult(id, `Feito (demonstração): ${prompt.slice(0, 120)}

- Li o código.
- Rodei os testes: 42 passaram.`), 2500)
    })
  }, 2500)
}

/**
 * Demo routines, one per status the routines board shows: a daily report that ran fine, a weekly
 * check whose last run failed, and a triage that starts now and stops to ask you
 * (yellow LED). Their agents are simulated and nothing is saved.
 */
export function startRoutineDemo(manager: AgentManager, routines: RoutineScheduler): void {
  routines.demoSend = (agentId, text) => {
    manager.terminalPrompt(agentId, text)
    simulateRun(manager, agentId, text)
  }
  const now = Date.now()
  const DAY = 86_400_000
  // days back to the last Monday before today
  const lastMonday = ((new Date(now).getDay() + 6) % 7) || 7
  const rita = manager.demoAgent('Rita', '/Users/demo/relatorios')
  const otto = manager.demoAgent('Otto', '/Users/demo/loja')
  const vera = manager.demoAgent('Vera', '/Users/demo/suporte')
  /** A past run at hh:mm, `daysAgo` days back (0 = today, a few minutes back when that time has not come yet). */
  const ran = (daysAgo: number, hhmm: string, agent: { id: string; name: string }, status: RoutineRun['status'], costUsd: number, error?: string): RoutineRun => {
    const [h, m] = hhmm.split(':').map(Number)
    const d = new Date(now - daysAgo * DAY)
    const startedAt = Math.min(now - 10 * 60_000, new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime())
    return { id: randomUUID(), scheduledFor: startedAt, startedAt, endedAt: startedAt + 4 * 60_000, status, costUsd, agentId: agent.id, agentName: agent.name, ...(error ? { error } : {}) }
  }
  const routine = (name: string, prompt: string, agent: { id: string }, schedule: Schedule, history: RoutineRun[]): Routine => ({
    id: randomUUID(),
    name,
    prompt,
    who: { kind: 'agent', agentId: agent.id },
    permissionMode: 'default',
    schedule,
    enabled: true,
    missed: 'run',
    createdAt: now - 30 * DAY,
    updatedAt: now - 30 * DAY,
    nextAt: nextRun(schedule, now),
    history,
  })
  const triage = routine(
    'Triagem de tickets',
    'Leia os tickets novos do quadro, marque prioridade e tipo e diga quais precisam de mim hoje.',
    vera,
    { kind: 'interval', every: 2, unit: 'hours', anchor: now - 30 * 60_000 },
    [ran(0, '00:00', vera, 'ok', 0.12)],
  )
  routines.addDemo([
    routine(
      'Relatório diário',
      'Resuma o que mudou no repositório desde ontem: commits, PRs abertos e testes falhando. Entregue em tópicos curtos.',
      rita,
      { kind: 'daily', time: '09:00' },
      [ran(1, '09:00', rita, 'ok', 0.42), ran(2, '09:00', rita, 'ok', 0.38), ran(3, '09:00', rita, 'ok', 0.51)],
    ),
    routine(
      'Revisar dependências',
      'Liste as dependências desatualizadas ou com falhas de segurança conhecidas (npm outdated, npm audit) e diga quais atualizar primeiro. Não altere arquivos.',
      otto,
      { kind: 'weekly', days: [1], time: '10:00' },
      [ran(lastMonday, '10:00', otto, 'failed', 0.07, 'npm audit não conseguiu falar com o registro: sem rede (falha simulada).'), ran(lastMonday + 7, '10:00', otto, 'ok', 0.21)],
    ),
    triage,
  ])
  // The triage runs for real (simulated agent): it walks over to ask, and its run waits for you.
  setTimeout(() => void routines.runNow(triage.id).catch(() => undefined), 4000)
}

/**
 * Demo bots for the Chat, one per kind of thread: a morning brief that came in by schedule
 * (unread), a bot whose run waits for your yes to publish, and a finished run with its steps.
 * In memory only (Bot.demo): nothing reaches bots.json. Their runs are played by the agents.
 */
export function startBotDemo(manager: AgentManager, store: BotStore, bots: BotRunner): void {
  const now = Date.now()
  const MIN = 60_000
  const make = (name: string, tagline: string, role: string, color: number, order: number, cwd: string, readAt: number): Bot => ({
    id: randomUUID(),
    name,
    tagline,
    role,
    color: BOT_COLORS[color],
    look: lookFromSeed(`demo-bot:${name}`),
    floor: BOT_GROUND_FLOOR,
    cwd,
    permissionMode: 'default',
    askBefore: [...SENSITIVE_KINDS],
    apps: 'all',
    worktree: false,
    dailyBudgetUsd: 2,
    pinned: order === 0,
    hidden: false,
    order,
    createdAt: now - 20 * 86_400_000,
    updatedAt: now - 20 * 86_400_000,
    lastReadAt: readAt,
    runs: [],
    demo: true,
  })
  const aurora = make(
    'Aurora',
    'Resumo da manhã do andar',
    'Toda manhã, leia os tickets, os commits de ontem e as atas novas e escreva um resumo curto do que pede atenção hoje.',
    0,
    0,
    '/Users/demo/loja',
    now - 3 * 60 * MIN,
  )
  const guarda = make('Guarda', 'Publica as versões da loja', 'Prepara e publica as versões da loja: changelog, tag e npm publish. Nunca publica sem o meu sim.', 3, 1, '/Users/demo/loja', now)
  const teo = make('Teo', 'Roda os testes e diz o que quebrou', 'Roda os testes do projeto, lê as falhas e explica em poucas linhas o que quebrou e onde.', 2, 2, '/Users/demo/loja', now)
  store.bots = [...store.bots, aurora, guarda, teo]

  /** A finished run of the bot `minAgo` minutes back: its run item, its reply and its BotRun. */
  const ran = (bot: Bot, minAgo: number, trigger: BotRun['trigger'], label: string, steps: RunStep[], reply: string, costUsd: number, userText?: string) => {
    const t = now - minAgo * MIN
    const thread = store.thread(bot.id)
    const runId = randomUUID()
    const itemId = randomUUID()
    const durationMs = (steps.length + 1) * 20_000
    if (userText) thread.put({ id: randomUUID(), t: t - 1000, kind: 'user', text: userText })
    const log = steps.map((s, i) => ({ ...s, t: t + (i + 1) * 15_000 }))
    const tools = steps.filter((s) => s.kind === 'tool').length
    thread.put({ id: itemId, t, kind: 'run', botId: bot.id, runId, trigger, label, status: 'ok', steps: tools, costUsd, durationMs, log })
    thread.put({ id: randomUUID(), t: t + durationMs, kind: 'bot', botId: bot.id, text: reply, runId } satisfies ThreadItem)
    bot.runs = [{ id: runId, trigger, startedAt: t, endedAt: t + durationMs, status: 'ok', steps: tools, costUsd, durationMs, threadId: bot.id, itemId }, ...bot.runs]
  }
  const step = (kind: RunStep['kind'], text: string, tool?: string): RunStep => ({ t: 0, kind, text, ...(tool ? { tool } : {}) })

  ran(
    aurora,
    2 * 60,
    { kind: 'schedule', routineId: 'demo', label: '⚡ Dias úteis às 07:30' },
    '⚡ Dias úteis às 07:30',
    [step('tool', 'tickets_list', 'mcp__office__tickets_list'), step('tool', 'git log --since=yesterday --oneline', 'Bash'), step('tool', 'meetings_list', 'mcp__office__meetings_list')],
    'Bom dia! O que pede atenção hoje:\n\n- **AO-44** (checkout lento) segue em *fazendo* há 3 dias, sem commit desde ontem.\n- 6 commits ontem; o build da `main` passou.\n- A ata da daily cita a migração do banco para quinta: ninguém pegou o ticket ainda.',
    0.06,
  )
  ran(
    teo,
    45,
    { kind: 'message' },
    'Mensagem',
    [
      step('tool', 'npm test -- --watch=false', 'Bash'),
      step('assistant', '2 testes falharam em cart.test.ts. Vou ler o arquivo.'),
      step('tool', 'src/cart.ts', 'Read'),
      step('tool', 'test/cart.test.ts', 'Read'),
    ],
    'Rodei os testes: **40 passaram e 2 falharam**, os dois em `test/cart.test.ts`.\n\nO desconto agora arredonda para baixo (`Math.floor` em `src/cart.ts:58`), e os testes esperam o arredondamento comum. Quer que eu ajuste o código ou os testes?',
    0.11,
    'Roda os testes e me diz o que quebrou',
  )
  for (const b of [aurora, teo]) store.update(b)

  // The bots' runs, played: a step, then the reply (Guarda's publish waits for your yes first).
  bots.demoSend = (botId, text) => {
    const agentId = store.bot(botId)?.agentId
    if (!agentId) return
    const publish = botId === guarda.id && /publi/i.test(text)
    manager.terminalUpdate(agentId, 'working', 'Lendo seu pedido')
    setTimeout(() => manager.terminalUpdate(agentId, 'working', 'Lendo CHANGELOG.md', { kind: 'tool', text: 'Read {"file_path":"CHANGELOG.md"}', tool: 'Read' }), 1200)
    if (!publish) {
      setTimeout(() => manager.terminalResult(agentId, `Feito (demonstração): ${text.slice(0, 120)}`), 3000)
      return
    }
    setTimeout(() => {
      const req = permissionFromTool('Bash', { command: 'npm publish', description: 'Publica a versão 0.5.0 no npm' })
      manager.requestDecision(
        agentId,
        req,
        (d) => {
          if (d.behavior === 'deny') return manager.terminalResult(agentId, `Não publiquei, como você pediu.${d.message ? `\n\nSua orientação: ${d.message}` : ''}`)
          manager.terminalUpdate(agentId, 'working', 'Publicando', { kind: 'tool', text: 'npm publish', tool: 'Bash' })
          setTimeout(() => manager.terminalResult(agentId, 'Publiquei a **0.5.0** no npm (demonstração) e criei a tag `v0.5.0`.'), 2000)
        },
        'publish',
      )
    }, 2500)
  }
  bots.changed()
  // Guarda's run is played for real: it stops at the yes for `npm publish`.
  setTimeout(() => void bots.send(guarda.id, 'Publica a versão 0.5.0 no npm').catch(() => undefined), 3000)
}

/**
 * Demo CRM: 12 customers, 8 deals spread over the pipeline, 20 payments (upcoming, overdue and
 * paid) and 2 recurrences, around `now`. Invented names; phones in the fictional range
 * (11) 90000-00NN. In memory only (demo: true): nothing reaches crm.json.
 */
export function startCrmDemo(store: CrmStore, now = Date.now()): void {
  const DAY = 86_400_000
  const today = localDate(now)
  const month = today.slice(0, 7)
  const player = { kind: 'player' as const }
  const people: [string, string | undefined, string[], Partial<Customer>?][] = [
    ['Maria Souza', 'Padaria Trigo Bom', ['manutenção', 'hospedagem'], { consent: { service: true, billing: true, offers: true, offersAt: now - 90 * DAY, offersSource: 'Pediu por WhatsApp' } }],
    ['João Pereira', 'Oficina Ponto Certo', ['site'], { nextStep: 'Mandar a proposta revisada', nextStepOn: addDays(today, 2) }],
    ['Ana Lima', 'Studio Ana Lima', ['site', 'redes sociais'], { consent: { service: true, billing: true, offers: true, offersAt: now - 30 * DAY, offersSource: 'Formulário do site' } }],
    ['Pedro Alves', 'Loja do Pedro', ['loja virtual'], { nextStep: 'Ligar para entender o catálogo', nextStepOn: today }],
    ['Lia Moreira', 'Clínica Bem Viver', ['manutenção']],
    ['Carlos Nogueira', 'Nogueira Advocacia', ['site']],
    ['Beatriz Rocha', undefined, ['indicação']],
    ['Rafael Costa', 'Café Grão Fino', ['cardápio']],
    ['Juliana Martins', 'Escola Pequeno Saber', ['portal'], { nextStep: 'Reunião com a diretoria', nextStepOn: addDays(today, 5) }],
    ['Thiago Ramos', 'Ramos Contabilidade', ['identidade visual']],
    ['Fernanda Dias', 'Ateliê Fernanda', ['loja virtual']],
    ['Gustavo Freitas', 'Academia Movimento', [], { consent: { service: true, billing: true, offers: false, optOutAt: now - 20 * DAY } }],
  ]
  const customers: Customer[] = people.map(([name, company, tags, extra], i) => ({
    id: `demo-c${i + 1}`,
    kind: 'person',
    name,
    ...(company ? { company } : {}),
    phones: [`5511900000${String(i + 1).padStart(3, '0')}`],
    tags,
    consent: { service: true, billing: true, offers: false },
    source: 'demo',
    notes: [],
    tickets: [],
    lastContactAt: now - ((i * 7) % 40) * DAY,
    createdAt: now - (120 - i * 5) * DAY,
    updatedAt: now - ((i * 7) % 40) * DAY,
    demo: true,
    ...extra,
  }))

  const columns = new Map<string, number>()
  const deal = (n: number, customer: number, title: string, valueCents: number, stageId: string, daysIn: number): Deal => {
    const stageAt = now - daysIn * DAY
    const createdAt = stageAt - 10 * DAY
    const order = columns.get(stageId) ?? 0
    columns.set(stageId, order + 1)
    return {
      id: `demo-d${n}`,
      customerId: `demo-c${customer}`,
      title,
      valueCents,
      pipelineId: 'padrao',
      stageId,
      stageAt,
      tickets: [],
      order,
      history: stageId === 'novo' ? [{ t: createdAt, to: 'novo', by: player }] : [{ t: createdAt, to: 'novo', by: player }, { t: stageAt, from: 'novo', to: stageId, by: player }],
      createdAt,
      updatedAt: stageAt,
      ...(stageId === 'fechado' || stageId === 'perdido' ? { closedAt: stageAt } : {}),
      demo: true,
    }
  }
  const deals = [
    deal(1, 3, 'Site institucional', 480_000, 'proposta', 4),
    deal(2, 2, 'Site com agenda online', 320_000, 'conversando', 2),
    deal(3, 4, 'Loja virtual', 950_000, 'novo', 1),
    deal(4, 5, 'Manutenção mensal', 48_000, 'fechado', 40),
    deal(5, 6, 'Site e blog', 600_000, 'proposta', 9),
    deal(6, 8, 'Cardápio digital', 150_000, 'novo', 0),
    deal(7, 9, 'Portal de matrículas', 1_200_000, 'conversando', 6),
    deal(8, 10, 'Identidade visual', 280_000, 'perdido', 15),
  ]

  const recurrence = (n: number, customer: number, reference: string, day: number, amountCents: number, monthsBack: number, dealId?: string): Recurrence => ({
    id: `demo-r${n}`,
    customerId: `demo-c${customer}`,
    ...(dealId ? { dealId } : {}),
    amountCents,
    day,
    reference,
    method: 'pix',
    start: addMonths(month, -monthsBack),
    active: true,
    lastMonth: month,
    createdAt: now - monthsBack * 31 * DAY,
    updatedAt: now - monthsBack * 31 * DAY,
    demo: true,
  })
  const recurrences = [recurrence(1, 5, 'Manutenção mensal', 20, 48_000, 3, 'demo-d4'), recurrence(2, 1, 'Hospedagem do site', 5, 8_990, 6)]

  type Draft = { customer: number; amountCents: number; due: string; reference: string; state?: PaymentState; paidDaysAfter?: number; method?: PaymentMethod; recurrence?: Recurrence; dealId?: string }
  const drafts: Draft[] = []
  // Each recurrence: last month paid, this month open.
  for (const r of recurrences) {
    const customer = Number(r.customerId.slice('demo-c'.length))
    const last = addMonths(month, -1)
    drafts.push({ customer, amountCents: r.amountCents, due: recurrenceDue(r, last), reference: recurrenceReference(r, last), state: 'paid', paidDaysAfter: -2, recurrence: r, dealId: r.dealId })
    drafts.push({ customer, amountCents: r.amountCents, due: recurrenceDue(r, month), reference: recurrenceReference(r, month), recurrence: r, dealId: r.dealId })
  }
  const rel = (customer: number, amountCents: number, days: number, reference: string, more: Partial<Draft> = {}) =>
    drafts.push({ customer, amountCents, due: addDays(today, days), reference, ...more })
  // Upcoming
  rel(2, 160_000, 2, 'Entrada do site (50%)', { dealId: 'demo-d2' })
  rel(3, 240_000, 5, 'Sinal do site institucional', { dealId: 'demo-d1' })
  rel(6, 200_000, 9, 'Site e blog · 1ª parcela', { dealId: 'demo-d5', method: 'boleto' })
  rel(4, 475_000, 14, 'Sinal da loja virtual', { dealId: 'demo-d3' })
  rel(9, 400_000, 21, 'Portal · 1ª parcela', { dealId: 'demo-d7', method: 'transfer' })
  rel(11, 90_000, 28, 'Fotos dos produtos')
  // Overdue
  rel(8, 75_000, -3, 'Cardápio digital · sinal')
  rel(7, 120_000, -8, 'Ajustes no site')
  rel(10, 140_000, -16, 'Identidade visual · 1ª parcela')
  rel(11, 45_000, -25, 'Banner de lançamento')
  // History
  rel(3, 50_000, -10, 'Logo do studio', { state: 'paid', paidDaysAfter: 1 })
  rel(5, 120_000, -20, 'Implantação da manutenção', { state: 'paid', paidDaysAfter: 2, dealId: 'demo-d4' })
  rel(6, 100_000, -35, 'Diagnóstico do site', { state: 'paid', paidDaysAfter: 5 })
  rel(1, 30_000, -45, 'Troca do domínio', { state: 'paid', paidDaysAfter: 1 })
  rel(9, 80_000, -60, 'Levantamento do portal', { state: 'paid', paidDaysAfter: 2 })
  rel(10, 140_000, -12, 'Identidade visual · 2ª parcela', { state: 'canceled' })

  const seq = new Map<string, number>()
  const payments: Payment[] = drafts
    .map((p) => ({ p, createdAt: Math.min(now, new Date(`${p.due}T12:00:00`).getTime() - 10 * DAY) }))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ p, createdAt }, i) => {
      const prefix = localDate(createdAt).slice(0, 7)
      const n = (seq.get(prefix) ?? 0) + 1
      seq.set(prefix, n)
      const state = p.state ?? 'open'
      return {
        id: `demo-p${i + 1}`,
        customerId: `demo-c${p.customer}`,
        ...(p.dealId ? { dealId: p.dealId } : {}),
        invoice: `${prefix}-${String(n).padStart(3, '0')}`,
        amountCents: p.amountCents,
        due: p.due,
        reference: p.reference,
        method: p.method ?? 'pix',
        state,
        ...(state === 'paid' ? { paidOn: addDays(p.due, p.paidDaysAfter ?? 0) } : {}),
        ...(p.recurrence ? { recurrenceId: p.recurrence.id } : {}),
        createdAt,
        updatedAt: createdAt,
        demo: true,
      }
    })
  store.addDemo({ customers, deals, payments, recurrences })
}

/**
 * CRM load (AGENT_OFFICE_DEMO=crm, `npm run bench -- --crm`): the demo above plus generated
 * customers up to `count`, a deal for every third and a payment for every second, so the
 * bench opens the screen and scrolls the table with the volume of the spec's metric.
 * In memory only, like the demo.
 */
export function startCrmLoad(store: CrmStore, count = 2000, now = Date.now()): void {
  startCrmDemo(store, now)
  const DAY = 86_400_000
  const today = localDate(now)
  const first = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabriela', 'Henrique', 'Isabela', 'Jorge', 'Karina', 'Lucas']
  const last = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Farias', 'Gomes', 'Henriques', 'Ibrahim', 'Jardim']
  const kinds = ['Padaria', 'Oficina', 'Studio', 'Clínica', 'Loja', 'Escola', 'Café', 'Ateliê']
  const stages = DEFAULT_PIPELINE.stages
  const customers: Customer[] = []
  const deals: Deal[] = []
  const payments: Payment[] = []
  for (let i = 13; i <= count; i++) {
    const name = `${first[i % first.length]} ${last[Math.floor(i / first.length) % last.length]} ${i}`
    const contact = now - (i % 90) * DAY
    customers.push({
      id: `demo-load-c${i}`,
      kind: 'person',
      name,
      company: `${kinds[i % kinds.length]} ${last[i % last.length]}`,
      // Fictional range (11) 9NNNN-NNNN, never a real customer's number.
      phones: [`55119${String(i).padStart(8, '0')}`],
      tags: i % 4 ? ['site'] : ['site', 'manutenção'],
      consent: { service: true, billing: true, offers: false },
      source: 'demo',
      notes: [],
      tickets: [],
      lastContactAt: contact,
      createdAt: contact - 30 * DAY,
      updatedAt: contact,
      demo: true,
    })
    if (i % 3 === 0) {
      const stage = stages[i % stages.length]
      const stageAt = now - (i % 20) * DAY
      deals.push({
        id: `demo-load-d${i}`,
        customerId: `demo-load-c${i}`,
        title: 'Site institucional',
        valueCents: 100_000 + (i % 50) * 10_000,
        pipelineId: DEFAULT_PIPELINE.id,
        stageId: stage.id,
        stageAt,
        tickets: [],
        order: i,
        history: [{ t: stageAt, to: stage.id, by: { kind: 'player' } }],
        createdAt: stageAt,
        updatedAt: stageAt,
        ...(stage.kind === 'open' ? {} : { closedAt: stageAt }),
        demo: true,
      })
    }
    if (i % 2 === 0) {
      const due = addDays(today, (i % 60) - 30)
      const paid = i % 8 === 0
      payments.push({
        id: `demo-load-p${i}`,
        customerId: `demo-load-c${i}`,
        invoice: `${due.slice(0, 7)}-${String(i).padStart(4, '0')}`,
        amountCents: 20_000 + (i % 40) * 5_000,
        due,
        reference: 'Manutenção',
        method: 'pix',
        state: paid ? 'paid' : 'open',
        ...(paid ? { paidOn: due < today ? due : today } : {}),
        createdAt: now - 40 * DAY,
        updatedAt: now - 40 * DAY,
        demo: true,
      })
    }
  }
  store.addDemo({ customers, deals, payments })
}

/** Stress mode: 50 agents spread over the ground floor and three project floors. */
const STRESS_AGENTS = 50
const STRESS_FLOORS = 3
const STRESS_ROOT = '/Users/demo/stress'

/**
 * AGENT_OFFICE_DEMO=stress, step 1 (before the window opens): three project floors,
 * in memory only. Refuses to run without AGENT_OFFICE_DATA_DIR, so the stress floors
 * never end up in the user's own office.json. Returns false when it refused.
 */
export function prepareStress(store: Store): boolean {
  if (!process.env.AGENT_OFFICE_DATA_DIR) {
    console.error('AGENT_OFFICE_DEMO=stress precisa de AGENT_OFFICE_DATA_DIR (ex.: AGENT_OFFICE_DATA_DIR=$(mktemp -d)) para não tocar nos seus dados.')
    return false
  }
  const colors = ['#2f8f83', '#6c5ce7', '#e17055']
  const s = store.settings
  // Mutated in place: no save is scheduled for it (and the data dir is a throwaway anyway).
  s.notifications = false
  s.projects = Array.from({ length: STRESS_FLOORS }, (_, i) => ({ id: `stress-${i + 1}`, name: `Carga ${i + 1}`, cwd: `${STRESS_ROOT}/andar-${i + 1}`, brandColor: colors[i], uniform: i === 1 }))
  return true
}

/**
 * AGENT_OFFICE_DEMO=stress, step 2: 50 terminal agents, a quarter per floor. They keep
 * switching between working and idle, and every few seconds one of them walks over to
 * deliver a result (riding the elevator down from its floor), which is acked a bit later.
 */
export function startStress(manager: AgentManager): void {
  const cwds = ['/Users/demo/terreo', ...Array.from({ length: STRESS_FLOORS }, (_, i) => `${STRESS_ROOT}/andar-${i + 1}`)]
  const ids: string[] = []
  for (let i = 0; i < STRESS_AGENTS; i++) {
    const a = manager.terminalAgent(`stress-${i}`, `${cwds[i % cwds.length]}/repo-${i}`)
    manager.terminalPrompt(a.id, 'Carga de teste')
    ids.push(a.id)
  }
  const tools = ['Read src/app.tsx', 'Edit src/routes/api.ts', 'Bash npm test', 'Grep useEffect', 'Write docs/README.md']
  for (const id of ids) {
    const tick = () => {
      const a = manager.list().find((x) => x.id === id)
      if (!a) return
      if (a.status === 'working' || a.status === 'idle') {
        const busy = Math.random() < 0.75
        manager.terminalUpdate(id, busy ? 'working' : 'idle', busy ? tools[Math.floor(Math.random() * tools.length)] : 'Esperando no terminal')
      }
      setTimeout(tick, 2000 + Math.random() * 4000)
    }
    setTimeout(tick, 500 + Math.random() * 3000)
  }
  // Someone walks to the boss office with a result every ~4 s; the player "reads" it 8 s later.
  const deliver = () => {
    const free = manager.list().filter((a) => ids.includes(a.id) && a.status === 'working')
    const a = free[Math.floor(Math.random() * free.length)]
    if (a) {
      manager.terminalResult(a.id, 'Resultado de carga (simulado).')
      setTimeout(() => {
        for (const r of manager.pendingResults()) if (r.agentId === a.id) manager.ackResult(r.id)
        manager.terminalUpdate(a.id, 'working', 'Voltando ao trabalho')
      }, 8000)
    }
    setTimeout(deliver, 4000)
  }
  setTimeout(deliver, 3000)

  // AO-46 load: the first agent keeps 20 subagents running at once, each sending a
  // message every ~300 ms. Updates reach the renderer grouped (one burst per 250 ms)
  // and each log stays under its cap; the counters go to stdout every 10 s.
  const boss = ids[0]
  let wave = 0
  const crowd = () => {
    for (let k = 0; k < 20; k++) simulateSubagent(manager, boss, { taskId: `stress-sub-${wave}-${k}`, description: `Carga ${wave + 1}.${k + 1}`, type: 'Explore', steps: 120, everyMs: 300, seed: k })
    wave++
    setTimeout(crowd, 120 * 300 + 4000)
  }
  setTimeout(crowd, 1500)
  setInterval(() => console.log(`[stress] subagentes: ${simulated.messages} mensagens simuladas, ${manager.subagentMemory(boss)} entradas na memória`), 10_000)
}

/** How many subagent messages the demo produced, for the load numbers. */
const simulated = { messages: 0 }

const SUB_TOOLS: [string, Record<string, unknown>][] = [
  ['Read', { file_path: 'src/main/agents.ts' }],
  ['Grep', { pattern: 'parent_tool_use_id', path: 'src' }],
  ['Edit', { file_path: 'src/main/git.ts', old_string: 'a', new_string: 'b' }],
  ['Bash', { command: 'npm test' }],
  ['Glob', { pattern: 'src/**/*.ts' }],
  ['Read', { file_path: 'src/renderer/src/ui/panel.ts' }],
]

/**
 * One simulated subagent (AO-46), as the SDK sends it: task_started with the id of the
 * Agent tool_use, then the subagent's own messages carrying that id as parent_tool_use_id,
 * task_progress now and then, and task_notification at the end.
 */
function simulateSubagent(
  manager: AgentManager,
  agentId: string,
  o: { taskId: string; description: string; type: string; steps: number; everyMs: number; seed: number; fail?: boolean },
): void {
  const toolUseId = `toolu_${o.taskId}`
  const base = { type: 'system', uuid: o.taskId, session_id: 'demo', task_id: o.taskId, tool_use_id: toolUseId } as const
  const started = Date.now()
  manager.demoTask(agentId, { ...base, subtype: 'task_started', description: o.description, subagent_type: o.type, task_type: 'local_agent', is_backgrounded: false, prompt: `${o.description} e diga o que achou (demonstração).` } as never)
  let i = 0
  let tokens = 0
  const step = () => {
    if (i >= o.steps) {
      const status = o.fail ? 'failed' : 'completed'
      const summary = o.fail ? 'Não consegui rodar os testes: faltou o node_modules (falha simulada).' : `Pronto: ${o.description.toLowerCase()} sem problemas (demonstração).`
      manager.demoTask(agentId, { ...base, subtype: 'task_notification', status, output_file: '', summary, usage: { total_tokens: tokens, tool_uses: o.steps, duration_ms: Date.now() - started } } as never)
      return
    }
    const [tool, input] = SUB_TOOLS[(i + o.seed) % SUB_TOOLS.length]
    const id = `${toolUseId}-${i}`
    const blocks: unknown[] = [{ type: 'tool_use', id, name: tool, input }]
    if (i % 3 === 0) blocks.unshift({ type: 'text', text: i ? `Seguindo: agora ${tool === 'Bash' ? 'os testes' : 'o próximo arquivo'}.` : 'Vou começar lendo o código.' })
    manager.demoSubagentMessage(agentId, toolUseId, 'assistant', blocks)
    simulated.messages++
    const n = i
    setTimeout(() => {
      manager.demoSubagentMessage(agentId, toolUseId, 'user', [{ type: 'tool_result', tool_use_id: id, content: `saída simulada de ${tool} (passo ${n + 1})`, is_error: o.fail && n === o.steps - 1 }])
      simulated.messages++
    }, o.everyMs / 2)
    tokens += 1200 + o.seed * 100
    if (i % 2) manager.demoTask(agentId, { ...base, subtype: 'task_progress', description: o.description, usage: { total_tokens: tokens, tool_uses: i + 1, duration_ms: Date.now() - started }, last_tool_name: tool } as never)
    i++
    setTimeout(step, o.everyMs * (0.7 + Math.random() * 0.6))
  }
  setTimeout(step, 300)
}

function describe(tool: string, input: Record<string, unknown>): string {
  const v = Object.values(input)[0]
  const s = String(v ?? '')
  return `${tool === 'Bash' ? 'Rodando' : tool === 'Read' ? 'Lendo' : tool === 'Edit' ? 'Editando' : tool === 'Write' ? 'Escrevendo' : 'Buscando'} ${s.split('/').pop()}`
}

/**
 * A simulated orchestrator walks the squad's pipeline: checkpoints come to you as
 * questions, consecutive subagent steps run together (up to 7, like the lentes) and
 * one member fails, so every animation of the squad floor shows up.
 */
function startSquadDemo(manager: AgentManager, squad: SquadDefinition): void {
  const id = manager.demoOrchestrator(squad).id
  const steps = squad.steps
  const total = steps.length
  const member = (mid?: string) => squad.members.find((m) => m.id === mid)
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const progress = (i: number, status = 'running'): SquadProgress => ({ current: i + 1, total, label: steps[i].name, status, type: steps[i].type, agent: steps[i].agent })
  let tasks = 0
  let failed = false

  const ask = (i: number) =>
    new Promise<void>((resolve) => {
      manager.demoStep(id, progress(i), 'working', `Checkpoint: ${steps[i].name}`)
      const question = `Passo ${i + 1} · ${steps[i].name}: posso seguir? (demonstração)`
      manager.requestDecision(
        id,
        {
          kind: 'question',
          toolName: 'AskUserQuestion',
          title: 'Tenho uma pergunta',
          detail: '',
          input: {},
          questions: [{ question, header: 'Checkpoint', multiSelect: false, options: [{ label: 'Seguir', description: 'Aprova e continua o ciclo' }, { label: 'Seguir com ajustes', description: 'Continua e anota o pedido' }] }],
          canAlwaysAllow: false,
          context: `${squad.name} · Passo ${i + 1}/${total} · ${steps[i].name}`,
        },
        () => resolve(),
      )
    })

  const work = (i: number, ms: number, fail: boolean) =>
    new Promise<void>((resolve) => {
      const task = `demo-squad-${tasks++}`
      const base = { type: 'system', uuid: task, session_id: 'demo' } as const
      manager.demoTask(id, { ...base, subtype: 'task_started', task_id: task, description: steps[i].name, subagent_type: steps[i].agent, task_type: 'local_agent' } as never)
      setTimeout(() => {
        manager.demoTask(id, { ...base, subtype: 'task_progress', task_id: task, description: steps[i].name, usage: { total_tokens: 8000 + Math.round(Math.random() * 20000), tool_uses: 3, duration_ms: ms / 2 }, last_tool_name: 'Read' } as never)
      }, ms / 2)
      setTimeout(() => {
        const status = fail ? 'failed' : 'completed'
        manager.demoTask(id, { ...base, subtype: 'task_notification', task_id: task, status, output_file: '', summary: fail ? 'Não achei o arquivo de entrada do passo (falha simulada).' : '', usage: { total_tokens: 24000, tool_uses: 6, duration_ms: ms } } as never)
        resolve()
      }, ms)
    })

  const cycle = async (): Promise<void> => {
    for (let i = 0; i < total; i++) {
      const s = steps[i]
      if (s.type === 'checkpoint') {
        await ask(i)
        continue
      }
      const m = member(s.agent)
      if (!m) continue
      if (m.execution === 'inline') {
        manager.demoStep(id, progress(i), 'working', `${m.icon} ${m.name}: ${s.name}`)
        await wait(8000)
        continue
      }
      // consecutive subagent steps run in parallel, as the runner does with the lentes
      const group = [i]
      while (group.length < 7 && steps[group.at(-1)! + 1]?.type === 'agent' && member(steps[group.at(-1)! + 1].agent)?.execution === 'subagent') group.push(group.at(-1)! + 1)
      manager.demoStep(id, progress(i), 'working', group.length > 1 ? `Chamando ${group.length} membros em paralelo` : `Chamando ${m.icon} ${m.name}`)
      const failAt = !failed && group.length >= 3 ? group[2] : -1
      if (failAt >= 0) failed = true
      await Promise.all(group.map((k) => work(k, 7000 + Math.random() * 9000, k === failAt)))
      i = group.at(-1)!
    }
    manager.demoStep(id, { current: total, total, label: steps[total - 1]?.name ?? '', status: 'completed' }, 'idle', 'Ciclo concluído')
    await wait(20000)
    failed = false
    return cycle()
  }
  void cycle()
}
