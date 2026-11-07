// Sala de reunião fora do app (RN-08): o título do ícone na barra de menus e o selo do Dock
// durante a gravação. Puro, para testar com `npm test` (docs/prd/sala-de-reuniao.md, "Fora do app").

import type { Meeting, MeetingStatus } from './types/meetings'

/** Ponto vermelho do Dock enquanto a reunião grava (ou está pausada). */
export const RECORDING_DOT = '●'
/** Prefixo do título quando a reunião está pausada. */
export const PAUSED_MARK = '⏸'

/** A reunião ainda captura (ou vai voltar a capturar): o ícone e o ponto ficam visíveis. */
export function isMeetingLive(status: MeetingStatus): boolean {
  return status === 'recording' || status === 'paused'
}

/**
 * Tempo gravado, sem as pausas. `pausedSince` é quando a pausa em curso começou (ela só entra em
 * meeting.pauses ao retomar); sem ele, a pausa em curso conta como gravado.
 */
export function meetingElapsedMs(m: Pick<Meeting, 'startedAt' | 'pauses'>, now: number, pausedSince?: number | null): number {
  const paused = m.pauses.reduce((sum, p) => sum + p.ms, 0)
  const current = pausedSince != null ? Math.max(0, now - pausedSince) : 0
  return Math.max(0, now - m.startedAt - paused - current)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** '0:07', '12:04', '1:02:03' (horas só a partir de uma). */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Título ao lado do ícone: '12:04' gravando, '⏸ 12:04' pausada. */
export function trayTitle(status: MeetingStatus, elapsedMs: number): string {
  const time = formatElapsed(elapsedMs)
  return status === 'paused' ? `${PAUSED_MARK} ${time}` : time
}

/** Dica do ícone (Windows não mostra título na bandeja). */
export function trayTooltip(title: string, status: MeetingStatus, elapsedMs: number): string {
  return `${title} · ${status === 'paused' ? 'pausada' : 'gravando'} · ${formatElapsed(elapsedMs)}`
}

/**
 * Selo do Dock no macOS: o ponto da gravação junto do número de pendências.
 * '' parado e sem pendências, '3' só pendências, '●' só gravando, '● 3' os dois.
 */
export function dockBadge(pending: number, live: boolean): string {
  const count = Number.isFinite(pending) && pending > 0 ? String(Math.floor(pending)) : ''
  if (!live) return count
  return count ? `${RECORDING_DOT} ${count}` : RECORDING_DOT
}

/**
 * Overlay da barra de tarefas do Windows: o disco vermelho leva o número de pendências; gravando
 * sem pendências, leva o ponto. null = sem overlay. `label` usa os glifos de main/badge.ts.
 */
export function taskbarOverlay(pending: number, live: boolean): { label: string; description: string } | null {
  const count = Number.isFinite(pending) && pending > 0 ? Math.floor(pending) : 0
  const pendingText = count === 1 ? '1 pendência no Agent Office' : `${count} pendências no Agent Office`
  if (!count && !live) return null
  const label = count ? (count > 9 ? '9+' : String(count)) : RECORDING_DOT
  const description = live ? (count ? `Reunião gravando · ${pendingText}` : 'Reunião gravando') : pendingText
  return { label, description }
}
