import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SocketLike } from '../../src/main/crm/evolution'

// A Evolution falsa dos testes do CRM: responde no lugar da de verdade, pelo `fetch` e por um
// WebSocket de mentira. As respostas vêm dos JSON de test/fixtures/evolution, um arquivo por
// resposta, com dados falsos (telefones 5511900000001 e 5511900000002, "Cliente Teste", "texto de
// teste"). Os formatos medidos no S-1 estão no ADR 0015; os outros saíram do código-fonte da
// 2.3.7. Trocar um fixture pelo que o S-1 gravar é só trocar o arquivo.

const DIR = join(__dirname, '..', 'fixtures', 'evolution')

/** A fixture by name (test/fixtures/evolution/<name>.json), parsed fresh each time. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as T
}

export const FAKE = {
  url: 'http://localhost:8080',
  instance: 'teste',
  /** A made-up instance token (a UUID, like the real ones). */
  token: '11111111-2222-4333-8444-555555555555',
  /** A made-up global key. */
  global: 'chave-global-de-teste-0123456789abcdef',
  /** The customer and the connected number of the fixtures. */
  customer: '5511900000001',
  own: '5511900000002',
  /** 2026-11-17T12:00:00Z: the time of the fixtures' first message. */
  t0: 1_794_916_800_000,
} as const

export interface FakeRequest {
  method: string
  /** The route without the instance: '/instance/connectionState'. */
  route: string
  /** The instance in the path, when the route has one. */
  instance?: string
  url: string
  query: URLSearchParams
  headers: Record<string, string>
  body: unknown
  redirect?: RequestInit['redirect']
  signal?: AbortSignal | null
}

export interface FakeReply {
  status: number
  body?: unknown
  /** A body that is not JSON (or a huge one). */
  raw?: string
  headers?: Record<string, string>
}

export type Handler = (req: FakeRequest) => FakeReply | Promise<FakeReply>

/** Routes that end with /<instância>. */
const WITH_INSTANCE = [
  '/instance/connectionState',
  '/instance/connect',
  '/instance/logout',
  '/websocket/set',
  '/chat/whatsappNumbers',
  '/chat/findMessages',
  '/chat/sendPresence',
  '/message/sendText',
  '/message/sendMedia',
]

/** Never answers; fails when the client's time limit aborts the call. */
export const hang: Handler = (req) =>
  new Promise((_, reject) => {
    req.signal?.addEventListener('abort', () => reject(req.signal?.reason ?? new DOMException('aborted', 'AbortError')))
  })

export class FakeEvolution {
  calls: FakeRequest[] = []
  readonly instance: string = FAKE.instance
  readonly token: string = FAKE.token
  readonly global: string = FAKE.global
  /** What findMessages has stored (the server's database); starts with the records of find-messages.json. */
  records: unknown[] = fixture<{ messages: { records: unknown[] } }>('find-messages').messages.records
  private routes = new Map<string, Handler>()

  constructor() {
    const ok =
      (name: string, status = 200) =>
      () => ({ status, body: fixture(name) })
    this.on('GET /', ok('root'))
    this.on('GET /instance/connectionState', ok('connection-state-open'))
    this.on('GET /instance/connect', ok('connect-qr'))
    this.on('DELETE /instance/logout', ok('logout'))
    this.on('GET /instance/fetchInstances', ok('fetch-instances'))
    this.on('POST /websocket/set', ok('websocket-set', 201))
    this.on('POST /chat/whatsappNumbers', (req) => {
      const n = (req.body as { numbers?: string[] })?.numbers?.[0]
      return { status: 200, body: n === FAKE.customer ? fixture('whatsapp-numbers') : fixture('whatsapp-numbers-missing') }
    })
    // findMessages as the 2.3.7 does it (whatsapp.baileys.service.ts, fetchMessages): newest
    // first; the date filter only with gte and lte; key.id, key.fromMe (only when true) and
    // key.remoteJid (or remoteJidAlt) as exact matches; page and offset (skip = offset × (page − 1)).
    this.on('POST /chat/findMessages', (req) => {
      type Where = {
        messageTimestamp?: { gte?: string; lte?: string }
        key?: { id?: string; fromMe?: boolean; remoteJid?: string; remoteJidAlt?: string }
      }
      const q = (req.body ?? {}) as { where?: Where; page?: number; offset?: number }
      const ts = q.where?.messageTimestamp
      const k = q.where?.key ?? {}
      const sec = (r: unknown) => Number((r as { messageTimestamp?: unknown }).messageTimestamp)
      const key = (r: unknown) => ((r as { key?: Record<string, unknown> }).key ?? {}) as Record<string, unknown>
      const inRange = (r: unknown) =>
        !ts?.gte ||
        !ts.lte ||
        (sec(r) >= Math.floor(new Date(ts.gte).getTime() / 1000) && sec(r) <= Math.floor(new Date(ts.lte).getTime() / 1000))
      const byKey = (r: unknown) =>
        (!k.id || key(r).id === k.id) &&
        (!k.fromMe || key(r).fromMe === true) &&
        (!(k.remoteJid || k.remoteJidAlt) ||
          key(r).remoteJid === k.remoteJid ||
          (!!k.remoteJidAlt && key(r).remoteJidAlt === k.remoteJidAlt))
      const all = this.records.filter((r) => inRange(r) && byKey(r)).sort((a, b) => sec(b) - sec(a))
      const offset = q.offset || 50
      const page = q.page || 1
      return {
        status: 200,
        body: {
          messages: {
            total: all.length,
            pages: Math.ceil(all.length / offset),
            currentPage: page,
            records: all.slice(offset * (page - 1), offset * page),
          },
        },
      }
    })
    this.on('POST /chat/sendPresence', ok('presence', 201))
    this.on('POST /message/sendText', ok('send-text', 201))
    this.on('POST /message/sendMedia', ok('send-media', 201))
    // Only the global key opens /instance/create; an integration that does not exist creates nothing (S-1).
    this.on('POST /instance/create', (req) =>
      req.headers.apikey === this.global
        ? { status: 400, body: fixture('invalid-integration') }
        : { status: 401, body: fixture('unauthorized') },
    )
  }

