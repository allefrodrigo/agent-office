import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { ATTACH_LIMITS } from '@shared/attachments'
import { HAIR_STYLES } from '@shared/describe'
import { floorNameFor, MAX_PROJECT_FLOORS } from '@shared/projects'
import { STATUSES } from '@shared/tickets'
import { EFFORT_LEVELS } from '@shared/types'
import type {
  Account,
  AgentBrain,
  AttachmentInput,
  DelegateTarget,
  EffortLevel,
  HireRequest,
  LedgerQuery,
  OfficePermissionMode,
  PermissionDecision,
  ProjectFloor,
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

/** Agent, ticket, request and account ids: never empty, never huge. */
export const idSchema = z.string().min(1).max(200)
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
    const id = typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) && !out.some((o) => o.id === p.id) ? p.id : `p-${randomUUID().slice(0, 8)}`
    const name = (typeof p.name === 'string' ? p.name.trim().slice(0, 32) : '') || floorNameFor(cwd)
    // A floor's accounts change only through setAccountPool: the settings form may hold an old copy.
    const accounts = previous.find((o) => o.id === id)?.accounts
    out.push({ id, name, cwd, ...(accounts?.length ? { accounts } : {}), ...cleanBrand(p) })
    if (out.length === MAX_PROJECT_FLOORS) break
  }
  return out
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
  }
}

/** Who takes a ticket: an agent already here, or a new hire that never runs with "bypass". */
export function cleanDelegateTarget(raw: unknown, accounts: Account[]): DelegateTarget {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if ('agentId' in r) return { agentId: parse(idSchema, r.agentId, 'Agente inválido.') }
  const hire = (r.hire && typeof r.hire === 'object' ? r.hire : {}) as Record<string, unknown>
  return {
    hire: {
      ...cleanBrain(hire, accounts),
      permissionMode: DELEGATE_MODES.includes(hire.permissionMode as never) ? (hire.permissionMode as OfficePermissionMode) : undefined,
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
  ticketAutoCloseDays: z.coerce.number().int().min(0).max(365),
  maxSubagents: z.coerce.number().int().min(0).max(100),
  agentBudgetUsd: z.coerce
    .number()
    .finite()
    .min(0)
    .max(100_000)
    .transform((n) => Math.round(n * 100) / 100),
  updateChannel: z.enum(['stable', 'beta']),
} satisfies { [K in keyof Settings]?: z.ZodType<unknown> }

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
  return next
}
