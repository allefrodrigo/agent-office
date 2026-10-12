import { dialog, ipcMain } from 'electron'
import { cleanTemplate, loadTemplates, upsertTemplate } from '../templates'
import { cleanSettings } from '../validate'
import { id, type IpcContext } from './context'

/** Configurações: terminal bridge, templates and settings. */
export function registerSettingsIpc(ctx: IpcContext): void {
  const { win, store, manager, board, bridge, broadcast, rereadSquads } = ctx
  ipcMain.handle('office:installBridge', async () => {
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'question',
      buttons: ['Conectar', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: 'Conectar sessões do Claude Code no terminal?',
      detail:
        'Vamos adicionar hooks HTTP em ~/.claude/settings.json (com backup em settings.json.agent-office.bak). ' +
        'Cada sessão do terminal vira um agente no escritório, e pedidos de permissão chegam até você aqui. ' +
        'Se o app estiver fechado, o Claude Code segue normal no terminal.',
    })
    if (response !== 0) return bridge.status()
    try {
      return bridge.install()
    } catch (err) {
      dialog.showErrorBox('Não consegui editar ~/.claude/settings.json', err instanceof Error ? err.message : String(err))
      return bridge.status()
    }
  })
  ipcMain.handle('office:uninstallBridge', () => {
    try {
      return bridge.uninstall()
    } catch (err) {
      dialog.showErrorBox('Não consegui editar ~/.claude/settings.json', err instanceof Error ? err.message : String(err))
      return bridge.status()
    }
  })
  ipcMain.handle('office:saveTemplate', (_e, raw: unknown) => {
    const t = cleanTemplate(raw, store.settings.projects)
    store.settings = { ...store.settings, templates: upsertTemplate(store.settings.templates, t) }
    broadcast({ type: 'settings', settings: store.settings })
    return t
  })
  ipcMain.handle('office:deleteTemplate', (_e, raw: unknown) => {
    const templateId = id(raw)
    store.settings = { ...store.settings, templates: store.settings.templates.filter((t) => t.id !== templateId) }
    broadcast({ type: 'settings', settings: store.settings })
  })
  ipcMain.handle('office:saveSettings', (_e, patch: unknown) => {
    const before = JSON.stringify(store.settings.projects)
    const days = store.settings.ticketAutoCloseDays
    // Unknown keys are dropped; a bad value keeps the current one. The bridge port never changes here.
    const cleaned = cleanSettings(patch, store.settings)
    // Templates change only through saveTemplate/deleteTemplate; a removed floor turns its templates global.
    store.settings = { ...cleaned, templates: loadTemplates(store.settings.templates, cleaned.projects) }
    const { projects, ticketAutoCloseDays } = store.settings
    broadcast({ type: 'settings', settings: store.settings })
    if (ticketAutoCloseDays !== days) board.autoClose(ticketAutoCloseDays)
    if (JSON.stringify(projects) !== before) {
      broadcast({ type: 'squads', squads: rereadSquads() })
      manager.relocate()
    }
    return store.settings
  })
}
