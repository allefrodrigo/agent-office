import type { MeetingLiveState } from '@shared/meeting-map'

export type { MeetingLiveState } from '@shared/meeting-map'

/** A reunião gravando agora, como o mapa a vê; `pausedAt` congela o cronômetro da TV. */
export interface MeetingLive extends MeetingLiveState {
  /** Date.now() de quando a pausa começou (só com `paused`). */
  pausedAt?: number
}

type Listener = (live: MeetingLive | null) => void

let current: MeetingLive | null = null
const listeners = new Set<Listener>()

const same = (a: MeetingLive | null, b: MeetingLive | null): boolean =>
  a && b ? a.floor === b.floor && a.startedAt === b.startedAt && !!a.paused === !!b.paused : a === b

/**
 * Estado da gravação para o mapa (RN-17). A tela da reunião chama a cada meeting:upsert:
 * o estado com a reunião gravando ou em pausa, null quando ela encerra. Repetir o mesmo
 * estado não avisa ninguém.
 */
export function setMeetingLive(state: MeetingLiveState | null): void {
  const next: MeetingLive | null = state ? { floor: state.floor, startedAt: state.startedAt, paused: !!state.paused } : null
  if (same(current, next)) return
  if (next?.paused) next.pausedAt = Date.now()
  current = next
  for (const fn of listeners) fn(current)
}

/** A reunião gravando agora, ou null. */
export function meetingLive(): MeetingLive | null {
  return current
}

/** Avisa a cada mudança (começo, pausa, retomada, fim). Devolve a função que para de avisar. */
export function onMeetingLive(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Tempo da reunião em ms: até agora, ou até a pausa. */
export function meetingElapsed(live: MeetingLive, now = Date.now()): number {
  return (live.paused && live.pausedAt ? live.pausedAt : now) - live.startedAt
}
