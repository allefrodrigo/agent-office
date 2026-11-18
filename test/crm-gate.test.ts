process.env.TZ = 'America/Sao_Paulo'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRM_DEFAULTS, type Customer, type DayHours, type Draft, type GateDecision, type Payment } from '@shared/types'
import { OPT_OUT_REPLY } from '@shared/crm-keywords'
import {
  countRecent,
  draftPayment,
  fillPayment,
  findPaymentData,
  gate,
  gateInput,
  globalCounts,
  inWindow,
  isoAt,
  nextWindow,
  type GateInput,
  type GateSent,
  type GateSettings,
  type GateSources,
} from '@shared/crm-gate'

// CR-11 e CR-12: as 14 regras do portão (ADR 0017), uma a uma, os auxiliares de janela e contagem, o
// preenchimento dos marcadores, as propriedades que valem para qualquer entrada, e a entrada
// (GateInput) que a fila monta a partir dos dados do app. O corpus roda em crm-gate-cases.test.ts;
// os detectores de texto, em crm-gate-detectors.test.ts.

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
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

// ---------- entradas a partir da base do corpus ----------

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> | null } : T
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** base + patch, como no corpus: objetos se mesclam; listas, textos, números e null substituem. */
function merge<T>(a: T, b: unknown): T {
  if (!isObj(a) || !isObj(b)) return (b === undefined ? a : b) as T
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v
  return out as T
}

const base = corpus.base as unknown as GateInput
const make = (patch: DeepPartial<GateInput> = {}): GateInput => merge(structuredClone(base), patch)
const judge = (patch: DeepPartial<GateInput> = {}): GateDecision => gate(make(patch))
const at = (iso: string) => Date.parse(iso)

const BILL = 'Oi, Maria! Passando para lembrar: {referente}, {valor}, vence em {vencimento}. {pagamento}'
const OFFER = 'Oi, Maria! Estamos com a revisão de fim de ano para sites. Quer que eu mande os detalhes?'
const mine = { run: null, draft: { by: 'player' } } as const
const billing = (over: DeepPartial<GateInput['draft']> = {}) =>
  ({ category: 'billing', text: BILL, replyTo: null, paymentId: 'p1', ...over }) as const
const sent = (iso: string, text = 'Mensagem anterior.', over: Partial<GateSent> = {}): GateSent => ({
  at: iso,
  category: 'service',
  initiated: true,
  text,
  ...over,
})

describe('gate · regra 1: Parar tudo e conexão', () => {
  it('Parar tudo barra qualquer autor, sem "enviar mesmo assim"', () => {
    const d = judge({ settings: { stopAll: true }, ...mine, override: true, approved: true })
    expect(d).toEqual({ action: 'block', rule: 1, reason: expect.stringContaining('Parar tudo') })
  })

  it('desconectado manda conectar', () => {
    expect(judge({ connected: false }).reason).toContain('conecte')
  })
})

describe('gate · regra 2: cliente e número', () => {
  it('o cliente da entrada precisa ser o do rascunho', () => {
    expect(judge({ customer: { id: 'c9' } })).toMatchObject({ action: 'block', rule: 2 })
  })

  it('telefone vazio, grupo e número não conferido mandam conferir a ficha', () => {
    for (const customer of [{ phones: [''] }, { group: true }, { phoneChecked: false }]) {
      const d = judge({ customer })
      expect(d).toMatchObject({ action: 'block', rule: 2 })
      expect(d.reason).toContain('confira o número na ficha')
      expect(d.overridable).toBeUndefined()
    }
  })
})

describe('gate · regra 3: escopo da rodada', () => {
  it('o texto do sistema não tem rodada e passa', () => {
    expect(judge({ run: null, draft: { by: 'system' } }).action).toBe('send')
  })

  it('cada motivo diz o que a rodada pode', () => {
    expect(judge({ run: null }).reason).toContain('sem rodada')
    expect(judge({ run: { kind: 'schedule' } }).reason).toContain('Sugestões')
    expect(judge({ run: { kind: 'customer', customerId: 'c2' } }).reason).toContain('Fora da rodada')
    expect(judge({ run: { kind: 'suggestion', suggestionId: 's1', customerIds: [] }, approved: true }).reason).toContain('sugestão')
  })

  it('um autor desconhecido conta como bot: sem rodada, barra', () => {
    const input = make({ run: null })
    ;(input.draft as { by: string }).by = 'outro'
    expect(gate(input)).toMatchObject({ action: 'block', rule: 3 })
  })
})

