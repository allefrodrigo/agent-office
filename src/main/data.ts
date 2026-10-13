import { app, dialog, ipcMain, powerMonitor, shell, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupEntry, OfficeEvent } from '@shared/types'
import { backupsDir, dailyBackup, dayKey, importSet, keptBy, listBackups, parseExport, readBackup, replaceData, snapshot, writeExport, type DataFile, type DataSet } from './backups'
import { onDataNotice } from './fs-safe'
import { log } from './log'

const HOUR = 3_600_000

const WHAT: Record<DataFile, string> = {
  'office.json': 'agentes, configurações e gastos',
  'tickets.json': 'tickets',
  'tickets-closed.json': 'arquivo de tickets fechados',
}

/** What a restore or import leaves as it is, for the confirmation (AO-25). */
function keptNote(files: DataSet, subject: string): string {
  const kept = keptBy(files)
  return kept.length ? ` ${subject} não tem ${kept.map((n) => WHAT[n]).join(' nem ')}: o que existe hoje fica como está.` : ''
}
/** Exports are a few MB; anything far bigger is not one. */
const MAX_IMPORT_BYTES = 256 * 1024 * 1024

/**
 * Saves the pending (debounced) data whenever the app may die without before-quit:
 * kill -TERM, Ctrl+C, the Mac going to sleep or shutting down. Crashes in the main
 * process are crash.ts's (onFatalFlush).
 *
 * A signal runs the before-quit work itself and leaves with app.exit: app.quit can be
 * held up (the fatal error dialog is modal), and the process was asked to end.
 */
export function flushOnExit(d: { flush: () => void; stopAll: () => void }): void {
  const safe = (why: string, fn: () => void) => {
    try {
      fn()
      return true
    } catch (err) {
      log.error(`Falha ao salvar os dados (${why}):`, err)
      return false
    }
  }
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      log.info(`${sig} recebido: salvando e saindo`)
      safe(sig, d.stopAll)
      // stopAll flushes last; again in case something before it threw.
      safe(sig, d.flush)
      app.exit(0)
    })
  }
  powerMonitor.on('suspend', () => safe('suspend', d.flush) && log.info('Dados salvos antes de dormir'))
  powerMonitor.on('shutdown', () => safe('shutdown', d.flush) && log.info('Dados salvos antes de desligar'))
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
      const made = dailyBackup(d.dataDir)
      if (made) log.info(`Backup diário em ${made}`)
    } catch (err) {
      log.error('Backup diário falhou:', err)
    }
  }
  daily()
  setInterval(daily, HOUR).unref()

  /** Saves the current state as a backup, puts `files` in place and starts the app again. */
  const replaceAndRestart = (files: DataSet) => {
    d.stopAll()
    d.lock()
    const before = snapshot(d.dataDir)
    replaceData(d.dataDir, files)
    log.info(`Dados substituídos (${Object.keys(files).join(', ')}); estado anterior em ${before}. Reiniciando`)
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
    // A daily backup has a day, not a time (its date comes from the folder name).
    const when = entry
      ? new Date(entry.at).toLocaleString('pt-BR', entry.kind === 'daily' ? { dateStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' })
      : String(id)
    const yes = await ask(
      `Restaurar o backup de ${when}?`,
      'Agentes, configurações, gastos e tickets voltam a como estavam nesse backup.' +
        keptNote(files, 'Esse backup') +
        ' O estado atual fica salvo antes como um backup "antes de restaurar". Os agentes em andamento param e o app reinicia.',
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
    const set = importSet(exp)
    const yes = await ask(
      'Substituir os dados deste computador?',
      `A exportação de ${when} toma o lugar dos agentes, configurações, gastos e tickets daqui.${keptNote(set, 'Essa exportação')} O estado atual fica salvo antes como um backup "antes de restaurar". ` +
        'Importe só arquivos seus: pastas de contas fora de ~/.claude-<nome> são descartadas e a permissão padrão "sem pedir nada" volta para "pedir permissão". O app reinicia.',
      'Importar e reiniciar',
    )
    if (!yes) return false
    replaceAndRestart(set)
    return true
  })
}
