import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import {
  CRM_LIMITS,
  type CrmData,
  type CrmDelta,
  type CrmHit,
  type CrmSettings,
  type Customer,
  type CustomerImportPreview,
  type CustomerImportResult,
  type Deal,
  type OfficeEvent,
  type Payment,
  type Pipeline,
  type Recurrence,
} from '@shared/types'
import { localDate, parseCustomersCsv, searchCrm } from '@shared/crm'
import { writeFileAtomic, writeJsonAtomic } from '../fs-safe'
import { log } from '../log'
import {
  cleanCrmDay,
  cleanCrmId,
  cleanCrmNote,
  cleanCrmQuery,
  cleanCrmSettingsPatch,
  cleanCsvIds,
  cleanCsvKind,
  cleanCustomer,
  cleanDeal,
  cleanImportRows,
  cleanPayment,
  cleanPipeline,
  cleanRecurrence,
  type CleanCustomerDraft,
} from '../validate'
import { crmCsv, customerExport } from './export'
import type { CrmStore } from './store'

export interface FileFilter {
  name: string
  extensions: string[]
}

/** Native dialogs (Electron's in the app, fakes in the tests). Null = cancelled. */
export interface CrmDialogs {
  save(o: { title: string; defaultName: string; filters: FileFilter[] }): Promise<string | null>
  open(o: { title: string; filters: FileFilter[] }): Promise<string | null>
}

export interface CrmApiDeps {
  store: CrmStore
  /** Project floors (id and name): customers and deals may point at one. */
  floors(): { id: string; name: string }[]
  broadcast(e: OfficeEvent): void
  dialogs: CrmDialogs
  now?: () => number
}

const FILE_MODE = 0o600
const CSV_FILTER: FileFilter[] = [{ name: 'Planilha CSV', extensions: ['csv'] }]
const CSV_NAMES = { customers: 'clientes', deals: 'negocios', payments: 'pagamentos' } as const
const LABELS = { customers: 'clientes', deals: 'negócios', payments: 'pagamentos' } as const

/** A CSV saved by Excel in pt-BR may be Windows-1252, not UTF-8. */
function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return buf.toString('latin1')
  }
}

/** A file name from the customer's name: letters and digits only, never a path. */
function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'cliente'
  )
}

/**
 * The CRM's OfficeAPI methods (phase 1), one per name, as ipc/crm.ts registers them. Every
 * argument comes from the renderer and passes through validate.ts here; each change goes out as
 * a 'crm' event with only what changed. Logs carry counts, ids and durations, never customer data.
 */
