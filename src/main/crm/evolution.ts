import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { z } from 'zod'
import { CRM_LIMITS, type CrmQr } from '@shared/types'
import { EVOLUTION_EVENTS, jidPhone, waState } from '@shared/crm-inbound'
import { log, secret } from '../log'
import { CRM_INSTANCE_RE } from '../validate'
import { EvolutionError, type EvolutionSender } from './contracts'

// Cliente HTTP da Evolution API (CR-08). Fala com um só endereço, o configurado: nenhum modelo,
// mensagem ou campo de cliente escolhe URL. https fora desta máquina; redirecionamento vira erro;
// 15 s de tempo limite; resposta até 2 MB e conferida por esquema. O token vai só no cabeçalho
// `apikey`, fica num campo privado e passa por secret() antes de qualquer log.
//
// Formatos: os medidos no S-1 (ADR 0015) e, para o que o S-1 ainda não mediu (sendText,
// sendMedia, whatsappNumbers, sendPresence, filtro por data do findMessages), o código-fonte da
// 2.3.7 (sendMessage.dto.ts, message.schema.ts, chat.router.ts, channel.service.ts).

export const EVOLUTION_TIMEOUT_MS = 15_000
/** A PDF goes up to WhatsApp before the server answers: more time, so a slow upload is not retried as a failure. */
export const EVOLUTION_DOCUMENT_TIMEOUT_MS = 60_000
export const EVOLUTION_MAX_BYTES = 2 * 1024 * 1024
/** "digitando…" never lasts longer than this (the Outbox asks up to 6 s). */
export const MAX_PRESENCE_MS = 6_000
/** A PDF of up to 16 MB, in base64. */
const MAX_DOCUMENT_B64 = Math.ceil((16 * 1024 * 1024 * 4) / 3)
/** Digits with the country code (E.164 has at most 15). Never a JID: '@' cannot pass. */
const NUMBER_RE = /^\d{8,15}$/

type Fetch = typeof fetch

// ---------- endereço ----------

export interface EvolutionBase {
  /** 'http://localhost:8080' or 'https://evo.example.com/api', without the trailing slash. */
  base: string
  /** host:port as the screen shows it in errors. */
  host: string
  port: number
  /** localhost, ::1 or 127.x.x.x written in full: this machine. */
  local: boolean
}

/** 127.0.0.1 … 127.255.255.255, four decimal numbers with no leading zero. */
function loopbackIPv4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  return !!m && m[1] === '127' && m.slice(1).every((n) => Number(n) <= 255 && (n === '0' || !n.startsWith('0')))
}

const config = (message: string) => new EvolutionError(message, 'config')

/**
 * Checks the Evolution address. Local = exactly `localhost`, `[::1]` or a 127.x.x.x written in
 * full, as typed (the URL parser turns 127.1, 0x7f.1 and 2130706433 into 127.0.0.1; those are
 * not accepted as local). Anything else needs https://. No user:password@, no ? or #.
 */
