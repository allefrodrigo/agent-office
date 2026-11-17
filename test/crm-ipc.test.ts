process.env.TZ = 'America/Sao_Paulo'

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CRM_LIMITS, DEFAULT_PIPELINE, type Customer, type OfficeEvent } from '@shared/types'

// Electron: the handlers land in a map; the dialogs answer with the path the test chose.
const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...args: unknown[]) => unknown>(),
  save: null as string | null,
  open: null as string | null,
  saveOpts: [] as { defaultPath?: string }[],
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => h.handlers.set(channel, fn) },
  app: { getPath: () => '/docs' },
  dialog: {
    showSaveDialog: async (opts: { defaultPath?: string }) => {
      h.saveOpts.push(opts)
      return h.save ? { canceled: false, filePath: h.save } : { canceled: true, filePath: '' }
    },
    showOpenDialog: async () => (h.open ? { canceled: false, filePaths: [h.open] } : { canceled: true, filePaths: [] }),
  },
}))

const { CrmStore } = await import('../src/main/crm/store')
const { crmHandlers, registerCrmIpc } = await import('../src/main/ipc/crm')
const { log } = await import('../src/main/log')

const CHANNELS = [
  'crmList',
  'saveCustomer',
  'deleteCustomer',
  'addCrmNote',
  'saveDeal',
  'moveDeal',
  'deleteDeal',
  'savePipeline',
  'savePayment',
  'markPaid',
  'deletePayment',
  'saveRecurrence',
  'deleteRecurrence',
  'crmSearch',
  'exportCrmCsv',
  'pickCustomersCsv',
  'importCustomersCsv',
  'exportCustomerData',
  'saveCrmSettings',
].map((n) => `office:${n}`)