describe('gate · regra 4: a categoria aceita', () => {
  it('pedido de saída vale mesmo com ofertas marcadas, e nada passa por cima', () => {
    const d = judge({
      customer: { consent: { optOutAt: '2026-11-01T10:00:00-03:00' } },
      ...mine,
      override: true,
      approved: true,
      draft: { by: 'player', category: 'offer', text: OFFER, replyTo: null },
    })
    expect(d).toEqual({ action: 'block', rule: 4, reason: expect.stringContaining('pediu para sair') })
  })

  it('atendimento e cobrança desmarcados: barra com "enviar mesmo assim", que libera', () => {
    const svc = judge({ customer: { consent: { service: false } } })
    expect(svc).toMatchObject({ action: 'block', rule: 4, overridable: true })
    expect(svc.reason).toContain('atendimento')
    expect(judge({ customer: { consent: { service: false } }, override: true }).action).toBe('send')
    const bill = judge({
      customer: { consent: { billing: false } },
      ...mine,
      draft: { by: 'player', category: 'billing', text: 'Oi, Maria! Lembrete do pagamento.', replyTo: null },
    })
    expect(bill.reason).toContain('cobrança')
  })

  it('uma categoria que não se conhece vale como oferta', () => {
    const input = make({ customer: { consent: { offers: false } } })
    ;(input.draft as { category: string }).category = 'outra'
    expect(gate(input)).toMatchObject({ action: 'block', rule: 4 })
  })
})

describe('gate · regra 5: cobrança com os dados do sistema', () => {
  it('sua cobrança com paymentId precisa dele aberto; sem paymentId, de algum aberto', () => {
    const paid = [{ id: 'p1', customerId: 'c1', amountCents: 48000, due: '2026-11-20', state: 'paid', reference: 'X' }] as const
    const yours = {
      ...mine,
      draft: { by: 'player', category: 'billing', text: 'Oi, Maria! Tudo certo com o pagamento?', replyTo: null },
    } as const
    expect(judge({ ...yours, payments: [...paid], draft: { ...yours.draft, paymentId: 'p1' } })).toMatchObject({
      action: 'block',
      rule: 5,
      overridable: true,
    })
    expect(judge({ ...yours, draft: { ...yours.draft, paymentId: 'p1' } }).action).toBe('send')
    expect(judge(yours).action).toBe('send')
  })

  it('a cobrança do bot diz o que falta, o que não bate e qual pagamento escolher', () => {
    expect(judge({ draft: billing({ text: 'Oi! {valor}. {pagamento}' }) }).reason).toContain('falta {vencimento}')
    expect(judge({ draft: billing({ text: 'Oi! {referente}' }) }).reason).toContain('falta {valor} e {vencimento} e {pagamento}')
    expect(judge({ draft: billing({ text: `${BILL} São 520 reais.` }) }).reason).toContain('"520" não bate')
    expect(judge({ draft: billing({ paymentId: 'p9' }) }).reason).toContain('não está aberto')
    expect(judge({ payments: [], draft: billing({ paymentId: null }) }).reason).toContain('sem pagamento aberto')
    const two = [
      { id: 'p1', customerId: 'c1', amountCents: 48000, due: '2026-11-20', state: 'open', reference: 'A' },
      { id: 'p2', customerId: 'c1', amountCents: 9000, due: '2026-11-25', state: 'open', reference: 'B' },
    ] as const
    expect(judge({ payments: [...two], draft: billing({ paymentId: null }) }).reason).toContain('mais de um pagamento aberto')
    expect(judge({ payments: [...two], draft: billing({ paymentId: 'p2' }) }).action).toBe('send')
  })

  it('o sistema cobra como o bot: sem pagamento aberto, barra sem "enviar mesmo assim"', () => {
    const d = judge({ run: null, payments: [], override: true, draft: { by: 'system', ...billing() } })
    expect(d).toMatchObject({ action: 'block', rule: 5 })
    expect(d.overridable).toBeUndefined()
  })

  it('cobrança disfarçada numa oferta do bot barra e manda usar a Cobrança', () => {
    const d = judge({ draft: { category: 'offer', replyTo: null, text: 'Oi, Maria! Pague o PIX de R$ 480,00 e ganhe a revisão.' } })
    expect(d).toMatchObject({ action: 'block', rule: 5 })
    expect(d.reason).toContain('categoria Cobrança')
  })

  it('marcador sem dado ou escrito errado nunca sai, para nenhum autor', () => {
    expect(judge({ settings: { payment: { pixKey: '  ' } }, draft: billing() }).reason).toContain('Dados de pagamento')
    expect(judge({ ...mine, payments: [], draft: { by: 'player', text: 'O valor é {valor}.' } }).reason).toContain(
      'Sem pagamento para preencher {valor}',
    )
    const typo = judge({ ...mine, override: true, draft: { by: 'player', text: 'Segue: {PAGAMENTO}' } })
    expect(typo).toMatchObject({ action: 'block', rule: 5 })
    expect(typo.reason).toContain('escrito errado')
    expect(typo.overridable).toBeUndefined()
  })

  it('você pode mandar {pagamento} num atendimento: os dados são do sistema', () => {
    expect(judge({ ...mine, draft: { by: 'player', text: 'Segue para o PIX: {pagamento}' } }).action).toBe('send')
  })
})