  /** Answers a route ('POST /message/sendText') with a handler or a fixed reply. */
  on(route: string, reply: Handler | FakeReply): this {
    this.routes.set(route, typeof reply === 'function' ? reply : () => reply)
    return this
  }

  /** The calls to one route. */
  callsTo(route: string): FakeRequest[] {
    return this.calls.filter((c) => `${c.method} ${c.route}` === route)
  }

  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v
    const method = (init.method ?? 'GET').toUpperCase()
    const prefix = WITH_INSTANCE.find((p) => url.pathname.startsWith(`${p}/`))
    const req: FakeRequest = {
      method,
      route: prefix ?? url.pathname,
      ...(prefix ? { instance: decodeURIComponent(url.pathname.slice(prefix.length + 1)) } : {}),
      url: url.href,
      query: url.searchParams,
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      redirect: init.redirect,
      signal: init.signal,
    }
    this.calls.push(req)
    if (init.signal?.aborted) throw init.signal.reason
    const handler = this.routes.get(`${method} ${req.route}`)
    let reply: FakeReply
    if (!handler)
      reply = { status: 404, body: { status: 404, error: 'Not Found', response: { message: [`Cannot ${method} ${url.pathname}`] } } }
    else if (req.route !== '/' && req.route !== '/instance/create' && headers.apikey !== this.token && headers.apikey !== this.global)
      reply = { status: 401, body: fixture('unauthorized') }
    else if (req.instance !== undefined && req.instance !== this.instance) reply = { status: 404, body: fixture('instance-not-found') }
    else reply = await handler(req)
    const text = reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body))
    return new Response(text || null, { status: reply.status, headers: { 'content-type': 'application/json', ...reply.headers } })
  }
}

// ---------- o WebSocket ----------

/** The client's side as events.ts sees it; the test drives the server's side. */
export class FakeSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  sent: string[] = []
  closed = false

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}

  send(data: string): void {
    if (!this.closed) this.sent.push(data)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.({ code: 1000 })
  }

  // ---------- o lado do servidor ----------

  /** Engine.IO open: '0{sid, pingInterval, pingTimeout}'. */
  open(ping = { pingInterval: 25_000, pingTimeout: 20_000 }): void {
    this.onopen?.({})
    this.frame(`0${JSON.stringify({ sid: 'sid-falso', upgrades: [], ...ping, maxPayload: 1_000_000 })}`)
  }

  /** The namespace accepted the client: '40/<inst>,{sid}'. */
  join(instance: string = FAKE.instance): void {
    this.frame(`40/${instance},${JSON.stringify({ sid: 'sid-falso-ns' })}`)
  }

  /** open + join: the socket is up. */
  up(instance: string = FAKE.instance): void {
    this.open()
    this.join(instance)
  }

  /** An event as the Evolution sends it: '42/<inst>,["<event>", envelope]'. */
  emit(envelope: { event: string; instance: string }): void {
    this.frame(`42/${envelope.instance},${JSON.stringify([envelope.event, envelope])}`)
  }

  frame(data: unknown): void {
    if (!this.closed) this.onmessage?.({ data })
  }

  /** The server or the network drops it. */
  drop(): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.({ code: 1006 })
  }
}

/** A socket factory that keeps every socket it opened. */
export function fakeSockets(): {
  factory: (url: string, headers: Record<string, string>) => FakeSocket
  sockets: FakeSocket[]
  last(): FakeSocket
} {
  const sockets: FakeSocket[] = []
  return {
    sockets,
    factory: (url, headers) => {
      const s = new FakeSocket(url, headers)
      sockets.push(s)
      return s
    },
    last: () => sockets[sockets.length - 1],
  }
}
