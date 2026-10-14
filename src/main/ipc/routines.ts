import { ipcMain } from 'electron'
import { cleanRoutineDraft } from '../validate'
import { id, type IpcContext } from './context'

/** Rotinas: tarefas agendadas, controladas pelo totem do térreo. */
export function registerRoutinesIpc(ctx: IpcContext): void {
  const { store, manager, routines } = ctx
  const routineId = (raw: unknown) => id(raw)
  ipcMain.handle('office:listRoutines', () => routines.list())
  ipcMain.handle('office:saveRoutine', (_e, raw: unknown) => routines.save(cleanRoutineDraft(raw, { settings: store.settings, agents: manager.list() })))
  ipcMain.handle('office:deleteRoutine', (_e, raw: unknown) => routines.remove(routineId(raw)))
  ipcMain.handle('office:setRoutineEnabled', (_e, raw: unknown, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('Valor inválido.')
    return routines.setEnabled(routineId(raw), on)
  })
  ipcMain.handle('office:duplicateRoutine', (_e, raw: unknown) => routines.duplicate(routineId(raw)))
  ipcMain.handle('office:runRoutineNow', (_e, raw: unknown) => routines.runNow(routineId(raw)))
}