describe('gate · regra 6: links e dados de pagamento', () => {
  it('link fora da lista: o motivo mostra o domínio; no texto do bot, sem "enviar mesmo assim"', () => {
    const d = judge({ approved: true, override: true, draft: { text: 'Veja https://Golpe.io/x' } })
    expect(d).toMatchObject({ action: 'block', rule: 6 })
    expect(d.reason).toContain('(golpe.io)')
    expect(d.overridable).toBeUndefined()
  })

  it('a lista aceita o domínio escrito com www e os subdomínios', () => {
    const settings = { allowedLinks: ['www.estudioexemplo.com.br'] }
    expect(judge({ settings, draft: { text: 'Veja estudioexemplo.com.br e loja.estudioexemplo.com.br' } }).action).toBe('send')
    expect(judge({ settings: { allowedLinks: [''] }, draft: { text: 'Veja estudioexemplo.com.br' } }).rule).toBe(6)
  })

  it('link sem host (esquema estranho) nunca está na lista', () => {
    expect(judge({ draft: { text: 'Abra file:///etc/passwd' } }).reason).toContain('(file:///etc/passwd)')
  })

  it('dado de pagamento no texto do sistema também barra, com o tipo no motivo', () => {
    const d = judge({ run: null, draft: { by: 'system', text: 'Chave aleatória 123e4567-e89b-42d3-a456-426614174000' } })
    expect(d).toMatchObject({ action: 'block', rule: 6 })
    expect(d.reason).toContain('uma chave aleatória')
  })

  it('o que entra por {pagamento} não é lido: a chave do sistema passa', () => {
    expect(judge({ draft: billing() }).action).toBe('send')
  })

  it('a confirmação de saída das ofertas passa pelas regras de conteúdo', () => {
    expect(judge({ run: null, draft: { by: 'system', text: OPT_OUT_REPLY } }).action).toBe('send')
  })
})

describe('gate · regra 7: desconto do bot', () => {
  const offer = (text: string, over: DeepPartial<GateInput['draft']> = {}) =>
    ({ draft: { category: 'offer', replyTo: null, text, ...over } }) as const

  it('campo declarado sem desconto no texto espera você', () => {
    expect(judge(offer(OFFER, { discountPct: 10, validUntil: '2026-11-30' })).reason).toContain('não diz o desconto de 10%')
  })

  it('validade escrita errado conta como sem validade; validade hoje ainda vale', () => {
    const text = 'Oi, Maria! A revisão sai com 10% de desconto. Quer?'
    expect(judge(offer(text, { discountPct: 10, validUntil: '30/11/2026' })).reason).toContain('sem validade')
    expect(judge(offer(text, { discountPct: 10, validUntil: '2026-11-18' })).action).toBe('send')
    expect(judge(offer(text, { discountPct: 10, validUntil: '2026-11-17' })).reason).toContain('17/11/2026')
  })

  it('desconto 0 declarado é o mesmo que nenhum', () => {
    expect(judge(offer(OFFER, { discountPct: 0 })).action).toBe('send')
  })

  it('teto, texto e campo: cada motivo diz o número', () => {
    expect(judge(offer('Sai com 15% de desconto.', { discountPct: 15, validUntil: '2026-11-30' })).reason).toBe(
      'Espera você: desconto de 15% acima do teto de 10%.',
    )
    expect(judge(offer('Sai com 8% de desconto.', { discountPct: 10, validUntil: '2026-11-30' })).reason).toContain('o texto diz 8%')
    expect(judge(offer('Sai com 7,5% de desconto.', { discountPct: 7.5, validUntil: '2026-11-30' })).action).toBe('send')
  })

  it('vale para o bot em qualquer categoria, mas só desconto conta fora da oferta', () => {
    expect(judge({ draft: { text: 'Posso fazer pela metade do preço.' } })).toMatchObject({ action: 'hold', rule: 7 })
    expect(judge({ draft: { text: 'O site já está 80% pronto.' } }).action).toBe('send')
  })

  it('você e o sistema não passam pela regra 7; aprovar resolve', () => {
    const big = offer('Sai com 50% de desconto.', { discountPct: 50 })
    expect(judge({ ...big, run: null, draft: { ...big.draft, by: 'player' } }).action).toBe('send')
    expect(judge({ ...big, run: null, draft: { ...big.draft, by: 'system' } }).rule).not.toBe(7)
    expect(judge({ ...big, approved: true }).action).toBe('send')
  })
})

