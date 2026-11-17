import { randomUUID } from 'node:crypto'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { ATTACH_LIMITS } from '@shared/attachments'
import { HAIR_STYLES } from '@shared/describe'
import { canAddFloor, floorNameFor, mergeCreativeFloors } from '@shared/projects'
import { scheduleError } from '@shared/schedule'
import { STATUSES } from '@shared/tickets'
import {
  BOT_COLORS,
  BOT_GROUND_FLOOR,
  BOT_LIMITS,
  CHAT_DEFAULTS,
  CRM_APP_DEFAULTS,
  CRM_LIMITS,
  CRM_SERVER_ACTIONS,
  EFFORT_LEVELS,
  MESSAGE_CATEGORIES,
  ROUTINE_LIMITS,
  SENSITIVE_KINDS,
} from '@shared/types'
import { EMAIL_RE, isDay, isMonth, normalizePhone } from '@shared/crm'
import type { VideoSettings } from '@shared/video'
import { AUDIO_CHUNK_MAX_BYTES, AUTOSTOP_MIN_RANGE, RETENTION_DAYS_RANGE, WHISPER_MODEL_FILE } from '@shared/meetings'
import { ATA_LIMITS, blockSchema } from '@shared/meetings-ata'
import { MEETING_ID_RE as TEMPLATE_ID_RE } from '@shared/meeting-templates'
import { FLOOR_RE, MEETING_ID_RE } from './meetings/store'
import { loadMeetingRecipes, loadMeetingTemplates, type Floors } from './meetings/templates'
import type {
  Account,
  AgentBrain,
  AgentSummary,
  AttachmentInput,
  BotDraft,
  BotPermissionMode,
  ChatSettings,
  CrmAppSettings,
  CrmCsvKind,
  CrmSendInput,
  CrmServerAction,
  CrmSettings,
  CrmWhatsappDraft,
  CustomerKind,
  DelegateTarget,
  DraftAction,
  EffortLevel,
  HireRequest,
  MeetingSettings,
  LedgerQuery,
  OfficePermissionMode,
  PaymentMethod,
  PermissionDecision,
  Pipeline,
  ProjectFloor,
  RoutineDraft,
  RoutineWho,
  Schedule,
  SensitiveKind,
  Settings,
  TicketDraft,
  TicketPatch,
  TicketStatus,
} from '@shared/types'
import { isDir } from './squads'

// Everything the renderer sends goes through here. The page runs sandboxed, but the
// main process treats it as untrusted anyway: an XSS in an agent's output must not
// reach the SDK, the disk or office.json with values the UI could never send.

export const PERMISSION_MODES: readonly OfficePermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions']
/** Work someone else wrote (tickets, squad cycles) never runs with "bypass". */
export const DELEGATE_MODES: readonly OfficePermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan']
const STATUS_VALUES = STATUSES.map((s) => s.value) as [TicketStatus, ...TicketStatus[]]

const MAX_PATH = 4096
const HEX = /^#[0-9a-f]{6}$/i
const MODEL_RE = /^[\w.\-[\]]{1,64}$/

/** Parses or throws a message the player can read. */
export function parse<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const r = schema.safeParse(raw)
  if (!r.success) throw new Error(message)
  return r.data
}

// ---------- small pieces ----------

/** Exportar em Markdown (AO-36): nome sugerido e texto, até 20 MB. O caminho vem do diálogo de salvar, nunca da página. */
export const saveMarkdownArgsSchema = z.tuple([z.string().max(200), z.string().max(20_000_000)])
/** Copiar relatório: texto para o clipboard. */
export const copyTextSchema = z.string().max(2_000_000)

