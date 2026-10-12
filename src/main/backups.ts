import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { BackupEntry } from '@shared/types'
import { writeFileAtomic, writeJsonAtomic } from './fs-safe'

/**
 * Copies of the app's data in userData/backups/. No Electron here (the folder comes in),
 * so it runs in unit tests as is.
 *
 * - <AAAA-MM-DD>/: one a day, taken at startup and checked every hour; the last 14 stay.
 * - antes-<timestamp>/: the state just before a restore or an import; the last 5 stay.
 *
 * stats.json stays out: it is rebuilt from the transcripts and can be large.
 */

export const DATA_FILES = ['office.json', 'tickets.json', 'tickets-closed.json'] as const
export type DataFile = (typeof DATA_FILES)[number]

export const KEEP_DAILY = 14
export const KEEP_SNAPSHOTS = 5
const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/
const SNAPSHOT_RE = /^antes-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{3})?$/

export const backupsDir = (dataDir: string): string => join(dataDir, 'backups')

/** Local day as AAAA-MM-DD. */
export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const isBackupId = (id: unknown): id is string => typeof id === 'string' && (DAILY_RE.test(id) || SNAPSHOT_RE.test(id))

/** Copies the data files that parse into `dest`. A broken file is never copied over a good backup. */
function copyGood(dataDir: string, dest: string): string[] {
  mkdirSync(dest, { recursive: true })
  const copied: string[] = []
  for (const name of DATA_FILES) {
    const src = join(dataDir, name)
    let text: string
    try {
      text = readFileSync(src, 'utf8')
      JSON.parse(text)
    } catch {
      continue
    }
    writeFileAtomic(join(dest, name), text)
    copied.push(name)
  }
  return copied
}

function folders(dir: string, re: RegExp): string[] {
  try {
    return readdirSync(dir).filter((n) => re.test(n) && statSync(join(dir, n)).isDirectory()).sort()
  } catch {
    return []
  }
}

/** Keeps the newest `keep` folders matching `re`. */
function prune(dir: string, re: RegExp, keep: number): void {
  const list = folders(dir, re)
  for (const n of list.slice(0, Math.max(0, list.length - keep))) rmSync(join(dir, n), { recursive: true, force: true })
}

/** Today's copy, once a day. Returns the folder when it made one. */
export function dailyBackup(dataDir: string, now = new Date()): string | null {
  const dir = backupsDir(dataDir)
  const dest = join(dir, dayKey(now))
  if (existsSync(dest)) return null
  if (!DATA_FILES.some((n) => existsSync(join(dataDir, n)))) return null
  copyGood(dataDir, dest)
  prune(dir, DAILY_RE, KEEP_DAILY)
  return dest
}

/** A copy of the current state before something replaces it (restore, import). */
export function snapshot(dataDir: string, now = new Date()): string {
  const dir = backupsDir(dataDir)
  const dest = join(dir, `antes-${now.toISOString().slice(0, 23).replace(/[:.]/g, '-')}`)
  copyGood(dataDir, dest)
  prune(dir, SNAPSHOT_RE, KEEP_SNAPSHOTS)
  return dest
}