describe('gate · regra 8: texto repetido em 24 h', () => {
  const text = 'Oi, Maria! Recebi sua mensagem e já confiro o seu pedido.'

  it('compara com o texto já preenchido', () => {
    const filled = fillPayment(BILL, base.payments[0], base.settings)
    expect(filled).toContain('R$ 480,00')
    expect(judge({ history: [sent('2026-11-18T08:00:00-03:00', filled, { initiated: false })], draft: billing() })).toMatchObject({
      action: 'block',
      rule: 8,
      overridable: true,
    })
  })

  it('24 h em ponto já não conta; hora no futuro conta como agora', () => {
    expect(judge({ history: [sent('2026-11-17T10:00:00-03:00', text)] }).action).toBe('send')
    expect(judge({ history: [sent('2026-11-19T10:00:00-03:00', text)] }).rule).toBe(8)
  })
})

describe('gate · regra 9: conversa com você', () => {
  it('resposta pelo celular sem hora legível conta como agora', () => {
    expect(judge({ customer: { phoneReplyAt: 'ontem' } })).toMatchObject({ action: 'hold', rule: 9 })
  })

  it('mensagem respondida com 2 h em ponto espera; com 1 h 59 min, não', () => {
    expect(judge({ draft: { replyTo: { id: 'in1', at: '2026-11-18T08:00:00-03:00' } } }).rule).toBe(9)
    expect(judge({ draft: { replyTo: { id: 'in1', at: '2026-11-18T08:01:00-03:00' } } }).action).toBe('send')
    expect(judge({ draft: { replyTo: { id: 'in1', at: 'sem hora' } } }).rule).toBe(9)
  })

  it('aprovar resolve todos os motivos', () => {
    const both = {
      customer: { handedToPlayer: true, phoneReplyAt: '2026-11-18T09:00:00-03:00' },
      draft: { replyTo: { id: 'in1', at: '2026-11-18T06:00:00-03:00' } },
    }
    expect(judge(both).rule).toBe(9)
    expect(judge({ ...both, approved: true }).action).toBe('send')
  })
})

describe('gate · regra 10: janela de envio', () => {
  it('o motivo diz quando sai, no relógio local', () => {
    const d = judge({ now: '2026-11-18T20:00:00-03:00', draft: { replyTo: null } })
    expect(d.reason).toBe('Fora do horário de envio: sai qui 19/11 às 09:00.')
    expect(judge({ now: '2026-11-18T07:30:00-03:00', draft: { replyTo: null } }).reason).toBe(
      'Fora do horário de envio: sai hoje às 09:00.',
    )
  })

  it('resposta a mensagem de 15 min em ponto já não passa fora do horário', () => {
    const d = judge({ now: '2026-11-18T22:00:00-03:00', draft: { replyTo: { id: 'in1', at: '2026-11-18T21:45:00-03:00' } } })
    expect(d).toMatchObject({ action: 'schedule', rule: 10 })
  })

  it('nenhum dia com horário: espera você em vez de agendar para sempre; "enviar mesmo assim" libera', () => {
    const settings = { hours: [null, null, null, null, null, null, null] }
    const d = judge({ settings, draft: { replyTo: null } })
    expect(d).toEqual({ action: 'hold', rule: 10, reason: expect.stringContaining('nenhum dia'), overridable: true })
    expect(judge({ settings, override: true, draft: { replyTo: null } }).action).toBe('send')
  })
})

