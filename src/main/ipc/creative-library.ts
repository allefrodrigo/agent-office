import { ipcMain } from 'electron'
import type { ProjectFloor } from '@shared/types'
import { parseAdsTarget } from '@shared/social'
import { captureAds } from '../creative/ads'
import { loadBrand, saveBrand } from '../creative/brand'
import { createFlow, deleteFlow, listFlows, listLibrary, loadFlowTab, readLibraryText, renameFlow, reorderFlows, saveFlowTab } from '../creative/flow'
import { addManualRefs, addRefs, listRefs, refsDir, removeRef, setRefTags } from '../creative/refs'
import { log } from '../log'
import { idSchema, parse } from '../validate'
import type { IpcContext } from './context'

/** Estúdio criativo: the floor's flows (tabs), gallery, brand kit and references. Paths never leave the floor folder. */
export function registerCreativeLibraryIpc(ctx: IpcContext): void {
  const { store, broadcast } = ctx
  const captures = new Map<string, AbortController>()
  const rootOf = (raw: unknown): string => {
    const fid = parse(idSchema, raw, 'Esse andar não existe mais.')
    const f: ProjectFloor | undefined = store.settings.projects.find((p) => p.kind === 'creative' && p.id === fid)
    if (!f) throw new Error('Esse andar criativo não existe mais.')
    return f.cwd
  }
  ipcMain.handle('office:listFlows', (_e, floorId: unknown) => listFlows(rootOf(floorId)))
  ipcMain.handle('office:loadFlowTab', (_e, floorId: unknown, flowId: unknown) => loadFlowTab(rootOf(floorId), flowId))
  ipcMain.handle('office:saveFlowTab', (_e, floorId: unknown, flowId: unknown, flow: unknown) => saveFlowTab(rootOf(floorId), flowId, flow))
  ipcMain.handle('office:createFlow', (_e, floorId: unknown, name: unknown, flow: unknown, after: unknown) => createFlow(rootOf(floorId), name, flow, after))
  ipcMain.handle('office:renameFlow', (_e, floorId: unknown, flowId: unknown, name: unknown) => renameFlow(rootOf(floorId), flowId, name))
  ipcMain.handle('office:deleteFlow', (_e, floorId: unknown, flowId: unknown) => deleteFlow(rootOf(floorId), flowId))
  ipcMain.handle('office:reorderFlows', (_e, floorId: unknown, order: unknown) => reorderFlows(rootOf(floorId), order))
  ipcMain.handle('office:listLibrary', (_e, floorId: unknown) => listLibrary(rootOf(floorId)))
  ipcMain.handle('office:readLibraryText', (_e, floorId: unknown, path: unknown) => readLibraryText(rootOf(floorId), path))
  ipcMain.handle('office:loadBrand', (_e, floorId: unknown) => loadBrand(rootOf(floorId)))
  ipcMain.handle('office:saveBrand', (_e, floorId: unknown, kit: unknown) => saveBrand(rootOf(floorId), kit))
  ipcMain.handle('office:listRefs', (_e, floorId: unknown) => listRefs(rootOf(floorId)))
  ipcMain.handle('office:addRefs', (_e, floorId: unknown, paths: unknown) => addManualRefs(rootOf(floorId), paths))
  ipcMain.handle('office:setRefTags', (_e, floorId: unknown, id: unknown, tags: unknown) => setRefTags(rootOf(floorId), id, tags))
  ipcMain.handle('office:removeRef', (_e, floorId: unknown, id: unknown) => removeRef(rootOf(floorId), id))
  // Meta Ads Library → referencias/<anunciante>/: one capture per floor at a time.
  ipcMain.handle('office:captureAds', async (_e, floorId: unknown, raw: unknown, max: unknown) => {
    const root = rootOf(floorId)
    const id = String(floorId)
    const target = parseAdsTarget(raw)
    if (!target) throw new Error('Use um @perfil, um link da Biblioteca de Anúncios (facebook.com/ads/library) ou o ID de um anúncio.')
    if (captures.has(id)) throw new Error('Já tem uma captura rodando neste andar.')
    const ctrl = new AbortController()
    captures.set(id, ctrl)
    const progress = (text: string) => broadcast({ type: 'creative:progress', jobId: `ads:${id}`, text: text.slice(0, 200) })
    try {
      const n = typeof max === 'number' && Number.isFinite(max) ? Math.min(30, Math.max(1, Math.round(max))) : 10
      const r = await captureAds({ target, max: n, dir: refsDir(root), signal: ctrl.signal, progress })
      const before = new Set(listRefs(root).map((x) => x.id))
      const refs = r.items.length ? addRefs(root, r.items) : listRefs(root)
      log.info(`Estúdio: ${r.items.length} anúncio(s) capturados de ${r.anunciante || 'uma página'}`)
      return { refs, added: r.items.filter((x) => !before.has(x.id)).length, anunciante: r.anunciante, ...(r.notFound ? { notFound: r.notFound } : {}) }
    } finally {
      captures.delete(id)
    }
  })
  ipcMain.handle('office:cancelCapture', (_e, floorId: unknown) => captures.get(String(floorId))?.abort())
}
