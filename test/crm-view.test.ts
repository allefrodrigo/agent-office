import { describe, expect, it } from 'vitest'
import {
  applyCrmDelta,
  ariaSort,
  authorLabel,
  boardColumns,
  brDate,
  brDateOf,
  consentLines,
  countOf,
  crmWaiting,
  customerColumns,
  customerStage,
  customerTimeline,
  customerToDraft,
  dayToMs,
  daysLabel,
  dealCardLabel,
  dealOpen,
  dealsByCustomer,
  dealTicketDraft,
  dealToDraft,
  defaultPaymentSort,
  deleteCustomerText,
  fieldOfError,
  filterDeals,
  filterRows,
  gridTemplate,
  hasFilters,
  importButtonLabel,
  importRequest,
  importStats,
  isPaymentTab,
  joinPt,
  mergeById,
  moveRow,
  neighborStage,
  nextSort,
  parseColumnPrefs,
  paymentColumns,
  paymentDraftError,
  paymentsIn,
  paymentStateText,
  paymentTabCounts,
  pipelineOf,
  recurrenceDraftError,
  recurrenceLabel,
  scrollForRow,
  sortRows,
  splitList,
  stageName,
  sumColumn,
  tableAnnouncement,
  tableFooter,
  tableRows,
  toggleColumn,
  VIRTUAL_FROM,
  virtualWindow,
  visibleColumns,
  type CrmColumn,
} from '@shared/crm-view'
import {
  CRM_DEFAULTS,
  DEFAULT_PIPELINE,
  type CrmData,
  type Customer,
  type CustomerImportRow,
  type Deal,
  type Payment,
  type Pipeline,
  type Recurrence,
} from '@shared/types'

const DAY = 86_400_000
const T0 = new Date(2026, 10, 17, 10).getTime()

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: 'c1',
    kind: 'person',
    name: 'Maria Souza',
    company: 'Padaria Trigo',
    phones: ['5511987654321'],
    tags: ['site'],
    consent: { service: true, billing: true, offers: false },
    source: 'manual',
    notes: [],
    tickets: [],
    createdAt: T0 - 30 * DAY,
    updatedAt: T0 - 30 * DAY,
    ...over,
  }
}

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: 'd1',
    customerId: 'c1',
    title: 'Site institucional',
    valueCents: 480_000,
    pipelineId: 'padrao',
    stageId: 'proposta',
    stageAt: T0 - 3 * DAY,
    tickets: [],
    order: 0,
    history: [],
    createdAt: T0 - 10 * DAY,
    updatedAt: T0 - 3 * DAY,
    ...over,
  }
}

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: 'p1',
    customerId: 'c1',
    invoice: '2026-11-001',
    amountCents: 48_000,
    due: '2026-11-20',
    reference: 'Manutenção · novembro/2026',
    method: 'pix',
    state: 'open',
    createdAt: T0 - 5 * DAY,
    updatedAt: T0 - 5 * DAY,
    ...over,
  }
}

function recurrence(over: Partial<Recurrence> = {}): Recurrence {
  return {
    id: 'r1',
    customerId: 'c1',
    amountCents: 48_000,
    day: 20,
    reference: 'Manutenção',
    method: 'pix',
    start: '2026-11',
    active: true,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  }
}

function data(over: Partial<CrmData> = {}): CrmData {
  return {
    customers: [],
    deals: [],
    pipelines: [DEFAULT_PIPELINE],
    payments: [],
    recurrences: [],
    suggestions: [],
    outbox: [],
    settings: CRM_DEFAULTS,
    ...over,
  }
}

interface Row {
  id: string
  name: string
  city?: string
  n?: number
}

const COLS: CrmColumn<Row>[] = [
  { id: 'name', label: 'Nome', text: (r) => r.name },
  { id: 'city', label: 'Cidade', text: (r) => r.city ?? '', optional: true },
  {
    id: 'n',
    label: 'Valor',
    text: (r) => (r.n === undefined ? '' : String(r.n)),
    sortKey: (r) => r.n,
    cents: (r) => r.n ?? 0,
    firstDir: 'desc',
    width: 'minmax(90px, 0.5fr)',
  },
]

const ROWS: Row[] = [
  { id: 'a', name: 'João', city: 'São Paulo', n: 300 },
  { id: 'b', name: 'ana', city: 'Curitiba', n: 100 },
  { id: 'c', name: 'Álvaro', city: 'são josé', n: undefined },
  { id: 'd', name: 'Bruno', city: 'Salvador', n: 100 },
]

