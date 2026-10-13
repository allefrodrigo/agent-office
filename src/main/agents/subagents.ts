import { randomUUID } from 'node:crypto'
import { type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { LogEntry, SubagentInfo } from '@shared/types'
import { applyStep, Coalescer, endSubagent, findSubagent, SubagentLogs, subagentStep } from '../subagent-log'
import { kTokens, type Agent } from './types'
import { AgentRotation } from './rotation'

/** Subagents (Agent tool) and their logs (AO-46). */
export abstract class AgentSubagents extends AgentRotation {
  // ---------- subagents (Agent tool) ----------

  protected trackSubagents(agent: Agent, msg: Extract<SDKMessage, { type: 'system' }>): void {
    const subs = agent.summary.subagents ?? []
    switch (msg.subtype) {
      case 'task_started': {
        // Workflow tool runs get the same treatment: a helper with its own log.
        const workflow = msg.task_type === 'local_workflow'
        const isAgent = msg.task_type === 'local_agent' || !!msg.subagent_type || workflow
        if (!isAgent || msg.ambient || msg.skip_transcript || subs.some((x) => x.id === msg.task_id)) return
        const sub: SubagentInfo = {
          id: msg.task_id,
          description: workflow && msg.workflow_name ? `${msg.workflow_name}: ${msg.description}` : msg.description,
          type: workflow ? 'Workflow' : msg.subagent_type,
          startedAt: Date.now(),
          background: !!msg.is_backgrounded,
        }
        if (msg.tool_use_id) sub.toolUseId = msg.tool_use_id
        if (workflow) sub.workflow = true
        const member = agent.squad?.members.find((m) => m.id === msg.subagent_type)
        if (member) sub.member = member.id
        const logs = this.subLogs(agent)
        logs.start(sub.id, msg.tool_use_id)
        if (msg.prompt?.trim()) logs.note(sub.id, this.subEntry('user', msg.prompt.slice(0, 4000)))
        this.setSubagents(agent, [...subs, sub])
        if (logs.hasPending) this.subFlusher(agent).mark()
        this.addLog(
          agent,
          'system',
          member
            ? `Chamou ${member.icon} ${member.name}: ${sub.description}`
            : workflow
              ? `Rodou um workflow: ${sub.description}`
              : `Chamou um ajudante${sub.type ? ` (${sub.type})` : ''}: ${sub.description}`,
        )
        return
      }
      case 'task_progress': {
        const sub = subs.find((x) => x.id === msg.task_id)
        if (!sub) return
        sub.tokens = msg.usage.total_tokens
        sub.toolUses = Math.max(sub.toolUses ?? 0, msg.usage.tool_uses)
        if (msg.last_tool_name) {
          sub.lastTool = msg.last_tool_name
          // Without its messages (older CLI), the tool name is all we know.
          if (!agent.subs?.get(sub.id).length) sub.activity = `Usando ${msg.last_tool_name}`
        }
        if (msg.summary) sub.summary = msg.summary.slice(0, 300)
        agent.subDirty = true
        this.subFlusher(agent).mark()
        return
      }
      case 'task_updated': {
        const sub = subs.find((x) => x.id === msg.task_id)
        if (sub && msg.patch.is_backgrounded !== undefined) sub.background = msg.patch.is_backgrounded
        return
      }
      case 'task_notification': {
        const sub = subs.find((x) => x.id === msg.task_id)
        if (!sub) return
        if (msg.usage?.total_tokens) sub.tokens = msg.usage.total_tokens
        if (msg.usage?.tool_uses) sub.toolUses = msg.usage.tool_uses
        const verb = msg.status === 'completed' ? 'terminou' : msg.status === 'failed' ? 'falhou' : 'foi interrompido'
        const ms = msg.usage?.duration_ms ?? Date.now() - sub.startedAt
        const stats = [sub.tokens ? `${kTokens(sub.tokens)} tokens` : '', `${(ms / 1000).toFixed(1).replace('.', ',')} s`].filter(Boolean).join(' · ')
        const member = sub.member ? agent.squad?.members.find((m) => m.id === sub.member) : undefined
        if (msg.summary?.trim()) agent.subs?.note(sub.id, this.subEntry('result', msg.summary.slice(0, 4000), msg.status === 'failed'))
        this.retire(agent, sub, msg.status, `${verb[0].toUpperCase()}${verb.slice(1)} (${stats}).`)
        this.addLog(agent, msg.status === 'failed' ? 'error' : 'system', `${member ? `${member.icon} ${member.name}` : 'Ajudante'} ${verb}: ${sub.description} (${stats})`, undefined, msg.status === 'failed')
        if (sub.member) {
          const summary = msg.status === 'failed' ? (msg.summary || 'Falhou sem dizer por quê.').slice(0, 200) : undefined
          this.send({ type: 'member:ended', agentId: agent.summary.id, taskId: sub.id, member: sub.member, status: msg.status, summary })
        }
        return
      }
      case 'background_tasks_changed': {
        // Level signal: a background subagent missing here is gone even if its notification was lost.
        const live = new Set(msg.tasks.map((t) => t.task_id))
        for (const sub of subs.filter((x) => x.background && !live.has(x.id))) this.retire(agent, sub, 'completed')
        return
      }
      default:
        return
    }
  }

  // ---------- subagent logs (AO-46) ----------

  protected subLogs(agent: Agent): SubagentLogs {
    return (agent.subs ??= new SubagentLogs())
  }

  protected subFlusher(agent: Agent): Coalescer {
    return (agent.subFlush ??= new Coalescer(() => this.flushSubagents(agent)))
  }

  protected subEntry(kind: LogEntry['kind'], text: string, isError?: boolean): LogEntry {
    return { id: randomUUID(), t: Date.now(), kind, text, ...(isError ? { isError } : {}) }
  }

  /**
   * A message from inside a subagent (parent_tool_use_id set): its log and its card,
   * sent to the renderer in grouped bursts. The prompt already came with task_started,
   * so its user text is skipped here.
   */
  protected subagentMessage(agent: Agent, parentToolUseId: string, role: 'assistant' | 'user', content: unknown): void {
    const step = subagentStep(role, content, randomUUID)
    step.entries = step.entries.filter((e) => e.kind !== 'user')
    this.subLogs(agent).add(parentToolUseId, step.entries)
    const sub = findSubagent(agent.summary.subagents, parentToolUseId)
    if (sub && applyStep(sub, step)) agent.subDirty = true
    if (agent.subDirty || agent.subs?.hasPending) this.subFlusher(agent).mark()
  }

  protected flushSubagents(agent: Agent): void {
    if (!this.agents.has(agent.summary.id)) return
    const logs = agent.subs?.take() ?? []
    if (logs.length) this.send({ type: 'agent:sublog', agentId: agent.summary.id, logs })
    if (!agent.subDirty) return
    agent.subDirty = false
    this.upsert(agent)
  }

  /** A subagent ended: off the running list, into the ended one (its log stays), and the renderer hears it now. */
  protected retire(agent: Agent, sub: SubagentInfo, status: NonNullable<SubagentInfo['status']>, line?: string): void {
    sub.status = status
    sub.endedAt = Date.now()
    if (line) agent.subs?.note(sub.id, this.subEntry(status === 'failed' ? 'error' : 'system', line))
    const done = agent.summary.subagentsDone ?? []
    for (const dropped of endSubagent(done, sub)) agent.subs?.forget(dropped)
    agent.summary.subagentsDone = done
    const left = (agent.summary.subagents ?? []).filter((x) => x !== sub)
    agent.summary.subagents = left.length ? left : undefined
    agent.subDirty = true
    this.subFlusher(agent).now()
  }

  /** Demo mode: feeds simulated task_* events to any agent. */
  demoTask(agentId: string, msg: Extract<SDKMessage, { type: 'system' }>): void {
    const agent = this.agents.get(agentId)
    if (agent) this.trackSubagents(agent, msg)
  }

  /** Demo mode: a simulated message from inside a subagent (parent_tool_use_id set). */
  demoSubagentMessage(agentId: string, parentToolUseId: string, role: 'assistant' | 'user', content: unknown): void {
    const agent = this.agents.get(agentId)
    if (agent) this.subagentMessage(agent, parentToolUseId, role, content)
  }

  /** Load test: entries held in memory for an agent's subagents. */
  subagentMemory(agentId: string): number {
    return this.agents.get(agentId)?.subs?.size ?? 0
  }

  protected setSubagents(agent: Agent, subs: SubagentInfo[]): void {
    agent.summary.subagents = subs.length ? subs : undefined
    this.upsert(agent)
  }

  protected clearSubagents(agent: Agent): void {
    const subs = agent.summary.subagents
    if (!subs?.length) return
    for (const sub of subs) this.retire(agent, sub, 'stopped', 'Parou junto com a sessão.')
    this.addLog(agent, 'system', subs.length === 1 ? 'O ajudante parou junto com a sessão.' : `${subs.length} ajudantes pararam junto com a sessão.`)
  }

  /** What the subagent behind a request is doing; '' when the id is not one we track. */
  protected subagentLabel(agent: Agent, agentID: string): string {
    const subs = (agent.summary.subagents ?? []).filter((x) => !x.member)
    const sub = subs.find((x) => x.id === agentID) ?? (subs.length === 1 ? subs[0] : undefined)
    return sub ? `${sub.type ? `${sub.type}: ` : ''}${sub.description}` : ''
  }
}
