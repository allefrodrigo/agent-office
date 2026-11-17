// Chat dos bots: the pure rules of the Chat screen (CB-08 to CB-10). The DOM lives in
// renderer/src/ui/chat; everything here is plain data in, plain data out, and tested in
// test/bots-view.test.ts. Spec: docs/prd/chat-de-bots.md ("Experiência").

import { describeSchedule, nextRun, nextRuns, scheduleError } from './schedule'
import type { AgentSummary } from './types/agents'
import type { McpServerView } from './types/backstage'
import type {
  AutomationDraft,
  Bot,
  BotDraft,
  BotEventKind,
  BotEventTrigger,
  BotRun,
  BotTriggerDraft,
  RunTrigger,
  ThreadItem,
} from './types/bots'
import { BOT_GROUND_FLOOR, BOT_LIMITS, BOT_RUN_STATUS_LABEL, SENSITIVE_LABEL } from './types/bots'
import type { PermissionRequest } from './types/conversation'
import type { MissedPolicy, Routine, RoutineDraft, Schedule } from './types/routines'
import { ROUTINE_LIMITS } from './types/routines'
import type { TicketStatus } from './types/tickets'

const MIN = 60_000
const DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const WEEKDAY_PLURAL = ['Domingos', 'Segundas', 'Terças', 'Quartas', 'Quintas', 'Sextas', 'Sábados']
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function startOfDay(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Whole local days from `t` to `now` (0 = same day, 1 = yesterday). */
function daysAgo(t: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(t)) / DAY)
}

/** "07:30" */
export function clockTime(t: number): string {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The thread's day divider: "Hoje", "Ontem", "Seg, 10 nov" ("Seg, 10 nov 2025" in another year). */
export function dayLabel(t: number, now = Date.now()): string {
  const diff = daysAgo(t, now)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  const d = new Date(t)
  const base = `${WEEKDAY_SHORT[d.getDay()]}, ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`
}

/** Two items fall on different days: the thread draws a divider between them. */
export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b)
}

/** The time on a sidebar row: "agora", "07:30", "ontem", "seg", "10 nov". */
export function listTime(t: number, now = Date.now()): string {
  if (now - t < MIN && now >= t) return 'agora'
  const diff = daysAgo(t, now)
  if (diff <= 0) return clockTime(t)
  if (diff === 1) return 'ontem'
  const d = new Date(t)
  if (diff < 7) return WEEKDAY_SHORT[d.getDay()].toLowerCase()
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`
}

// ---------- automations ----------

/** A short sentence for a schedule, as the sidebar and the gallery show it: "Dias úteis às 07:30". */
export function scheduleLabel(s: Schedule): string {
  switch (s.kind) {
    case 'daily':
      return `Todo dia às ${s.time}`
    case 'weekly': {
      const days = [...new Set(s.days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      const key = [...days].sort().join(',')
      if (days.length === 7) return `Todo dia às ${s.time}`
      if (key === '1,2,3,4,5') return `Dias úteis às ${s.time}`
      if (key === '0,6') return `Fins de semana às ${s.time}`
      if (days.length === 1) return `${WEEKDAY_PLURAL[days[0]]} às ${s.time}`
      const names = days.map((d) => WEEKDAY_SHORT[d])
      return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]} às ${s.time}`
    }
    case 'interval':
      if (s.unit === 'hours') return s.every === 1 ? 'A cada hora' : `A cada ${s.every} h`
      return `A cada ${s.every} min`
    case 'once': {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s.at)
      return m ? `Em ${m[3]}/${m[2]} às ${m[4]}:${m[5]}` : 'Uma vez'
    }
    case 'cron':
      return `Cron ${s.expr.trim()}`
  }
}

/** The board's columns, as the trigger form and its sentence name them. */
export const TICKET_COLUMN_LABEL: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  todo: 'A fazer',
  doing: 'Fazendo',
  review: 'Revisão',
  done: 'Feito',
}
const COLUMN_LABEL = TICKET_COLUMN_LABEL

/**
 * An office event as a short sentence: "Quando nasce um ticket #bug", "Quando uma ata fica pronta".
 * `botName` names the bot of "bot-done" ("Quando Relator termina"); without it, any other bot.
 */
export function eventLabel(kind: BotEventKind, filter: BotEventTrigger['filter'] = {}, botName?: string): string {
  const tags = filter.tags?.length ? ` ${filter.tags.map((t) => `#${t}`).join(' ')}` : ''
  switch (kind) {
    case 'ticket-created':
      return `Quando nasce um ticket${tags}`
    case 'ticket-moved':
      return filter.column ? `Quando um ticket${tags} vai para ${COLUMN_LABEL[filter.column]}` : `Quando um ticket${tags} muda de coluna`
    case 'meeting-ata':
      return 'Quando uma ata fica pronta'
    case 'bot-done':
      return `Quando ${filter.botId ? botName || 'outro bot' : 'qualquer outro bot'} termina${filter.onlyOk ? ' bem' : ''}`
  }
}

/** One automation of a bot as the Chat lists it. `nextAt` null = an event (or nothing scheduled). */
export interface AutomationRef {
  label: string
  nextAt: number | null
}

/**
 * The automations of a bot: its schedules (routines run by the bot, phase 2: RoutineWho
 * `{ kind: 'bot' }`) and its event triggers. Only the enabled ones.
 */
export function botAutomations(
  botId: string,
  routines: readonly { who: { kind: string }; schedule: Schedule; enabled: boolean; nextAt: number | null }[],
  triggers: readonly BotEventTrigger[],
): AutomationRef[] {
  const out: AutomationRef[] = []
  for (const r of routines) {
    const who = r.who as { kind: string; botId?: string }
    if (who.kind === 'bot' && who.botId === botId && r.enabled) out.push({ label: scheduleLabel(r.schedule), nextAt: r.nextAt })
  }
  for (const t of triggers) if (t.botId === botId && t.enabled) out.push({ label: eventLabel(t.kind, t.filter), nextAt: null })
  return out
}

