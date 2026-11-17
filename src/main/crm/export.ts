import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, type CrmCsvKind, type CrmData, type Customer } from '@shared/types'
import { dealAge, formatAmount, formatDay, formatPhone, localDate, paymentStatus, toCsv } from '@shared/crm'

/** What the CSV and the customer's export need besides crm.json. */
export interface ExportContext {
  /** Floor ids and names, for the "Andar" column. */
  floors: readonly { id: string; name: string }[]
  /** 'AAAA-MM-DD' (overdue payments). */
  today: string
  /** ms (days in the stage). */
  now: number
}

const day = (t: number | undefined) => (t ? formatDay(localDate(t)) : '')
/** Without the '+': Excel would read it as a formula, and the ' in front would show. */
const phone = (p: string) => formatPhone(p).replace(/^\+/, '')

/**
 * The CSV of those ids, in their order (the screen's filter and sort); ids that are gone are
 * skipped. Money goes out formatted and positive ("480,00"); toCsv escapes formulas.
 */
export function crmCsv(kind: CrmCsvKind, ids: readonly string[], data: CrmData, ctx: ExportContext): { csv: string; count: number } {
  const floorName = (floorId: string | undefined) => (floorId ? (ctx.floors.find((f) => f.id === floorId)?.name ?? '') : '')
  const people = new Map(data.customers.map((c) => [c.id, c]))
  const who = (customerId: string): Pick<Customer, 'name' | 'company'> => people.get(customerId) ?? { name: '' }
  const pick = <T extends { id: string }>(xs: readonly T[]) => {
    const byId = new Map(xs.map((x) => [x.id, x]))
    return ids.flatMap((itemId) => byId.get(itemId) ?? [])
  }
  if (kind === 'customers') {
    const rows = pick(data.customers).map((c) => [
      c.name,
      c.company,
      c.kind === 'company' ? 'Empresa' : 'Pessoa',
      c.phones.map(phone).join(' / '),
      c.email,
      c.tags.join(', '),
      c.owner,
      floorName(c.floor),
      day(c.lastContactAt),
      c.nextStep,
      c.nextStepOn ? formatDay(c.nextStepOn) : '',
      c.consent.offers ? 'Sim' : 'Não',
      { manual: 'Manual', import: 'Importado', whatsapp: 'WhatsApp', demo: 'Demonstração' }[c.source],
      day(c.createdAt),
    ])
    return {
      csv: toCsv(['Nome', 'Empresa', 'Tipo', 'Telefones', 'E-mail', 'Etiquetas', 'Responsável', 'Andar', 'Último contato', 'Próximo passo', 'Data do próximo passo', 'Aceita ofertas', 'Origem', 'Cadastrado em'], rows),
      count: rows.length,
    }
  }
  if (kind === 'deals') {
    const rows = pick(data.deals).map((d) => {
      const p = data.pipelines.find((x) => x.id === d.pipelineId)
      return [
        who(d.customerId).name,
        who(d.customerId).company,
        d.title,
        formatAmount(d.valueCents),
        p?.name ?? '',
        p?.stages.find((s) => s.id === d.stageId)?.name ?? d.stageId,
        dealAge(d, ctx.now),
        d.nextStep,
        d.nextStepOn ? formatDay(d.nextStepOn) : '',
        floorName(d.floor),
        day(d.createdAt),
        day(d.closedAt),
      ]
    })
    return {
      csv: toCsv(['Cliente', 'Empresa', 'Negócio', 'Valor', 'Funil', 'Etapa', 'Dias na etapa', 'Próximo passo', 'Data do próximo passo', 'Andar', 'Criado em', 'Fechado em'], rows),
      count: rows.length,
    }
  }
  const rows = pick(data.payments).map((p) => [
    p.invoice,
    who(p.customerId).name,
    who(p.customerId).company,
    formatAmount(p.amountCents),
    formatDay(p.due),
    p.reference,
    PAYMENT_METHOD_LABEL[p.method],
    p.owner,
    PAYMENT_STATUS_LABEL[paymentStatus(p, ctx.today)],
    p.paidOn ? formatDay(p.paidOn) : '',
  ])
  return { csv: toCsv(['Fatura', 'Cliente', 'Empresa', 'Valor', 'Vencimento', 'Referente a', 'Método', 'Responsável', 'Estado', 'Pago em'], rows), count: rows.length }
}

export const CUSTOMER_EXPORT_FORMAT = 'agent-office-crm-cliente'

/** LGPD: everything the CRM keeps about one customer, as one JSON (the conversation joins it in phase 2). */
export function customerExport(customerId: string, data: CrmData, now: number): object | null {
  const customer = data.customers.find((c) => c.id === customerId)
  if (!customer) return null
  const mine = <T extends { customerId: string }>(xs: readonly T[]) => xs.filter((x) => x.customerId === customerId)
  return {
    format: CUSTOMER_EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date(now).toISOString(),
    customer,
    deals: mine(data.deals),
    payments: mine(data.payments),
    recurrences: mine(data.recurrences),
  }
}
