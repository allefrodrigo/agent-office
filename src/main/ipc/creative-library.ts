import { ipcMain } from 'electron'
import type { ProjectFloor } from '@shared/types'
import { createFlow, deleteFlow, listFlows, listLibrary, loadFlowTab, readLibraryText, renameFlow, reorderFlows, saveFlowTab } from '../creative/flow'
import { idSchema, parse } from '../validate'
import type { IpcContext } from './context'

/** Estúdio criativo: the floor's flows (tabs) and its gallery. Paths never leave the floor folder. */
export function registerCreativeLibraryIpc(ctx: IpcContext): void {
  const { store } = ctx
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
}