/** The automation the sidebar shows: the next scheduled one, else the first event; null without any. */
export function nextAutomation(list: readonly AutomationRef[]): AutomationRef | null {
  let best: AutomationRef | null = null
  for (const a of list) if (a.nextAt !== null && (best?.nextAt == null || a.nextAt < best.nextAt)) best = a
  return best ?? list[0] ?? null
}

// ---------- the bot's state ----------

export type BotState = 'waiting' | 'working' | 'failed' | 'idle'

const WORKING = new Set<AgentSummary['status']>(['working', 'starting'])

/** The dot on the avatar: waiting for you (amber), working (ring), last run failed (red), or nothing. */
export function botState(bot: Pick<Bot, 'runs'>, agent: Pick<AgentSummary, 'status'> | undefined, pending: readonly unknown[]): BotState {
  if (pending.length || agent?.status === 'waiting') return 'waiting'
  if ((agent && WORKING.has(agent.status)) || bot.runs[0]?.status === 'running') return 'working'
  if (bot.runs[0]?.status === 'failed') return 'failed'
  return 'idle'
}

export type StatusTone = 'wait' | 'work' | 'fail' | 'next' | 'last' | 'none'

/** The line under a bot's name in the sidebar, and the color it takes. */
export interface StatusLine {
  text: string
  tone: StatusTone
}

/** First line of a text, squeezed, cut at `max` characters with "…". */
export function snippet(text: string, max = 80): string {
  const line = text
    .replace(/[#>*_`~]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  const flat = (line ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** What an item says in one line, for the sidebar and the search results. */
export function itemPreview(item: ThreadItem): string {
  switch (item.kind) {
    case 'user':
      return `Você: ${snippet(item.text) || (item.attachments?.length ? `${item.attachments.length} anexo(s)` : '')}`
    case 'bot':
      return snippet(item.text)
    case 'run':
      return `${item.label} · ${BOT_RUN_STATUS_LABEL[item.status]}`
    case 'approval':
      return `Pedido: ${snippet(item.request.title)}`
    case 'notice':
      return snippet(item.text)
    case 'side':
      return snippet(item.answer ?? item.question)
  }
}

/**
 * The sidebar's status line, in the spec's order: waiting for your yes, working (with what it
 * does), failed, the next automation, the start of the last message.
 */
export function botStatusLine(
  bot: Pick<Bot, 'runs' | 'tagline'>,
  agent: Pick<AgentSummary, 'status' | 'activity'> | undefined,
  pending: readonly Pick<PermissionRequest, 'kind'>[],
  next: AutomationRef | null,
  now = Date.now(),
  last?: ThreadItem,
): StatusLine {
  if (pending.length || agent?.status === 'waiting') {
    const kind = pending[0]?.kind
    return {
      text: kind === 'question' ? 'Esperando sua resposta' : kind === 'plan' ? 'Esperando você aprovar o plano' : 'Esperando seu sim',
      tone: 'wait',
    }
  }
  const run = bot.runs[0]
  if ((agent && WORKING.has(agent.status)) || run?.status === 'running') {
    const doing = agent && WORKING.has(agent.status) ? agent.activity.trim() : ''
    return { text: doing ? `Trabalhando · ${doing}` : 'Trabalhando', tone: 'work' }
  }
  if (run?.status === 'failed') {
    const at = run.endedAt ?? run.startedAt
    const diff = daysAgo(at, now)
    const when =
      diff === 0
        ? `às ${clockTime(at)}`
        : diff === 1
          ? `ontem às ${clockTime(at)}`
          : `em ${pad(new Date(at).getDate())}/${pad(new Date(at).getMonth() + 1)}`
    return { text: `Falhou ${when}`, tone: 'fail' }
  }
  if (next) return { text: next.label, tone: 'next' }
  if (last) {
    const text = itemPreview(last)
    if (text) return { text, tone: 'last' }
  }
  return { text: bot.tagline || 'Sem mensagens ainda', tone: 'none' }
}

// ---------- unread, order, the thread ----------

/** Items that count as unread: what the bot (or the app, on a failure) said, not what you wrote. */
export function countsAsUnread(item: ThreadItem): boolean {
  switch (item.kind) {
    case 'bot':
    case 'approval':
      return true
    case 'notice':
      return item.tone === 'error' || item.tone === 'warn'
    case 'side':
      return item.status !== 'asked'
    default:
      return false
  }
}

/** How many items arrived after the player last read the thread. */
export function unreadCount(items: readonly ThreadItem[], lastReadAt: number): number {
  let n = 0
  for (const it of items) if (it.t > lastReadAt && countsAsUnread(it)) n++
  return n
}

/** "3", "99+": the badge text; '' for none. */
export function badgeText(n: number): string {
  return n <= 0 ? '' : n > 99 ? '99+' : String(n)
}

/** Pinned first, then by `order`, then the oldest first. Hidden bots stay in (the caller filters). */
export function sortBots<T extends Pick<Bot, 'pinned' | 'order' | 'createdAt' | 'name'>>(bots: readonly T[]): T[] {
  return [...bots].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'pt-BR'),
  )
}

/** The bots of one floor ('all' = every floor), without the hidden ones unless asked. */
export function botsOnFloor<T extends Pick<Bot, 'floor' | 'hidden'>>(bots: readonly T[], floor: string, showHidden = false): T[] {
  return bots.filter((b) => (floor === 'all' || b.floor === floor) && (showHidden || !b.hidden))
}

/**
 * A bot dragged onto another in the sidebar: the new `order` of every bot that moves. A pinned
 * bot stays among the pinned ones (and the other way round), so it lands at the edge of its group.
 */
export function reorderBots(
  sorted: readonly Pick<Bot, 'id' | 'pinned' | 'order'>[],
  dragId: string,
  targetId: string,
  place: 'before' | 'after',
): { id: string; order: number }[] {
  const drag = sorted.find((b) => b.id === dragId)
  const target = sorted.find((b) => b.id === targetId)
  if (!drag || !target || dragId === targetId) return []
  const group = sorted.filter((b) => b.pinned === drag.pinned)
  const rest = group.filter((b) => b.id !== dragId)
  let at: number
  if (target.pinned === drag.pinned) {
    at = rest.findIndex((b) => b.id === targetId) + (place === 'after' ? 1 : 0)
  } else {
    // dropped on the other group: the nearest edge of its own
    at = drag.pinned ? rest.length : 0
  }
  const next = [...rest.slice(0, at), drag, ...rest.slice(at)]
  const changes: { id: string; order: number }[] = []
  next.forEach((b, i) => {
    if (b.order !== i) changes.push({ id: b.id, order: i })
  })
  return changes
}

/** A thread item arrived: the same id updates it in place, a new one goes at the end. */
export function upsertItem(items: readonly ThreadItem[], item: ThreadItem): { items: ThreadItem[]; added: boolean } {
  const i = items.findIndex((x) => x.id === item.id)
  if (i < 0) return { items: [...items, item], added: true }
  const next = [...items]
  next[i] = item
  return { items: next, added: false }
}

/** An older page joins the front of what is shown; items already there are not repeated. */
export function prependPage(page: readonly ThreadItem[], shown: readonly ThreadItem[]): ThreadItem[] {
  const ids = new Set(shown.map((x) => x.id))
  return [...page.filter((x) => !ids.has(x.id)), ...shown]
}

/** The newest `keep` items (what the sidebar keeps per thread for the unread count and the last line). */
export function keepNewest(items: readonly ThreadItem[], keep: number): ThreadItem[] {
  return items.length > keep ? items.slice(items.length - keep) : [...items]
}

/** The last item worth a line in the sidebar (runs and notices about runs say less than a message). */
export function lastMessage(items: readonly ThreadItem[]): ThreadItem | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const k = items[i].kind
    if (k === 'bot' || k === 'user' || k === 'approval' || k === 'side') return items[i]
  }
  return items[items.length - 1]
}

