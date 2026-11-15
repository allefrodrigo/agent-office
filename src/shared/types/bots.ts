// Chat dos bots: bots (agentes com emprego fixo), fios, canais e automações de evento.
// Spec: docs/prd/chat-de-bots.md. Plano: docs/prd/chat-de-bots-plano.md (CB-01 é este contrato).

import type { EffortLevel, Look, OfficePermissionMode } from './agents'
import type { AskQuestion, AttachmentInfo, PermissionRequest } from './conversation'
import type { Schedule } from './routines'
import type { TicketStatus } from './tickets'

/** Bots never run in "Sem pedir nada". */
export type BotPermissionMode = Exclude<OfficePermissionMode, 'bypassPermissions'>

/** Actions that always wait for the player's yes, whatever the permission mode (bots-guard). */
export type SensitiveKind = 'send' | 'publish' | 'delete' | 'pay' | 'push'
export const SENSITIVE_KINDS: readonly SensitiveKind[] = ['send', 'publish', 'delete', 'pay', 'push']
export const SENSITIVE_LABEL: Record<SensitiveKind, string> = {
  send: 'Enviar',
  publish: 'Publicar',
  delete: 'Apagar',
  pay: 'Pagar',
  push: 'Git remoto',
}

/** A bot's color: the avatar is the agent's pixel portrait over it. The first is the default. */
export const BOT_COLORS = ['#d97757', '#5b9cf0', '#3ecf8e', '#f5a524', '#c678dd', '#ef5b5b', '#2bb3c0', '#9a98b4'] as const

/** The ground floor's id, as in meeting-map.ts (bots there name a folder in `cwd`). */
export const BOT_GROUND_FLOOR = 'terreo'

export const BOT_LIMITS = {
  count: 60,
  name: 40,
  tagline: 80,
  role: 12_000,
  /** memoria.md, in bytes (UTF-8). */
  memoryBytes: 16_384,
  /** Items kept per thread (the newest). */
  threadItems: 5_000,
  /** Items per page when the thread scrolls up. */
  page: 200,
  /** Runs kept in Bot.runs. */
  runs: 20,
  /** Steps kept per run item. */
  steps: 50,
  stepText: 300,
  /** Messages of the thread sent with a scheduled run (recentContext). */
  context: 20,
  channels: 40,
  channelName: 40,
  topic: 300,
  eventTriggers: 100,
  /** Event triggers: default and highest runs per hour. */
  perHourDefault: 6,
  perHourMax: 30,
  /** "bot terminou → outro bot" chains stop at this depth. */
  chainDepth: 3,
}

export interface Bot {
  id: string
  name: string
  /** One line for the gallery and the profile: "Resumo da manhã do andar". */
  tagline: string
  /** The job: who the bot is, what it does, what it never does. Goes into its system prompt. */
  role: string
  /** One of BOT_COLORS. */
  color: string
  look: Look
  /** ProjectFloor.id, or BOT_GROUND_FLOOR (then `cwd` says the folder). */
  floor: string
  cwd?: string
  model?: string
  effort?: EffortLevel
  /** Accounts picked by hand; missing = the floor's. */
  accounts?: string[]
  permissionMode: BotPermissionMode
  /** Sensitive actions that wait for a yes. Default: all of them. */
  askBefore: SensitiveKind[]
  /** MCP servers the bot sees: 'all', or a list (the office server is always on). */
  apps: 'all' | string[]
  /** Works in its own git worktree. */
  worktree: boolean
  /** Most the bot may spend in a local day, in USD; 0 = no cap beyond the per-agent cap. */
  dailyBudgetUsd: number
  pinned: boolean
  hidden: boolean
  /** Sidebar position (lower first), inside pinned and unpinned. */
  order: number
  /** BOT_TEMPLATES id it came from. */
  templateId?: string
  createdAt: number
  updatedAt: number
  /** The office agent running the bot now; missing while it is not in the office. */
  agentId?: string
  /** The agent's Claude Code conversation, resumed when the bot comes back. */
  sessionId?: string
  /** When the player last read the bot's thread (ms), for the unread count. */
  lastReadAt: number
  /** Newest first, at most BOT_LIMITS.runs. */
  runs: BotRun[]
  /** Demo mode: shown, never saved. */
  demo?: boolean
}

/** What the form sends. With `id` it edits that bot; without, it creates one. */
export interface BotDraft {
  id?: string
  name: string
  tagline?: string
  role: string
  color?: string
  look?: Look
  floor: string
  cwd?: string
  model?: string
  effort?: EffortLevel
  accounts?: string[]
  permissionMode?: BotPermissionMode
  askBefore?: SensitiveKind[]
  apps?: 'all' | string[]
  worktree?: boolean
  dailyBudgetUsd?: number
  templateId?: string
  /** A schedule created with the bot (phase 2: it becomes a routine run by the bot). */
  schedule?: Schedule
}

/** What made a bot run. */
export type RunTrigger =
  | { kind: 'message' }
  | { kind: 'manual' }
  | { kind: 'schedule'; routineId: string; label: string }
  | { kind: 'event'; triggerId: string; label: string }
  | { kind: 'channel'; channelId: string }
  | { kind: 'ask'; fromBotId: string }

export type BotRunStatus = 'running' | 'waiting' | 'ok' | 'failed' | 'skipped'

