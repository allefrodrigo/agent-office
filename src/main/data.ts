import { app, dialog, ipcMain, powerMonitor, shell, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupEntry, OfficeEvent } from '@shared/types'
import { backupsDir, dailyBackup, dayKey, importSet, listBackups, parseExport, readBackup, replaceData, snapshot, writeExport, type DataSet } from './backups'
import { onDataNotice } from './fs-safe'

const HOUR = 3_600_000
/** Exports are a few MB; anything far bigger is not one. */
const MAX_IMPORT_BYTES = 256 * 1024 * 1024

/**
 * Saves the pending (debounced) data whenever the app may die without before-quit:
 * kill -TERM, Ctrl+C, a crash in the main process, the Mac going to sleep or shutting down.
 * uncaughtExceptionMonitor watches without changing what Electron does with the error.
 */
export function flushOnExit(flush: () => void): void {
  const safeFlush = (why: string) => {
    try {
      flush()
    } catch (err) {
      console.error(`[data] flush (${why}) falhou:`, err)
    }
  }
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      safeFlush(sig)
      // A listener replaces the default exit: quit (before-quit stops agents), and leave for sure.
      app.quit()
      setTimeout(() => app.exit(0), 3000).unref()
    })
  }
  process.on('uncaughtExceptionMonitor', () => safeFlush('uncaughtException'))
  powerMonitor.on('suspend', () => safeFlush('suspend'))
  powerMonitor.on('shutdown', () => safeFlush('shutdown'))
}

export interface DataDeps {
  dataDir: string
  win: () => BrowserWindow | null
  broadcast: (e: OfficeEvent) => void
  /** Writes what is pending now. */
  flush: () => void
  /** Stops agents and timers and writes what is pending (the before-quit work). */
  stopAll: () => void
  /** Store and board stop writing, so the files put in place are not written over. */
  lock: () => void
}

/** Backups, restore, export and import (Configurações → Dados), plus the daily copy. */
export function setupData(d: DataDeps): void {
  onDataNotice((notice) => d.broadcast({ type: 'data:notice', notice }))

  // The day's copy: at startup and, for an app left open, checked every hour.
  const daily = () => {
    try {
      d.flush()
      dailyBackup(d.dataDir)
    } catch (err) {
      console.error('[data] backup diário falhou:', err)
    }
  }
  daily()
  setInterval(daily, HOUR).unref()

  /** Saves the current state as a backup, puts `files` in place and starts the app again. */
  const replaceAndRestart = (files: DataSet) => {
    d.stopAll()
    d.lock()
    snapshot(d.dataDir)
    replaceData(d.dataDir, files)
    app.relaunch()
    // exit, not quit: before-quit would write the old state from memory over the new files.
    app.exit(0)
  }

  const ask = async (message: string, detail: string, confirm: string): Promise<boolean> => {
    const w = d.win()
    const opts = { type: 'warning' as const, buttons: [confirm, 'Cancelar'], defaultId: 1, cancelId: 1, message, detail }
    const { response } = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
    return response === 0
  }

  ipcMain.handle('office:listBackups', (): BackupEntry[] => listBackups(d.dataDir))
  ipcMain.handle('office:openBackupsFolder', async () => {
    const dir = backupsDir(d.dataDir)
    // The folder may not exist before the first copy.
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })
  ipcMain.handle('office:restoreBackup', async (_e, id: unknown) => {
    const files = readBackup(d.dataDir, id)
    const entry = listBackups(d.dataDir).find((b) => b.id === id)
    const when = entry ? new Date(entry.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : String(id)
    const yes = await ask(
      `Restaurar o backup de ${when}?`,
      'Agentes, configurações, gastos e tickets voltam a como estavam nesse backup. O estado atual fica salvo antes como um backup "antes de restaurar". Os agentes em andamento param e o app reinicia.',
      'Restaurar e reiniciar',
    )
    if (!yes) return false
    replaceAndRestart(files)
    return true
  })
  ipcMain.handle('office:exportData', async () => {
    d.flush()
    const w = d.win()
    const opts = {
      title: 'Exportar dados do Agent Office',
      defaultPath: join(app.getPath('documents'), `agent-office-dados-${dayKey()}.json`),
      filters: [{ name: 'Dados do Agent Office', extensions: ['json'] }],
    }
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeExport(d.dataDir, r.filePath)
    return r.filePath
  })
  ipcMain.handle('office:importData', async () => {
    const w = d.win()
    const opts = {
      title: 'Importar dados do Agent Office',
      properties: ['openFile' as const],
      filters: [{ name: 'Dados do Agent Office', extensions: ['json'] }],
    }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    const file = r.canceled ? undefined : r.filePaths[0]
    if (!file) return false
    if (statSync(file).size > MAX_IMPORT_BYTES) throw new Error('Esse arquivo é grande demais para ser uma exportação do Agent Office.')
    const exp = parseExport(readFileSync(file, 'utf8'))
    const when = exp.exportedAt ? new Date(exp.exportedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'data desconhecida'
    const yes = await ask(
      'Substituir os dados deste computador?',
      `A exportação de ${when} toma o lugar dos agentes, configurações, gastos e tickets daqui. O estado atual fica salvo antes como um backup "antes de restaurar". ` +
        'Importe só arquivos seus: pastas de contas fora de ~/.claude-<nome> são descartadas e a permissão padrão "sem pedir nada" volta para "pedir permissão". O app reinicia.',
      'Importar e reiniciar',
    )
    if (!yes) return false
    replaceAndRestart(importSet(exp))
    return true
  })
}
