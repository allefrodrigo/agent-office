import { ipcMain } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { isSessionId, lastPermissionMode, openInTerminal, recentSessions, sessionEntry, transcript } from '../sessions'
import { worktreeFromPath } from '../git'
import { type IpcContext } from './context'
import type { OfficePermissionMode } from '@shared/types'

const RESUMABLE_MODES: readonly OfficePermissionMode[] = ['default', 'acceptEdits', 'auto']

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
    // It comes back as free as it was.
    // "Sem pedir nada" and plan mode don't carry over: those the player picks again on purpose.
    const saved = await lastPermissionMode(sessionId)
    const permissionMode = RESUMABLE_MODES.find((m) => m === saved) ?? store.settings.defaultPermissionMode
    return manager.recall(
      sessionId,
      isolated?.cwd ?? entry.cwd,
      log,
      {
        // keep the model the conversation was using
        model: model ?? store.settings.defaultModel,
        effort: defaultBrain().effort,
        permissionMode,
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
