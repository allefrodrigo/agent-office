// A Sala de reunião no mapa (RN-17): o assento do jogador, o "Não perturbe" e o resumo ao encerrar.

/** Reunião gravando (ou em pausa) num andar: o que o mapa precisa saber. */
export interface MeetingLiveState {
  /** ProjectFloor.id ou 'terreo'. */
  floor: string
  startedAt: number
  paused?: boolean
}

/** Andar do térreo nas reuniões. */
export const GROUND_FLOOR_ID = 'terreo'

/**
 * O assento livre da mesa: o primeiro da lista (a lista vem do mais perto da porta para o
 * mais longe) sem ninguém a menos de `radius` dele. -1 quando todos estão ocupados.
 */
export function pickSeat(seats: readonly { x: number; z: number }[], occupied: readonly { x: number; z: number }[], radius = 0.45): number {
  return seats.findIndex((s) => !occupied.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < radius))
}

/**
 * "Não perturbe" valendo: há reunião (gravando ou em pausa) e o ajuste está ligado.
 * Sem o ajuste salvo, vale o padrão da spec: ligado.
 */
export function doNotDisturb(live: MeetingLiveState | null, meetings: { doNotDisturb?: boolean } | undefined): boolean {
  return !!live && meetings?.doNotDisturb !== false
}

/** O resumo ao encerrar: "1 pedido esperando você", "3 pedidos esperando você"; null sem pedidos. */
export function waitingSummary(n: number): string | null {
  if (!Number.isFinite(n) || n < 1) return null
  const k = Math.floor(n)
  return k === 1 ? '1 pedido esperando você' : `${k} pedidos esperando você`
}

/** O cronômetro da TV: "07:05" abaixo de uma hora, "1:02:09" depois; negativo vira zero. */
export function meetingClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}
