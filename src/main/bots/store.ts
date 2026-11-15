import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import {
  BOT_COLORS,
  BOT_LIMITS,
  SENSITIVE_KINDS,
  type Bot,
  type BotEventTrigger,
  type BotRun,
  type Channel,
  type Look,
  type SensitiveKind,
} from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { cleanMemory } from '@shared/bots'
import { backupCopies, shapeOf } from '../backups'
import { loadJson, reportLoad, writeFileAtomic, writeJsonAtomic } from '../fs-safe'
import { ThreadFile } from './thread'

interface Data {
  bots: Bot[]
  channels: Channel[]
  eventTriggers: BotEventTrigger[]
}

const DIR_MODE = 0o700
const FILE_MODE = 0o600

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown, max = 10_000): v is string => typeof v === 'string' && v.length <= max
const HEX = /^#[0-9a-f]{6}$/i
const MODES = new Set(['default', 'acceptEdits', 'plan', 'auto'])
const RUN_STATUSES = new Set(['running', 'waiting', 'ok', 'failed', 'skipped'])
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** A thread or bot id that is safe as a folder or file name ('canais' is the channels' folder). */
export const isThreadId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== 'canais'

function isLook(v: unknown): v is Look {
  if (!isObj(v)) return false
  return ['skin', 'hair', 'shirt', 'pants', 'shoes'].every((k) => isStr(v[k], 7) && HEX.test(v[k] as string)) && Number.isInteger(v.hairStyle)
}

/** A sensitive-kind list; anything that is not one (or an empty list from a bad file) becomes all of them. */
function cleanKinds(v: unknown): SensitiveKind[] {
  if (!Array.isArray(v)) return [...SENSITIVE_KINDS]
  const kinds = SENSITIVE_KINDS.filter((k) => v.includes(k))
  return kinds.length || v.length === 0 ? kinds : [...SENSITIVE_KINDS]
}

/**
 * A bot read from bots.json, or null when its core is unusable (no id, name or job). The IPC
 * checked it on save: this only guards against a file edited by hand or written by a newer
 * version. Never "Sem pedir nada"; a run the app was following when it closed ends as failed.
 */
export function loadBot(raw: unknown): Bot | null {
  if (!isObj(raw)) return null
  const r = raw
  if (!isThreadId(r.id) || !isStr(r.name, BOT_LIMITS.name) || !r.name.trim() || !isStr(r.role, BOT_LIMITS.role)) return null
  const now = Date.now()
  const runs = (Array.isArray(r.runs) ? r.runs : [])
    .filter((x): x is BotRun => isObj(x) && typeof x.id === 'string' && typeof x.startedAt === 'number' && RUN_STATUSES.has(x.status as string))
    .slice(0, BOT_LIMITS.runs)
    .map((x) => (x.status === 'running' || x.status === 'waiting' ? { ...x, status: 'failed' as const, endedAt: x.endedAt ?? x.startedAt, error: 'O app fechou antes de a rodada terminar.' } : x))
  return {
    id: r.id,
    name: r.name.trim(),
    tagline: isStr(r.tagline, BOT_LIMITS.tagline) ? r.tagline : '',
    role: r.role,
    color: BOT_COLORS.includes(r.color as never) ? (r.color as string) : BOT_COLORS[0],
    look: isLook(r.look) ? r.look : lookFromSeed(`bot:${r.id}`),
    floor: isStr(r.floor, 200) && r.floor ? r.floor : 'terreo',
    ...(isStr(r.cwd, 4096) && r.cwd ? { cwd: r.cwd } : {}),
    ...(isStr(r.model, 200) && r.model ? { model: r.model } : {}),
    ...(EFFORTS.has(r.effort as string) ? { effort: r.effort as Bot['effort'] } : {}),
    ...(Array.isArray(r.accounts) ? { accounts: r.accounts.filter((a): a is string => isStr(a, 200)) } : {}),
    // "Sem pedir nada" never loads, whoever wrote the file.
    permissionMode: MODES.has(r.permissionMode as string) ? (r.permissionMode as Bot['permissionMode']) : 'default',
    askBefore: cleanKinds(r.askBefore),
    apps: Array.isArray(r.apps) ? r.apps.filter((a): a is string => isStr(a, 200)) : 'all',
    worktree: r.worktree === true,
    dailyBudgetUsd: typeof r.dailyBudgetUsd === 'number' && Number.isFinite(r.dailyBudgetUsd) && r.dailyBudgetUsd >= 0 ? r.dailyBudgetUsd : 0,
    pinned: r.pinned === true,
    hidden: r.hidden === true,
    order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 0,
    ...(isStr(r.templateId, 100) ? { templateId: r.templateId } : {}),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
    // The agent is not in the office after a restart; the saved conversation comes back with it.
    ...(isStr(r.sessionId, 100) ? { sessionId: r.sessionId } : {}),
    lastReadAt: typeof r.lastReadAt === 'number' ? r.lastReadAt : 0,
    runs,
  }
}

function loadChannel(raw: unknown): Channel | null {
  if (!isObj(raw) || !isThreadId(raw.id) || !isStr(raw.name, BOT_LIMITS.channelName)) return null
  return { ...(raw as unknown as Channel), members: Array.isArray(raw.members) ? raw.members.filter(isThreadId) : [] }
}

function loadTrigger(raw: unknown): BotEventTrigger | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !isThreadId(raw.botId) || typeof raw.prompt !== 'string') return null
  return { ...(raw as unknown as BotEventTrigger), history: Array.isArray(raw.history) ? raw.history.slice(0, BOT_LIMITS.runs) : [] }
}

