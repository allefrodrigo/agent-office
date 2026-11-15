import { randomUUID } from 'node:crypto'
import {
  BOT_GROUND_FLOOR,
  BOT_LIMITS,
  CHAT_DEFAULTS,
  type AgentBrain,
  type AgentResult,
  type AgentSummary,
  type AttachmentInput,
  type Bot,
  type BotRun,
  type BotRunStatus,
  type ChatSettings,
  type EffortLevel,
  type LogEntry,
  type OfficeEvent,
  type OfficePermissionMode,
  type PermissionRequest,
  type RunTrigger,
  type SensitiveKind,
  type Settings,
  type SubagentInfo,
  type ThreadItem,
  type WorktreeInfo,
} from '@shared/types'
import {
  approvalFromRequest,
  approvalOutcome,
  botSystemPrompt,
  clip,
  closeRun,
  itemsFromLog,
  recentContext,
  runHeader,
  runLabel,
  stamp,
  type ApprovalItem,
  type RunEnd,
  type RunItem,
} from '@shared/bots'
import type { BotHooks, BotIdentity, DecisionNote } from '../agents/types'
import { localDay } from '../ledger'
import { log } from '../log'
import { isDir } from '../squads'
import type { BotStore } from './store'

type Defaults = AgentBrain & { permissionMode: OfficePermissionMode }

/** What the runner needs from the AgentManager (a fake one in the tests). */
export interface BotHost {
  on(event: 'event', listener: (e: OfficeEvent) => void): unknown
  on(event: 'decision', listener: (n: DecisionNote) => void): unknown
  on(event: 'quietResult', listener: (r: AgentResult) => void): unknown
  agent(id: string): AgentSummary | undefined
  list(): AgentSummary[]
  isBusy(id: string): boolean
  recall(
    sessionId: string,
    cwd: string,
    log: LogEntry[],
    defaults: Defaults,
    worktree?: WorktreeInfo,
    helpers?: { info: SubagentInfo; log: LogEntry[] }[],
    as?: BotIdentity,
  ): AgentSummary
  summon(cwd: string, defaults: Defaults, wantWorktree?: boolean, as?: BotIdentity): Promise<AgentSummary>
  demoAgent(name: string, cwd: string, as?: BotIdentity): AgentSummary
  sendMessage(id: string, text: string, display?: string, attachments?: AttachmentInput[]): void
  runCommand(id: string, command: string): Promise<void>
  clearContext(id: string, note?: string): void
  configure(id: string, patch: { permissionMode?: OfficePermissionMode; model?: string; effort?: EffortLevel }): void
  interrupt(id: string): Promise<void>
  fire(id: string): void
  pendingRequests(): PermissionRequest[]
  pendingResults(): AgentResult[]
  requestSensitive(requestId: string): SensitiveKind | undefined
}

export interface BotRunnerDeps {
  store: BotStore
  manager: BotHost
  settings(): Pick<Settings, 'projects' | 'chat'>
  /** 'bots' and 'bot:item' for the renderer. */
  broadcast(e: OfficeEvent): void
  /** System notification; a click opens the Chat on `threadId` (bot:open). */
  notify(title: string, body: string, threadId: string): void
  now?: () => number
}

/** A run the runner follows until its result arrives. */
interface Active {
  botId: string
  agentId: string
  item: RunItem
  /** The item is in the thread. A run opens before its message goes, so a result that comes back at once still finds it. */
  shown: boolean
  /** What the agent had spent before the run, to tell this run's cost. */
  spentBefore: number
  /** The conversation the run started in: another one means it was cleared mid-run. */
  sessionId?: string
  /** The last thing the bot said: the bubble when the result comes back empty. */
  candidate?: string
  /** Messages sent while it ran: each is a turn of its own, so each gets a run after this one. */
  queued: number
  /** Stop was pressed: the run ends with the interrupted turn's result, or after a grace time. */
  stopped?: NodeJS.Timeout
}

/** How often idle bot agents are looked at. */
const SWEEP_MS = 60_000
/** After Stop, the interrupted turn's result has this long to arrive before the run is closed anyway. */
const STOP_GRACE_MS = 5_000
const STOPPED = 'Você parou esta rodada.'
const BUSY_STATUSES = new Set(['working', 'starting', 'waiting'])

const money = (usd: number) => `US$ ${usd.toFixed(2).replace('.', ',')}`
const hhmm = (t: number) => stamp(t).slice(6)
/** Bots never run in "Sem pedir nada", whatever reaches the runner. */
const safeMode = (mode: string): OfficePermissionMode => (mode === 'bypassPermissions' ? 'default' : (mode as OfficePermissionMode))

