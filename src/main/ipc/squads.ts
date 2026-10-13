import { ipcMain } from 'electron'
import { projectFor } from '@shared/projects'
import { findSquad, isDir, loadSquads, squadInfo } from '../squads'
import { delegateMode, pathSchema, squadCodeSchema, squadNoteSchema } from '../validate'
import { type IpcContext } from './context'

/** Squads of a project floor. */
export function registerSquadsIpc(ctx: IpcContext): void {
  const { store, manager, defaultBrain } = ctx
  ipcMain.handle('office:listSquads', (_e, cwd: unknown) => (pathSchema.safeParse(cwd).success && isDir(cwd) ? loadSquads(cwd).map(squadInfo) : []))
  ipcMain.handle('office:runSquad', (_e, cwd: unknown, code: unknown, mode: unknown, note: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Essa pasta de squads não existe mais.')
    // Orchestrators work in the Diretoria of their project's floor.
    if (projectFor(store.settings.projects, cwd)?.cwd !== cwd) throw new Error('Crie um andar para esse projeto antes de contratar um squad.')
    const plain = squadCodeSchema.safeParse(code)
    const squad = plain.success ? findSquad(cwd, plain.data) : undefined
    if (!squad) throw new Error(`Não achei o squad ${plain.success ? plain.data : ''} em ${cwd}/squads.`)
    const extra = (squadNoteSchema.parse(note) ?? '').trim().slice(0, 2000)
    return manager.runSquad(
      squadInfo(squad),
      `Rode um ciclo do squad ${squad.name} (squads/${squad.code}), do primeiro passo do pipeline até o fim.${extra ? `\n\nRecado de ${store.settings.playerName}: ${extra}` : ''}`,
      `Rodar um ciclo de ${squad.icon} ${squad.name}${extra ? `\n\n${extra}` : ''}`,
      {
        ...defaultBrain(),
        // Same rule as tickets: a cycle reaches real systems, so it never runs with "bypass".
        permissionMode: delegateMode(mode),
      },
    )
  })
}
