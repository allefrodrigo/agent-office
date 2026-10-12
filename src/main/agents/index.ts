import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { AgentStatus, AgentSummary, LogEntry } from '@shared/types'
import { lookFromSeed, toolDetail } from '@shared/describe'
import { sessionIdForName } from '../peers'
import { type Agent } from './types'
import { AgentDecisions } from './decisions'

export { toolDetail }
export { DESK_COUNT } from './types'
export { permissionFromTool } from './permissions'

/** Every agent in the office: run through the Claude Agent SDK or seen through the terminal hooks. */
export class AgentManager extends AgentDecisions {
  // ---------- terminal agents (hook bridge) ----------

  isOfficeSession(sessionId: string): boolean {
    for (const a of this.agents.values()) if (a.summary.source === 'office' && a.summary.sessionId === sessionId) return true
    return false
  }

  findTerminal(sessionId: string): AgentSummary | undefined {
    for (const a of this.agents.values()) if (a.summary.source === 'terminal' && a.summary.sessionId === sessionId) return a.summary
    return undefined
  }

  /** A terminal session messaged another session (SendMessage): show them talking. */
  terminalChat(fromId: string, input: Record<string, unknown>): void {
    const text = typeof input.message === 'string' ? input.message.split('\n').find((l) => l.trim())?.trim() : undefined
    if (!text || typeof input.to !== 'string') return
    const sessionId = sessionIdForName(input.to)
    const to = sessionId ? this.findTerminal(sessionId) : undefined
    this.send({ type: 'agent:chat', fromId, toId: to && to.id !== fromId ? to.id : null, text: text.slice(0, 140) })
  }

  terminalPrompt(agentId: string, prompt: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    this.dropResults(agentId)
    if (prompt.trim()) this.addLog(agent, 'user', prompt)
    this.setStatus(agent, 'working', 'Lendo seu pedido')
  }

  terminalAgent(sessionId: string, cwd: string): AgentSummary {
    for (const a of this.agents.values()) {
      if (a.summary.source === 'terminal' && a.summary.sessionId === sessionId) return a.summary
    }
    const id = randomUUID()
    const folder = basename(cwd || '') || 'terminal'
    const summary: AgentSummary = {
      id,
      name: folder,
      source: 'terminal',
      cwd,
      permissionMode: 'default',
      status: 'working',
      activity: 'Chegando do terminal',
      ...this.seat(cwd),
      look: lookFromSeed(sessionId),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId,
    }
    const agent: Agent = { summary, log: [], started: true }
    this.agents.set(id, agent)
    this.upsert(agent)
    this.addLog(agent, 'system', `Sessão do terminal em ${cwd}`)
    return summary
  }

  terminalUpdate(agentId: string, status: AgentStatus | null, activity: string | null, log?: { kind: LogEntry['kind']; text: string; tool?: string }): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    if (log) this.addLog(agent, log.kind, log.text, log.tool)
    if (agent.summary.status === 'waiting' && status && status !== 'waiting' && this.hasPending(agentId)) status = null
    if (status || activity) this.setStatus(agent, status ?? agent.summary.status, activity ?? agent.summary.activity)
  }

  terminalResult(agentId: string, text: string): void {
    const agent = this.agents.get(agentId)
    if (agent) this.deliver(agent, { text, isError: false, costUsd: 0, durationMs: 0, turns: 0 })
  }

  terminalEnded(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    this.cancelAgentRequests(agentId)
    if (this.results.some((r) => r.agentId === agentId)) {
      agent.summary.activity = 'Sessão encerrada'
      this.upsert(agent)
    } else {
      this.removeTerminal(agentId)
    }
  }

  /** The terminal session was closed from the office: forget it without waiting for acks. */
  terminalKill(agentId: string): void {
    if (!this.agents.has(agentId)) return
    this.cancelAgentRequests(agentId, 'Sessão encerrada pelo Agent Office.')
    this.dropResults(agentId)
    this.removeTerminal(agentId)
  }

  protected removeTerminal(agentId: string): void {
    this.agents.get(agentId)?.subFlush?.cancel()
    this.agents.delete(agentId)
    this.send({ type: 'agent:removed', agentId })
  }
}
