import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { DataNotice } from '@shared/types'
import { log } from './log'

/**
 * Durable writes and careful reads for the app's JSON files. No Electron here, so it
 * runs in unit tests as is.
 *
 * Writing: tmp file, fsync, rename, fsync of the folder. Without the fsyncs a power cut
 * right after the rename can leave the name pointing at an empty file. (On macOS fsync
 * reaches the drive's cache, not the platter; F_FULLFSYNC is not exposed by Node.)
 *
 * Reading: a file that is there but does not parse is never written over. It is moved
 * aside as <name>.corrupt-<timestamp>.json and the last good copy (<name>.bak, then the
 * daily backups) is loaded instead.
 */

export interface WriteOptions {
  /** File mode for a new file (e.g. 0o600 for ~/.claude/settings.json). */
  mode?: number
  /** JSON.stringify indent. */
  space?: number
  /** Ends the file with a newline. */
  newline?: boolean
  /** Suffix of the temporary file; '.tmp' by default. Files other programs own get our own name. */
  tmpSuffix?: string
}

/** Writes text atomically and durably: the file holds either the old or the new text, never half. */
export function writeFileAtomic(file: string, text: string, mode?: number, tmpSuffix = '.tmp'): void {
  const tmp = file + tmpSuffix
  const fd = openSync(tmp, 'w', mode)
  try {
    try {
      const buf = Buffer.from(text, 'utf8')
      let off = 0
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
  } catch (err) {
    // A failed write (disk full, rename refused) leaves no half file behind (AO-26).
    rmSync(tmp, { force: true })
    throw err
  }
  fsyncDir(dirname(file))
}

/** The one way the app writes its JSON files. */
export function writeJsonAtomic(file: string, data: unknown, opts: WriteOptions = {}): void {
  writeFileAtomic(file, JSON.stringify(data, null, opts.space) + (opts.newline ? '\n' : ''), opts.mode, opts.tmpSuffix)
}

/** Makes the rename itself durable. Windows cannot open a folder for fsync; NTFS journals renames anyway. */
function fsyncDir(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    // best effort
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// ---------- careful reads ----------

export const bakPath = (file: string): string => `${file}.bak`

/** office.json -> office.corrupt-2026-10-12T14-03-22-123Z.json, next to it. */
export function corruptPath(file: string, now = new Date()): string {
  const ext = extname(file) || '.json'
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return join(dirname(file), `${basename(file, ext)}.corrupt-${stamp}${ext}`)
}

/** What loadJson found. */
export type LoadResult<T> =
  /** The file parsed. */
  | { status: 'ok'; data: T }
  /** No file yet (first run): start fresh, nothing to tell. */
  | { status: 'missing' }
  /** The file was bad; it moved to `corruptPath` and `data` came from `from` (modified at `fromDate`). */
  | { status: 'restored'; data: T; corruptPath: string; from: string; fromDate: number }
  /** The file was bad and no copy parsed: start fresh, but the bad file is kept. */
  | { status: 'lost'; corruptPath: string }

export interface LoadOptions<T> {
  /** Shape check after JSON.parse. Default: a plain object. */
  valid?: (v: unknown) => v is T
  /** Copies to try after <file>.bak, best first (the daily backups). */
  fallbacks?: string[]
  /** Refreshes <file>.bak when the file loads fine. Default true. */
  keepBak?: boolean
  now?: () => Date
}

const isObject = (v: unknown): v is never => !!v && typeof v === 'object' && !Array.isArray(v)

/** JSON.parse that accepts a UTF-8 BOM, which some editors on Windows add when saving. */
export const parseJson = (text: string): unknown => JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

type Parsed<T> = { ok: true; data: T; text: string } | { ok: false; missing: boolean }

function tryRead<T>(file: string, valid: (v: unknown) => v is T): Parsed<T> {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, missing: true }
    throw err
  }
  try {
    const data = parseJson(text)
    if (valid(data)) return { ok: true, data, text }
  } catch {
    // falls through: not JSON
  }
  return { ok: false, missing: false }
}

/**
 * Reads a JSON data file without ever losing it. A missing file is a first run. A file
 * that is empty, cut short or of the wrong shape is renamed aside (if that fails, this
 * throws: better to stop than to write over it), then the backups are tried in order.
 * Other read errors (permissions) throw for the same reason.
 */
export function loadJson<T>(file: string, opts: LoadOptions<T> = {}): LoadResult<T> {
  const valid = opts.valid ?? (isObject as (v: unknown) => v is T)
  const first = tryRead(file, valid)
  if (first.ok) {
    if (opts.keepBak !== false) {
      try {
        writeFileAtomic(bakPath(file), first.text)
      } catch {
        // a missing .bak only matters if the file breaks later
      }
    }
    return { status: 'ok', data: first.data }
  }
  if (first.missing) return { status: 'missing' }

  const moved = corruptPath(file, opts.now?.() ?? new Date())
  renameSync(file, moved)
  for (const copy of [bakPath(file), ...(opts.fallbacks ?? [])]) {
    let r: Parsed<T>
    try {
      r = tryRead(copy, valid)
    } catch {
      continue
    }
    if (r.ok) return { status: 'restored', data: r.data, corruptPath: moved, from: copy, fromDate: statSync(copy).mtimeMs }
  }
  return { status: 'lost', corruptPath: moved }
}

// ---------- notices for the renderer ----------

const LABELS: Record<string, string> = {
  'office.json': 'agentes, configurações e gastos',
  'tickets.json': 'quadro de tickets',
  'tickets-closed.json': 'arquivo de tickets fechados',
  'routines.json': 'rotinas',
}

/** The warning the renderer shows for a restored or lost file; null when there is nothing to say. */
export function noticeFor(file: string, r: LoadResult<unknown>, at = Date.now()): DataNotice | null {
  if (r.status === 'ok' || r.status === 'missing') return null
  const name = basename(file)
  const what = LABELS[name] ?? name
  if (r.status === 'restored') {
    const when = new Date(r.fromDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    return {
      id: `${name}:${at}`,
      at,
      file: name,
      kind: 'restored',
      text: `Seus dados (${what}) estavam corrompidos; restauramos o backup de ${when}. O arquivo original ficou em ${r.corruptPath}.`,
      path: r.corruptPath,
    }
  }
  return {
    id: `${name}:${at}`,
    at,
    file: name,
    kind: 'lost',
    text: `Seus dados (${what}) estavam corrompidos e não havia backup válido; começamos do zero. O arquivo original ficou em ${r.corruptPath}.`,
    path: r.corruptPath,
  }
}

type NoticeListener = (n: DataNotice) => void
const notices: DataNotice[] = []
const listeners = new Set<NoticeListener>()

/** Records the notice of a load (if any) for the renderer. */
export function reportLoad(file: string, r: LoadResult<unknown>): void {
  const n = noticeFor(file, r)
  if (!n) {
    if (r.status === 'ok') log.debug(`Dados: ${basename(file)} carregado; .bak atualizado`)
    return
  }
  log.warn(`Dados: ${basename(file)} corrompido, guardado em ${n.path}; ${r.status === 'restored' ? `carreguei ${r.from}` : 'sem cópia válida, começando do zero'}`)
  notices.push(n)
  for (const l of listeners) l(n)
}

/** Notices so far (shown at startup); new ones also reach `onDataNotice`. */
export const dataNotices = (): DataNotice[] => [...notices]

export function onDataNotice(l: NoticeListener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
