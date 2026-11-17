process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import { CRM_LIMITS, DEFAULT_PIPELINE, type Customer, type Deal, type Payment, type Recurrence } from '@shared/types'
import {
  addDays,
  addMonths,
  dealAge,
  dueGroup,
  foldText,
  formatAmount,
  formatCents,
  formatDay,
  formatPhone,
  isDay,
  isMonth,
  localDate,
  maskPhone,
  monthLabel,
  nextRecurrence,
  normalizePhone,
  parseCustomersCsv,
  parseMoney,
  paymentStatus,
  paymentWhen,
  recurrenceDue,
  recurrenceMonths,
  recurrenceReference,
  searchCrm,
  shortDay,
  sumPayments,
  toCsv,
} from '@shared/crm'

describe('foldText', () => {
  it('tira acento, caixa e espaços repetidos', () => {
    expect(foldText('  Padaria   TRIGO  Ótimo ')).toBe('padaria trigo otimo')
    expect(foldText('Ação\tçÃo\nÜ')).toBe('acao cao u')
  })
})

describe('normalizePhone', () => {
  it('celular e fixo com DDD, sem DDI', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('5511987654321')
    expect(normalizePhone('11 3456-7890')).toBe('551134567890')
    expect(normalizePhone('11987654321')).toBe('5511987654321')
    expect(normalizePhone('55 99876-5432')).toBe('5555998765432') // DDD 55 (Santa Maria)
  })

  it('com DDI, com + ou 00', () => {
    expect(normalizePhone('+55 11 98765-4321')).toBe('5511987654321')
    expect(normalizePhone('55 11 98765 4321')).toBe('5511987654321')
    expect(normalizePhone('0055 11 98765-4321')).toBe('5511987654321')
    expect(normalizePhone('+55 (21) 2345-6789')).toBe('552123456789')
  })

  it('põe o 9º dígito no celular antigo e deixa o fixo como está', () => {
    expect(normalizePhone('(11) 8765-4321')).toBe('5511987654321')
    expect(normalizePhone('+55 31 7123-4567')).toBe('5531971234567')
    expect(normalizePhone('(11) 2345-6789')).toBe('551123456789')
  })

  it('tira o 0 e o código da operadora', () => {
    expect(normalizePhone('011 98765-4321')).toBe('5511987654321')
    expect(normalizePhone('0 21 11 98765-4321')).toBe('5511987654321')
  })

  it('outros países precisam do +', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('14155552671')
    expect(normalizePhone('+351 912 345 678')).toBe('351912345678')
    expect(normalizePhone('912 345 678', '351')).toBe('351912345678')
    expect(normalizePhone('1 415 555 2671')).toBeNull()
  })

  it('lixo vira null', () => {
    for (const bad of ['', '   ', 'abc', '98765-4321', '(00) 98765-4321', '(20) 98765-4321', '11 18765-4321', '(11) 1234-5678', '11 98765-4321 ramal 2', '1'.repeat(30), '+0 11 1234', '+55', '12345', 'x'.repeat(50)]) {
      expect(normalizePhone(bad), bad).toBeNull()
    }
    expect(normalizePhone(42 as unknown as string)).toBeNull()
  })

  it('nunca passa de 15 dígitos', () => {
    expect(normalizePhone('+123456789012345')).toBe('123456789012345')
    expect(normalizePhone('+1234567890123456')).toBeNull()
    expect(CRM_LIMITS.phoneDigits).toBe(15)
  })
})

describe('maskPhone e formatPhone', () => {
  it('máscara para logs: DDI e os quatro últimos', () => {
    expect(maskPhone('5511987654321')).toBe('55•••••••4321')
    expect(maskPhone('551134567890')).toBe('55••••••7890')
    expect(maskPhone('1234')).toBe('••••')
    expect(maskPhone('')).toBe('•')
  })

  it('na tela, com DDI, DDD e hífen', () => {
    expect(formatPhone('5511987654321')).toBe('+55 11 98765-4321')
    expect(formatPhone('551134567890')).toBe('+55 11 3456-7890')
    expect(formatPhone('14155552671')).toBe('+14155552671')
    expect(formatPhone('')).toBe('')
  })
})

