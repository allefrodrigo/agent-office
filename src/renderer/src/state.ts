import type { Account, AccountStatus, AgentResult, AgentSummary, BgProcess, BridgeStatus, LedgerToday, LogEntry, MacJob, OfficeEvent, OfficeState, PermissionRequest, PlanUsage, QuitWait, Routine, Settings, SquadInfo, SystemStats, Ticket } from '@shared/types'

type Listener = () => void

/** Same cap as the main process keeps per subagent. */
const SUB_LOG_KEEP = 500

/** Renderer-side mirror of the main process state, fed by office events. */
export class State {
  agents = new Map<string, AgentSummary>()
  permissions = new Map<string, PermissionRequest>()
  results = new Map<string, AgentResult>()
  logs = new Map<string, LogEntry[]>()
  /** Subagent logs already fetched, by `${agentId}/${subId}`. */
  subLogs = new Map<string, LogEntry[]>()
  tickets = new Map<string, Ticket>()
  settings: Settings
  bridge: BridgeStatus
  platform: string
  /** One per account. */
  usage: PlanUsage[]
  accounts: AccountStatus[]
  system: SystemStats | null
  squads: SquadInfo[]
  /** Today's spend from the cost book: it survives dismissals and zeroes at local midnight. */
  ledgerToday: LedgerToday
  /** Running on battery (the scene may be in Economia). */
  onBattery: boolean
  /** What the agents left running in the background (Bastidores). */
  backstage: BgProcess[]
  /** Scheduled tasks (the routines board on every floor). */
  routines: Routine[]
  /** The Mac's own scheduled jobs (launchd), beside the routines. */
  macJobs: MacJob[]
  /** The café corner holds the screen awake. */
  caffeineAwake: boolean
  /** Leaving once the agents finish (the "saindo" banner); null = staying. */
  quitWait: QuitWait | null = null
  private listeners = new Set<Listener>()
  private logListeners = new Set<(agentId: string, entry: LogEntry) => void>()
  private subLogListeners = new Set<(agentId: string, subId: string, entries: LogEntry[]) => void>()

  constructor(initial: OfficeState) {
    for (const a of initial.agents) this.agents.set(a.id, a)
    for (const p of initial.permissions) this.permissions.set(p.id, p)
    for (const r of initial.results) this.results.set(r.id, r)
    for (const t of initial.tickets) this.tickets.set(t.id, t)
    this.settings = initial.settings
    this.bridge = initial.bridge
    this.platform = initial.platform
    this.usage = initial.usage
    this.accounts = initial.accounts
    this.system = initial.system
    this.squads = initial.squads
    this.ledgerToday = initial.ledgerToday ?? { day: '', costByCwd: {}, agents: {} }
    this.onBattery = initial.onBattery ?? false
    this.backstage = initial.backstage ?? []
    this.routines = initial.routines ?? []
    this.macJobs = initial.macJobs ?? []
    this.caffeineAwake = initial.caffeineAwake ?? false
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onLog(cb: (agentId: string, entry: LogEntry) => void): () => void {
    this.logListeners.add(cb)
    return () => this.logListeners.delete(cb)
  }

  onSubLog(cb: (agentId: string, subId: string, entries: LogEntry[]) => void): () => void {
    this.subLogListeners.add(cb)
    return () => this.subLogListeners.delete(cb)
  }

  account(id: string | undefined): Account | undefined {
    return this.settings.accounts.find((a) => a.id === id)
  }

  private changed(): void {
    for (const l of this.listeners) l()
  }

  apply(e: OfficeEvent): void {
    switch (e.type) {
      case 'agent:upsert':
        this.agents.set(e.agent.id, e.agent)
        break
      case 'agent:removed':
        this.agents.delete(e.agentId)
        this.logs.delete(e.agentId)
        for (const k of this.subLogs.keys()) if (k.startsWith(`${e.agentId}/`)) this.subLogs.delete(k)
        break
      case 'agent:log': {
        const log = this.logs.get(e.agentId)
        if (log) log.push(e.entry)
        for (const l of this.logListeners) l(e.agentId, e.entry)
        return
      }
      case 'agent:sublog': {
        for (const { subId, entries } of e.logs) {
          const log = this.subLogs.get(`${e.agentId}/${subId}`)
          if (log) {
            log.push(...entries)
            if (log.length > SUB_LOG_KEEP) log.splice(0, log.length - SUB_LOG_KEEP)
          }
          for (const l of this.subLogListeners) l(e.agentId, subId, entries)
        }
        return
      }
      case 'usage':
        this.usage = e.usage
        break
      case 'power':
        this.onBattery = e.onBattery
        break
      case 'backstage':
        this.backstage = e.processes
        break
      case 'accounts':
        this.accounts = e.accounts
        break
      case 'system':
        this.system = e.system
        break
      case 'permission:new':
        this.permissions.set(e.request.id, e.request)
        break
      case 'permission:resolved':
        this.permissions.delete(e.requestId)
        break
      case 'result:new':
        this.results.set(e.result.id, e.result)
        break
      case 'result:changes': {
        const r = this.results.get(e.resultId)
        if (r) this.results.set(r.id, { ...r, changes: e.changes })
        break
      }
      case 'result:acked':
        this.results.delete(e.resultId)
        break
      case 'bridge:status':
        this.bridge = e.status
        break
      case 'settings':
        this.settings = e.settings
        break
      case 'ticket:upsert':
        this.tickets.set(e.ticket.id, e.ticket)
        break
      case 'ticket:removed':
        this.tickets.delete(e.ticketId)
        break
      case 'squads':
        this.squads = e.squads
        break
      case 'ledger:today':
        this.ledgerToday = e.today
        break
      case 'routines':
        this.routines = e.routines
        break
      case 'caffeine':
        this.caffeineAwake = e.awake
        break
      case 'quit':
        this.quitWait = e.wait
        break
      case 'macJobs':
        this.macJobs = e.jobs
        break
    }
    this.changed()
  }

  async log(agentId: string): Promise<LogEntry[]> {
    let log = this.logs.get(agentId)
    if (!log) {
      log = await window.office.getLog(agentId)
      this.logs.set(agentId, log)
    }
    return log
  }

  /** The log of one subagent; fetched once, then kept up to date by agent:sublog. */
  async subLog(agentId: string, subId: string): Promise<LogEntry[]> {
    const key = `${agentId}/${subId}`
    let log = this.subLogs.get(key)
    if (!log) {
      log = await window.office.getSubagentLog(agentId, subId)
      this.subLogs.set(key, log)
    }
    return log
  }

  /** Pending items for an agent, permission requests first. */
  itemsFor(agentId: string): { permissions: PermissionRequest[]; results: AgentResult[] } {
    return {
      permissions: [...this.permissions.values()].filter((p) => p.agentId === agentId).sort((a, b) => a.createdAt - b.createdAt),
      results: [...this.results.values()].filter((r) => r.agentId === agentId),
    }
  }

  /** The ticket an agent is working on, if any. */
  ticketFor(agentId: string): Ticket | undefined {
    for (const t of this.tickets.values()) if (t.assignee?.id === agentId && t.status === 'doing') return t
    return undefined
  }

  get reviewCount(): number {
    let n = 0
    for (const t of this.tickets.values()) if (t.status === 'review') n++
    return n
  }

  /** Elevator floor an agent works on: 0 = ground floor, n = settings.projects[n - 1]. */
  floorOf(a: AgentSummary): number {
    return a.project ? this.settings.projects.findIndex((p) => p.id === a.project) + 1 : 0
  }

  get inboxCount(): number {
    return this.permissions.size + this.results.size
  }
}