describe('o espelho do crm.json', () => {
  it('põe os itens no lugar pelo id e os novos no fim', () => {
    const out = mergeById(
      [
        { id: 'a', v: 1 },
        { id: 'b', v: 1 },
      ],
      [
        { id: 'b', v: 2 },
        { id: 'c', v: 1 },
      ],
    )
    expect(out).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 1 },
    ])
  })

  it('tira os removidos, mesmo que venham também como item', () => {
    expect(mergeById([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], ['a', 'c'])).toEqual([{ id: 'b' }])
  })

  it('aplica o delta por coleção, com as regras novas, sem mexer no resto', () => {
    const before = data({ customers: [customer()], deals: [deal()] })
    const settings = { ...CRM_DEFAULTS, rehearsal: false }
    const after = applyCrmDelta(before, { customers: [customer({ name: 'Maria S.' })], removed: { deals: ['d1'] }, settings })
    expect(after.customers[0].name).toBe('Maria S.')
    expect(after.deals).toEqual([])
    expect(after.settings.rehearsal).toBe(false)
    expect(after.payments).toBe(before.payments)
    // o original fica como estava
    expect(before.customers[0].name).toBe('Maria Souza')
  })

  it('um delta de reload sozinho não muda nada (o store lê tudo de novo)', () => {
    const before = data({ customers: [customer()] })
    expect(applyCrmDelta(before, { reload: true })).toEqual(before)
  })

  it('conta as sugestões pendentes para o botão CRM', () => {
    const s = (status: 'pending' | 'approved') => ({
      id: status,
      t: 0,
      category: 'offer' as const,
      why: '',
      customerIds: [],
      leftOut: [],
      text: '',
      status,
    })
    expect(crmWaiting(null)).toBe(0)
    expect(crmWaiting({ suggestions: [s('pending'), s('approved'), { ...s('pending'), id: 'x' }] })).toBe(2)
  })
})

describe('datas', () => {
  it('escreve o dia e o momento no jeito brasileiro', () => {
    expect(brDate('2026-11-20')).toBe('20/11/2026')
    expect(brDate(undefined)).toBe('')
    expect(brDateOf(T0)).toBe('17/11/2026')
    expect(brDateOf(undefined)).toBe('')
  })

  it('põe o dia do calendário ao meio-dia local', () => {
    expect(new Date(dayToMs('2026-11-20')).getHours()).toBe(12)
    expect(dayToMs('lixo')).toBe(0)
  })

  it('diz há quanto tempo o negócio está na etapa', () => {
    expect(daysLabel(0)).toBe('hoje')
    expect(daysLabel(1)).toBe('1 dia')
    expect(daysLabel(12)).toBe('12 dias')
  })
})

