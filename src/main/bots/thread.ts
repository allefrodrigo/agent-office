import { appendFileSync, chmodSync, existsSync, readFileSync } from 'node:fs'
import { BOT_LIMITS, type ThreadItem, type ThreadPage } from '@shared/types'
import { foldThread, searchItems } from '@shared/bots'
import { writeFileAtomic } from '../fs-safe'

const FILE_MODE = 0o600
/** Updates of the same item (a run counting its steps) wait this long and land as one line. */
const DEBOUNCE_MS = 500

/**
 * One thread: an append-only JSONL file (docs/adr/0013's pattern, under userData/bots). A line
 * whose id was seen updates that item, which keeps its first place (foldThread). Updates wait a
 * moment and land as one line each; when the file has more than twice the lines it needs, it is
 * rewritten with one line per item, the newest BOT_LIMITS.threadItems.
 *
 * `file` null: demo mode, the thread lives in memory only.
 */
export class ThreadFile {
  private items: ThreadItem[] | null = null
  private index = new Map<string, number>()
  /** Lines in the file now (read on first use). */
  private lines = 0
  private pending = new Map<string, ThreadItem>()
  private timer: NodeJS.Timeout | null = null
  private locked = false

  constructor(private file: string | null) {}

  /** Every item, oldest first. */
  all(): ThreadItem[] {
    return this.load()
  }

  get(id: string): ThreadItem | undefined {
    const items = this.load()
    const k = this.index.get(id)
    return k === undefined ? undefined : items[k]
  }

  /** Adds the item, or replaces the one with its id (same place). Written a moment later. */
  put(item: ThreadItem): void {
    const items = this.load()
    const k = this.index.get(item.id)
    if (k === undefined) {
      this.index.set(item.id, items.length)
      items.push(item)
      if (items.length > BOT_LIMITS.threadItems) this.trim()
    } else items[k] = item
    if (!this.file) return
    this.pending.set(item.id, item)
    this.timer ??= setTimeout(() => this.flush(), DEBOUNCE_MS)
  }

  /** Items before `before` (an item id; missing = the end), the newest `limit` of them, oldest first. */
  page(before?: string, limit: number = BOT_LIMITS.page): ThreadPage {
    const items = this.load()
    const end = before === undefined ? items.length : (this.index.get(before) ?? items.length)
    const start = Math.max(0, end - Math.max(1, Math.min(limit, BOT_LIMITS.page)))
    return { items: items.slice(start, end), more: start > 0 }
  }

  /** Items holding every word of the query, newest first. */
  search(query: string, limit = 50): ThreadItem[] {
    return searchItems(this.load(), query, limit)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.file || this.locked || !this.pending.size) return
    const text = [...this.pending.values()].map((i) => JSON.stringify(i)).join('\n') + '\n'
    this.pending.clear()
    appendFileSync(this.file, text, { mode: FILE_MODE })
    this.lines += text.split('\n').length - 1
    if (this.lines > 2 * this.load().length + 20) this.compact()
  }

  /** Writes what is pending, then stops writing for good (the app restarts next). */
  lock(): void {
    this.flush()
    this.locked = true
  }

  /** One line per item, atomically. */
  compact(): void {
    if (!this.file || this.locked) return
    const items = this.load()
    writeFileAtomic(this.file, items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''), FILE_MODE)
    try {
      chmodSync(this.file, FILE_MODE)
    } catch {
      // Windows has no Unix modes
    }
    this.lines = items.length
  }

  /** Drops what is pending without writing it (the thread is being deleted). */
  discard(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
    this.locked = true
  }

  private load(): ThreadItem[] {
    if (this.items) return this.items
    let text = ''
    if (this.file && existsSync(this.file)) {
      try {
        text = readFileSync(this.file, 'utf8')
      } catch {
        text = ''
      }
    }
    this.lines = text ? text.split('\n').filter((l) => l.trim()).length : 0
    this.items = foldThread(text)
    this.reindex()
    if (this.items.length > BOT_LIMITS.threadItems) this.trim()
    return this.items
  }

  /** Keeps the newest BOT_LIMITS.threadItems; the file follows on the next compaction. */
  private trim(): void {
    if (!this.items) return
    this.items = this.items.slice(-BOT_LIMITS.threadItems)
    this.reindex()
    if (this.file && !this.locked) {
      // Written now, pending updates included: an old line must not bring a dropped item back.
      this.lines = Number.MAX_SAFE_INTEGER
    }
  }

  private reindex(): void {
    this.index.clear()
    this.items?.forEach((item, k) => this.index.set(item.id, k))
  }
}
