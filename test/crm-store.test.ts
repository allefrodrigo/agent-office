process.env.TZ = 'America/Sao_Paulo'

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from 'electron'
import { CRM_APP_DEFAULTS, CRM_DEFAULTS, CRM_LIMITS, DEFAULT_PIPELINE, type Pipeline } from '@shared/types'
import { dueGroup, localDate } from '@shared/crm'
import { CrmStore, loadCrmData, mergeConsent } from '../src/main/crm/store'
import { importSet, sanitizeImportedCrm } from '../src/main/backups'
import { startCrmDemo } from '../src/main/demo'
import { Store } from '../src/main/store'
import { cleanSettings } from '../src/main/validate'

let dir: string
let opened: CrmStore[] = []
let clock = new Date(2026, 10, 10, 9, 0).getTime()
const open = (d = dir) => {
  const s = new CrmStore(d, { now: () => clock })
  opened.push(s)
  return s
}
const mode = (p: string) => statSync(p).mode & 0o777
const unix = process.platform !== 'win32'
const DAY = 86_400_000

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-'))
  clock = new Date(2026, 10, 10, 9, 0).getTime()
})
afterEach(() => {
  for (const s of opened) s.lock()
  opened = []
  rmSync(dir, { recursive: true, force: true })
})

/** A customer with Maria's phone, saved. */
const maria = (s: CrmStore) => s.saveCustomer({ name: 'Maria Souza', company: 'Padaria Trigo', phones: ['5511987654321'], tags: ['site'] }).item