describe('dinheiro', () => {
  it('formata centavos em reais', () => {
    expect(formatCents(123456)).toBe('R$ 1.234,56')
    expect(formatCents(48000)).toBe('R$ 480,00')
    expect(formatCents(5)).toBe('R$ 0,05')
    expect(formatCents(123456789012)).toBe('R$ 1.234.567.890,12')
    expect(formatCents(-990)).toBe('-R$ 9,90')
    expect(formatAmount(48000)).toBe('480,00')
    expect(formatAmount(Number.NaN)).toBe('0,00')
  })

  it('lê o valor como a pessoa digita', () => {
    expect(parseMoney('1.234,56')).toBe(123456)
    expect(parseMoney('R$ 480')).toBe(48000)
    expect(parseMoney('480.5')).toBe(48050)
    expect(parseMoney('480,50')).toBe(48050)
    expect(parseMoney('1,234.56')).toBe(123456)
    expect(parseMoney('1.234')).toBe(123400)
    expect(parseMoney('1.234.567')).toBe(123456700)
    expect(parseMoney(',5')).toBe(50)
    expect(parseMoney('R$\u00a01.000,00')).toBe(100000)
    expect(parseMoney('0')).toBe(0)
  })

  it('recusa o que não é dinheiro', () => {
    for (const bad of ['', 'abc', '-5', '1,2,3', '12.34.56', '1.234,5,6', '10 reais', '1.23.456,00', '9'.repeat(50)]) expect(parseMoney(bad), bad).toBeNull()
  })

  it('soma', () => {
    expect(sumPayments([{ amountCents: 48000 }, { amountCents: 8990 }])).toBe(56990)
    expect(sumPayments([])).toBe(0)
  })
})

describe('datas', () => {
  it('dia local, validação e contas de calendário', () => {
    expect(localDate(new Date(2026, 10, 17, 23, 59))).toBe('2026-11-17')
    expect(localDate(new Date(2026, 0, 1, 0, 0).getTime())).toBe('2026-01-01')
    expect(isDay('2028-02-29')).toBe(true)
    expect(isDay('2026-02-29')).toBe(false)
    expect(isDay('2026-04-31')).toBe(false)
    expect(isDay('2026-13-01')).toBe(false)
    expect(isDay('26-11-17')).toBe(false)
    expect(isDay(20261117)).toBe(false)
    expect(isMonth('2026-11')).toBe(true)
    expect(isMonth('2026-00')).toBe(false)
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    // the end of daylight saving time in an older year does not move the day
    expect(addDays('2018-02-17', 1)).toBe('2018-02-18')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(formatDay('2026-11-20')).toBe('20/11/2026')
    expect(shortDay('2026-11-20')).toBe('20/11')
    expect(monthLabel('2026-03')).toBe('março/2026')
  })
})

describe('pagamentos', () => {
  const today = '2026-11-17'
  it('aberto com vencimento passado é atrasado', () => {
    expect(paymentStatus({ state: 'open', due: '2026-11-16' }, today)).toBe('overdue')
    expect(paymentStatus({ state: 'open', due: today }, today)).toBe('open')
    expect(paymentStatus({ state: 'paid', due: '2026-10-01' }, today)).toBe('paid')
    expect(paymentStatus({ state: 'disputed', due: '2026-10-01' }, today)).toBe('disputed')
  })

  it('separa nas abas Próximos, Atrasados e Histórico', () => {
    expect(dueGroup({ state: 'open', due: '2026-11-20' }, today)).toBe('upcoming')
    expect(dueGroup({ state: 'open', due: '2026-11-10' }, today)).toBe('overdue')
    expect(dueGroup({ state: 'disputed', due: '2026-11-10' }, today)).toBe('overdue')
    expect(dueGroup({ state: 'disputed', due: '2026-12-10' }, today)).toBe('upcoming')
    expect(dueGroup({ state: 'paid', due: '2026-12-10' }, today)).toBe('history')
    expect(dueGroup({ state: 'canceled', due: '2026-11-10' }, today)).toBe('history')
  })

  it('diz em palavras onde o pagamento está', () => {
    expect(paymentWhen({ state: 'open', due: '2026-11-20' }, today)).toBe('vence 20/11')
    expect(paymentWhen({ state: 'open', due: '2026-11-10' }, today)).toBe('venceu 10/11')
    expect(paymentWhen({ state: 'paid', due: '2026-10-20', paidOn: '2026-10-18' }, today)).toBe('pago 18/10')
    expect(paymentWhen({ state: 'canceled', due: '2026-10-20' }, today)).toBe('cancelado')
    expect(paymentWhen({ state: 'disputed', due: '2026-10-20' }, today)).toBe('em disputa · vence 20/10')
  })
})

