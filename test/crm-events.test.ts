import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationItem, Customer, OfficeEvent } from '@shared/types'
import { waItemId } from '@shared/crm-inbound'
import { ConversationStore } from '../src/main/crm/conversations'
import { EvolutionClient } from '../src/main/crm/evolution'
import { EvolutionEvents, FROM_ME_GRACE_MS, POLL_MS } from '../src/main/crm/events'
import { CrmStore } from '../src/main/crm/store'
import { log } from '../src/main/log'
import { FAKE, FakeEvolution, fakeSockets, fixture } from './mocks/evolution'

// Os eventos do WhatsApp (CR-09) contra a Evolution falsa: WebSocket de mentira, findMessages
// filtrando e paginando como a 2.3.7, relógio falso. Nenhum teste fala com uma Evolution de verdade.

const NOW = FAKE.t0 + 120_000
const id = (n: number) => `3A${String(n).padStart(18, '0')}`

/** A message record as the Evolution keeps it (event data or findMessages). */
const rec = (waId: string, t: number, o: { fromMe?: boolean; phone?: string; text?: string; name?: string } = {}) => ({
  key: { remoteJid: `${o.phone ?? FAKE.customer}@s.whatsapp.net`, fromMe: !!o.fromMe, id: waId },
  pushName: o.fromMe ? 'Você' : (o.name ?? 'Cliente Teste'),
  messageType: 'conversation',
  message: { conversation: o.text ?? 'texto de teste' },
  messageTimestamp: Math.floor(t / 1000),
})
const upsert = (data: unknown) => ({ event: 'messages.upsert', instance: FAKE.instance, data })

let dir: string
let evo: FakeEvolution
let socks: ReturnType<typeof fakeSockets>
let store: CrmStore
let conversations: ConversationStore
let events: EvolutionEvents
let sent: OfficeEvent[]
let inbound: { customerId: string; item: ConversationItem }[]
let lan: boolean | undefined
let logs: string[]

const settle = async () => {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r))
}
const tick = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

const client = () => new EvolutionClient({ url: FAKE.url, instance: FAKE.instance, token: FAKE.token, fetch: evo.fetch })
const customer = (phones: string[] = [FAKE.customer]) => store.saveCustomer({ name: 'Cliente Teste', phones }).item
const fresh = (c: Customer) => store.customer(c.id)!
/** The whole conversation, page by page from the back. */
const items = (c: Customer) => {
  const all: ConversationItem[] = []
  let before: string | undefined
  for (;;) {
    const p = conversations.page(c.id, before)
    all.unshift(...p.items)
    if (!p.more || !p.items.length) return all
    before = p.items[0].id
  }
}
const ofType = <T extends OfficeEvent['type']>(type: T) => sent.filter((e): e is Extract<OfficeEvent, { type: T }> => e.type === type)
const findCalls = () => evo.callsTo('POST /chat/findMessages').length

/** Starts the link and brings the WebSocket up, with nothing to sync unless the test says. */
async function linked(o: { seen?: number; records?: unknown[] } = {}) {
  conversations.markSeen(o.seen ?? FAKE.t0 - 60_000)
  evo.records = o.records ?? []
  events.start(client())
  await settle()
  socks.last().up()
  await settle()
  return socks.last()
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-eventos-'))
  evo = new FakeEvolution()
  socks = fakeSockets()
  store = new CrmStore(dir)
  conversations = new ConversationStore(dir)
  sent = []
  inbound = []
  lan = undefined
  logs = []
  for (const level of ['info', 'warn', 'debug', 'error'] as const)
    vi.spyOn(log, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')))
  events = new EvolutionEvents({
    store,
    conversations,
    broadcast: (e) => sent.push(e),
    socket: socks.factory,
    lan: async () => lan ?? false,
  })
  events.onInbound = (customerId, item) => inbound.push({ customerId, item })
})

