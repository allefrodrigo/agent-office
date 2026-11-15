// Every argument from the renderer passes through validate.ts first (in bots/api.ts).
import { ipcMain } from 'electron'
import { botsApi } from '../bots/api'
import type { IpcContext } from './context'

/**
 * Chat dos bots, phase 1 (CB-07). The automations (phase 2) and channels (phase 3) register
 * their own handlers in their own files.
 */
export function registerBotsIpc(ctx: IpcContext): void {
  const api = botsApi({ store: ctx.botStore, runner: ctx.bots, settings: () => ctx.store.settings, broadcast: ctx.broadcast })
  ipcMain.handle('office:listBots', () => api.listBots())
  ipcMain.handle('office:saveBot', (_e, raw: unknown) => api.saveBot(raw))
  ipcMain.handle('office:deleteBot', (_e, raw: unknown) => api.deleteBot(raw))
  ipcMain.handle('office:duplicateBot', (_e, raw: unknown) => api.duplicateBot(raw))
  ipcMain.handle('office:setBotFlags', (_e, raw: unknown, patch: unknown) => api.setBotFlags(raw, patch))
  ipcMain.handle('office:markBotRead', (_e, raw: unknown, at: unknown) => api.markBotRead(raw, at))
  ipcMain.handle('office:botThread', (_e, raw: unknown, opts: unknown) => api.botThread(raw, opts))
  ipcMain.handle('office:searchBots', (_e, query: unknown, floor: unknown) => api.searchBots(query, floor))
  ipcMain.handle('office:sendToBot', (_e, raw: unknown, text: unknown, attachments: unknown) => api.sendToBot(raw, text, attachments))
  ipcMain.handle('office:runBotNow', (_e, raw: unknown) => api.runBotNow(raw))
  ipcMain.handle('office:stopBot', (_e, raw: unknown) => api.stopBot(raw))
  ipcMain.handle('office:newBotConversation', (_e, raw: unknown) => api.newBotConversation(raw))
  ipcMain.handle('office:configureBot', (_e, raw: unknown, patch: unknown) => api.configureBot(raw, patch))
  ipcMain.handle('office:botMemory', (_e, raw: unknown) => api.botMemory(raw))
  ipcMain.handle('office:saveBotMemory', (_e, raw: unknown, text: unknown) => api.saveBotMemory(raw, text))
  ipcMain.handle('office:botSpend', (_e, raw: unknown) => api.botSpend(raw))
}
