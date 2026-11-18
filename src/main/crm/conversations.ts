import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CRM_LIMITS, type ConversationItem, type ConversationPage, type ConversationSummary, type ConversationWaiting } from '@shared/types'
import { previewOf, SYNC_MARGIN_MS } from '@shared/crm-inbound'
import { writeFileAtomic, writeJsonAtomic } from '../fs-safe'
import { log } from '../log'
import { CRM_ID_RE } from '../validate'
import type { ConversationLog, OutItem } from './contracts'

// As conversas de WhatsApp (CR-09): userData/crm/conversas/<clienteId>.jsonl, só anexando (mesmo
// id = atualização, como o fio dos bots). Pastas 0700, arquivos 0600. O texto chega limpo (puro,
// sem controle nem marca de direção). Um índice (index.json) guarda a linha de cada cliente na
// lista de Conversas e a hora da última mensagem vista, para abrir o CRM sem ler todos os fios.

const FILE_MODE = 0o600
const DIR_MODE = 0o700
/** Conversations kept parsed in memory; the rest is read again from disk when asked. */
const CACHE = 50
/** A file with this many more lines than items is rewritten without the old versions. */
const COMPACT_SLACK = 200
/** Deleted numbers kept at most (the oldest go first). */
const FORGOTTEN_MAX = 10_000

/** Ids the conversation accepts: ours (randomUUID) and 'wa-<WhatsApp id>'. Never a path. */
const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,120}$/

type Flag = Extract<ConversationWaiting, 'handoff' | 'new-contact'>

interface Conv {
  items: Map<string, ConversationItem>
  /** waId -> item id. */
  byWa: Map<string, string>
  lines: number
  sorted: ConversationItem[] | null
}

interface Row {
  summary: ConversationSummary
  /** The item the preview shows. */
  itemId: string
  flag?: Flag
}

const ms = z.number().min(0).max(32_503_680_000_000)
const itemSchema = z
  .object({
    id: z.string().regex(ITEM_ID_RE),
    t: ms,
    kind: z.enum(['in', 'out', 'draft', 'notice']),
    text: z
      .string()
      .max(CRM_LIMITS.messageText * 2)
      .optional(),
    draft: z.object({ id: z.string(), text: z.string(), status: z.string() }).passthrough().optional(),
  })
  .passthrough()
  .refine((x) => (x.kind === 'draft' ? !!x.draft : typeof x.text === 'string'))

const indexSchema = z.object({
  v: z.literal(1),
  lastSeen: ms.optional().catch(undefined),
  /** Salt of the deleted numbers' hashes, random per office. */
  salt: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional()
    .catch(undefined),
  /** Deleted customers' numbers (salted sha256, never the number) and when they were deleted. */
  forgotten: z
    .array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), at: ms }))
    .max(FORGOTTEN_MAX)
    .optional()
    .catch(undefined),
  rows: z
    .array(
      z.object({
        summary: z.object({
          customerId: z.string().regex(CRM_ID_RE),
          t: ms,
          preview: z.string().max(400),
          previewKind: z.enum(['in', 'out', 'draft', 'notice']),
          unread: z.number().int().min(0).max(1_000_000),
          waiting: z.enum(['draft', 'handoff', 'blocked', 'new-contact']).optional().catch(undefined),
        }),
        itemId: z.string().regex(ITEM_ID_RE),
        flag: z.enum(['handoff', 'new-contact']).optional().catch(undefined),
      }),
    )
    .max(CRM_LIMITS.customers * 2),
})

function chmod(p: string, mode: number): void {
  try {
    chmodSync(p, mode)
  } catch {
    // Windows, or gone meanwhile
  }
}

export class ConversationStore implements ConversationLog {
  readonly dir: string
  private root: string
  private indexFile: string
  private rows = new Map<string, Row>()
  private cache = new Map<string, Conv>()
  /** waId -> customer, for delivery updates that name only a @lid. Fills as items go in. */
  private waOwner = new Map<string, string>()
  private seenAt: number | undefined
  private salt: string | undefined
  /** Salted hash of a deleted customer's number -> when it was deleted. */
  private forgottenAt = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(userData: string) {
    this.root = join(userData, 'crm')
    this.dir = join(this.root, 'conversas')
    this.indexFile = join(this.dir, 'index.json')
    this.loadIndex()
  }

