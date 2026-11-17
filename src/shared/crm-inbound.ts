import { z } from 'zod'
import { normalizePhone } from './crm'
import { CRM_LIMITS, type ConversationItem, type CrmConnection, type DeliveryStatus } from './types'

// O que chega da Evolution (CR-09), em funções puras: o quadro do socket.io, o evento ou o
// registro do findMessages, e o item da conversa que sai dele. Nada aqui fala com a rede ou com
// o disco; src/main/crm/events.ts junta as peças. Formatos lidos do código-fonte da Evolution
// 2.3.7 (whatsapp.baileys.service.ts: prepareMessage, messages.upsert, messages.update) e do
// ADR 0015.

// ---------- texto ----------

/** Marks that flip or fake the text direction: "Maria \u202Eodagap" would read "Maria pagado". */
const BIDI_MARKS = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g

/** Cuts at `max` UTF-16 units without leaving half an emoji (a lone high surrogate) at the end. */
export function cutText(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

/**
 * Message text as it is stored and shown: line breaks and tabs stay; other control characters
 * and direction marks go; at most CRM_LIMITS.messageText characters. Plain text, never HTML.
 */
export function cleanWaText(s: string): string {
  const text = s
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/[^\P{Cc}\t\n]/gu, '')
    .replace(BIDI_MARKS, '')
    .trim()
  return cutText(text, CRM_LIMITS.messageText)
}

/** One line (a file name, a profile name): no control characters, no direction marks, no breaks. */
export function cleanWaLine(s: string, max: number): string {
  return cutText(
    s
      .replace(/\s+/g, ' ')
      .replace(/\p{Cc}/gu, '')
      .replace(BIDI_MARKS, '')
      .trim(),
    max,
  )
}

// ---------- JID (o endereço do WhatsApp) ----------

/**
 * user = a person (…@s.whatsapp.net); lid = WhatsApp's hidden id, no phone in it; the rest are
 * never a customer: group (@g.us), status (status@broadcast), broadcast lists, newsletter (channels).
 */
export type JidKind = 'user' | 'lid' | 'group' | 'status' | 'broadcast' | 'newsletter' | 'other'

export function jidKind(jid: string): JidKind {
  const j = jid.trim().toLowerCase()
  if (j === 'status@broadcast') return 'status'
  if (j.endsWith('@g.us')) return 'group'
  if (j.endsWith('@broadcast')) return 'broadcast'
  if (j.endsWith('@newsletter')) return 'newsletter'
  if (j.endsWith('@lid')) return 'lid'
  if (/^\d{6,15}(:\d{1,3})?@(s\.whatsapp\.net|c\.us)$/.test(j)) return 'user'
  return 'other'
}

/**
 * The phone of a person's JID, as the CRM keeps phones ('5531988887777'): digits with the
 * country code. A Brazilian mobile that WhatsApp still writes without the 9th digit gets it, so
 * it matches the customer's phone. Null for anything that is not a person.
 */
export function jidPhone(jid: string | null | undefined): string | null {
  if (!jid || jidKind(jid) !== 'user') return null
  const digits = jid.split('@')[0].split(':')[0]
  return normalizePhone(`+${digits}`)
}

// ---------- mensagem (messages.upsert, send.message e os registros do findMessages) ----------

/** WhatsApp's message id: letters and digits in practice ('3EB0…', 'BAE5…'). */
export const WA_ID_RE = /^[A-Za-z0-9_-]{4,100}$/

/** The conversation item id of a WhatsApp message: the same message always lands on the same item. */
export const waItemId = (waId: string): string => `wa-${waId}`

export type WaMedia = NonNullable<Extract<ConversationItem, { kind: 'in' }>['media']>

/** A message, after reading and cleaning. Customer text: data, never an order. */
export interface WaMessage {
  waId: string
  /** The other side's phone (the customer), digits with country code. */
  phone: string
  /** Sent from this WhatsApp number (by the app or by the player's phone). */
  fromMe: boolean
  /** When it was sent (ms), by the sender's clock, never in the future. */
  t: number
  text: string
  media?: WaMedia
  /** The WhatsApp profile name, cleaned (only on messages from the customer). */
  pushName?: string
}

