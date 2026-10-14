import { countdown } from './schedule'
import type { Routine, RoutineRun } from './types'

/** The totem's LED: green all fine, yellow one waits for you, red the last run of one failed, grey none. */
export type RoutineLed = 'ok' | 'wait' | 'fail' | 'none'

/** The newest run that actually ran (not missed or skipped) and has ended. */
export function lastFinished(r: Routine): RoutineRun | undefined {
  return r.history.find((x) => x.status === 'ok' || x.status === 'failed')
}

/**
 * Yellow wins over red: a run waiting for you is stuck until you answer, a failure is
 * already over. Red stays until that routine runs fine again.
 */
export function routinesLed(list: Routine[]): RoutineLed {
  if (!list.length) return 'none'
  if (list.some((r) => r.history[0]?.status === 'waiting')) return 'wait'
  if (list.some((r) => lastFinished(r)?.status === 'failed')) return 'fail'
  return 'ok'
}

/** The routine that runs next, among the active ones. */
export function nextRoutine(list: Routine[]): Routine | undefined {
  let best: Routine | undefined
  for (const r of list) if (r.enabled && r.nextAt !== null && (!best || r.nextAt < best.nextAt!)) best = r
  return best
}

export interface TotemView {
  /** Routine name, or what is going on when none is next. */
  title: string
  /** "em 2h14" */
  detail: string
  led: RoutineLed
  /** What the pixel screen draws: a short countdown ("2H14"), or a symbol for the state. */
  screen: { kind: 'count'; text: string } | { kind: 'wait' | 'run' | 'add' | 'idle' }
  /** "Relatório diário · em 2h14", for the tag's balloon. */
  line: string
}

/** "2H14", "14M", "40S", "3D4H": the countdown in as few glyphs as the totem screen fits. */
export function shortCountdown(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((t - now) / 1000))
  if (s < 60) return `${s}S`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}M`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}H${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}D${h % 24 ? `${h % 24}H` : ''}`
}

/** What the totem screen shows now. */
export function totemView(list: Routine[], now = Date.now()): TotemView {
  const led = routinesLed(list)
  const waiting = list.find((r) => r.history[0]?.status === 'waiting')
  const running = list.find((r) => r.history[0]?.status === 'running')
  const next = nextRoutine(list)
  let title: string
  let detail: string
  let screen: TotemView['screen']
  if (!list.length) [title, detail, screen] = ['Nenhuma rotina', 'clique para criar', { kind: 'add' }]
  else if (waiting) [title, detail, screen] = [waiting.name, 'esperando você', { kind: 'wait' }]
  else if (running) [title, detail, screen] = [running.name, 'rodando agora', { kind: 'run' }]
  else if (next) [title, detail, screen] = [next.name, countdown(next.nextAt!, now), { kind: 'count', text: shortCountdown(next.nextAt!, now) }]
  else [title, detail, screen] = [list.every((r) => !r.enabled) ? 'Tudo pausado' : 'Sem próxima execução', '', { kind: 'idle' }]
  return { title, detail, led, screen, line: detail ? `${title} · ${detail}` : title }
}