/**
 * From a bot to its office agent, and from the agent back to the bot's thread (Chat dos bots,
 * CB-05). A bot is an office agent with a standing job: it hires one when needed (or brings
 * back the saved conversation), sends it the player's messages and the automations' tasks,
 * and turns what the agent does into thread items: the run with its steps, the approvals, the
 * reply bubble. Its agent leaves the office after a while idle; the conversation stays.
 *
 * Logs carry ids, counts, durations and the model, never what was said.
 */
export class BotRunner {
  /** botId -> its run in progress. */
  private active = new Map<string, Active>()
  /** The user line the runner itself is sending, and whether the thread shows it. */
  private own: { agentId: string; show: boolean } | null = null
  /** requestId -> its approval item. */
  private requests = new Map<string, ApprovalItem>()
  /** agentId -> the bot whose "!" command, sent from the Chat, is running. */
  private shells = new Map<string, string>()
  /** agentId -> when the runner last used it (for the idle sweep). */
  private touched = new Map<string, number>()
  /** Agents whose stopped run closed before its result: that result, if it comes, is dropped. */
  private leftover = new Set<string>()
  /** botId -> what its runs spent today. */
  private spend = new Map<string, { day: string; usd: number }>()
  /** botId -> its agent on the way (summon is async): two messages never hire two agents. */
  private hiring = new Map<string, Promise<AgentSummary>>()
  private sweeper: NodeJS.Timeout | null = null
  private now: () => number
  /** Demo mode: plays the bot's run instead of messaging a real agent. */
  demoSend?: (botId: string, text: string) => void

  constructor(private d: BotRunnerDeps) {
    this.now = d.now ?? (() => Date.now())
    d.manager.on('event', (e) => this.onEvent(e))
    d.manager.on('decision', (n) => this.onDecision(n))
    d.manager.on('quietResult', (r) => this.onResult(r))
  }

  // ---------- setup ----------

  /** What the manager asks of the bot's agents: prompt, guard, connections, where results go. */
  hooks(): BotHooks {
    return {
      prompt: (s) => {
        const bot = this.botOf(s)
        return bot ? botSystemPrompt(bot, this.d.store.memory(bot.id), this.floorName(bot)) : undefined
      },
      // undefined: every kind is held (the bot is gone, or the list did not load).
      askBefore: (s) => this.botOf(s)?.askBefore,
      // A bot that is gone sees only the office's own tools.
      apps: (s) => this.botOf(s)?.apps ?? [],
      quietResult: (s) => !!this.botOf(s) && !this.chat().deliverInOffice,
    }
  }

