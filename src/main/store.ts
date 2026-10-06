import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentResult, AgentSummary, LogEntry, Settings } from '@shared/types'
import { lookFromSeed } from '@shared/describe'

export interface PersistedAgent {
  summary: AgentSummary
  log: LogEntry[]
}

interface Data {
  settings: Settings
  agents: PersistedAgent[]
  results: AgentResult[]
}

const DEFAULT_SETTINGS: Settings = {
  playerName: 'Você',
  playerLook: { ...lookFromSeed('player'), shirt: '#4a8fe0', hairStyle: 1 },
  pixelSize: 3,
  defaultModel: '',
  defaultPermissionMode: 'default',
  notifications: true,
  bridgePort: 47821,
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
        settings: { ...DEFAULT_SETTINGS, ...raw.settings },
        agents: raw.agents ?? [],
        results: raw.results ?? [],
      }
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, agents: [], results: [] }
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