/**
 * userData/bots.json ({ bots, channels, eventTriggers }), written like routines.json: atomically,
 * debounced, never over a file that did not parse. Each bot's folder (thread and memory) lives in
 * userData/bots/<id>/, channels' threads in userData/bots/canais/<id>.jsonl; folders 0700, files
 * 0600. Demo bots live in memory only, threads included.
 */
export class BotStore {
  private file: string
  private root: string
  private data: Data
  private threads = new Map<string, ThreadFile>()
  private timer: NodeJS.Timeout | null = null
  private locked = false

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'bots.json')
    this.root = resolve(dir, 'bots')
    const r = loadJson<Partial<Data>>(this.file, { valid: shapeOf('bots.json'), fallbacks: backupCopies(dir, 'bots.json') })
    reportLoad(this.file, r)
    const raw = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    this.data = {
      bots: (raw.bots ?? []).map(loadBot).filter((x): x is Bot => !!x),
      channels: (raw.channels ?? []).map(loadChannel).filter((x): x is Channel => !!x),
      eventTriggers: (raw.eventTriggers ?? []).map(loadTrigger).filter((x): x is BotEventTrigger => !!x),
    }
    if (r.status === 'restored') this.flush()
  }

  get bots(): Bot[] {
    return this.data.bots
  }

  set bots(list: Bot[]) {
    this.data.bots = list
    this.save()
  }

  get channels(): Channel[] {
    return this.data.channels
  }

  set channels(list: Channel[]) {
    this.data.channels = list
    this.save()
  }

  get eventTriggers(): BotEventTrigger[] {
    return this.data.eventTriggers
  }

  set eventTriggers(list: BotEventTrigger[]) {
    this.data.eventTriggers = list
    this.save()
  }

  bot(id: string): Bot | undefined {
    return this.data.bots.find((b) => b.id === id)
  }

  /** Replaces one bot (same id) and saves. */
  update(bot: Bot): void {
    this.data.bots = this.data.bots.map((b) => (b.id === bot.id ? bot : b))
    this.save()
  }

  // ---------- threads ----------

  /** The thread of a bot or channel; demo ones stay in memory. */
  thread(threadId: string): ThreadFile {
    if (!isThreadId(threadId)) throw new Error('Conversa inválida.')
    let t = this.threads.get(threadId)
    if (!t) {
      const demo = this.bot(threadId)?.demo === true
      const channel = !this.bot(threadId) && this.data.channels.some((c) => c.id === threadId)
      const file = demo ? null : channel ? join(this.dirOf('canais'), `${threadId}.jsonl`) : join(this.dirOf(threadId), 'fio.jsonl')
      t = new ThreadFile(file)
      this.threads.set(threadId, t)
    }
    return t
  }

  // ---------- memory ----------

  /** memoria.md of the bot ('' when there is none). */
  memory(botId: string): string {
    if (this.bot(botId)?.demo) return this.demoMemory.get(botId) ?? ''
    const file = this.memoryPath(botId)
    try {
      return existsSync(file) ? readFileSync(file, 'utf8') : ''
    } catch {
      return ''
    }
  }

  /** Saves memoria.md, cut at BOT_LIMITS.memoryBytes on a line end. Returns what was kept. */
  setMemory(botId: string, text: string): string {
    const clean = cleanMemory(text)
    if (this.bot(botId)?.demo) {
      this.demoMemory.set(botId, clean)
      return clean
    }
    if (this.locked) return clean
    writeFileAtomic(this.memoryPath(botId), clean, FILE_MODE)
    return clean
  }

  private demoMemory = new Map<string, string>()

  /** userData/bots/<id>/memoria.md: the one file the bot's memory tools may touch. */
  memoryPath(botId: string): string {
    if (!isThreadId(botId)) throw new Error('Bot inválido.')
    return join(this.dirOf(botId), 'memoria.md')
  }

  /** Deletes the bot's folder (thread, memory) and forgets its thread. */
  removeFolder(threadId: string): void {
    if (!isThreadId(threadId)) return
    this.threads.get(threadId)?.discard()
    this.threads.delete(threadId)
    const dir = resolve(this.root, threadId)
    if (dir.startsWith(this.root + sep)) rmSync(dir, { recursive: true, force: true })
    const channel = resolve(this.root, 'canais', `${threadId}.jsonl`)
    if (channel.startsWith(this.root + sep)) rmSync(channel, { force: true })
  }

  // ---------- writing ----------

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const t of this.threads.values()) t.flush()
    if (this.locked) return
    // The bots' jobs and memories are the player's own notes: 0600, like the meetings' index.
    writeJsonAtomic(
      this.file,
      {
        bots: this.data.bots.filter((b) => !b.demo).map(({ agentId: _agentId, ...b }) => b as Bot),
        channels: this.data.channels,
        eventTriggers: this.data.eventTriggers.filter((t) => !this.bot(t.botId)?.demo),
      } satisfies Data,
      { mode: FILE_MODE },
    )
  }

  /** Writes what is pending, then stops writing for good (the app restarts next). */
  lock(): void {
    this.flush()
    for (const t of this.threads.values()) t.lock()
    this.locked = true
  }

  /** userData/bots/<id>, made 0700 with its parent, checked to stay under userData/bots. */
  private dirOf(id: string): string {
    const dir = resolve(this.root, id)
    if (!dir.startsWith(this.root + sep)) throw new Error('Conversa inválida.')
    if (!this.locked) {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE })
      for (const d of [this.root, dir]) {
        try {
          chmodSync(d, DIR_MODE)
        } catch {
          // Windows has no Unix modes
        }
      }
    }
    return dir
  }
}