  // ---------- disco ----------

  private ensureDir(): void {
    if (existsSync(this.dir)) return
    mkdirSync(this.dir, { recursive: true, mode: DIR_MODE })
    for (const d of [this.root, this.dir]) chmod(d, DIR_MODE)
  }

  private file(customerId: string): string {
    if (typeof customerId !== 'string' || !CRM_ID_RE.test(customerId)) throw new Error('Esse cliente não existe mais.')
    return join(this.dir, `${customerId}.jsonl`)
  }

  private readFile(customerId: string): Conv {
    const conv: Conv = { items: new Map(), byWa: new Map(), lines: 0, sorted: null }
    const file = this.file(customerId)
    if (!existsSync(file)) return conv
    let bad = 0
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      conv.lines++
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch {
        bad++
        continue
      }
      const r = itemSchema.safeParse(raw)
      if (!r.success) {
        bad++
        continue
      }
      this.index(conv, r.data as unknown as ConversationItem)
    }
    if (bad) log.warn(`CRM: ${bad} linha(s) ilegível(is) numa conversa; ficaram de fora`)
    if (conv.lines > conv.items.size + COMPACT_SLACK) this.compact(customerId, conv)
    return conv
  }

  /** Rewrites the file with one line per item (the newest version of each). */
  private compact(customerId: string, conv: Conv): void {
    const text = [...conv.items.values()].map((x) => JSON.stringify(x) + '\n').join('')
    try {
      writeFileAtomic(this.file(customerId), text, FILE_MODE)
      chmod(this.file(customerId), FILE_MODE)
      conv.lines = conv.items.size
    } catch (err) {
      log.warn('CRM: não consegui compactar uma conversa', err instanceof Error ? err.message : String(err))
    }
  }

  private index(conv: Conv, item: ConversationItem): void {
    conv.items.set(item.id, item)
    const waId = (item as { waId?: unknown }).waId
    if (typeof waId === 'string') conv.byWa.set(waId, item.id)
    conv.sorted = null
  }

  private conv(customerId: string): Conv {
    const hit = this.cache.get(customerId)
    if (hit) {
      this.cache.delete(customerId)
      this.cache.set(customerId, hit)
      return hit
    }
    const conv = this.readFile(customerId)
    this.cache.set(customerId, conv)
    while (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value as string)
    return conv
  }

  private sorted(conv: Conv): ConversationItem[] {
    // Sort is stable: items with the same time keep the order they arrived in.
    conv.sorted ??= [...conv.items.values()].sort((a, b) => a.t - b.t)
    return conv.sorted
  }

  // ---------- índice ----------

  private loadIndex(): void {
    if (!existsSync(this.indexFile)) {
      if (existsSync(this.dir)) this.rebuild(0)
      return
    }
    try {
      const at = statSync(this.indexFile).mtimeMs
      const r = indexSchema.safeParse(JSON.parse(readFileSync(this.indexFile, 'utf8')))
      if (r.success) {
        this.seenAt = r.data.lastSeen
        this.salt = r.data.salt
        for (const f of r.data.forgotten ?? []) this.forgottenAt.set(f.hash, f.at)
        for (const row of r.data.rows) this.rows.set(row.summary.customerId, row as Row)
        // The app may have closed before the index caught up: files newer than it are read again.
        this.rebuild(at)
        return
      }
    } catch {
      // rebuilt below
    }
    log.warn('CRM: índice das conversas ilegível; refeito a partir dos fios')
    this.rows.clear()
    this.rebuild(0)
  }

  /** Rows from the files changed after `since` (ms; 0 = all). Unread counts of a new row start at 0. */
  private rebuild(since: number): void {
    let files: string[]
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      return
    }
    let changed = false
    for (const f of files) {
      const customerId = f.slice(0, -'.jsonl'.length)
      if (!CRM_ID_RE.test(customerId)) continue
      try {
        // 2 s of slack: some file systems keep the time in whole seconds.
        if (since && statSync(join(this.dir, f)).mtimeMs < since - 2_000 && this.rows.has(customerId)) continue
      } catch {
        continue
      }
      const conv = this.readFile(customerId)
      const all = this.sorted(conv)
      const last = all[all.length - 1]
      if (!last) continue
      const row = this.rows.get(customerId)
      this.rows.set(customerId, {
        summary: { customerId, t: last.t, preview: previewOf(last), previewKind: last.kind, unread: row?.summary.unread ?? 0 },
        itemId: last.id,
        ...(row?.flag ? { flag: row.flag } : {}),
      })
      this.refreshWaiting(customerId, conv)
      for (const x of all) if ((x.kind === 'in' || x.kind === 'out') && x.waId) this.seenAt = Math.max(this.seenAt ?? 0, x.t)
      changed = true
    }
    if (changed) this.save()
  }

  private save(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 300)
    this.timer.unref?.()
  }

  /** Writes the index now, if it changed. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.dirty) return
    this.prune()
    const forgotten = [...this.forgottenAt].map(([hash, at]) => ({ hash, at }))
    try {
      this.ensureDir()
      writeJsonAtomic(
        this.indexFile,
        {
          v: 1,
          ...(this.seenAt !== undefined ? { lastSeen: this.seenAt } : {}),
          ...(forgotten.length && this.salt ? { salt: this.salt, forgotten } : {}),
          rows: [...this.rows.values()],
        },
        { mode: FILE_MODE },
      )
      chmod(this.indexFile, FILE_MODE)
      this.dirty = false
    } catch (err) {
      log.warn('CRM: não consegui gravar o índice das conversas', err instanceof Error ? err.message : String(err))
    }
  }

  /** Why the conversation waits for the player: a draft or a blocked send first, then the flag. */
  private refreshWaiting(customerId: string, conv: Conv): void {
    const row = this.rows.get(customerId)
    if (!row) return
    let waiting: ConversationWaiting | undefined
    for (const x of conv.items.values()) {
      if (x.kind !== 'draft') continue
      if (x.draft.status === 'pending' || x.draft.status === 'held') waiting = 'draft'
      else if (x.draft.status === 'blocked' && !waiting) waiting = 'blocked'
    }
    waiting ??= row.flag
    if (waiting) row.summary.waiting = waiting
    else delete row.summary.waiting
  }

  // ---------- ConversationLog ----------

  put(customerId: string, item: ConversationItem): void {
    const file = this.file(customerId)
    const r = itemSchema.safeParse(item)
    if (!r.success) throw new Error('Item de conversa inválido.')
    const conv = this.conv(customerId)
    const existed = conv.items.has(item.id)
    this.ensureDir()
    const fresh = !existsSync(file)
    appendFileSync(file, JSON.stringify(item) + '\n', { mode: FILE_MODE })
    if (fresh) chmod(file, FILE_MODE)
    conv.lines++
    this.index(conv, item)
    const waId = (item as { waId?: unknown }).waId
    if (typeof waId === 'string') this.waOwner.set(waId, customerId)

    const row = this.rows.get(customerId)
    const summary: ConversationSummary = row?.summary ?? { customerId, t: item.t, preview: '', previewKind: item.kind, unread: 0 }
    const next: Row = { summary, itemId: row?.itemId ?? item.id, ...(row?.flag ? { flag: row.flag } : {}) }
    // The preview follows the newest item; an older one arriving late (sync) does not take it,
    // and an update of the item on show (a delivery, a draft decided) refreshes it.
    if (!row || item.t >= summary.t) {
      summary.t = item.t
      next.itemId = item.id
    }
    if (next.itemId === item.id) {
      summary.preview = previewOf(item)
      summary.previewKind = item.kind
    }
    if (item.kind === 'in' && !existed) summary.unread++
    this.rows.set(customerId, next)
    this.refreshWaiting(customerId, conv)
    if (conv.lines > conv.items.size + COMPACT_SLACK) this.compact(customerId, conv)
    this.save()
  }

  get(customerId: string, itemId: string): ConversationItem | undefined {
    return this.conv(customerId).items.get(itemId)
  }

  /** Outbound messages since `since` (ms), oldest first, whatever their status: the gate filters. */
  sentSince(customerId: string, since: number): OutItem[] {
    return this.sorted(this.conv(customerId)).filter((x): x is OutItem => x.kind === 'out' && x.t >= since)
  }

  page(customerId: string, before?: string, limit: number = CRM_LIMITS.conversationPage): ConversationPage {
    const all = this.sorted(this.conv(customerId))
    let end = all.length
    if (before) {
      const i = all.findIndex((x) => x.id === before)
      if (i >= 0) end = i
    }
    const lim = Math.min(CRM_LIMITS.conversationPage, Math.max(1, Math.floor(limit) || CRM_LIMITS.conversationPage))
    const start = Math.max(0, end - lim)
    return { items: all.slice(start, end), more: start > 0 }
  }

  summaries(): ConversationSummary[] {
    return [...this.rows.values()].map((r) => ({ ...r.summary })).sort((a, b) => b.t - a.t)
  }

  markRead(customerId: string): ConversationSummary | undefined {
    const row = this.rows.get(customerId)
    if (!row) return undefined
    row.summary.unread = 0
    // The player saw the new contact: it leaves "Esperando você" (a draft or a handoff stays).
    if (row.flag === 'new-contact') delete row.flag
    this.refreshWaiting(customerId, this.conv(customerId))
    this.save()
    return { ...row.summary }
  }

  remove(customerId: string): void {
    rmSync(this.file(customerId), { force: true })
    this.rows.delete(customerId)
    this.cache.delete(customerId)
    for (const [waId, owner] of this.waOwner) if (owner === customerId) this.waOwner.delete(waId)
    this.save()
  }

  // ---------- além do contrato (events.ts, CR-14) ----------

  /** The current row of a customer in the Conversas list. */
  summary(customerId: string): ConversationSummary | undefined {
    const row = this.rows.get(customerId)
    return row ? { ...row.summary } : undefined
  }

  /** The item of a WhatsApp message (in or out) in the customer's conversation. */
  findByWaId(customerId: string, waId: string): ConversationItem | undefined {
    const conv = this.conv(customerId)
    const id = conv.byWa.get(waId)
    return id ? conv.items.get(id) : undefined
  }

  /** The customer of a message this session saw (a delivery update that names only a @lid). */
  customerOfWa(waId: string): string | undefined {
    return this.waOwner.get(waId)
  }

  /** "Novo contato" (events.ts) or "Passar para mim" (CR-14) puts the conversation in "Esperando você"; undefined takes the flag off. */
  setWaiting(customerId: string, flag: Flag | undefined): ConversationSummary | undefined {
    const row = this.rows.get(customerId)
    if (!row) return undefined
    if (flag) row.flag = flag
    else delete row.flag
    this.refreshWaiting(customerId, this.conv(customerId))
    this.save()
    return { ...row.summary }
  }

  /** The newest WhatsApp message seen (ms): where the next sync starts. */
  lastSeen(): number | undefined {
    return this.seenAt
  }

  markSeen(t: number): void {
    if (!Number.isFinite(t) || (this.seenAt !== undefined && t <= this.seenAt)) return
    this.seenAt = t
    this.save()
  }

  // ---------- números apagados (LGPD) ----------

  /**
   * "Apagar este cliente": the sync reads again from 30 min before the last message seen, and after
   * a restart it no longer knows which of those it took. Without this, a message from before the
   * delete would bring the customer back as a new contact, text and all. Keeps a salted hash of each
   * number, never the number, and only while a sync can still reach messages from before the delete.
   */
  forgetPhones(phones: readonly string[], at: number): void {
    if (!phones.length) return
    for (const p of phones) this.forgottenAt.set(this.phoneHash(p), at)
    this.dirty = true
    this.flush()
  }

  /** A message from a deleted customer's number, sent before the delete: it stays deleted. */
  forgotten(phone: string, t: number): boolean {
    if (!this.forgottenAt.size) return false
    const at = this.forgottenAt.get(this.phoneHash(phone))
    return at !== undefined && t <= at
  }

  private phoneHash(phone: string): string {
    this.salt ??= randomBytes(16).toString('hex')
    return createHash('sha256').update(`${this.salt}:${phone}`, 'utf8').digest('hex')
  }

  /** Drops the numbers no sync can reach any more, and the oldest past the cap. */
  private prune(): void {
    const reach = Math.min(this.seenAt ?? 0, Date.now()) - SYNC_MARGIN_MS - 60_000
    for (const [hash, at] of this.forgottenAt) if (at < reach) this.forgottenAt.delete(hash)
    if (this.forgottenAt.size <= FORGOTTEN_MAX) return
    const oldest = [...this.forgottenAt].sort((a, b) => a[1] - b[1]).slice(0, this.forgottenAt.size - FORGOTTEN_MAX)
    for (const [hash] of oldest) this.forgottenAt.delete(hash)
  }
}
