import type { CrmTab } from '@shared/types'

/** Evento que abre a Sala de CRM; a tela (ui/crm) escuta em window. */
export const OPEN_CRM_EVENT = 'agent-office:open-crm'

export interface OpenCrmDetail {
  /** Abrir nesta aba. Ausente = a última aba vista. */
  tab?: CrmTab
  /** Abrir a ficha deste cliente. */
  customerId?: string
}

/**
 * Abre a Sala de CRM: a tecla V e o botão "CRM" do topo chamam esta função. Ela só avisa; quem
 * abre a tela é ui/crm, e só com "CRM (prévia)" ligado em Configurações.
 */
export function openCrm(detail: OpenCrmDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenCrmDetail>(OPEN_CRM_EVENT, { detail }))
}