/** Nome sugerido no diálogo de salvar: sem pastas, sem caracteres estranhos, sempre .md. */
export function markdownFileName(raw: string): string {
  const name = basename(raw.replace(/\\/g, '/')).replace(/[^\p{L}\p{N}._ -]+/gu, '-').replace(/^[.\s-]+/, '').slice(0, 100) || 'agent-office'
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`
}

/** Agent, ticket, request and account ids: never empty, never huge. */
export const idSchema = z.string().min(1).max(200)
/** getSubagentLog(agentId, subId) */
export const subagentLogArgsSchema = z.tuple([idSchema, idSchema])
export const pathSchema = z.string().min(1).max(MAX_PATH)
export const permissionModeSchema = z.enum(PERMISSION_MODES as [OfficePermissionMode, ...OfficePermissionMode[]])
export const ticketStatusSchema = z.enum(STATUS_VALUES)
/** A message to an agent: long pastes are fine, megabytes of text are not. */
export const messageSchema = z.string().max(2_000_000)
export const commentSchema = z.string().max(100_000)
/** Search box of the closed tickets; anything else = no filter. */
export const searchSchema = z.string().max(200).optional().catch(undefined)
export const ticketIdsSchema = z.array(idSchema).max(10_000).optional()
/** 'me' = the player; null or missing = nobody. */
export const assigneeSchema = z.literal('me').nullish()
/** Web links only: file:// or custom schemes could run things. */
export const externalUrlSchema = z.string().max(8192).regex(/^https?:\/\//i)
/** Floor id of setAccountPool; null = folders outside every floor. */
export const floorIdSchema = z.string().min(1).max(40).nullable()
/** A squad code as squads.ts accepts it. */
export const squadCodeSchema = z.string().regex(/^[\w-]{1,64}$/)
export const squadNoteSchema = z.string().max(20_000).optional().catch(undefined)
export const accountNameSchema = z.string().max(200).catch('')

/** Files sent with a message. buildMessage checks the bytes and the limits with friendly messages. */
export const attachmentsSchema: z.ZodType<AttachmentInput[]> = z
  .array(
    z.object({
      name: z.string().max(1000),
      mime: z.string().max(200).optional(),
      path: z.string().max(MAX_PATH).optional(),
      dataBase64: z.string().max(Math.ceil((ATTACH_LIMITS.total * 4) / 3) + 16).optional(),
    }),
  )
  .max(100)

/** A permission card's answer. */
export const permissionDecisionSchema: z.ZodType<PermissionDecision> = z.object({
  requestId: idSchema,
  behavior: z.enum(['allow', 'allow_always', 'deny']),
  message: z.string().max(10_000).optional(),
  answers: z
    .record(z.string().max(2000), z.string().max(10_000))
    .refine((a) => Object.keys(a).length <= 50)
    .optional(),
})

// Tickets: tickets.ts trims to its own limits (cleanDraft); these caps only refuse absurd sizes.
const criterionSchema = z.object({ text: z.string().max(2000), done: z.boolean().optional().default(false) })
const ticketFields = {
  type: z.enum(['bug', 'feature', 'improvement', 'task']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: ticketStatusSchema.optional(),
  description: z.string().max(100_000).optional(),
  acceptance: z.array(criterionSchema).max(200).optional(),
  cwd: pathSchema.nullable().optional(),
  tags: z.array(z.string().max(100)).max(100).optional(),
  // NaN or Infinity clear it, as cleanDraft does with any number it cannot use.
  estimate: z.number().nullable().optional().catch(null),
  dueDate: z.string().max(10).nullable().optional(),
}
export const ticketDraftSchema: z.ZodType<TicketDraft> = z.object({ title: z.string().max(2000), ...ticketFields })
export const ticketPatchSchema: z.ZodType<TicketPatch> = z.object({ title: z.string().max(2000).optional(), ...ticketFields })

// ---------- brains, accounts, floors ----------

/** Model, effort and accounts from the renderer: a short model name or id, a known effort level, existing accounts. */
export function cleanBrain(raw: unknown, accounts: Account[]): AgentBrain {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const brain: AgentBrain = {}
  // A key that is present but empty means "Claude Code's default", not the office default.
  if ('model' in r) brain.model = typeof r.model === 'string' && MODEL_RE.test(r.model) ? r.model : undefined
  if ('effort' in r) brain.effort = EFFORT_LEVELS.includes(r.effort as never) ? (r.effort as AgentBrain['effort']) : undefined
  // Empty = the project's accounts.
  if ('accounts' in r) brain.accounts = cleanAccountIds(r.accounts, accounts)
  return brain
}

/** Account ids from the renderer that exist, without repeats. */
export function cleanAccountIds(raw: unknown, accounts: Account[]): string[] {
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && accounts.some((a) => a.id === id)) : []
  return [...new Set(ids)]
}

/**
 * Accounts from the renderer: only names, colors and order change here. Ids and
 * config folders come from accounts made by addAccount, never from the page.
 */
export function cleanAccounts(raw: unknown, current: Account[]): Account[] {
  const out: Account[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const known = current.find((a) => a.id === r.id)
    if (!known || out.some((o) => o.id === known.id)) continue
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 32) : known.name
    const color = typeof r.color === 'string' && HEX.test(r.color) ? r.color : known.color
    out.push({ ...known, name, color })
  }
  // Removing goes through removeAccount.
  for (const a of current) if (!out.some((o) => o.id === a.id)) out.push(a)
  return out
}

/** Raster logos only (no SVG: it can carry scripts), small enough for office.json. */
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
export const MAX_LOGO_CHARS = 400_000

function cleanBrand(p: Record<string, unknown>): Pick<ProjectFloor, 'logo' | 'brandColor' | 'uniform'> {
  const out: Pick<ProjectFloor, 'logo' | 'brandColor' | 'uniform'> = {}
  if (typeof p.logo === 'string' && p.logo.length <= MAX_LOGO_CHARS && LOGO_RE.test(p.logo)) out.logo = p.logo
  if (typeof p.brandColor === 'string' && HEX.test(p.brandColor)) out.brandColor = p.brandColor.toLowerCase()
  if (p.uniform === true) out.uniform = true
  return out
}

/**
 * Project floors from the renderer: existing folders only, one floor per folder,
 * a plain id (it becomes part of avatar seeds and lookups) and a short name.
 */
export function cleanProjects(raw: unknown, previous: ProjectFloor[]): ProjectFloor[] {
  const out: ProjectFloor[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const p = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const cwd = typeof p.cwd === 'string' ? p.cwd : ''
    if (!isAbsolute(cwd) || !isDir(cwd) || out.some((o) => o.cwd === cwd)) continue
    if (!canAddFloor(out)) break
    const id = typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) && !out.some((o) => o.id === p.id) ? p.id : `p-${randomUUID().slice(0, 8)}`
    const name = (typeof p.name === 'string' ? p.name.trim().slice(0, 32) : '') || floorNameFor(cwd)
    // A floor's accounts change only through setAccountPool: the settings form may hold an old copy.
    const accounts = previous.find((o) => o.id === id)?.accounts
    // The studio folder: an existing folder, or one inside the project the studio makes on first use.
    // A form that dropped the field keeps the one saved.
    const asked = typeof p.studioDir === 'string' ? p.studioDir : previous.find((o) => o.id === id)?.studioDir
    const studioDir = asked && isAbsolute(asked) && asked.length < 1024 && (isDir(asked) || insideFolder(cwd, asked)) ? asked : undefined
    // Agents reading transcripts is opt-in per floor; a form that dropped the field keeps the one saved.
    const transcripts = typeof p.meetingsTranscripts === 'boolean' ? p.meetingsTranscripts : previous.find((o) => o.id === id)?.meetingsTranscripts === true
    out.push({ id, name, cwd, ...(accounts?.length ? { accounts } : {}), ...cleanBrand(p), ...(p.worktrees === false ? { worktrees: false as const } : {}), ...(studioDir ? { studioDir } : {}), ...(transcripts ? { meetingsTranscripts: true } : {}), ...(p.kind === 'creative' ? { kind: 'creative' as const } : {}) })
  }
  return mergeCreativeFloors(out)
}

/** `child` sits inside `root` (or is it), after resolving `..`. */
function insideFolder(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child))
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/** Days as 'YYYY-MM-DD' and an absolute folder; anything else is dropped. */
export function cleanLedgerQuery(raw: unknown): LedgerQuery {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const q: LedgerQuery = {}
  if (day(r.from)) q.from = day(r.from)
  if (day(r.to)) q.to = day(r.to)
  if (typeof r.cwd === 'string' && isAbsolute(r.cwd)) q.cwd = r.cwd
  return q
}

// ---------- requests ----------

/**
 * A hire from the renderer: an existing folder, a task, a short name, a clean brain.
 * A permission mode outside the list falls back to the office default.
 */
export function cleanHire(raw: unknown, settings: Pick<Settings, 'accounts' | 'defaultPermissionMode'>): HireRequest {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cwd = pathSchema.safeParse(r.cwd)
  if (!cwd.success || !isDir(cwd.data)) throw new Error('Escolha uma pasta de projeto que exista.')
  const task = messageSchema.safeParse(r.task)
  if (!task.success || !task.data.trim()) throw new Error('Descreva a tarefa do agente.')
  const mode = permissionModeSchema.safeParse(r.permissionMode)
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, 40) : '',
    cwd: cwd.data,
    task: task.data,
    ...cleanBrain(r, settings.accounts),
    permissionMode: mode.success ? mode.data : settings.defaultPermissionMode,
    worktree: worktreeFlagSchema.parse(r.worktree),
  }
}

// ---------- worktrees and result cards (AO-33, AO-34) ----------

/** "Trabalhar numa cópia isolada": true, false, or missing (= yes in a git repo). */
export const worktreeFlagSchema = z.boolean().optional().catch(undefined)
/** Agent and result ids are randomUUID()s. */
export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
/** A file of a result card: git.ts still checks it is listed and inside the repo. */
export const changedPathSchema = z.string().min(1).max(MAX_PATH).refine((p) => !p.includes('\0'))
export const commitMessageSchema = z.string().trim().min(1).max(2000)
/** First line only, short enough for a PR title. */
export const prTitleSchema = z.string().transform((s) => s.trim().split('\n')[0].slice(0, 200)).pipe(z.string().min(1))

/** Who takes a ticket: an agent already here, or a new hire that never runs with "bypass". */
export function cleanDelegateTarget(raw: unknown, accounts: Account[]): DelegateTarget {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if ('agentId' in r) return { agentId: parse(idSchema, r.agentId, 'Agente inválido.') }
  const hire = (r.hire && typeof r.hire === 'object' ? r.hire : {}) as Record<string, unknown>
  return {
    hire: {
      ...cleanBrain(hire, accounts),
      permissionMode: DELEGATE_MODES.includes(hire.permissionMode as never) ? (hire.permissionMode as OfficePermissionMode) : undefined,
      worktree: worktreeFlagSchema.parse(hire.worktree),
    },
  }
}

/** Mode for a squad cycle: it reaches real systems, so never "bypass". */
export function delegateMode(raw: unknown): OfficePermissionMode {
  return DELEGATE_MODES.includes(raw as never) ? (raw as OfficePermissionMode) : 'default'
}

// ---------- settings ----------

const lookSchema = z.object({
  skin: z.string().regex(HEX),
  hair: z.string().regex(HEX),
  hairStyle: z.number().int().min(0).max(HAIR_STYLES - 1),
  shirt: z.string().regex(HEX),
  pants: z.string().regex(HEX),
  shoes: z.string().regex(HEX),
})

/**
 * A number, or a string of digits (an input's value). Not z.coerce: null, '', [] and
 * false would become 0 and true 1, and saving {ticketAutoCloseDays: null} would turn
 * auto-close off. Anything else keeps the current value (AO-44).
 */
const numberField = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/).transform(Number)])

/**
 * One schema per field the settings form may change. bridgePort and the lists
 * (projects, accounts, defaultAccounts) have their own rules in cleanSettings.
 */
const settingsFields = {
  playerName: z.string().trim().min(1).max(32),
  playerLook: lookSchema,
  pixelSize: z.number().int().min(2).max(5),
  defaultModel: z.union([z.literal(''), z.string().regex(MODEL_RE)]),
  defaultEffort: z.union([z.literal(''), z.enum(EFFORT_LEVELS as [EffortLevel, ...EffortLevel[]])]),
  defaultPermissionMode: permissionModeSchema,
  notifications: z.boolean(),
  ticketAutoCloseDays: numberField.pipe(z.number().int().min(0).max(365)),
  maxSubagents: numberField.pipe(z.number().int().min(0).max(100)),
  agentBudgetUsd: numberField
    .pipe(z.number().finite().min(0).max(100_000))
    .transform((n) => Math.round(n * 100) / 100),
  dailyBudgetUsd: numberField
    .pipe(z.number().finite().min(0).max(100_000))
    .transform((n) => Math.round(n * 100) / 100),
  freshTicketSession: z.boolean(),
  freshSquadCycle: z.boolean(),
  contextWarnTokens: numberField.pipe(z.number().int().min(0).max(10_000_000)),
  coldConfirm: z.boolean(),
  updateChannel: z.enum(['stable', 'beta']),
  caffeine: z.enum(['off', 'agents', 'on']),
} satisfies { [K in keyof Settings]?: z.ZodType<unknown> }

/** Configurações → Vídeo, one schema per field: a bad one keeps its current value. */
const videoFields = {
  shadows: z.boolean(),
  shadowMapSize: z.union([z.literal(1024), z.literal(2048)]),
  fpsLimit: z.union([z.literal(0), z.literal(30), z.literal(60)]),
  effects: z.enum(['full', 'reduced']),
  batterySaver: z.boolean(),
  view: z.enum(['iso', '2d']),
} satisfies { [K in keyof VideoSettings]-?: z.ZodType<VideoSettings[K]> }

/** Video settings from the renderer (or an old office.json) laid over `current`; unknown keys are dropped. */
export function cleanVideo(raw: unknown, current: VideoSettings): VideoSettings {
  const patch = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const next: VideoSettings = { ...current }
  const put = next as unknown as Record<string, unknown>
  for (const [key, schema] of Object.entries(videoFields)) {
    if (!Object.hasOwn(patch, key)) continue
    const r = (schema as z.ZodType<unknown>).safeParse(patch[key])
    if (r.success) put[key] = r.data
  }
  return next
}

/** A whole number pulled into [min, max]; anything that is not a finite number is refused. */
const clampedInt = (min: number, max: number) => z.number().transform((n) => Math.min(max, Math.max(min, Math.round(n))))

// One schema per plain field of Configurações → Reuniões; the lists go through their own loaders.
const meetingFields = {
  lang: z.enum(['pt', 'en', 'auto']),
  whisperModel: z.union([z.literal(''), z.string().regex(WHISPER_MODEL_FILE)]),
  defaultSources: z.enum(['mic+system', 'mic']),
  autoAta: z.boolean(),
  ataModel: z.enum(['sonnet', 'opus']),
  doNotDisturb: z.boolean(),
  autoStopMin: clampedInt(AUTOSTOP_MIN_RANGE.min, AUTOSTOP_MIN_RANGE.max),
  keepAudio: z.boolean(),
  retentionDays: clampedInt(RETENTION_DAYS_RANGE.min, RETENTION_DAYS_RANGE.max),
  agentsReadAtas: z.boolean(),
} satisfies { [K in Exclude<keyof MeetingSettings, 'templates' | 'recipes'>]-?: z.ZodType<MeetingSettings[K], unknown> }

/**
 * Configurações → Reuniões from the renderer (or an old office.json) laid over `current`.
 * Unknown keys are dropped; a wrong type keeps the current value; numbers out of range are
 * clamped. Each list goes item by item (a broken one is dropped, a gone floor turns global).
 */
export function cleanMeetings(raw: unknown, current: MeetingSettings, projects: Floors): MeetingSettings {
  const patch = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const next: MeetingSettings = { ...current, templates: [...current.templates], recipes: [...current.recipes] }
  const put = next as unknown as Record<string, unknown>
  for (const [key, schema] of Object.entries(meetingFields)) {
    if (!Object.hasOwn(patch, key)) continue
    const r = (schema as z.ZodType<unknown, unknown>).safeParse(patch[key])
    if (r.success) put[key] = r.data
  }
  if (Array.isArray(patch.templates)) next.templates = loadMeetingTemplates(patch.templates, projects)
  if (Array.isArray(patch.recipes)) next.recipes = loadMeetingRecipes(patch.recipes, projects)
  return next
}

/**
 * A settings patch from the renderer applied to the current settings. Unknown keys are
 * dropped; a field with the wrong type or out of range keeps its current value.
 */
export function cleanSettings(raw: unknown, current: Settings): Settings {
  const patch = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const next: Settings = { ...current }
  const put = next as unknown as Record<string, unknown>
  for (const [key, schema] of Object.entries(settingsFields)) {
    if (!Object.hasOwn(patch, key)) continue
    const r = (schema as z.ZodType<unknown>).safeParse(patch[key])
    if (r.success) put[key] = r.data
  }
  if (Object.hasOwn(patch, 'accounts')) next.accounts = cleanAccounts(patch.accounts, current.accounts)
  if (Object.hasOwn(patch, 'defaultAccounts')) next.defaultAccounts = cleanAccountIds(patch.defaultAccounts, next.accounts)
  if (Object.hasOwn(patch, 'projects')) next.projects = cleanProjects(patch.projects, current.projects)
  if (Object.hasOwn(patch, 'video')) next.video = cleanVideo(patch.video, current.video)
  if (Object.hasOwn(patch, 'meetings')) next.meetings = cleanMeetings(patch.meetings, current.meetings, next.projects)
  if (Object.hasOwn(patch, 'chat')) next.chat = cleanChatSettings(patch.chat, { ...CHAT_DEFAULTS, ...current.chat })
  if (Object.hasOwn(patch, 'crm')) next.crm = cleanCrmAppSettings(patch.crm, { ...CRM_APP_DEFAULTS, ...current.crm })
  return next
}

// ---------- routines ----------

const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
/** Shape only: schedule.ts says what is wrong with the values, in words the form shows. */
export const scheduleSchema: z.ZodType<Schedule> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.string().max(20) }),
  z.object({ kind: z.literal('daily'), time: hhmmSchema }),
  z.object({ kind: z.literal('weekly'), days: z.array(z.number().int().min(0).max(6)).max(7), time: hhmmSchema }),
  z.object({
    kind: z.literal('interval'),
    every: z.number().int().min(1).max(10_080),
    unit: z.enum(['minutes', 'hours']),
    anchor: z.number().int().min(0).max(8_640_000_000_000).optional(),
  }),
  z.object({ kind: z.literal('cron'), expr: z.string().max(200) }),
])

const routineWhoSchema: z.ZodType<RoutineWho> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new'),
    name: z.string().max(40).optional(),
    model: z.union([z.literal(''), z.string().regex(MODEL_RE)]).optional(),
    effort: z.enum(EFFORT_LEVELS as [EffortLevel, ...EffortLevel[]]).optional(),
  }),
  z.object({ kind: z.literal('template'), templateId: idSchema }),
  z.object({ kind: z.literal('agent'), agentId: idSchema }),
  z.object({ kind: z.literal('bot'), botId: idSchema }),
])

export const routineDraftSchema = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/).optional(),
  name: z.string().max(2000),
  prompt: z.string().max(ROUTINE_LIMITS.prompt),
  who: routineWhoSchema,
  cwd: pathSchema.optional(),
  floor: z.string().min(1).max(40).optional(),
  permissionMode: permissionModeSchema.optional(),
  schedule: scheduleSchema,
  enabled: z.boolean().optional(),
  missed: z.enum(['run', 'skip']).optional(),
})

/** A routine draft that passed every check: one place to run (cwd, or the floor's), defaults filled. */
export type CleanRoutineDraft = Required<Pick<RoutineDraft, 'name' | 'prompt' | 'who' | 'permissionMode' | 'schedule' | 'enabled' | 'missed'>> & Pick<RoutineDraft, 'id' | 'cwd' | 'floor'>

/**
 * A routine from the renderer. Throws a message the form can show: a name, a task, a
 * schedule that runs, a runner that exists and a folder or floor for agents it hires.
 * Nothing says "Sem pedir nada" unless the form sent it (the default is "Pedir permissão").
 */
export function cleanRoutineDraft(raw: unknown, ctx: { settings: Pick<Settings, 'projects' | 'templates'>; agents: AgentSummary[]; bots?: { id: string }[]; now?: number }): CleanRoutineDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!name || name.length > ROUTINE_LIMITS.name) throw new Error(`Dê um nome à rotina (até ${ROUTINE_LIMITS.name} letras).`)
  const d = parse(routineDraftSchema, raw, 'Rotina inválida. Feche e abra o formulário de novo.')
  const who = d.who
  const prompt = d.prompt.trim()
  const template = who.kind === 'template' ? ctx.settings.templates.find((t) => t.id === who.templateId) : undefined
  if (who.kind === 'template' && !template) throw new Error('Esse modelo salvo não existe mais. Escolha outro.')
  // A bot with no task does its job, as its role says.
  if (!prompt && !template?.instruction && who.kind !== 'bot') throw new Error('Descreva a tarefa da rotina.')
  const problem = scheduleError(d.schedule)
  if (problem) throw new Error(problem)
  const schedule: Schedule = d.schedule.kind === 'interval' ? { ...d.schedule, anchor: d.schedule.anchor ?? Math.floor((ctx.now ?? Date.now()) / 60_000) * 60_000 } : d.schedule
  if (schedule.kind === 'weekly') schedule.days = [...new Set(schedule.days)].sort((a, b) => a - b)
  if (schedule.kind === 'cron') schedule.expr = schedule.expr.trim().replace(/\s+/g, ' ')

  const out: CleanRoutineDraft = {
    ...(d.id ? { id: d.id } : {}),
    name,
    prompt,
    who: who.kind === 'new' ? { kind: 'new', ...(who.name?.trim() ? { name: who.name.trim() } : {}), ...(who.model ? { model: who.model } : {}), ...(who.effort ? { effort: who.effort } : {}) } : who,
    permissionMode: d.permissionMode ?? 'default',
    schedule,
    enabled: d.enabled ?? true,
    missed: d.missed ?? 'run',
  }
  // A bot runs where the bot works: the routine keeps no folder of its own.
  if (who.kind === 'bot') {
    if (!ctx.bots?.some((b) => b.id === who.botId)) throw new Error('Esse bot não existe mais. Escolha outro.')
    return out
  }
  if (who.kind === 'agent') {
    const a = ctx.agents.find((x) => x.id === who.agentId)
    if (!a) throw new Error('Esse agente não está mais no escritório. Escolha outro.')
    if (a.source !== 'office') throw new Error('Sessões do terminal não recebem tarefas do escritório. Escolha um agente do escritório.')
    if (a.role === 'orchestrator') throw new Error(`${a.name} só roda o ciclo do squad. Escolha outro agente.`)
    return out
  }
  if (d.floor) {
    if (!ctx.settings.projects.some((p) => p.id === d.floor)) throw new Error('Esse andar não existe mais. Escolha outro.')
    return { ...out, floor: d.floor }
  }
  if (!d.cwd || !isAbsolute(d.cwd) || !isDir(d.cwd)) throw new Error('Escolha a pasta (ou o andar) onde a rotina roda.')
  return { ...out, cwd: d.cwd }
}

// ---------- sala de reunião (RN-06) ----------
// Every channel of ipc/meetings.ts takes one object, strict: an unknown field is refused.

/** Limits of what the meeting room sends; the handlers trust nothing beyond these. */
export const MEETING_IPC_LIMITS = {
  title: 200,
  attendees: 50,
  attendee: 120,
  notes: 200_000,
  question: 4000,
  historyTurns: 40,
  historyText: 8000,
}

/** '2026-11-07-1430-kickoff-do-checkout', as MeetingStore makes it. */
export const meetingIdSchema = z.string().max(80).regex(MEETING_ID_RE)
/** ProjectFloor.id or 'terreo': a folder name, never a path. */
export const meetingFloorSchema = z.string().regex(FLOOR_RE)
export const trackSchema = z.enum(['eu', 'outros', 'sala'])
const templateIdSchema = z.string().regex(TEMPLATE_ID_RE)
const blockIdSchema = z.string().regex(/^[\w-]{1,64}$/)
const meetingRef = z.strictObject({ id: meetingIdSchema })

export const meetingListSchema = z.strictObject({ floor: meetingFloorSchema })
export const meetingGetSchema = meetingRef
export const meetingCreateSchema = z.strictObject({
  floor: meetingFloorSchema,
  title: z.string().max(MEETING_IPC_LIMITS.title).optional(),
  template: templateIdSchema.optional(),
  attendees: z.array(z.string().max(MEETING_IPC_LIMITS.attendee)).max(MEETING_IPC_LIMITS.attendees).optional(),
  sources: z.strictObject({ mic: z.boolean(), system: z.boolean() }).optional(),
})
/** Start, pause, resume, stop, delete, recover: just the meeting. */
export const meetingControlSchema = meetingRef

/** PCM bytes as the renderer sends them (Int16Array from the worklet; Uint8Array or ArrayBuffer also do). */
const pcmSchema = z.custom<Int16Array | Uint8Array | ArrayBuffer>((v) => {
  const n = v instanceof ArrayBuffer ? v.byteLength : v instanceof Int16Array || v instanceof Uint8Array ? v.byteLength : -1
  return n >= 2 && n <= AUDIO_CHUNK_MAX_BYTES && n % 2 === 0
})
export const meetingAudioSchema = z.strictObject({
  id: meetingIdSchema,
  track: trackSchema,
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  pcm: pcmSchema,
})
export const meetingNotesSchema = z.strictObject({ id: meetingIdSchema, text: z.string().max(MEETING_IPC_LIMITS.notes) })
export const meetingEnhanceSchema = z.strictObject({ id: meetingIdSchema, template: templateIdSchema.optional() })

/** A block of the edited ata: the Claude block plus its id; `ticket` is the main's (kept from disk, never taken from the page). */
export const ataBlockSchema = blockSchema.extend({ id: blockIdSchema, ticket: z.string().max(40).optional() }).strict()
export const meetingBlocksSchema = z.strictObject({ id: meetingIdSchema, blocks: z.array(ataBlockSchema).max(ATA_LIMITS.blocks) })

const chatTurnSchema = z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string().max(MEETING_IPC_LIMITS.historyText) })
export const meetingAskSchema = z
  .strictObject({
    scope: z.enum(['meeting', 'floor']),
    id: meetingIdSchema.optional(),
    floor: meetingFloorSchema,
    question: z.string().trim().min(1).max(MEETING_IPC_LIMITS.question),
    history: z.array(chatTurnSchema).max(MEETING_IPC_LIMITS.historyTurns).optional(),
  })
  .refine((a) => a.scope === 'floor' || !!a.id)

export const meetingTicketSchema = z.strictObject({
  id: meetingIdSchema,
  blockId: blockIdSchema,
  draft: ticketDraftSchema,
  agentId: idSchema.optional(),
  floor: meetingFloorSchema.optional(),
})
export const meetingTemplatesSchema = z.strictObject({ floor: meetingFloorSchema.optional() })
/** The item itself goes through cleanMeetingTemplate / cleanMeetingRecipe (fields, limits, floor). */
export const meetingSaveTemplateSchema = z.strictObject({ kind: z.enum(['template', 'recipe']), item: z.record(z.string(), z.unknown()) })
export const meetingAgentSchema = z.strictObject({ id: meetingIdSchema, agentId: idSchema, question: z.string().trim().min(1).max(MEETING_IPC_LIMITS.question) })

// ---------- Chat dos bots (docs/prd/chat-de-bots.md) ----------

/** Bots never run in "Sem pedir nada": the form cannot send it, and nothing else can either. */
export const BOT_MODES: readonly BotPermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan']
/** A bot, channel or thread id that is safe as a file name ('canais' is the channels' folder). */
const threadIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .refine((s) => s !== 'canais')
const serverNameSchema = z.string().regex(/^[\w.@-]{1,100}$/)

export const botDraftSchema = z.object({
  id: threadIdSchema.optional(),
  name: z.string().max(2000),
  tagline: z.string().max(2000).optional(),
  role: z.string().max(BOT_LIMITS.role * 2),
  color: z.string().max(20).optional(),
  look: lookSchema.optional(),
  floor: z.string().min(1).max(40),
  cwd: pathSchema.optional(),
  model: z.union([z.literal(''), z.string().regex(MODEL_RE)]).optional(),
  effort: z.union([z.literal(''), z.enum(EFFORT_LEVELS as [EffortLevel, ...EffortLevel[]])]).optional(),
  accounts: z.array(idSchema).max(50).optional(),
  permissionMode: z.string().max(40).optional(),
  askBefore: z.array(z.enum(SENSITIVE_KINDS as [SensitiveKind, ...SensitiveKind[]])).max(10).optional(),
  apps: z.union([z.literal('all'), z.array(serverNameSchema).max(200)]).optional(),
  worktree: z.boolean().optional(),
  dailyBudgetUsd: numberField.pipe(z.number().finite().min(0).max(10_000)).optional(),
  templateId: z.string().regex(/^[\w-]{1,64}$/).optional(),
  schedule: scheduleSchema.optional(),
})

type BotDefaults = 'permissionMode' | 'askBefore' | 'apps' | 'worktree' | 'dailyBudgetUsd' | 'tagline' | 'color'
/** A bot draft that passed every check, with the defaults filled. */
export type CleanBotDraft = Omit<BotDraft, BotDefaults> & Required<Pick<BotDraft, BotDefaults>>

/**
 * A bot from the form (CB-07). Throws a message the form can show: a name, a job, a mode that
 * is not "Sem pedir nada", a floor that exists (or a folder on the ground floor). The defaults:
 * "Pedir permissão", every sensitive kind held, every connection, no daily cap.
 */
export function cleanBotDraft(raw: unknown, ctx: { settings: Pick<Settings, 'projects' | 'accounts'> }): CleanBotDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim().replace(/\s+/g, ' ') : ''
  if (!name || name.length > BOT_LIMITS.name) throw new Error(`Dê um nome ao bot (até ${BOT_LIMITS.name} letras).`)
  if (r.permissionMode === 'bypassPermissions') {
    throw new Error('Bots nunca rodam em "Sem pedir nada". Escolha "Pedir permissão", "Aceitar edições", "Automático" ou "Planejar".')
  }
  const d = parse(botDraftSchema, raw, 'Bot inválido. Feche e abra o formulário de novo.')
  const role = d.role.trim()
  if (!role) throw new Error('Descreva o trabalho do bot: o que ele faz e o que nunca faz.')
  if (role.length > BOT_LIMITS.role) throw new Error(`O trabalho do bot passou de ${BOT_LIMITS.role.toLocaleString('pt-BR')} letras. Encurte o texto.`)
  const mode = d.permissionMode ?? 'default'
  if (!BOT_MODES.includes(mode as BotPermissionMode)) throw new Error('Modo de permissão inválido. Escolha um da lista.')
  if (d.schedule) {
    const problem = scheduleError(d.schedule)
    if (problem) throw new Error(problem)
  }
  const askBefore = d.askBefore
  const out: CleanBotDraft = {
    ...(d.id ? { id: d.id } : {}),
    name,
    tagline: (d.tagline ?? '').trim().replace(/\s+/g, ' ').slice(0, BOT_LIMITS.tagline),
    role,
    color: BOT_COLORS.includes(d.color as never) ? (d.color as string) : BOT_COLORS[0],
    ...(d.look ? { look: d.look } : {}),
    floor: d.floor,
    ...(d.model ? { model: d.model } : {}),
    ...(d.effort ? { effort: d.effort } : {}),
    ...(d.accounts ? { accounts: cleanAccountIds(d.accounts, ctx.settings.accounts) } : {}),
    permissionMode: mode as BotPermissionMode,
    askBefore: askBefore ? SENSITIVE_KINDS.filter((k) => askBefore.includes(k)) : [...SENSITIVE_KINDS],
    // The office server is always on: it is not a choice.
    apps: d.apps === undefined || d.apps === 'all' ? 'all' : [...new Set(d.apps.filter((a) => a !== 'office'))],
    worktree: d.worktree ?? false,
    dailyBudgetUsd: Math.round((d.dailyBudgetUsd ?? 0) * 100) / 100,
    ...(d.templateId ? { templateId: d.templateId } : {}),
    ...(d.schedule ? { schedule: d.schedule } : {}),
  }
  if (d.floor === BOT_GROUND_FLOOR) {
    if (!d.cwd || !isAbsolute(d.cwd) || !isDir(d.cwd)) throw new Error('Escolha a pasta onde o bot trabalha.')
    return { ...out, cwd: d.cwd }
  }
  if (!ctx.settings.projects.some((p) => p.id === d.floor)) throw new Error('Esse andar não existe mais. Escolha outro.')
  return out
}

/** A bot or channel id from the renderer. */
export function cleanThreadId(raw: unknown): string {
  return parse(threadIdSchema, raw, 'Essa conversa não existe mais.')
}

export const botFlagsSchema = z.strictObject({
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  order: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
})
/** Fixar, Esconder and the sidebar order. */
export function cleanBotFlags(raw: unknown): z.infer<typeof botFlagsSchema> {
  return parse(botFlagsSchema, raw, 'Ajuste inválido do bot.')
}

/** botThread's options: an item id to page before, and how many. */
export const threadPageSchema = z.strictObject({
  before: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(BOT_LIMITS.page).optional(),
})
export const markReadAtSchema = z.number().finite().min(0).max(8_640_000_000_000).optional()
export const botSearchQuerySchema = z.string().max(200)
export const botSearchFloorSchema = z.string().min(1).max(40).optional()
export const botConfigureSchema = z.strictObject({
  model: z.union([z.literal(''), z.string().regex(MODEL_RE)]).optional(),
  effort: z.union([z.literal(''), z.enum(EFFORT_LEVELS as [EffortLevel, ...EffortLevel[]])]).optional(),
})
/** memoria.md from the profile: cut to BOT_LIMITS.memoryBytes when saved; this only refuses absurd sizes. */
export const botMemorySchema = z.string().max(BOT_LIMITS.memoryBytes * 4)

/** Configurações → Chat, one schema per field: a bad one keeps its current value. */
const chatFields = {
  deliverInOffice: z.boolean(),
  notify: z.enum(['all', 'approvals', 'off']),
  maxEventRunsPerHour: clampedInt(1, BOT_LIMITS.perHourMax),
  routerModel: z.string().regex(MODEL_RE),
  idleLeaveMin: clampedInt(0, 24 * 60),
} satisfies { [K in keyof ChatSettings]-?: z.ZodType<ChatSettings[K], unknown> }

/** Chat settings from the renderer (or an old office.json) laid over `current`; unknown keys are dropped. */
export function cleanChatSettings(raw: unknown, current: ChatSettings): ChatSettings {
  const patch = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const next: ChatSettings = { ...current }
  const put = next as unknown as Record<string, unknown>
  for (const [key, schema] of Object.entries(chatFields)) {
    if (!Object.hasOwn(patch, key)) continue
    const r = (schema as z.ZodType<unknown, unknown>).safeParse(patch[key])
    if (r.success) put[key] = r.data
  }
  return next
}

// ---------- Sala de CRM (docs/prd/sala-de-crm.md) ----------
// Every CRM argument passes through here before it reaches CrmStore. Messages are pt-BR and say
// what to fix; none of them repeats a phone or another customer's data.

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Ids the CRM makes (randomUUID) and pipeline and stage ids: safe as names, never paths. */
export const CRM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** A ticket key ('AO-12'). */
const TICKET_KEY_RE = /^[\w-]{1,40}$/
/** Latest time the CRM takes (year 2999), in ms. */
const CRM_MAX_MS = 32_503_680_000_000
/** Checks whose failure carries one of our pt-BR messages; a wrong type falls back to the handler's. */
const CRM_OWN_CODES = new Set(['too_big', 'too_small', 'invalid_format', 'custom'])

/** Parses a CRM argument: the message of the check that failed, or `fallback` when the type is wrong. */
function parseCrm<T>(schema: z.ZodType<T, unknown>, raw: unknown, fallback: string): T {
  const r = schema.safeParse(raw)
  if (r.success) return r.data
  const issue = r.error.issues[0]
  throw new Error(issue && CRM_OWN_CODES.has(issue.code) ? issue.message : fallback)
}

const crmTooLong = (what: string, max: number) => `${what} passa de ${max.toLocaleString('pt-BR')} letras. Encurte o texto.`
/**
 * Marks that flip the text direction (U+202A–202E, U+2066–2069): "Maria \u202Eodagap" would show
 * as "Maria pagado" in the table, the card and the CSV.
 */
const BIDI_MARKS = /[\u202A-\u202E\u2066-\u2069]/g
/** One line of text: control characters and direction marks out, spaces collapsed, trimmed. */
export function crmLineText(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .replace(BIDI_MARKS, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}
/** Text with line breaks: the same, but line breaks (and tabs) stay. */
function crmBlockText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[^\P{Cc}\t\n]/gu, '')
    .replace(BIDI_MARKS, '')
    .trim()
}
/** One line: trimmed, spaces collapsed, no control or direction characters, at most `max` letters. */
const crmLine = (what: string, max: number) =>
  z
    .string()
    .max(max * 4 + 64, crmTooLong(what, max))
    .transform(crmLineText)
    .pipe(z.string().max(max, crmTooLong(what, max)))
/** Optional: missing, null or empty (after trimming) is undefined. */
const crmOpt = <T>(schema: z.ZodType<T, unknown>) => z.preprocess((v) => (v === null || v === '' ? undefined : v), schema.optional()).transform((v) => (v === '' ? undefined : v))
const crmIdSchema = z.string().regex(CRM_ID_RE, 'Esse item não existe mais.')
const crmDay = (message: string) => z.string().max(20, message).refine(isDay, message)
const crmMonth = (message: string) => z.string().max(20, message).refine(isMonth, message)
/** Cents: whole, not negative, at most CRM_LIMITS.amountCents; `positive` refuses zero too. */
const crmCents = (positive: boolean) =>
  z
    .number()
    .refine(Number.isSafeInteger, 'Valor inválido. Digite o valor em reais, como 480,00.')
    .min(0, 'O valor não pode ser negativo.')
    .refine((n) => !positive || n > 0, 'Informe um valor maior que zero.')
    .max(CRM_LIMITS.amountCents, 'O valor passa do limite de R$ 100 milhões.')
const crmTickets = z.array(z.string().regex(TICKET_KEY_RE, 'Ticket inválido.')).max(CRM_LIMITS.tickets, `Até ${CRM_LIMITS.tickets} tickets por item.`)
const crmFloor = crmOpt(z.string().max(40, 'Esse andar não existe mais. Escolha outro.'))
const crmCustomerId = z.string().regex(CRM_ID_RE, 'Esse cliente não existe mais. Escolha outro.')
const CUSTOMER_KINDS = ['person', 'company'] as const satisfies readonly CustomerKind[]
const PAYMENT_METHODS = ['pix', 'boleto', 'transfer', 'card', 'cash'] as const satisfies readonly PaymentMethod[]

/** An id from the renderer, or `message`. */
export function cleanCrmId(raw: unknown, message = 'Esse item não existe mais.'): string {
  return parse(z.string().regex(CRM_ID_RE), raw, message)
}

/** A calendar day 'AAAA-MM-DD' from the renderer, or `message`. */
export function cleanCrmDay(raw: unknown, message = 'Data inválida. Use uma data do calendário.'): string {
  return parse(z.string().max(20).refine(isDay), raw, message)
}

/** Phones as typed, normalized (DDI, DDD, 9º dígito) and without repeats. Throws for one that is not a phone. */
export function cleanPhones(list: readonly string[]): string[] {
  const out: string[] = []
  for (const typed of list) {
    const t = typed.trim()
    if (!t) continue
    const phone = normalizePhone(t)
    if (!phone) {
      const tail = t.replace(/\D/g, '').slice(-4)
      throw new Error(`${tail.length === 4 ? `O telefone terminado em ${tail}` : 'Um dos telefones'} não parece válido. Use DDD e número, como (11) 98765-4321.`)
    }
    if (!out.includes(phone)) out.push(phone)
  }
  if (out.length > CRM_LIMITS.phones) throw new Error(`Até ${CRM_LIMITS.phones} telefones por cliente.`)
  return out
}

/** Tags without empties or repeats (any case or accent). */
function cleanTags(list: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of list) {
    const key = t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (!t || seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  if (out.length > CRM_LIMITS.tags) throw new Error(`Até ${CRM_LIMITS.tags} etiquetas por cliente.`)
  return out
}

/** Copies the keys `raw` has (even empty, which clears) from the parsed draft: a missing key keeps the saved value. */
function present<T extends object>(out: T, parsed: object, raw: unknown, keys: readonly string[]): T {
  const r = raw as Record<string, unknown>
  for (const k of keys) if (Object.hasOwn(r, k)) (out as Record<string, unknown>)[k] = (parsed as Record<string, unknown>)[k]
  return out
}

const consentSchema = z.object({
  service: z.boolean().optional(),
  billing: z.boolean().optional(),
  offers: z.boolean().optional(),
  offersSource: crmOpt(crmLine('A origem do consentimento', CRM_LIMITS.consentSource)),
  clearOptOut: z.boolean().optional(),
})

const customerDraftSchema = z.object({
  id: crmIdSchema.optional(),
  kind: z.enum(CUSTOMER_KINDS).optional(),
  name: crmLine('O nome', CRM_LIMITS.name).pipe(z.string().min(1, 'Dê um nome ao cliente.')),
  company: crmOpt(crmLine('A empresa', CRM_LIMITS.company)),
  phones: z
    .array(z.string().max(60, 'Telefone inválido. Use DDD e número, como (11) 98765-4321.'))
    .max(CRM_LIMITS.phones * 2, `Até ${CRM_LIMITS.phones} telefones por cliente.`)
    .optional(),
  email: crmOpt(
    z
      .string()
      .max(CRM_LIMITS.email + 64, 'E-mail inválido. Confira e tente de novo.')
      .transform((s) => s.trim())
      .pipe(z.string().max(CRM_LIMITS.email, 'E-mail inválido. Confira e tente de novo.').refine((s) => !s || EMAIL_RE.test(s), 'E-mail inválido. Confira e tente de novo.')),
  ),
  tags: z.array(crmLine('Cada etiqueta', CRM_LIMITS.tag)).max(CRM_LIMITS.tags * 2, `Até ${CRM_LIMITS.tags} etiquetas por cliente.`).optional(),
  owner: crmOpt(crmLine('O responsável', CRM_LIMITS.owner)),
  floor: crmFloor,
  consent: consentSchema.optional(),
  tickets: crmTickets.optional(),
  lastContactAt: crmOpt(z.number().min(0, 'Data do último contato inválida.').max(CRM_MAX_MS, 'Data do último contato inválida.')),
  nextStep: crmOpt(crmLine('O próximo passo', CRM_LIMITS.nextStep)),
  nextStepOn: crmOpt(crmDay('Data do próximo passo inválida. Use uma data do calendário.')),
})

/** Offers on or off and where the consent came from; the store stamps the dates. */
export interface CleanConsent {
  service?: boolean
  billing?: boolean
  offers?: boolean
  offersSource?: string
  clearOptOut?: boolean
}

/**
 * A customer draft that passed every check: phones normalized, tags without repeats. A key the
 * draft has is set (an empty one clears the field); a key it lacks keeps the saved value.
 */
export interface CleanCustomerDraft {
  id?: string
  kind?: CustomerKind
  name: string
  company?: string
  phones?: string[]
  email?: string
  tags?: string[]
  owner?: string
  floor?: string
  consent?: CleanConsent
  tickets?: string[]
  lastContactAt?: number
  nextStep?: string
  nextStepOn?: string
}

/** A customer from the form or a CSV row. `floors`: the ProjectFloor ids that exist. */
export function cleanCustomer(raw: unknown, ctx: { floors: readonly string[] }): CleanCustomerDraft {
  const d = parseCrm(customerDraftSchema, raw, 'Cliente inválido. Feche e abra o formulário de novo.')
  if (d.floor && !ctx.floors.includes(d.floor)) throw new Error('Esse andar não existe mais. Escolha outro.')
  const out: CleanCustomerDraft = { name: d.name, ...(d.id ? { id: d.id } : {}), ...(d.kind ? { kind: d.kind } : {}) }
  present(out, d, raw, ['company', 'email', 'owner', 'floor', 'lastContactAt', 'nextStep', 'nextStepOn'])
  if (d.phones) out.phones = cleanPhones(d.phones)
  if (d.tags) out.tags = cleanTags(d.tags)
  if (d.tickets) out.tickets = [...new Set(d.tickets)]
  if (d.consent) out.consent = Object.fromEntries(Object.entries(d.consent).filter(([, v]) => v !== undefined))
  return out
}

const dealDraftSchema = z.object({
  id: crmIdSchema.optional(),
  customerId: crmCustomerId,
  title: crmLine('O nome do negócio', CRM_LIMITS.title).pipe(z.string().min(1, 'Diga o serviço do negócio, como "Site institucional".')),
  valueCents: crmOpt(crmCents(false)),
  pipelineId: crmOpt(z.string().regex(CRM_ID_RE, 'Esse funil não existe mais.')),
  stageId: crmOpt(z.string().regex(CRM_ID_RE, 'Essa etapa não existe mais nesse funil.')),
  nextStep: crmOpt(crmLine('O próximo passo', CRM_LIMITS.nextStep)),
  nextStepOn: crmOpt(crmDay('Data do próximo passo inválida. Use uma data do calendário.')),
  floor: crmFloor,
  tickets: crmTickets.optional(),
})

/** A deal draft that passed every check; same key rule as CleanCustomerDraft. */
export interface CleanDealDraft {
  id?: string
  customerId: string
  title: string
  valueCents?: number
  pipelineId?: string
  stageId?: string
  nextStep?: string
  nextStepOn?: string
  floor?: string
  tickets?: string[]
}

export function cleanDeal(raw: unknown, ctx: { floors: readonly string[] }): CleanDealDraft {
  const d = parseCrm(dealDraftSchema, raw, 'Negócio inválido. Feche e abra o formulário de novo.')
  if (d.floor && !ctx.floors.includes(d.floor)) throw new Error('Esse andar não existe mais. Escolha outro.')
  const out: CleanDealDraft = { customerId: d.customerId, title: d.title, ...(d.id ? { id: d.id } : {}), ...(d.pipelineId ? { pipelineId: d.pipelineId } : {}), ...(d.stageId ? { stageId: d.stageId } : {}) }
  present(out, d, raw, ['valueCents', 'nextStep', 'nextStepOn', 'floor'])
  if (d.tickets) out.tickets = [...new Set(d.tickets)]
  return out
}

const paymentDraftSchema = z.object({
  id: crmIdSchema.optional(),
  customerId: crmCustomerId,
  dealId: crmOpt(z.string().regex(CRM_ID_RE, 'Esse negócio não existe mais.')),
  amountCents: crmCents(true),
  due: crmDay('Vencimento inválido. Use uma data do calendário.'),
  reference: crmLine('O "referente a"', CRM_LIMITS.reference),
  method: z.enum(PAYMENT_METHODS).optional(),
  owner: crmOpt(crmLine('O responsável', CRM_LIMITS.owner)),
  state: z.enum(['open', 'canceled', 'disputed']).optional(),
})

/** A payment draft that passed every check (paying goes through markPaid); same key rule as CleanCustomerDraft. */
export interface CleanPaymentDraft {
  id?: string
  customerId: string
  dealId?: string
  amountCents: number
  due: string
  reference: string
  method?: PaymentMethod
  owner?: string
  state?: 'open' | 'canceled' | 'disputed'
}

export function cleanPayment(raw: unknown): CleanPaymentDraft {
  const d = parseCrm(paymentDraftSchema, raw, 'Pagamento inválido. Feche e abra o formulário de novo.')
  const out: CleanPaymentDraft = {
    customerId: d.customerId,
    amountCents: d.amountCents,
    due: d.due,
    reference: d.reference,
    ...(d.id ? { id: d.id } : {}),
    ...(d.method ? { method: d.method } : {}),
    ...(d.state ? { state: d.state } : {}),
  }
  return present(out, d, raw, ['dealId', 'owner'])
}

const recurrenceDraftSchema = z
  .object({
    id: crmIdSchema.optional(),
    customerId: crmCustomerId,
    dealId: crmOpt(z.string().regex(CRM_ID_RE, 'Esse negócio não existe mais.')),
    amountCents: crmCents(true),
    day: z.number().refine(Number.isInteger, 'O dia vai de 1 a 31.').min(1, 'O dia vai de 1 a 31.').max(31, 'O dia vai de 1 a 31.'),
    reference: crmLine('O "referente a"', CRM_LIMITS.reference).pipe(z.string().min(1, 'Diga a que se refere, como "Manutenção" ou "Hospedagem".')),
    method: z.enum(PAYMENT_METHODS).optional(),
    start: crmMonth('Mês de início inválido. Use AAAA-MM.'),
    end: crmOpt(crmMonth('Mês final inválido. Use AAAA-MM.')),
    active: z.boolean().optional(),
  })
  .refine((r) => !r.end || r.end >= r.start, 'O mês final vem antes do início. Confira as datas.')

/** A recurrence draft that passed every check; same key rule as CleanCustomerDraft. */
export interface CleanRecurrenceDraft {
  id?: string
  customerId: string
  dealId?: string
  amountCents: number
  day: number
  reference: string
  method?: PaymentMethod
  start: string
  end?: string
  active?: boolean
}

export function cleanRecurrence(raw: unknown): CleanRecurrenceDraft {
  const d = parseCrm(recurrenceDraftSchema, raw, 'Recorrência inválida. Feche e abra o formulário de novo.')
  const out: CleanRecurrenceDraft = {
    customerId: d.customerId,
    amountCents: d.amountCents,
    day: d.day,
    reference: d.reference,
    start: d.start,
    ...(d.id ? { id: d.id } : {}),
    ...(d.method ? { method: d.method } : {}),
    ...(d.active !== undefined ? { active: d.active } : {}),
  }
  return present(out, d, raw, ['dealId', 'end'])
}

const stageSchema = z.object({
  id: z.string().regex(CRM_ID_RE, 'Etapa inválida. Feche e abra o formulário de novo.'),
  name: crmLine('O nome da etapa', CRM_LIMITS.stageName).pipe(z.string().min(1, 'Dê um nome a cada etapa.')),
  kind: z.enum(['open', 'won', 'lost']),
})
const pipelineSchema = z
  .object({
    id: z.string().regex(CRM_ID_RE, 'Funil inválido. Feche e abra o formulário de novo.'),
    name: crmLine('O nome do funil', CRM_LIMITS.title).pipe(z.string().min(1, 'Dê um nome ao funil.')),
    stages: z.array(stageSchema).min(2, 'O funil precisa de pelo menos duas etapas.').max(CRM_LIMITS.stages, `Até ${CRM_LIMITS.stages} etapas por funil.`),
  })
  .refine((p) => new Set(p.stages.map((s) => s.id)).size === p.stages.length, 'Duas etapas com o mesmo id. Feche e abra o formulário de novo.')
  .refine((p) => p.stages.some((s) => s.kind === 'won'), 'O funil precisa de uma etapa de ganho, como "Fechado".')
  .refine((p) => p.stages.some((s) => s.kind === 'lost'), 'O funil precisa de uma etapa de perda, como "Perdido".')

/** A pipeline from the screen: 2 to 12 stages with unique ids, at least one won and one lost. */
export function cleanPipeline(raw: unknown): Pipeline {
  return parseCrm(pipelineSchema, raw, 'Funil inválido. Feche e abra o formulário de novo.')
}

/** A note on the customer: trimmed, line breaks kept, control characters out. */
export function cleanCrmNote(raw: unknown): string {
  return parseCrm(
    z
      .string()
      .max(CRM_LIMITS.note * 2, crmTooLong('A nota', CRM_LIMITS.note))
      .transform(crmBlockText)
      .pipe(z.string().min(1, 'Escreva a nota antes de salvar.').max(CRM_LIMITS.note, crmTooLong('A nota', CRM_LIMITS.note))),
    raw,
    'Nota inválida.',
  )
}

/** The search box of the CRM. */
export function cleanCrmQuery(raw: unknown): string {
  return parseCrm(z.string().max(CRM_LIMITS.query, 'Busca grande demais. Use menos palavras.'), raw, 'Busca inválida.')
}

export function cleanCsvKind(raw: unknown): CrmCsvKind {
  return parse(z.enum(['customers', 'deals', 'payments']), raw, 'Tipo de exportação inválido.')
}

/** The ids of the rows to export (the screen's filter). */
export function cleanCsvIds(raw: unknown): string[] {
  return parseCrm(z.array(z.string().regex(CRM_ID_RE, 'Item inválido na exportação.')).max(CRM_LIMITS.payments, 'Itens demais para exportar de uma vez.'), raw, 'Lista inválida para exportar.')
}

/** importCustomersCsv's rows: each draft is cleaned on its own (a bad one is skipped, not fatal). */
export function cleanImportRows(raw: unknown): { draft: unknown; onConflict: 'skip' | 'update' }[] {
  const rows = parseCrm(
    z.array(z.object({ draft: z.unknown(), onConflict: z.enum(['skip', 'update']).optional() })).max(CRM_LIMITS.csvRows, `A importação vai até ${CRM_LIMITS.csvRows.toLocaleString('pt-BR')} clientes por vez.`),
    raw,
    'Importação inválida. Escolha o arquivo de novo.',
  )
  return rows.map((r) => ({ draft: r.draft, onConflict: r.onConflict ?? 'skip' }))
}

const autonomySchema = z.enum(['draft', 'approval', 'auto'])
const hhmmCrm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const paymentField = z.string().max(CRM_LIMITS.paymentField).transform(crmLineText)
/** Words of a list (opt-out, alert): trimmed, lower case, no empties or repeats. */
const crmWords = z
  .array(z.string().max(CRM_LIMITS.word * 2))
  .max(CRM_LIMITS.words * 2)
  .transform((list) => [...new Set(list.map((w) => w.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean))])
  .pipe(z.array(z.string().max(CRM_LIMITS.word)).max(CRM_LIMITS.words))
/** A domain allowed in messages ('meusite.com.br'); a pasted link keeps only its host. */
const crmDomain = z
  .string()
  .max(300)
  .transform((s) =>
    s
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/[/?#].*$/, ''),
  )
  .pipe(z.string().regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/))

/** Configurações → CRM, one schema per field: a bad one keeps its current value. */
const crmFields = {
  rehearsal: z.boolean(),
  autonomy: z.object({ service: autonomySchema, billing: autonomySchema, offer: autonomySchema }),
  hours: z.array(z.union([z.null(), z.object({ from: hhmmCrm, to: hhmmCrm }).refine((h) => h.from < h.to)])).length(7),
  holidays: z
    .array(z.string().refine(isDay))
    .max(CRM_LIMITS.holidays)
    .transform((l) => [...new Set(l)].sort()),
  perCustomer: z.object({ day: clampedInt(0, 20), week: clampedInt(0, 100) }).refine((p) => p.day <= p.week),
  offerEveryDays: clampedInt(1, 365),
  globalCap: z.object({ hour: clampedInt(1, 500), day: clampedInt(1, 5000) }).refine((g) => g.hour <= g.day),
  intervalSec: z.object({ min: clampedInt(1, 600), max: clampedInt(1, 600) }).refine((i) => i.min <= i.max),
  dunning: z
    .array(z.number().int().min(-30).max(90))
    .max(10)
    .transform((l) => [...new Set(l)].sort((a, b) => a - b)),
  maxDiscountPct: clampedInt(0, 100),
  payment: z.object({ pixKey: paymentField, pixKeyType: z.enum(['cpf', 'cnpj', 'email', 'phone', 'random', '']), payee: paymentField, bank: paymentField, note: paymentField }),
  allowedLinks: z
    .array(crmDomain)
    .max(CRM_LIMITS.allowedLinks)
    .transform((l) => [...new Set(l)]),
  company: z.string().max(CRM_LIMITS.company).transform(crmLineText),
  signature: z.string().max(CRM_LIMITS.signature).transform(crmBlockText),
  optOutWords: crmWords,
  alertWords: crmWords,
  stopAll: z.boolean(),
  recurrenceLeadDays: clampedInt(0, 60),
} satisfies { [K in keyof CrmSettings]-?: z.ZodType<CrmSettings[K], unknown> }

/**
 * The CRM's rules (from the screen, or crm.json as it loads) laid over `current`, field by field:
 * unknown keys are dropped, a bad value keeps the current one, numbers out of range are clamped.
 * An object field may come in part ({ autonomy: { offer: 'approval' } }).
 */
export function cleanCrmSettings(raw: unknown, current: CrmSettings): CrmSettings {
  const patch = isPlain(raw) ? raw : {}
  const next: CrmSettings = { ...current }
  const put = next as unknown as Record<string, unknown>
  for (const [key, schema] of Object.entries(crmFields)) {
    if (!Object.hasOwn(patch, key)) continue
    const cur = (current as unknown as Record<string, unknown>)[key]
    const value = isPlain(cur) && isPlain(patch[key]) ? { ...cur, ...patch[key] } : patch[key]
    const r = (schema as z.ZodType<unknown, unknown>).safeParse(value)
    if (r.success) put[key] = r.data
  }
  return next
}

/** The patch of saveCrmSettings must be an object; its fields go through cleanCrmSettings. */
export function cleanCrmSettingsPatch(raw: unknown, current: CrmSettings): CrmSettings {
  if (!isPlain(raw)) throw new Error('Configurações inválidas. Feche e abra a tela de novo.')
  return cleanCrmSettings(raw, current)
}

/** Configurações → CRM, the "CRM (prévia)" switch in office.json. */
export function cleanCrmAppSettings(raw: unknown, current: CrmAppSettings): CrmAppSettings {
  const patch = isPlain(raw) ? raw : {}
  return { ...current, ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}) }
}

// ---------- Sala de CRM, fase 2 (WhatsApp) ----------

/** The "Servidor local" box asks only these. */
export function cleanCrmServerAction(raw: unknown): CrmServerAction {
  return parse(z.enum(CRM_SERVER_ACTIONS as [CrmServerAction, ...CrmServerAction[]]), raw, 'Ação inválida para o servidor local.')
}

/** Evolution instance name: what the server accepts in a URL path, never a path of its own. */
export const CRM_INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/**
 * Configurações → CRM → WhatsApp, the shape only: the URL rules (https off this machine, no
 * 127.evil.com, no user:pass@) and the global-key check belong to EvolutionClient (CR-08).
 * The token: missing keeps the stored one, '' clears it.
 */
export function cleanCrmWhatsappDraft(raw: unknown): CrmWhatsappDraft {
  return parseCrm(
    z.object({
      url: z.string().trim().min(1, 'Informe o endereço da Evolution, como http://localhost:8080.').max(CRM_LIMITS.url, 'Endereço grande demais.'),
      instance: z
        .string()
        .trim()
        .regex(CRM_INSTANCE_RE, 'Nome de instância inválido. Use letras, números, ponto, hífen ou sublinhado, como no painel da Evolution.'),
      token: z
        .string()
        .trim()
        .max(CRM_LIMITS.token, 'Esse token é grande demais. Cole o token da instância, não outro texto.')
        .regex(/^[^\s]*$/, 'O token não tem espaços. Copie de novo do painel da Evolution.')
        .optional(),
    }),
    raw,
    'Configuração do WhatsApp inválida. Feche e abra a tela de novo.',
  )
}

/** Message text the player wrote: control and direction characters out, line breaks kept, 1 to 4 000 letters. */
const crmMessageText = z
  .string()
  .max(CRM_LIMITS.messageText * 4 + 64, crmTooLong('A mensagem', CRM_LIMITS.messageText))
  .transform(crmBlockText)
  .pipe(z.string().min(1, 'Escreva a mensagem antes de enviar.').max(CRM_LIMITS.messageText, crmTooLong('A mensagem', CRM_LIMITS.messageText)))

const crmCategory = z.enum(MESSAGE_CATEGORIES as unknown as ['service', 'billing', 'offer'])
/** A conversation item id (ours or WhatsApp's): letters, digits, dash, underscore. */
const crmItemId = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/, 'Essa mensagem não existe mais.')

export function cleanCrmSendInput(raw: unknown): CrmSendInput {
  const r = parseCrm(
    z.object({
      customerId: crmCustomerId,
      category: crmCategory,
      text: crmMessageText,
      replyTo: crmItemId.optional(),
      override: z.boolean().optional(),
    }),
    raw,
    'Mensagem inválida. Feche a conversa e abra de novo.',
  )
  return { customerId: r.customerId, category: r.category, text: r.text, ...(r.replyTo ? { replyTo: r.replyTo } : {}), ...(r.override ? { override: true } : {}) }
}

/** What the player does on a draft card. */
export function cleanDraftAction(raw: unknown): DraftAction {
  return parse(z.enum(['send', 'override', 'discard']), raw, 'Ação inválida no rascunho.')
}

/** The edited text of a draft (optional). */
export function cleanDraftText(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  return parseCrm(crmMessageText, raw, 'Texto inválido no rascunho.')
}

/** A conversation item id from the renderer (page back from it, the draft to act on). */
export function cleanCrmItemId(raw: unknown): string {
  return parseCrm(crmItemId, raw, 'Essa mensagem não existe mais.')
}

/** An optional item id (crmConversation's `before`). */
export function cleanCrmOptItemId(raw: unknown): string | undefined {
  return raw === undefined || raw === null ? undefined : cleanCrmItemId(raw)
}

/** A plain on/off from the renderer. */
export function cleanCrmFlag(raw: unknown): boolean {
  return parse(z.boolean(), raw, 'Valor inválido. Feche e abra a tela de novo.')
}
