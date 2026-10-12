import type { AgentTemplate, Ticket } from './types'

/** Limits checked on both sides: the form caps the fields, the main process refuses the rest. */
export const TEMPLATE_LIMITS = { name: 40, instruction: 8000, count: 200 }

/** Variables the brief may carry. */
export const TEMPLATE_VARS = { folder: '{pasta}', ticket: '{ticket}' }

/** Global templates plus the ones of this floor (null = ground floor), in saved order. */
export function templatesFor(templates: AgentTemplate[] | undefined, floorId: string | null | undefined): AgentTemplate[] {
  return (templates ?? []).filter((t) => !t.floor || t.floor === floorId)
}

export function usesTicket(instruction: string): boolean {
  return instruction.includes(TEMPLATE_VARS.ticket)
}

/** How {ticket} reads in the brief: the key, so the agent can fetch it with ticket_get, plus the title. */
export function ticketRef(t: Pick<Ticket, 'key' | 'title'>): string {
  return `${t.key} ("${t.title}")`
}

/** The brief with its variables filled in. */
export function renderInstruction(instruction: string, vars: { folder: string; ticket?: string }): string {
  return instruction.split(TEMPLATE_VARS.folder).join(vars.folder).split(TEMPLATE_VARS.ticket).join(vars.ticket ?? '').trim()
}