describe('gate · regra 11: limites por cliente', () => {
  it('o motivo conta a mensagem que seria enviada', () => {
    const offer = { category: 'offer', text: OFFER, replyTo: null } as const
    expect(judge({ history: [sent('2026-11-01T10:00:00-03:00', 'Oferta.', { category: 'offer' })], draft: offer }).reason).toBe(
      'Espera você: 2ª oferta em 30 dias.',
    )
    expect(judge({ history: [sent('2026-11-18T09:00:00-03:00')], draft: { replyTo: null } }).reason).toContain(
      '2ª mensagem nossa hoje (limite 1 por dia)',
    )
    const three = ['2026-11-12T11:00:00-03:00', '2026-11-14T11:00:00-03:00', '2026-11-16T11:00:00-03:00'].map((t) => sent(t))
    expect(judge({ history: three, draft: { replyTo: null } }).reason).toContain('4ª mensagem em 7 dias (limite 3)')
  })

  it('oferta respondida pelo cliente não conta para a oferta nova', () => {
    const history = [sent('2026-11-01T10:00:00-03:00', 'Oferta.', { category: 'offer', initiated: false })]
    expect(judge({ history, draft: { category: 'offer', text: OFFER, replyTo: null } }).action).toBe('send')
  })

  it('o período de ofertas segue a configuração', () => {
    const history = [sent('2026-11-01T10:00:00-03:00', 'Oferta.', { category: 'offer' })]
    expect(judge({ settings: { offerEveryDays: 15 }, history, draft: { category: 'offer', text: OFFER, replyTo: null } }).action).toBe(
      'send',
    )
  })
})

describe('gate · regra 12: teto do escritório', () => {
  it('dia cheio decide antes da hora cheia', () => {
    const d = judge({ global: { lastHour: 30, today: 150, oldestInHour: '2026-11-18T09:20:00-03:00' } })
    expect(d).toMatchObject({ action: 'schedule', rule: 12, at: at('2026-11-19T09:00:00-03:00') })
    expect(d.reason).toBe('Teto do escritório (150 por dia): sai qui 19/11 às 09:00.')
  })

  it('hora cheia: o motivo diz a hora de hoje', () => {
    expect(judge({ global: { lastHour: 30, today: 40, oldestInHour: '2026-11-18T09:20:00-03:00' } }).reason).toBe(
      'Teto do escritório (30 por hora): sai hoje às 10:20.',
    )
  })

  it('sem o envio mais antigo, espera uma hora; vaga no passado espera pelo menos um minuto', () => {
    expect(judge({ global: { lastHour: 30, today: 40, oldestInHour: null } }).at).toBe(T0 + HOUR)
    expect(judge({ global: { lastHour: 30, today: 40, oldestInHour: '2026-11-18T08:00:00-03:00' } }).at).toBe(T0 + MIN)
  })

  it('sem nenhuma janela, a vaga fica na hora exata (dia: meia-noite seguinte)', () => {
    const hours = [null, null, null, null, null, null, null]
    // Resposta recente: passa a regra 10 sem janela nenhuma.
    expect(judge({ settings: { hours }, global: { lastHour: 30, today: 40, oldestInHour: '2026-11-18T09:30:00-03:00' } }).at).toBe(
      at('2026-11-18T10:30:00-03:00'),
    )
    expect(judge({ settings: { hours }, global: { lastHour: 0, today: 150, oldestInHour: null } }).at).toBe(at('2026-11-19T00:00:00-03:00'))
  })
})

describe('gate · regras 13 e 14: ensaio e autonomia', () => {
  it('ensaio só vale em Autônomo, com "teria sido enviada"', () => {
    expect(judge({ settings: { rehearsal: true } })).toEqual({
      action: 'hold',
      rule: 13,
      reason: 'Modo ensaio: teria sido enviada.',
      rehearsal: true,
    })
  })

  it('os motivos da autonomia, como o ADR escreve', () => {
    expect(judge({ settings: { autonomy: { service: 'draft' } } }).reason).toBe('Rascunho: o bot só escreve nesta categoria')
    expect(judge({ settings: { autonomy: { service: 'approval' } } }).reason).toBe('Espera você: Atendimento está em Aprovação')
    expect(judge({ settings: { autonomy: { billing: 'approval' } }, run: null, draft: { by: 'system', ...billing() } }).reason).toBe(
      'Espera você: Cobrança está em Aprovação',
    )
  })

  it('você não passa pela autonomia nem pelo ensaio', () => {
    expect(judge({ ...mine, settings: { rehearsal: true, autonomy: { service: 'draft' } } }).action).toBe('send')
  })
})