/** The scroll sits at the bottom (within `slack` px): new items keep it there. */
export function atBottom(scrollTop: number, clientHeight: number, scrollHeight: number, slack = 40): boolean {
  return scrollTop + clientHeight >= scrollHeight - slack
}

// ---------- runs and approvals ----------

/** "12s", "1min40", "2h05". */
export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min${pad(s % 60)}`
  return `${Math.floor(m / 60)}h${pad(m % 60)}`
}

/** "US$ 0,08"; "< US$ 0,01" for less than a cent; '' for nothing. */
export function usd(v: number | undefined): string {
  if (!v || v <= 0) return ''
  if (v < 0.01) return '< US$ 0,01'
  return `US$ ${v.toFixed(2).replace('.', ',')}`
}

/** "1 passo", "12 passos". */
export function stepsLabel(n: number): string {
  return n === 1 ? '1 passo' : `${n} passos`
}

/** A finished run, folded: "12 passos · 1min40 · US$ 0,08". */
export function runSummary(run: Pick<Extract<ThreadItem, { kind: 'run' }>, 'steps' | 'durationMs' | 'costUsd'>): string {
  return [stepsLabel(run.steps), run.durationMs ? shortDuration(run.durationMs) : '', usd(run.costUsd)].filter(Boolean).join(' · ')
}

/** A running run: "Trabalhando · Rodando npm test · 12 passos". */
export function runLive(run: Pick<Extract<ThreadItem, { kind: 'run' }>, 'steps' | 'activity' | 'status'>, activity?: string): string {
  const doing = (run.activity || activity || '').trim()
  const head = run.status === 'waiting' ? 'Esperando você' : 'Trabalhando'
  return [head, doing, run.steps ? stepsLabel(run.steps) : ''].filter(Boolean).join(' · ')
}

/** What started a run, when the item has no label: "Rodar agora", "Mensagem". */
export function triggerLabel(t: RunTrigger): string {
  switch (t.kind) {
    case 'message':
      return 'Mensagem'
    case 'manual':
      return 'Rodar agora'
    case 'schedule':
    case 'event':
      return t.label
    case 'channel':
      return 'Canal'
    case 'ask':
      return 'Pedido de outro bot'
  }
}

/** A decided request as one line: "Você permitiu às 07:41", "Você negou às 07:41 · motivo". */
export function approvalOutcome(item: Extract<ThreadItem, { kind: 'approval' }>): string {
  const at = item.decidedAt ? ` às ${clockTime(item.decidedAt)}` : ''
  const note = item.note?.trim()
  const plan = item.request.kind === 'plan'
  switch (item.status) {
    case 'allowed':
      return `${plan ? 'Você aprovou o plano' : 'Você permitiu'}${at}${note ? ` · ${note}` : ''}`
    case 'denied':
      return `${plan ? 'Você pediu mudanças' : 'Você negou'}${at}${note ? ` · ${note}` : ''}`
    case 'answered':
      return `Você respondeu${at}${note ? `: ${note}` : ''}`
    case 'expired':
      return 'O pedido expirou sem resposta'
    case 'pending':
      return 'Esperando você'
  }
}

/** The approval card's header: "Aprovação", "Pergunta", "Plano", or the sensitive kind. */
export function approvalHeading(request: Extract<ThreadItem, { kind: 'approval' }>['request']): string {
  if (request.kind === 'question') return 'Pergunta'
  if (request.kind === 'plan') return 'Plano'
  return request.sensitive ? `Aprovação · ${SENSITIVE_LABEL[request.sensitive]}` : 'Aprovação'
}

// ---------- replying with a sentence ----------

export type ReplyIntent = 'allow' | 'deny' | 'ask'

/** Words that open a yes: "pode", "sim", "manda", "ok"… */
const YES_LEAD = new Set([
  'sim',
  's',
  'ss',
  'yes',
  'y',
  'ok',
  'okay',
  'okey',
  'oki',
  'blz',
  'beleza',
  'claro',
  'certo',
  'isso',
  'positivo',
  'perfeito',
  'show',
  'fechado',
  'bora',
  'vamos',
  'vai',
  'go',
  'manda',
  'segue',
  'siga',
  'pode',
  'aprovado',
  'aprovo',
  'autorizado',
  'autorizo',
  'permitido',
  'permito',
  'confirmo',
  'confirmado',
  'faz',
  'faca',
  'prossiga',
  'continua',
  'continue',
  'otimo',
  'combinado',
  'feito',
])
/** Two-word yeses whose first word is not a yes on its own. */
const YES_PHRASES = [
  'ta bom',
  'ta certo',
  'ta otimo',
  'tudo bem',
  'tudo certo',
  'de acordo',
  'com certeza',
  'pode ser',
  'manda ver',
  'manda bala',
  'vai la',
]
/** A yes in the middle of a no ("não, pode sim") makes the answer mixed. */
const STRONG_YES = new Set([
  'sim',
  'pode',
  'ok',
  'okay',
  'manda',
  'claro',
  'beleza',
  'blz',
  'aprovado',
  'aprovo',
  'autorizo',
  'autorizado',
  'permito',
  'permitido',
  'confirmo',
  'confirmado',
  'yes',
  'bora',
])
/** Words that open a no: "não", "pare", "espera"… ("no" and "n" only count alone: "no branch dev" is Portuguese.) */
const NO_LEAD = new Set([
  'nao',
  'nope',
  'nunca',
  'jamais',
  'nem',
  'pare',
  'para',
  'parar',
  'stop',
  'espera',
  'espere',
  'esperar',
  'aguarde',
  'aguenta',
  'segura',
  'calma',
  'cancela',
  'cancele',
  'cancelar',
  'negado',
  'negativo',
  'nego',
  'esquece',
  'proibido',
])
/** Two-word noes whose first word is not a no on its own. */
const NO_PHRASES = ['agora nao', 'ainda nao', 'melhor nao', 'por enquanto nao', 'hoje nao', 'nem pensar']
/** A condition, a limit or a doubt: the sentence is neither a plain yes nor a plain no. */
const DOUBT = [
  'mas',
  'porem',
  'contudo',
  'entretanto',
  'todavia',
  'so',
  'somente',
  'apenas',
  'sem',
  'desde que',
  'exceto',
  'menos',
  'antes',
  'depois',
  'primeiro',
  'talvez',
  'acho',
  'sei la',
  'nao sei',
  'n sei',
  'depende',
  'quem sabe',
  'sera',
  'duvida',
  'nao entendi',
  'nao tenho certeza',
  'se ',
  'caso',
]
/** A yes longer than this many words reads like a new instruction: ask. */
const YES_MAX_WORDS = 6

function normalizeReply(text: string): string {
  return text
    .replace(/👍|✅|👌|🙌/gu, ' sim ')
    .replace(/👎|❌|🛑|✋/gu, ' nao ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9?\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const hasWord = (s: string, w: string) => (w.endsWith(' ') ? ` ${s} `.includes(` ${w}`) : ` ${s} `.includes(` ${w} `))

/**
 * The player answered a pending request with a sentence: is it a yes, a no (the sentence goes
 * to the bot as the instruction), or unclear (the app asks which)? Conservative: anything with
 * a question, a condition, a doubt, mixed signals or a long instruction is 'ask'.
 */
export function replyIntent(text: string): ReplyIntent {
  const s = normalizeReply(text)
  if (!s || s.includes('?')) return 'ask'
  if (s === 'no' || s === 'n') return 'deny'
  if (DOUBT.some((w) => hasWord(s, w))) return 'ask'
  const words = s.split(' ')
  const startsYes = YES_LEAD.has(words[0]) || YES_PHRASES.some((p) => s === p || s.startsWith(`${p} `))
  const startsNo = NO_LEAD.has(words[0]) || NO_PHRASES.some((p) => s === p || s.startsWith(`${p} `) || s.endsWith(` ${p}`))
  // a yes later on that is not "não pode", "não manda": a mixed answer
  const laterYes = words.slice(1).some((w, i) => STRONG_YES.has(w) && words[i] !== 'nao') || YES_PHRASES.some((p) => s.includes(` ${p}`))
  // "para" and "nem" are also everyday words in the middle of a sentence ("mover para Fazendo")
  const laterNo = words.slice(1).some((w) => NO_LEAD.has(w) && w !== 'para' && w !== 'nem') || NO_PHRASES.some((p) => s.includes(` ${p}`))
  if (startsNo) return laterYes ? 'ask' : 'deny'
  if (startsYes) return laterNo || words.length > YES_MAX_WORDS ? 'ask' : 'allow'
  return 'ask'
}

// ---------- the profile ----------

/** Bytes of a text in UTF-8, as memoria.md counts them. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** "3,2 de 16 KB". */
export function memorySizeLabel(text: string, limit = BOT_LIMITS.memoryBytes): string {
  const kb = (n: number) => (n / 1024).toFixed(1).replace('.', ',').replace(/,0$/, '')
  return `${kb(utf8Bytes(text))} de ${kb(limit)} KB`
}

/** What the bot spent today, in 7 and in 30 days, from its runs (Bot.runs keeps the last ones). */
export function botSpending(
  runs: readonly Pick<BotRun, 'startedAt' | 'endedAt' | 'costUsd'>[],
  now = Date.now(),
): { today: number; week: number; month: number } {
  const today = startOfDay(now)
  const out = { today: 0, week: 0, month: 0 }
  for (const r of runs) {
    const t = r.endedAt ?? r.startedAt
    const c = r.costUsd ?? 0
    if (!c) continue
    if (t >= today) out.today += c
    if (t >= today - 6 * DAY) out.week += c
    if (t >= today - 29 * DAY) out.month += c
  }
  return out
}

/** The form's draft for a bot as it is: editing one field sends the rest unchanged. */
export function draftFromBot(bot: Bot): BotDraft {
  return {
    id: bot.id,
    name: bot.name,
    tagline: bot.tagline,
    role: bot.role,
    color: bot.color,
    look: bot.look,
    floor: bot.floor,
    cwd: bot.cwd,
    model: bot.model,
    effort: bot.effort,
    accounts: bot.accounts,
    permissionMode: bot.permissionMode,
    askBefore: [...bot.askBefore],
    apps: bot.apps === 'all' ? 'all' : [...bot.apps],
    worktree: bot.worktree,
    dailyBudgetUsd: bot.dailyBudgetUsd,
    templateId: bot.templateId,
  }
}

/** What a draft is missing before it can be saved, in a sentence that says how to fix it; null when fine. */
export function draftError(d: Pick<BotDraft, 'name' | 'role' | 'floor' | 'cwd'>, groundFloor = 'terreo'): string | null {
  const name = d.name.trim()
  if (!name) return 'Dê um nome ao bot.'
  if (name.length > BOT_LIMITS.name) return `O nome cabe em ${BOT_LIMITS.name} caracteres. Encurte um pouco.`
  if (!d.role.trim()) return 'Escreva a função do bot: o que ele faz e o que nunca faz.'
  if (d.role.length > BOT_LIMITS.role)
    return `A função passa de ${BOT_LIMITS.role.toLocaleString('pt-BR')} caracteres. Corte o que não é essencial.`
  if (!d.floor) return 'Escolha o andar em que o bot trabalha.'
  if (d.floor === groundFloor && !d.cwd) return 'No térreo, escolha a pasta em que o bot trabalha.'
  return null
}

// ---------- search and export ----------

/** Everything an item says, for ⌘F in the thread. */
export function itemText(item: ThreadItem): string {
  switch (item.kind) {
    case 'user':
      return [item.text, ...(item.attachments ?? []).map((a) => a.name)].join('\n')
    case 'bot':
      return item.text
    case 'run':
      return [item.label, item.activity, item.error, ...(item.log ?? []).map((s) => s.text)].filter(Boolean).join('\n')
    case 'approval':
      return [
        item.request.title,
        item.request.detail,
        item.request.plan,
        item.note,
        ...(item.request.questions ?? []).flatMap((q) => [q.question, ...q.options.map((o) => o.label)]),
      ]
        .filter(Boolean)
        .join('\n')
    case 'notice':
      return item.text
    case 'side':
      return [item.question, item.answer].filter(Boolean).join('\n')
  }
}

function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Ids of the items that match a search, oldest first (accents and case do not matter). */
export function searchItems(items: readonly ThreadItem[], query: string): string[] {
  const q = foldText(query.trim())
  if (!q) return []
  return items.filter((it) => foldText(itemText(it)).includes(q)).map((it) => it.id)
}

const fullDate = (t: number) => {
  const d = new Date(t)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** The thread as Markdown, for "Exportar em Markdown". */
export function threadMarkdown(botName: string, items: readonly ThreadItem[], now = Date.now()): string {
  const out = [
    `# ${botName}`,
    '',
    `Exportado em ${fullDate(now)} às ${clockTime(now)} · ${items.length} ${items.length === 1 ? 'item' : 'itens'}`,
  ]
  let day = ''
  const quote = (s: string) =>
    s
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n')
  for (const it of items) {
    const d = fullDate(it.t)
    if (d !== day) {
      day = d
      out.push('', `## ${d}`)
    }
    const at = clockTime(it.t)
    switch (it.kind) {
      case 'user':
        out.push('', `**${at} · Você**`, '', it.text)
        if (it.attachments?.length) out.push('', `Anexos: ${it.attachments.map((a) => a.name).join(', ')}`)
        break
      case 'bot':
        out.push('', `**${at} · ${it.member?.name ?? botName}**`, '', it.text)
        break
      case 'run': {
        const tail =
          it.status === 'running' || it.status === 'waiting'
            ? BOT_RUN_STATUS_LABEL[it.status]
            : `${runSummary(it)} · ${BOT_RUN_STATUS_LABEL[it.status]}`
        out.push('', quote(`${at} · Rodada: ${it.label || triggerLabel(it.trigger)} · ${tail}${it.error ? `\n${it.error}` : ''}`))
        break
      }
      case 'approval':
        out.push(
          '',
          quote(
            `${at} · ${approvalHeading(it.request)}: ${it.request.title}${it.request.detail ? `\n${it.request.detail}` : ''}\n${approvalOutcome(it)}`,
          ),
        )
        break
      case 'notice':
        out.push('', `_${at} · ${it.text}_`)
        break
      case 'side':
        out.push('', quote(`${at} · Pergunta a outro bot: ${it.question}${it.answer ? `\nResposta: ${it.answer}` : ''}`))
        break
    }
  }
  return `${out.join('\n')}\n`
}

