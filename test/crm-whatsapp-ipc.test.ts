import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfficeEvent } from '@shared/types'

// Configurações → CRM → WhatsApp (CR-10): os canais, a validação, o cofre e o aviso de porta
// aberta, contra a Evolution falsa. O token entra e nunca volta.

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, ...args: unknown[]) => unknown>(),
  vault: true,
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => h.handlers.set(channel, fn) },
  // A fake OS vault: reversible, but the plain token never shows in the file.
  safeStorage: {
    isEncryptionAvailable: () => h.vault,
    encryptString: (s: string) => Buffer.from(`selado:${[...s].reverse().join('')}`),
    decryptString: (b: Buffer) => [...b.toString().replace(/^selado:/, '')].reverse().join(''),
  },
}))

const { CrmStore } = await import('../src/main/crm/store')
const { ConversationStore } = await import('../src/main/crm/conversations')
const { EvolutionClient, lanExposed } = await import('../src/main/crm/evolution')
const { EvolutionEvents } = await import('../src/main/crm/events')
const { CrmVault, NO_VAULT, VAULT_FILE } = await import('../src/main/crm/vault')
const { NO_SELF_TEST, crmWhatsappApi, crmWhatsappHandlers, registerCrmWhatsappIpc } = await import('../src/main/ipc/crm-whatsapp')
const { FAKE, FakeEvolution, fakeSockets } = await import('./mocks/evolution')

const CHANNELS = [
  'office:crmWhatsapp',
  'office:saveCrmWhatsapp',
  'office:connectCrmWhatsapp',
  'office:testCrmWhatsapp',
  'office:disconnectCrmWhatsapp',
]
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
}

let dir: string
let store: InstanceType<typeof CrmStore>
let sent: OfficeEvent[]
let evo: InstanceType<typeof FakeEvolution>
let events: InstanceType<typeof EvolutionEvents>
let vault: InstanceType<typeof CrmVault>
let lan: boolean
let lanAsked: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-whatsapp-'))
  h.handlers.clear()
  h.vault = true
  store = new CrmStore(dir)
  sent = []
  evo = new FakeEvolution()
  evo.records = []
  lan = false
  lanAsked = 0
})

afterEach(async () => {
  events?.stop()
  await settle()
  store.lock()
  rmSync(dir, { recursive: true, force: true })
})

/** The api over the fake Evolution: no real network, no real socket. */
function api() {
  const conversations = new ConversationStore(dir)
  conversations.markSeen(FAKE.t0)
  vault = new CrmVault(dir)
  const lanCheck = async () => {
    lanAsked++
    return lan
  }
  events = new EvolutionEvents({ store, conversations, broadcast: (e) => sent.push(e), socket: fakeSockets().factory, lan: lanCheck })
  return crmWhatsappApi({
    vault,
    events,
    client: (cfg) => new EvolutionClient({ ...cfg, fetch: evo.fetch }),
    lan: lanCheck,
  })
}

const good = { url: FAKE.url, instance: FAKE.instance, token: FAKE.token }