describe('gate · entrada estranha', () => {
  it('hora ilegível barra sem regra: o portão não adivinha', () => {
    expect(judge({ now: 'amanhã' })).toEqual({ action: 'block', rule: 0, reason: expect.stringContaining('hora') })
  })

  it('passar em tudo diz que passou', () => {
    expect(judge()).toEqual({ action: 'send', rule: 0, reason: 'Passou em todas as regras do portão.' })
  })
})

// ---------- marcadores ----------

describe('fillPayment', () => {
  const settings = base.settings
  const p = base.payments[0]

  it('valor em reais, vencimento com o ano, referente e os dados de pagamento um por linha', () => {
    expect(fillPayment(BILL, p, settings)).toBe(
      'Oi, Maria! Passando para lembrar: Manutenção · novembro/2026, R$ 480,00, vence em 20/11/2026. ' +
        'Chave PIX (CNPJ): 12.345.678/0001-90\nFavorecido: Estúdio Exemplo Ltda\nBanco: Banco Exemplo\nRecibo na hora.',
    )
  })

  it('sem pagamento, os marcadores do pagamento ficam; sem chave, {pagamento} fica', () => {
    expect(fillPayment('{valor} {vencimento} {referente} {pagamento}', null, settings)).toBe(
      `{valor} {vencimento} {referente} ${fillPayment('{pagamento}', null, settings)}`,
    )
    const empty: GateSettings = { ...settings, payment: { ...settings.payment, pixKey: '' } }
    expect(fillPayment('{valor} {pagamento}', p, empty)).toBe('R$ 480,00 {pagamento}')
  })

  it('só as linhas que existem; tipo de chave vazio não leva rótulo', () => {
    const lean: GateSettings = { ...settings, payment: { pixKey: 'chave@estudio.com.br', pixKeyType: '', payee: '', bank: ' ', note: '' } }
    expect(fillPayment('{pagamento}', null, lean)).toBe('Chave PIX: chave@estudio.com.br')
  })

  it('uma passada só: o que entra não é lido de novo; marcador em maiúscula fica', () => {
    expect(fillPayment('{referente} {VALOR}', { ...p, reference: '{valor}' }, settings)).toBe('{valor} {VALOR}')
  })

  it('o formato que os outros módulos montam com CRM_DEFAULTS', () => {
    expect(fillPayment('Total {valor}', p, CRM_DEFAULTS)).toBe('Total R$ 480,00')
  })
})

// ---------- janela e contagem ----------

const WEEK: DayHours[] = base.settings.hours

describe('inWindow', () => {
  it('início incluído, fim excluído, no dia da semana local', () => {
    expect(inWindow(at('2026-11-18T09:00:00-03:00'), WEEK, [])).toBe(true)
    expect(inWindow(at('2026-11-18T17:59:59.999-03:00'), WEEK, [])).toBe(true)
    expect(inWindow(at('2026-11-18T18:00:00-03:00'), WEEK, [])).toBe(false)
    expect(inWindow(at('2026-11-18T08:59:59-03:00'), WEEK, [])).toBe(false)
    expect(inWindow(at('2026-11-22T10:00:00-03:00'), WEEK, [])).toBe(false)
  })

  it('feriado não tem janela', () => {
    expect(inWindow(at('2026-11-20T10:00:00-03:00'), WEEK, ['2026-11-20'])).toBe(false)
  })

  it('hora mal escrita, janela vazia ou dia que falta na lista: sem janela', () => {
    const day = at('2026-11-18T10:00:00-03:00')
    expect(inWindow(day, [null, null, null, { from: '9h', to: '18:00' }], [])).toBe(false)
    expect(inWindow(day, [null, null, null, { from: '18:00', to: '09:00' }], [])).toBe(false)
    expect(inWindow(day, [null], [])).toBe(false)
  })
})

