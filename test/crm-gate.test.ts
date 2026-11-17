process.env.TZ = 'America/Sao_Paulo'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRM_DEFAULTS, type Customer, type Draft, type Payment } from '@shared/types'
import { draftPayment, fillPayment, gate, gateInput, globalCounts, isoAt, type GateInput, type GateSources } from '@shared/crm-gate'

// CR-12: a entrada do portão (GateInput) e o que a monta a partir dos dados do app. As regras são do
// CR-11, depois do ADR 0017 aceito; até lá, gate() e fillPayment() falham fechado.

const HOUR = 3_600_000
const T0 = new Date(2026, 10, 18, 10, 0).getTime()
const corpus = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'crm-gate-cases.json'), 'utf8')) as { base: Record<string, unknown> }

const customer: Customer = {
  id: 'c1',
  kind: 'person',
  name: 'Maria',
  phones: ['5511900000001'],
  tags: [],
  consent: { service: true, billing: true, offers: true },
  source: 'manual',
  notes: [],
  tickets: [],
  phoneChecked: true,
  createdAt: 0,
  updatedAt: 0,
}

const payment = (over: Partial<Payment>): Payment => ({
  id: 'p1',
  customerId: 'c1',
  invoice: '2026-11-001',
  amountCents: 48_000,
  due: '2026-11-20',
  reference: 'Manutenção',
  method: 'pix',
  state: 'open',
  createdAt: 0,
  updatedAt: 0,
  ...over,
})

const draft: Draft = {
  id: 'd1',
  customerId: 'c1',
  category: 'service',
  text: 'Oi, Maria!',
  by: { kind: 'bot', botId: 'b1' },
  createdAt: T0,
  status: 'pending',
  replyTo: 'in1',
  replyAt: T0 - 2 * 60_000,
}

const sources = (over: Partial<GateSources> = {}): GateSources => ({
  now: T0,
  connected: true,
  settings: CRM_DEFAULTS,
  customer,
  payments: [payment({})],
  history: [],
  sent: [],
  run: { kind: 'customer', customerId: 'c1' },
  draft,
  approved: false,
  override: false,
  ...over,
})

/** The keys of an object and of its nested objects, as 'a.b' paths (lists and null are leaves). */
function shape(o: unknown, prefix = ''): string[] {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return []
  return Object.entries(o).flatMap(([k, v]) => [prefix + k, ...shape(v, `${prefix}${k}.`)])
}

describe('gate e fillPayment antes do CR-11', () => {
  it('falham fechado: nenhuma decisão sai de um portão que não existe', () => {
    expect(() => gate(gateInput(sources()))).toThrow('portão ainda não escrito')
    expect(() => fillPayment('{valor}', null, CRM_DEFAULTS)).toThrow('portão ainda não escrito')
  })
})

