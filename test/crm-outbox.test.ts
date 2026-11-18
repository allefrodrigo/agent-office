process.env.TZ = 'America/Sao_Paulo'

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationItem, CrmConnection, Customer, Draft, GateDecision, OfficeEvent, OutboxItem } from '@shared/types'
import { formatCents } from '@shared/crm'
import { isoAt, type GateInput, type GateRun } from '@shared/crm-gate'
import { OPT_OUT_REPLY } from '@shared/crm-keywords'
import { AuditFile, textHash } from '../src/main/crm/audit'
import { EvolutionError, type ConversationLog, type EvolutionSender, type OutItem } from '../src/main/crm/contracts'
import { Outbox, presenceMs, SELF_TEST_TEXT, type GatePort } from '../src/main/crm/outbox'
import { CrmStore } from '../src/main/crm/store'

// CR-12: a fila de envio, com relógio falso, uma Evolution falsa e um portão falso (o de verdade é o
// CR-11). Nada aqui fala com uma Evolution de verdade.

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const T0 = new Date(2026, 10, 18, 10, 0).getTime()

// ---------- falsos ----------

class FakeLog implements ConversationLog {
  items = new Map<string, Map<string, ConversationItem>>()
  put(customerId: string, item: ConversationItem): void {
    if (!this.items.has(customerId)) this.items.set(customerId, new Map())
    this.items.get(customerId)?.set(item.id, structuredClone(item))
  }
  get(customerId: string, itemId: string): ConversationItem | undefined {
    return this.items.get(customerId)?.get(itemId)
  }
  sentSince(customerId: string, since: number): OutItem[] {
    const all = [...(this.items.get(customerId)?.values() ?? [])]
    return all.filter((i): i is OutItem => i.kind === 'out' && i.t >= since).sort((a, b) => a.t - b.t)
  }
  page() {
    return { items: [], more: false }
  }
  summaries() {
    return []
  }
  markRead() {
    return undefined
  }
  remove(customerId: string): void {
    this.items.delete(customerId)
  }
  draft(customerId: string, id: string): Draft | undefined {
    const it = this.get(customerId, id)
    return it?.kind === 'draft' ? it.draft : undefined
  }
  out(customerId: string, key: string): OutItem | undefined {
    const it = this.get(customerId, key)
    return it?.kind === 'out' ? it : undefined
  }
}

/** 'sent-then-timeout': the server sends it, then the answer is lost (the double-send case). */
type Step = Error | 'hang' | 'sent-then-timeout'

class FakeSender implements EvolutionSender {
  calls: { number: string; text: string; at: number }[] = []
  sent: { number: string; text: string; at: number }[] = []
  presences: { number: string; ms: number; at: number }[] = []
  plan: Step[] = []
  inFlight = 0
  maxInFlight = 0
  onSend?: () => void
  async sendText(number: string, text: string): Promise<{ waId: string }> {
    this.calls.push({ number, text, at: Date.now() })
    this.inFlight++
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      this.onSend?.()
      const step = this.plan.shift()
      if (step === 'hang') await new Promise(() => undefined)
      else if (step === 'sent-then-timeout') {
        this.sent.push({ number, text, at: Date.now() })
        throw new EvolutionError('A Evolution não respondeu a tempo.', 'timeout')
      } else if (step) throw step
      await new Promise((r) => setTimeout(r, 200))
      this.sent.push({ number, text, at: Date.now() })
      return { waId: `wa-${this.sent.length}` }
    } finally {
      this.inFlight--
    }
  }
  async sendDocument(): Promise<{ waId: string }> {
    throw new Error('sem documento nestes testes')
  }
  async presence(number: string, ms: number): Promise<void> {
    this.presences.push({ number, ms, at: Date.now() })
  }
  finds: { number: string; text: string; since: number }[] = []
  findError?: Error
  async findSent(number: string, text: string, since: number): Promise<{ waId: string } | null> {
    this.finds.push({ number, text, since })
    if (this.findError) throw this.findError
    const i = this.sent.findIndex((x) => x.number === number && x.text === text && x.at >= since)
    return i >= 0 ? { waId: `wa-${i + 1}` } : null
  }
}

const connection = {
  up: true,
  own: '5511999990000' as string | undefined,
  connected() {
    return this.up
  },
  ownNumber() {
    return this.own
  },
  current: (): CrmConnection => ({ state: 'open' }),
}

const SEND: GateDecision = { action: 'send', rule: 0, reason: 'Dentro da regra.' }
let decide: (i: GateInput) => GateDecision
let inputs: GateInput[]
const port: GatePort = {
  gate: (i) => {
    inputs.push(structuredClone(i))
    return decide(i)
  },
  fillPayment: (text, p) => text.replaceAll('{valor}', p ? formatCents(p.amountCents) : '{valor}'),
}