describe('tabela: filtro por coluna', () => {
  it('ignora acento e caixa', () => {
    expect(filterRows(ROWS, COLS, { city: 'sao' }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterRows(ROWS, COLS, { name: 'ALVARO' }).map((r) => r.id)).toEqual(['c'])
  })

  it('exige todas as palavras e todas as colunas filtradas', () => {
    expect(filterRows(ROWS, COLS, { city: 'são paulo' }).map((r) => r.id)).toEqual(['a'])
    expect(filterRows(ROWS, COLS, { city: 'são', name: 'joão' }).map((r) => r.id)).toEqual(['a'])
  })

  it('sem filtro devolve tudo, numa cópia', () => {
    const out = filterRows(ROWS, COLS, { name: '  ' })
    expect(out).toEqual(ROWS)
    expect(out).not.toBe(ROWS)
    expect(hasFilters({ name: '  ' })).toBe(false)
    expect(hasFilters({ name: 'a' })).toBe(true)
  })

  it('usa o texto de filtro da coluna quando ele existe (os dígitos do telefone)', () => {
    const cols: CrmColumn<Row>[] = [{ id: 'name', label: 'Nome', text: (r) => r.name, filterText: (r) => `${r.name} ${r.id}-x` }]
    expect(filterRows(ROWS, cols, { name: 'b-x' }).map((r) => r.id)).toEqual(['b'])
  })
})

describe('tabela: ordenação', () => {
  it('ordena texto em pt-BR, sem caixa nem acento', () => {
    expect(sortRows(ROWS, COLS[0], 'asc').map((r) => r.name)).toEqual(['Álvaro', 'ana', 'Bruno', 'João'])
  })

  it('é estável: empates mantêm a ordem de chegada', () => {
    expect(sortRows(ROWS, COLS[2], 'asc').map((r) => r.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(sortRows(ROWS, COLS[2], 'desc').map((r) => r.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('vazio fica no fim nos dois sentidos', () => {
    expect(sortRows(ROWS, COLS[2], 'asc').at(-1)?.id).toBe('c')
    expect(sortRows(ROWS, COLS[2], 'desc').at(-1)?.id).toBe('c')
  })

  it('o clique troca o sentido na mesma coluna e começa pelo sentido da coluna nova', () => {
    expect(nextSort(null, COLS[0])).toEqual({ col: 'name', dir: 'asc' })
    expect(nextSort({ col: 'name', dir: 'asc' }, COLS[0])).toEqual({ col: 'name', dir: 'desc' })
    expect(nextSort({ col: 'name', dir: 'desc' }, COLS[0])).toEqual({ col: 'name', dir: 'asc' })
    expect(nextSort({ col: 'name', dir: 'asc' }, COLS[2])).toEqual({ col: 'n', dir: 'desc' })
  })

  it('diz o aria-sort de cada cabeçalho', () => {
    expect(ariaSort({ col: 'n', dir: 'asc' }, 'n')).toBe('ascending')
    expect(ariaSort({ col: 'n', dir: 'desc' }, 'n')).toBe('descending')
    expect(ariaSort({ col: 'n', dir: 'desc' }, 'name')).toBe('none')
    expect(ariaSort(null, 'name')).toBe('none')
  })

  it('filtra e depois ordena; uma coluna que não existe não ordena', () => {
    expect(tableRows(ROWS, COLS, { city: 's' }, { col: 'name', dir: 'desc' }).map((r) => r.id)).toEqual(['a', 'd', 'c'])
    expect(tableRows(ROWS, COLS, {}, { col: 'sumiu', dir: 'asc' }).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('tabela: colunas', () => {
  it('lê do localStorage só os ids que existem', () => {
    expect(parseColumnPrefs(null, COLS)).toBeNull()
    expect(parseColumnPrefs('{quebrado', COLS)).toBeNull()
    expect(parseColumnPrefs('{"a":1}', COLS)).toBeNull()
    expect(parseColumnPrefs('["x"]', COLS)).toBeNull()
    expect(parseColumnPrefs('["n","x","n",3,"city"]', COLS)).toEqual(['n', 'city'])
  })

  it('sem escolha mostra as que não são opcionais; a primeira nunca some', () => {
    expect(visibleColumns(COLS, null).map((c) => c.id)).toEqual(['name', 'n'])
    expect(visibleColumns(COLS, ['city']).map((c) => c.id)).toEqual(['name', 'city'])
  })

  it('liga e desliga na ordem das colunas, sem tirar a primeira', () => {
    expect(toggleColumn(COLS, null, 'city')).toEqual(['name', 'city', 'n'])
    expect(toggleColumn(COLS, ['name', 'city', 'n'], 'n')).toEqual(['name', 'city'])
    expect(toggleColumn(COLS, null, 'name')).toEqual(['name', 'n'])
  })

  it('monta o grid das colunas', () => {
    expect(gridTemplate(COLS.slice(1))).toBe('minmax(120px, 1fr) minmax(90px, 0.5fr)')
  })
})

describe('tabela: lista virtual', () => {
  it('até 200 linhas desenha todas', () => {
    expect(virtualWindow(VIRTUAL_FROM, 40, 1000, 600)).toEqual({ start: 0, end: VIRTUAL_FROM, top: 0, bottom: 0 })
  })

  it('com 2 mil desenha só as que estão à vista, com folga', () => {
    const w = virtualWindow(2000, 40, 4000, 600, 8)
    expect(w.start).toBe(92)
    expect(w.end).toBe(100 + 16 + 8)
    expect(w.top).toBe(92 * 40)
    expect(w.bottom).toBe((2000 - w.end) * 40)
    expect(w.end - w.start).toBeLessThan(40)
  })

  it('no começo e no fim não passa dos limites', () => {
    expect(virtualWindow(2000, 40, -50, 600).start).toBe(0)
    const end = virtualWindow(2000, 40, 2000 * 40, 600)
    expect(end.end).toBe(2000)
    expect(end.bottom).toBe(0)
  })

  it('rola só o necessário para mostrar a linha', () => {
    expect(scrollForRow(5, 40, 0, 400)).toBe(0)
    expect(scrollForRow(20, 40, 0, 400)).toBe(21 * 40 - 400)
    expect(scrollForRow(2, 40, 200, 400)).toBe(80)
  })

  it('anda pelas linhas com as setas, Home, End e as páginas', () => {
    expect(moveRow(-1, 10, 'ArrowDown')).toBe(0)
    expect(moveRow(3, 10, 'ArrowDown')).toBe(4)
    expect(moveRow(9, 10, 'ArrowDown')).toBe(9)
    expect(moveRow(0, 10, 'ArrowUp')).toBe(0)
    expect(moveRow(5, 10, 'Home')).toBe(0)
    expect(moveRow(5, 10, 'End')).toBe(9)
    expect(moveRow(5, 10, 'PageDown', 3)).toBe(8)
    expect(moveRow(5, 10, 'PageUp', 10)).toBe(0)
    expect(moveRow(5, 10, 'x')).toBe(5)
    expect(moveRow(0, 0, 'ArrowDown')).toBe(-1)
  })
})

describe('tabela: rodapé e anúncio', () => {
  it('soma a coluna de dinheiro', () => {
    expect(sumColumn(ROWS, COLS[2])).toBe(500)
    expect(sumColumn(ROWS, COLS[0])).toBe(0)
    expect(sumColumn(ROWS, undefined)).toBe(0)
  })

  it('escreve a quantidade, a parte filtrada e a soma', () => {
    expect(countOf(1, ['cliente', 'clientes'])).toBe('1 cliente')
    expect(tableFooter(12, 12, ['cliente', 'clientes'])).toBe('12 clientes')
    expect(tableFooter(3, 40, ['cliente', 'clientes'])).toBe('3 de 40 clientes')
    expect(tableFooter(2, 2, ['pagamento', 'pagamentos'], 123_456)).toBe('2 pagamentos · R$ 1.234,56')
  })

  it('anuncia a ordenação e o filtro', () => {
    expect(tableAnnouncement(12, 12, ['cliente', 'clientes'], { label: 'Último contato', dir: 'desc' })).toBe(
      '12 clientes, ordenados por Último contato, decrescente',
    )
    expect(tableAnnouncement(1, 40, ['cliente', 'clientes'], { label: 'Cliente', dir: 'asc' })).toBe(
      '1 de 40 clientes, filtrados, ordenados por Cliente, crescente',
    )
    expect(tableAnnouncement(0, 0, ['pagamento', 'pagamentos'], null)).toBe('0 pagamentos')
  })
})

describe('clientes', () => {
  const pipelines = [DEFAULT_PIPELINE]

  it('acha o funil e a etapa, com o padrão quando falta', () => {
    const other: Pipeline = { id: 'b', name: 'B', stages: [{ id: 'x', name: 'X', kind: 'open' }] }
    expect(pipelineOf([], undefined)).toBe(DEFAULT_PIPELINE)
    expect(pipelineOf([DEFAULT_PIPELINE, other], 'b')).toBe(other)
    expect(pipelineOf([DEFAULT_PIPELINE, other], 'sumiu')).toBe(DEFAULT_PIPELINE)
    expect(stageName(pipelines, 'padrao', 'fechado')).toBe('Fechado')
    expect(stageName(pipelines, 'padrao', 'sumiu')).toBe('Etapa removida')
    expect(dealOpen(pipelines, deal({ stageId: 'perdido' }))).toBe(false)
    expect(dealOpen(pipelines, deal())).toBe(true)
  })

  it('a etapa do cliente é a do negócio aberto mais recente; sem aberto, a do mais recente', () => {
    const deals = [
      deal({ id: 'a', stageId: 'novo', updatedAt: T0 - 9 * DAY }),
      deal({ id: 'b', stageId: 'proposta', updatedAt: T0 - 2 * DAY }),
      deal({ id: 'c', stageId: 'fechado', updatedAt: T0 }),
    ]
    expect(customerStage(deals, pipelines)).toBe('Proposta')
    expect(customerStage([deals[2], deal({ id: 'd', stageId: 'perdido', updatedAt: T0 - DAY })], pipelines)).toBe('Fechado')
    expect(customerStage(undefined, pipelines)).toBe('')
  })

  it('agrupa os negócios por cliente', () => {
    const map = dealsByCustomer([deal({ id: 'a' }), deal({ id: 'b', customerId: 'c2' }), deal({ id: 'c' })])
    expect(map.get('c1')?.map((d) => d.id)).toEqual(['a', 'c'])
    expect(map.get('c2')?.length).toBe(1)
  })

  it('monta as nove colunas da aba, com o telefone filtrável pelos dígitos', () => {
    const cols = customerColumns({ stage: () => 'Proposta', floor: () => 'FoodWise' })
    expect(cols.map((c) => c.label)).toEqual([
      'Cliente',
      'Empresa',
      'Telefone',
      'Etiquetas',
      'Etapa',
      'Último contato',
      'Próximo passo',
      'Responsável',
      'Andar',
    ])
    const c = customer({ lastContactAt: T0, nextStep: 'Ligar', nextStepOn: '2026-11-21', owner: 'Allef', tags: ['site', 'loja'] })
    const text = Object.fromEntries(cols.map((col) => [col.id, col.text(c)]))
    expect(text).toMatchObject({
      name: 'Maria Souza',
      phone: '+55 11 98765-4321',
      tags: 'site, loja',
      stage: 'Proposta',
      lastContact: '17/11/2026',
      nextStep: 'Ligar · 21/11/2026',
      owner: 'Allef',
      floor: 'FoodWise',
    })
    expect(filterRows([c], cols, { phone: '98765' })).toHaveLength(1)
    expect(filterRows([c], cols, { phone: '987654321' })).toHaveLength(1)
    const last = cols.find((col) => col.id === 'lastContact')!
    expect(last.firstDir).toBe('desc')
    expect(sortRows([customer({ id: 'x' }), c], last, 'desc')[0]).toBe(c)
  })

  it('devolve o cliente como o formulário manda de volta', () => {
    const c = customer({
      consent: { service: true, billing: false, offers: true, offersAt: T0, offersSource: 'site', optOutAt: undefined },
    })
    const d = customerToDraft(c)
    expect(d).toMatchObject({
      id: 'c1',
      name: 'Maria Souza',
      phones: ['5511987654321'],
      consent: { service: true, billing: false, offers: true, offersSource: 'site' },
    })
    expect(d.phones).not.toBe(c.phones)
  })

  it('separa etiquetas sem repetir nem passar do limite', () => {
    expect(splitList(' site, Loja ; site,  , loja')).toEqual(['site', 'Loja'])
    expect(splitList('a,b,c', 2)).toEqual(['a', 'b'])
    expect(splitList('abcdef', 5, 3)).toEqual(['abc'])
  })

  it('leva o erro do main para o campo certo', () => {
    expect(fieldOfError('Esse telefone já é de Maria Souza.')).toBe('phones')
    expect(fieldOfError('E-mail inválido.')).toBe('email')
    expect(fieldOfError('O valor passa do limite.')).toBe('amount')
    expect(fieldOfError('Escolha o vencimento.')).toBe('due')
    expect(fieldOfError('Esse cliente não existe mais.')).toBe('customer')
    expect(fieldOfError('Escreva o nome do cliente.')).toBe('name')
    expect(fieldOfError('Disco cheio.')).toBeNull()
  })

  it('mostra as permissões: ofertas com a origem, e quem pediu para sair com a data', () => {
    const on = consentLines({ service: true, billing: false, offers: true, offersAt: T0, offersSource: 'formulário do site' })
    expect(on.map((l) => [l.label, l.on])).toEqual([
      ['Atendimento', true],
      ['Cobrança', false],
      ['Ofertas', true],
    ])
    expect(on[2].detail).toBe('aceitou em 17/11/2026 · formulário do site')
    expect(consentLines({ service: true, billing: true, offers: true })[2].detail).toBe('aceitou · origem não registrada')
    const out = consentLines({ service: true, billing: true, offers: true, optOutAt: T0 })[2]
    expect(out).toMatchObject({ on: false, optedOut: true, detail: 'pediu para sair em 17/11/2026' })
    expect(consentLines({ service: false, billing: true, offers: false })[2].detail).toBe('não aceitou')
  })

  it('diz quem fez', () => {
    expect(authorLabel({ kind: 'player' })).toBe('Você')
    expect(authorLabel({ kind: 'system' })).toBe('O app')
    expect(authorLabel({ kind: 'bot', botId: 'b1' }, (id) => (id === 'b1' ? 'Cobrador' : undefined))).toBe('Cobrador')
    expect(authorLabel({ kind: 'bot', botId: 'b2' })).toBe('Bot removido')
  })

  it('a linha do tempo junta notas, etapas e pagamentos, do mais novo ao mais velho', () => {
    const c = customer({ notes: [{ id: 'n1', t: T0 - 2 * DAY, text: 'Pediu orçamento', by: { kind: 'player' } }] })
    const d = deal({
      history: [
        { t: T0 - 10 * DAY, to: 'novo', by: { kind: 'player' } },
        { t: T0 - DAY, from: 'novo', to: 'proposta', by: { kind: 'bot', botId: 'b1' } },
      ],
    })
    const paid = payment({ id: 'p2', state: 'paid', paidOn: '2026-11-15', recurrenceId: 'r1', createdAt: T0 - 20 * DAY })
    const other = payment({ id: 'p3', customerId: 'c2' })
    const tl = customerTimeline(c, [d], [paid, other], [DEFAULT_PIPELINE], () => 'Vendedor')
    expect(tl.map((e) => e.kind)).toEqual(['stage', 'paid', 'note', 'stage', 'payment', 'created'])
    expect(tl[0]).toMatchObject({ text: 'Site institucional: Novo → Proposta', by: 'Vendedor' })
    expect(tl[1].text).toBe('Pagou a fatura 2026-11-001 · R$ 480,00')
    expect(tl[3].text).toBe('Site institucional: entrou em Novo')
    expect(tl[4]).toMatchObject({ by: 'O app', text: 'Fatura 2026-11-001 · R$ 480,00 · vence 20/11/2026' })
    expect(tl[5].text).toBe('Cliente cadastrado à mão')
  })

  it('o aviso de apagar diz o que vai junto', () => {
    const c = customer({ notes: [{ id: 'n', t: 0, text: 'x', by: { kind: 'player' } }] })
    const text = deleteCustomerText(c, {
      deals: [deal(), deal({ id: 'd2' }), deal({ id: 'd3', customerId: 'c2' })],
      payments: [payment()],
      recurrences: [],
    })
    expect(text).toContain('Maria Souza · Padaria Trigo sai do CRM.')
    expect(text).toContain('Vão junto: 2 negócios, 1 pagamento e 1 nota.')
    expect(text).toContain('exporte os dados antes')
    expect(deleteCustomerText(customer(), { deals: [], payments: [], recurrences: [] })).toContain(
      'Ele não tem negócios, pagamentos nem notas.',
    )
  })

  it('junta uma lista em português', () => {
    expect(joinPt([])).toBe('')
    expect(joinPt(['a'])).toBe('a')
    expect(joinPt(['a', 'b', 'c'])).toBe('a, b e c')
  })
})

describe('importação de CSV', () => {
  const rows: CustomerImportRow[] = [
    { line: 1, draft: { name: 'Ana' } },
    { line: 2, draft: { name: 'Bia' }, conflictWith: 'c1' },
    { line: 3, draft: { name: '' }, error: 'Linha sem nome.' },
    { line: 4, draft: { name: 'Caio' }, conflictWith: 'c2' },
  ]

  it('conta os novos, os conflitos e os erros', () => {
    expect(importStats(rows)).toEqual({ fresh: 1, conflicts: 2, errors: 1 })
  })

  it('deixa de fora as linhas com erro e pula conflito sem escolha', () => {
    const out = importRequest(rows, new Map([[4, 'update' as const]]))
    expect(out).toEqual([
      { draft: { name: 'Ana' } },
      { draft: { name: 'Bia' }, onConflict: 'skip' },
      { draft: { name: 'Caio' }, onConflict: 'update' },
    ])
  })

  it('o botão diz o que vai acontecer', () => {
    expect(importButtonLabel(rows, new Map([[4, 'update']]))).toBe('Importar 1 cliente e atualizar 1')
    expect(importButtonLabel(rows.slice(1, 3), new Map())).toBe('Nada para importar')
    expect(importButtonLabel([rows[1]], new Map([[2, 'update']]))).toBe('Atualizar 1')
  })
})

describe('negócios', () => {
  it('monta uma coluna por etapa, pela ordem, com a soma', () => {
    const cols = boardColumns(DEFAULT_PIPELINE, [
      deal({ id: 'a', order: 2 }),
      deal({ id: 'b', order: 1, valueCents: 100 }),
      deal({ id: 'c', stageId: 'novo' }),
      deal({ id: 'x', pipelineId: 'outro' }),
    ])
    expect(cols.map((c) => c.stage.id)).toEqual(['novo', 'conversando', 'proposta', 'fechado', 'perdido'])
    expect(cols[2].deals.map((d) => d.id)).toEqual(['b', 'a'])
    expect(cols[2].totalCents).toBe(480_100)
    expect(cols[0].deals.map((d) => d.id)).toEqual(['c'])
  })

  it('acha a etapa ao lado, ou nada na ponta', () => {
    expect(neighborStage(DEFAULT_PIPELINE, 'novo', 1)?.id).toBe('conversando')
    expect(neighborStage(DEFAULT_PIPELINE, 'novo', -1)).toBeNull()
    expect(neighborStage(DEFAULT_PIPELINE, 'perdido', 1)).toBeNull()
    expect(neighborStage(DEFAULT_PIPELINE, 'sumiu', 1)).toBeNull()
  })

  it('filtra por cliente ou serviço, sem acento', () => {
    const c = customer()
    const list = [deal({ id: 'a' }), deal({ id: 'b', title: 'Manutenção', customerId: 'c2' })]
    const find = (id: string) => (id === 'c1' ? c : undefined)
    expect(filterDeals(list, 'padaria', find).map((d) => d.id)).toEqual(['a'])
    expect(filterDeals(list, 'manutencao', find).map((d) => d.id)).toEqual(['b'])
    expect(filterDeals(list, '', find)).toHaveLength(2)
  })

  it('o cartão diz tudo para o leitor de tela', () => {
    expect(dealCardLabel(deal({ nextStep: 'Ligar' }), customer(), 'Proposta', T0)).toBe(
      'Maria Souza · Padaria Trigo: Site institucional. R$ 4.800,00. Proposta, 3 dias na etapa. próximo passo: Ligar',
    )
    expect(dealCardLabel(deal({ stageAt: T0 }), undefined, 'Novo', T0)).toBe(
      'Cliente removido: Site institucional. R$ 4.800,00. Novo, hoje na etapa',
    )
  })

  it('devolve o negócio como o formulário manda', () => {
    const d = deal({ tickets: ['t1'], floor: 'fw' })
    expect(dealToDraft(d)).toMatchObject({
      id: 'd1',
      customerId: 'c1',
      title: 'Site institucional',
      valueCents: 480_000,
      stageId: 'proposta',
      floor: 'fw',
      tickets: ['t1'],
    })
    expect(dealToDraft(d).tickets).not.toBe(d.tickets)
  })

  it('"Criar ticket" leva o contexto do negócio e a pasta do andar', () => {
    const t = dealTicketDraft(deal({ nextStep: 'Mandar o layout', nextStepOn: '2026-11-25' }), customer(), 'Proposta', '/proj/fw')
    expect(t.title).toBe('Site institucional · Maria Souza')
    expect(t.cwd).toBe('/proj/fw')
    expect(t.tags).toEqual(['crm'])
    expect(t.dueDate).toBe('2026-11-25')
    expect(t.description).toContain('- Cliente: Maria Souza · Padaria Trigo')
    expect(t.description).toContain('- Valor: R$ 4.800,00')
    expect(t.description).toContain('- Próximo passo: Mandar o layout (até 25/11/2026)')
    const ground = dealTicketDraft(deal(), undefined, 'Novo')
    expect(ground.cwd).toBeUndefined()
    expect(ground.dueDate).toBeNull()
    expect(ground.description).toContain('Cliente removido')
  })
})

describe('pagamentos', () => {
  const today = '2026-11-17'
  const list = [
    payment({ id: 'up', due: '2026-11-20' }),
    payment({ id: 'today', due: today }),
    payment({ id: 'late', due: '2026-11-10' }),
    payment({ id: 'disp', due: '2026-11-01', state: 'disputed' }),
    payment({ id: 'paid', due: '2026-10-20', state: 'paid', paidOn: '2026-10-18' }),
    payment({ id: 'cancel', state: 'canceled' }),
  ]

  it('separa Próximos, Atrasados, Histórico e Todos', () => {
    expect(paymentsIn(list, 'upcoming', today).map((p) => p.id)).toEqual(['up', 'today'])
    expect(paymentsIn(list, 'overdue', today).map((p) => p.id)).toEqual(['late', 'disp'])
    expect(paymentsIn(list, 'history', today).map((p) => p.id)).toEqual(['paid', 'cancel'])
    expect(paymentsIn(list, 'all', today)).toHaveLength(6)
    expect(paymentTabCounts(list, today)).toEqual({ upcoming: 2, overdue: 2, history: 2, all: 6 })
  })

  it('pagar tira de Próximos e põe no Histórico', () => {
    const p = payment({ due: '2026-11-20' })
    expect(paymentsIn([p], 'upcoming', today)).toHaveLength(1)
    const paid = { ...p, state: 'paid' as const, paidOn: today }
    expect(paymentsIn([paid], 'upcoming', today)).toHaveLength(0)
    expect(paymentsIn([paid], 'history', today)).toHaveLength(1)
    expect(paymentStateText(paid, today)).toBe('Pago em 17/11/2026')
  })

  it('cada aba abre ordenada do seu jeito', () => {
    expect(defaultPaymentSort('upcoming')).toEqual({ col: 'due', dir: 'asc' })
    expect(defaultPaymentSort('overdue')).toEqual({ col: 'due', dir: 'asc' })
    expect(defaultPaymentSort('history')).toEqual({ col: 'due', dir: 'desc' })
    expect(defaultPaymentSort('all')).toEqual({ col: 'due', dir: 'desc' })
    expect(isPaymentTab('overdue')).toBe(true)
    expect(isPaymentTab('sumiu')).toBe(false)
  })

  it('o estado diz atrasado, aberto, cancelado', () => {
    expect(paymentStateText(list[2], today)).toBe('Atrasado')
    expect(paymentStateText(list[0], today)).toBe('Aberto')
    expect(paymentStateText(list[5], today)).toBe('Cancelado')
    expect(paymentStateText(list[3], today)).toBe('Em disputa')
  })

  it('monta as oito colunas e soma o valor', () => {
    const c = customer()
    const cols = paymentColumns({ customer: (id) => (id === 'c1' ? c : undefined), today: () => today })
    expect(cols.map((col) => col.label)).toEqual([
      'Cliente',
      'Fatura',
      'Valor',
      'Vencimento',
      'Referente a',
      'Método',
      'Responsável',
      'Estado',
    ])
    const text = Object.fromEntries(cols.map((col) => [col.id, col.text(list[2])]))
    expect(text).toMatchObject({
      customer: 'Maria Souza · Padaria Trigo',
      amount: 'R$ 480,00',
      due: '10/11/2026',
      method: 'PIX',
      state: 'Atrasado',
    })
    expect(cols[0].text(payment({ customerId: 'sumiu' }))).toBe('Cliente removido')
    const amount = cols.find((col) => col.id === 'amount')!
    expect(sumColumn(list, amount)).toBe(6 * 48_000)
    expect(sortRows([payment({ id: 'a', amountCents: 5 }), payment({ id: 'b', amountCents: 50 })], amount, 'desc')[0].id).toBe('b')
  })

  it('escreve a recorrência numa frase', () => {
    expect(recurrenceLabel(recurrence())).toBe('Todo dia 20 · R$ 480,00 · Manutenção · desde novembro/2026')
    expect(recurrenceLabel(recurrence({ end: '2027-03' }))).toBe('Todo dia 20 · R$ 480,00 · Manutenção · de novembro/2026 a março/2027')
  })

  it('confere o novo pagamento antes de mandar ao main', () => {
    const ok = { customerId: 'c1', amountCents: 48_000, due: '2026-11-20', reference: 'Manutenção' }
    expect(paymentDraftError(ok)).toBeNull()
    expect(paymentDraftError({ ...ok, customerId: '' })?.field).toBe('customer')
    expect(paymentDraftError({ ...ok, amountCents: 0 })?.field).toBe('amount')
    expect(paymentDraftError({ ...ok, amountCents: 10_000_000_001 })?.field).toBe('amount')
    expect(paymentDraftError({ ...ok, due: '2026-02-30' })?.field).toBe('due')
    expect(paymentDraftError({ ...ok, reference: ' ' })?.field).toBe('reference')
  })

  it('confere a recorrência antes de mandar ao main', () => {
    const ok = { customerId: 'c1', amountCents: 48_000, day: 20, reference: 'Manutenção', start: '2026-11' }
    expect(recurrenceDraftError(ok)).toBeNull()
    expect(recurrenceDraftError({ ...ok, end: '2027-01' })).toBeNull()
    expect(recurrenceDraftError({ ...ok, customerId: undefined })?.field).toBe('customer')
    expect(recurrenceDraftError({ ...ok, amountCents: -1 })?.field).toBe('amount')
    expect(recurrenceDraftError({ ...ok, amountCents: 10_000_000_001 })?.field).toBe('amount')
    expect(recurrenceDraftError({ ...ok, day: 0 })?.field).toBe('day')
    expect(recurrenceDraftError({ ...ok, day: 32 })?.field).toBe('day')
    expect(recurrenceDraftError({ ...ok, day: 2.5 })?.field).toBe('day')
    expect(recurrenceDraftError({ ...ok, reference: '' })?.field).toBe('reference')
    expect(recurrenceDraftError({ ...ok, start: '2026-13' })?.field).toBe('start')
    expect(recurrenceDraftError({ ...ok, end: '2026-10' })?.field).toBe('end')
  })
})
