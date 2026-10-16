import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { McpServerStatus, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { AgentStatus, AgentSummary, LogEntry } from '@shared/types'
import { lookFromSeed, toolDetail } from '@shared/describe'
import { sessionIdForName } from '../peers'
import { type Agent, type AgentInit, type BgTask } from './types'
import { AgentDecisions } from './decisions'

export { toolDetail }
export { DESK_COUNT, type BgTask } from './types'
export { permissionFromTool } from './permissions'

/** Every agent in the office: run through the Claude Agent SDK or seen through the terminal hooks. */
export class AgentManager extends AgentDecisions {
  // ---------- Bastidores: background tasks, MCP and skills of the running CLIs ----------

  /** Office agents whose CLI runs now, with their background tasks. */
  liveAgents(): { summary: AgentSummary; tasks: BgTask[]; init?: AgentInit }[] {
    return [...this.agents.values()]
      .filter((a) => a.query && a.summary.source === 'office')
      .map((a) => ({ summary: a.summary, tasks: [...(a.bg?.values() ?? [])], init: a.init }))
  }

  /** Stops one background task through the agent's own CLI (it reports 'stopped' back). */
  async stopTask(agentId: string, taskId: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (!agent?.query || !agent.bg?.has(taskId)) throw new Error('Esse processo já terminou.')
    await agent.query.stopTask(taskId)
  }

  /** Each live CLI's MCP servers; a CLI that does not answer in 4 s is left out. */
  async mcpStatus(): Promise<McpServerStatus[][]> {
    const ask = (a: Agent) => Promise.race([a.query!.mcpServerStatus(), new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), 4000))])
    const all = await Promise.allSettled(this.liveQueries().map(ask))
    return all.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  }

  /** On or off in every live CLI now; the caller keeps the choice for the next ones. */
  async toggleMcp(name: string, enabled: boolean): Promise<void> {
    await Promise.allSettled(this.liveQueries().map((a) => a.query!.toggleMcpServer(name, enabled)))
  }

  async reconnectMcp(name: string): Promise<void> {
    const r = await Promise.allSettled(this.liveQueries().map((a) => a.query!.reconnectMcpServer(name)))
    const failed = r.find((x) => x.status === 'rejected')
    if (failed && r.every((x) => x.status === 'rejected')) throw new Error(`Não consegui reconectar ${name}: ${(failed as PromiseRejectedResult).reason}`)
  }

  async reloadPlugins(): Promise<void> {
    await Promise.allSettled(this.liveQueries().map((a) => a.query!.reloadPlugins()))
  }

  /** Skills and commands of one live CLI, with their descriptions; empty when none runs. */
  async commands(): Promise<SlashCommand[]> {
    const a = this.liveQueries()[0]
    return a ? a.query!.supportedCommands().catch(() => []) : []
  }

  private liveQueries(): Agent[] {
    return [...this.agents.values()].filter((a) => a.query && a.summary.source === 'office' && !a.demo)
  }

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