// ---------- montagem ----------

let dir: string
let store: CrmStore
let log: FakeLog
let sender: FakeSender
let audit: AuditFile
let events: OfficeEvent[]
let outbox: Outbox
let maria: Customer
let opened: { store: CrmStore; outbox: Outbox }[]
let n = 0

function open(random = 0.5): void {
  store = new CrmStore(dir, { now: () => Date.now() })
  audit = new AuditFile(dir)
  outbox = new Outbox({
    store,
    conversations: log,
    sender,
    connection,
    audit,
    broadcast: (e) => events.push(e),
    gate: port,
    random: () => random,
  })
  opened.push({ store, outbox })
}

const draft = (over: Partial<Draft> = {}): Draft => ({
  id: `d${++n}`,
  customerId: maria.id,
  category: 'service',
  text: `Oi, Maria! Já confiro o pedido ${n}.`,
  by: { kind: 'bot', botId: 'b1' },
  createdAt: Date.now(),
  status: 'pending',
  replyTo: 'in1',
  replyAt: Date.now() - MIN,
  ...over,
})
const run = (): GateRun => ({ kind: 'customer', customerId: maria.id })
const only = () => {
  expect(store.outbox).toHaveLength(1)
  return store.outbox[0]
}
const lines = () => audit.read().filter((e): e is Exclude<ReturnType<AuditFile['read']>[number], { forgotten: true }> => 'outcome' in e)
/** "Testar", with the fake clock moving while the fake Evolution answers. */
async function selfTest(): Promise<string> {
  const p = outbox.sendSelfTest()
  await vi.advanceTimersByTimeAsync(SEC)
  return p
}
const onDisk = () => JSON.parse(readFileSync(join(dir, 'crm.json'), 'utf8')) as { outbox: OutboxItem[] }

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-outbox-'))
  log = new FakeLog()
  sender = new FakeSender()
  events = []
  inputs = []
  opened = []
  decide = () => SEND
  connection.up = true
  connection.own = '5511999990000'
  open()
  maria = store.saveCustomer({ name: 'Maria', phones: ['5511900000001'] }).item
  maria = store.patchCustomer(maria.id, { phoneChecked: true }).item
})