/** Why a message was left out. */
export type WaSkip = 'invalid' | 'group' | 'status' | 'broadcast' | 'newsletter' | 'lid' | 'not-message'

const jidField = z.string().max(200)
const optJid = jidField.nullable().optional().catch(undefined)

const keySchema = z.object({
  id: z.string().max(200),
  remoteJid: jidField,
  fromMe: z.boolean().nullable().optional(),
  // Evolution 2.3.7 swaps a @lid remoteJid for remoteJidAlt before the event; the stored record keeps both.
  remoteJidAlt: optJid,
  senderPn: optJid,
})

/** Seconds since 1970 (Baileys), as a number or a numeric string. */
const tsSchema = z.union([z.number(), z.string().regex(/^\d{1,13}$/).transform(Number)]).optional().catch(undefined)

const recordSchema = z.object({
  key: keySchema,
  pushName: z.string().max(1_000).nullable().optional().catch(undefined),
  message: z.record(z.string(), z.unknown()).nullable().optional(),
  messageTimestamp: tsSchema,
})

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Wrappers that carry the real message inside (disappearing, view once, edited caption). */
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage']

/** Not a message of the conversation: reactions, edits, deletions, poll votes, key exchange. */
const NOT_MESSAGE = new Set([
  'protocolMessage',
  'reactionMessage',
  'pollUpdateMessage',
  'editedMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'keepInChatMessage',
  'pinInChatMessage',
  'encReactionMessage',
  'encEventResponseMessage',
])

function unwrap(message: Record<string, unknown>): Record<string, unknown> {
  let m = message
  for (let depth = 0; depth < 3; depth++) {
    const key = WRAPPERS.find((k) => obj(obj(m[k])?.message))
    if (!key) break
    m = obj(obj(m[key])?.message) as Record<string, unknown>
  }
  return m
}

/** Text and media of the WhatsApp message object; null when it is not a message of the conversation. */
export function waContent(message: Record<string, unknown> | null | undefined): { text: string; media?: WaMedia } | null {
  if (!message) return null
  const m = unwrap(message)
  const conversation = str(m.conversation) ?? str(obj(m.extendedTextMessage)?.text)
  if (conversation !== undefined) return { text: cleanWaText(conversation) }
  const caption = (k: string) => cleanWaText(str(obj(m[k])?.caption) ?? '')
  if (obj(m.imageMessage)) return { text: caption('imageMessage'), media: { type: 'image' } }
  if (obj(m.videoMessage)) return { text: caption('videoMessage'), media: { type: 'video' } }
  if (obj(m.ptvMessage)) return { text: '', media: { type: 'video' } }
  if (obj(m.audioMessage)) return { text: '', media: { type: 'audio' } }
  if (obj(m.documentMessage)) {
    const name = cleanWaLine(str(obj(m.documentMessage)?.fileName) ?? '', 120)
    return { text: caption('documentMessage'), media: { type: 'document', ...(name ? { name } : {}) } }
  }
  // Answers to buttons and lists carry the option the customer tapped as text.
  const tapped =
    str(obj(m.buttonsResponseMessage)?.selectedDisplayText) ??
    str(obj(m.templateButtonReplyMessage)?.selectedDisplayText) ??
    str(obj(m.listResponseMessage)?.title)
  if (tapped !== undefined) return { text: cleanWaText(tapped) }
  const keys = Object.keys(m).filter((k) => !NOT_MESSAGE.has(k) && obj(m[k]) !== undefined)
  if (!keys.length) return null
  // Sticker, contact, location, poll…: shown as "other media"; the app never opens it.
  return { text: '', media: { type: 'other' } }
}

/** The phone side of a message key: remoteJid, or its phone twin when remoteJid is a @lid. */
function keyPhoneJid(key: z.infer<typeof keySchema>): { jid: string; kind: JidKind } {
  const kind = jidKind(key.remoteJid)
  if (kind !== 'lid') return { jid: key.remoteJid, kind }
  for (const alt of [key.remoteJidAlt, key.senderPn]) if (alt && jidKind(alt) === 'user') return { jid: alt, kind: 'user' }
  return { jid: key.remoteJid, kind }
}