export interface BotRun {
  id: string
  trigger: RunTrigger
  startedAt: number
  endedAt?: number
  status: BotRunStatus
  /** Tool calls so far. */
  steps: number
  costUsd?: number
  durationMs?: number
  /** What went wrong (failed) or why it did not run (skipped). */
  error?: string
  /** Where the run sits: the thread (bot or channel id) and its 'run' item. */
  threadId: string
  itemId: string
}

/** One step inside a run item: a tool call or what the bot said on the way. */
export interface RunStep {
  t: number
  kind: 'tool' | 'assistant' | 'thinking' | 'error'
  text: string
  tool?: string
}

/** The request as the thread keeps it (no raw tool input). */
export type ApprovalRequest = Pick<
  PermissionRequest,
  'kind' | 'toolName' | 'title' | 'detail' | 'canAlwaysAllow' | 'reason' | 'subagent'
> & {
  questions?: AskQuestion[]
  plan?: string
  /** Set when the guard asked for it. */
  sensitive?: SensitiveKind
}

export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'answered' | 'expired'

/**
 * A thread is append-only JSONL: a line with an id already seen updates that item, which keeps
 * the place of its first line (foldThread in shared/bots.ts).
 */
export type ThreadItem =
  | {
      id: string
      t: number
      kind: 'user'
      text: string
      attachments?: AttachmentInfo[]
      /** In channels: the bots it went to. */ to?: string[]
    }
  | {
      id: string
      t: number
      kind: 'bot'
      botId: string
      text: string
      runId?: string
      /** A squad member speaking in a squad channel. */
      member?: { id: string; name: string; icon: string }
    }
  | {
      id: string
      t: number
      kind: 'run'
      botId: string
      runId: string
      trigger: RunTrigger
      /** "⚡ Dias úteis às 07:30", "🎫 AO-44 criado", "Rodar agora". */
      label: string
      status: BotRunStatus
      steps: number
      /** What the bot is doing now ("Rodando npm test"), while it runs. */
      activity?: string
      costUsd?: number
      durationMs?: number
      error?: string
      log?: RunStep[]
    }
  | {
      id: string
      t: number
      kind: 'approval'
      botId: string
      /** PermissionRequest.id: answer with window.office.respond. */
      requestId: string
      request: ApprovalRequest
      status: ApprovalStatus
      decidedAt?: number
      /** Denied with a reason, or the answers given. */
      note?: string
    }
  | { id: string; t: number; kind: 'notice'; text: string; tone?: 'info' | 'warn' | 'error' }
  | {
      id: string
      t: number
      kind: 'side'
      fromBotId: string
      toBotId: string
      question: string
      answer?: string
      status: 'asked' | 'answered' | 'failed'
    }

export type ThreadItemKind = ThreadItem['kind']

export interface ThreadPage {
  /** Oldest first. */
  items: ThreadItem[]
  /** Older items exist before the first one. */
  more: boolean
}

export interface ThreadHit {
  threadId: string
  item: ThreadItem
}

/** A conversation with several bots and the player; may belong to a squad (phase 4). */
export interface Channel {
  id: string
  name: string
  floor: string
  topic: string
  /** Bot ids. */
  members: string[]
  /** Opensquad squad code, for a squad channel. */
  squad?: string
  createdAt: number
  updatedAt: number
  lastReadAt: number
  order: number
}

export type BotEventKind = 'ticket-created' | 'ticket-moved' | 'meeting-ata' | 'bot-done'

export interface BotEventTrigger {
  id: string
  botId: string
  name: string
  kind: BotEventKind
  filter: {
    /** ProjectFloor.id or BOT_GROUND_FLOOR; missing = the bot's floor. */
    floor?: string
    /** Ticket tags, any of them. */
    tags?: string[]
    /** ticket-moved: the column it went to. */
    column?: TicketStatus
    /** bot-done: which bot. */
    botId?: string
    /** bot-done: only when that run went fine. */
    onlyOk?: boolean
  }
  /** The task; {ticket}, {ata} and {saida} become the event's content. */
  prompt: string
  enabled: boolean
  /** Runs per hour at most (BOT_LIMITS.perHourDefault, up to perHourMax). */
  maxPerHour: number
  createdAt: number
  updatedAt: number
  /** Newest first, at most BOT_LIMITS.runs. */
  history: { t: number; status: 'ran' | 'limited' | 'skipped'; note?: string }[]
}

/** Configurações → Chat. */
export interface ChatSettings {
  /** A bot's result also walks to the player's room as a report card. */
  deliverInOffice: boolean
  /** System notifications from bots. */
  notify: 'all' | 'approvals' | 'off'
  /** Default cap for event triggers. */
  maxEventRunsPerHour: number
  /** Channel router model alias. */
  routerModel: string
  /** A bot's agent idle this long leaves the office (its conversation stays); 0 = never. */
  idleLeaveMin: number
}

export const CHAT_DEFAULTS: ChatSettings = {
  deliverInOffice: false,
  notify: 'approvals',
  maxEventRunsPerHour: 6,
  routerModel: 'haiku',
  idleLeaveMin: 30,
}

export const BOT_RUN_STATUS_LABEL: Record<BotRunStatus, string> = {
  running: 'trabalhando',
  waiting: 'esperando você',
  ok: 'pronto',
  failed: 'falhou',
  skipped: 'pulada',
}