describe('CrmStore: criar e ler de volta', () => {
  it('grava clientes, negócios, pagamentos e recorrências em crm.json 0600 e lê igual', () => {
    const s = open()
    const c = maria(s)
    const d = s.saveDeal({ customerId: c.id, title: 'Site institucional', valueCents: 480_000 }).item
    const p = s.savePayment({ customerId: c.id, dealId: d.id, amountCents: 48_000, due: '2026-11-20', reference: 'Sinal' }).item
    const r = s.saveRecurrence({ customerId: c.id, amountCents: 48_000, day: 20, reference: 'Manutenção', start: '2027-01' }).item
    s.flush()
    const file = join(dir, 'crm.json')
    if (unix) expect(mode(file)).toBe(0o600)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    expect(Object.keys(raw).sort()).toEqual(['customers', 'deals', 'payments', 'pipelines', 'recurrences', 'settings', 'suggestions'])
    const again = open()
    expect(again.customers).toEqual([c])
    expect(again.deals).toEqual([d])
    expect(again.payments).toEqual([p])
    expect(again.recurrences).toEqual([r])
    expect(again.pipelines).toEqual([DEFAULT_PIPELINE])
    expect(again.settings).toEqual(CRM_DEFAULTS)
  })

  it('cliente novo: pessoa, origem manual, ofertas desligadas', () => {
    const c = maria(open())
    expect(c).toMatchObject({ kind: 'person', source: 'manual', notes: [], tickets: [], consent: { service: true, billing: true, offers: false }, createdAt: clock, updatedAt: clock })
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('editar guarda o que o rascunho não traz e limpa o que vem vazio', () => {
    const s = open()
    const c = maria(s)
    s.addNote(c.id, 'Prefere WhatsApp.')
    clock += 1000
    const e = s.saveCustomer({ id: c.id, name: 'Maria S.', company: undefined }).item
    expect(e).toMatchObject({ name: 'Maria S.', phones: ['5511987654321'], tags: ['site'], createdAt: c.createdAt, updatedAt: clock })
    expect(e).not.toHaveProperty('company')
    expect(e.notes.map((n) => n.text)).toEqual(['Prefere WhatsApp.'])
    expect(() => s.saveCustomer({ id: 'sumiu', name: 'X' })).toThrow('não existe mais')
  })

  it('nada é escrito antes de alguma mudança; depois do lock, nada mais', () => {
    const s = open()
    s.flush()
    expect(existsSync(join(dir, 'crm.json'))).toBe(false)
    maria(s)
    s.lock()
    s.saveCustomer({ name: 'Outra' })
    s.flush()
    expect(JSON.parse(readFileSync(join(dir, 'crm.json'), 'utf8')).customers).toHaveLength(1)
  })
})

describe('CrmStore: carga defensiva', () => {
  it('arquivo quebrado cai para a última cópia boa', () => {
    const s = open()
    maria(s)
    s.flush()
    open() // a good load refreshes crm.json.bak
    writeFileSync(join(dir, 'crm.json'), '{"customers": [')
    const back = open()
    expect(back.customers.map((c) => c.name)).toEqual(['Maria Souza'])
    if (unix) expect(mode(join(dir, 'crm.json'))).toBe(0o600)
  })

  it('arquivo com forma errada abre vazio, com o funil e as regras padrão', () => {
    writeFileSync(join(dir, 'crm.json'), '{"customers": {"não": "lista"}}')
    const s = open()
    expect(s.customers).toEqual([])
    expect(s.pipelines).toEqual([DEFAULT_PIPELINE])
    expect(s.settings).toEqual(CRM_DEFAULTS)
  })

  it('regras ruins caem no padrão campo a campo', () => {
    const data = loadCrmData({ settings: { rehearsal: 'sim', recurrenceLeadDays: 5, autonomy: { offer: 'approval' }, hours: [1, 2], evil: true } })
    expect(data.settings).toEqual({ ...CRM_DEFAULTS, recurrenceLeadDays: 5, autonomy: { ...CRM_DEFAULTS.autonomy, offer: 'approval' } })
    expect(data.settings).not.toHaveProperty('evil')
  })

  it('itens órfãos saem, etapa sumida vai para a primeira, telefone fica com o primeiro, quem saiu não recebe oferta', () => {
    const c = (id: string, phones: string[], extra = {}) => ({ id, name: id, phones, tags: [], consent: { service: true, billing: true, offers: true }, notes: [], tickets: [], createdAt: 1, updatedAt: 1, ...extra })
    const data = loadCrmData({
      customers: [c('a', ['5511987654321']), c('b', ['5511987654321', '551134567890'], { consent: { offers: true, optOutAt: 5 } }), c('a', []), { id: '../x', name: 'mal' }, { id: 'sem-nome', name: '  ' }],
      deals: [
        { id: 'd1', customerId: 'a', title: 'Site', pipelineId: 'padrao', stageId: 'sumiu' },
        { id: 'd2', customerId: 'nao-existe', title: 'Órfão', pipelineId: 'padrao', stageId: 'novo' },
      ],
      payments: [
        { id: 'p1', customerId: 'a', amountCents: 100, due: '2026-02-30' },
        { id: 'p2', customerId: 'a', amountCents: 100, due: '2026-02-28', method: 'cheque', state: 'quase' },
      ],
      pipelines: [{ id: 'ruim', name: 'Sem ganho', stages: [{ id: 'x', name: 'X', kind: 'open' }, { id: 'y', name: 'Y', kind: 'lost' }] }],
    })
    expect(data.customers.map((x) => x.id)).toEqual(['a', 'b'])
    expect(data.customers[1].phones).toEqual(['551134567890'])
    expect(data.customers[1].consent.offers).toBe(false)
    expect(data.customers[0]).toMatchObject({ kind: 'person', source: 'manual' })
    expect(data.pipelines).toEqual([DEFAULT_PIPELINE])
    expect(data.deals).toHaveLength(1)
    expect(data.deals[0]).toMatchObject({ stageId: 'novo', valueCents: 0, history: [] })
    expect(data.payments.map((p) => [p.id, p.method, p.state])).toEqual([['p2', 'pix', 'open']])
  })
})

describe('CrmStore: um telefone, um cliente', () => {
  it('recusa o telefone de outro cliente com o nome dele, só na tela', () => {
    const s = open()
    maria(s)
    let err: Error | undefined
    try {
      s.saveCustomer({ name: 'João', phones: ['551134567890', '5511987654321'] })
    } catch (e) {
      err = e as Error
    }
    expect(err?.message).toBe('Esse telefone já é de Maria Souza. Abra a ficha dele ou use outro número.')
    // Electron logs a failed handler's stack: it must not carry the customer's name
    expect(err?.stack).not.toContain('Maria')
    expect(s.customers).toHaveLength(1)
  })

  it('o próprio cliente pode salvar com o telefone dele', () => {
    const s = open()
    const c = maria(s)
    expect(() => s.saveCustomer({ id: c.id, name: 'Maria', phones: ['5511987654321', '551134567890'] })).not.toThrow()
    expect(s.ownerOfPhone('551134567890')?.id).toBe(c.id)
    expect(() => s.saveCustomer({ name: 'Outra', phones: ['551134567890'] })).toThrow('já é de Maria')
  })
})

describe('CrmStore: apagar em cascata', () => {
  it('apagar o cliente leva negócios, pagamentos (com anexo) e recorrências, e o tira das sugestões', () => {
    const s = open()
    const c = maria(s)
    const other = s.saveCustomer({ name: 'Ana' }).item
    const d = s.saveDeal({ customerId: c.id, title: 'Site' }).item
    s.saveDeal({ customerId: other.id, title: 'Logo' })
    const p = s.savePayment({ customerId: c.id, amountCents: 100, due: '2026-12-01', reference: 'x' }).item
    s.saveRecurrence({ customerId: c.id, amountCents: 100, day: 5, reference: 'Hospedagem', start: '2027-01' })
    const anexo = join(s.attachmentsDir(), 'fatura.pdf')
    writeFileSync(anexo, '%PDF')
    s.payments.find((x) => x.id === p.id)!.attachment = 'fatura.pdf'
    s.suggestions.push({ id: 's1', t: 0, category: 'offer', why: 'x', customerIds: [c.id, other.id], leftOut: [], text: 'oi', status: 'pending' })
    const delta = s.deleteCustomer(c.id)
    expect(delta.removed).toEqual({ customers: [c.id], deals: [d.id], payments: [p.id], recurrences: [expect.any(String)] })
    expect(delta.suggestions?.[0].customerIds).toEqual([other.id])
    expect(s.customers.map((x) => x.id)).toEqual([other.id])
    expect(s.deals).toHaveLength(1)
    expect(s.payments).toEqual([])
    expect(s.recurrences).toEqual([])
    expect(existsSync(anexo)).toBe(false)
    expect(s.ownerOfPhone('5511987654321')).toBeUndefined()
    expect(() => s.deleteCustomer(c.id)).toThrow('não existe mais')
  })

  it('apagar negócio ou recorrência deixa os pagamentos, sem o vínculo', () => {
    const s = open()
    const c = maria(s)
    const d = s.saveDeal({ customerId: c.id, title: 'Site' }).item
    const p = s.savePayment({ customerId: c.id, dealId: d.id, amountCents: 100, due: '2026-12-01', reference: 'x' }).item
    expect(s.deleteDeal(d.id).payments?.[0]).not.toHaveProperty('dealId')
    expect(s.payment(p.id)).not.toHaveProperty('dealId')
    const r = s.saveRecurrence({ customerId: c.id, amountCents: 100, day: 20, reference: 'Manutenção', start: '2026-11' })
    const made = r.delta.payments![0]
    expect(s.deleteRecurrence(r.item.id).payments?.[0].id).toBe(made.id)
    expect(s.payment(made.id)).not.toHaveProperty('recurrenceId')
    expect(s.payments).toHaveLength(2)
  })
})

describe('CrmStore: negócios e funil', () => {
  it('negócio novo entra na primeira etapa, com histórico; mover grava etapa, data e fechamento', () => {
    const s = open()
    const c = maria(s)
    const d = s.saveDeal({ customerId: c.id, title: 'Site' }).item
    expect(d).toMatchObject({ pipelineId: 'padrao', stageId: 'novo', stageAt: clock, order: 0, valueCents: 0, history: [{ t: clock, to: 'novo', by: { kind: 'player' } }] })
    expect(d).not.toHaveProperty('closedAt')
    clock += 3 * DAY
    const won = s.moveDeal(d.id, 'fechado').item
    expect(won).toMatchObject({ stageId: 'fechado', stageAt: clock, closedAt: clock })
    expect(won.history.at(-1)).toEqual({ t: clock, from: 'novo', to: 'fechado', by: { kind: 'player' } })
    clock += DAY
    const back = s.saveDeal({ id: d.id, customerId: c.id, title: 'Site', stageId: 'proposta' }).item
    expect(back).toMatchObject({ stageId: 'proposta', stageAt: clock })
    expect(back).not.toHaveProperty('closedAt')
    expect(back.history).toHaveLength(3)
    expect(() => s.moveDeal(d.id, 'nao-existe')).toThrow('etapa')
    expect(() => s.moveDeal('sumiu', 'novo')).toThrow('não existe mais')
    expect(() => s.saveDeal({ customerId: 'sumiu', title: 'x' })).toThrow('cliente')
    expect(() => s.saveDeal({ customerId: c.id, title: 'x', pipelineId: 'outro' })).toThrow('funil')
  })

  it('mover reordena a coluna antes do negócio indicado', () => {
    const s = open()
    const c = maria(s)
    const [a, b, x] = ['A', 'B', 'X'].map((t) => s.saveDeal({ customerId: c.id, title: t }).item)
    expect([a.order, b.order, x.order]).toEqual([0, 1, 2])
    const moved = s.moveDeal(x.id, 'novo', a.id)
    expect(moved.item.order).toBe(0)
    expect(s.deals.sort((p, q) => p.order - q.order).map((d) => d.title)).toEqual(['X', 'A', 'B'])
    expect(moved.delta.deals?.map((d) => d.title).sort()).toEqual(['A', 'B', 'X'])
    // same stage, to the end: no history entry
    expect(s.moveDeal(x.id, 'novo').item.history).toHaveLength(1)
  })

  it('funil sem etapa em uso pode mudar; tirar etapa com negócio é recusado', () => {
    const s = open()
    const c = maria(s)
    s.saveDeal({ customerId: c.id, title: 'Site', stageId: 'proposta' })
    const without = (id: string): Pipeline => ({ ...DEFAULT_PIPELINE, stages: DEFAULT_PIPELINE.stages.filter((x) => x.id !== id) })
    expect(() => s.savePipeline(without('proposta'))).toThrow('A etapa "Proposta" tem 1 negócio. Mova para outra etapa antes de tirá-la do funil.')
    expect(s.savePipeline(without('conversando')).item.stages).toHaveLength(4)
    const extra: Pipeline = { id: 'suporte', name: 'Suporte', stages: [{ id: 'a', name: 'Aberto', kind: 'open' }, { id: 'ok', name: 'Resolvido', kind: 'won' }, { id: 'no', name: 'Perdido', kind: 'lost' }] }
    s.savePipeline(extra)
    expect(s.pipelines.map((p) => p.id)).toEqual(['padrao', 'suporte'])
  })
})

describe('CrmStore: pagamentos', () => {
  it('fatura AAAA-MM-NNN pelo mês em que nasce; pagar e reabrir', () => {
    const s = open()
    const c = maria(s)
    const pay = () => s.savePayment({ customerId: c.id, amountCents: 48_000, due: '2026-12-20', reference: 'Site' }).item
    expect([pay().invoice, pay().invoice]).toEqual(['2026-11-001', '2026-11-002'])
    clock = new Date(2026, 11, 2).getTime()
    const p = pay()
    expect(p.invoice).toBe('2026-12-001')
    const paid = s.markPaid(p.id, '2026-12-02').item
    expect(paid).toMatchObject({ state: 'paid', paidOn: '2026-12-02' })
    const kept = s.savePayment({ id: p.id, customerId: c.id, amountCents: 50_000, due: '2026-12-20', reference: 'Site' }).item
    expect(kept).toMatchObject({ state: 'paid', paidOn: '2026-12-02', invoice: '2026-12-001', amountCents: 50_000 })
    const reopened = s.savePayment({ id: p.id, customerId: c.id, amountCents: 50_000, due: '2026-12-20', reference: 'Site', state: 'open' }).item
    expect(reopened.state).toBe('open')
    expect(reopened).not.toHaveProperty('paidOn')
    expect(() => s.markPaid('sumiu', '2026-12-02')).toThrow('não existe mais')
  })

  it('o negócio do pagamento tem de ser do cliente; o responsável vem do cliente', () => {
    const s = open()
    const c = s.saveCustomer({ name: 'Maria', owner: 'Rita' }).item
    const other = s.saveCustomer({ name: 'Ana' }).item
    const d = s.saveDeal({ customerId: other.id, title: 'Logo' }).item
    expect(() => s.savePayment({ customerId: c.id, dealId: d.id, amountCents: 1, due: '2026-12-01', reference: '' })).toThrow('outro cliente')
    expect(() => s.savePayment({ customerId: c.id, dealId: 'sumiu', amountCents: 1, due: '2026-12-01', reference: '' })).toThrow('não existe mais')
    expect(s.savePayment({ customerId: c.id, amountCents: 1, due: '2026-12-01', reference: '' }).item.owner).toBe('Rita')
  })
})

describe('CrmStore: recorrências', () => {
  it('a recorrência do dia 20 cria o pagamento do mês, 10 dias antes', () => {
    const s = open()
    const c = maria(s)
    const { item, delta } = s.saveRecurrence({ customerId: c.id, amountCents: 48_000, day: 20, reference: 'Manutenção', start: '2026-11' })
    expect(delta.payments).toHaveLength(1)
    expect(delta.payments![0]).toMatchObject({ customerId: c.id, due: '2026-11-20', reference: 'Manutenção · novembro/2026', amountCents: 48_000, state: 'open', recurrenceId: item.id, invoice: '2026-11-001', method: 'pix' })
    expect(item.lastMonth).toBe('2026-11')
    expect(s.runRecurrences()).toBeNull()
    // dezembro chega quando faltam 10 dias
    clock = new Date(2026, 11, 9, 12).getTime()
    expect(s.runRecurrences()).toBeNull()
    clock = new Date(2026, 11, 10, 12).getTime()
    const dec = s.runRecurrences()!
    expect(dec.payments?.map((p) => p.due)).toEqual(['2026-12-20'])
    expect(dec.recurrences?.[0].lastMonth).toBe('2026-12')
    expect(s.payments).toHaveLength(2)
  })

  it('pausada não cria; nunca duas vezes o mesmo mês; respeita o prazo das regras', () => {
    const s = open()
    const c = maria(s)
    s.saveRecurrence({ customerId: c.id, amountCents: 100, day: 20, reference: 'X', start: '2026-11', active: false })
    expect(s.payments).toEqual([])
    s.setSettings({ ...s.settings, recurrenceLeadDays: 0 })
    const r = s.saveRecurrence({ customerId: c.id, amountCents: 100, day: 20, reference: 'Y', start: '2026-11' })
    expect(r.delta.payments).toBeUndefined()
    clock = new Date(2026, 10, 20, 8).getTime()
    expect(s.runRecurrences()?.payments).toHaveLength(1)
    s.recurrences.forEach((x) => delete x.lastMonth)
    expect(s.runRecurrences()).toBeNull()
  })
})

describe('CrmStore: consentimento de ofertas', () => {
  it('ligar carimba a data; desligar apaga; quem saiu só volta com clearOptOut', () => {
    const at = 1_700_000_000_000
    const on = mergeConsent(undefined, { offers: true }, at)
    expect(on).toMatchObject({ offers: true, offersAt: at, offersSource: expect.stringContaining('Marcado na ficha') })
    expect(mergeConsent(on, { offers: true, offersSource: 'Formulário' }, at + 5).offersSource).toBe('Formulário')
    expect(mergeConsent(on, { offers: false }, at)).toEqual({ service: true, billing: true, offers: false })
    const out = { service: true, billing: true, offers: false, optOutAt: at }
    expect(() => mergeConsent(out, { offers: true }, at)).toThrow('pediu para sair das ofertas')
    expect(mergeConsent(out, { service: false }, at)).toMatchObject({ service: false, optOutAt: at })
    const back = mergeConsent(out, { offers: true, clearOptOut: true, offersSource: 'Pediu de novo' }, at + 1)
    expect(back).toEqual({ service: true, billing: true, offers: true, offersAt: at + 1, offersSource: 'Pediu de novo' })
  })
})

describe('CrmStore: importação', () => {
  it('cria com origem import e ofertas desligadas; conflito pula por padrão ou atualiza', () => {
    const s = open()
    const c = s.saveCustomer({ name: 'Maria', phones: ['5511987654321'], tags: ['site'], consent: { offers: true } }).item
    const { result, delta } = s.importCustomers([
      { draft: { name: 'Novo', phones: ['551134567890'], consent: { offers: true } }, onConflict: 'skip' },
      { draft: { name: 'Maria Repetida', phones: ['5511987654321'] }, onConflict: 'skip' },
      { draft: { name: 'Maria Souza', company: 'Padaria', phones: ['5511987654321', '552134567890'], tags: ['SITE', 'vip'] }, onConflict: 'update' },
    ])
    expect(result).toEqual({ created: 1, updated: 1, skipped: 1 })
    expect(delta).toEqual({ reload: true })
    const fresh = s.customers.find((x) => x.name === 'Novo')!
    expect(fresh).toMatchObject({ source: 'import', consent: { offers: false } })
    expect(s.customer(c.id)).toMatchObject({ name: 'Maria Souza', company: 'Padaria', phones: ['5511987654321', '552134567890'], tags: ['site', 'vip'], consent: { offers: true } })
  })

  it('linha com telefones de dois clientes é pulada', () => {
    const s = open()
    s.saveCustomer({ name: 'A', phones: ['5511987654321'] })
    s.saveCustomer({ name: 'B', phones: ['551134567890'] })
    expect(s.importCustomers([{ draft: { name: 'AB', phones: ['5511987654321', '551134567890'] }, onConflict: 'update' }]).result).toEqual({ created: 0, updated: 0, skipped: 1 })
  })
})

describe('CrmStore: pastas e permissões', () => {
  it('crm.json e o .bak 0600; userData/crm e crm/anexos 0700, feitas quando preciso', () => {
    const s = open()
    expect(existsSync(join(dir, 'crm'))).toBe(false)
    maria(s)
    s.flush()
    open()
    const anexos = s.attachmentsDir()
    expect(anexos).toBe(join(dir, 'crm', 'anexos'))
    if (!unix) return
    expect(mode(join(dir, 'crm.json'))).toBe(0o600)
    expect(mode(join(dir, 'crm.json.bak'))).toBe(0o600)
    expect(mode(join(dir, 'crm'))).toBe(0o700)
    expect(mode(anexos)).toBe(0o700)
  })
})

describe('demonstração', () => {
  it('12 clientes, 8 negócios, 20 pagamentos e 2 recorrências, mostrados e nunca gravados', () => {
    const s = open()
    const real = maria(s)
    startCrmDemo(s, clock)
    const demo = <T extends { demo?: boolean }>(xs: T[]) => xs.filter((x) => x.demo)
    expect(demo(s.customers)).toHaveLength(12)
    expect(demo(s.deals)).toHaveLength(8)
    expect(demo(s.payments)).toHaveLength(20)
    expect(demo(s.recurrences)).toHaveLength(2)
    const today = localDate(clock)
    const groups = new Set(demo(s.payments).map((p) => dueGroup(p, today)))
    expect([...groups].sort()).toEqual(['history', 'overdue', 'upcoming'])
    expect(new Set(demo(s.deals).map((d) => d.stageId)).size).toBe(5)
    expect(new Set(demo(s.payments).map((p) => p.invoice)).size).toBe(20)
    // phones are fictional and unique; the demo leaves nothing due for the recurrences now
    expect(demo(s.customers).every((c) => /^5511900000\d{3}$/.test(c.phones[0]))).toBe(true)
    expect(s.runRecurrences(today)).toBeNull()
    // editing a demo customer keeps it demo; a deal for a demo customer is demo too
    const ana = demo(s.customers).find((c) => c.name === 'Ana Lima')!
    s.saveCustomer({ id: ana.id, name: 'Ana Lima (editada)' })
    expect(s.saveDeal({ customerId: ana.id, title: 'Extra' }).item.demo).toBe(true)
    s.flush()
    const raw = JSON.parse(readFileSync(join(dir, 'crm.json'), 'utf8'))
    expect(raw.customers.map((c: { id: string }) => c.id)).toEqual([real.id])
    expect([raw.deals, raw.payments, raw.recurrences]).toEqual([[], [], []])
    const again = open()
    expect(again.customers.map((c) => c.id)).toEqual([real.id])
  })

  it('o limite de clientes não conta os da demonstração', () => {
    const s = open()
    startCrmDemo(s, clock)
    expect(s.customers.length).toBeLessThan(CRM_LIMITS.customers)
    expect(() => s.saveCustomer({ name: 'Real' })).not.toThrow()
  })
})

describe('settings.crm em office.json', () => {
  it('sem a chave: o padrão; com lixo: só o que vale; cleanSettings aceita crm', () => {
    app.setPath('userData', dir)
    expect(new Store().settings.crm).toEqual(CRM_APP_DEFAULTS)
    writeFileSync(join(dir, 'office.json'), JSON.stringify({ settings: { crm: { enabled: true, evil: 1 } } }))
    const s = new Store()
    expect(s.settings.crm).toEqual({ enabled: true })
    expect(cleanSettings({ crm: { enabled: false, evil: 1 } }, s.settings).crm).toEqual({ enabled: false })
    expect(cleanSettings({ crm: 'sim' }, s.settings).crm).toEqual({ enabled: true })
    expect(cleanSettings({ playerName: 'Ana' }, s.settings).crm).toEqual({ enabled: true })
  })
})

describe('importar dados de outra máquina', () => {
  it('crm.json chega com o modo ensaio ligado e sem itens de demonstração', () => {
    const data = { customers: [{ id: 'a' }, { id: 'b', demo: true }], deals: [], pipelines: [], payments: [], recurrences: [], suggestions: [], settings: { rehearsal: false, stopAll: false } }
    const out = sanitizeImportedCrm(data) as typeof data
    expect(out.settings).toEqual({ rehearsal: true, stopAll: false })
    expect(out.customers).toEqual([{ id: 'a' }])
    expect(sanitizeImportedCrm(null)).toBeNull()
    expect((sanitizeImportedCrm({ customers: [] }) as { settings: unknown }).settings).toEqual({ rehearsal: true })
    const set = importSet({ format: 'agent-office-dados', version: 1, exportedAt: '', files: { 'office.json': { settings: {} }, 'crm.json': data } } as never)
    expect(JSON.parse(set['crm.json']!).settings.rehearsal).toBe(true)
  })
})
