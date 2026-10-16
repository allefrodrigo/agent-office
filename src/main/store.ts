import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentResult, AgentSummary, Ledger, LogEntry, Settings } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { floorNameFor } from '@shared/projects'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { DEFAULT_VIDEO } from '@shared/video'
import { mainAccount } from './accounts'
import { loadTemplates } from './templates'
import type { SessionMark } from './ledger'
import { backupCopies, shapeOf } from './backups'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'
import { cleanVideo } from './validate'

export interface PersistedAgent {
  summary: AgentSummary
  log: LogEntry[]
  /** False while the conversation has not begun (new or just cleared): there is nothing to resume yet. Missing = older file, assumed begun. */
  started?: boolean
}

interface Data {
  settings: Settings
  agents: PersistedAgent[]
  results: AgentResult[]
  /** The cost book. */
  ledger: Ledger
  /** Last cumulative cost seen per session, so a resumed session is not counted twice. */
  ledgerSessions: Record<string, SessionMark>
}

const emptyLedger = (): Ledger => ({ days: {}, agents: {}, switches: [] })

const DEFAULT_SETTINGS: Settings = {
  playerName: 'Você',
  playerLook: { ...lookFromSeed('player'), shirt: '#4a8fe0', hairStyle: 1 },
  pixelSize: 3,
  defaultModel: '',
  defaultEffort: '',
  defaultPermissionMode: 'default',
  notifications: true,
  bridgePort: 47821,
  projects: [],
  accounts: [mainAccount()],
  defaultAccounts: [],
  ticketAutoCloseDays: 7,
  maxSubagents: 10,
  agentBudgetUsd: 0,
  templates: [],
  video: DEFAULT_VIDEO,
}

/** Up to v0.2 one squad folder made a single squad floor; it becomes the first project floor. */
function migrateSettings(raw: Record<string, unknown> | undefined): Settings {
  const { squadFolder, squadFloorName, ...rest } = (raw ?? {}) as Record<string, unknown>
  const settings = { ...DEFAULT_SETTINGS, ...rest } as Settings
  if (!Array.isArray(settings.projects)) settings.projects = []
  if (!Array.isArray(settings.accounts)) settings.accounts = []
  // The main login (~/.claude) is always there, first.
  if (!settings.accounts.some((a) => a.id === MAIN_ACCOUNT)) settings.accounts = [mainAccount(), ...settings.accounts]
  if (!Array.isArray(settings.defaultAccounts)) settings.defaultAccounts = []
  // Older files have no Vídeo section; a bad value falls back to the default.
  settings.video = cleanVideo(settings.video, DEFAULT_VIDEO)
  if (!('projects' in rest) && typeof squadFolder === 'string' && squadFolder) {
    const name = typeof squadFloorName === 'string' && squadFloorName.trim() ? squadFloorName.trim() : floorNameFor(squadFolder)
    settings.projects = [{ id: 'p1', name, cwd: squadFolder }]
  }
  // Templates came in v0.3.4: older files have none, and a broken one is dropped, not fatal.
  settings.templates = loadTemplates(settings.templates, settings.projects)
  return settings
}

/** Small JSON store in the app's userData folder, written atomically and debounced. */
export class Store {
  private file: string
  private data: Data
  private timer: NodeJS.Timeout | null = null
  private dir: string
  /** Set while a restore or import replaces the files: nothing in memory may land on them. */
  private locked = false

  constructor() {
    this.dir = app.getPath('userData')
    mkdirSync(this.dir, { recursive: true })
    this.file = join(this.dir, 'office.json')
    this.data = this.load()
  }

  private load(): Data {
    // A broken office.json is moved aside and the last good copy loads instead (AO-24).
    const r = loadJson<Partial<Data>>(this.file, { valid: shapeOf('office.json'), fallbacks: backupCopies(this.dir, 'office.json') })
    reportLoad(this.file, r)
    const raw: Partial<Data> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    return {
      settings: migrateSettings(raw.settings as Record<string, unknown> | undefined),
      agents: raw.agents ?? [],
      results: raw.results ?? [],
      ledger: { ...emptyLedger(), ...raw.ledger },
      ledgerSessions: raw.ledgerSessions ?? {},
    }
  }

  get settings(): Settings {
    return this.data.settings
  }

  set settings(s: Settings) {
    this.data.settings = s
    this.save()
  }

  get agents(): PersistedAgent[] {
    return this.data.agents
  }

  set agents(a: PersistedAgent[]) {
    this.data.agents = a
    this.save()
  }

  get results(): AgentResult[] {
    return this.data.results
  }

  set results(r: AgentResult[]) {
    this.data.results = r
    this.save()
  }

  /** Mutated in place by the Ledger, which calls save(). */
  get ledger(): Ledger {
    return this.data.ledger
  }

  get ledgerSessions(): Record<string, SessionMark> {
    return this.data.ledgerSessions
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 800)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.locked) return
    writeJsonAtomic(this.file, this.data)
  }

  /** Writes what is pending, then stops writing for good (the app restarts next). */
  lock(): void {
    this.flush()
    this.locked = true
  }
}