export function evolutionBase(raw: string): EvolutionBase {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) throw config('Informe o endereço da Evolution, como http://localhost:8080.')
  if (text.length > CRM_LIMITS.url) throw config('Endereço grande demais. Use só o servidor, como http://localhost:8080.')
  const m = /^(https?):\/\/([^/?#]*)([^?#]*)$/i.exec(text)
  if (!m) {
    if (/^https?:\/\/[^?#]*[?#]/i.test(text)) throw config('Tire o ? e o # do endereço: use só o servidor, como http://localhost:8080.')
    throw config('Endereço inválido. Use http://localhost:8080 para a Evolution desta máquina, ou https://seu-servidor.')
  }
  const [, , authority, path] = m
  if (authority.includes('@'))
    throw config('Tire o usuário e a senha do endereço (o que vem antes do @). O app manda só o token da instância, no cabeçalho.')
  if (!authority || authority.includes('\\')) throw config('Endereço inválido. Use http://localhost:8080 ou https://seu-servidor.')
  if ((path && !/^(\/[A-Za-z0-9._~-]+)*\/?$/.test(path)) || /(^|\/)\.{1,2}(\/|$)/.test(path))
    throw config('O caminho do endereço tem caracteres que o app não aceita. Use só o servidor, como https://seu-servidor.')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw config('Endereço inválido. Use http://localhost:8080 ou https://seu-servidor.')
  }
  const typedHost = (authority.startsWith('[') ? authority.slice(0, authority.indexOf(']') + 1) : authority.split(':')[0]).toLowerCase()
  const host = url.hostname.toLowerCase()
  const local = typedHost === host && (host === 'localhost' || host === '[::1]' || loopbackIPv4(host))
  if (url.protocol === 'http:' && !local)
    throw config(
      'Endereço fora deste computador só com https://. Use https://seu-servidor, ou http://localhost:8080 para a Evolution desta máquina.',
    )
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  return { base: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`, host: url.host, port, local }
}

// ---------- respostas ----------

/** Reads the body up to `max` bytes; past it the read stops and the call fails. */
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined)
    throw new EvolutionError('A resposta da Evolution passou de 2 MB. Confira o endereço: ele deve ser o da Evolution API.', 'schema')
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      throw new EvolutionError('A resposta da Evolution passou de 2 MB. Confira o endereço: ele deve ser o da Evolution API.', 'schema')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseBody(text: string): unknown {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return Symbol.for('not-json')
  }
}

/** The server's message list (BadRequest and friends): { response: { message: [...] } }. Read, never echoed. */
function serverMessages(body: unknown): unknown[] {
  const msg = (body as { response?: { message?: unknown } } | undefined)?.response?.message
  return Array.isArray(msg) ? msg : msg === undefined ? [] : [msg]
}

const mentions = (body: unknown, re: RegExp) => serverMessages(body).some((m) => typeof m === 'string' && re.test(m))

/** sendText to a number without WhatsApp: 400 with [{ jid, exists: false, number }]. */
const notOnWhatsapp = (body: unknown) => serverMessages(body).some((m) => !!m && typeof m === 'object' && (m as { exists?: unknown }).exists === false)

const anyBody = z.unknown()
const sentSchema = z.object({ key: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{4,100}$/) }) })

// ---------- o socket de eventos ----------

/** The part of the WebSocket API events.ts uses (undici's WebSocket in the app, a fake in the tests). */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike

/** Node 22+ (and Electron's main): the global WebSocket takes headers, so the token never goes in the URL. */
export const nodeSocket: SocketFactory = (url, headers) => new WebSocket(url, { headers }) as unknown as SocketLike

// ---------- o cliente ----------

export interface EvolutionClientOptions {
  url: string
  instance: string
  token: string
  fetch?: Fetch
  timeoutMs?: number
}

export interface FoundMessages {
  total: number
  pages: number
  page: number
  /** Raw records, newest first; @shared/crm-inbound reads them. */
  records: unknown[]
}

interface CallOpts {
  auth?: boolean
  timeoutMs?: number
  /** A 400 for a number without WhatsApp is its own kind. */
  numberCall?: boolean
  /** A non-2xx answer that still means success (logout of an instance already out). */
  okWhen?: (status: number, body: unknown) => boolean
}

export class EvolutionClient implements EvolutionSender {
  readonly base: string
  readonly host: string
  readonly port: number
  readonly local: boolean
  readonly instance: string
  // Private fields: not enumerable, so util.format('%o', client) never prints the token.
  readonly #token: string
  readonly #fetch: Fetch
  readonly #timeout: number

  constructor(opts: EvolutionClientOptions) {
    const b = evolutionBase(opts.url)
    if (!CRM_INSTANCE_RE.test(opts.instance ?? '')) throw config('Nome de instância inválido. Use o nome que aparece no painel da Evolution.')
    const token = (opts.token ?? '').trim()
    if (!token || token.length > CRM_LIMITS.token || /\s/.test(token)) throw config('Cole o token da instância (painel da Evolution → instância → token).')
    secret(token)
    this.base = b.base
    this.host = b.host
    this.port = b.port
    this.local = b.local
    this.instance = opts.instance
    this.#token = token
    this.#fetch = opts.fetch ?? fetch
    this.#timeout = opts.timeoutMs ?? EVOLUTION_TIMEOUT_MS
  }

  private path(route: string): string {
    return `${route}/${encodeURIComponent(this.instance)}`
  }

  private scrub(message: string): string {
    return message.split(this.#token).join('[token]')
  }

  private httpError(what: string, status: number, body: unknown, opts: CallOpts): EvolutionError {
    const e = (message: string, kind: 'http4xx' | 'http5xx' | 'not-whatsapp') => new EvolutionError(this.scrub(message), kind, status)
    if (status === 401 || status === 403)
      return e(`A Evolution recusou o token (HTTP ${status}) ${what}. Cole de novo o token da instância "${this.instance}" (painel da Evolution → instância → token).`, 'http4xx')
    if (status === 404)
      return mentions(body, /instance does not exist/i)
        ? e(`A instância "${this.instance}" não existe nesse servidor. Confira o nome no painel da Evolution.`, 'http4xx')
        : e(`A Evolution não tem essa rota (HTTP 404) ${what}. Confira se o endereço é o da Evolution API 2.3.`, 'http4xx')
    if (status === 400 && opts.numberCall && notOnWhatsapp(body)) return e('Esse número não tem WhatsApp. Confira o telefone na ficha do cliente.', 'not-whatsapp')
    if (status === 413) return e(`O arquivo é grande demais para a Evolution (HTTP 413) ${what}.`, 'http4xx')
    if (status === 429) return e(`A Evolution pediu para esperar (HTTP 429) ${what}. Tente de novo em alguns minutos.`, 'http4xx')
    if (status >= 500) return e(`A Evolution falhou ${what} (HTTP ${status}). Tente de novo em instantes; se repetir, veja o log do contêiner da Evolution.`, 'http5xx')
    return e(`A Evolution recusou o pedido (HTTP ${status}) ${what}. Veja o log do contêiner da Evolution para o motivo.`, 'http4xx')
  }

  private async call<T>(what: string, method: 'GET' | 'POST' | 'DELETE', route: string, schema: z.ZodType<T, unknown>, body?: unknown, opts: CallOpts = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (opts.auth !== false) headers.apikey = this.#token
    const timeout = opts.timeoutMs ?? this.#timeout
    let res: Response
    let text: string
    try {
      res = await this.#fetch(`${this.base}${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      })
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        await res.body?.cancel().catch(() => undefined)
        throw config(
          `A Evolution respondeu com um redirecionamento (HTTP ${res.status || '3xx'}) ${what}. O app não segue redirecionamentos: ponha no campo o endereço final do servidor.`,
        )
      }
      text = await readCapped(res, EVOLUTION_MAX_BYTES)
    } catch (err) {
      if (err instanceof EvolutionError) throw err
      const name = err instanceof Error ? err.name : ''
      if (name === 'TimeoutError' || name === 'AbortError')
        throw new EvolutionError(`A Evolution não respondeu em ${Math.round(timeout / 1000)} s ${what}. Confira se ela está ligada e tente de novo.`, 'timeout')
      const code = (err as { cause?: { code?: unknown } })?.cause?.code
      log.warn(`CRM: Evolution fora do ar ${what} (${typeof code === 'string' ? code : name || 'erro de rede'})`)
      throw new EvolutionError(
        `Não consegui falar com a Evolution em ${this.host} ${what}. Confira se ela está ligada (Configurações → CRM → Servidor local) e se o endereço está certo.`,
        'network',
      )
    }
    const json = parseBody(text)
    if (!res.ok) {
      if (opts.okWhen?.(res.status, json)) return undefined as T
      throw this.httpError(what, res.status, json, opts)
    }
    const r = schema.safeParse(json)
    if (!r.success)
      throw new EvolutionError(`A Evolution respondeu fora do esperado ${what}. Confira se o servidor é a Evolution API 2.3 (a testada é a 2.3.7).`, 'schema')
    return r.data
  }

  private number(n: string): string {
    if (typeof n !== 'string' || !NUMBER_RE.test(n)) throw config('Número inválido: use só os dígitos, com o DDI (como 5511987654321).')
    return n
  }

  // ---------- instância ----------

  /** WhatsApp state of the instance: open, connecting (QR waiting) or close. */
  async state(): Promise<'open' | 'connecting' | 'close'> {
    const r = await this.call(
      'ao ler o estado',
      'GET',
      this.path('/instance/connectionState'),
      z.object({ instance: z.object({ state: z.string().max(40).nullable().optional() }) }),
    )
    return waState(r.instance.state)
  }

  /** "Conectar": starts the link and returns the QR code (PNG data URL), or open when it already is. */
  async qr(): Promise<CrmQr> {
    const r = await this.call(
      'ao pedir o QR code',
      'GET',
      this.path('/instance/connect'),
      z.object({
        instance: z.object({ state: z.string().max(40).nullable().optional() }).optional(),
        base64: z.string().max(EVOLUTION_MAX_BYTES).nullable().optional(),
        pairingCode: z.string().max(40).nullable().optional(),
      }),
    )
    if (r.instance?.state === 'open') return { state: 'open' }
    const qr = r.base64 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(r.base64) ? r.base64 : undefined
    const pairingCode = r.pairingCode && /^[A-Z0-9-]{4,16}$/.test(r.pairingCode) ? r.pairingCode : undefined
    return { state: 'connecting', ...(qr ? { qr } : {}), ...(pairingCode ? { pairingCode } : {}) }
  }

  /** "Desconectar": logs the number out of the instance (the instance and its token stay). */
  async logout(): Promise<void> {
    await this.call('ao desconectar', 'DELETE', this.path('/instance/logout'), anyBody, undefined, {
      okWhen: (status, body) => status === 400 && mentions(body, /is not connected/i),
    })
  }

  /** The connected number (digits), from the instance's owner. */
  async ownNumber(): Promise<string | undefined> {
    const rows = await this.call(
      'ao ler a instância',
      'GET',
      `/instance/fetchInstances?instanceName=${encodeURIComponent(this.instance)}`,
      z.array(z.object({ name: z.string().max(200).optional(), ownerJid: z.string().max(200).nullable().optional() }).passthrough()).max(50),
    )
    const row = rows.find((x) => x.name === this.instance)
    return jidPhone(row?.ownerJid) ?? undefined
  }

  /** The server's version ('2.3.7'), from GET / (no token needed). */
  async version(): Promise<string | undefined> {
    const r = await this.call('ao ler a versão', 'GET', '/', z.object({ version: z.string().max(40).optional() }).passthrough(), undefined, { auth: false })
    return r.version && /^[\w.+-]{1,40}$/.test(r.version) ? r.version : undefined
  }

  /**
   * Is the pasted token the server's global key? Only the global key opens /instance/create; with
   * an integration that does not exist the server answers 400 "Invalid integration" and creates
   * nothing (S-1). A token of an instance gets 401.
   */
  async probeGlobalKey(): Promise<boolean> {
    let status = 0
    let body: unknown
    await this.call(
      'ao conferir o token',
      'POST',
      '/instance/create',
      anyBody,
      { instanceName: `agent-office-sonda-${randomBytes(6).toString('hex')}`, integration: 'NAO-EXISTE' },
      {
        okWhen: (s, b) => {
          status = s
          body = b
          return s === 400 || s === 401 || s === 403
        },
      },
    )
    // 2xx: the server created something with this key, which only the global key can.
    return status === 0 || (status === 400 && mentions(body, /invalid integration/i))
  }

  /** Turns on the instance's WebSocket with the CRM's events. False when the server has WebSocket off. */
  async setWebsocket(): Promise<boolean> {
    const r = await this.call('ao ligar os eventos', 'POST', this.path('/websocket/set'), anyBody, {
      websocket: { enabled: true, events: [...EVOLUTION_EVENTS] },
    })
    return !!r && typeof r === 'object' && (r as { enabled?: unknown }).enabled === true
  }

  /** Opens the instance's event socket; the token goes in the `apikey` header, never in the URL. */
  openEvents(factory: SocketFactory): SocketLike {
    const ws = this.base.replace(/^http/, 'ws')
    return factory(`${ws}/socket.io/?EIO=4&transport=websocket`, { apikey: this.#token })
  }

  // ---------- conversas ----------

  /** Does this number have WhatsApp? */
  async checkNumber(number: string): Promise<boolean> {
    const n = this.number(number)
    const rows = await this.call(
      'ao conferir o número',
      'POST',
      this.path('/chat/whatsappNumbers'),
      z.array(z.object({ exists: z.boolean(), number: z.string().max(40).optional() }).passthrough()).max(10),
      { numbers: [n] },
    )
    return (rows.find((r) => r.number === n) ?? rows[0])?.exists === true
  }

  /**
   * Messages between `since` and `until` (ms), newest first, by page. The filter by date is
   * where.messageTimestamp { gte, lte } (both, or none is applied); the page is page/offset.
   */
  async findMessages(q: { since?: number; until?: number; page?: number; size?: number }): Promise<FoundMessages> {
    const size = Math.min(100, Math.max(1, Math.floor(q.size ?? 100)))
    const page = Math.max(1, Math.floor(q.page ?? 1))
    const where =
      q.since !== undefined
        ? { messageTimestamp: { gte: new Date(q.since).toISOString(), lte: new Date(q.until ?? Date.now()).toISOString() } }
        : {}
    const r = await this.call(
      'ao buscar mensagens',
      'POST',
      this.path('/chat/findMessages'),
      z.object({
        messages: z.object({
          total: z.number().int().min(0),
          pages: z.number().int().min(0),
          currentPage: z.union([z.number(), z.string()]).optional(),
          records: z.array(z.unknown()).max(1_000),
        }),
      }),
      { where, page, offset: size },
    )
    return { total: r.messages.total, pages: r.messages.pages, page, records: r.messages.records }
  }

  // ---------- envio (só a Outbox chama) ----------

  async sendText(number: string, text: string): Promise<{ waId: string }> {
    const n = this.number(number)
    if (typeof text !== 'string' || !text.trim() || text.length > CRM_LIMITS.messageText) throw config('Mensagem vazia ou grande demais para enviar.')
    // linkPreview off: the server would fetch the link to draw the preview.
    const r = await this.call('ao enviar a mensagem', 'POST', this.path('/message/sendText'), sentSchema, { number: n, text, linkPreview: false }, { numberCall: true })
    return { waId: r.key.id }
  }

  async sendDocument(number: string, doc: { fileName: string; base64: string; caption?: string }): Promise<{ waId: string }> {
    const n = this.number(number)
    const base = (doc.fileName ?? '').split(/[/\\]/).pop() ?? ''
    const clean = base
      .replace(/[^\p{L}\p{N} ._()-]/gu, '')
      .trim()
      .slice(0, 100)
    const fileName = /\.pdf$/i.test(clean) ? clean : `${clean || 'documento'}.pdf`
    if (typeof doc.base64 !== 'string' || !doc.base64 || doc.base64.length > MAX_DOCUMENT_B64 || !/^[A-Za-z0-9+/]+=*$/.test(doc.base64))
      throw config('O PDF está vazio, corrompido ou passa de 16 MB.')
    const caption = doc.caption?.trim() ? doc.caption.slice(0, CRM_LIMITS.messageText) : undefined
    const r = await this.call(
      'ao enviar o PDF',
      'POST',
      this.path('/message/sendMedia'),
      sentSchema,
      { number: n, mediatype: 'document', mimetype: 'application/pdf', fileName, media: doc.base64, ...(caption ? { caption } : {}) },
      { numberCall: true, timeoutMs: EVOLUTION_DOCUMENT_TIMEOUT_MS },
    )
    return { waId: r.key.id }
  }

  /** "digitando…" for `ms` (at most 6 s). The server holds the answer until it ends. */
  async presence(number: string, ms: number): Promise<void> {
    const n = this.number(number)
    const delay = Math.min(MAX_PRESENCE_MS, Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0)))
    await this.call(
      'ao mostrar "digitando…"',
      'POST',
      this.path('/chat/sendPresence'),
      anyBody,
      { number: n, presence: 'composing', delay },
      { numberCall: true, timeoutMs: this.#timeout + delay },
    )
  }
}