describe('nextWindow', () => {
  it('dentro da janela devolve o próprio instante', () => {
    expect(nextWindow(T0, WEEK, [])).toBe(T0)
  })

  it('virada do dia: 23:59:59 de quarta vai para quinta 09:00', () => {
    expect(nextWindow(at('2026-11-18T23:59:59-03:00'), WEEK, [])).toBe(at('2026-11-19T09:00:00-03:00'))
  })

  it('pula feriados seguidos e o domingo', () => {
    expect(nextWindow(at('2026-11-20T19:00:00-03:00'), WEEK, ['2026-11-21', '2026-11-23'])).toBe(at('2026-11-24T09:00:00-03:00'))
  })

  it('sem nenhum dia com horário no próximo ano: null', () => {
    expect(nextWindow(T0, [null, null, null, null, null, null, null], [])).toBeNull()
  })

  it('horário de verão (Nova York): o início segue o fuso novo, nos dois sentidos', () => {
    const before = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      // Sábado à noite, antes da mudança; segunda já em -04:00.
      expect(nextWindow(at('2026-03-07T20:00:00-05:00'), WEEK, [])).toBe(at('2026-03-09T09:00:00-04:00'))
      expect(nextWindow(at('2026-10-31T20:00:00-04:00'), WEEK, [])).toBe(at('2026-11-02T09:00:00-05:00'))
      // Domingo da mudança com janela: 09:00 no fuso novo; o dia tem 23 h.
      const sunday: DayHours[] = [{ from: '09:00', to: '18:00' }, ...WEEK.slice(1)]
      expect(nextWindow(at('2026-03-08T00:30:00-05:00'), sunday, [])).toBe(at('2026-03-08T09:00:00-04:00'))
      expect(inWindow(at('2026-11-01T17:59:00-05:00'), sunday, [])).toBe(true)
      expect(inWindow(at('2026-11-01T18:00:00-05:00'), sunday, [])).toBe(false)
    } finally {
      process.env.TZ = before
    }
  })
})

describe('countRecent', () => {
  const history = [
    sent('2026-11-18T09:00:00-03:00'),
    sent('2026-11-17T23:30:00-03:00', 'x', { initiated: false }),
    sent('2026-11-11T10:00:00-03:00'),
    sent('2026-11-11T10:00:01-03:00'),
  ]

  it('dia do calendário local ou os últimos N ms, com filtro', () => {
    expect(countRecent(history, T0, 'day')).toBe(1)
    expect(countRecent(history, T0, DAY)).toBe(2)
    expect(countRecent(history, T0, 7 * DAY)).toBe(3)
    expect(countRecent(history, T0, 7 * DAY, (h) => h.initiated)).toBe(2)
  })

  it('hora no futuro ou ilegível conta como agora', () => {
    expect(countRecent([sent('2026-11-25T10:00:00-03:00'), sent('???')], T0, 'day')).toBe(2)
    expect(countRecent([sent('2026-11-25T10:00:00-03:00'), sent('???')], T0, HOUR)).toBe(2)
  })
})

// ---------- propriedades ----------