describe('gateInput', () => {
  it('tem a forma da base do corpus (ADR 0017, seção 2)', () => {
    const built = gateInput(sources())
    const settingsKeys = Object.keys(corpus.base.settings as object)
    const mine = shape(built).filter(
      (k) => !k.startsWith('settings.') || settingsKeys.some((s) => k === `settings.${s}` || k.startsWith(`settings.${s}.`)),
    )
    expect(mine.sort()).toEqual(shape(corpus.base).sort())
  })

  it('a base do corpus passa como GateInput', () => {
    const base: GateInput = corpus.base as unknown as GateInput
    expect(base.draft.by).toBe('bot')
    expect(base.customer?.consent.optOutAt).toBeNull()
  })

  it('leva o cliente da ficha com as datas em ISO e o resto em booleano', () => {
    const c: Customer = {
      ...customer,
      phoneChecked: undefined,
      handedToPlayer: true,
      phoneReplyAt: T0 - HOUR,
      consent: { ...customer.consent, offers: false, optOutAt: T0 - 2 * HOUR },
    }
    expect(gateInput(sources({ customer: c })).customer).toEqual({
      id: 'c1',
      name: 'Maria',
      phones: ['5511900000001'],
      phoneChecked: false,
      group: false,
      consent: { service: true, billing: true, offers: false, optOutAt: '2026-11-18T08:00:00-03:00' },
      handedToPlayer: true,
      phoneReplyAt: '2026-11-18T09:00:00-03:00',
    })
  })

  it('número que não é telefone conta como grupo; cliente que não existe vira null', () => {
    expect(gateInput(sources({ customer: { ...customer, phones: ['120363000000000000'] } })).customer?.group).toBe(true)
    expect(gateInput(sources({ customer: { ...customer, phones: [] } })).customer?.group).toBe(false)
    expect(gateInput(sources({ customer: undefined })).customer).toBeNull()
  })

  it('só os pagamentos do cliente, com os campos que o portão lê', () => {
    const input = gateInput(sources({ payments: [payment({}), payment({ id: 'p2', customerId: 'c2' })] }))
    expect(input.payments).toEqual([
      { id: 'p1', customerId: 'c1', amountCents: 48_000, due: '2026-11-20', state: 'open', reference: 'Manutenção' },
    ])
    expect(gateInput(sources({ customer: undefined, payments: [payment({ id: 'p2', customerId: 'c2' })] })).payments).toEqual([])
  })

  it('o rascunho: autor pelo tipo, resposta com a hora, campos que faltam em null', () => {
    expect(gateInput(sources()).draft).toEqual({
      id: 'd1',
      customerId: 'c1',
      by: 'bot',
      edited: false,
      category: 'service',
      text: 'Oi, Maria!',
      replyTo: { id: 'in1', at: '2026-11-18T09:58:00-03:00' },
      paymentId: null,
      discountPct: null,
      validUntil: null,
    })
    const offer: Draft = {
      ...draft,
      by: { kind: 'player' },
      edited: true,
      category: 'offer',
      replyTo: undefined,
      paymentId: 'p1',
      discountPct: 10,
      validUntil: '2026-11-30',
    }
    expect(gateInput(sources({ draft: offer })).draft).toMatchObject({
      by: 'player',
      edited: true,
      replyTo: null,
      paymentId: 'p1',
      discountPct: 10,
      validUntil: '2026-11-30',
    })
  })

  it('resposta sem a hora da mensagem respondida conta como resposta a uma mensagem muito velha', () => {
    expect(gateInput(sources({ draft: { ...draft, replyAt: undefined } })).draft.replyTo).toEqual({ id: 'in1', at: isoAt(0) })
  })

  it('o histórico em ISO; sem categoria, conta como atendimento', () => {
    const history = [
      { t: T0 - HOUR, initiated: true, text: 'Oi' },
      { t: T0 - 2 * HOUR, category: 'offer' as const, initiated: false, text: 'Promo' },
    ]
    expect(gateInput(sources({ history })).history).toEqual([
      { at: '2026-11-18T09:00:00-03:00', category: 'service', initiated: true, text: 'Oi' },
      { at: '2026-11-18T08:00:00-03:00', category: 'offer', initiated: false, text: 'Promo' },
    ])
  })

  it('agora, conexão, rodada, aprovar e enviar mesmo assim passam como vieram', () => {
    const input = gateInput(sources({ connected: false, run: null, approved: true, override: true }))
    expect(input).toMatchObject({ now: '2026-11-18T10:00:00-03:00', connected: false, run: null, approved: true, override: true })
  })
})

describe('isoAt', () => {
  it('hora local com o deslocamento; milissegundos só quando existem', () => {
    expect(isoAt(T0)).toBe('2026-11-18T10:00:00-03:00')
    expect(isoAt(T0 + 5)).toBe('2026-11-18T10:00:00.005-03:00')
    expect(Date.parse(isoAt(T0 + 5))).toBe(T0 + 5)
  })

  it('fuso a leste de Greenwich leva o sinal de mais', () => {
    const before = process.env.TZ
    process.env.TZ = 'Asia/Kolkata'
    try {
      expect(isoAt(Date.UTC(2026, 10, 18, 4, 30))).toBe('2026-11-18T10:00:00+05:30')
    } finally {
      process.env.TZ = before
    }
  })
})

describe('globalCounts', () => {
  it('última hora, dia do calendário local e o envio mais antigo da hora', () => {
    const sent = [T0 - 10 * 60_000, T0 - 50 * 60_000, T0 - HOUR, T0 - 9 * HOUR, T0 - 11 * HOUR]
    expect(globalCounts(sent, T0)).toEqual({ lastHour: 2, today: 4, oldestInHour: '2026-11-18T09:10:00-03:00' })
  })

  it('sem envios: zero e sem hora', () => {
    expect(globalCounts([], T0)).toEqual({ lastHour: 0, today: 0, oldestInHour: null })
  })

  it('envio com hora no futuro (relógio voltou) conta como agora', () => {
    expect(globalCounts([T0 + HOUR], T0)).toEqual({ lastHour: 1, today: 1, oldestInHour: '2026-11-18T10:00:00-03:00' })
  })
})

describe('draftPayment', () => {
  const ps = [payment({}), payment({ id: 'p2', state: 'paid' }), payment({ id: 'p3', customerId: 'c2' })]

  it('pelo id, só se for do mesmo cliente', () => {
    expect(draftPayment('p2', 'c1', ps)?.id).toBe('p2')
    expect(draftPayment('p3', 'c1', ps)).toBeNull()
    expect(draftPayment('sumiu', 'c1', ps)).toBeNull()
  })

  it('sem id, só quando há um único pagamento aberto do cliente', () => {
    expect(draftPayment(null, 'c1', ps)?.id).toBe('p1')
    expect(draftPayment(undefined, 'c1', [...ps, payment({ id: 'p4' })])).toBeNull()
    expect(draftPayment(null, 'c9', ps)).toBeNull()
  })
})