// ---------- porta aberta na rede (CR-10) ----------

type Interfaces = ReturnType<typeof networkInterfaces>

/** This machine's IPv4 addresses on a network (not loopback, not link-local 169.254), at most 8. */
export function lanIPv4(ifaces: Interfaces): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      const v4 = a.family === 'IPv4' || (a.family as unknown) === 4
      if (v4 && !a.internal && !a.address.startsWith('169.254.') && !out.includes(a.address)) out.push(a.address)
    }
  }
  return out.slice(0, 8)
}

/**
 * The Evolution of this machine answers on the network too? Tries the same port on this
 * machine's network addresses, briefly, with no token (only GET /). Any answer means the
 * docker-compose publishes the port on every interface ("8080:8080" without 127.0.0.1).
 */
export async function lanExposed(port: number, opts: { interfaces?: () => Interfaces; fetch?: Fetch; timeoutMs?: number; https?: boolean } = {}): Promise<boolean> {
  const addrs = lanIPv4((opts.interfaces ?? networkInterfaces)())
  if (!addrs.length) return false
  const f = opts.fetch ?? fetch
  const tries = addrs.map(async (ip) => {
    const res = await f(`${opts.https ? 'https' : 'http'}://${ip}:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 1_200) })
    await res.body?.cancel().catch(() => undefined)
    return true
  })
  return Promise.any(tries).catch(() => false)
}
