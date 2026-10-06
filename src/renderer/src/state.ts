import type { AgentResult, AgentSummary, BridgeStatus, LogEntry, OfficeEvent, OfficeState, PermissionRequest, Settings } from '@shared/types'

type Listener = () => void

/** Renderer-side mirror of the main process state, fed by office events. */
export class State {
  agents = new Map<string, AgentSummary>()
  permissions = new Map<string, PermissionRequest>()
  results = new Map<string, AgentResult>()
  logs = new Map<string, LogEntry[]>()
  settings: Settings
  bridge: BridgeStatus
  platform: string
  private listeners = new Set<Listener>()
  private logListeners = new Set<(agentId: string, entry: LogEntry) => void>()

  constructor(initial: OfficeState) {
    for (const a of initial.agents) this.agents.set(a.id, a)
    for (const p of initial.permissions) this.permissions.set(p.id, p)
    for (const r of initial.results) this.results.set(r.id, r)
    this.settings = initial.settings
    this.bridge = initial.bridge
    this.platform = initial.platform
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onLog(cb: (agentId: string, entry: LogEntry) => void): () => void {
    this.logListeners.add(cb)
    return () => this.logListeners.delete(cb)
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
        break
      case 'agent:log': {
        const log = this.logs.get(e.agentId)
        if (log) log.push(e.entry)
        for (const l of this.logListeners) l(e.agentId, e.entry)
        return
      }
      case 'permission:new':
        this.permissions.set(e.request.id, e.request)
        break
      case 'permission:resolved':
        this.permissions.delete(e.requestId)
        break
      case 'result:new':
        this.results.set(e.result.id, e.result)
        break
      case 'result:acked':
        this.results.delete(e.resultId)
        break
      case 'bridge:status':
        this.bridge = e.status
        break
      case 'settings':
        this.settings = e.settings
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

  /** Pending items for an agent, permission requests first. */
  itemsFor(agentId: string): { permissions: PermissionRequest[]; results: AgentResult[] } {
    return {
      permissions: [...this.permissions.values()].filter((p) => p.agentId === agentId).sort((a, b) => a.createdAt - b.createdAt),
      results: [...this.results.values()].filter((r) => r.agentId === agentId),
    }
  }

  get inboxCount(): number {
    return this.permissions.size + this.results.size
  }
}
