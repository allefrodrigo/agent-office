import { randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { basename } from 'node:path'
import type { AgentBrain, AgentStatus, AgentSummary, AttachmentInput, HireRequest, LogEntry, OfficePermissionMode, SquadInfo, SquadProgress, SubagentInfo, WorktreeInfo } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { projectFor } from '@shared/projects'
import { buildMessage } from '../attachments'
import { findSquad, readProgress, squadDir, type SquadDefinition } from '../squads'
import { createWorktree } from '../git'
import { endSubagent } from '../subagent-log'
import { type Agent } from './types'
import { AgentBase } from './base'

/** Office agents: hire, summon, squads, messages, interrupt, fire. */
export abstract class AgentOffice extends AgentBase {
  // ---------- office agents (Claude Agent SDK) ----------

  /**
   * `display` is what the log shows when the prompt itself is long (a ticket brief).
   * In a git repo the agent gets its own worktree unless `req.worktree` is false.
   */
  async hire(req: HireRequest, display?: string): Promise<AgentSummary> {
    const id = randomUUID()
    const name = req.name.trim() || this.freeName()
    const { worktree, note } = await this.isolate(req.cwd, name, id, req.worktree)
    const summary: AgentSummary = {
      id,
      name,
      source: 'office',
      cwd: req.cwd,
      model: req.model || undefined,
      effort: req.effort || undefined,
      accounts: req.accounts?.length ? req.accounts : undefined,
      permissionMode: req.permissionMode,
      status: 'starting',
      activity: 'Chegando ao escritório',
      ...this.seat(req.cwd),
      look: req.look ?? lookFromSeed(req.name + id),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId: randomUUID(),
      ...(worktree ? { worktree } : {}),
    }
    const agent: Agent = { summary, log: [], started: false }
    this.agents.set(id, agent)
    this.upsert(agent)
    this.addLog(agent, 'user', display ?? req.task)
    if (note) this.addLog(agent, 'system', note)
    this.run(agent, req.task)
    return summary
  }

  /**
   * The worktree for a new agent in `cwd`. `wanted` false = none; missing or true = one
   * when `cwd` is in a git repo. A folder without git just works as before; a repo where
   * the worktree can't be made (no commit yet…) also falls back, with a note in the log.
   * Missing on a floor with worktrees turned off = none.
   */
  protected async isolate(cwd: string, name: string, id: string, wanted: boolean | undefined): Promise<{ worktree?: WorktreeInfo; note?: string }> {
    if (wanted === false) return {}
    if (wanted === undefined && projectFor(this.store.settings.projects, cwd)?.worktrees === false) return {}
    try {
      const worktree = await createWorktree(cwd, name, id)
      return worktree ? { worktree, note: `Trabalhando numa cópia isolada (worktree) no branch ${worktree.branch}: ${worktree.root}` } : {}
    } catch (err) {
      return { note: `Não deu para criar a cópia isolada (${err instanceof Error ? err.message : String(err)}). Trabalhando direto na pasta do projeto.` }
    }
  }

  /** An office agent for a saved session; it waits in the lounge until it gets an instruction. */
  recall(
    sessionId: string,
    cwd: string,
    log: LogEntry[],
    defaults: AgentBrain & { permissionMode: OfficePermissionMode },
    worktree?: WorktreeInfo,
    helpers: { info: SubagentInfo; log: LogEntry[] }[] = [],
  ): AgentSummary {
    for (const a of this.agents.values()) if (a.summary.sessionId === sessionId) return a.summary
    // started = true: the next message resumes the saved conversation.
    const summary = this.idleAgent(sessionId, cwd, log, true, 'De volta, esperando instruções', defaults, worktree)
    const agent = this.agents.get(summary.id)
    if (agent && helpers.length) {
      // The helpers of the saved conversation come back as ended, each with its own log.
      const subs = this.subLogs(agent)
      const done: SubagentInfo[] = []
      for (const x of helpers) {
        subs.seed(x.info.id, x.log)
        for (const dropped of endSubagent(done, x.info)) subs.forget(dropped)
      }
      summary.subagentsDone = done
      this.upsert(agent)
    }
    return summary
  }

  /** A new agent with no task yet, like typing `claude` in a folder: it waits for your first message. */
  async summon(cwd: string, defaults: AgentBrain & { permissionMode: OfficePermissionMode }, wantWorktree?: boolean): Promise<AgentSummary> {
    const sessionId = randomUUID()
    const name = this.freeName(basename(cwd) || 'Agente')
    const { worktree, note } = await this.isolate(cwd, name, sessionId, wantWorktree)
    const summary = this.idleAgent(sessionId, cwd, [], false, 'Esperando a primeira instrução', defaults, worktree, name)
    const agent = this.agents.get(summary.id)
    if (agent && note) this.addLog(agent, 'system', note)
    return summary
  }

  /**
   * An orchestrator for a squad: one Claude Code session that runs the squad's cycle
   * and can only call its own members. It lives on the squad floor.
   */
  runSquad(squad: SquadInfo, task: string, display: string, defaults: AgentBrain & { permissionMode: OfficePermissionMode }): AgentSummary {
    const same = [...this.agents.values()].find((a) => a.summary.role === 'orchestrator' && a.summary.squad === squad.code && a.summary.cwd === squad.cwd)
    if (same) {
      if (this.busy(same)) throw new Error(`${same.summary.name} já está rodando um ciclo. Espere terminar ou interrompa pelo painel.`)
      same.summary.permissionMode = defaults.permissionMode
      // The squad keeps its memory in files: re-reading every past cycle only costs tokens.
      if (this.store.settings.freshSquadCycle) this.freshStart(same.summary.id, 'Ciclo novo, conversa nova: o squad guarda a memória nos arquivos dele.')
      this.sendMessage(same.summary.id, task, display)
      return same.summary
    }
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: squad.name,
      source: 'office',
      cwd: squad.cwd,
      model: defaults.model || undefined,
      effort: defaults.effort || undefined,
      accounts: defaults.accounts?.length ? defaults.accounts : undefined,
      permissionMode: defaults.permissionMode,
      status: 'starting',
      activity: 'Subindo para a Diretoria',
      ...this.seat(squad.cwd, true),
      look: lookFromSeed(`orquestrador:${squad.code}`),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId: randomUUID(),
      role: 'orchestrator',
      squad: squad.code,
    }
    const agent: Agent = { summary, log: [], started: false }
    this.agents.set(id, agent)
    this.watchSquad(agent)
    this.upsert(agent)
    this.addLog(agent, 'user', display)
    this.run(agent, task)
    return summary
  }

  /** Demo mode: an orchestrator with no session behind it; demo.ts plays its cycle. */
  demoOrchestrator(squad: SquadDefinition): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: squad.name,
      source: 'office',
      cwd: squad.cwd,
      permissionMode: 'default',
      status: 'working',
      activity: 'Lendo o pipeline',
      ...this.seat(squad.cwd, true),
      look: lookFromSeed(`orquestrador:${squad.code}`),
      costUsd: 0,
      createdAt: Date.now(),
      role: 'orchestrator',
      squad: squad.code,
    }
    const agent: Agent = { summary, log: [], started: true, squad, demo: true }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  /** Demo mode: an office agent with no session behind it; demo.ts plays its runs (routines). */
  demoAgent(name: string, cwd: string): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name,
      source: 'office',
      cwd,
      permissionMode: 'default',
      status: 'idle',
      activity: 'Aguardando instruções',
      ...this.seat(cwd),
      look: lookFromSeed(`demo:${name}`),
      costUsd: 0,
      createdAt: Date.now(),
    }
    const agent: Agent = { summary, log: [], started: true, demo: true }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  /**
   * A routine's own agent before its next run: freedom and brain as the routine says now.
   * They count from the next start of the CLI (the routine clears the context first).
   */
  configure(id: string, patch: { permissionMode?: OfficePermissionMode; model?: string; effort?: AgentBrain['effort'] }): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || this.busy(agent)) return
    const s = agent.summary
    if (patch.permissionMode) s.permissionMode = patch.permissionMode
    if ('model' in patch) s.model = patch.model || undefined
    if ('effort' in patch) s.effort = patch.effort || undefined
    this.upsert(agent)
  }

  /** Demo mode: moves a simulated cycle along. */
  demoStep(agentId: string, step: SquadProgress | undefined, status: AgentStatus, activity: string): void {
    const agent = this.agents.get(agentId)
    if (!agent?.demo) return
    agent.summary.squadStep = step
    agent.summary.status = status
    agent.summary.activity = activity
    this.upsert(agent)
  }

  /** Follows squads/<code>/state.json, which the runner rewrites before every step. */
  protected watchSquad(agent: Agent): void {
    const s = agent.summary
    const info = s.squad ? findSquad(s.cwd, s.squad) : undefined
    if (!info) return
    agent.squad = info
    let timer: NodeJS.Timeout | null = null
    const read = () => {
      timer = null
      const step = readProgress(info)
      if (JSON.stringify(step) === JSON.stringify(s.squadStep)) return
      s.squadStep = step
      this.upsert(agent)
    }
    try {
      agent.watcher = watch(squadDir(info), (_e, file) => {
        if (file && file !== 'state.json') return
        if (!timer) timer = setTimeout(read, 250)
      })
      agent.watcher.on('error', () => agent.watcher?.close())
    } catch {
      // folder gone: the step line just stays empty
    }
    read()
  }

  protected idleAgent(
    sessionId: string,
    cwd: string,
    log: LogEntry[],
    started: boolean,
    activity: string,
    defaults: AgentBrain & { permissionMode: OfficePermissionMode },
    worktree?: WorktreeInfo,
    name?: string,
  ): AgentSummary {
    const id = randomUUID()
    const summary: AgentSummary = {
      id,
      name: name ?? this.freeName(basename(cwd) || 'Agente'),
      source: 'office',
      cwd,
      model: defaults.model || undefined,
      effort: defaults.effort || undefined,
      accounts: defaults.accounts?.length ? defaults.accounts : undefined,
      permissionMode: defaults.permissionMode,
      status: 'idle',
      activity,
      ...this.seat(cwd),
      look: lookFromSeed(sessionId),
      costUsd: 0,
      createdAt: Date.now(),
      sessionId,
      ...(worktree ? { worktree } : {}),
    }
    const agent: Agent = { summary, log, started }
    this.agents.set(id, agent)
    this.upsert(agent)
    return summary
  }

  /** Throws, before anything is sent, when an attachment can't go. */
  sendMessage(id: string, text: string, display?: string, attachments: AttachmentInput[] = []): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || agent.demo) return
    const { content, infos } = attachments.length ? buildMessage(text, attachments) : { content: text, infos: [] }
    this.addLog(agent, 'user', display ?? text, undefined, undefined, infos.length ? infos : undefined)
    // A new instruction replaces any undelivered result.
    this.dropResults(id)
    if (this.overBudget(agent)) return
    if (agent.input && (agent.query || agent.awaitingSnapshot)) {
      agent.input.push(content)
      this.setStatus(agent, 'working', 'Lendo suas instruções')
    } else {
      this.run(agent, content)
    }
  }

  compact(id: string): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office' || !agent.started || this.busy(agent)) return
    agent.compacting = true
    this.addLog(agent, 'system', 'Compactando: resumindo a conversa para liberar contexto…')
    this.dropResults(id)
    if (agent.input && (agent.query || agent.awaitingSnapshot)) agent.input.push('/compact')
    else this.run(agent, '/compact')
    this.setStatus(agent, 'working', 'Organizando a memória')
  }

  /** Clears an agent that already talked, so the next message starts a new conversation; `note` says why. */
  freshStart(id: string, note: string): void {
    const agent = this.agents.get(id)
    if (!agent?.started || this.busy(agent)) return
    this.clearContext(id, note)
  }

  /** Same agent, brand-new conversation: closes the session and starts the next one from zero. */
  clearContext(id: string, note = 'Contexto limpo. A próxima mensagem começa uma conversa nova.'): void {
    const agent = this.agents.get(id)
    if (!agent || agent.summary.source !== 'office') return
    this.cancelAgentRequests(id)
    this.dropResults(id)
    agent.input?.close()
    agent.query?.close()
    agent.input = undefined
    agent.query = undefined
    agent.started = false
    agent.compacting = false
    agent.summary.sessionId = randomUUID()
    agent.summary.context = undefined
    agent.summary.lastTurnAt = undefined
    this.addLog(agent, 'system', note)
    this.setStatus(agent, 'idle', 'Memória limpa, esperando instruções')
    this.upsert(agent)
  }

  isBusy(id: string): boolean {
    const agent = this.agents.get(id)
    return !!agent && this.busy(agent)
  }

  protected busy(agent: Agent): boolean {
    const st = agent.summary.status
    return st === 'working' || st === 'starting' || st === 'waiting'
  }

  async interrupt(id: string): Promise<void> {
    const agent = this.agents.get(id)
    if (!agent?.query) return
    this.cancelAgentRequests(id)
    await agent.query.interrupt().catch(() => undefined)
    this.addLog(agent, 'system', 'Interrompido por você.')
  }

  fire(id: string): void {
    const agent = this.agents.get(id)
    if (!agent) return
    this.cancelAgentRequests(id)
    this.dropResults(id)
    agent.input?.close()
    agent.query?.close()
    agent.watcher?.close()
    agent.subFlush?.cancel()
    this.agents.delete(id)
    // Its spend stays in the cost book; reports show it as dismissed.
    this.book?.dismissed(id)
    this.send({ type: 'agent:removed', agentId: id })
    this.persist()
  }

  shutdown(): void {
    for (const a of this.agents.values()) {
      a.input?.close()
      a.query?.close()
      a.watcher?.close()
    }
    this.persist()
  }
}