/**
 * A message from a messages.upsert or send.message event (`data`), or a findMessages record.
 * Leaves out groups, status, broadcast lists, channels, @lid without a phone and what is not a
 * message (reaction, edit, deletion).
 */
export function readWaMessage(raw: unknown, now: number): { ok: true; message: WaMessage } | { ok: false; skip: WaSkip } {
  const r = recordSchema.safeParse(raw)
  if (!r.success || !WA_ID_RE.test(r.data.key.id)) return { ok: false, skip: 'invalid' }
  const { key } = r.data
  const side = keyPhoneJid(key)
  if (side.kind === 'group' || side.kind === 'status' || side.kind === 'broadcast' || side.kind === 'newsletter') return { ok: false, skip: side.kind }
  if (side.kind === 'lid') return { ok: false, skip: 'lid' }
  const phone = jidPhone(side.jid)
  if (!phone) return { ok: false, skip: 'invalid' }
  const content = waContent(r.data.message)
  if (!content) return { ok: false, skip: 'not-message' }
  const sec = r.data.messageTimestamp
  // A message never comes from the future: a phone with the wrong clock gets "now".
  const t = sec && Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, now) : now
  const fromMe = key.fromMe === true
  const pushName = !fromMe && r.data.pushName ? cleanWaLine(r.data.pushName, CRM_LIMITS.name) : ''
  return {
    ok: true,
    message: { waId: key.id, phone, fromMe, t, text: content.text, ...(content.media ? { media: content.media } : {}), ...(pushName ? { pushName } : {}) },
  }
}

/** When a record was sent (ms), even one left out (a group): the sync moves past it. Never in the future. */
export function recordTime(raw: unknown, now: number): number | undefined {
  const r = tsSchema.safeParse(obj(raw)?.messageTimestamp)
  const sec = r.success ? r.data : undefined
  return sec && Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, now) : undefined
}

/** Only the WhatsApp id of a message (send.message: what the app itself sent). */
export function readWaId(raw: unknown): string | null {
  const id = obj(obj(raw)?.key)?.id
  return typeof id === 'string' && WA_ID_RE.test(id) ? id : null
}

/** What the player sees in the thread for a message sent from the phone without text. */
export const PHONE_MEDIA_TEXT = '(mídia enviada pelo celular)'

/**
 * The conversation item of a message. From the customer: an 'in' item. From this number: when
 * the app sent it (`sentByApp`, a waId some 'out' item already has) there is nothing to add;
 * otherwise the player answered from the phone, and it enters as `by: { kind: 'phone' }`.
 */
export function inboundItem(m: WaMessage, sentByApp: (waId: string) => boolean): ConversationItem | null {
  const id = waItemId(m.waId)
  if (!m.fromMe) return { id, t: m.t, kind: 'in', text: m.text, waId: m.waId, ...(m.media ? { media: m.media } : {}) }
  if (sentByApp(m.waId)) return null
  return { id, t: m.t, kind: 'out', text: m.text || PHONE_MEDIA_TEXT, by: { kind: 'phone' }, status: 'sent', waId: m.waId }
}

// ---------- entrega (messages.update) ----------

/** Baileys' status names (Evolution renderStatus) to the CRM's. PENDING says nothing new. */
export function waStatus(s: unknown): DeliveryStatus | null {
  switch (s) {
    case 'SERVER_ACK':
      return 'sent'
    case 'DELIVERY_ACK':
      return 'delivered'
    case 'READ':
    case 'PLAYED':
      return 'read'
    case 'ERROR':
      return 'failed'
    default:
      return null
  }
}

export interface WaUpdate {
  waId: string
  /** The other side's phone, when the update names a person (not a @lid). */
  phone?: string
  fromMe: boolean
  status: DeliveryStatus
}