// ---------- automations: the screen, the week and the forms (phase 2: CB-14 to CB-16) ----------

type RoutineLike = Pick<Routine, 'id' | 'name' | 'who' | 'schedule' | 'enabled' | 'nextAt'>
type TriggerLike = Pick<BotEventTrigger, 'id' | 'botId' | 'name' | 'kind' | 'filter' | 'enabled'>
/** A bot's name by id, so "bot-done" reads "Quando Relator termina". */
type BotNameOf = (botId: string) => string | undefined

const eventTriggerLabel = (t: TriggerLike, nameOf?: BotNameOf) =>
  eventLabel(t.kind, t.filter, t.filter.botId ? nameOf?.(t.filter.botId) : undefined)

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id)

/** The bot that runs a routine (RoutineWho `{ kind: 'bot' }`), or null for any other runner. */
export function routineBotId(r: Pick<Routine, 'who'>): string | null {
  return r.who.kind === 'bot' ? r.who.botId : null
}

/**
 * The routines and event triggers of the bots in view: the bots of one floor ('all' = every
 * floor) and, when `botId` is set, only that bot. Routines run by anything else stay out.
 */
export function scopeAutomations<R extends Pick<Routine, 'who'>, T extends Pick<BotEventTrigger, 'botId'>>(
  routines: readonly R[],
  triggers: readonly T[],
  bots: readonly Pick<Bot, 'id' | 'floor'>[],
  scope: { floor: string; botId?: string | null },
): { routines: R[]; triggers: T[] } {
  const ids = new Set(
    bots.filter((b) => (scope.floor === 'all' || b.floor === scope.floor) && (!scope.botId || b.id === scope.botId)).map((b) => b.id),
  )
  return {
    routines: routines.filter((r) => {
      const id = routineBotId(r)
      return id !== null && ids.has(id)
    }),
    triggers: triggers.filter((t) => ids.has(t.botId)),
  }
}

