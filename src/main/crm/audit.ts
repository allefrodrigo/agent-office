import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MessageCategory } from '@shared/types'
import { writeFileAtomic } from '../fs-safe'
import { log } from '../log'
import type { AuditEntry, AuditLog } from './contracts'

// Auditoria do CRM (CR-13): userData/crm/auditoria.jsonl, uma linha por envio e por decisão do portão.
// Só anexa. Nunca guarda o texto, só o sha256 dele. "Apagar este cliente" reescreve as linhas daquele
// cliente com a data, a categoria e o hash; fora isso, o arquivo só cresce.

const FILE_MODE = 0o600
const DIR_MODE = 0o700
export const AUDIT_FILE = 'auditoria.jsonl'

/** sha256 of the final text, hex: what the audit keeps instead of the text. */
export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** A line after "Apagar este cliente": only date, category and hash. */
export interface ForgottenAuditEntry {
  t: number
  category: MessageCategory
  hash: string
  forgotten: true
}

export type AuditLine = AuditEntry | ForgottenAuditEntry

function chmod(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch {
    // Windows has no Unix modes
  }
}

/** Only the fields the audit keeps, in a fixed order: an extra field (a text, a phone) never reaches the file. */
function line(e: AuditEntry): string {
  const by: AuditEntry['by'] =
    e.by.kind === 'bot' ? { kind: 'bot', botId: e.by.botId } : ({ kind: e.by.kind } as Exclude<AuditEntry['by'], { kind: 'bot' }>)
  const out: AuditEntry = { t: e.t, customerId: e.customerId, category: e.category, by, outcome: e.outcome, rule: e.rule, hash: e.hash }
  if (e.key) out.key = e.key
  if (e.override === true) out.override = true
  return `${JSON.stringify(out)}\n`
}

/** A stored line as an object, or null when it is not one. */
function parseLine(raw: string): Partial<AuditEntry> | null {
  try {
    const e: unknown = JSON.parse(raw)
    return e && typeof e === 'object' && !Array.isArray(e) ? (e as Partial<AuditEntry>) : null
  } catch {
    return null
  }
}

/** userData/crm/auditoria.jsonl: folder 0700, file 0600, appended one line at a time. */
export class AuditFile implements AuditLog {
  readonly file: string

  constructor(userData: string) {
    const dir = join(userData, 'crm')
    mkdirSync(dir, { recursive: true, mode: DIR_MODE })
    chmod(dir, DIR_MODE)
    this.file = join(dir, AUDIT_FILE)
    if (existsSync(this.file)) chmod(this.file, FILE_MODE)
  }

  /** Appends the line. A disk that refuses it is logged, never thrown: the send already happened or was decided. */
  record(e: AuditEntry): void {
    try {
      const fresh = !existsSync(this.file)
      appendFileSync(this.file, line(e), { mode: FILE_MODE })
      if (fresh) chmod(this.file, FILE_MODE)
    } catch (err) {
      log.warn(`CRM: a auditoria não gravou uma linha (${e.outcome}, regra ${e.rule}): ${(err as Error).message}`)
    }
  }

  /**
   * "Apagar este cliente": the customer's lines keep only date, category and hash. Other lines stay
   * byte for byte; a damaged line that names the customer becomes { damaged: true }.
   */
  forget(customerId: string): void {
    if (!customerId || !existsSync(this.file)) return
    const lines = readFileSync(this.file, 'utf8').split('\n')
    let changed = 0
    const out = lines.map((raw) => {
      if (!raw.includes(customerId)) return raw
      const e = parseLine(raw)
      if (e && e.customerId === customerId) {
        changed++
        const kept: ForgottenAuditEntry = {
          t: Number(e.t) || 0,
          category: e.category ?? 'service',
          hash: String(e.hash ?? ''),
          forgotten: true,
        }
        return JSON.stringify(kept)
      }
      // Another customer's line ('c1' inside 'c10') stays; a damaged line that names the customer goes.
      if (e) return raw
      changed++
      return JSON.stringify({ damaged: true })
    })
    if (!changed) return
    writeFileAtomic(this.file, out.join('\n'), FILE_MODE)
    chmod(this.file, FILE_MODE)
    log.info(`CRM: auditoria esqueceu ${changed} linha(s) de um cliente apagado`)
  }

  /** Every line that parses, oldest first (tests and the weekly report). */
  read(): AuditLine[] {
    if (!existsSync(this.file)) return []
    const out: AuditLine[] = []
    for (const raw of readFileSync(this.file, 'utf8').split('\n')) {
      // A damaged line is skipped.
      const e = parseLine(raw)
      if (e && typeof e.t === 'number') out.push(e as AuditLine)
    }
    return out
  }
}
