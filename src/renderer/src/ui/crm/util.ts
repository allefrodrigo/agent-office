import { localDate } from '@shared/crm'
import type { ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { cleanError } from '../modals'

// O que as partes da Sala de CRM dividem: o texto de erro, os andares e o contexto da tela.

export type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** The screen's parts reach the office through this. */
export interface CrmCtx {
  /** Where dialogs open: the CRM's own backdrop, so they show over the screen. */
  root: HTMLElement
  state: State
  toast: Toast
  /** Closes the CRM and opens the board on that ticket. */
  openTicket(id: string): void
  /** Opens the customer card. */
  openCustomer(id: string): void
}

/**
 * An IPC failure as the player reads it. A handler that is not there yet (an old main process)
 * says what to do instead of "No handler registered".
 */
export function crmError(err: unknown): string {
  const text = cleanError(err)
  if (/No handler registered/i.test(text))
    return 'O CRM ainda não está ligado nesta versão do app. Atualize o Agent Office e abra o CRM de novo.'
  return text
}

/** The project's name; '' without a floor, "Andar removido" when the floor is gone. */
export function floorName(state: State, floor: string | undefined): string {
  if (!floor) return ''
  return state.settings.projects.find((p) => p.id === floor)?.name ?? 'Andar removido'
}

export function floorProject(state: State, floor: string | undefined): ProjectFloor | undefined {
  return floor ? state.settings.projects.find((p) => p.id === floor) : undefined
}

/** Today, 'AAAA-MM-DD' local. */
export const todayIso = (): string => localDate(Date.now())