/** One automation as the list, the profile and the header show it: a schedule (routine) or an event trigger. */
export interface AutomationEntry {
  kind: 'schedule' | 'event'
  /** Routine.id or BotEventTrigger.id. */
  id: string
  botId: string
  name: string
  /** "Dias úteis às 07:30", "Quando nasce um ticket #bug". */
  label: string
  enabled: boolean
  /** The next run of an active schedule; null for events and paused ones. */
  nextAt: number | null
}

/** The bots' automations, active first; schedules by their next run, then events, then by name. */
export function automationEntries(
  routines: readonly RoutineLike[],
  triggers: readonly TriggerLike[],
  nameOf?: BotNameOf,
): AutomationEntry[] {
  const out: AutomationEntry[] = []
  for (const r of routines) {
    const botId = routineBotId(r)
    if (!botId) continue
    out.push({
      kind: 'schedule',
      id: r.id,
      botId,
      name: r.name,
      label: scheduleLabel(r.schedule),
      enabled: r.enabled,
      nextAt: r.enabled ? r.nextAt : null,
    })
  }
  for (const t of triggers) {
    out.push({
      kind: 'event',
      id: t.id,
      botId: t.botId,
      name: t.name,
      label: eventTriggerLabel(t, nameOf),
      enabled: t.enabled,
      nextAt: null,
    })
  }
  const kindRank = (e: AutomationEntry) => (e.kind === 'schedule' ? 0 : 1)
  return out.sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      kindRank(a) - kindRank(b) ||
      (a.nextAt ?? Number.MAX_SAFE_INTEGER) - (b.nextAt ?? Number.MAX_SAFE_INTEGER) ||
      byName(a, b),
  )
}

