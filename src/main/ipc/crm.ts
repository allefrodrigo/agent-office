// Every argument from the renderer passes through validate.ts first (in crm/api.ts).
import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { crmApi, type CrmApi, type CrmApiDeps, type CrmDialogs } from '../crm/api'
import type { IpcContext } from './context'

/** Sala de CRM, phase 1: the channels the preload uses, by name. Exported for the tests. */
export function crmHandlers(api: CrmApi): Record<string, (...args: unknown[]) => unknown> {
  return {
    'office:crmList': () => api.crmList(),
    'office:saveCustomer': (draft) => api.saveCustomer(draft),
    'office:deleteCustomer': (id) => api.deleteCustomer(id),
    'office:addCrmNote': (customerId, text) => api.addCrmNote(customerId, text),
    'office:saveDeal': (draft) => api.saveDeal(draft),
    'office:moveDeal': (id, stageId, beforeId) => api.moveDeal(id, stageId, beforeId),
    'office:deleteDeal': (id) => api.deleteDeal(id),
    'office:savePipeline': (pipeline) => api.savePipeline(pipeline),
    'office:savePayment': (draft) => api.savePayment(draft),
    'office:markPaid': (id, paidOn) => api.markPaid(id, paidOn),
    'office:deletePayment': (id) => api.deletePayment(id),
    'office:saveRecurrence': (draft) => api.saveRecurrence(draft),
    'office:deleteRecurrence': (id) => api.deleteRecurrence(id),
    'office:crmSearch': (query) => api.crmSearch(query),
    'office:exportCrmCsv': (kind, ids) => api.exportCrmCsv(kind, ids),
    'office:pickCustomersCsv': () => api.pickCustomersCsv(),
    'office:importCustomersCsv': (rows) => api.importCustomersCsv(rows),
    'office:exportCustomerData': (id) => api.exportCustomerData(id),
    'office:saveCrmSettings': (patch) => api.saveCrmSettings(patch),
  }
}

/** Save and open dialogs over the office window; the paths come from them, never from the page. */
function electronDialogs(win: IpcContext['win']): CrmDialogs {
  return {
    save: async (o) => {
      const w = win()
      const opts = { title: o.title, defaultPath: join(app.getPath('documents'), o.defaultName), filters: o.filters }
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    },
    open: async (o) => {
      const w = win()
      const opts = { title: o.title, properties: ['openFile' as const], filters: o.filters }
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
  }
}

/** Registers the CRM's handlers; index.ts keeps the api for the daily recurrences (tick). */
export function registerCrmIpc(
  ctx: Pick<IpcContext, 'crmStore' | 'store' | 'broadcast' | 'win'>,
  extra: Pick<CrmApiDeps, 'onCustomerDeleted'> = {},
): CrmApi {
  const api = crmApi({
    store: ctx.crmStore,
    floors: () => ctx.store.settings.projects.map((p) => ({ id: p.id, name: p.name })),
    broadcast: ctx.broadcast,
    dialogs: electronDialogs(ctx.win),
    ...extra,
  })
  for (const [channel, handler] of Object.entries(crmHandlers(api))) ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args))
  return api
}