/** A messages.update event's data: { keyId, remoteJid, fromMe, status }. */
export function readWaUpdate(raw: unknown): WaUpdate | null {
  const d = obj(raw)
  if (!d) return null
  const waId = str(d.keyId) ?? str(obj(d.key)?.id)
  const status = waStatus(d.status)
  if (!waId || !WA_ID_RE.test(waId) || !status) return null
  const phone = jidPhone(str(d.remoteJid) ?? str(obj(d.key)?.remoteJid))
  return { waId, fromMe: d.fromMe === true || obj(d.key)?.fromMe === true, status, ...(phone ? { phone } : {}) }
}

const STATUS_RANK: Record<DeliveryStatus, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 1 }

/** The status after an update: it only moves forward (read never goes back to delivered); failed only before delivery. */
export function nextStatus(current: DeliveryStatus, incoming: DeliveryStatus): DeliveryStatus {
  if (incoming === 'failed') return current === 'queued' || current === 'sent' ? 'failed' : current
  if (current === 'failed') return incoming === 'delivered' || incoming === 'read' ? incoming : current
  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current
}

// ---------- estado da conexão (connection.update) ----------

/** Evolution's instance state to the CRM's: open, connecting (waiting for the QR), the rest is close. */
export function waState(s: unknown): 'open' | 'connecting' | 'close' {
  return s === 'open' ? 'open' : s === 'connecting' ? 'connecting' : 'close'
}

export interface WaConnectionUpdate {
  state: 'open' | 'connecting' | 'close'
  /** The QR code expired unread (Evolution's 'refused'). */
  refused?: boolean
  /** The connected number, when it is open. */
  phone?: string
}

export function readConnectionUpdate(raw: unknown): WaConnectionUpdate | null {
  const d = obj(raw)
  if (!d || typeof d.state !== 'string') return null
  const phone = d.state === 'open' ? jidPhone(str(d.wuid)) : null
  return { state: waState(d.state), ...(d.state === 'refused' ? { refused: true } : {}), ...(phone ? { phone } : {}) }
}

// ---------- socket.io à mão (Engine.IO 4, Socket.IO 5) ----------

/** The events the app asks the instance for (POST /websocket/set). */
export const EVOLUTION_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] as const
/** The same events as they arrive on the socket. */
export const SOCKET_EVENTS = ['messages.upsert', 'messages.update', 'send.message', 'connection.update', 'qrcode.updated'] as const
export type SocketEvent = (typeof SOCKET_EVENTS)[number]

/** A frame bigger than this is dropped (an event with a media in base64, a misbehaving server). */
export const MAX_FRAME = 2 * 1024 * 1024

export type SocketFrame =
  | { type: 'open'; pingInterval: number; pingTimeout: number }
  | { type: 'ping' }
  | { type: 'close' }
  | { type: 'connected' }
  | { type: 'refused'; message: string }
  | { type: 'disconnected' }
  | { type: 'event'; name: SocketEvent; payload: Record<string, unknown> }
  | { type: 'other' }

/** What the client sends to enter the instance's namespace. */
export const namespaceFrame = (instance: string): string => `40/${instance},`

const numberIn = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/**
 * One text frame of the socket: '0{…}' open, '2' ping, '1' close, and for the instance's
 * namespace '40/<inst>,{sid}' connected, '44/<inst>,{message}' refused, '41/<inst>,' left,
 * '42/<inst>,["event",{…}]' an event. Another namespace or anything else is 'other'.
 */
export function readSocketFrame(frame: string, instance: string): SocketFrame {
  if (typeof frame !== 'string' || !frame || frame.length > MAX_FRAME) return { type: 'other' }
  const engine = frame[0]
  if (engine === '0') {
    const o = obj(parseJson(frame.slice(1)))
    if (!o) return { type: 'other' }
    return { type: 'open', pingInterval: numberIn(o.pingInterval, 25_000, 1_000, 300_000), pingTimeout: numberIn(o.pingTimeout, 20_000, 1_000, 300_000) }
  }
  if (frame === '2') return { type: 'ping' }
  if (frame === '1') return { type: 'close' }
  if (engine !== '4') return { type: 'other' }
  const packet = frame[1]
  const prefix = `/${instance},`
  if (!frame.startsWith(prefix, 2)) return { type: 'other' }
  // An ack id (digits) may come before the JSON.
  const body = frame.slice(2 + prefix.length).replace(/^\d+/, '')
  if (packet === '0') return { type: 'connected' }
  if (packet === '1') return { type: 'disconnected' }
  if (packet === '4') {
    const message = str(obj(parseJson(body))?.message) ?? ''
    return { type: 'refused', message: cleanWaLine(message, 200) }
  }
  if (packet !== '2') return { type: 'other' }
  const arr = parseJson(body)
  if (!Array.isArray(arr) || typeof arr[0] !== 'string' || !(SOCKET_EVENTS as readonly string[]).includes(arr[0])) return { type: 'other' }
  const payload = obj(arr[1])
  return payload ? { type: 'event', name: arr[0] as SocketEvent, payload } : { type: 'other' }
}

