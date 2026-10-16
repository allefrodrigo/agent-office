import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { parseTasksFile } from '@shared/tasks'
import { pathSchema, parse } from '../validate'
import type { IpcContext } from './context'

export function registerTasksIpc(_ctx: IpcContext): void {
  ipcMain.handle('office:readTasks', async (_e, vaultPath: unknown) => {
    const path = parse(pathSchema, vaultPath, 'Caminho do vault inválido.')
    const tasksFile = join(path, 'tarefas.md')
    try {
      const content = readFileSync(tasksFile, 'utf8')
      const parsed = parseTasksFile(content)
      return { success: true, data: parsed, original: content }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`tarefas.md não encontrado em ${path}`)
      }
      throw err
    }
  })
}
