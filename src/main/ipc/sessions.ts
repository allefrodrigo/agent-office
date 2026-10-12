import { ipcMain } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { isSessionId, openInTerminal, recentSessions, sessionEntry, transcript } from '../sessions'
import { worktreeFromPath } from '../git'
import { type IpcContext } from './context'

/** Resume center: recent Claude Code sessions, recall and open in the terminal. */
export function registerSessionsIpc(ctx: IpcContext): void {
  const { store, manager, defaultBrain } = ctx
  ipcMain.handle('office:listSessions', () => recentSessions())
  ipcMain.handle('office:recall', async (_e, sessionId: unknown) => {
    if (!isSessionId(sessionId)) throw new Error('ID de sessão inválido.')
    const entry = await sessionEntry(sessionId)
    if (!entry) throw new Error('Não achei essa sessão no disco.')
    if (!entry.cwd || !existsSync(entry.cwd) || !statSync(entry.cwd).isDirectory()) {
      throw new Error(`A pasta dessa sessão não existe mais${entry.cwd ? `: ${entry.cwd}` : '.'}`)
    }
    const { log, model, helpers } = await transcript(sessionId).catch(() => ({ log: [], model: undefined, helpers: [] }))
    // A session that ran in an agent's worktree comes back on the project's floor, in that copy.
    const isolated = await worktreeFromPath(entry.cwd)
    return manager.recall(
      sessionId,
      isolated?.cwd ?? entry.cwd,
      log,
      {
        // keep the model the conversation was using
        model: model ?? store.settings.defaultModel,
        effort: defaultBrain().effort,
        permissionMode: store.settings.defaultPermissionMode,
      },
      isolated?.worktree,
      helpers,
    )
  })
  ipcMain.handle('office:openInTerminal', async (_e, sessionId: unknown) => {
    if (!isSessionId(sessionId)) return { ok: false, message: 'ID de sessão inválido.' }
    const entry = await sessionEntry(sessionId)
    if (!entry?.cwd) return { ok: false, message: 'Não sei em que pasta essa sessão rodava.' }
    return openInTerminal(sessionId, entry.cwd)
  })
}