/** How many automations of a bot are on and how many are paused ("Pausar automações" in the header). */
export function automationCounts(
  botId: string,
  routines: readonly Pick<Routine, 'who' | 'enabled'>[],
  triggers: readonly Pick<BotEventTrigger, 'botId' | 'enabled'>[],
): { active: number; paused: number } {
  const out = { active: 0, paused: 0 }
  for (const r of routines) if (routineBotId(r) === botId) out[r.enabled ? 'active' : 'paused']++
  for (const t of triggers) if (t.botId === botId) out[t.enabled ? 'active' : 'paused']++
  return out
}

// ---------- the week ----------

const WEEK_LABEL = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

/** Monday 00:00 (local time) of the week `t` falls in. */
export function weekStartOf(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime()
}

/** The Monday `weeks` weeks away (negative = back), by the calendar: a daylight-saving week keeps its Monday. */
export function shiftWeek(weekStart: number, weeks: number): number {
  const d = new Date(weekStartOf(weekStart))
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * weeks).getTime()
}

/** "Esta semana · 16 a 22 nov", "Semana que vem · 23 a 29 nov", "30 nov a 6 dez 2027". */
export function weekTitle(weekStart: number, now = Date.now()): string {
  const start = weekStartOf(weekStart)
  const s = new Date(start)
  const e = new Date(shiftWeek(start, 1) - 1)
  const year = e.getFullYear() === new Date(now).getFullYear() ? '' : ` ${e.getFullYear()}`
  const range =
    s.getMonth() === e.getMonth()
      ? `${s.getDate()} a ${e.getDate()} ${MONTH_SHORT[e.getMonth()]}${year}`
      : `${s.getDate()} ${MONTH_SHORT[s.getMonth()]} a ${e.getDate()} ${MONTH_SHORT[e.getMonth()]}${year}`
  const diff = Math.round((start - weekStartOf(now)) / (7 * DAY))
  const prefix = diff === 0 ? 'Esta semana' : diff === 1 ? 'Semana que vem' : diff === -1 ? 'Semana passada' : ''
  return prefix ? `${prefix} · ${range}` : range
}

/** One automation on the week: in a cell (a run), on the "A cada…" strip or on the "Em eventos" strip. */
export interface WeekChip {
  kind: 'schedule' | 'event'
  id: string
  /** null: a routine run by something other than a bot. */
  botId: string | null
  name: string
  /** "Dias úteis às 07:30", "A cada 30 min", "Quando nasce um ticket #bug". */
  label: string
  /** Paused: drawn dimmed. */
  paused: boolean
  /** Cells only: the run in this week, and whether it is already behind `now`. */
  at?: number
  past?: boolean
}

export interface WeekDay {
  /** 00:00 of the day. */
  date: number
  /** "Seg 16". */
  label: string
  today: boolean
}

export interface WeekRow {
  /** "07:30". */
  time: string
  /** Monday first; each cell sorted by name. */
  cells: WeekChip[][]
}

export interface WeekGrid {
  /** Monday 00:00. */
  start: number
  days: WeekDay[]
  /** By time of day. */
  rows: WeekRow[]
  /** Interval schedules, and any schedule running more than WEEK_CELL_MAX_PER_DAY times a day. */
  every: WeekChip[]
  /** Event triggers. */
  events: WeekChip[]
}

/** A schedule that runs more often than this on one day goes to the "A cada…" strip instead of filling the grid. */
export const WEEK_CELL_MAX_PER_DAY = 4