afterEach(() => {
  for (const o of opened) {
    o.outbox.close()
    o.store.lock()
  }
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

// ---------- testes ----------

describe('presenceMs', () => {
  it('"digitando…" proporcional ao texto, de meio segundo a 6 s', () => {
    expect(presenceMs('ok')).toBe(500)
    expect(presenceMs('x'.repeat(60))).toBe(3000)
    expect(presenceMs('x'.repeat(4000))).toBe(6000)
  })
})

describe('Outbox.enqueue: a entrada do portão', () => {
  it('monta a entrada com o cliente, os pagamentos dele, o histórico da conversa e o teto da fila', () => {
    const ana = store.saveCustomer({ name: 'Ana', phones: ['5511900000002'] }).item
    store.savePayment({ customerId: maria.id, amountCents: 48_000, due: '2026-11-20', reference: 'Manutenção' })
    store.savePayment({ customerId: ana.id, amountCents: 99_000, due: '2026-11-21', reference: 'Outro' })
    const sentItem = (key: string, customerId: string, sentAt: number, replyTo?: string): OutboxItem => ({
      key,
      draftId: 'old',
      customerId,
      category: 'service',
      text: 'antes',
      by: { kind: 'bot', botId: 'b1' },
      ...(replyTo ? { replyTo } : {}),
      at: sentAt,
      attempts: 1,
      state: 'sent',
      sentAt,
      createdAt: sentAt,
    })
    store.putOutbox(sentItem('key-resposta-1', maria.id, T0 - 30 * MIN, 'in0'))
    store.putOutbox(sentItem('key-outro-cliente', ana.id, T0 - 10 * MIN))
    store.putOutbox(sentItem('key-hoje-cedo-1', ana.id, T0 - 3 * HOUR))
    store.putOutbox(sentItem('key-ontem-00001', ana.id, T0 - 20 * HOUR))
    const out = (id: string, t: number, over: Partial<OutItem>): OutItem => ({
      id,
      t,
      kind: 'out',
      text: 'Oi',
      by: { kind: 'phone' },
      status: 'sent',
      ...over,
    })
    log.put(
      maria.id,
      out('o1', T0 - 30 * MIN, { key: 'key-resposta-1', by: { kind: 'bot', botId: 'b1' }, category: 'service', text: 'Resposta' }),
    )
    log.put(maria.id, out('o2', T0 - 2 * HOUR, { text: 'Pelo celular' }))
    log.put(maria.id, out('o3', T0 - HOUR, { status: 'failed', text: 'Não saiu' }))
    log.put(maria.id, out('o4', T0 - 40 * 24 * HOUR, { text: 'Velha demais' }))

    outbox.enqueue(draft({ text: 'Oi, Maria!' }), { run: run(), approved: true })
    const i = inputs[0]
    expect(i.now).toBe('2026-11-18T10:00:00-03:00')
    expect(i.connected).toBe(true)
    expect(i.settings).toEqual(store.settings)
    expect(i.customer).toEqual({
      id: maria.id,
      name: 'Maria',
      phones: ['5511900000001'],
      phoneChecked: true,
      group: false,
      consent: { service: true, billing: true, offers: false, optOutAt: null },
      handedToPlayer: false,
      phoneReplyAt: null,
    })
    expect(i.payments).toEqual([
      { id: expect.any(String), customerId: maria.id, amountCents: 48_000, due: '2026-11-20', state: 'open', reference: 'Manutenção' },
    ])
    expect(i.history).toEqual([
      { at: '2026-11-18T08:00:00-03:00', category: 'service', initiated: true, text: 'Pelo celular' },
      { at: '2026-11-18T09:30:00-03:00', category: 'service', initiated: false, text: 'Resposta' },
    ])
    expect(i.global).toEqual({ lastHour: 2, today: 3, oldestInHour: '2026-11-18T09:30:00-03:00' })
    expect(i.run).toEqual(run())
    expect(i.draft).toMatchObject({
      by: 'bot',
      edited: false,
      category: 'service',
      text: 'Oi, Maria!',
      replyTo: { id: 'in1', at: '2026-11-18T09:59:00-03:00' },
      paymentId: null,
    })
    expect(i.approved).toBe(true)
    expect(i.override).toBe(false)
  })

  it('mensagem sua ou do sistema nunca leva rodada', () => {
    outbox.enqueue(draft({ by: { kind: 'player' } }), { run: run() })
    outbox.enqueue(draft({ by: { kind: 'system' } }), { run: run() })
    expect(inputs.map((i) => i.run)).toEqual([null, null])
  })

  it('opt-out e consentimento chegam como a ficha diz', () => {
    store.patchCustomer(maria.id, { optOut: true, handedToPlayer: true, phoneReplyAt: T0 - HOUR })
    outbox.enqueue(draft(), { run: run() })
    expect(inputs[0].customer).toMatchObject({
      consent: { offers: false, optOutAt: isoAt(T0) },
      handedToPlayer: true,
      phoneReplyAt: '2026-11-18T09:00:00-03:00',
    })
  })
})

describe('Outbox.enqueue: a decisão', () => {
  it('enviar: entra na fila agora, o rascunho fica na fila com a decisão, e a auditoria espera o envio', () => {
    const d = outbox.enqueue(draft(), { run: run() })
    expect(d).toMatchObject({ status: 'scheduled', decision: SEND })
    expect(log.draft(maria.id, d.id)).toEqual(d)
    expect(only()).toMatchObject({
      draftId: d.id,
      customerId: maria.id,
      state: 'queued',
      at: T0,
      attempts: 0,
      text: d.text,
      replyTo: 'in1',
      createdAt: T0,
    })
    expect(only().key).toMatch(/^[\w-]{8,80}$/)
    expect(lines()).toEqual([])
    expect(events).toContainEqual({ type: 'crm:item', customerId: maria.id, item: { id: d.id, t: d.createdAt, kind: 'draft', draft: d } })
  })

  it.each([
    ['hold', { action: 'hold', rule: 14, reason: 'Espera você: Atendimento está em Aprovação' }, 'held'],
    ['block', { action: 'block', rule: 6, reason: 'Link fora da lista' }, 'blocked'],
  ] as const)('%s: o rascunho guarda a decisão, a auditoria ganha a linha e nada entra na fila', (_name, decision, status) => {
    decide = () => decision
    const d = outbox.enqueue(draft({ text: 'Total {valor}' }), { run: run() })
    expect(d).toMatchObject({ status, decision })
    expect(store.outbox).toEqual([])
    expect(lines()).toEqual([
      {
        t: T0,
        customerId: maria.id,
        category: 'service',
        by: { kind: 'bot', botId: 'b1' },
        outcome: status,
        rule: decision.rule,
        hash: textHash('Total {valor}'),
      },
    ])
  })

  it('agendar: entra na fila para a hora do portão, com a linha na auditoria', () => {
    const at = T0 + 23 * HOUR
    decide = () => ({ action: 'schedule', rule: 10, reason: 'Fora do horário', at })
    const d = outbox.enqueue(draft(), { run: run() })
    expect(d.status).toBe('scheduled')
    expect(only()).toMatchObject({ at, state: 'queued' })
    expect(lines()).toMatchObject([{ outcome: 'scheduled', rule: 10, key: only().key }])
  })

  it('agendar sem hora (ou com hora que passou) tenta de novo daqui a um minuto, nunca num laço', () => {
    decide = () => ({ action: 'schedule', rule: 12, reason: 'Teto' })
    outbox.enqueue(draft(), { run: run() })
    expect(only().at).toBe(T0 + MIN)
  })

  it('a fila leva o texto preenchido; o portão recebe os marcadores', () => {
    const p = store.savePayment({ customerId: maria.id, amountCents: 48_000, due: '2026-11-20', reference: 'Manutenção' }).item
    outbox.enqueue(draft({ category: 'billing', text: 'Novembro: {valor}.', paymentId: p.id }), { run: run() })
    expect(inputs[0].draft.text).toBe('Novembro: {valor}.')
    expect(only().text).toBe('Novembro: R$ 480,00.')
  })

  it('aprovar e enviar mesmo assim ficam no item da fila para o portão do instante de enviar', () => {
    outbox.enqueue(draft(), { run: run(), approved: true, override: true })
    expect(only()).toMatchObject({ approved: true, override: true })
  })

  it('a mesma mensagem não entra duas vezes', () => {
    const d = draft()
    outbox.enqueue(d, { run: run() })
    expect(() => outbox.enqueue(d, { run: run() })).toThrow('já está na fila')
    expect(store.outbox).toHaveLength(1)
  })

  it('texto vazio ou longo demais depois de preenchido não entra', () => {
    expect(() => outbox.enqueue(draft({ text: '   ' }))).toThrow('vazia')
    expect(() => outbox.enqueue(draft({ text: 'x'.repeat(4001) }), { run: run() })).toThrow('4.000')
    expect(store.outbox).toEqual([])
  })

  it('com o portão de verdade e a configuração padrão, o rascunho do bot espera você: nada na fila', () => {
    const real = new Outbox({ store, conversations: log, sender, connection, audit })
    const d = draft()
    const saved = real.enqueue(d, { run: run() })
    expect(saved).toMatchObject({ status: 'held', decision: { action: 'hold', rule: 14 } })
    expect(store.outbox).toEqual([])
    expect(log.draft(maria.id, d.id)?.decision?.rule).toBe(14)
  })
})

describe('Outbox: ritmo (relógio falso)', () => {
  it('um envio por vez, com "digitando…" e o intervalo sorteado entre eles', async () => {
    outbox.start()
    const ds = [draft(), draft(), draft()]
    for (const d of ds) outbox.enqueue(d, { run: run() })
    await vi.advanceTimersByTimeAsync(2 * MIN)
    const typing = presenceMs(ds[0].text)
    const interval = (8 + 0.5 * 17) * SEC
    expect(sender.calls.map((c) => c.at - T0)).toEqual([typing, typing + 200 + interval + typing, 2 * (typing + 200 + interval) + typing])
    expect(sender.maxInFlight).toBe(1)
    expect(sender.presences.map((p) => p.ms)).toEqual(ds.map((d) => presenceMs(d.text)))
    expect(sender.presences[0]).toMatchObject({ number: '5511900000001', at: T0 })
    expect(store.outbox.map((x) => x.state)).toEqual(['sent', 'sent', 'sent'])
  })

  it.each([
    [0, 8],
    [0.999, 25],
  ])('com o sorteio em %s, o intervalo fica perto de %s s', async (random, seconds) => {
    store.flush()
    outbox.close()
    open(random)
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(2 * MIN)
    const [a, b] = sender.sent.map((s) => s.at)
    const gap = b - a - presenceMs(draft().text) - 200
    expect(Math.abs(gap - seconds * SEC)).toBeLessThan(SEC)
  })

  it('"Testar" e a fila não mandam ao mesmo tempo', async () => {
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(presenceMs(draft().text))
    const test = outbox.sendSelfTest()
    await vi.advanceTimersByTimeAsync(10 * SEC)
    await test
    expect(sender.calls).toHaveLength(2)
    expect(sender.maxInFlight).toBe(1)
  })
})

describe('Outbox: teto global (relógio falso)', () => {
  it('o portão roda de novo no instante de enviar: a hora cheia reagenda para a vaga', async () => {
    decide = (i) =>
      i.global.lastHour >= 2
        ? { action: 'schedule', rule: 12, reason: 'Teto por hora', at: Date.parse(i.global.oldestInHour as string) + HOUR }
        : SEND
    outbox.start()
    for (let k = 0; k < 3; k++) outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(sender.sent).toHaveLength(2)
    const third = store.outbox[2]
    expect(third).toMatchObject({ state: 'queued', at: sender.sent[0].at + HOUR })
    expect(log.draft(maria.id, third.draftId)).toMatchObject({ status: 'scheduled', decision: { rule: 12 } })
    expect(lines().filter((e) => e.outcome === 'scheduled')).toMatchObject([{ rule: 12, key: third.key }])
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(sender.sent).toHaveLength(3)
    expect(sender.sent[2].at).toBeGreaterThanOrEqual(sender.sent[0].at + HOUR)
    expect(inputs.at(-1)?.global).toMatchObject({ lastHour: 1, today: 2 })
  })
})

describe('Outbox: falha no meio não duplica', () => {
  const net = () => new EvolutionError('A Evolution não respondeu. Confira se o servidor está ligado.', 'network')

  it('erro de rede ou tempo esgotado: tenta até 3 vezes e manda uma vez só', async () => {
    sender.plan = [net(), new EvolutionError('Tempo esgotado.', 'timeout')]
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toHaveLength(3)
    expect(sender.sent).toHaveLength(1)
    expect(only()).toMatchObject({ state: 'sent', attempts: 3, waId: 'wa-1' })
    expect(only()).not.toHaveProperty('error')
    expect(lines().filter((e) => e.outcome === 'sent')).toHaveLength(1)
  })

  it('tempo esgotado depois de o servidor mandar: confere e não manda de novo', async () => {
    sender.plan = ['sent-then-timeout']
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toHaveLength(1)
    expect(sender.sent).toHaveLength(1)
    expect(sender.finds).toHaveLength(1)
    expect(only()).toMatchObject({ state: 'sent', attempts: 1, waId: 'wa-1' })
    expect(lines().filter((e) => e.outcome === 'sent')).toHaveLength(1)
  })

  it('tempo esgotado na última tentativa: confere antes de dar como falha', async () => {
    sender.plan = [net(), net(), 'sent-then-timeout']
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toHaveLength(3)
    expect(sender.sent).toHaveLength(1)
    expect(only()).toMatchObject({ state: 'sent', attempts: 3 })
  })

  it('sem como conferir se saiu: para e devolve o rascunho, nunca manda às cegas', async () => {
    sender.plan = [new EvolutionError('Tempo esgotado.', 'timeout')]
    sender.findError = new EvolutionError('A Evolution não respondeu.', 'network')
    outbox.start()
    const d = outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toHaveLength(1)
    expect(only()).toMatchObject({ state: 'failed', attempts: 1 })
    expect(log.draft(maria.id, d.id)?.decision?.reason).toContain('Confira no celular')
  })

  it('conexão recusada: nada chegou ao servidor, repete sem conferir', async () => {
    sender.plan = [new EvolutionError('Servidor desligado.', 'refused'), new EvolutionError('Servidor desligado.', 'refused')]
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toHaveLength(3)
    expect(sender.finds).toEqual([])
    expect(only()).toMatchObject({ state: 'sent', attempts: 3 })
  })

  it('erro 4xx não repete: falhou, o rascunho espera você com o motivo', async () => {
    sender.plan = [new EvolutionError('A Evolution recusou o número.', 'http4xx', 400)]
    outbox.start()
    const d = outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toHaveLength(1)
    expect(only()).toMatchObject({ state: 'failed', attempts: 1, error: 'A Evolution recusou o número.' })
    expect(log.out(maria.id, only().key)?.status).toBe('failed')
    expect(log.draft(maria.id, d.id)).toMatchObject({ status: 'held', decision: { action: 'hold', rule: 0 } })
    expect(log.draft(maria.id, d.id)?.decision?.reason).toContain('A Evolution recusou o número.')
    expect(lines().map((e) => e.outcome)).toEqual(['failed'])
  })

  it('três erros de rede: falhou, sem quarta tentativa', async () => {
    sender.plan = [net(), net(), net()]
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(sender.calls).toHaveLength(3)
    expect(only()).toMatchObject({ state: 'failed', attempts: 3 })
  })

  it('erro que não é da Evolution não repete e não vai para o motivo', async () => {
    sender.plan = [new Error('segredo interno 5511900000001')]
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toHaveLength(1)
    expect(only().error).toBe('O envio falhou por um erro inesperado.')
  })

  it('o item vai para o disco como "sending" antes de cada tentativa; o app que fecha no meio nunca manda de novo', async () => {
    let seen: OutboxItem | undefined
    sender.onSend = () => {
      seen = onDisk().outbox[0]
    }
    sender.plan = ['hang']
    outbox.start()
    const d = outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(seen).toMatchObject({ state: 'sending', attempts: 1 })
    // O app morre aqui. Abre de novo do disco.
    outbox.close()
    const before = sender.calls.length
    open()
    expect(only().state).toBe('failed')
    outbox.start()
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(sender.calls).toHaveLength(before)
    expect(only().error).toContain('fechou no meio do envio')
    expect(log.out(maria.id, only().key)?.status).toBe('failed')
    expect(log.draft(maria.id, d.id)).toMatchObject({ status: 'held', decision: { rule: 0 } })
  })

  it('o que saiu fica "sent" no disco: reabrir não manda de novo', async () => {
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(onDisk().outbox[0]).toMatchObject({ state: 'sent', waId: 'wa-1' })
    outbox.close()
    open()
    outbox.start()
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(sender.calls).toHaveLength(1)
  })

  it('o disco que falha ao gravar "sent" não vira uma segunda tentativa', async () => {
    const flush = vi.spyOn(store, 'flush')
    sender.onSend = () => {
      flush.mockImplementationOnce(() => {
        throw new Error('disco cheio')
      })
    }
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(sender.calls).toHaveLength(1)
    expect(only()).toMatchObject({ state: 'sent', attempts: 1 })
  })

  it('a mensagem que falhou pode entrar de novo, com outra chave', async () => {
    sender.plan = [new EvolutionError('Recusado.', 'http4xx', 400)]
    outbox.start()
    const d = outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    outbox.enqueue(d, { run: run(), approved: true })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(store.outbox.map((x) => x.state)).toEqual(['failed', 'sent'])
    expect(new Set(store.outbox.map((x) => x.key)).size).toBe(2)
  })
})

describe('Outbox: Parar tudo', () => {
  it('liga a chave, esvazia a fila e o cartão mostra o motivo (regra 1)', async () => {
    decide = () => ({ action: 'schedule', rule: 10, reason: 'Fora do horário', at: T0 + HOUR })
    outbox.start()
    const ds = [draft(), draft(), draft()].map((d) => outbox.enqueue(d, { run: run() }))
    outbox.stopAll()
    expect(store.settings.stopAll).toBe(true)
    expect(events).toContainEqual({ type: 'crm', delta: { settings: store.settings } })
    expect(store.outbox.every((x) => x.state === 'canceled' && x.error?.includes('Parar tudo'))).toBe(true)
    for (const d of ds) expect(log.draft(maria.id, d.id)).toMatchObject({ status: 'blocked', decision: { action: 'block', rule: 1 } })
    expect(lines().map((e) => e.outcome)).toEqual(['scheduled', 'scheduled', 'scheduled', 'canceled', 'canceled', 'canceled'])
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(sender.calls).toEqual([])
  })

  it('no meio das tentativas, a próxima não sai', async () => {
    sender.plan = [new EvolutionError('Sem rede.', 'network')]
    outbox.start()
    const d = outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(presenceMs(d.text))
    expect(sender.calls).toHaveLength(1)
    outbox.stopAll()
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toHaveLength(1)
    expect(only()).toMatchObject({ state: 'canceled' })
    expect(log.draft(maria.id, d.id)).toMatchObject({ status: 'blocked', decision: { rule: 1 } })
  })

  it('durante o "digitando…" também: nada sai', async () => {
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(100)
    outbox.stopAll()
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toEqual([])
    expect(lines().map((e) => e.outcome)).toEqual(['canceled'])
  })

  it('já ligado, não grava as configurações de novo', () => {
    store.setSettings({ ...store.settings, stopAll: true })
    outbox.stopAll()
    expect(events.filter((e) => e.type === 'crm' && e.delta.settings)).toEqual([])
  })
})

describe('Outbox: o portão de novo no instante de enviar', () => {
  it('pediu para sair depois de entrar na fila: barra', async () => {
    decide = (i) => (i.customer?.consent.optOutAt ? { action: 'block', rule: 4, reason: 'Pediu para sair das ofertas' } : SEND)
    outbox.start()
    const d = outbox.enqueue(draft({ category: 'offer' }), { run: run() })
    store.patchCustomer(maria.id, { optOut: true })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toEqual([])
    expect(only()).toMatchObject({ state: 'canceled', error: 'Pediu para sair das ofertas' })
    expect(log.draft(maria.id, d.id)).toMatchObject({ status: 'blocked', decision: { rule: 4 } })
    expect(lines()).toMatchObject([{ outcome: 'blocked', rule: 4 }])
  })

  it('a rodada de bot é a do cliente do item; aprovar e enviar mesmo assim seguem', async () => {
    outbox.start()
    outbox.enqueue(draft(), { run: { kind: 'suggestion', suggestionId: 's1', customerIds: [maria.id] }, approved: true })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(inputs[1]).toMatchObject({ run: { kind: 'customer', customerId: maria.id }, approved: true, override: false })
  })

  it('espera você no instante de enviar: sai da fila e o cartão pede o seu sim', async () => {
    let k = 0
    decide = () => (k++ === 0 ? SEND : { action: 'hold', rule: 9, reason: 'Mensagem velha' })
    outbox.start()
    const d = outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(only().state).toBe('canceled')
    expect(log.draft(maria.id, d.id)).toMatchObject({ status: 'held', decision: { rule: 9 } })
  })

  it('a conexão caiu durante o "digitando…": não sai', async () => {
    outbox.start()
    const d = outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(100)
    connection.up = false
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toEqual([])
    expect(log.draft(maria.id, d.id)).toMatchObject({ status: 'blocked', decision: { rule: 1 } })
    expect(log.out(maria.id, only().key)?.status).toBe('failed')
  })

  it('o portão que lança no instante de enviar: espera você, nada sai', async () => {
    let k = 0
    decide = () => {
      if (k++) throw new Error('quebrou')
      return SEND
    }
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toEqual([])
    expect(only()).toMatchObject({ state: 'canceled' })
    expect(lines()).toMatchObject([{ outcome: 'canceled', rule: 0 }])
  })

  it('o rascunho sumiu da conversa: cancela', async () => {
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    log.remove(maria.id)
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toEqual([])
    expect(only().error).toContain('sumiu')
  })

  it('o valor do pagamento mudou depois de entrar na fila: o texto velho não sai', async () => {
    const p = store.savePayment({ customerId: maria.id, amountCents: 48_000, due: '2026-11-20', reference: 'Manutenção' }).item
    outbox.start()
    decide = () => ({ action: 'schedule', rule: 10, reason: 'Fora do horário', at: T0 + HOUR })
    outbox.enqueue(draft({ category: 'billing', text: 'Novembro: {valor}.', paymentId: p.id }), { run: run() })
    decide = () => SEND
    store.savePayment({ id: p.id, customerId: maria.id, amountCents: 50_000, due: '2026-11-20', reference: 'Manutenção' })
    await vi.advanceTimersByTimeAsync(2 * HOUR)
    expect(sender.calls).toEqual([])
    expect(only().error).toContain('mudaram')
  })

  it('o cliente ficou sem telefone: cancela', async () => {
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    store.saveCustomer({ id: maria.id, name: 'Maria', phones: [] })
    await vi.advanceTimersByTimeAsync(MIN)
    expect(sender.calls).toEqual([])
    expect(only().error).toContain('sem telefone')
  })
})

describe('Outbox: a conversa', () => {
  it('grava o item out (queued → sent) com a chave e o waId, e o rascunho fica enviado', async () => {
    outbox.start()
    const d = outbox.enqueue(draft(), { run: run() })
    await vi.advanceTimersByTimeAsync(MIN)
    const it = only()
    const outs = events
      .filter((e): e is Extract<OfficeEvent, { type: 'crm:item' }> => e.type === 'crm:item' && e.item.kind === 'out')
      .map((e) => (e.item as OutItem).status)
    expect(outs).toEqual(['queued', 'sent'])
    expect(log.out(maria.id, it.key)).toEqual({
      id: it.key,
      t: it.sentAt,
      kind: 'out',
      text: d.text,
      by: { kind: 'bot', botId: 'b1' },
      category: 'service',
      status: 'sent',
      waId: 'wa-1',
      draftId: d.id,
      key: it.key,
    })
    expect(log.draft(maria.id, d.id)?.status).toBe('sent')
    expect(store.customer(maria.id)?.lastContactAt).toBe(it.sentAt)
    expect(lines()).toEqual([
      {
        t: it.sentAt,
        customerId: maria.id,
        category: 'service',
        by: { kind: 'bot', botId: 'b1' },
        outcome: 'sent',
        rule: 0,
        hash: textHash(d.text),
        key: it.key,
      },
    ])
  })

  it('o histórico seguinte marca a resposta como resposta e o que iniciamos como iniciado', async () => {
    outbox.start()
    outbox.enqueue(draft(), { run: run() })
    outbox.enqueue(draft({ replyTo: undefined, replyAt: undefined, category: 'billing' }), { run: run() })
    await vi.advanceTimersByTimeAsync(2 * MIN)
    outbox.enqueue(draft(), { run: run() })
    expect(inputs.at(-1)?.history.map((h) => [h.category, h.initiated])).toEqual([
      ['service', false],
      ['billing', true],
    ])
  })
})

describe('Outbox: app fechado e reaberto', () => {
  it('agendada para uma hora que passou há mais de 24 h volta para "esperando você"', async () => {
    decide = () => ({ action: 'schedule', rule: 10, reason: 'Fora do horário', at: T0 + HOUR })
    const d = outbox.enqueue(draft(), { run: run() })
    outbox.close()
    store.flush()
    vi.setSystemTime(T0 + HOUR + 25 * HOUR)
    open()
    outbox.start()
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(sender.calls).toEqual([])
    expect(only()).toMatchObject({ state: 'canceled' })
    expect(log.draft(maria.id, d.id)).toMatchObject({ status: 'held', decision: { action: 'hold', rule: 10 } })
    expect(lines().map((e) => [e.outcome, e.rule])).toEqual([
      ['scheduled', 10],
      ['held', 10],
    ])
  })

  it('agendada para daqui a pouco continua na fila e sai na hora', async () => {
    decide = () => ({ action: 'schedule', rule: 10, reason: 'Fora do horário', at: T0 + HOUR })
    outbox.enqueue(draft(), { run: run() })
    outbox.close()
    store.flush()
    vi.setSystemTime(T0 + 30 * MIN)
    open()
    decide = () => SEND
    outbox.start()
    await vi.advanceTimersByTimeAsync(29 * MIN)
    expect(sender.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(sender.sent).toHaveLength(1)
    expect(sender.calls[0].at).toBeGreaterThanOrEqual(T0 + HOUR)
  })
})

describe('Outbox.optOut', () => {
  it('marca a saída e põe na fila a confirmação fixa, como Atendimento do sistema, respondendo a mensagem', () => {
    const d = outbox.optOut(maria.id, { id: 'in9', at: T0 - MIN })
    expect(store.customer(maria.id)?.consent).toMatchObject({ offers: false, optOutAt: T0 })
    expect(d).toMatchObject({
      category: 'service',
      text: OPT_OUT_REPLY,
      by: { kind: 'system' },
      replyTo: 'in9',
      replyAt: T0 - MIN,
      status: 'scheduled',
    })
    expect(inputs[0]).toMatchObject({ run: null, draft: { by: 'system', category: 'service' } })
    expect(only().text).toBe(OPT_OUT_REPLY)
  })

  it('quem já saiu não recebe outra confirmação; cliente que não existe, nada', () => {
    outbox.optOut(maria.id)
    expect(outbox.optOut(maria.id)).toBeNull()
    expect(outbox.optOut('sumiu')).toBeNull()
    expect(store.outbox).toHaveLength(1)
  })

  it('o portão que falha não desfaz a saída', () => {
    decide = () => {
      throw new Error('quebrou')
    }
    expect(outbox.optOut(maria.id)).toBeNull()
    expect(store.customer(maria.id)?.consent.optOutAt).toBe(T0)
  })
})

describe('Outbox.sendSelfTest', () => {
  it('manda o texto fixo para o próprio número, conta no teto e responde em pt-BR', async () => {
    const msg = await selfTest()
    expect(msg).toBe('Mensagem de teste enviada para o seu número (55•••••••0000). Confira no celular.')
    expect(sender.calls).toMatchObject([{ number: '5511999990000', text: SELF_TEST_TEXT }])
    expect(lines()).toMatchObject([
      { customerId: '(teste)', outcome: 'sent', rule: 0, hash: textHash(SELF_TEST_TEXT), by: { kind: 'player' } },
    ])
    outbox.enqueue(draft(), { run: run() })
    expect(inputs[0].global).toMatchObject({ lastHour: 1, today: 1 })
  })

  it('Parar tudo, desconectado ou sem o número: diz o que fazer e não manda', async () => {
    connection.own = undefined
    await expect(outbox.sendSelfTest()).rejects.toThrow('número conectado')
    connection.up = false
    await expect(outbox.sendSelfTest()).rejects.toThrow('não está conectado')
    store.setSettings({ ...store.settings, stopAll: true })
    await expect(outbox.sendSelfTest()).rejects.toThrow('Parar tudo')
    expect(sender.calls).toEqual([])
  })

  it('teto global cheio: não manda', async () => {
    store.setSettings({ ...store.settings, globalCap: { hour: 1, day: 150 } })
    await selfTest()
    await expect(outbox.sendSelfTest()).rejects.toThrow('teto de envios')
    expect(sender.calls).toHaveLength(1)
  })

  it('erro da Evolution volta com a mensagem dela; outro erro, com uma genérica', async () => {
    sender.plan = [new EvolutionError('A Evolution recusou o token.', 'http4xx', 401), new Error('interno')]
    await expect(outbox.sendSelfTest()).rejects.toThrow('A Evolution recusou o token.')
    await expect(outbox.sendSelfTest()).rejects.toThrow('erro inesperado')
  })
})
