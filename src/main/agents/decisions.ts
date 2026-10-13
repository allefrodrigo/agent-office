import { randomUUID } from 'node:crypto'
import { type PermissionResult, type PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { AgentResult, AgentSummary, PermissionDecision, PermissionRequest, ResultChanges } from '@shared/types'
import { outsideTeam, readProgress, type SquadDefinition } from '../squads'
import { changesSince, displayPath } from '../git'
import { permissionFromTool } from './permissions'
import { type Agent } from './types'
import { AgentSubagents } from './subagents'

/** Permissions (asking the player, decisions) and results, shared by office and terminal agents. */
export abstract class AgentDecisions extends AgentSubagents {
  protected askPlayer(
    agent: Agent,
    tool: string,
    input: Record<string, unknown>,
    opts: { signal: AbortSignal; suggestions?: PermissionUpdate[]; decisionReason?: string; agentID?: string },
  ): Promise<PermissionResult> {
    // The board is the office's own tool: no need to walk over and ask.
    if (tool.startsWith('mcp__office__')) return Promise.resolve({ behavior: 'allow', updatedInput: input })
    const squad = agent.squad
    if (squad && (tool === 'Agent' || tool === 'Task')) {
      // Handing a step to a member is the orchestrator's job; anyone else is out (the hook already says so).
      const why = outsideTeam(squad, tool, input)
      return Promise.resolve(why ? { behavior: 'deny', message: why } : { behavior: 'allow', updatedInput: input })
    }
    const req = permissionFromTool(tool, input, opts.decisionReason, !!opts.suggestions?.length)
    if (opts.agentID) req.subagent = this.subagentLabel(agent, opts.agentID)
    if (squad) req.context = this.squadContext(agent, squad, tool === 'AskUserQuestion')
    return new Promise((resolve) => {
      const id = this.requestDecision(agent.summary.id, req, (d) => {
        if (d.behavior === 'deny') {
          resolve({ behavior: 'deny', message: d.message?.trim() || 'O usuário negou esta ação.' })
        } else if (tool === 'AskUserQuestion') {
          resolve({ behavior: 'allow', updatedInput: { ...input, answers: d.answers ?? {} } })
        } else {
          resolve({
            behavior: 'allow',
            updatedInput: input,
            ...(d.behavior === 'allow_always' && opts.suggestions ? { updatedPermissions: opts.suggestions } : {}),
          })
        }
      })
      opts.signal.addEventListener('abort', () => this.cancelRequest(id, 'Cancelado.'), { once: true })
    })
  }

  /** "Ciclo de Produto · Passo 1 · Foco da semana": read fresh, the watcher may still be debouncing. */
  protected squadContext(agent: Agent, squad: SquadDefinition, question: boolean): string {
    const step = readProgress(squad) ?? agent.summary.squadStep
    if (step && JSON.stringify(step) !== JSON.stringify(agent.summary.squadStep)) {
      agent.summary.squadStep = step
      this.upsert(agent)
    }
    if (!step?.current) return squad.name
    const who = !question && step.agent ? squad.members.find((m) => m.id === step.agent) : undefined
    return [squad.name, `Passo ${step.current}${step.total ? `/${step.total}` : ''}`, step.label, who ? `${who.icon} ${who.name}` : ''].filter(Boolean).join(' · ')
  }

  // ---------- decisions (shared by office and terminal agents) ----------

  requestDecision(agentId: string, req: Omit<PermissionRequest, 'id' | 'agentId' | 'createdAt'>, onDecision: (d: PermissionDecision) => void): string {
    const agent = this.agents.get(agentId)
    const request: PermissionRequest = { ...req, id: randomUUID(), agentId, createdAt: Date.now() }
    this.pending.set(request.id, { request, resolve: onDecision })
    if (agent) {
      this.setStatus(agent, 'waiting', req.kind === 'question' ? 'Com uma pergunta para você' : req.kind === 'plan' ? 'Com um plano para você' : 'Precisa da sua permissão')
    }
    this.send({ type: 'permission:new', request })
    return request.id
  }

  respond(d: PermissionDecision): void {
    const p = this.pending.get(d.requestId)
    if (!p) return
    this.pending.delete(d.requestId)
    const agent = this.agents.get(p.request.agentId)
    if (agent) {
      const verdict = d.behavior === 'deny' ? 'Negado' : d.behavior === 'allow_always' ? 'Sempre permitido' : 'Permitido'
      const answers = d.answers ? Object.values(d.answers).join(', ') : ''
      this.addLog(agent, 'decision', p.request.kind === 'question' ? `Você respondeu: ${answers}` : `${verdict}: ${p.request.title}${d.message ? ` — ${d.message}` : ''}`)
      if (!this.hasPending(agent.summary.id)) this.setStatus(agent, 'working', 'Voltando ao trabalho')
    }
    this.send({ type: 'permission:resolved', requestId: d.requestId, agentId: p.request.agentId })
    p.resolve(d)
  }

  cancelRequest(requestId: string, message: string): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.pending.delete(requestId)
    this.send({ type: 'permission:resolved', requestId, agentId: p.request.agentId })
    p.resolve({ requestId, behavior: 'deny', message })
    const agent = this.agents.get(p.request.agentId)
    if (agent && agent.summary.status === 'waiting' && !this.hasPending(agent.summary.id)) this.setStatus(agent, 'working', 'Voltando ao trabalho')
  }

  cancelAgentRequests(agentId: string, message = 'Interrompido pelo usuário.'): void {
    for (const [id, p] of this.pending) if (p.request.agentId === agentId) this.cancelRequest(id, message)
  }

  protected hasPending(agentId: string): boolean {
    for (const p of this.pending.values()) if (p.request.agentId === agentId) return true
    return false
  }

  ackResult(resultId: string): void {
    const r = this.results.find((x) => x.id === resultId)
    if (!r) return
    this.results = this.results.filter((x) => x.id !== resultId)
    this.store.results = this.results
    this.send({ type: 'result:acked', resultId, agentId: r.agentId })
    const agent = this.agents.get(r.agentId)
    if (agent && (agent.summary.status === 'done' || agent.summary.status === 'error')) {
      if (agent.summary.source === 'terminal' && !agent.query && agent.summary.activity === 'Sessão encerrada') {
        this.removeTerminal(agent.summary.id)
      } else {
        this.setStatus(agent, 'idle', agent.summary.source === 'terminal' ? 'Esperando no terminal' : 'Aguardando instruções')
      }
    }
  }

  protected dropResults(agentId: string): void {
    for (const r of this.results.filter((x) => x.agentId === agentId)) {
      this.send({ type: 'result:acked', resultId: r.id, agentId })
    }
    this.results = this.results.filter((x) => x.agentId !== agentId)
    this.store.results = this.results
  }

  protected deliver(agent: Agent, r: Omit<AgentResult, 'id' | 'agentId' | 'createdAt'>): void {
    this.dropResults(agent.summary.id)
    const result: AgentResult = { ...r, id: randomUUID(), agentId: agent.summary.id, createdAt: Date.now() }
    this.results.push(result)
    this.store.results = this.results
    this.addLog(agent, 'result', r.text, undefined, r.isError)
    this.setStatus(agent, r.isError ? 'error' : 'done', r.isError ? 'Deu problema' : 'Trazendo o resultado')
    this.send({ type: 'result:new', result })
    const task = agent.task
    agent.task = undefined
    if (task) void this.attachChanges(agent, result, task)
  }

  /** Works out what the task changed and hangs it on the result card (a moment after it arrives). */
  protected async attachChanges(agent: Agent, result: AgentResult, task: NonNullable<Agent['task']>): Promise<void> {
    const s = agent.summary
    let changes: ResultChanges | null = null
    try {
      const snap = await task.snapshot
      if (snap) changes = await changesSince(snap, s.worktree ? { branch: s.worktree.branch } : undefined)
    } catch (err) {
      this.addLog(agent, 'error', `Não consegui ler as mudanças do git: ${err instanceof Error ? err.message : String(err)}`)
    }
    // No git: what the Edit/Write tools wrote, as the log has it.
    if (!changes && task.touched.size) {
      const root = s.worktree?.path ?? s.cwd
      changes = {
        git: false,
        root,
        files: [...task.touched].map(([file, tool]) => {
          return { path: displayPath(root, file), status: 'modified' as const, tool }
        }),
      }
    }
    if (changes) this.setChanges(result.id, changes)
  }

  /** The result as the main process holds it (the renderer only ever sends its id). */
  result(resultId: string): AgentResult | undefined {
    return this.results.find((r) => r.id === resultId)
  }

  agent(agentId: string): AgentSummary | undefined {
    return this.agents.get(agentId)?.summary
  }

  setChanges(resultId: string, changes: ResultChanges): void {
    const r = this.results.find((x) => x.id === resultId)
    if (!r) return
    r.changes = changes
    this.store.results = this.results
    this.send({ type: 'result:changes', resultId, agentId: r.agentId, changes })
  }
}
