import { randomUUID } from 'node:crypto'
import { allowRun, eventLabel, matchTrigger, renderTriggerPrompt, ticketFloor, type BotEvent } from '@shared/bots-automation'
import { BOT_LIMITS, type Actor, type BotEventTrigger, type Meeting, type MeetingStatus, type OfficeEvent, type ProjectFloor, type RunTrigger, type Ticket, type TicketStatus } from '@shared/types'
import { log } from '../log'
import type { BotRunEnd, BotRunHost } from '../routines/scheduler'
import type { CleanBotTriggerDraft } from './automation-validate'

const HOUR = 3_600_000
/** A ticket the board never showed before counts as created only this soon after its createdAt (a reopened one is not new). */
const CREATED_WINDOW_MS = 5 * 60_000

type History = BotEventTrigger['history'][number]

/** Where the triggers live: bots.json (the BotStore fits). */
export interface TriggerStore {
  eventTriggers: BotEventTrigger[]
  save(): void
}

export interface TriggerDeps {
  store: TriggerStore
  bots: BotRunHost
  settings(): { projects: Pick<ProjectFloor, 'id' | 'cwd'>[] }
  /** The board as it is now: tells a created ticket from one that moved. */
  tickets(): Ticket[]
  /** The ata of a meeting (Markdown) and its action items; null before the first one. */
  ata(meetingId: string): { markdown: string; actions: string[] } | null
  /** The bot an office agent works for, if any. */
  botOfAgent(agentId: string): string | undefined
  /** The list changed: send it to the renderer ('botTriggers'). */
  broadcast(triggers: BotEventTrigger[]): void
  now?: () => number
}

/**
 * Automações de evento (CB-13): a ticket created or moved, an ata ready, another bot done.
 * Each enabled trigger whose filters fit starts a run of its bot, with the event in the task.
 * Loops are cut three ways: a bot never answers its own doing, a chain of triggered runs
 * stops at BOT_LIMITS.chainDepth links, and each trigger runs at most maxPerHour times an hour.
 * What each trigger did (ran, limited, skipped) goes into its history.
 *
 * Logs carry ids and counts, never the event's content.
 */
export class BotTriggers {
  private now: () => number
  /** ticketId -> the column it was in. */
  private columns = new Map<string, TicketStatus>()
  /** meetingId -> its last status, and the ata it had when the ata started being written. */
  private meetings = new Map<string, { status: MeetingStatus; before?: string }>()
  /** triggerId -> when its runs started (the last hour's), for the cap per hour. */
  private fired = new Map<string, number[]>()
  /** runId -> the links of the chain that run is (only runs a trigger started). */
  private depth = new Map<string, number>()
  /** botId -> its triggered run going on now, for the events that run causes. */
  private live = new Map<string, { runId: string; depth: number }>()
  /** triggerId -> events dropped by the cap since the last run, for one history line instead of many. */
  private limited = new Map<string, number>()

  constructor(private d: TriggerDeps) {
    this.now = d.now ?? (() => Date.now())
    for (const t of d.tickets()) this.columns.set(t.id, t.status)
    const since = this.now() - HOUR
    for (const t of this.list()) {
      const ran = t.history.filter((h) => h.status === 'ran' && h.t > since).map((h) => h.t)
      if (ran.length) this.fired.set(t.id, ran)
    }
    d.bots.on('run:end', (e) => this.onRunEnd(e))
  }

  // ---------- reads ----------

  list(): BotEventTrigger[] {
    return this.d.store.eventTriggers
  }

  get(id: string): BotEventTrigger | undefined {
    return this.list().find((t) => t.id === id)
  }

  // ---------- changes from the form ----------

  /** Creates (no id, or an unknown one) or replaces a trigger; its history stays. */
  save(d: CleanBotTriggerDraft): BotEventTrigger {
    const now = this.now()
    const old = d.id ? this.get(d.id) : undefined
    if (!old && this.list().length >= BOT_LIMITS.eventTriggers) throw new Error(`Limite de ${BOT_LIMITS.eventTriggers} automações de evento atingido. Apague alguma antes.`)
    const t: BotEventTrigger = {
      id: old?.id ?? randomUUID(),
      botId: d.botId,
      name: d.name,
      kind: d.kind,
      filter: d.filter,
      prompt: d.prompt,
      enabled: d.enabled,
      maxPerHour: d.maxPerHour,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      history: old && old.kind === d.kind && old.botId === d.botId ? old.history : [],
    }
    this.d.store.eventTriggers = old ? this.list().map((x) => (x.id === t.id ? t : x)) : [...this.list(), t]
    this.changed()
    return t
  }

