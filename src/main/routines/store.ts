import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROUTINE_LIMITS, type Routine, type RoutineRun } from '@shared/types'
import { backupCopies, shapeOf } from '../backups'
import { loadJson, reportLoad, writeJsonAtomic } from '../fs-safe'

interface Data {
  routines: Routine[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const RUN_STATUSES = new Set(['running', 'waiting', 'ok', 'failed', 'missed', 'skipped'])
const SCHEDULES = new Set(['once', 'daily', 'weekly', 'interval', 'cron'])
const WHO = new Set(['new', 'template', 'agent'])

/**
 * A routine read from routines.json, or null when its core is unusable (no id, name,
 * schedule or runner). The IPC already checked it on save: this only guards against a
 * file edited by hand or written by a newer version.
 */
export function loadRoutine(raw: unknown): Routine | null {
  if (!isObj(raw)) return null
  const r = raw
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.prompt !== 'string') return null
  if (!isObj(r.schedule) || !SCHEDULES.has(r.schedule.kind as string)) return null
  if (!isObj(r.who) || !WHO.has(r.who.kind as string)) return null
  const history = (Array.isArray(r.history) ? r.history : [])
    .filter((x): x is RoutineRun => isObj(x) && typeof x.id === 'string' && typeof x.startedAt === 'number' && RUN_STATUSES.has(x.status as string))
    .slice(0, ROUTINE_LIMITS.history)
    // A run the app was still following when it closed never reports back.
    .map((x) => (x.status === 'running' || x.status === 'waiting' ? { ...x, status: 'failed' as const, endedAt: x.endedAt ?? x.startedAt, error: 'O app fechou antes de a execução terminar.' } : x))
  return {
    ...(r as unknown as Routine),
    enabled: r.enabled !== false,
    missed: r.missed === 'skip' ? 'skip' : 'run',
    nextAt: typeof r.nextAt === 'number' ? r.nextAt : null,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    history,
    demo: undefined,
  }
}

/**
 * userData/routines.json, written like office.json: atomically, debounced, never over a
 * file that did not parse (that one is moved aside and the last good copy loads).
 * Demo routines live in memory only.
 */
export class RoutineStore {
  private file: string
  private list: Routine[]
  private timer: NodeJS.Timeout | null = null
  /** Set while a restore or import replaces the files: nothing in memory may land on them. */
  private locked = false

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'routines.json')
    const r = loadJson<Partial<Data>>(this.file, { valid: shapeOf('routines.json'), fallbacks: backupCopies(dir, 'routines.json') })
    reportLoad(this.file, r)
    const raw = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    this.list = (raw.routines ?? []).map(loadRoutine).filter((x): x is Routine => !!x)
    // The copy that loaded goes back under the real name, or the next start would find no file.
    if (r.status === 'restored') this.flush()
  }

  get routines(): Routine[] {
    return this.list
  }

  set routines(list: Routine[]) {
    this.list = list
    this.save()
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.locked) return
    writeJsonAtomic(this.file, { routines: this.list.filter((r) => !r.demo) } satisfies Data)
  }

  /** Writes what is pending, then stops writing for good (the app restarts next). */
  lock(): void {
    this.flush()
    this.locked = true
  }
}