  /** Startup: finds the bots' agents that came back with the office and starts the idle sweep. */
  start(): void {
    for (const a of this.d.manager.list()) {
      const bot = a.bot ? this.d.store.bot(a.bot) : undefined
      if (bot && !bot.agentId) bot.agentId = a.id
    }
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS)
    this.sweeper.unref?.()
    this.changed()
  }

  dispose(): void {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    for (const run of this.active.values()) if (run.stopped) clearTimeout(run.stopped)
  }

  // ---------- reads ----------

  list(): Bot[] {
    return this.d.store.bots
  }

  /** The bot's run in progress, if any. */
  activeRun(botId: string): RunItem | undefined {
    return this.active.get(botId)?.item
  }

  /** Any bot run in progress (quit asks before closing over one). */
  running(): number {
    return this.active.size
  }

  /** What the bot spent today: its runs of the day plus the one running now. */
  spentToday(bot: Bot): number {
    const day = localDay(this.now())
    let s = this.spend.get(bot.id)
    if (!s || s.day !== day) {
      s = { day, usd: bot.runs.filter((r) => localDay(r.startedAt) === day).reduce((t, r) => t + (r.costUsd ?? 0), 0) }
      this.spend.set(bot.id, s)
    }
    const run = this.active.get(bot.id)
    const live = run ? Math.max(0, (this.d.manager.agent(run.agentId)?.spentUsd ?? 0) - run.spentBefore) : 0
    return s.usd + live
  }

  // ---------- from the Chat ----------

  /**
   * The player wrote to the bot. While it works, the message joins the queue of the current
   * run (as in the panel) and becomes a run of its own when its turn comes. `!cmd` runs in the
   * bot's folder like in the panel and its output comes back as a notice.
   */
  async send(botId: string, text: string, attachments: AttachmentInput[] = []): Promise<void> {
    const bot = this.must(botId)
    const body = text.trim()
    if (!body && !attachments.length) return
    const command = body.startsWith('!') && !attachments.length ? body.slice(1).trim() : ''
    if (!command && this.overDay(bot)) {
      this.put(bot.id, { id: randomUUID(), t: this.now(), kind: 'user', text })
      this.notice(bot.id, `${this.overDayText(bot)} A mensagem não foi enviada.`, 'warn')
      return
    }
    const a = await this.ensureAgent(bot.id)
    const m = this.d.manager
    if (command) {
      if (bot.demo) return this.notice(bot.id, 'No modo demonstração os comandos "!" não rodam.', 'info')
      this.shells.set(a.id, bot.id)
      this.touched.set(a.id, this.now())
      const done = this.asOwn(a.id, true, () => m.runCommand(a.id, command))
      await done.finally(() => this.shells.delete(a.id))
      return
    }
    const current = this.active.get(bot.id)
    const joins = !!current && current.agentId === a.id && !current.stopped && m.isBusy(a.id)
    // A run still open with its agent idle: stopped and waiting for its result, or lost track of.
    if (current && !joins) {
      if (current.stopped) this.closeStopped(current, true)
      else this.close(current, { text: 'A rodada terminou sem resposta.', isError: true })
    }
    const run = joins ? undefined : this.open(bot.id, a, { kind: 'message' })
    if (bot.demo) this.put(bot.id, { id: randomUUID(), t: this.now(), kind: 'user', text })
    try {
      this.asOwn(a.id, true, () => this.deliverText(bot, a.id, text, undefined, attachments))
    } catch (err) {
      if (run) this.discard(run)
      throw err
    }
    if (run) this.show(run)
    else if (current && this.active.get(bot.id) === current) current.queued++
  }

  /** "Rodar agora": a run in the current conversation with the bot's job as the task. */
  async runNow(botId: string): Promise<void> {
    const bot = this.must(botId)
    if (this.busy(bot)) throw new Error(`${bot.name} está trabalhando. Espere a rodada terminar ou pare antes de rodar de novo.`)
    if (this.overDay(bot)) return this.notice(bot.id, this.overDayText(bot), 'warn')
    const a = await this.ensureAgent(bot.id)
    if (this.d.manager.isBusy(a.id)) throw new Error(`${bot.name} está trabalhando. Espere a rodada terminar ou pare antes de rodar de novo.`)
    const trigger: RunTrigger = { kind: 'manual' }
    const run = this.open(bot.id, a, trigger)
    const text = `${runHeader(trigger, this.now())}\n\nFaça agora o seu trabalho, como o seu papel descreve.`
    try {
      this.asOwn(a.id, false, () => this.deliverText(bot, a.id, text, runLabel(trigger)))
    } catch (err) {
      this.discard(run)
      throw err
    }
    this.show(run)
  }

  /**
   * A run started by an automation (phase 2): a fresh conversation, with the trigger's header,
   * the task and the latest messages of the thread. A bot already working skips it, with a
   * notice; so does a bot past its daily cap. Never throws: the outcome is the run's status.
   */
  async runScheduled(botId: string, task: string, trigger: RunTrigger): Promise<BotRunStatus> {
    const bot = this.d.store.bot(botId)
    if (!bot) return 'failed'
    const at = this.now()
    if (this.busy(bot)) return this.skip(bot, trigger, `Pulei a rodada das ${hhmm(at)}: ${bot.name} estava ocupado.`)
    if (this.overDay(bot)) return this.skip(bot, trigger, this.overDayText(bot))
    let a: AgentSummary
    try {
      a = await this.ensureAgent(bot.id)
    } catch (err) {
      return this.fail(bot, trigger, err instanceof Error ? err.message : String(err))
    }
    const m = this.d.manager
    if (m.isBusy(a.id)) return this.skip(bot, trigger, `Pulei a rodada das ${hhmm(at)}: ${bot.name} estava ocupado.`)
    // Each scheduled run starts a fresh conversation, so the context does not grow day after day.
    if (!bot.demo) {
      m.clearContext(a.id, 'Rodada de automação: conversa nova. A memória e as últimas mensagens do fio vão junto.')
      m.configure(a.id, { permissionMode: safeMode(bot.permissionMode), model: bot.model, effort: bot.effort })
    }
    const context = recentContext(this.d.store.thread(bot.id).all(), BOT_LIMITS.context, { [bot.id]: bot.name })
    const text = [runHeader(trigger, at), task.trim(), context].filter(Boolean).join('\n\n')
    const run = this.open(bot.id, this.d.manager.agent(a.id) ?? a, trigger)
    try {
      this.asOwn(a.id, false, () => this.deliverText(bot, a.id, text, runLabel(trigger)))
    } catch (err) {
      this.close(run, { text: err instanceof Error ? err.message : String(err), isError: true })
      return 'failed'
    }
    this.show(run)
    return this.active.get(bot.id) === run ? 'running' : (run.item.status as BotRunStatus)
  }

  /** Interrupts the bot's run; the conversation stays. */
  async stop(botId: string): Promise<void> {
    const bot = this.must(botId)
    const run = this.active.get(bot.id)
    if (run && !run.stopped) {
      run.stopped = setTimeout(() => this.closeStopped(run, true), STOP_GRACE_MS)
      run.stopped.unref?.()
    }
    if (bot.demo) {
      if (run) this.closeStopped(run, false)
      return
    }
    const agentId = run?.agentId ?? bot.agentId
    if (agentId) await this.d.manager.interrupt(agentId)
  }

  /** "Nova conversa": the next message starts from zero; the memory stays. */
  newConversation(botId: string): void {
    const bot = this.must(botId)
    if (this.busy(bot)) throw new Error(`${bot.name} está trabalhando. Pare a rodada antes de começar uma conversa nova.`)
    const a = bot.agentId ? this.d.manager.agent(bot.agentId) : undefined
    if (a && !bot.demo) this.d.manager.clearContext(a.id, 'Conversa nova, começada pelo Chat.')
    bot.sessionId = undefined
    this.d.store.update(bot)
    this.notice(bot.id, 'Nova conversa. O bot guarda só o que está na memória.', 'info')
    this.changed()
  }

  /** Model and effort from the thread's header: they count from the next message. */
  configure(botId: string, patch: { model?: string; effort?: EffortLevel }): Bot {
    const bot = this.must(botId)
    if ('model' in patch) bot.model = patch.model || undefined
    if ('effort' in patch) bot.effort = patch.effort || undefined
    bot.updatedAt = this.now()
    this.d.store.update(bot)
    if (bot.agentId && !bot.demo) this.d.manager.configure(bot.agentId, { model: bot.model, effort: bot.effort })
    this.changed()
    return bot
  }

  /**
   * The profile was saved. The live agent takes the new mode and brain at once (when idle). A
   * new floor, folder or worktree choice cannot carry the conversation along: the agent
   * leaves (when idle) and the next message starts a new conversation there.
   */
  updated(before: Bot | undefined, bot: Bot): void {
    const m = this.d.manager
    const a = bot.agentId ? m.agent(bot.agentId) : undefined
    const moved = !!before && (before.floor !== bot.floor || before.cwd !== bot.cwd || before.worktree !== bot.worktree)
    if (moved) {
      bot.sessionId = undefined
      this.d.store.setWorktree(bot.id, undefined)
      this.d.store.update(bot)
      if (a && !bot.demo && !m.isBusy(a.id) && !this.active.has(bot.id)) m.fire(a.id)
    } else if (a && !bot.demo) {
      m.configure(a.id, { permissionMode: safeMode(bot.permissionMode), model: bot.model, effort: bot.effort })
    }
    this.changed()
  }

  /** The bot was deleted: its run ends, its agent leaves, nothing more reaches its thread. */
  forget(botId: string): void {
    const run = this.active.get(botId)
    if (run?.stopped) clearTimeout(run.stopped)
    this.active.delete(botId)
    this.spend.delete(botId)
    for (const [id, item] of this.requests) if (item.botId === botId) this.requests.delete(id)
    const agentId = run?.agentId ?? this.d.store.bot(botId)?.agentId
    if (agentId && this.d.manager.agent(agentId)) this.d.manager.fire(agentId)
  }

  /** Demo mode: the played run ends with this reply. */
  demoReply(botId: string, text: string): void {
    const run = this.active.get(botId)
    if (run) this.close(run, { text, isError: false, durationMs: Math.max(0, this.now() - run.item.t) })
  }

  /** The bots changed: the whole list to the renderer. */
  changed(): void {
    this.d.broadcast({ type: 'bots', bots: this.list() })
  }

  // ---------- the bot's agent ----------

  /**
   * The bot's agent: the one in the office, or its saved conversation brought back, or a new
   * agent waiting at a desk (like summon), with the bot's name, look, brain and mode.
   */
  async ensureAgent(botId: string): Promise<AgentSummary> {
    const bot = this.must(botId)
    const m = this.d.manager
    const live = [bot.agentId ? m.agent(bot.agentId) : undefined, ...m.list()].find((a) => a?.bot === bot.id)
    if (live) return this.adopt(bot.id, live)
    const hiring = this.hiring.get(bot.id)
    if (hiring) return hiring
    const cwd = this.cwdOf(bot)
    const defaults: Defaults = { model: bot.model, effort: bot.effort, accounts: bot.accounts, permissionMode: safeMode(bot.permissionMode) }
    const as: BotIdentity = { bot: bot.id, name: bot.name, look: bot.look }
    if (bot.demo) return this.adopt(bot.id, m.demoAgent(bot.name, cwd, as))
    const saved = bot.worktree ? this.d.store.worktree(bot.id) : undefined
    const worktree = saved && isDir(saved.path) ? saved : undefined
    // A conversation that lived in a worktree only resumes there.
    if (bot.sessionId && (!bot.worktree || worktree)) {
      log.info(`[bots] ${bot.id} volta ao escritório com a conversa salva`)
      return this.adopt(bot.id, m.recall(bot.sessionId, cwd, [], defaults, worktree, [], as))
    }
    const p = m.summon(cwd, defaults, bot.worktree, as).then((a) => this.adopt(bot.id, a))
    this.hiring.set(bot.id, p)
    try {
      return await p
    } finally {
      this.hiring.delete(bot.id)
    }
  }

  private adopt(botId: string, a: AgentSummary): AgentSummary {
    const bot = this.d.store.bot(botId)
    if (!bot) throw new Error('Esse bot não existe mais.')
    if (bot.agentId !== a.id) {
      bot.agentId = a.id
      this.changed()
    }
    if (a.worktree) this.d.store.setWorktree(bot.id, a.worktree)
    this.touched.set(a.id, this.now())
    return a
  }

  /** The floor's folder, or the bot's own on the ground floor. */
  private cwdOf(bot: Bot): string {
    const project = bot.floor !== BOT_GROUND_FLOOR ? this.d.settings().projects.find((p) => p.id === bot.floor) : undefined
    if (bot.demo) return project?.cwd ?? bot.cwd ?? '/'
    if (bot.floor !== BOT_GROUND_FLOOR) {
      if (!project) throw new Error(`O andar de ${bot.name} não existe mais. Abra o perfil do bot e escolha outro.`)
      if (!isDir(project.cwd)) throw new Error(`A pasta do andar ${project.name} (${project.cwd}) não existe mais. Corrija o andar em Configurações.`)
      return project.cwd
    }
    if (!bot.cwd || !isDir(bot.cwd)) throw new Error(`A pasta de ${bot.name} (${bot.cwd || 'nenhuma'}) não existe mais. Abra o perfil do bot e escolha outra.`)
    return bot.cwd
  }

  private floorName(bot: Bot): string {
    return this.d.settings().projects.find((p) => p.id === bot.floor)?.name ?? 'Térreo'
  }

  private deliverText(bot: Bot, agentId: string, text: string, display?: string, attachments: AttachmentInput[] = []): void {
    this.touched.set(agentId, this.now())
    if (bot.demo) this.demoSend?.(bot.id, text)
    else this.d.manager.sendMessage(agentId, text, display, attachments)
  }

  /** Runs fn with the user line it logs marked as the runner's own (sendMessage logs it at once). */
  private asOwn<T>(agentId: string, show: boolean, fn: () => T): T {
    this.own = { agentId, show }
    try {
      return fn()
    } finally {
      this.own = null
    }
  }

  // ---------- runs ----------

  private open(botId: string, a: AgentSummary, trigger: RunTrigger): Active {
    const bot = this.must(botId)
    const at = this.now()
    const runId = randomUUID()
    const item: RunItem = { id: `rodada-${runId}`, t: at, kind: 'run', botId, runId, trigger, label: runLabel(trigger), status: 'running', steps: 0 }
    const run: Active = { botId, agentId: a.id, item, shown: false, spentBefore: a.spentUsd ?? 0, sessionId: a.sessionId, queued: 0 }
    this.active.set(botId, run)
    this.leftover.delete(a.id)
    this.touched.set(a.id, at)
    const entry: BotRun = { id: runId, trigger, startedAt: at, status: 'running', steps: 0, threadId: botId, itemId: item.id }
    bot.runs = [entry, ...bot.runs].slice(0, BOT_LIMITS.runs)
    this.d.store.update(bot)
    this.changed()
    log.info(`[bots] rodada ${runId} de ${botId} começou (${trigger.kind})`)
    return run
  }

  /** Puts the run item in the thread, unless it already ended (then its close put it). */
  private show(run: Active): void {
    if (this.active.get(run.botId) === run && !run.shown) this.putRun(run)
  }

  /** A run whose message never went (an attachment that could not go): it leaves no trace. */
  private discard(run: Active): void {
    if (this.active.get(run.botId) !== run) return
    this.active.delete(run.botId)
    const bot = this.d.store.bot(run.botId)
    if (!bot) return
    bot.runs = bot.runs.filter((r) => r.id !== run.item.runId)
    this.d.store.update(bot)
    this.changed()
  }

  private putRun(run: Active): void {
    run.shown = true
    this.put(run.botId, run.item)
  }

  private setStatus(run: Active, status: BotRunStatus): void {
    if (run.item.status === status) return
    run.item = { ...run.item, status }
    if (run.shown) this.putRun(run)
    const bot = this.d.store.bot(run.botId)
    if (!bot) return
    bot.runs = bot.runs.map((r) => (r.id === run.item.runId ? { ...r, status, steps: run.item.steps } : r))
    this.d.store.update(bot)
    this.changed()
  }

  /** Ends the run: its item, the reply bubble (or the error notice), Bot.runs, the cost, a notification. */
  private close(run: Active, end: RunEnd, stopped = false): void {
    if (this.active.get(run.botId) !== run) return
    this.active.delete(run.botId)
    if (run.stopped) clearTimeout(run.stopped)
    const at = this.now()
    const agent = this.d.manager.agent(run.agentId)
    const spent = Math.max(0, (agent?.spentUsd ?? run.spentBefore) - run.spentBefore)
    const out = closeRun(run.item, { ...end, costUsd: spent }, at, stopped ? undefined : run.candidate)
    run.item = stopped ? { ...out.run, error: STOPPED } : out.run
    this.putRun(run)
    if (out.bubble && !stopped) this.put(run.botId, out.bubble)
    if (out.notice) this.put(run.botId, stopped ? { ...out.notice, text: STOPPED, tone: 'info' } : out.notice)
    const bot = this.d.store.bot(run.botId)
    if (!bot) return
    const item = run.item
    if (item.costUsd) {
      this.spentToday(bot)
      const s = this.spend.get(bot.id)
      if (s) s.usd += item.costUsd
    }
    bot.runs = bot.runs.map((r) =>
      r.id === item.runId
        ? {
            ...r,
            status: item.status,
            endedAt: at,
            steps: item.steps,
            ...(item.costUsd ? { costUsd: item.costUsd } : {}),
            ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
            ...(item.error ? { error: item.error } : {}),
          }
        : r,
    )
    this.d.store.update(bot)
    this.changed()
    log.info(`[bots] rodada ${item.runId} de ${bot.id}: ${item.status}, ${item.steps} passos, ${item.durationMs ?? 0} ms, modelo ${agent?.model ?? bot.model ?? 'padrão'}`)
    const mode = this.chat().notify
    if (item.status === 'failed' && !stopped && mode !== 'off') this.d.notify(`${bot.name}: a rodada falhou`, item.error ?? 'O bot parou com um erro.', bot.id)
    else if (item.status === 'ok' && mode === 'all') this.d.notify(`${bot.name} respondeu`, clip(out.bubble?.text ?? 'Rodada concluída.', 140), bot.id)
    // A message sent while it ran is the next turn: it gets a run of its own.
    if (run.queued > 0 && agent && !stopped) {
      const next = this.open(bot.id, agent, { kind: 'message' })
      next.queued = run.queued - 1
      this.show(next)
    }
  }

  /** Stop: closes the run. `late`: its result never came, so a result that comes later is not news. */
  private closeStopped(run: Active, late: boolean): void {
    if (this.active.get(run.botId) !== run) return
    if (late) this.leftover.add(run.agentId)
    this.close(run, { text: STOPPED, isError: true }, true)
  }

  /** A run that did not start (busy, over the cap): its item, a notice and Bot.runs. */
  private skip(bot: Bot, trigger: RunTrigger, why: string): BotRunStatus {
    this.record(bot, trigger, 'skipped', why)
    this.notice(bot.id, why, 'warn')
    return 'skipped'
  }

  private fail(bot: Bot, trigger: RunTrigger, why: string): BotRunStatus {
    this.record(bot, trigger, 'failed', why)
    this.notice(bot.id, why, 'error')
    if (this.chat().notify !== 'off') this.d.notify(`${bot.name}: a rodada falhou`, why, bot.id)
    return 'failed'
  }

  private record(bot: Bot, trigger: RunTrigger, status: 'skipped' | 'failed', why: string): void {
    const at = this.now()
    const runId = randomUUID()
    const item: RunItem = { id: `rodada-${runId}`, t: at, kind: 'run', botId: bot.id, runId, trigger, label: runLabel(trigger), status, steps: 0, error: why }
    this.put(bot.id, item)
    bot.runs = [{ id: runId, trigger, startedAt: at, endedAt: at, status, steps: 0, error: why, threadId: bot.id, itemId: item.id }, ...bot.runs].slice(0, BOT_LIMITS.runs)
    this.d.store.update(bot)
    this.changed()
    log.info(`[bots] rodada de ${bot.id} ${status === 'skipped' ? 'pulada' : 'falhou antes de começar'} (${trigger.kind})`)
  }

  // ---------- from the manager ----------

  private onEvent(e: OfficeEvent): void {
    switch (e.type) {
      case 'agent:log':
        return this.onLog(e.agentId, e.entry)
      case 'agent:upsert':
        return this.onUpsert(e.agent)
      case 'permission:new':
        return this.onRequest(e.request)
      case 'permission:resolved':
        return this.onResolved(e.agentId)
      case 'result:new':
        return this.onResult(e.result)
      case 'agent:removed':
        return this.onRemoved(e.agentId)
      default:
        return
    }
  }

  private onLog(agentId: string, entry: LogEntry): void {
    const bot = this.botOfAgent(agentId)
    if (!bot) return
    const run = this.active.get(bot.id)
    if (entry.kind === 'user') {
      const own = this.own?.agentId === agentId ? this.own : null
      if (own && !own.show) return
      const { user } = itemsFromLog(entry, undefined)
      if (user) this.put(bot.id, user)
      // Written in the office panel (or by a routine): it is work for the bot too.
      if (own || entry.text.startsWith('! ')) return
      if (run && run.agentId === agentId) run.queued++
      else {
        const a = this.d.manager.agent(agentId)
        if (a) this.show(this.open(bot.id, a, { kind: 'message' }))
      }
      return
    }
    if (entry.kind === 'tool_result' && this.shells.get(agentId) === bot.id) {
      this.shells.delete(agentId)
      this.notice(bot.id, `Saída do seu comando:\n${clip(entry.text, 4000)}`, entry.isError ? 'error' : 'info')
      return
    }
    if (!run || run.agentId !== agentId) return
    const change = itemsFromLog(entry, run.item)
    if (change.candidate) run.candidate = change.candidate
    if (change.run) {
      run.item = change.run
      if (run.shown) this.putRun(run)
    }
  }

  private onUpsert(a: AgentSummary): void {
    const bot = a.bot ? this.d.store.bot(a.bot) : undefined
    if (!bot) return
    let dirty = false
    if (bot.agentId !== a.id) {
      bot.agentId = a.id
      dirty = true
    }
    // The conversation to resume later: one that had a turn. A cleared one starts over.
    if (a.lastTurnAt && a.sessionId && a.sessionId !== bot.sessionId) {
      bot.sessionId = a.sessionId
      this.d.store.update(bot)
      dirty = true
    } else if (!a.lastTurnAt && bot.sessionId && a.sessionId !== bot.sessionId) {
      bot.sessionId = undefined
      this.d.store.update(bot)
      dirty = true
    }
    if (a.worktree) this.d.store.setWorktree(bot.id, a.worktree)
    const busy = BUSY_STATUSES.has(a.status)
    if (busy) this.touched.set(a.id, this.now())
    const run = this.active.get(bot.id)
    if (run && run.agentId === a.id) {
      if (busy && a.activity && a.activity !== run.item.activity) {
        run.item = { ...run.item, activity: a.activity }
        if (run.shown) this.putRun(run)
      }
      // Cleared in the office panel mid-run: no result will come.
      if (!busy && run.sessionId && a.sessionId !== run.sessionId) this.close(run, { text: 'A conversa foi limpa antes de a rodada terminar.', isError: true })
    }
    if (dirty) this.changed()
  }

  private onRequest(req: PermissionRequest): void {
    const bot = this.botOfAgent(req.agentId)
    if (!bot) return
    const item: ApprovalItem = {
      id: `pedido-${req.id}`,
      t: this.now(),
      kind: 'approval',
      botId: bot.id,
      requestId: req.id,
      request: approvalFromRequest(req, this.d.manager.requestSensitive(req.id)),
      status: 'pending',
    }
    this.requests.set(req.id, item)
    this.put(bot.id, item)
    const run = this.active.get(bot.id)
    if (run && run.agentId === req.agentId) this.setStatus(run, 'waiting')
    log.info(`[bots] ${bot.id} pede aprovação (${req.kind}${item.request.sensitive ? `, ${item.request.sensitive}` : ''})`)
    if (this.chat().notify !== 'off') {
      const what = req.kind === 'question' ? 'tem uma pergunta' : req.kind === 'plan' ? 'quer sua aprovação para um plano' : 'espera seu sim'
      this.d.notify(`${bot.name} ${what}`, clip(req.title, 140), bot.id)
    }
  }

  private onResolved(agentId: string): void {
    const bot = this.botOfAgent(agentId)
    const run = bot ? this.active.get(bot.id) : undefined
    if (!run || run.agentId !== agentId || run.item.status !== 'waiting') return
    if (!this.d.manager.pendingRequests().some((p) => p.agentId === agentId)) this.setStatus(run, 'running')
  }

  private onDecision(n: DecisionNote): void {
    const item = this.requests.get(n.request.id)
    if (!item) return
    this.requests.delete(n.request.id)
    const { status, note } = approvalOutcome(n.request.kind, n.decision, n.cancelled)
    this.put(item.botId, { ...item, status, decidedAt: this.now(), ...(note ? { note } : {}) })
  }

  private onResult(r: AgentResult): void {
    const bot = this.botOfAgent(r.agentId)
    if (!bot) return
    const run = this.active.get(bot.id)
    if (run && run.agentId === r.agentId) {
      if (run.stopped) return this.closeStopped(run, false)
      return this.close(run, { text: r.text, isError: r.isError, durationMs: r.durationMs })
    }
    // The answer to a run stopped before it came: not news.
    if (this.leftover.delete(r.agentId)) return
    // A result the runner was not following: it still reaches the thread.
    const text = r.text.trim()
    if (!text) return
    const at = this.now()
    if (r.isError) this.notice(bot.id, clip(text, 2000), 'error')
    else this.put(bot.id, { id: randomUUID(), t: at, kind: 'bot', botId: bot.id, text })
  }

  private onRemoved(agentId: string): void {
    this.touched.delete(agentId)
    this.shells.delete(agentId)
    this.leftover.delete(agentId)
    const bot = this.d.store.bots.find((b) => b.agentId === agentId)
    if (!bot) return
    bot.agentId = undefined
    const run = this.active.get(bot.id)
    if (run && run.agentId === agentId) this.close(run, { text: 'O agente do bot saiu do escritório antes de terminar.', isError: true })
    this.changed()
  }

  // ---------- idle agents ----------

  /** A bot's agent idle for chat.idleLeaveMin leaves the office; its conversation stays for the next message. */
  sweep(): void {
    const min = this.chat().idleLeaveMin
    if (!(min > 0)) return
    const now = this.now()
    const m = this.d.manager
    const waiting = new Set([...m.pendingRequests().map((r) => r.agentId), ...m.pendingResults().map((r) => r.agentId)])
    for (const bot of this.d.store.bots) {
      if (bot.demo || !bot.agentId || this.active.has(bot.id)) continue
      const a = m.agent(bot.agentId)
      if (!a || m.isBusy(a.id) || waiting.has(a.id) || this.shells.has(a.id)) continue
      const last = Math.max(a.lastTurnAt ?? 0, this.touched.get(a.id) ?? 0, a.createdAt)
      if (now - last < min * 60_000) continue
      if (a.lastTurnAt && a.sessionId && bot.sessionId !== a.sessionId) {
        bot.sessionId = a.sessionId
        this.d.store.update(bot)
      }
      if (a.worktree) this.d.store.setWorktree(bot.id, a.worktree)
      log.info(`[bots] agente de ${bot.id} saiu do escritório depois de ${Math.round((now - last) / 60_000)} min parado`)
      m.fire(a.id)
    }
  }

  // ---------- helpers ----------

  private chat(): ChatSettings {
    return { ...CHAT_DEFAULTS, ...this.d.settings().chat }
  }

  private must(botId: string): Bot {
    const bot = this.d.store.bot(botId)
    if (!bot) throw new Error('Esse bot não existe mais. Ele pode ter sido apagado em outra janela.')
    return bot
  }

  private botOf(s: AgentSummary): Bot | undefined {
    return s.bot ? this.d.store.bot(s.bot) : undefined
  }

  private botOfAgent(agentId: string): Bot | undefined {
    const a = this.d.manager.agent(agentId)
    if (a?.bot) return this.d.store.bot(a.bot)
    return this.d.store.bots.find((b) => b.agentId === agentId)
  }

  /** Working, waiting for a yes, or with a run open. */
  private busy(bot: Bot): boolean {
    return this.active.has(bot.id) || (!!bot.agentId && this.d.manager.isBusy(bot.agentId))
  }

  private overDay(bot: Bot): boolean {
    return bot.dailyBudgetUsd > 0 && this.spentToday(bot) >= bot.dailyBudgetUsd
  }

  private overDayText(bot: Bot): string {
    return `Teto de custo atingido: ${bot.name} gastou ${money(this.spentToday(bot))} hoje, e o teto do dia é ${money(bot.dailyBudgetUsd)}. Aumente o teto no perfil do bot ou espere até amanhã.`
  }

  private notice(threadId: string, text: string, tone: 'info' | 'warn' | 'error'): void {
    this.put(threadId, { id: randomUUID(), t: this.now(), kind: 'notice', text, tone })
  }

  private put(threadId: string, item: ThreadItem): void {
    this.d.store.thread(threadId).put(item)
    this.d.broadcast({ type: 'bot:item', threadId, item })
  }
}