/** Wait before the n-th reconnection (0 = the first): 1 s, 2 s, 4 s… up to 60 s. */
export function reconnectDelay(attempt: number): number {
  const n = Math.max(0, Math.min(16, Math.floor(attempt)))
  return Math.min(60_000, 1_000 * 2 ** n)
}

// ---------- sincronização (findMessages) ----------

/**
 * How far back a sync looks before the last message seen. A message delivered late keeps the
 * sender's time (a phone offline for a while); the id avoids taking it twice.
 */
export const SYNC_MARGIN_MS = 30 * 60_000

/** From when findMessages is asked: the last message seen minus the margin; the first time, now (no history import). */
export function syncSince(lastSeen: number | undefined, now: number): number {
  return lastSeen === undefined ? now : Math.min(now, lastSeen) - SYNC_MARGIN_MS
}

// ---------- a lista de conversas ----------

const MEDIA_LABEL: Record<WaMedia['type'], string> = {
  image: 'Imagem',
  audio: 'Áudio',
  video: 'Vídeo',
  document: 'Documento',
  other: 'Mídia',
}

/** The line under a customer's name in the Conversas list: plain text, at most 140 characters. */
export function previewOf(item: ConversationItem): string {
  let text: string
  if (item.kind === 'draft') text = item.draft.text
  else if (item.kind === 'in') {
    const label = item.media ? `[${item.media.name || MEDIA_LABEL[item.media.type]}]` : ''
    text = [label, item.text].filter(Boolean).join(' ')
  } else text = item.text
  return cutText(cleanWaLine(text, 400), 140)
}

// ---------- a tela de conexão ----------

export type ConnectionTone = 'on' | 'busy' | 'off' | 'error'

/** The dot and the words of the link (Configurações → CRM → WhatsApp and the top of the CRM). */
export function connectionView(c: CrmConnection): { tone: ConnectionTone; label: string; detail: string } {
  const parts: string[] = []
  if (c.instance) parts.push(`Instância ${c.instance}`)
  if (c.version) parts.push(`Evolution ${c.version}`)
  if (c.state === 'open' || c.state === 'connecting')
    parts.push(c.via === 'websocket' ? 'mensagens chegam na hora' : 'buscando mensagens a cada 20 s')
  const detail = parts.join(' · ')
  switch (c.state) {
    case 'open':
      return { tone: 'on', label: 'WhatsApp conectado', detail }
    case 'connecting':
      return { tone: 'busy', label: 'Esperando a leitura do QR code', detail }
    case 'close':
      return { tone: 'off', label: 'WhatsApp desconectado', detail: c.error ?? (detail || 'Clique em Conectar e leia o QR code no celular.') }
    case 'error':
      return { tone: 'error', label: 'Sem conexão com a Evolution', detail: c.error ?? 'Confira se a Evolution está ligada e o endereço.' }
    default:
      return { tone: 'off', label: 'WhatsApp não configurado', detail: 'Informe o endereço, a instância e o token da Evolution.' }
  }
}

/** The docker-compose.yml line that opens the port to the network, and the one that keeps it on this machine. */
export function composePortFix(port: number): { from: string; to: string } {
  const p = Number.isInteger(port) && port > 0 && port < 65_536 ? port : 8080
  return { from: `- "${p}:8080"`, to: `- "127.0.0.1:${p}:8080"` }
}