/** "Roda a cada 30 minutos." → "A cada 30 minutos", for the strip. */
function frequentLabel(s: Schedule): string {
  const text = describeSchedule(s)
    .replace(/^Roda /, '')
    .replace(/\.$/, '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The week calendar of Automações: every run of a daily, weekly, cron or "uma vez" schedule
 * inside the week becomes a chip in its day's column, on the row of its time. Interval
 * schedules (and crons that run more than WEEK_CELL_MAX_PER_DAY times a day) go to the "A
 * cada…" strip, event triggers to the "Em eventos" strip. Paused automations stay, flagged.
 */
export function weekGrid(
  routines: readonly RoutineLike[],
  triggers: readonly TriggerLike[],
  weekStart: number,
  now = Date.now(),
  nameOf?: BotNameOf,
): WeekGrid {
  const start = weekStartOf(weekStart)
  const end = shiftWeek(start, 1)
  const first = new Date(start)
  const days: WeekDay[] = WEEK_LABEL.map((label, i) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i).getTime()
    return { date, label: `${label} ${new Date(date).getDate()}`, today: sameDay(date, now) }
  })
  const dayOf = (t: number) => Math.round((startOfDay(t) - start) / DAY)
  const byTime = new Map<string, WeekChip[][]>()
  const every: WeekChip[] = []
  for (const r of routines) {
    const base = { kind: 'schedule' as const, id: r.id, botId: routineBotId(r), name: r.name, paused: !r.enabled }
    if (r.schedule.kind === 'interval') {
      every.push({ ...base, label: scheduleLabel(r.schedule) })
      continue
    }
    const runs: number[] = []
    for (let t = nextRun(r.schedule, start - 1); t !== null && t < end; t = nextRun(r.schedule, t)) {
      runs.push(t)
      // past this, some day surely has more than the cap
      if (runs.length > 7 * WEEK_CELL_MAX_PER_DAY) break
    }
    const perDay = new Array<number>(7).fill(0)
    for (const t of runs) perDay[dayOf(t)]++
    if (perDay.some((n) => n > WEEK_CELL_MAX_PER_DAY)) {
      every.push({ ...base, label: frequentLabel(r.schedule) })
      continue
    }
    for (const t of runs) {
      const time = clockTime(t)
      let row = byTime.get(time)
      if (!row) byTime.set(time, (row = Array.from({ length: 7 }, () => [])))
      row[dayOf(t)].push({ ...base, label: scheduleLabel(r.schedule), at: t, past: t < now })
    }
  }
  const rows = [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, cells]) => ({ time, cells: cells.map((c) => c.sort(byName)) }))
  const events: WeekChip[] = triggers
    .map((t) => ({
      kind: 'event' as const,
      id: t.id,
      botId: t.botId,
      name: t.name,
      label: eventTriggerLabel(t, nameOf),
      paused: !t.enabled,
    }))
    .sort(byName)
  return { start, days, rows, every: every.sort(byName), events }
}

// ---------- the forms ----------

/** A routine run by the bot: where and how come from the bot, so the routine checks pass as for any runner. */
export function botRoutineDraft(
  bot: Pick<Bot, 'id' | 'floor' | 'cwd' | 'permissionMode'>,
  a: { id?: string; name: string; prompt: string; schedule: Schedule; enabled?: boolean; missed?: MissedPolicy },
): RoutineDraft {
  return {
    ...(a.id ? { id: a.id } : {}),
    name: a.name.trim(),
    prompt: a.prompt.trim(),
    who: { kind: 'bot', botId: bot.id },
    ...(bot.floor === BOT_GROUND_FLOOR ? (bot.cwd ? { cwd: bot.cwd } : {}) : { floor: bot.floor }),
    permissionMode: bot.permissionMode,
    schedule: a.schedule,
    enabled: a.enabled ?? true,
    missed: a.missed ?? 'run',
  }
}

function nameAndTaskError(name: string, prompt: string, what: string): string | null {
  const n = name.trim()
  if (!n) return 'Dê um nome à automação.'
  if (n.length > ROUTINE_LIMITS.name) return `O nome cabe em ${ROUTINE_LIMITS.name} caracteres. Encurte um pouco.`
  if (!prompt.trim()) return `Escreva a tarefa: o que o bot faz ${what}.`
  if (prompt.length > ROUTINE_LIMITS.prompt)
    return `A tarefa passa de ${ROUTINE_LIMITS.prompt.toLocaleString('pt-BR')} caracteres. Corte o que não é essencial.`
  return null
}

/** What a schedule automation is missing, in a sentence that says how to fix it; null when fine. */
export function scheduleDraftError(d: Pick<RoutineDraft, 'name' | 'prompt' | 'schedule'>): string | null {
  return nameAndTaskError(d.name, d.prompt, 'em cada rodada') ?? scheduleError(d.schedule)
}

/** "bug, #urgente  api" → ['bug', 'urgente', 'api']: no '#', no repeats, at most 10 of up to 40 letters. */
export function parseTags(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    const tag = raw.replace(/^#+/, '').trim().slice(0, 40)
    if (tag && !out.some((t) => t.toLocaleLowerCase('pt-BR') === tag.toLocaleLowerCase('pt-BR'))) out.push(tag)
    if (out.length === 10) break
  }
  return out
}

/** Runs per hour an event trigger may take: a whole number from 1 to BOT_LIMITS.perHourMax (never more: loop guard). */
export function clampPerHour(n: number): number {
  if (!Number.isFinite(n)) return BOT_LIMITS.perHourDefault
  return Math.min(BOT_LIMITS.perHourMax, Math.max(1, Math.round(n)))
}

/** What an event trigger draft is missing, in a sentence that says how to fix it; null when fine. */
export function triggerDraftError(d: Pick<BotTriggerDraft, 'botId' | 'name' | 'kind' | 'filter' | 'prompt' | 'maxPerHour'>): string | null {
  if (!d.botId) return 'Escolha o bot que roda esta automação.'
  const base = nameAndTaskError(d.name, d.prompt, 'quando o evento acontece')
  if (base) return base
  // no bot chosen = any other bot (the main process never lets a bot trigger itself)
  if (d.kind === 'bot-done' && d.filter.botId === d.botId) return 'Um bot nunca dispara a si mesmo. Escolha outro bot.'
  const cap = d.maxPerHour
  if (cap !== undefined && (!Number.isInteger(cap) || cap < 1 || cap > BOT_LIMITS.perHourMax))
    return `O limite vai de 1 a ${BOT_LIMITS.perHourMax} rodadas por hora.`
  return null
}

/** "21/11". */
function shortDate(t: number): string {
  const d = new Date(t)
  return `${d.getDate()}/${pad(d.getMonth() + 1)}`
}

/** "Automação a partir de uma frase": what the preview shows before anything is saved. */
export interface AutomationPreview {
  /** "Roda toda sexta às 17:00." or "Quando nasce um ticket #bug". */
  when: string
  /** The next 3 runs of a schedule; [] for an event or a schedule with a problem. */
  next: number[]
  /** "Roda toda sexta às 17:00 · próximas: 21/11, 28/11, 5/12". */
  line: string
  /** Why it cannot be saved as it is (adjust it in the form); null when fine. */
  error: string | null
}