let dir: string
let store: InstanceType<typeof CrmStore>
let events: OfficeEvent[]
let api: ReturnType<typeof registerCrmIpc>
const unix = process.platform !== 'win32'
const mode = (p: string) => statSync(p).mode & 0o777
/** Calls a handler as the renderer would: a throw becomes a rejected promise. */
const call = async (channel: string, ...args: unknown[]): Promise<unknown> => h.handlers.get(`office:${channel}`)!({}, ...args)
const lastDelta = () => (events.at(-1) as Extract<OfficeEvent, { type: 'crm' }>).delta

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 10, 9, 0))
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-ipc-'))
  store = new CrmStore(dir)
  events = []
  h.handlers.clear()
  h.save = null
  h.open = null
  h.saveOpts = []
  const ctx = { crmStore: store, store: { settings: { projects: [{ id: 'p1', name: 'Loja', cwd: '/x' }] } }, broadcast: (e: OfficeEvent) => events.push(e), win: () => null }
  api = registerCrmIpc(ctx as unknown as Parameters<typeof registerCrmIpc>[0])
})
afterEach(() => {
  store.lock()
  vi.useRealTimers()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const newCustomer = async (over: Record<string, unknown> = {}) => (await call('saveCustomer', { name: 'Maria Souza', phones: ['(11) 98765-4321'], ...over })) as Customer

describe('registro', () => {
  it('registra os 19 canais da fase 1, os mesmos de crmHandlers', () => {
    expect([...h.handlers.keys()].sort()).toEqual([...CHANNELS].sort())
    expect(Object.keys(crmHandlers(api)).sort()).toEqual([...CHANNELS].sort())
  })
})

describe('caminho feliz', () => {
  it('cria, lista, move, cobra e busca; cada mudança sai como evento crm só com o que mudou', async () => {
    const c = await newCustomer({ floor: 'p1' })
    expect(c.phones).toEqual(['5511987654321'])
    expect(lastDelta()).toEqual({ customers: [c] })
    const d = (await call('saveDeal', { customerId: c.id, title: 'Site', valueCents: 480_000 })) as { id: string }
    const moved = (await call('moveDeal', d.id, 'fechado', null)) as { closedAt?: number }
    expect(moved.closedAt).toBe(Date.now())
    const p = (await call('savePayment', { customerId: c.id, dealId: d.id, amountCents: 48_000, due: '2026-11-20', reference: 'Sinal' })) as { id: string; invoice: string }
    expect(p.invoice).toBe('2026-11-001')
    expect(await call('markPaid', p.id, '2026-11-10')).toMatchObject({ state: 'paid', paidOn: '2026-11-10' })
    const note = (await call('addCrmNote', c.id, '  Prefere\r\nWhatsApp.  ')) as Customer
    expect(note.notes.at(-1)).toMatchObject({ text: 'Prefere\nWhatsApp.', by: { kind: 'player' } })
    const list = (await call('crmList')) as { customers: unknown[]; deals: unknown[]; payments: unknown[] }
    expect([list.customers.length, list.deals.length, list.payments.length]).toEqual([1, 1, 1])
    const hits = (await call('crmSearch', 'maria')) as { kind: string }[]
    expect(hits[0]).toMatchObject({ kind: 'customer' })
    expect(events.every((e) => e.type === 'crm')).toBe(true)
  })

  it('a recorrência roda uma vez por dia local, pelo tick', async () => {
    const c = await newCustomer()
    await call('saveRecurrence', { customerId: c.id, amountCents: 9_000, day: 20, reference: 'Manutenção', start: '2026-12' })
    expect(store.payments).toHaveLength(0)
    api.tick()
    expect(store.payments).toHaveLength(0)
    vi.setSystemTime(new Date(2026, 11, 10, 8, 0))
    const before = events.length
    api.tick()
    expect(store.payments.map((p) => p.reference)).toEqual(['Manutenção · dezembro/2026'])
    expect(events).toHaveLength(before + 1)
    api.tick()
    expect(events).toHaveLength(before + 1)
  })
})

describe('cada handler recusa argumento ruim', () => {
  let c: Customer
  let dealId: string
  let paymentId: string
  beforeEach(async () => {
    c = await newCustomer()
    dealId = ((await call('saveDeal', { customerId: c.id, title: 'Site' })) as { id: string }).id
    paymentId = ((await call('savePayment', { customerId: c.id, amountCents: 100, due: '2026-12-01', reference: 'x' })) as { id: string }).id
    events = []
  })
  afterEach(() => {
    // nothing refused may change the data or reach the screen
    expect(events).toEqual([])
  })

  it('saveCustomer', async () => {
    const msg = 'Cliente inválido. Feche e abra o formulário de novo.'
    await expect(call('saveCustomer', null)).rejects.toThrow(msg)
    await expect(call('saveCustomer', { name: 5 })).rejects.toThrow(msg)
    await expect(call('saveCustomer', { name: 'X', phones: '11987654321' })).rejects.toThrow(msg)
    await expect(call('saveCustomer', { id: 'sumiu', name: 'X' })).rejects.toThrow('Esse cliente não existe mais.')
    await expect(call('saveCustomer', { id: '../x', name: 'X' })).rejects.toThrow('Esse item não existe mais.')
    await expect(call('saveCustomer', { name: 'x'.repeat(CRM_LIMITS.name + 1) })).rejects.toThrow('O nome passa de 120 letras. Encurte o texto.')
    await expect(call('saveCustomer', { name: '   ' })).rejects.toThrow('Dê um nome ao cliente.')
    await expect(call('saveCustomer', { name: 'X', nextStepOn: '2026-02-30' })).rejects.toThrow('Data do próximo passo inválida')
    await expect(call('saveCustomer', { name: 'X', lastContactAt: -1 })).rejects.toThrow('Data do último contato inválida.')
    await expect(call('saveCustomer', { name: 'X', email: 'maria@' })).rejects.toThrow('E-mail inválido')
    await expect(call('saveCustomer', { name: 'X', phones: ['abc 4321'] })).rejects.toThrow('O telefone terminado em 4321 não parece válido')
    await expect(call('saveCustomer', { name: 'X', floor: 'p9' })).rejects.toThrow('Esse andar não existe mais')
    await expect(call('saveCustomer', { name: 'X', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).rejects.toThrow('Até 20 etiquetas')
    await expect(call('saveCustomer', { name: 'X', phones: ['11987654321'] })).rejects.toThrow('Esse telefone já é de Maria Souza.')
  })

  it('deleteCustomer', async () => {
    await expect(call('deleteCustomer', 42)).rejects.toThrow('Esse cliente não existe mais.')
    await expect(call('deleteCustomer', '../../etc')).rejects.toThrow('Esse cliente não existe mais.')
    await expect(call('deleteCustomer', 'sumiu')).rejects.toThrow('Esse cliente não existe mais.')
  })

  it('addCrmNote', async () => {
    await expect(call('addCrmNote', c.id, 5)).rejects.toThrow('Nota inválida.')
    await expect(call('addCrmNote', c.id, 'x'.repeat(CRM_LIMITS.note + 1))).rejects.toThrow('A nota passa de 4.000 letras. Encurte o texto.')
    await expect(call('addCrmNote', c.id, ' \n ')).rejects.toThrow('Escreva a nota antes de salvar.')
    await expect(call('addCrmNote', 'sumiu', 'oi')).rejects.toThrow('Esse cliente não existe mais.')
    await expect(call('addCrmNote', { id: c.id }, 'oi')).rejects.toThrow('Esse cliente não existe mais.')
  })

  it('saveDeal', async () => {
    const deal = (over: Record<string, unknown>) => call('saveDeal', { customerId: c.id, title: 'Site', ...over })
    await expect(call('saveDeal', 'site')).rejects.toThrow('Negócio inválido. Feche e abra o formulário de novo.')
    await expect(deal({ valueCents: '100' })).rejects.toThrow('Negócio inválido.')
    await expect(deal({ valueCents: -1 })).rejects.toThrow('O valor não pode ser negativo.')
    await expect(deal({ valueCents: 1.5 })).rejects.toThrow('Valor inválido. Digite o valor em reais')
    await expect(deal({ valueCents: CRM_LIMITS.amountCents + 1 })).rejects.toThrow('O valor passa do limite de R$ 100 milhões.')
    await expect(deal({ title: 'x'.repeat(CRM_LIMITS.title + 1) })).rejects.toThrow('O nome do negócio passa de 120 letras.')
    await expect(deal({ nextStepOn: '2026-13-01' })).rejects.toThrow('Data do próximo passo inválida')
    await expect(deal({ customerId: 'sumiu' })).rejects.toThrow('Esse cliente não existe mais. Escolha outro.')
    await expect(deal({ id: 'sumiu' })).rejects.toThrow('Esse negócio não existe mais.')
    await expect(deal({ stageId: 'nao-existe' })).rejects.toThrow('Essa etapa não existe mais')
    await expect(deal({ floor: 'p9' })).rejects.toThrow('Esse andar não existe mais')
  })

  it('moveDeal', async () => {
    await expect(call('moveDeal', 5, 'novo')).rejects.toThrow('Esse negócio não existe mais.')
    await expect(call('moveDeal', 'sumiu', 'novo')).rejects.toThrow('Esse negócio não existe mais.')
    await expect(call('moveDeal', dealId, '../novo')).rejects.toThrow('Essa etapa não existe mais nesse funil.')
    await expect(call('moveDeal', dealId, 'nao-existe')).rejects.toThrow('Essa etapa não existe mais nesse funil.')
    await expect(call('moveDeal', dealId, 'novo', 7)).rejects.toThrow('Posição inválida no quadro.')
  })

  it('deleteDeal, deletePayment e deleteRecurrence', async () => {
    await expect(call('deleteDeal', null)).rejects.toThrow('Esse negócio não existe mais.')
    await expect(call('deleteDeal', 'sumiu')).rejects.toThrow('Esse negócio não existe mais.')
    await expect(call('deletePayment', {})).rejects.toThrow('Esse pagamento não existe mais.')
    await expect(call('deletePayment', 'sumiu')).rejects.toThrow('Esse pagamento não existe mais.')
    await expect(call('deleteRecurrence', [])).rejects.toThrow('Essa recorrência não existe mais.')
    await expect(call('deleteRecurrence', 'sumiu')).rejects.toThrow('Essa recorrência não existe mais.')
  })

  it('savePipeline', async () => {
    const stages = DEFAULT_PIPELINE.stages
    await expect(call('savePipeline', 'padrao')).rejects.toThrow('Funil inválido. Feche e abra o formulário de novo.')
    await expect(call('savePipeline', { ...DEFAULT_PIPELINE, stages: stages.filter((s) => s.kind !== 'won') })).rejects.toThrow('O funil precisa de uma etapa de ganho, como "Fechado".')
    await expect(call('savePipeline', { ...DEFAULT_PIPELINE, stages: stages.filter((s) => s.kind !== 'lost') })).rejects.toThrow('O funil precisa de uma etapa de perda')
    await expect(call('savePipeline', { ...DEFAULT_PIPELINE, stages: [{ ...stages[0], name: 'x'.repeat(31) }, ...stages.slice(1)] })).rejects.toThrow('O nome da etapa passa de 30 letras.')
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, name: `Etapa ${i}`, kind: 'open' }))
    await expect(call('savePipeline', { ...DEFAULT_PIPELINE, stages: [...many, ...stages.slice(-2)] })).rejects.toThrow('Até 12 etapas por funil.')
    await expect(call('savePipeline', { ...DEFAULT_PIPELINE, stages: [...stages, stages[0]] })).rejects.toThrow('Duas etapas com o mesmo id.')
    await expect(call('savePipeline', { ...DEFAULT_PIPELINE, stages: stages.filter((s) => s.id !== 'novo') })).rejects.toThrow('A etapa "Novo" tem 1 negócio.')
  })

  it('savePayment', async () => {
    const pay = (over: Record<string, unknown>) => call('savePayment', { customerId: c.id, amountCents: 100, due: '2026-12-01', reference: 'x', ...over })
    await expect(call('savePayment', 100)).rejects.toThrow('Pagamento inválido. Feche e abra o formulário de novo.')
    await expect(pay({ method: 'cheque' })).rejects.toThrow('Pagamento inválido.')
    await expect(pay({ state: 'paid' })).rejects.toThrow('Pagamento inválido.')
    await expect(pay({ amountCents: -100 })).rejects.toThrow('O valor não pode ser negativo.')
    await expect(pay({ amountCents: 0 })).rejects.toThrow('Informe um valor maior que zero.')
    await expect(pay({ due: '2026-02-30' })).rejects.toThrow('Vencimento inválido. Use uma data do calendário.')
    await expect(pay({ due: '01/12/2026' })).rejects.toThrow('Vencimento inválido.')
    await expect(pay({ reference: 'x'.repeat(CRM_LIMITS.reference + 1) })).rejects.toThrow('O "referente a" passa de 120 letras.')
    await expect(pay({ customerId: 'sumiu' })).rejects.toThrow('Esse cliente não existe mais. Escolha outro.')
    await expect(pay({ id: 'sumiu' })).rejects.toThrow('Esse pagamento não existe mais.')
    await expect(pay({ dealId: 'sumiu' })).rejects.toThrow('Esse negócio não existe mais.')
  })

  it('markPaid', async () => {
    await expect(call('markPaid', 1, '2026-11-10')).rejects.toThrow('Esse pagamento não existe mais.')
    await expect(call('markPaid', 'sumiu', '2026-11-10')).rejects.toThrow('Esse pagamento não existe mais.')
    await expect(call('markPaid', paymentId, '2026-11-31')).rejects.toThrow('Data do pagamento inválida. Use uma data do calendário.')
    await expect(call('markPaid', paymentId, 20261110)).rejects.toThrow('Data do pagamento inválida.')
    await expect(call('markPaid', paymentId, '2026-11-11')).rejects.toThrow('A data do pagamento não pode ser depois de hoje.')
  })

  it('saveRecurrence', async () => {
    const rec = (over: Record<string, unknown>) => call('saveRecurrence', { customerId: c.id, amountCents: 100, day: 20, reference: 'Manutenção', start: '2026-12', ...over })
    await expect(call('saveRecurrence', [])).rejects.toThrow('Recorrência inválida. Feche e abra o formulário de novo.')
    await expect(rec({ day: '20' })).rejects.toThrow('Recorrência inválida.')
    for (const day of [0, 32, 1.5]) await expect(rec({ day })).rejects.toThrow('O dia vai de 1 a 31.')
    await expect(rec({ amountCents: -1 })).rejects.toThrow('O valor não pode ser negativo.')
    await expect(rec({ start: '2026-13' })).rejects.toThrow('Mês de início inválido. Use AAAA-MM.')
    await expect(rec({ end: '2026-11' })).rejects.toThrow('O mês final vem antes do início. Confira as datas.')
    await expect(rec({ reference: ' ' })).rejects.toThrow('Diga a que se refere')
    await expect(rec({ customerId: 'sumiu' })).rejects.toThrow('Esse cliente não existe mais. Escolha outro.')
    await expect(rec({ id: 'sumiu' })).rejects.toThrow('Essa recorrência não existe mais.')
  })

  it('crmSearch', async () => {
    await expect(call('crmSearch', 5)).rejects.toThrow('Busca inválida.')
    await expect(call('crmSearch', 'x'.repeat(CRM_LIMITS.query + 1))).rejects.toThrow('Busca grande demais. Use menos palavras.')
  })

  it('exportCrmCsv', async () => {
    await expect(call('exportCrmCsv', 'clientes', [c.id])).rejects.toThrow('Tipo de exportação inválido.')
    await expect(call('exportCrmCsv', 'customers', c.id)).rejects.toThrow('Lista inválida para exportar.')
    await expect(call('exportCrmCsv', 'customers', ['../x'])).rejects.toThrow('Item inválido na exportação.')
    await expect(call('exportCrmCsv', 'customers', [])).rejects.toThrow('Nada para exportar: o filtro está vazio.')
    expect(h.saveOpts).toEqual([])
  })

  it('importCustomersCsv', async () => {
    await expect(call('importCustomersCsv', 'linhas')).rejects.toThrow('Importação inválida. Escolha o arquivo de novo.')
    await expect(call('importCustomersCsv', [{ draft: {}, onConflict: 'merge' }])).rejects.toThrow('Importação inválida.')
    const tooMany = Array.from({ length: CRM_LIMITS.csvRows + 1 }, () => ({ draft: { name: 'X' } }))
    await expect(call('importCustomersCsv', tooMany)).rejects.toThrow('A importação vai até 5.000 clientes por vez.')
  })

  it('exportCustomerData', async () => {
    await expect(call('exportCustomerData', 5)).rejects.toThrow('Esse cliente não existe mais.')
    await expect(call('exportCustomerData', 'sumiu')).rejects.toThrow('Esse cliente não existe mais. Ele pode ter sido apagado em outra janela.')
    expect(h.saveOpts).toEqual([])
  })

  it('saveCrmSettings', async () => {
    await expect(call('saveCrmSettings', 'ensaio')).rejects.toThrow('Configurações inválidas. Feche e abra a tela de novo.')
    await expect(call('saveCrmSettings', null)).rejects.toThrow('Configurações inválidas.')
    await expect(call('saveCrmSettings', [])).rejects.toThrow('Configurações inválidas.')
  })
})

describe('regras: valores ruins não passam', () => {
  it('saveCrmSettings guarda o atual quando o campo é ruim e prende o número na faixa', async () => {
    const out = (await call('saveCrmSettings', { rehearsal: 'não', recurrenceLeadDays: -5, maxDiscountPct: 500, allowedLinks: ['https://MeuSite.com.br/promo'], evil: 1 })) as Record<string, unknown>
    expect(out).toMatchObject({ rehearsal: true, recurrenceLeadDays: 0, maxDiscountPct: 100, allowedLinks: ['meusite.com.br'] })
    expect(out).not.toHaveProperty('evil')
    expect(lastDelta()).toEqual({ settings: out })
  })

  it('caracteres de controle e de direção do texto saem dos nomes, das notas e das regras', async () => {
    const c = await newCustomer({ name: 'Maria\u0000\u0007 \u202Eodagap', company: '\u2066Padaria\u2069  Trigo', tags: ['\u202Dvip'] })
    expect(c).toMatchObject({ name: 'Maria odagap', company: 'Padaria Trigo', tags: ['vip'] })
    await call('addCrmNote', c.id, 'linha 1\u202E\nlinha\u0000 2')
    expect(store.customer(c.id)?.notes[0].text).toBe('linha 1\nlinha 2')
    const out = (await call('saveCrmSettings', { company: 'Ag\u202Eência', signature: 'Equipe\u0000\nAgência', payment: { ...store.settings.payment, payee: 'Fulano\u2067' } })) as {
      company: string
      signature: string
      payment: { payee: string }
    }
    expect(out).toMatchObject({ company: 'Agência', signature: 'Equipe\nAgência', payment: { payee: 'Fulano' } })
  })
})

describe('exportar e importar', () => {
  it('exportCrmCsv grava 0600 no caminho do diálogo, na ordem dos ids; cancelar não grava', async () => {
    const a = await newCustomer()
    const b = await newCustomer({ name: '=HYPERLINK("x")', phones: [] })
    const out = join(dir, 'clientes.csv')
    expect(await call('exportCrmCsv', 'customers', [b.id, 'sumiu', a.id])).toBeNull()
    expect(h.saveOpts[0].defaultPath).toBe(join('/docs', 'clientes-2026-11-10.csv'))
    h.save = out
    expect(await call('exportCrmCsv', 'customers', [b.id, 'sumiu', a.id])).toBe(out)
    const csv = readFileSync(out, 'utf8')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\r\n')
    expect(lines).toHaveLength(4)
    expect(lines[1].startsWith(`"'=HYPERLINK`)).toBe(true)
    expect(lines[2]).toContain('Maria Souza;')
    expect(lines[2]).toContain(';55 11 98765-4321;')
    if (unix) expect(mode(out)).toBe(0o600)
  })

  it('exportCrmCsv de negócios e pagamentos: cliente, etapa, valor formatado e estado', async () => {
    const c = await newCustomer({ company: 'Padaria Trigo' })
    const d = (await call('saveDeal', { customerId: c.id, title: 'Site', valueCents: 480_000, floor: 'p1', nextStepOn: '2026-11-20' })) as { id: string }
    await call('moveDeal', d.id, 'fechado')
    const p = (await call('savePayment', { customerId: c.id, amountCents: 123_456, due: '2026-11-05', reference: 'Sinal', method: 'boleto' })) as { id: string }
    h.save = join(dir, 'negocios.csv')
    await call('exportCrmCsv', 'deals', [d.id])
    expect(h.saveOpts[0].defaultPath).toBe(join('/docs', 'negocios-2026-11-10.csv'))
    const deals = readFileSync(h.save, 'utf8').slice(1).split('\r\n')
    expect(deals[0]).toBe('Cliente;Empresa;Negócio;Valor;Funil;Etapa;Dias na etapa;Próximo passo;Data do próximo passo;Andar;Criado em;Fechado em')
    expect(deals[1]).toBe('Maria Souza;Padaria Trigo;Site;"4.800,00";Vendas;Fechado;0;;20/11/2026;Loja;10/11/2026;10/11/2026')
    h.save = join(dir, 'pagamentos.csv')
    await call('exportCrmCsv', 'payments', [p.id])
    const pays = readFileSync(h.save, 'utf8').slice(1).split('\r\n')
    expect(pays[0]).toBe('Fatura;Cliente;Empresa;Valor;Vencimento;Referente a;Método;Responsável;Estado;Pago em')
    expect(pays[1]).toMatch(/^2026-11-001;Maria Souza;Padaria Trigo;"1\.234,56";05\/11\/2026;Sinal;Boleto;;\p{L}+;$/u)
  })

  it('exportCustomerData grava o JSON do cliente (LGPD) em 0600 com nome seguro', async () => {
    const c = await newCustomer({ name: 'Mária / ../Souza' })
    await call('savePayment', { customerId: c.id, amountCents: 100, due: '2026-12-01', reference: 'x' })
    h.save = join(dir, 'maria.json')
    expect(await call('exportCustomerData', c.id)).toBe(h.save)
    expect(h.saveOpts[0].defaultPath).toBe(join('/docs', 'cliente-maria-souza-2026-11-10.json'))
    const data = JSON.parse(readFileSync(h.save, 'utf8'))
    expect(data).toMatchObject({ format: 'agent-office-crm-cliente', version: 1, customer: { id: c.id }, deals: [], recurrences: [] })
    expect(data.payments).toHaveLength(1)
    if (unix) expect(mode(h.save)).toBe(0o600)
  })

  it('pickCustomersCsv devolve só o nome do arquivo e as linhas, com o conflito marcado', async () => {
    const c = await newCustomer()
    const file = join(dir, 'planilha.csv')
    writeFileSync(file, 'Nome;Telefone;E-mail\r\nJoão;(21) 3456-7890;joao@ex.com\r\nMaria S.;11 98765-4321;\r\n;11 91234-5678;\r\n')
    expect(await call('pickCustomersCsv')).toBeNull()
    h.open = file
    const preview = (await call('pickCustomersCsv')) as { file: string; rows: { draft: { name: string }; error?: string; conflictWith?: string }[] }
    expect(preview.file).toBe('planilha.csv')
    expect(JSON.stringify(preview)).not.toContain(dir)
    expect(preview.rows.map((r) => [r.draft.name, r.conflictWith ?? r.error ?? ''])).toEqual([
      ['João', ''],
      ['Maria S.', c.id],
      ['', 'Linha sem nome: preencha a coluna Nome.'],
    ])
  })

  it('pickCustomersCsv lê a planilha do Excel em latin1', async () => {
    const file = join(dir, 'excel.csv')
    writeFileSync(file, Buffer.from('Nome;Telefone\r\nJoão Conceição;11 98765-0000\r\n', 'latin1'))
    h.open = file
    const preview = (await call('pickCustomersCsv')) as { rows: { draft: { name: string } }[] }
    expect(preview.rows[0].draft.name).toBe('João Conceição')
  })

  it('pickCustomersCsv recusa arquivo grande demais e pasta', async () => {
    const big = join(dir, 'grande.csv')
    writeFileSync(big, Buffer.alloc(CRM_LIMITS.csvBytes + 1, 'a'))
    h.open = big
    await expect(call('pickCustomersCsv')).rejects.toThrow('Esse arquivo passa de 5 MB.')
    const folder = join(dir, 'pasta.csv')
    mkdirSync(folder)
    h.open = folder
    await expect(call('pickCustomersCsv')).rejects.toThrow('Escolha um arquivo CSV, não uma pasta.')
  })

  it('importCustomersCsv revalida cada linha, desliga ofertas, pula conflito por padrão e recarrega a tela', async () => {
    const c = await newCustomer()
    const result = await call('importCustomersCsv', [
      { draft: { name: 'João', phones: ['(21) 3456-7890'], consent: { offers: true } } },
      { draft: { name: 'Maria de novo', phones: ['11987654321'] } },
      { draft: { name: 'x'.repeat(CRM_LIMITS.name + 1) }, onConflict: 'update' },
      { draft: { name: 'Sem telefone bom', phones: ['abc'] } },
      { draft: 'lixo' },
    ])
    expect(result).toEqual({ created: 1, updated: 0, skipped: 4 })
    expect(lastDelta()).toEqual({ reload: true })
    const joao = store.customers.find((x) => x.name === 'João')!
    expect(joao).toMatchObject({ source: 'import', phones: ['552134567890'], consent: { offers: false } })
    expect(store.customer(c.id)?.name).toBe('Maria Souza')
  })
})

describe('logs sem dados do cliente', () => {
  it('telefone recusado: só o telefone mascarado e o id', async () => {
    const info = vi.spyOn(log, 'info')
    const c = await newCustomer()
    await expect(call('saveCustomer', { name: 'Outra', phones: ['11987654321'] })).rejects.toThrow()
    const lines = info.mock.calls.map((a) => a.join(' ')).join('\n')
    expect(lines).toContain(c.id)
    expect(lines).not.toContain('Maria')
    expect(lines).not.toContain('98765-4321')
    expect(lines).not.toContain('5511987654321')
  })

  it('exportação LGPD que falha: mensagem genérica, sem nome nem caminho no erro ou no log', async () => {
    const warn = vi.spyOn(log, 'warn')
    const c = await newCustomer()
    h.save = join(dir, 'nao-existe', 'cliente-maria-souza-2026-11-10.json')
    const err = (await call('exportCustomerData', c.id).catch((e: Error) => e)) as Error
    expect(err.message).toContain('Escolha outra pasta')
    expect(err.message).not.toMatch(/maria|nao-existe/i)
    expect(err.stack ?? '').not.toMatch(/maria/i)
    const lines = warn.mock.calls.map((a) => a.join(' ')).join('\n')
    expect(lines).toContain(c.id)
    expect(lines).toContain('ENOENT')
    expect(lines).not.toMatch(/maria/i)
  })

  it('apagar e importar logam contagens, não nomes', async () => {
    const info = vi.spyOn(log, 'info')
    const c = await newCustomer()
    await call('deleteCustomer', c.id)
    await call('importCustomersCsv', [{ draft: { name: 'Fulano Importado' } }])
    const lines = info.mock.calls.map((a) => a.join(' ')).join('\n')
    expect(lines).toContain('0 negócio(s)')
    expect(lines).toContain('1 criado(s)')
    expect(lines).not.toMatch(/Maria|Fulano/)
  })
})