describe('recorrência', () => {
  const rec = (over: Partial<Recurrence> = {}): Recurrence => ({
    id: 'r1',
    customerId: 'c1',
    amountCents: 48000,
    day: 20,
    reference: 'Manutenção',
    method: 'pix',
    start: '2026-11',
    active: true,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  })

  it('dia 31 cai no último dia do mês curto; fevereiro de ano bissexto tem 29', () => {
    expect(recurrenceDue({ day: 31 }, '2026-04')).toBe('2026-04-30')
    expect(recurrenceDue({ day: 31 }, '2026-02')).toBe('2026-02-28')
    expect(recurrenceDue({ day: 30 }, '2028-02')).toBe('2028-02-29')
    expect(recurrenceDue({ day: 29 }, '2028-02')).toBe('2028-02-29')
    expect(recurrenceDue({ day: 31 }, '2026-12')).toBe('2026-12-31')
    expect(recurrenceDue({ day: 5 }, '2026-11')).toBe('2026-11-05')
    expect(recurrenceReference({ reference: 'Manutenção' }, '2026-11')).toBe('Manutenção · novembro/2026')
  })

  it('dia 20 cria o pagamento do mês 10 dias antes', () => {
    expect(recurrenceMonths(rec(), '2026-11-09', 10)).toEqual([])
    expect(recurrenceMonths(rec(), '2026-11-10', 10)).toEqual([{ month: '2026-11', due: '2026-11-20' }])
    expect(recurrenceMonths(rec({ lastMonth: '2026-11' }), '2026-11-17', 10)).toEqual([])
  })

  it('vira o mês: o próximo entra quando chega a antecedência', () => {
    expect(recurrenceMonths(rec({ lastMonth: '2026-11' }), '2026-12-10', 10)).toEqual([{ month: '2026-12', due: '2026-12-20' }])
    // dia 5 de janeiro: 10 dias antes cai em dezembro
    expect(recurrenceMonths(rec({ day: 5, start: '2026-12', lastMonth: '2026-12' }), '2026-12-26', 10)).toEqual([{ month: '2027-01', due: '2027-01-05' }])
    // fim de fevereiro em ano bissexto
    expect(recurrenceMonths(rec({ day: 31, start: '2028-02' }), '2028-02-19', 10)).toEqual([{ month: '2028-02', due: '2028-02-29' }])
    expect(recurrenceMonths(rec({ day: 31, start: '2028-02' }), '2028-02-18', 10)).toEqual([])
  })

  it('app fechado por meses: os que faltam, no máximo 12, até o fim', () => {
    expect(recurrenceMonths(rec({ start: '2026-08' }), '2026-11-17', 10).map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11'])
    const many = recurrenceMonths(rec({ start: '2020-01' }), '2026-11-17', 10)
    expect(many).toHaveLength(12)
    expect(many.at(-1)?.month).toBe('2026-11')
    expect(many[0].month).toBe('2025-12')
    expect(recurrenceMonths(rec({ start: '2026-08', end: '2026-09' }), '2026-11-17', 10).map((m) => m.month)).toEqual(['2026-08', '2026-09'])
    expect(recurrenceMonths(rec({ active: false }), '2026-11-17', 10)).toEqual([])
    expect(recurrenceMonths(rec({ start: '2027-01' }), '2026-11-17', 10)).toEqual([])
  })

  it('próximo vencimento', () => {
    expect(nextRecurrence(rec(), '2026-11-17')).toEqual({ month: '2026-11', due: '2026-11-20' })
    expect(nextRecurrence(rec({ lastMonth: '2026-11' }), '2026-11-17')).toEqual({ month: '2026-12', due: '2026-12-20' })
    expect(nextRecurrence(rec(), '2026-11-21')).toEqual({ month: '2026-12', due: '2026-12-20' })
    expect(nextRecurrence(rec({ end: '2026-11' }), '2026-11-21')).toBeNull()
    expect(nextRecurrence(rec({ active: false }), '2026-11-17')).toBeNull()
    expect(nextRecurrence(rec({ start: '2027-03' }), '2026-11-17')).toEqual({ month: '2027-03', due: '2027-03-20' })
  })
})

describe('negócios', () => {
  it('dias inteiros na etapa', () => {
    const now = new Date(2026, 10, 17, 12).getTime()
    expect(dealAge({ stageAt: now - 3 * 86_400_000 - 1000 }, now)).toBe(3)
    expect(dealAge({ stageAt: now - 1000 }, now)).toBe(0)
    expect(dealAge({ stageAt: now + 5000 }, now)).toBe(0)
  })
})

describe('toCsv', () => {
  const lines = (csv: string) => csv.slice(1).split('\r\n')

  it('BOM, ponto e vírgula, CRLF e células vazias', () => {
    const csv = toCsv(['Nome', 'Valor', 'Nada'], [['Maria', '480,00', null], ['João', 3, undefined]])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(lines(csv)).toEqual(['Nome;Valor;Nada', 'Maria;"480,00";', 'João;3;', ''])
  })

  it('aspas, vírgula, ponto e vírgula e quebra de linha', () => {
    const csv = toCsv(['A'], [['Padaria "Trigo"'], ['a;b'], ['linha 1\nlinha 2'], ['x,y']])
    expect(csv.slice(1)).toBe('A\r\n"Padaria ""Trigo"""\r\n"a;b"\r\n"linha 1\nlinha 2"\r\n"x,y"\r\n')
  })

  it('célula com cara de fórmula ganha um apóstrofo', () => {
    const csv = toCsv(['A'], [['=HYPERLINK("http://mal.example","clique")'], ['+1'], ['-2'], ['@SUM(A1:A2)'], ['\tTAB'], ['\rCR'], ['normal'], [-5]])
    expect(lines(csv).slice(1, -1)).toEqual(['"\'=HYPERLINK(""http://mal.example"",""clique"")"', "'+1", "'-2", "'@SUM(A1:A2)", "'\tTAB", '"\'\rCR"', 'normal', "'-5"])
  })

  it('fórmula depois de vírgula, ponto e vírgula, tab ou quebra de linha também ganha apóstrofo', () => {
    const csv = toCsv(['A'], [['a,=1+1,b'], ['x; -2+3'], ['y\t@SUM(A1)'], ['linha\n+1'], ['z,"=HYPERLINK(B7)'], ['Rua 7, 120'], ['2026-11-20']])
    expect(lines(csv).slice(1, -1)).toEqual([
      `"a,'=1+1,b"`,
      `"x; '-2+3"`,
      "y\t'@SUM(A1)",
      `"linha\n'+1"`,
      `"z,""'=HYPERLINK(B7)"`,
      '"Rua 7, 120"',
      '2026-11-20',
    ])
  })

  it('número com vírgula decimal', () => {
    expect(lines(toCsv(['n'], [[1.5], [Number.NaN]]))[1]).toBe('"1,5"')
  })
})

describe('parseCustomersCsv', () => {
  it('ponto e vírgula do Excel com BOM, cabeçalho com acento', () => {
    const rows = parseCustomersCsv('\ufeffNome;Empresa;Telefone;E-mail;Etiquetas;Responsável\r\nMaria Souza;Padaria Trigo;(11) 98765-4321;maria@trigo.com;"site, manutenção";Allef\r\n')
    expect(rows).toEqual([
      {
        line: 1,
        draft: { name: 'Maria Souza', company: 'Padaria Trigo', phones: ['5511987654321'], email: 'maria@trigo.com', tags: ['site', 'manutenção'], owner: 'Allef', consent: { offers: false } },
      },
    ])
  })

  it('vírgula, cabeçalho sem acento e em inglês', () => {
    const rows = parseCustomersCsv('name,company,phone,email,tags,responsavel\nJoão,"Oficina, Ltda",11 3456-7890,,vip,\n')
    expect(rows[0].draft).toEqual({ name: 'João', company: 'Oficina, Ltda', phones: ['551134567890'], tags: ['vip'], consent: { offers: false } })
    expect(rows[0].error).toBeUndefined()
  })

  it('tab, aspas dobradas e quebra de linha dentro das aspas', () => {
    const rows = parseCustomersCsv('Nome\tEmpresa\tCelular\n"Ana ""Aninha"" Lima"\t"Studio\nAna"\t11987654321\n')
    expect(rows[0].draft).toMatchObject({ name: 'Ana "Aninha" Lima', company: 'Studio Ana', phones: ['5511987654321'] })
  })

  it('vários telefones na célula ou em colunas; ofertas nunca ligadas', () => {
    const rows = parseCustomersCsv('Nome;Telefone;WhatsApp;Ofertas\nLia;11 3456-7890 / 11 98765-4321;11 98765-4321;sim\n')
    expect(rows[0].draft.phones).toEqual(['551134567890', '5511987654321'])
    expect(rows[0].draft.consent).toEqual({ offers: false })
  })

  it('linha sem nome, telefone inválido, e-mail ruim e telefone repetido vêm com erro', () => {
    const rows = parseCustomersCsv(
      ['Nome;Telefone;Email', ';11 98765-4321;', 'Pedro;12345;', 'Rita;;rita@', 'Caio;11 98765-0000;', 'Duda;(11) 98765-0000;', ';;', 'Ok;;ok@ok.com'].join('\n'),
    )
    expect(rows.map((r) => [r.line, r.error])).toEqual([
      [1, 'Linha sem nome: preencha a coluna Nome.'],
      [2, 'Telefone inválido: use DDD e número, como (11) 98765-4321.'],
      [3, 'E-mail inválido.'],
      [4, undefined],
      [5, 'Telefone repetido: já aparece na linha 4.'],
      [7, undefined],
    ])
  })

  it('fórmula vira texto comum (o CSV não executa nada)', () => {
    const rows = parseCustomersCsv('Nome;Empresa\n=HYPERLINK("x");@SUM(1)\n')
    expect(rows[0].draft).toMatchObject({ name: '=HYPERLINK("x")', company: '@SUM(1)' })
  })

  it('para no limite de linhas e avisa', () => {
    const body = Array.from({ length: CRM_LIMITS.csvRows + 3 }, (_, i) => `Cliente ${i}`).join('\n')
    const rows = parseCustomersCsv(`Nome\n${body}`)
    expect(rows).toHaveLength(CRM_LIMITS.csvRows + 1)
    expect(rows.at(-1)?.error).toMatch(/ficaram de fora/)
  })

  it('sem coluna de nome: toda linha vem com erro; texto vazio, nenhuma linha', () => {
    expect(parseCustomersCsv('Telefone\n11 98765-4321\n')[0].error).toMatch(/sem nome/)
    expect(parseCustomersCsv('')).toEqual([])
  })
})

describe('searchCrm', () => {
  const customer = (id: string, name: string, over: Partial<Customer> = {}): Customer => ({
    id,
    kind: 'person',
    name,
    phones: [],
    tags: [],
    consent: { service: true, billing: true, offers: false },
    source: 'manual',
    notes: [],
    tickets: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  })
  const deal = (id: string, customerId: string, title: string, stageId = 'proposta'): Deal => ({
    id,
    customerId,
    title,
    valueCents: 480000,
    pipelineId: 'padrao',
    stageId,
    stageAt: 0,
    tickets: [],
    order: 0,
    history: [],
    createdAt: 0,
    updatedAt: 0,
  })
  const payment = (id: string, customerId: string, invoice: string, over: Partial<Payment> = {}): Payment => ({
    id,
    customerId,
    invoice,
    amountCents: 48000,
    due: '2026-11-20',
    reference: 'Manutenção · novembro/2026',
    method: 'pix',
    state: 'open',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  })
  const data = {
    customers: [
      customer('c1', 'José Conceição', { company: 'Padaria Trigo', phones: ['5511987654321'], tags: ['manutenção'] }),
      customer('c2', 'Ana Lima', { company: 'Studio A', phones: ['552134567890'], email: 'ana@studio.com' }),
      customer('c3', 'Mariana Concha'),
    ],
    deals: [deal('d1', 'c2', 'Site institucional'), deal('d2', 'c1', 'Cardápio digital', 'novo')],
    payments: [payment('p1', 'c1', '2026-11-007'), payment('p2', 'c2', '2026-10-003', { state: 'paid', paidOn: '2026-10-18', due: '2026-10-20', reference: 'Site' })],
  }
  const today = '2026-11-17'

  it('acha sem acento e sem caixa', () => {
    const hits = searchCrm(data, 'jose conceicao', today)
    expect(hits[0]).toEqual({ kind: 'customer', id: 'c1', customerId: 'c1', title: 'José Conceição · Padaria Trigo', detail: '+55 11 98765-4321 · manutenção' })
    expect(searchCrm(data, 'MANUTENÇAO', today).map((h) => h.id)).toEqual(['c1', 'p1', 'd2'])
  })

  it('acha por telefone parcial, com ou sem máscara', () => {
    expect(searchCrm(data, '98765', today)[0].id).toBe('c1')
    expect(searchCrm(data, '(11) 9876', today)[0].id).toBe('c1')
    expect(searchCrm(data, '3456-78', today)[0].id).toBe('c2')
    expect(searchCrm(data, '12', today).filter((h) => h.kind === 'customer')).toEqual([])
  })

  it('negócios e pagamentos, com etapa, valor e vencimento', () => {
    expect(searchCrm(data, 'site', today)[0]).toEqual({ kind: 'deal', id: 'd1', customerId: 'c2', title: 'Site institucional · Ana Lima', detail: 'Proposta · R$ 4.800,00' })
    expect(searchCrm(data, '2026-11', today)[0]).toEqual({ kind: 'payment', id: 'p1', customerId: 'c1', title: '2026-11-007 · José Conceição', detail: 'vence 20/11 · R$ 480,00' })
    expect(searchCrm(data, '2026-10-003', today)[0].detail).toBe('pago 18/10 · R$ 480,00')
    const withStages = { ...data, pipelines: [{ ...DEFAULT_PIPELINE, stages: DEFAULT_PIPELINE.stages.map((s) => ({ ...s, name: s.name.toUpperCase() })) }] }
    expect(searchCrm(withStages, 'cardapio', today)[0].detail).toBe('NOVO · R$ 4.800,00')
  })

  it('o melhor primeiro: o nome que começa pela busca vence', () => {
    expect(searchCrm(data, 'con', today).filter((h) => h.kind === 'customer').map((h) => h.id)).toEqual(['c1', 'c3'])
    const hits = searchCrm(data, 'ana', today)
    expect(hits[0].id).toBe('c2')
    expect(hits.map((h) => h.kind)).toEqual(['customer', 'customer', 'deal', 'payment'])
  })

  it('busca vazia não acha nada; o limite vale', () => {
    expect(searchCrm(data, '   ', today)).toEqual([])
    expect(searchCrm(data, 'a', today, 2)).toHaveLength(2)
  })
})
