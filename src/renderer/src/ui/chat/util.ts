import { BOT_GROUND_FLOOR, type AgentSummary, type Bot, type PermissionRequest } from '@shared/types'
import type { State } from '../../state'
import { cleanError } from '../modals'

// What every part of the Chat screen shares: the error text, floors, the bot's agent and requests.

export type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** The screen's parts reach the office through this. */
export interface ChatCtx {
  /** Where dialogs open: the Chat's own backdrop, so they show over the screen. */
  root: HTMLElement
  state: State
  toast: Toast
}

/**
 * An IPC failure as the player reads it. A handler that is not there yet (an old main process)
 * says what to do instead of "No handler registered".
 */
export function chatError(err: unknown): string {
  const text = cleanError(err)
  if (/No handler registered/i.test(text))
    return 'O Chat dos bots ainda não está ligado nesta versão do app. Atualize o Agent Office e abra o Chat de novo.'
  return text
}

/** "Térreo", the project's name, or the id when the floor is gone. */
export function floorName(state: State, floor: string): string {
  if (floor === BOT_GROUND_FLOOR) return 'Térreo'
  return state.settings.projects.find((p) => p.id === floor)?.name ?? 'Andar removido'
}

/** Every floor a bot can live on: the ground floor and the project floors, in elevator order. */
export function floorChoices(state: State): { id: string; name: string }[] {
  return [{ id: BOT_GROUND_FLOOR, name: 'Térreo' }, ...state.settings.projects.map((p) => ({ id: p.id, name: p.name }))]
}

/** The office agent running the bot now. */
export function botAgent(state: State, bot: Pick<Bot, 'id' | 'agentId'> | undefined): AgentSummary | undefined {
  if (!bot) return undefined
  const byId = bot.agentId ? state.agents.get(bot.agentId) : undefined
  if (byId) return byId
  for (const a of state.agents.values()) if (a.bot === bot.id) return a
  return undefined
}

/** Requests of the bot's agent waiting for the player, oldest first. */
export function botPending(state: State, bot: Pick<Bot, 'id' | 'agentId'> | undefined): PermissionRequest[] {
  const a = botAgent(state, bot)
  if (!a) return []
  return [...state.permissions.values()].filter((p) => p.agentId === a.id).sort((x, y) => x.createdAt - y.createdAt)
}

/** The bot's agent is in the middle of a turn. */
export function agentBusy(a: AgentSummary | undefined): boolean {
  return !!a && (a.status === 'working' || a.status === 'starting')
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches
