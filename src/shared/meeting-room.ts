// A tela da Sala de reunião (RN-07): as partes puras. Agrupar a lista, os padrões de "Nova
// reunião", o aviso de consentimento diário, o tempo gravado e a transcrição em ordem.

import { normalizeText } from './meetings'
import type { Meeting, MeetingStatus, Segment, Track } from './types/meetings'

/** Grupos da lista da esquerda, na ordem em que aparecem. */
export type MeetingGroup = 'Hoje' | 'Semana' | 'Antes'

const DAY_MS = 86_400_000

/** Meia-noite (hora local) do dia de `t`. */
export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Hoje: desde a meia-noite; Semana: os 6 dias antes de hoje; Antes: o resto. */
export function meetingGroup(startedAt: number, now = Date.now()): MeetingGroup {
  const today = startOfDay(now)
  if (startedAt >= today) return 'Hoje'
  if (startedAt >= today - 6 * DAY_MS) return 'Semana'
  return 'Antes'
}

/** A busca da lista: título e participantes, sem acento nem caixa. Vazia = todas. */
export function matchesSearch(m: Pick<Meeting, 'title' | 'attendees'>, query: string): boolean {
  const q = normalizeText(query)
  if (!q) return true
  const hay = normalizeText([m.title, ...m.attendees].join(' '))
  return q.split(' ').every((w) => hay.includes(w))
}

/** As reuniões filtradas pela busca, por grupo (só os grupos com reunião), as mais novas primeiro. */
export function groupMeetings<T extends Pick<Meeting, 'title' | 'attendees' | 'startedAt'>>(
  list: readonly T[],
  query = '',
  now = Date.now(),
): { group: MeetingGroup; items: T[] }[] {
  const order: MeetingGroup[] = ['Hoje', 'Semana', 'Antes']
  const sorted = list.filter((m) => matchesSearch(m, query)).sort((a, b) => b.startedAt - a.startedAt)
  return order
    .map((group) => ({ group, items: sorted.filter((m) => meetingGroup(m.startedAt, now) === group) }))
    .filter((g) => g.items.length > 0)
}

const two = (n: number) => String(n).padStart(2, '0')

/** "14:30" na hora local. */
export function clockTime(t: number): string {
  const d = new Date(t)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/** Título padrão de uma reunião nova: "Reunião 14:30". */
export function defaultTitle(now = Date.now()): string {
  return `Reunião ${clockTime(now)}`
}

/** O modelo da reunião nova: o da última reunião do andar, se ainda existe; senão o Geral. */
export function lastTemplate(
  meetings: readonly Pick<Meeting, 'template' | 'startedAt'>[],
  available: readonly string[],
  fallback = 'geral',
): string {
  const last = [...meetings].sort((a, b) => b.startedAt - a.startedAt).find((m) => available.includes(m.template))
  return last?.template ?? (available.includes(fallback) ? fallback : (available[0] ?? fallback))
}

/** Participantes digitados com vírgula ou ponto e vírgula, sem repetir nem vazios. */
export function parseAttendees(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[,;\n]/)) {
    const name = raw.replace(/\s+/g, ' ').trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** localStorage: o dia (AAAA-MM-DD) em que o aviso de consentimento apareceu por último. */
export const CONSENT_KEY = 'agent-office:meeting-consent'

/** "2026-11-07" na hora local. */
export function dayKey(t = Date.now()): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** O aviso aparece na primeira gravação e depois uma vez por dia. */
export function consentDue(lastShown: string | null | undefined, now = Date.now()): boolean {
  return lastShown !== dayKey(now)
}

/** O texto que "Copiar aviso" põe na área de transferência, para colar no chat da chamada. */
export const CONSENT_TEXT =
  'Aviso: estou transcrevendo esta reunião para as minhas anotações. A transcrição fica só no meu computador. Se preferir que eu não grave, me avise.'

/** Reunião com a captura em andamento (gravando ou em pausa). */
export function isLive(status: MeetingStatus): boolean {
  return status === 'recording' || status === 'paused'
}

/** Reunião encerrada com ata ou a caminho dela: o centro mostra a ata. */
export function showsAta(status: MeetingStatus): boolean {
  return status === 'ready' || status === 'enhancing'
}

/**
 * Tempo gravado, sem as pausas, em ms. `pausedSince` é quando a pausa em curso começou
 * (Date.now()); a pausa em curso ainda não entrou em `pauses`.
 */
export function recordedMs(
  m: Pick<Meeting, 'startedAt' | 'pauses' | 'endedAt' | 'durationMs'>,
  now = Date.now(),
  pausedSince?: number | null,
): number {
  if (m.durationMs !== undefined) return m.durationMs
  const end = m.endedAt ?? now
  const paused = m.pauses.reduce((n, p) => n + p.ms, 0) + (pausedSince ? Math.max(0, end - pausedSince) : 0)
  return Math.max(0, end - m.startedAt - paused)
}

/** Nome da faixa na transcrição. */
export function trackLabel(track: Track): string {
  return track === 'eu' ? 'Você' : track === 'outros' ? 'Outros' : 'Sala'
}

/** Junta segmentos novos aos que já estão na tela: sem repetir id, em ordem de início. */
export function mergeSegments(current: readonly Segment[], incoming: readonly Segment[]): Segment[] {
  const byId = new Map<number, Segment>()
  for (const s of current) byId.set(s.id, s)
  for (const s of incoming) byId.set(s.id, s)
  return [...byId.values()].sort((a, b) => a.start - b.start || a.id - b.id)
}

/** Atraso da transcrição a partir do qual a tela avisa. */
export const DELAY_SHOW_MS = 20_000

/** "atrasada 40 s" quando a fila do whisper passa do limite; null abaixo dele. */
export function delayLabel(delayMs: number): string | null {
  if (!Number.isFinite(delayMs) || delayMs < DELAY_SHOW_MS) return null
  return `atrasada ${Math.round(delayMs / 1000)} s`
}

/** "Terminando a transcrição… 12 s" (sem o número quando a fila não diz quanto falta). */
export function finishingLabel(delayMs: number, label = 'Terminando a transcrição…'): string {
  const s = Math.ceil(Math.max(0, delayMs) / 1000)
  return s > 0 ? `${label} ${s} s` : label
}

/** Duração para a lista: "45 min", "1 h 05", "40 s". */
export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${two(min % 60)}`
}

/** Estado da reunião em palavras, para a lista e o leitor de tela. */
export function statusLabel(status: MeetingStatus): string {
  switch (status) {
    case 'recording':
      return 'Gravando'
    case 'paused':
      return 'Em pausa'
    case 'finishing':
      return 'Terminando a transcrição'
    case 'enhancing':
      return 'Escrevendo a ata'
    case 'ready':
      return 'Pronta'
    case 'interrupted':
      return 'Interrompida'
    case 'error':
      return 'Com erro'
  }
}