afterEach(async () => {
  events.stop()
  await settle()
  store.lock()
  conversations.flush()
  // Logs never carry message text, the full phone or the token.
  for (const line of logs) {
    expect(line).not.toContain('texto de teste')
    expect(line).not.toContain(FAKE.customer)
    expect(line).not.toContain(FAKE.token)
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('canal de eventos', () => {
  it('abre o WebSocket com o token no cabeçalho e entra só no canal da instância', async () => {
    conversations.markSeen(FAKE.t0)
    evo.records = []
    events.start(client())
    expect(events.current()).toMatchObject({ state: 'connecting', instance: 'teste', via: 'polling' })
    await settle()
    expect(evo.callsTo('POST /websocket/set')).toHaveLength(1)
    const s = socks.last()
    expect(s.url).toBe('ws://localhost:8080/socket.io/?EIO=4&transport=websocket')
    expect(s.headers).toEqual({ apikey: FAKE.token })
    s.open()
    expect(s.sent).toEqual(['40/teste,'])
    s.frame('2')
    expect(s.sent).toEqual(['40/teste,', '3'])
    s.join()
    await settle()
    expect(events.current()).toMatchObject({ state: 'open', via: 'websocket', version: '2.3.7' })
    expect(events.connected()).toBe(true)
    expect(events.ownNumber()).toBe(FAKE.own)
    expect(ofType('crm:connection').at(-1)?.connection).toMatchObject({ state: 'open', via: 'websocket' })
  })

  it('sem configuração fica desligado; endereço recusado mostra o motivo', () => {
    events.start(null)
    expect(events.current()).toEqual({ state: 'off' })
    expect(ofType('crm:connection').at(-1)?.connection).toEqual({ state: 'off' })
    events.fail('Use https.')
    expect(events.current()).toEqual({ state: 'off', error: 'Use https.' })
    expect(events.sender()).toBeNull()
  })

  it('token recusado vira erro com o que fazer, sem o token', async () => {
    evo.on('GET /instance/connectionState', { status: 401, body: fixture('unauthorized') })
    conversations.markSeen(FAKE.t0)
    events.start(client())
    await settle()
    const c = events.current()
    expect(c.state).toBe('error')
    expect(c.error).toMatch(/token/i)
    expect(c.error).not.toContain(FAKE.token)
  })

  it('Evolution local que responde na rede marca o aviso de porta aberta', async () => {
    lan = true
    await linked()
    expect(events.current().lanExposed).toBe(true)
  })

  it('a primeira conexão não importa o histórico do número', async () => {
    customer()
    evo.records = fixture('find-messages').messages.records
    events.start(client())
    await settle()
    expect(findCalls()).toBe(0)
    expect(conversations.lastSeen()).toBe(NOW)
    expect(conversations.summaries()).toEqual([])
  })

  it('estado da conexão pelos eventos: aberto, QR expirado e QR novo', async () => {
    await linked()
    events.handleEvent('connection.update', fixture('event-connection-refused'))
    expect(events.current()).toMatchObject({ state: 'close', error: 'O QR code expirou sem leitura. Clique em Conectar para gerar outro.' })
    expect(events.ownNumber()).toBeUndefined()
    events.handleEvent('qrcode.updated', fixture('event-qrcode-updated'))
    expect(events.current().state).toBe('connecting')
    events.handleEvent('connection.update', fixture('event-connection-update'))
    expect(events.current()).toMatchObject({ state: 'open' })
    expect(events.current().error).toBeUndefined()
    expect(events.ownNumber()).toBe(FAKE.own)
    // Another instance's event is not ours.
    events.handleEvent('connection.update', { ...fixture('event-connection-refused'), instance: 'outra' })
    expect(events.current().state).toBe('open')
  })
})

describe('mensagens recebidas', () => {
  it('mensagem do cliente entra na conversa, marca o número e o último contato', async () => {
    const c = customer()
    const s = await linked()
    s.emit(fixture('event-messages-upsert'))
    const all = items(c)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: waItemId('3A5F0C1D2E3F4A5B6C7D'), kind: 'in', text: 'texto de teste', t: FAKE.t0 })
    expect(fresh(c)).toMatchObject({ phoneChecked: true, lastContactAt: FAKE.t0 })
    expect(ofType('crm:item')).toHaveLength(1)
    expect(ofType('crm:summary').at(-1)?.summary).toMatchObject({ customerId: c.id, unread: 1, previewKind: 'in' })
    expect(ofType('crm').at(-1)?.delta.customers?.[0].id).toBe(c.id)
    expect(inbound).toEqual([{ customerId: c.id, item: all[0] }])
    expect(conversations.lastSeen()).toBe(FAKE.t0)
  })

  it('a mesma mensagem repetida entra uma vez só', async () => {
    const c = customer()
    const s = await linked()
    s.emit(fixture('event-messages-upsert'))
    s.emit(fixture('event-messages-upsert'))
    events.handleEvent('messages.upsert', fixture('event-messages-upsert'))
    // After a restart the conversation file still knows it.
    const again = new EvolutionEvents({ store, conversations, broadcast: (e) => sent.push(e), socket: socks.factory })
    again.start(client())
    again.handleEvent('messages.upsert', fixture('event-messages-upsert'))
    again.stop()
    expect(items(c)).toHaveLength(1)
    expect(ofType('crm:item')).toHaveLength(1)
    expect(inbound).toHaveLength(1)
  })

  it('número desconhecido vira contato novo, esperando você', async () => {
    const s = await linked()
    s.emit(fixture('event-messages-upsert'))
    const c = store.ownerOfPhone(FAKE.customer)!
    expect(c).toMatchObject({ name: 'Cliente Teste', source: 'whatsapp', phones: [FAKE.customer], phoneChecked: true })
    expect(conversations.summary(c.id)).toMatchObject({ waiting: 'new-contact', unread: 1 })
    expect(inbound[0].customerId).toBe(c.id)
  })

  it('número com o 9 faltando (celular antigo) acha o cliente certo', async () => {
    const c = customer(['5531988880001'])
    const s = await linked()
    s.emit(upsert(fixture('messages-variety').oldMobile))
    expect(store.customers).toHaveLength(1)
    expect(items(c)).toHaveLength(1)
  })

  it('grupo, status, lista de transmissão e canal ficam de fora', async () => {
    const v = fixture('messages-variety')
    const s = await linked()
    for (const k of ['group', 'status', 'broadcast', 'newsletter', 'badId', 'protocol']) s.emit(upsert(v[k]))
    expect(store.customers).toHaveLength(0)
    expect(ofType('crm:item')).toHaveLength(0)
    expect(inbound).toHaveLength(0)
  })

  it('fora de ordem: cada uma no seu lugar, e a prévia fica com a mais nova', async () => {
    const c = customer()
    const s = await linked()
    s.emit(upsert(rec(id(2), FAKE.t0 + 60_000, { text: 'texto de teste 2' })))
    s.emit(upsert(rec(id(1), FAKE.t0, { text: 'texto de teste 1' })))
    expect(items(c).map((x) => x.id)).toEqual([waItemId(id(1)), waItemId(id(2))])
    expect(conversations.summary(c.id)).toMatchObject({ preview: 'texto de teste 2', unread: 2 })
    expect(fresh(c).lastContactAt).toBe(FAKE.t0 + 60_000)
  })
})

describe('mensagens que saem do número', () => {
  it('resposta escrita no celular entra como "pelo celular" e marca a hora', async () => {
    const c = customer()
    const s = await linked()
    s.emit(fixture('event-messages-upsert-from-phone'))
    const all = items(c)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ kind: 'out', by: { kind: 'phone' }, waId: '3A5F0C1D2E3F4A5B6C7E', t: FAKE.t0 + 60_000 })
    expect(fresh(c).phoneReplyAt).toBe(FAKE.t0 + 60_000)
    // Not the customer's: no hook, no unread.
    expect(inbound).toHaveLength(0)
    expect(conversations.summary(c.id)?.unread).toBe(0)
  })

  it('para número fora do CRM não cria ninguém', async () => {
    const s = await linked()
    s.emit(fixture('event-messages-upsert-from-phone'))
    expect(store.customers).toHaveLength(0)
  })

  it('o que o app enviou não vira resposta pelo celular, mesmo chegando antes do id', async () => {
    const c = customer()
    const s = await linked()
    // 1: announced by send.message (the API sent it).
    s.emit(upsert(rec(id(1), NOW, { fromMe: true })))
    s.emit({ ...upsert(rec(id(1), NOW, { fromMe: true })), event: 'send.message' })
    // 2: the Outbox writes the waId a moment later.
    s.emit(upsert(rec(id(2), NOW, { fromMe: true })))
    conversations.put(c.id, {
      id: 'out-2',
      t: NOW,
      kind: 'out',
      text: 'texto de teste',
      by: { kind: 'player' },
      status: 'sent',
      waId: id(2),
    })
    // 3: the player wrote from the phone.
    s.emit(upsert(rec(id(3), NOW, { fromMe: true })))
    expect(ofType('crm:item')).toHaveLength(0)
    await tick(FROM_ME_GRACE_MS + 100)
    const phone = items(c).filter((x) => x.kind === 'out' && x.by.kind === 'phone')
    expect(phone.map((x) => x.id)).toEqual([waItemId(id(3))])
    expect(fresh(c).phoneReplyAt).toBe(Math.floor(NOW / 1000) * 1000)
  })

  it('o status da entrega só anda para frente', async () => {
    const c = customer()
    const s = await linked()
    const waId = '3EB0A1B2C3D4E5F6A7B8C9'
    conversations.put(c.id, { id: 'out-1', t: NOW, kind: 'out', text: 'texto de teste', by: { kind: 'player' }, status: 'sent', waId })
    const update = (status: string) => {
      const e = fixture('event-messages-update')
      e.data.status = status
      s.emit(e)
    }
    update('DELIVERY_ACK')
    expect(conversations.get(c.id, 'out-1')).toMatchObject({ status: 'delivered' })
    update('SERVER_ACK')
    expect(conversations.get(c.id, 'out-1')).toMatchObject({ status: 'delivered' })
    update('READ')
    expect(conversations.get(c.id, 'out-1')).toMatchObject({ status: 'read' })
    expect(ofType('crm:item').map((e) => (e.item as { status: string }).status)).toEqual(['delivered', 'read'])
  })
})

