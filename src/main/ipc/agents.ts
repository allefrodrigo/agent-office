import { ipcMain } from 'electron'
import { isAbsolute } from 'node:path'
import { isDir } from '../squads'
import { cleanLook } from '../templates'
import { repoRoot } from '../git'
import { worktreeFlagSchema, attachmentsSchema, cleanBrain, cleanHire, messageSchema, parse, pathSchema, permissionDecisionSchema, permissionModeSchema, subagentLogArgsSchema } from '../validate'
import { id, type IpcContext } from './context'

/** Agents: hire, summon, talk to them, answer permissions and ack results. */
export function registerAgentsIpc(ctx: IpcContext): void {
  const { store, manager, bridge, updateBadge, defaultBrain } = ctx
  ipcMain.handle('office:getLog', (_e, raw: unknown) => manager.getLog(id(raw)))
  ipcMain.handle('office:getSubagentLog', (_e, ...args: unknown[]) => {
    const [agentId, subId] = parse(subagentLogArgsSchema, args, 'ID inválido.')
    return manager.getSubagentLog(agentId, subId)
  })
  // A permission mode outside the list falls back to the office default.
  ipcMain.handle('office:hire', (_e, req: unknown) =>
    manager.hire({ ...cleanHire(req, store.settings), look: cleanLook((req as { look?: unknown } | null)?.look) }),
  )
  ipcMain.handle('office:summon', (_e, cwd: unknown, mode: unknown, brain: unknown, worktree: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Escolha uma pasta de projeto que exista.')
    const m = permissionModeSchema.safeParse(mode)
    const permissionMode = m.success ? m.data : store.settings.defaultPermissionMode
    return manager.summon(cwd, { ...defaultBrain(), ...cleanBrain(brain, store.settings.accounts), permissionMode }, worktreeFlagSchema.parse(worktree))
  })
  ipcMain.handle('office:isGitRepo', async (_e, cwd: unknown) => {
    const p = pathSchema.safeParse(cwd)
    return p.success && isAbsolute(p.data) && isDir(p.data) && !!(await repoRoot(p.data))
  })
  ipcMain.handle('office:send', (_e, raw: unknown, text: unknown, attachments: unknown) =>
    manager.sendMessage(
      id(raw),
      parse(messageSchema, text, 'Mensagem grande demais. Mande em partes ou anexe como arquivo.'),
      undefined,
      parse(attachmentsSchema.optional(), attachments, 'Anexos inválidos.') ?? [],
    ),
  )
  ipcMain.handle('office:interrupt', (_e, raw: unknown) => manager.interrupt(id(raw)))
  ipcMain.handle('office:compact', (_e, raw: unknown) => manager.compact(id(raw)))
  ipcMain.handle('office:clearContext', (_e, raw: unknown) => manager.clearContext(id(raw)))
  ipcMain.handle('office:closeTerminal', (_e, raw: unknown) => bridge.closeSession(id(raw)))

  ipcMain.handle('office:respond', (_e, d: unknown) => manager.respond(parse(permissionDecisionSchema, d, 'Resposta inválida.')))
  ipcMain.handle('office:ackResult', (_e, raw: unknown) => {
    manager.ackResult(id(raw))
    updateBadge()
  })
}