/** mulberry32: um gerador simples com semente fixa, para que a falha se repita. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TEXTS = [
  OFFER,
  BILL,
  'Oi, Maria! Recebi sua mensagem e já confiro o seu pedido.',
  'Sai com 15% de desconto até 30/11.',
  'Veja https://pagamento-rapido.com/maria',
  'O portfólio está em estudioexemplo.com.br',
  'Meu CPF para o PIX: 123.456.789-09',
  'pix: maria arroba gmail ponto com',
  'Seu boleto de R$ 480,00 vence dia 20.',
  'Combinado: amanhã, 19/11, às 14:30.',
  'Segue: {pagamento}',
  OPT_OUT_REPLY,
]

/** Uma entrada qualquer: cada campo sorteado entre valores que mudam alguma regra. */
function randomInput(r: () => number): GateInput {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const coin = (p = 0.5) => r() < p
  const now = T0 + Math.floor((r() - 0.5) * 14 * DAY)
  const iso = (t: number) => isoAt(t)
  const by = pick(['bot', 'player', 'system'] as const)
  const category = pick(['service', 'billing', 'offer'] as const)
  return make({
    now: iso(now),
    connected: coin(0.9),
    settings: {
      stopAll: coin(0.1),
      rehearsal: coin(),
      autonomy: {
        service: pick(['draft', 'approval', 'auto'] as const),
        billing: pick(['draft', 'approval', 'auto'] as const),
        offer: pick(['draft', 'approval', 'auto'] as const),
      },
      maxDiscountPct: pick([0, 10, 30]),
      holidays: coin(0.2) ? [isoAt(now).slice(0, 10)] : [],
      allowedLinks: coin() ? ['estudioexemplo.com.br'] : [],
    },
    customer: coin(0.05)
      ? null
      : {
          phoneChecked: coin(0.9),
          group: coin(0.05),
          handedToPlayer: coin(0.15),
          phoneReplyAt: coin(0.15) ? iso(now - Math.floor(r() * 24 * HOUR)) : null,
          consent: { service: coin(0.9), billing: coin(0.9), offers: coin(), optOutAt: coin(0.3) ? iso(now - DAY) : null },
        },
    payments: coin(0.2)
      ? []
      : [
          {
            id: 'p1',
            customerId: 'c1',
            amountCents: 48000,
            due: '2026-11-20',
            state: pick(['open', 'paid', 'disputed'] as const),
            reference: 'R',
          },
        ],
    history: Array.from({ length: Math.floor(r() * 4) }, () =>
      sent(iso(now - Math.floor(r() * 40 * DAY)), pick(TEXTS), { initiated: coin(), category: pick(['service', 'offer'] as const) }),
    ),
    global: { lastHour: pick([0, 29, 30]), today: pick([0, 149, 150]), oldestInHour: iso(now - 30 * MIN) },
    run:
      by === 'bot'
        ? pick([{ kind: 'customer', customerId: 'c1' }, { kind: 'customer', customerId: 'c2' }, { kind: 'schedule' }, null] as const)
        : null,
    draft: {
      by,
      edited: coin(0.2),
      category,
      text: pick(TEXTS),
      replyTo: coin() ? { id: 'in1', at: iso(now - Math.floor(r() * 4 * HOUR)) } : null,
      paymentId: coin() ? 'p1' : null,
      discountPct: coin(0.3) ? pick([5, 10, 15]) : null,
      validUntil: coin(0.3) ? '2026-11-30' : null,
    },
    approved: coin(),
    override: coin(),
  })
}

describe('gate · propriedades (2.000 entradas sorteadas, semente fixa)', () => {
  const r = rng(20261117)
  const inputs = Array.from({ length: 2000 }, () => randomInput(r))
  const judged = inputs.map((input) => ({ input, d: gate(structuredClone(input)) }))

  it('o sorteio cobre todos os resultados e as regras', () => {
    expect(new Set(judged.map(({ d }) => d.action))).toEqual(new Set(['send', 'hold', 'block', 'schedule']))
    expect(new Set(judged.map(({ d }) => d.rule)).size).toBeGreaterThanOrEqual(15)
  })

  it('oferta a quem saiu ou não aceitou nunca sai, nem com aprovar nem com "enviar mesmo assim"', () => {
    let offers = 0
    for (const { input, d } of judged) {
      const c = input.customer?.consent
      if (input.draft.category !== 'offer' || !c || (c.offers && !c.optOutAt)) continue
      offers++
      expect(d.action).not.toBe('send')
      const forced = gate({ ...input, approved: true, override: true })
      expect(forced.action).not.toBe('send')
    }
    expect(offers).toBeGreaterThan(200)
  })

  it('Parar tudo, desconexão e cliente que não existe nunca enviam', () => {
    for (const { input, d } of judged) if (input.settings.stopAll || !input.connected || !input.customer) expect(d.action).toBe('block')
  })

  it('dado de pagamento no texto do bot ou do sistema nunca sai', () => {
    for (const { input, d } of judged)
      if (input.draft.by !== 'player' && findPaymentData(input.draft.text.replace(/\{pagamento\}/g, '')).length)
        expect(d.action).not.toBe('send')
  })

  it('a forma da decisão: regra 0 é envio, agendar traz a hora, e os dois sins só onde o ADR deixa', () => {
    for (const { d } of judged) {
      expect(d.reason.length).toBeGreaterThan(0)
      if (d.action === 'send') expect(d.rule).toBe(0)
      expect(d.at !== undefined).toBe(d.action === 'schedule')
      if (d.action === 'schedule') expect(typeof d.at).toBe('number')
      expect(d.rehearsal ?? false).toBe(d.rule === 13)
      if (d.overridable) expect([4, 5, 6, 8, 10, 11]).toContain(d.rule)
    }
  })

  it('é pura: a mesma entrada dá a mesma decisão e a entrada não muda', () => {
    for (const { input, d } of judged.slice(0, 300)) {
      const copy = structuredClone(input)
      expect(gate(input)).toEqual(d)
      expect(input).toEqual(copy)
    }
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