describe('reconexão e busca', () => {
  it('cai, busca a cada 20 s, reconecta e não perde nem duplica', async () => {
    const c = customer()
    const a = rec(id(1), FAKE.t0)
    const b = rec(id(2), FAKE.t0 + 30_000, { text: 'texto de teste 2' })
    const s1 = await linked()
    s1.emit(upsert(a))
    const before = findCalls()
    // The socket drops; B arrives meanwhile, with a group message.
    s1.drop()
    expect(events.current().via).toBe('polling')
    evo.records = [a, b, fixture('messages-variety').group]
    await tick(999)
    expect(socks.sockets).toHaveLength(1)
    await tick(1)
    // Reconnecting after 1 s; this socket does not answer yet.
    expect(socks.sockets).toHaveLength(2)
    expect(findCalls()).toBe(before)
    await tick(POLL_MS - 1_000)
    expect(findCalls()).toBeGreaterThan(before)
    expect(items(c).map((x) => x.id)).toEqual([waItemId(id(1)), waItemId(id(2))])
    // Back up: it fetches again, and B comes once more by the socket.
    const s2 = socks.last()
    s2.up()
    await settle()
    expect(events.current().via).toBe('websocket')
    s2.emit(upsert(b))
    expect(items(c).map((x) => x.id)).toEqual([waItemId(id(1)), waItemId(id(2))])
    expect(ofType('crm:item')).toHaveLength(2)
    expect(inbound.map((x) => x.item.id)).toEqual([waItemId(id(1)), waItemId(id(2))])
    // With the socket up, no more polling.
    const calls = findCalls()
    await tick(POLL_MS * 3)
    expect(findCalls()).toBe(calls)
  })

  it('reconecta de 1 s até 60 s, e volta a 1 s depois de conectar', async () => {
    const s1 = await linked()
    const waits: number[] = []
    let last = s1
    for (let i = 0; i < 8; i++) {
      const n = socks.sockets.length
      last.drop()
      let waited = 0
      while (socks.sockets.length === n) {
        await vi.advanceTimersByTimeAsync(1_000)
        waited += 1_000
      }
      waits.push(waited)
      last = socks.last()
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000])
    last.up()
    await settle()
    const n = socks.sockets.length
    last.drop()
    await tick(1_000)
    expect(socks.sockets).toHaveLength(n + 1)
  })

  it('sem ping do servidor, dá o canal por caído e reconecta', async () => {
    const s = await linked()
    // up() opens with pingInterval 25 s + pingTimeout 20 s.
    await tick(44_000)
    expect(events.current().via).toBe('websocket')
    await tick(1_000)
    expect(s.closed).toBe(true)
    expect(events.current().via).toBe('polling')
    await tick(1_000)
    expect(socks.sockets).toHaveLength(2)
  })

  it('ao abrir, busca o que chegou desde a última vista, do mais velho ao mais novo, várias páginas', async () => {
    const c = customer()
    const start = FAKE.t0 - 2 * 3_600_000
    const records = Array.from({ length: 1_050 }, (_, i) => rec(id(i + 1), start + i * 1_000, { text: `texto de teste ${i}` }))
    conversations.markSeen(start - 3_600_000)
    evo.records = [...records].reverse()
    events.start(client())
    await settle()
    await events.sync()
    await settle()
    const all = items(c)
    expect(all).toHaveLength(1_050)
    expect(new Set(all.map((x) => x.id)).size).toBe(1_050)
    const times = inbound.map((x) => x.item.t)
    expect(times).toHaveLength(1_050)
    expect(times).toEqual([...times].sort((x, y) => x - y))
    expect(conversations.lastSeen()).toBe(start + 1_049 * 1_000)
    // The query asked for the window, 100 at a time.
    const body = evo.callsTo('POST /chat/findMessages')[0].body as { where: { messageTimestamp: { gte: string } }; offset: number }
    expect(body.offset).toBe(100)
    expect(new Date(body.where.messageTimestamp.gte).getTime()).toBe(start - 3_600_000 - 30 * 60_000)
  })

  it('a busca ao conectar traz a mensagem perdida e o que foi respondido pelo celular', async () => {
    const c = customer()
    await linked({ records: fixture('find-messages').messages.records })
    const all = items(c)
    expect(all.map((x) => x.kind)).toEqual(['in', 'out'])
    expect(all[1]).toMatchObject({ by: { kind: 'phone' } })
    expect(fresh(c)).toMatchObject({ phoneChecked: true, phoneReplyAt: FAKE.t0 + 60_000, lastContactAt: FAKE.t0 + 60_000 })
  })

  it('parar ignora o que chega da conexão antiga', async () => {
    const c = customer()
    const s = await linked()
    events.stop()
    s.emit(fixture('event-messages-upsert'))
    expect(items(c)).toHaveLength(0)
    expect(s.closed).toBe(true)
  })
})
