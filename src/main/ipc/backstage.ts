import { ipcMain, shell } from 'electron'
import { OFFICE_MCP } from '../backstage/tools'
import { type IpcContext } from './context'

/** Bastidores: stop or read a background process, and turn MCP servers and plugins on or off. */
export function registerBackstageIpc(ctx: IpcContext): void {
  const { store, manager, backstage, tools, broadcast } = ctx
  // Ids come from the last scan; Backstage still checks them against what it found.
  const processId = (raw: unknown) => {
    if (typeof raw !== 'string' || !/^(task:[\w-]{1,64}:[\w-]{1,64}|pid:\d{1,9})$/.test(raw)) throw new Error('Processo inválido.')
    return raw
  }
  const name = (raw: unknown, what: string) => {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 200) throw new Error(`${what} inválido.`)
    return raw
  }
  const flag = (raw: unknown) => {
    if (typeof raw !== 'boolean') throw new Error('Valor inválido.')
    return raw
  }

  ipcMain.handle('office:stopProcess', (_e, raw: unknown) => backstage.stopProcess(processId(raw)))
  ipcMain.handle('office:processOutput', (_e, raw: unknown) => backstage.output(processId(raw)))
  ipcMain.handle('office:toolsView', () => tools.view())

  ipcMain.handle('office:toggleMcp', async (_e, raw: unknown, on: unknown) => {
    const server = name(raw, 'Servidor')
    const enabled = flag(on)
    if (server === OFFICE_MCP) throw new Error('O servidor do escritório fica sempre ligado: os agentes usam o quadro por ele.')
    const off = new Set(store.settings.disabledMcp ?? [])
    if (enabled) off.delete(server)
    else off.add(server)
    // Kept, so every CLI that starts later turns it off too (AgentManager.applyMcpOff).
    store.settings = { ...store.settings, disabledMcp: [...off].sort() }
    broadcast({ type: 'settings', settings: store.settings })
    await manager.toggleMcp(server, enabled)
    return tools.view()
  })
  ipcMain.handle('office:reconnectMcp', async (_e, raw: unknown) => {
    await manager.reconnectMcp(name(raw, 'Servidor'))
    return tools.view()
  })
  ipcMain.handle('office:togglePlugin', async (_e, raw: unknown, on: unknown) => {
    tools.setPlugin(name(raw, 'Plugin'), flag(on))
    await manager.reloadPlugins()
    return tools.view()
  })
  ipcMain.handle('office:revealSkill', (_e, raw: unknown) => shell.showItemInFolder(tools.skillPath(name(raw, 'Skill'))))
}
