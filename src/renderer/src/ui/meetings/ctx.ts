import type { MeetingDetail } from '@shared/types/meetings'

// O contrato entre a tela da sala (index.ts) e as partes montadas nela (ata.ts, chat.ts).

/** O que a tela da sala entrega a cada parte montada para a reunião aberta. */
export interface MeetingViewCtx {
  /** ProjectFloor.id ou 'terreo'. */
  floor: string
  /** Nome do andar para mostrar ("Térreo", "Checkout"). */
  floorName: string
  /** A reunião aberta. */
  meetingId: string
  /** Relê a reunião e a lista; as partes recebem o detalhe novo pelo `update`. */
  refresh(): Promise<void>
  /** Abre o painel na aba Transcrição, rola até o primeiro trecho e destaca os trechos. */
  highlightSegments(ids: number[]): void
  /** Abre outra reunião do andar (ou a mesma) e, com `segment`, destaca o trecho. */
  openMeetingAt(meetingId: string, segment?: number): void
  /** Aviso rápido no canto da tela. */
  toast(msg: string): void
}

/** Uma parte montada pela tela: recebe cada detalhe novo e se desmonta ao trocar de reunião. */
export interface MeetingPart {
  update(detail: MeetingDetail): void
  destroy(): void
}