  remove(id: string): void {
    if (!this.get(id)) return
    this.d.store.eventTriggers = this.list().filter((t) => t.id !== id)
    this.forget(id)
    this.changed()
  }

  setEnabled(id: string, enabled: boolean): BotEventTrigger {
    const t = this.get(id)
    if (!t) throw new Error('Essa automação não existe mais.')
    t.enabled = enabled
    t.updatedAt = this.now()
    this.d.store.save()
    this.changed()
    return t
  }

  /** "Pausar automações" of a bot: pauses or resumes every event trigger it has. Returns how many changed. */
  setEnabledForBot(botId: string, enabled: boolean): number {
    const now = this.now()
    let n = 0
    for (const t of this.list()) {
      if (t.botId !== botId || t.enabled === enabled) continue
      t.enabled = enabled
      t.updatedAt = now
      n++
    }
    if (n) {
      this.d.store.save()
      this.changed()
    }
    return n
  }

  /**
   * The bot was deleted: its triggers go. Other bots' "when it finishes" triggers pause: they
   * would never fire again, and the form shows them paused for the player to fix. Returns how many went.
   */
  removeForBot(botId: string): number {
    const gone = this.list().filter((t) => t.botId === botId)
    const waiting = this.list().filter((t) => t.botId !== botId && t.filter.botId === botId && t.enabled)
    if (!gone.length && !waiting.length) return 0
    for (const t of waiting) {
      t.enabled = false
      t.updatedAt = this.now()
    }
    this.d.store.eventTriggers = this.list().filter((t) => t.botId !== botId)
    for (const t of gone) this.forget(t.id)
    this.live.delete(botId)
    this.changed()
    return gone.length
  }

  // ---------- office events ----------

  /** Every office event goes through here (index.ts: the board's and the meetings'). */
  handle(e: OfficeEvent): void {
    if (e.type === 'ticket:upsert') this.onTicket(e.ticket)
    else if (e.type === 'ticket:removed') this.columns.delete(e.ticketId)
    else if (e.type === 'meeting:upsert') this.onMeeting(e.meeting)
    else if (e.type === 'meeting:removed') this.meetings.delete(e.meetingId)
  }

  private onTicket(t: Ticket): void {
    const before = this.columns.get(t.id)
    this.columns.set(t.id, t.status)
    if (t.closedAt) return
    const floor = ticketFloor(this.d.settings().projects, t.cwd)
    if (before === undefined) {
      if (this.now() - t.createdAt > CREATED_WINDOW_MS) return
      this.fire({ kind: 'ticket-created', floor, ticket: t }, this.causedBy(t.reporter))
    } else if (before !== t.status) {
      // Who moved it: the newest line of its activity.
      this.fire({ kind: 'ticket-moved', floor, ticket: t, from: before }, this.causedBy(t.activity.at(-1)?.actor))
    }
  }

  private onMeeting(m: Meeting): void {
    const seen = this.meetings.get(m.id)
    if (m.status === 'enhancing') {
      // The ata it has now: a rewrite that fails leaves it as it was, and that is not news.
      if (seen?.status !== 'enhancing') this.meetings.set(m.id, { status: m.status, before: this.d.ata(m.id)?.markdown })
      return
    }
    this.meetings.set(m.id, { status: m.status })
    if (seen?.status !== 'enhancing' || m.status !== 'ready') return
    const ata = this.d.ata(m.id)
    if (!ata || !ata.markdown.trim() || ata.markdown === seen.before) return
    this.fire({ kind: 'meeting-ata', floor: m.floor, meeting: { id: m.id, title: m.title, startedAt: m.startedAt }, ata: ata.markdown, actions: ata.actions }, {})
  }

  private onRunEnd(e: BotRunEnd): void {
    const depth = this.depth.get(e.runId) ?? 0
    this.depth.delete(e.runId)
    if (this.live.get(e.botId)?.runId === e.runId) this.live.delete(e.botId)
    if (e.status !== 'ok' && e.status !== 'failed') return
    const bot = this.d.bots.list().find((b) => b.id === e.botId)
    if (!bot) return
    this.fire(
      { kind: 'bot-done', botId: bot.id, botName: bot.name, status: e.status, text: e.text ?? '', ...(e.error ? { error: e.error } : {}) },
      { sourceBotId: bot.id, depth: depth + 1 },
    )
  }