describe('canais do WhatsApp', () => {
  it('registra os cinco canais e nada sai sem configuração', async () => {
    const wa = registerCrmWhatsappIpc({ crmStore: store, broadcast: (e) => sent.push(e) }, dir)
    events = wa.events
    expect([...h.handlers.keys()].sort()).toEqual([...CHANNELS].sort())
    expect(Object.keys(crmWhatsappHandlers(wa.api)).sort()).toEqual([...CHANNELS].sort())
    const call = (channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args)
    expect(await call('office:crmWhatsapp')).toEqual({
      url: 'http://localhost:8080',
      instance: '',
      hasToken: false,
      vault: true,
      connection: { state: 'off' },
    })
    expect(await call('office:testCrmWhatsapp')).toBe(NO_SELF_TEST)
    await expect(call('office:connectCrmWhatsapp')).rejects.toThrow(
      'Salve o endereço, a instância e o token da Evolution antes de conectar.',
    )
    await expect(call('office:disconnectCrmWhatsapp')).resolves.toBeUndefined()
    // Without a token, saving only keeps the address and the instance.
    const info = (await call('office:saveCrmWhatsapp', { url: FAKE.url, instance: FAKE.instance })) as {
      instance: string
      hasToken: boolean
    }
    expect(info).toMatchObject({ instance: FAKE.instance, hasToken: false })
    expect(wa.events.current().state).toBe('off')
  })

  it('argumento fora do formato é recusado com o que fazer', async () => {
    const a = api()
    await expect(a.save(null)).rejects.toThrow('Configuração do WhatsApp inválida. Feche e abra a tela de novo.')
    await expect(a.save({ url: '', instance: 'teste' })).rejects.toThrow('Informe o endereço da Evolution')
    await expect(a.save({ url: FAKE.url, instance: '../teste' })).rejects.toThrow('Nome de instância inválido')
    await expect(a.save({ url: FAKE.url, instance: 'teste', token: 'com espaço' })).rejects.toThrow('O token não tem espaços')
    await expect(a.save({ url: FAKE.url, instance: 'teste', token: 'x'.repeat(5_000) })).rejects.toThrow('grande demais')
    expect(evo.calls).toHaveLength(0)
  })

  it('recusa http fora desta máquina sem chamar o servidor', async () => {
    const a = api()
    await expect(a.save({ ...good, url: 'http://192.168.0.10:8080' })).rejects.toThrow(/https/)
    await expect(a.save({ ...good, url: 'http://127.evil.com:8080' })).rejects.toThrow()
    expect(evo.calls).toHaveLength(0)
    expect(vault.settings().hasToken).toBe(false)
  })

  it('recusa a chave global e o token que não abre a instância', async () => {
    const a = api()
    await expect(a.save({ ...good, token: FAKE.global })).rejects.toThrow('Isso é a chave global do servidor')
    await expect(a.save({ ...good, token: 'token-de-outra-instancia' })).rejects.toThrow('Esse token não abre a instância "teste"')
    expect(vault.settings().hasToken).toBe(false)
    // The probe never created an instance.
    expect(evo.callsTo('POST /instance/create').every((c) => (c.body as { integration: string }).integration === 'NAO-EXISTE')).toBe(true)
  })

  it('sem cofre do sistema não guarda token e diz o que fazer', async () => {
    h.vault = false
    const a = api()
    await expect(a.save(good)).rejects.toThrow(NO_VAULT)
    expect(a.info()).toMatchObject({ vault: false, hasToken: false })
  })

  it('guarda o token selado e ele nunca volta para a tela', async () => {
    const a = api()
    const info = await a.save(good)
    expect(info).toMatchObject({ url: FAKE.url, instance: FAKE.instance, hasToken: true, vault: true })
    expect(JSON.stringify(info)).not.toContain(FAKE.token)
    expect(readFileSync(join(dir, VAULT_FILE), 'utf8')).not.toContain(FAKE.token)
    await settle()
    expect(events.current()).toMatchObject({ state: 'open', instance: FAKE.instance })
    expect(JSON.stringify(a.info())).not.toContain(FAKE.token)
    expect(JSON.stringify(sent)).not.toContain(FAKE.token)
    // Saving again without a token keeps it.
    expect(await a.save({ url: FAKE.url, instance: FAKE.instance })).toMatchObject({ hasToken: true })
  })

  it('abrir a tela com token guardado liga a conexão', async () => {
    await api().save(good)
    events.stop()
    const a = api()
    expect(events.current().state).toBe('off')
    expect(a.info().connection.state).toBe('connecting')
    await settle()
    expect(a.info().connection.state).toBe('open')
  })

  it('Conectar devolve o QR code', async () => {
    const a = api()
    await a.save(good)
    const qr = await a.connect()
    expect(qr.qr).toMatch(/^data:image\/png;base64,/)
    expect(evo.callsTo('GET /instance/connect')).toHaveLength(1)
  })

  it('porta aberta na rede gera o aviso; porta só local não', async () => {
    const a = api()
    await a.save(good)
    lan = true
    await a.connect()
    expect(a.info().connection.lanExposed).toBe(true)
    lan = false
    await a.connect()
    expect(a.info().connection.lanExposed).toBe(false)
    expect(lanAsked).toBeGreaterThanOrEqual(2)
  })

  it('Evolution remota (https) não confere a porta', async () => {
    const remote = new FakeEvolution()
    remote.records = []
    const conversations = new ConversationStore(dir)
    conversations.markSeen(FAKE.t0)
    vault = new CrmVault(dir)
    let asked = 0
    events = new EvolutionEvents({ store, conversations, broadcast: () => undefined, socket: fakeSockets().factory })
    const a = crmWhatsappApi({
      vault,
      events,
      client: (cfg) => new EvolutionClient({ ...cfg, fetch: remote.fetch }),
      lan: async () => {
        asked++
        return true
      },
    })
    await a.save({ ...good, url: 'https://evolution.exemplo.com.br' })
    await a.connect()
    expect(asked).toBe(0)
    expect(a.info().connection.lanExposed).toBeUndefined()
  })

  it('Testar usa o teste da fila quando ele existe', async () => {
    const a = api()
    expect(await a.test()).toBe(NO_SELF_TEST)
    a.setSelfTest(async () => 'Mensagem de teste enviada para o seu número.')
    expect(await a.test()).toBe('Mensagem de teste enviada para o seu número.')
    a.setSelfTest(undefined)
    expect(await a.test()).toBe(NO_SELF_TEST)
  })

  it('Desconectar sai do WhatsApp e pergunta o estado de novo', async () => {
    const a = api()
    await a.save(good)
    await settle()
    evo.on('GET /instance/connectionState', { status: 200, body: { instance: { instanceName: FAKE.instance, state: 'close' } } })
    await a.disconnect()
    expect(evo.callsTo('DELETE /instance/logout')).toHaveLength(1)
    expect(events.current().state).toBe('close')
  })
})

describe('porta de verdade nesta máquina', () => {
  let server: Server | null = null
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
    server = null
  })

  it('servidor ouvindo só em 127.0.0.1 não aparece na rede', async () => {
    server = createServer((_req, res) => res.end('{}'))
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    expect(await lanExposed(port, { timeoutMs: 800 })).toBe(false)
  })
})