export function automationPreview(d: AutomationDraft, now = Date.now()): AutomationPreview {
  const botErr = d.bot.kind === 'new' ? draftError(d.bot.draft) : null
  const bot = botErr ? `O bot novo não fecha: ${botErr.charAt(0).toLowerCase()}${botErr.slice(1)}` : null
  if (d.when.kind === 'schedule') {
    const s = d.when.schedule
    const problem =
      scheduleError(s) ?? (s.kind === 'once' && nextRun(s, now) === null ? 'Esse horário já passou. Ajuste a data no formulário.' : null)
    // a new interval counts from the moment it is saved, as in the routine form
    const shown: Schedule = s.kind === 'interval' && s.anchor === undefined ? { ...s, anchor: Math.floor(now / MIN) * MIN } : s
    const next = problem ? [] : nextRuns(shown, now, 3)
    const when = describeSchedule(s)
    const line = next.length ? `${when.replace(/\.$/, '')} · próximas: ${next.map(shortDate).join(', ')}` : when
    return { when, next, line, error: problem ?? nameAndTaskError(d.name, d.prompt, 'em cada rodada') ?? bot }
  }
  const when = eventLabel(d.when.event, d.when.filter)
  const selfLoop = d.when.event === 'bot-done' && d.bot.kind === 'existing' && d.when.filter.botId === d.bot.botId
  const error =
    nameAndTaskError(d.name, d.prompt, 'quando o evento acontece') ??
    (selfLoop ? 'Um bot nunca dispara a si mesmo. Escolha outro bot no formulário.' : null) ??
    bot
  return { when, next: [], line: when, error }
}

// ---------- unread and the last line, from the list (Bot.unread, Bot.last) ----------

/**
 * The sidebar's unread count. The main process sends Bot.unread with the list (counted when it
 * arrived, at `listedAt`): that number plus what came after it. Without it, the items at hand
 * count. `override` is the lastReadAt set here before the list confirms it: read now (the items
 * after it count) or marked unread (0: the larger of the two counts until the list comes back).
 */
export function unreadFor(o: {
  listed: number | undefined
  listedAt: number
  items: readonly ThreadItem[]
  lastReadAt: number
  override?: number
}): number {
  if (o.override === 0) return Math.max(o.listed ?? 0, unreadCount(o.items, 0))
  if (o.override !== undefined) return unreadCount(o.items, o.override)
  if (o.listed === undefined) return unreadCount(o.items, o.lastReadAt)
  let n = Math.max(0, o.listed)
  for (const it of o.items) if (it.t > o.listedAt && it.t > o.lastReadAt && countsAsUnread(it)) n++
  return n
}

/** Bot.last as a thread item, for the sidebar's line when the thread's own items are not at hand. */
export function listedLastItem(botId: string, last: Bot['last']): ThreadItem | undefined {
  if (!last) return undefined
  const id = `listed-last-${botId}`
  if (last.from === 'user') return { id, t: last.t, kind: 'user', text: last.text }
  if (last.from === 'bot') return { id, t: last.t, kind: 'bot', botId, text: last.text }
  return { id, t: last.t, kind: 'notice', text: last.text }
}

/** The newer of two items; on a tie, the first (the live one). */
export function newerItem(a: ThreadItem | undefined, b: ThreadItem | undefined): ThreadItem | undefined {
  if (!a) return b
  if (!b) return a
  return b.t > a.t ? b : a
}

// ---------- connections (MCP servers) ----------

/** The office's own server (board, minutes, the Chat's tools): always on for every bot. */
export const OFFICE_MCP = 'office'

export function isOfficeServer(m: Pick<McpServerView, 'name' | 'locked'>): boolean {
  return !!m.locked || m.name === OFFICE_MCP
}

export type McpTone = 'ok' | 'warn' | 'fail' | 'off' | 'idle'

/** A server's state in a few words, as Conexões shows it. */
export function mcpStatus(m: Pick<McpServerView, 'status' | 'error' | 'off'>): { text: string; tone: McpTone } {
  if (m.off) return { text: 'Desligado no escritório', tone: 'off' }
  switch (m.status) {
    case 'connected':
      return { text: 'Conectado', tone: 'ok' }
    case 'failed':
      return { text: m.error ? `Falhou: ${snippet(m.error, 90)}` : 'Falhou ao conectar', tone: 'fail' }
    case 'needs-auth':
      return { text: 'Pede login', tone: 'warn' }
    case 'pending':
      return { text: 'Conectando…', tone: 'warn' }
    case 'disabled':
      return { text: 'Desligado no Claude Code', tone: 'off' }
    default:
      return { text: 'Sem status: nenhum agente rodando agora', tone: 'idle' }
  }
}

/** The bots that see a server: every bot for the office's; none for one turned off in the office; else by Bot.apps. */
export function botsSeeing<T extends Pick<Bot, 'apps'>>(bots: readonly T[], server: Pick<McpServerView, 'name' | 'locked' | 'off'>): T[] {
  if (isOfficeServer(server)) return [...bots]
  if (server.off) return []
  return bots.filter((b) => b.apps === 'all' || b.apps.includes(server.name))
}

/** "Todos os servidores", "Só o office", "office + github e linear". */
export function appsLabel(apps: Bot['apps']): string {
  if (apps === 'all') return 'Todos os servidores'
  const list = apps.filter((a) => a !== OFFICE_MCP)
  if (!list.length) return 'Só o office'
  const names = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`
  return `office + ${names}`
}

/** What the profile saves: 'all', or the servers picked without the office's (always on), no repeats. */
export function cleanApps(mode: 'all' | 'list', picked: readonly string[]): Bot['apps'] {
  if (mode === 'all') return 'all'
  return [...new Set(picked.map((p) => p.trim()).filter((p) => p && p !== OFFICE_MCP))]
}

/** Servers in the bot's list that Claude Code does not know any more (removed or renamed). */
export function missingApps(apps: Bot['apps'], servers: readonly Pick<McpServerView, 'name'>[]): string[] {
  if (apps === 'all') return []
  const known = new Set(servers.map((s) => s.name))
  return apps.filter((a) => a !== OFFICE_MCP && !known.has(a))
}