export function crmApi(d: CrmApiDeps) {
  const { store } = d
  const now = d.now ?? (() => Date.now())
  const today = () => localDate(now())
  const floorIds = () => d.floors().map((f) => f.id)
  const send = (delta: CrmDelta) => d.broadcast({ type: 'crm', delta })
  const ms = (t0: number) => Math.round(performance.now() - t0)
  /** Last local day the recurrences ran. */
  let ranOn = ''

  return {
    crmList: (): CrmData => store.list(),

    saveCustomer: (raw: unknown): Customer => {
      const { item, delta } = store.saveCustomer(cleanCustomer(raw, { floors: floorIds() }))
      send(delta)
      return item
    },

    deleteCustomer: (raw: unknown): void => {
      const customerId = cleanCrmId(raw, 'Esse cliente não existe mais.')
      const delta = store.deleteCustomer(customerId)
      const n = (k: 'deals' | 'payments' | 'recurrences') => delta.removed?.[k]?.length ?? 0
      log.info(`CRM: cliente ${customerId} apagado com ${n('deals')} negócio(s), ${n('payments')} pagamento(s) e ${n('recurrences')} recorrência(s)`)
      send(delta)
    },

    addCrmNote: (rawId: unknown, rawText: unknown): Customer => {
      const customerId = cleanCrmId(rawId, 'Esse cliente não existe mais.')
      const { item, delta } = store.addNote(customerId, cleanCrmNote(rawText))
      send(delta)
      return item
    },

    saveDeal: (raw: unknown): Deal => {
      const { item, delta } = store.saveDeal(cleanDeal(raw, { floors: floorIds() }))
      send(delta)
      return item
    },

    moveDeal: (rawId: unknown, rawStage: unknown, rawBefore: unknown): Deal => {
      const dealId = cleanCrmId(rawId, 'Esse negócio não existe mais.')
      const stageId = cleanCrmId(rawStage, 'Essa etapa não existe mais nesse funil.')
      const beforeId = rawBefore === undefined || rawBefore === null ? undefined : cleanCrmId(rawBefore, 'Posição inválida no quadro.')
      const { item, delta } = store.moveDeal(dealId, stageId, beforeId)
      send(delta)
      return item
    },

    deleteDeal: (raw: unknown): void => {
      send(store.deleteDeal(cleanCrmId(raw, 'Esse negócio não existe mais.')))
    },

    savePipeline: (raw: unknown): Pipeline => {
      const { item, delta } = store.savePipeline(cleanPipeline(raw))
      send(delta)
      return item
    },

    savePayment: (raw: unknown): Payment => {
      const { item, delta } = store.savePayment(cleanPayment(raw))
      send(delta)
      return item
    },

    markPaid: (rawId: unknown, rawDay: unknown): Payment => {
      const paymentId = cleanCrmId(rawId, 'Esse pagamento não existe mais.')
      const paidOn = cleanCrmDay(rawDay, 'Data do pagamento inválida. Use uma data do calendário.')
      if (paidOn > today()) throw new Error('A data do pagamento não pode ser depois de hoje.')
      const { item, delta } = store.markPaid(paymentId, paidOn)
      send(delta)
      return item
    },

    deletePayment: (raw: unknown): void => {
      send(store.deletePayment(cleanCrmId(raw, 'Esse pagamento não existe mais.')))
    },

    saveRecurrence: (raw: unknown): Recurrence => {
      const { item, delta } = store.saveRecurrence(cleanRecurrence(raw), today())
      send(delta)
      return item
    },

    deleteRecurrence: (raw: unknown): void => {
      send(store.deleteRecurrence(cleanCrmId(raw, 'Essa recorrência não existe mais.')))
    },

    crmSearch: (raw: unknown): CrmHit[] => searchCrm(store.list(), cleanCrmQuery(raw), today()),

    exportCrmCsv: async (rawKind: unknown, rawIds: unknown): Promise<string | null> => {
      const kind = cleanCsvKind(rawKind)
      const ids = cleanCsvIds(rawIds)
      if (!ids.length) throw new Error('Nada para exportar: o filtro está vazio.')
      const path = await d.dialogs.save({ title: `Exportar ${LABELS[kind]} em CSV`, defaultName: `${CSV_NAMES[kind]}-${today()}.csv`, filters: CSV_FILTER })
      if (!path) return null
      const t0 = performance.now()
      const { csv, count } = crmCsv(kind, ids, store.list(), { floors: d.floors(), today: today(), now: now() })
      writeFileAtomic(path, csv, FILE_MODE)
      log.info(`CRM: exportou ${count} ${LABELS[kind]} em CSV (${ms(t0)} ms)`)
      return path
    },

    pickCustomersCsv: async (): Promise<CustomerImportPreview | null> => {
      const path = await d.dialogs.open({ title: 'Importar clientes de uma planilha', filters: [...CSV_FILTER, { name: 'Texto', extensions: ['txt', 'tsv'] }] })
      if (!path) return null
      const st = statSync(path)
      if (!st.isFile()) throw new Error('Escolha um arquivo CSV, não uma pasta.')
      if (st.size > CRM_LIMITS.csvBytes) throw new Error(`Esse arquivo passa de ${Math.round(CRM_LIMITS.csvBytes / 1024 / 1024)} MB. Divida a planilha em partes menores e importe uma de cada vez.`)
      const t0 = performance.now()
      const rows = parseCustomersCsv(decodeCsv(readFileSync(path))).map((r) => {
        if (r.error) return r
        const other = (r.draft.phones ?? []).map((p) => store.ownerOfPhone(p)).find((c) => !!c)
        return other ? { ...r, conflictWith: other.id } : r
      })
      log.info(`CRM: planilha lida com ${rows.length} linha(s), ${rows.filter((r) => r.error).length} com erro e ${rows.filter((r) => r.conflictWith).length} em conflito (${ms(t0)} ms)`)
      return { file: basename(path), rows }
    },

    importCustomersCsv: (raw: unknown): CustomerImportResult => {
      const t0 = performance.now()
      const floors = floorIds()
      const clean: { draft: CleanCustomerDraft; onConflict: 'skip' | 'update' }[] = []
      let bad = 0
      for (const r of cleanImportRows(raw)) {
        try {
          clean.push({ draft: cleanCustomer(r.draft, { floors }), onConflict: r.onConflict })
        } catch {
          bad++
        }
      }
      const { result, delta } = store.importCustomers(clean)
      result.skipped += bad
      log.info(`CRM: importação com ${result.created} criado(s), ${result.updated} atualizado(s) e ${result.skipped} pulado(s) (${ms(t0)} ms)`)
      send(delta)
      return result
    },

    exportCustomerData: async (raw: unknown): Promise<string | null> => {
      const customerId = cleanCrmId(raw, 'Esse cliente não existe mais.')
      const customer = store.customer(customerId)
      if (!customer) throw new Error('Esse cliente não existe mais. Ele pode ter sido apagado em outra janela.')
      const path = await d.dialogs.save({ title: 'Exportar os dados deste cliente', defaultName: `cliente-${slug(customer.name)}-${today()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (!path) return null
      writeJsonAtomic(path, customerExport(customerId, store.list(), now()), { mode: FILE_MODE, space: 2, newline: true })
      log.info(`CRM: dados do cliente ${customerId} exportados (LGPD)`)
      return path
    },

    saveCrmSettings: (raw: unknown): CrmSettings => {
      const delta = store.setSettings(cleanCrmSettingsPatch(raw, store.settings))
      send(delta)
      return store.settings
    },

    /** At startup and every hour: on a new local day, the recurrences make what is due. */
    tick: (): void => {
      const day = today()
      if (day === ranOn) return
      ranOn = day
      const delta = store.runRecurrences(day)
      if (delta) send(delta)
    },
  }
}

export type CrmApi = ReturnType<typeof crmApi>
