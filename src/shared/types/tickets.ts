import type { EffortLevel, OfficePermissionMode } from './agents'

// ---------- tickets (kanban) ----------

export type TicketStatus = 'backlog' | 'todo' | 'doing' | 'review' | 'done'
export type TicketType = 'bug' | 'feature' | 'improvement' | 'task'
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical'

/** Who did something on the board. Agents carry their office id while they are around. */
export interface Actor {
  kind: 'player' | 'agent'
  name: string
  id?: string
}

export interface Criterion {
  text: string
  done: boolean
}

export interface TicketComment {
  id: string
  t: number
  author: Actor
  text: string
}

export interface TicketActivity {
  id: string
  t: number
  actor: Actor
  text: string
}

/**
 * A unit of work an agent can pick up on its own: everything it needs is in the
 * ticket (folder, context, acceptance criteria), so delegating is just handing it over.
 */
export interface Ticket {
  id: string
  /** Short human key, e.g. "AO-12". Agents and people refer to tickets by it. */
  key: string
  title: string
  type: TicketType
  priority: TicketPriority
  status: TicketStatus
  /** Markdown: context, where to look, how to reproduce. */
  description: string
  acceptance: Criterion[]
  /** Project folder the agent works in. */
  cwd?: string
  tags: string[]
  /** Story points. */
  estimate?: number
  /** YYYY-MM-DD */
  dueDate?: string
  reporter: Actor
  assignee?: Actor
  /** Position inside its column, lower first. */
  order: number
  createdAt: number
  updatedAt: number
  /** When it reached "Feito"; auto-close counts from here. */
  doneAt?: number
  /** Closed: off the board, kept in the archive (userData/tickets-closed.json). */
  closedAt?: number
  comments: TicketComment[]
  activity: TicketActivity[]
}

export interface TicketDraft {
  title: string
  type?: TicketType
  priority?: TicketPriority
  status?: TicketStatus
  description?: string
  acceptance?: Criterion[]
  /** null clears it. */
  cwd?: string | null
  tags?: string[]
  estimate?: number | null
  dueDate?: string | null
}

export type TicketPatch = Partial<TicketDraft>

/** Who takes a ticket: an office agent already here, or a new one hired for it. */
export type DelegateTarget = { agentId: string } | { hire: { model?: string; effort?: EffortLevel; accounts?: string[]; permissionMode?: OfficePermissionMode; worktree?: boolean } }
