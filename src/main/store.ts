import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentResult, AgentSummary, Ledger, LogEntry, Settings } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { floorNameFor } from '@shared/projects'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { mainAccount } from './accounts'
import { loadTemplates } from './templates'
import type { SessionMark } from './ledger'

export interface PersistedAgent {
  summary: AgentSummary
  log: LogEntry[]
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
  if (!('projects' in rest) && typeof squadFolder === 'string' && squadFolder) {
    const name = typeof squadFloorName === 'string' && squadFloorName.trim() ? squadFloorName.trim() : floorNameFor(squadFolder)
    settings.projects = [{ id: 'p1', name, cwd: squadFolder }]
  }
  // Templates came in v0.3.3: older files have none, and a broken one is dropped, not fatal.
  settings.templates = loadTemplates(settings.templates, settings.projects)
  return settings
}

/** Small JSON store in the app's userData folder, written atomically and debounced. */
export class Store {
  private file: string
  private data: Data
  private timer: NodeJS.Timeout | null = null

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'office.json')
    this.data = this.load()
  }

  private load(): Data {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Data>
      return {
        settings: migrateSettings(raw.settings as Record<string, unknown> | undefined),
        agents: raw.agents ?? [],
        results: raw.results ?? [],
        ledger: { ...emptyLedger(), ...raw.ledger },
        ledgerSessions: raw.ledgerSessions ?? {},
      }
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, agents: [], results: [], ledger: emptyLedger(), ledgerSessions: {} }
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
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }
}
