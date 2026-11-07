/** Evento que abre a tela da Sala de reunião; a tela (ui/meetings) escuta em window. */
export const OPEN_MEETING_EVENT = 'agent-office:open-meeting'

export interface OpenMeetingDetail {
  /** ProjectFloor.id ou 'terreo'. */
  floor: string
  /** Abrir já nesta reunião (o link do quadro e as citações). Ausente = a sala do andar. */
  meetingId?: string
  /** Segment.id do trecho a mostrar na transcrição; só com meetingId. */
  segment?: number
}

/**
 * Abre a Sala de reunião de um andar: a etiqueta do mapa, a tecla M e o botão "Reunião" do
 * HUD chamam esta função. Ela só avisa; quem abre a tela é ui/meetings. `at` leva a uma
 * reunião e a um trecho (o link "Kickoff do checkout, 14:52" do quadro); a tela que não
 * souber ir até lá abre a sala do andar.
 */
export function openMeetingRoom(floor: string, at?: { meetingId: string; segment?: number }): void {
  const detail: OpenMeetingDetail = { floor }
  if (at) {
    detail.meetingId = at.meetingId
    if (at.segment !== undefined) detail.segment = at.segment
  }
  window.dispatchEvent(new CustomEvent<OpenMeetingDetail>(OPEN_MEETING_EVENT, { detail }))
}
