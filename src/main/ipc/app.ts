import { app, clipboard, dialog, ipcMain, shell } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OfficeState } from '@shared/types'
import { dataNotices } from '../fs-safe'
import { diagnostics, rendererError } from '../crash'
import { logDir } from '../log'
import { cleanLedgerQuery, externalUrlSchema, parse, pathSchema, copyTextSchema, markdownFileName, saveMarkdownArgsSchema } from '../validate'
import { type IpcContext } from './context'

// Claude FM's live restarts now and then under a new video ID; clau.de/radio always points at the current one.
const RADIO_FALLBACK = 'tRsQsTMvPNg'
async function radioVideo(): Promise<string> {
  try {
    const res = await fetch('https://clau.de/radio', { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    const id = new URL(res.headers.get('location') ?? '').searchParams.get('v') ?? ''
    if (/^[\w-]{11}$/.test(id)) return id
  } catch {
    // offline or the short link moved: keep the last known stream
  }
  return RADIO_FALLBACK
}

/** State, log and diagnostics, clipboard and export, links and the folder picker. */
export function registerAppIpc(ctx: IpcContext): void {
  const { win, store, manager, board, book, bridge, usage, accounts, system, stats, squads, onBattery } = ctx
  ipcMain.on('office:rendererError', (e, payload: unknown) => {
    if (e.sender === win()?.webContents) rendererError(payload)
  })
  ipcMain.handle('office:openLogs', async () => {
    const dir = logDir()
    // openPath('') would open nothing useful (AO-27).
    if (!dir) throw new Error('A pasta de logs não pôde ser criada, então não há log para abrir. Confira a permissão da pasta de dados do app.')
    const err = await shell.openPath(dir)
    if (err) throw new Error(`Não consegui abrir a pasta de logs: ${err}`)
  })
  // Copied here, not in the page: the page's clipboard needs focus, and the text never passes through it.
  ipcMain.handle('office:copyDiagnostics', async () => {
    clipboard.writeText(await diagnostics())
  })
  ipcMain.handle('office:getState', (): OfficeState => ({
    agents: manager.list(),
    permissions: manager.pendingRequests(),
    results: manager.pendingResults(),
    tickets: board.list(),
    bridge: bridge.status(),
    settings: store.settings,
    platform: process.platform,
    usage: usage.current(),
    accounts: accounts.statuses(),
    system: system.current(),
    squads: squads(),
    ledgerToday: book.today(),
    dataNotices: dataNotices(),
    onBattery: onBattery(),
  }))
  ipcMain.handle('office:getLedger', (_e, q: unknown) => book.query(cleanLedgerQuery(q)))
  ipcMain.handle('office:refreshUsage', () => usage.refresh())
  ipcMain.handle('office:getStats', () => stats.current())
  ipcMain.handle('office:refreshStats', () => stats.refresh())
  ipcMain.handle('office:copyText', (_e, text: unknown) => {
    clipboard.writeText(parse(copyTextSchema, text, 'Não consegui copiar: o texto veio inválido.'))
  })
  ipcMain.handle('office:saveMarkdown', async (_e, ...args: unknown[]) => {
    const [fileName, content] = parse(saveMarkdownArgsSchema, args, 'Não consegui exportar: o conteúdo veio inválido.')
    const r = await dialog.showSaveDialog(win()!, {
      title: 'Exportar em Markdown',
      defaultPath: join(app.getPath('documents'), markdownFileName(fileName)),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, content, 'utf8')
    return r.filePath
  })

  ipcMain.handle('office:pickFolder', async (_e, defaultPath?: unknown) => {
    const r = await dialog.showOpenDialog(win()!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Pasta do projeto',
      defaultPath: pathSchema.safeParse(defaultPath).success && existsSync(defaultPath as string) ? (defaultPath as string) : undefined,
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('office:openExternal', (_e, url: unknown) => {
    // Only web links leave the app; file:// or custom schemes could run things.
    const link = externalUrlSchema.safeParse(url)
    if (link.success) return shell.openExternal(link.data)
  })
  ipcMain.handle('office:revealPath', (_e, p: unknown) => {
    const path = pathSchema.safeParse(p)
    if (path.success && existsSync(path.data)) shell.showItemInFolder(path.data)
  })
  ipcMain.handle('office:radioVideo', () => radioVideo())
}