  /** The bot behind an actor of the board, and how deep in a chain its run is. */
  private causedBy(actor: Actor | undefined): { sourceBotId?: string; depth?: number } {
    const botId = actor?.kind === 'agent' && actor.id ? this.d.botOfAgent(actor.id) : undefined
    if (!botId) return {}
    return { sourceBotId: botId, depth: (this.live.get(botId)?.depth ?? 0) + 1 }
  }

  // ---------- running ----------

  private fire(e: BotEvent, cause: { sourceBotId?: string; depth?: number }): void {
    const bots = this.d.bots.list()
    let matched = 0
    for (const t of this.list()) {
      const bot = bots.find((b) => b.id === t.botId)
      if (!bot || !matchTrigger(t, e, bot.floor)) continue
      matched++
      const now = this.now()
      const recent = (this.fired.get(t.id) ?? []).filter((x) => x > now - HOUR)
      const verdict = allowRun(t, { now, recent, depth: cause.depth ?? 1, sourceBotId: cause.sourceBotId })
      if (!verdict.ok) {
        // The bot's own doing is not news: nothing in the history.
        if (verdict.reason === 'self') continue
        if (verdict.reason === 'limit') this.noteLimited(t, verdict.note)
        else this.note(t, { t: now, status: verdict.status, note: verdict.note })
        log.info(`[bots] gatilho ${t.id} (${t.kind}) não rodou: ${verdict.reason}`)
        continue
      }
      // Counted and written before the run starts: a burst of events never gets past the cap.
      this.fired.set(t.id, [...recent, now])
      this.limited.delete(t.id)
      const line: History = { t: now, status: 'ran' }
      this.note(t, line)
      void this.launch(t, e, cause.depth ?? 1, line)
    }
    if (matched) log.info(`[bots] evento ${e.kind}: ${matched} gatilho(s)`)
  }

  /** Starts the run; `line` is its 'ran' line in the history, which becomes 'skipped' if the run does not start. */
  private async launch(t: BotEventTrigger, e: BotEvent, depth: number, line: History): Promise<void> {
    const trigger: RunTrigger = { kind: 'event', triggerId: t.id, label: eventLabel(e) }
    let start: Awaited<ReturnType<BotRunHost['runScheduled']>>
    try {
      start = await this.d.bots.runScheduled(t.botId, renderTriggerPrompt(t, e), trigger)
    } catch (err) {
      start = { skipped: err instanceof Error ? err.message : 'A rodada não começou.' }
    }
    if ('skipped' in start) {
      // A run that did not start does not count against the cap.
      const list = this.fired.get(t.id)
      const i = list?.lastIndexOf(line.t) ?? -1
      if (list && i >= 0) list.splice(i, 1)
      this.replace(t.id, line, { t: line.t, status: 'skipped', note: start.skipped })
      return
    }
    this.depth.set(start.runId, depth)
    this.live.set(t.botId, { runId: start.runId, depth })
    // Runs that never report back (the app closed mid-run) do not pile up.
    if (this.depth.size > 500) this.depth.delete(this.depth.keys().next().value as string)
    log.info(`[bots] gatilho ${t.id} começou a rodada ${start.runId} de ${t.botId} (elo ${depth})`)
  }

  /** One line for a run of events over the cap, with how many it dropped. */
  private noteLimited(t: BotEventTrigger, why: string): void {
    const n = (this.limited.get(t.id) ?? 0) + 1
    this.limited.set(t.id, n)
    const line: History = { t: this.now(), status: 'limited', note: n > 1 ? `${why} ${n} eventos ignorados.` : why }
    if (n > 1 && t.history[0]?.status === 'limited') t.history = [line, ...t.history.slice(1)]
    else t.history = [line, ...t.history].slice(0, BOT_LIMITS.runs)
    this.d.store.save()
    this.changed()
  }

  private note(t: BotEventTrigger, line: History): void {
    // The trigger may be gone (deleted while its run started).
    const live = this.get(t.id)
    if (!live) return
    live.history = [line, ...live.history].slice(0, BOT_LIMITS.runs)
    this.d.store.save()
    this.changed()
  }

  private replace(triggerId: string, line: History, next: History): void {
    const live = this.get(triggerId)
    if (!live) return
    const i = live.history.indexOf(line)
    live.history = i >= 0 ? live.history.map((h, j) => (j === i ? next : h)) : [next, ...live.history].slice(0, BOT_LIMITS.runs)
    this.d.store.save()
    this.changed()
  }

  private forget(triggerId: string): void {
    this.fired.delete(triggerId)
    this.limited.delete(triggerId)
  }

  private changed(): void {
    this.d.broadcast(this.list())
  }
}
