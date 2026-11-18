import type { ConversationItem, ConversationSummary, ConversationWaiting, CrmAuthor, Customer, DeliveryStatus, Draft } from './types'

// A aba Conversas (CR-14) sem DOM: a ordem da lista, o que o fio mostra, os rótulos e os links
// do texto do cliente. A tela desenha tudo como texto (textContent), nunca como HTML.

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** "Abertas": a conversation with something new or with a message in the last 3 days. */
const OPEN_FOR = 3 * DAY

export const WAITING_LABEL: Record<ConversationWaiting, string> = {
  draft: 'Rascunho pronto',
  handoff: 'Pediu uma pessoa',
  blocked: 'Envio barrado',
  'new-contact': 'Novo contato',
}

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  queued: 'na fila',
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  failed: 'falhou',
}

export type ConversationGroup = 'waiting' | 'open' | 'rest'
export const GROUP_LABEL: Record<ConversationGroup, string> = { waiting: 'Esperando você', open: 'Abertas', rest: 'Outras' }

export interface ConversationRow {
  summary: ConversationSummary
  /** The customer's name, or "Cliente apagado" when the row outlived the customer. */
  name: string
  company: string
  group: ConversationGroup
}

/**
 * The Conversas list: "Esperando você" first, then the open ones, then the rest; newest first in
 * each. A row whose customer is gone is left out (the main removes the file with the customer).
 */
export function conversationRows(
  summaries: readonly ConversationSummary[],
  customers: readonly Pick<Customer, 'id' | 'name' | 'company'>[],
  now: number,
): ConversationRow[] {
  const byId = new Map(customers.map((c) => [c.id, c]))
  const order: Record<ConversationGroup, number> = { waiting: 0, open: 1, rest: 2 }
  const rows: ConversationRow[] = []
  for (const s of summaries) {
    const c = byId.get(s.customerId)
    if (!c) continue
    const group: ConversationGroup = s.waiting ? 'waiting' : s.unread > 0 || now - s.t < OPEN_FOR ? 'open' : 'rest'
    rows.push({ summary: s, name: c.name, company: c.company ?? '', group })
  }
  return rows.sort((a, b) => order[a.group] - order[b.group] || b.summary.t - a.summary.t)
}

/** How many conversations wait for the player (the number on the "CRM" button adds these). */
export function conversationsWaiting(summaries: readonly ConversationSummary[]): number {
  return summaries.reduce((n, s) => n + (s.waiting ? 1 : 0), 0)
}

/** A summary in place in the list (same customer = replace). */
export function putSummary(list: readonly ConversationSummary[], s: ConversationSummary): ConversationSummary[] {
  const out = list.filter((x) => x.customerId !== s.customerId)
  out.push(s)
  return out
}

/** An item in place in the thread (same id = replace), kept in time order. */
export function putItem(items: readonly ConversationItem[], item: ConversationItem): ConversationItem[] {
  const i = items.findIndex((x) => x.id === item.id)
  if (i >= 0) {
    const out = items.slice()
    out[i] = item
    return out
  }
  const out = items.concat(item)
  // late items (a sync) go to their place; the common case (newest) stays at the end
  if (items.length && item.t < items[items.length - 1].t) out.sort((a, b) => a.t - b.t)
  return out
}

/** Draft states that still show a card with buttons. */
const CARD = new Set<Draft['status']>(['pending', 'held', 'blocked'])

/** What the thread shows: decided drafts give way to their message; discarded ones leave. */
export function threadItems(items: readonly ConversationItem[]): ConversationItem[] {
  const outOf = new Set<string>()
  for (const x of items) if (x.kind === 'out' && x.draftId) outOf.add(x.draftId)
  return items.filter((x) => {
    if (x.kind !== 'draft') return true
    const s = x.draft.status
    if (s === 'discarded' || s === 'sent') return false
    // scheduled: the card says when, until the message itself is on its way
    return CARD.has(s) || (s === 'scheduled' && !outOf.has(x.draft.id))
  })
}

/** The draft card still takes Enviar, Editar and Descartar. */
export function draftOpen(d: Pick<Draft, 'status'>): boolean {
  return CARD.has(d.status)
}

/** "Hoje", "Ontem", or "18/11/2026": the day line between messages. */
export function dayLabel(t: number, now: number): string {
  const day = (x: number) => {
    const d = new Date(x)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const diff = Math.round((day(now) - day(t)) / DAY)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return new Date(t).toLocaleDateString('pt-BR')
}

/** "09:02" today, "ontem", or "18/11": the time on a list row. */
export function rowTime(t: number, now: number): string {
  const label = dayLabel(t, now)
  if (label === 'Hoje') return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (label === 'Ontem') return 'ontem'
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/** Who sent an outbound message: "você", the bot's name, "o app" or "pelo celular". */
export function authorLabel(by: CrmAuthor | { kind: 'phone' }, botName: (id: string) => string | undefined): string {
  if (by.kind === 'player') return 'você'
  if (by.kind === 'phone') return 'pelo celular'
  if (by.kind === 'bot') return botName(by.botId) ?? 'bot removido'
  return 'o app'
}

/** The line under the draft card: the gate's reason, or what the state says. */
export function draftNote(d: Draft): string {
  if (d.decision?.rehearsal) return `Modo ensaio: teria sido enviada. ${d.decision.reason}`
  if (d.status === 'scheduled' && d.decision?.at)
    return `Agendada para ${new Date(d.decision.at).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`
  if (d.decision) return d.decision.reason
  return 'Ainda não passou pelo portão.'
}

// ---------- links no texto do cliente ----------

export type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; url: string; host: string }

/**
 * Web links (with http(s):// or starting with www.) cut out of a text, for the screen to draw as
 * buttons that ask before opening and show the real domain. Everything else stays text. Only
 * http and https: no other scheme ever becomes a link.
 */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  const re = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
  let at = 0
  for (const m of text.matchAll(re)) {
    // a sentence's final punctuation is not part of the link
    const raw = m[0].replace(/[.,;:!?)\]}]+$/, '')
    const start = m.index ?? 0
    const url = /^www\./i.test(raw) ? `https://${raw}` : raw
    let host = ''
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname
    } catch {
      host = ''
    }
    if (!host) continue
    if (start > at) parts.push({ kind: 'text', text: text.slice(at, start) })
    parts.push({ kind: 'link', text: raw, url, host })
    at = start + raw.length
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) })
  return parts
}