/** Backups, newest first. */
export function listBackups(dataDir: string): BackupEntry[] {
  const dir = backupsDir(dataDir)
  const out: BackupEntry[] = []
  for (const id of [...folders(dir, DAILY_RE), ...folders(dir, SNAPSHOT_RE)]) {
    const path = join(dir, id)
    const files = DATA_FILES.filter((n) => existsSync(join(path, n)))
    const size = files.reduce((sum, n) => sum + statSync(join(path, n)).size, 0)
    out.push({ id, kind: DAILY_RE.test(id) ? 'daily' : 'snapshot', at: statSync(path).mtimeMs, size, files })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Copies of one data file in the daily backups, newest first: fallbacks for a corrupt file. */
export function backupCopies(dataDir: string, name: DataFile): string[] {
  const dir = backupsDir(dataDir)
  return folders(dir, DAILY_RE)
    .reverse()
    .map((id) => join(dir, id, name))
    .filter((p) => existsSync(p))
}

/**
 * Puts a set of files in place of the data files. A data file the set does not have is
 * removed, so the result is exactly the set. The caller stops writing (Store/TicketBoard
 * lock) and takes a snapshot first.
 */
export type DataSet = Partial<Record<DataFile, string>>

export function replaceData(dataDir: string, files: DataSet): void {
  for (const name of DATA_FILES) {
    const target = join(dataDir, name)
    const text = files[name]
    if (text !== undefined) writeFileAtomic(target, text)
    else rmSync(target, { force: true })
    // The .bak of the old state would win over the restored file if it broke.
    rmSync(`${target}.bak`, { force: true })
  }
}

/** The files of a backup, checked: throws before anything changes when it cannot be used. */
export function readBackup(dataDir: string, id: unknown): DataSet {
  if (!isBackupId(id)) throw new Error('Backup inválido.')
  const path = join(backupsDir(dataDir), id)
  if (!existsSync(path)) throw new Error('Esse backup não existe mais.')
  const files: DataSet = {}
  for (const name of DATA_FILES) {
    const p = join(path, name)
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    JSON.parse(text) // a broken backup throws before anything changes
    files[name] = text
  }
  if (!files['office.json'] && !files['tickets.json']) throw new Error('Esse backup está vazio.')
  return files
}

export function restoreBackup(dataDir: string, id: unknown): void {
  replaceData(dataDir, readBackup(dataDir, id))
}

// ---------- export / import ----------

/**
 * Export is one JSON file holding the parsed data files, not a .zip: Node has no zip
 * writer and the data is only JSON, so a dependency would buy nothing. The file opens in
 * any editor, and import checks the format before touching anything.
 */
export const EXPORT_FORMAT = 'agent-office-dados'
export const EXPORT_VERSION = 1

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt: string
  files: Partial<Record<DataFile, unknown>>
}

export function buildExport(dataDir: string, now = new Date()): ExportFile {
  const files: ExportFile['files'] = {}
  for (const name of DATA_FILES) {
    try {
      files[name] = JSON.parse(readFileSync(join(dataDir, name), 'utf8'))
    } catch {
      // missing (no closed tickets yet) or broken: left out
    }
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), files }
}

export function writeExport(dataDir: string, dest: string): void {
  writeJsonAtomic(dest, buildExport(dataDir))
}

/** Checks an export file; throws with a message for the user when it is not one. */
export function parseExport(text: string): ExportFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Esse arquivo não é um JSON válido.')
  }
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (r.format !== EXPORT_FORMAT) throw new Error('Esse arquivo não é uma exportação do Agent Office.')
  if (typeof r.version !== 'number' || r.version > EXPORT_VERSION) throw new Error('Essa exportação veio de uma versão mais nova do Agent Office. Atualize o app.')
  const files = (r.files && typeof r.files === 'object' ? r.files : {}) as Record<string, unknown>
  const out: ExportFile['files'] = {}
  for (const name of DATA_FILES) {
    const v = files[name]
    if (v === undefined) continue
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${name} está num formato inesperado na exportação.`)
    out[name] = v
  }
  if (!out['office.json']) throw new Error('A exportação não tem office.json (agentes e configurações).')
  return { format: EXPORT_FORMAT, version: r.version, exportedAt: String(r.exportedAt ?? ''), files: out }
}

/**
 * An export can come from another machine (or someone else). Account folders move to this
 * home and must look like the ones the app makes (~/.claude-<nome>): a free path would
 * get symlinks to ~/.claude written into it. The default permission mode never arrives
 * as "bypass": that has to be a choice made here.
 */
export function sanitizeImportedOffice(office: unknown, home = homedir()): unknown {
  if (!office || typeof office !== 'object') return office
  const o = office as Record<string, unknown>
  const settings = o.settings && typeof o.settings === 'object' ? { ...(o.settings as Record<string, unknown>) } : undefined
  if (!settings) return o
  if (Array.isArray(settings.accounts)) {
    settings.accounts = settings.accounts.flatMap((a: unknown) => {
      if (!a || typeof a !== 'object') return []
      const acc = { ...(a as Record<string, unknown>) }
      if (acc.configDir === undefined) return [acc]
      const name = typeof acc.configDir === 'string' ? basename(acc.configDir) : ''
      return /^\.claude-[\w-]{1,80}$/.test(name) ? [{ ...acc, configDir: join(home, name) }] : []
    })
  }
  if (settings.defaultPermissionMode === 'bypassPermissions') settings.defaultPermissionMode = 'default'
  return { ...o, settings }
}

/** The files an export (already checked by parseExport) puts in place. */
export function importSet(exp: ExportFile, home = homedir()): DataSet {
  const files: DataSet = {}
  for (const name of DATA_FILES) {
    const v = name === 'office.json' ? sanitizeImportedOffice(exp.files[name], home) : exp.files[name]
    if (v !== undefined) files[name] = JSON.stringify(v)
  }
  return files
}

export function applyImport(dataDir: string, exp: ExportFile, home = homedir()): void {
  replaceData(dataDir, importSet(exp, home))
}
