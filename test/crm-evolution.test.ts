import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EvolutionClient, evolutionBase, lanExposed, lanIPv4, MAX_PRESENCE_MS } from '../src/main/crm/evolution'
import { EvolutionError } from '../src/main/crm/contracts'
import { CrmVault, DEFAULT_EVOLUTION_URL, NO_VAULT, VAULT_FILE, type Sealer } from '../src/main/crm/vault'
import { redact } from '../src/main/log'
import { FAKE, FakeEvolution, fixture, hang } from './mocks/evolution'

const unix = process.platform !== 'win32'
const mode = (p: string) => statSync(p).mode & 0o777

let evo: FakeEvolution
const client = (over: Partial<{ url: string; instance: string; token: string; timeoutMs: number }> = {}) =>
  new EvolutionClient({ url: FAKE.url, instance: FAKE.instance, token: FAKE.token, fetch: evo.fetch, ...over })

/** The error a promise rejects with (fails the test when it resolves). */
async function failure(p: Promise<unknown>): Promise<EvolutionError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(EvolutionError)
    return err as EvolutionError
  }
  throw new Error('devia ter falhado')
}

beforeEach(() => {
  evo = new FakeEvolution()
})

describe('endereço da Evolution', () => {
  it('aceita esta máquina por http e o resto só por https', () => {
    expect(evolutionBase('http://localhost:8080')).toEqual({ base: 'http://localhost:8080', host: 'localhost:8080', port: 8080, local: true })
    expect(evolutionBase(' http://127.0.0.1:8080/ ').local).toBe(true)
    expect(evolutionBase('http://127.10.0.1:9000').local).toBe(true)
    expect(evolutionBase('http://[::1]:8080').base).toBe('http://[::1]:8080')
    expect(evolutionBase('HTTP://LOCALHOST:8080').base).toBe('http://localhost:8080')
    expect(evolutionBase('https://evo.exemplo.com.br')).toEqual({ base: 'https://evo.exemplo.com.br', host: 'evo.exemplo.com.br', port: 443, local: false })
    expect(evolutionBase('https://evo.exemplo.com.br/api/').base).toBe('https://evo.exemplo.com.br/api')
    expect(evolutionBase('http://localhost').port).toBe(80)
  })

  it('recusa http:// fora desta máquina', () => {
    for (const url of ['http://evo.exemplo.com.br', 'http://192.168.0.10:8080', 'http://10.0.0.2:8080'])
      expect(() => evolutionBase(url)).toThrow(/só com https/)
  })

  it('recusa nomes que só parecem locais: 127.evil.com, 0.0.0.0, *.localhost, 127.1, localhost.', () => {
    for (const url of [
      'http://127.evil.com:8080',
      'http://127.0.0.1.evil.com',
      'http://0.0.0.0:8080',
      'http://evil.localhost:8080',
      'http://127.1:8080',
      'http://2130706433:8080',
      'http://0x7f.0.0.1:8080',
      'http://127.000.000.001:8080',
      'http://localhost.:8080',
      'http://[::ffff:127.0.0.1]:8080',
    ])
      expect(() => evolutionBase(url), url).toThrow(EvolutionError)
  })

  it('recusa usuário e senha, ? e #, outro protocolo e caminho estranho', () => {
    expect(() => evolutionBase('http://user:senha@localhost:8080')).toThrow(/usuário e a senha/)
    expect(() => evolutionBase('http://evil.com@localhost:8080')).toThrow(/usuário e a senha/)
    expect(() => evolutionBase('http://localhost:8080/?x=1')).toThrow(/\? e o #/)
    expect(() => evolutionBase('http://localhost:8080#a')).toThrow(/\? e o #/)
    expect(() => evolutionBase('ftp://localhost')).toThrow(/Endereço inválido/)
    expect(() => evolutionBase('localhost:8080')).toThrow(/Endereço inválido/)
    expect(() => evolutionBase('https://evo.com/../x')).toThrow(/caminho/)
    expect(() => evolutionBase('https://evo.com/a%2f')).toThrow(/caminho/)
    expect(() => evolutionBase('http://local\\host')).toThrow(EvolutionError)
    expect(() => evolutionBase('')).toThrow(/Informe o endereço/)
    expect(() => evolutionBase(`https://${'a'.repeat(300)}.com`)).toThrow(/grande demais/)
    try {
      evolutionBase('http://evil.com')
    } catch (err) {
      expect((err as EvolutionError).kind).toBe('config')
    }
  })
})

describe('cliente da Evolution', () => {
  it('manda o token só no cabeçalho apikey, nunca na URL, e não segue redirecionamento', async () => {
    expect(await client().state()).toBe('open')
    const call = evo.calls[0]
    expect(call.headers.apikey).toBe(FAKE.token)
    expect(call.url).toBe('http://localhost:8080/instance/connectionState/teste')
    expect(call.url).not.toContain(FAKE.token)
    expect(call.redirect).toBe('manual')
  })

  it('redirecionamento vira erro, sem seguir', async () => {
    evo.on('GET /instance/connectionState', { status: 302, headers: { location: 'https://evil.com/' }, raw: '' })
    const err = await failure(client().state())
    expect(err.kind).toBe('config')
    expect(err.message).toMatch(/redirecionamento \(HTTP 302\)/)
    expect(evo.calls).toHaveLength(1)
  })

  it('para em 15 s', async () => {
    evo.on('GET /instance/connectionState', hang)
    const err = await failure(client({ timeoutMs: 30 }).state())
    expect(err.kind).toBe('timeout')
    expect(err.retryable).toBe(true)
    expect(err.message).toMatch(/não respondeu em 0 s ao ler o estado/)
    expect(client().state).toBeDefined()
  })

  it('servidor fora do ar: o pedido nem saiu (recusado), com o que fazer', async () => {
    const failing = (cause: unknown) =>
      new EvolutionClient({
        url: FAKE.url,
        instance: FAKE.instance,
        token: FAKE.token,
        fetch: async () => {
          throw Object.assign(new TypeError('fetch failed'), { cause })
        },
      })
    const err = await failure(failing({ code: 'ECONNREFUSED' }).state())
    expect(err.kind).toBe('refused')
    expect(err.retryable).toBe(true)
    expect(err.maybeDelivered).toBe(false)
    expect(err.message).toMatch(/Não consegui falar com a Evolution em localhost:8080 ao ler o estado. Confira se ela está ligada/)
    // localhost has two addresses: Node joins the refusals in an AggregateError.
    expect((await failure(failing({ errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] }).state())).kind).toBe('refused')
    expect((await failure(failing({ code: 'ENOTFOUND' }).state())).kind).toBe('refused')
    expect((await failure(failing({ code: 'UND_ERR_CONNECT_TIMEOUT' }).state())).kind).toBe('refused')
  })

  it('conexão que cai depois de enviar é erro de rede: a mensagem pode ter saído', async () => {
    const reset = new EvolutionClient({
      url: FAKE.url,
      instance: FAKE.instance,
      token: FAKE.token,
      fetch: async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
      },
    })
    const err = await failure(reset.sendText(FAKE.customer, 'texto de teste'))
    expect(err.kind).toBe('network')
    expect(err.maybeDelivered).toBe(true)
    expect(err.message).toMatch(/caiu ao enviar a mensagem/)
    // Unknown failure: on doubt, it may have gone out.
    const odd = new EvolutionClient({ url: FAKE.url, instance: FAKE.instance, token: FAKE.token, fetch: async () => Promise.reject(new TypeError('fetch failed')) })
    expect((await failure(odd.state())).kind).toBe('network')
    // The answer began and broke midway: never "refused", even with a connect-like code.
    const broken = new EvolutionClient({
      url: FAKE.url,
      instance: FAKE.instance,
      token: FAKE.token,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.error(Object.assign(new TypeError('terminated'), { cause: { code: 'ECONNREFUSED' } }))
            },
          }),
          { status: 201 },
        ),
    })
    expect((await failure(broken.sendText(FAKE.customer, 'texto de teste'))).kind).toBe('network')
  })

  it('resposta acima de 2 MB é cortada e vira erro', async () => {
    evo.on('POST /chat/findMessages', { status: 200, raw: `{"x":"${'a'.repeat(2 * 1024 * 1024)}"}` })
    const err = await failure(client().findMessages({ page: 1 }))
    expect(err.kind).toBe('schema')
    expect(err.message).toMatch(/passou de 2 MB/)
    evo.on('POST /chat/findMessages', { status: 200, raw: '{}', headers: { 'content-length': String(3 * 1024 * 1024) } })
    expect((await failure(client().findMessages({ page: 1 }))).message).toMatch(/passou de 2 MB/)
  })

  it('resposta fora do esquema vira erro claro', async () => {
    evo.on('GET /instance/connectionState', { status: 200, body: { estado: 'aberto' } })
    const err = await failure(client().state())
    expect(err.kind).toBe('schema')
    expect(err.message).toBe('A Evolution respondeu fora do esperado ao ler o estado. Confira se o servidor é a Evolution API 2.3 (a testada é a 2.3.7).')
    evo.on('GET /instance/connectionState', { status: 200, raw: '<html>proxy</html>' })
    expect((await failure(client().state())).kind).toBe('schema')
    evo.on('POST /message/sendText', { status: 201, body: { key: { id: '../../etc' } } })
    expect((await failure(client().sendText(FAKE.customer, 'texto de teste'))).kind).toBe('schema')
  })

  it('token recusado, instância que não existe, 429 e 5xx dizem o que fazer', async () => {
    const wrong = await failure(client({ token: '99999999-2222-4333-8444-555555555555' }).state())
    expect(wrong).toMatchObject({ kind: 'http4xx', status: 401 })
    expect(wrong.message).toMatch(/recusou o token \(HTTP 401\) ao ler o estado. Cole de novo o token da instância "teste"/)
    expect(wrong.retryable).toBe(false)
    const other = await failure(client({ instance: 'outra' }).state())
    expect(other.message).toBe('A instância "outra" não existe nesse servidor. Confira o nome no painel da Evolution.')
    evo.on('GET /instance/connectionState', { status: 429, body: {} })
    expect((await failure(client().state())).message).toMatch(/pediu para esperar/)
    evo.on('GET /instance/connectionState', { status: 500, body: {} })
    const down = await failure(client().state())
    expect(down).toMatchObject({ kind: 'http5xx', status: 500 })
    expect(down.retryable).toBe(true)
    evo.on('GET /instance/connectionState', { status: 418, body: {} })
    expect((await failure(client().state())).message).toMatch(/recusou o pedido \(HTTP 418\)/)
    evo.on('POST /message/sendMedia', { status: 413, body: {} })
    expect((await failure(client().sendDocument(FAKE.customer, { fileName: 'a.pdf', base64: 'QUJD' }))).message).toMatch(/grande demais/)
  })

  it('rota que não existe (outra versão) diz qual chamada falhou', async () => {
    evo.on('POST /chat/sendPresence', { status: 404, body: fixture('instance-not-found') })
    expect((await failure(client().presence(FAKE.customer, 1000))).message).toMatch(/não existe nesse servidor/)
    const odd = new FakeEvolution()
    const c = new EvolutionClient({ url: FAKE.url, instance: FAKE.instance, token: FAKE.token, fetch: odd.fetch })
    odd.on('GET /instance/connectionState', { status: 404, body: { response: { message: ['Cannot GET /x'] } } })
    expect((await failure(c.state())).message).toMatch(/não tem essa rota \(HTTP 404\) ao ler o estado/)
  })

  it('o token nunca aparece num erro nem no log', async () => {
    const errors: string[] = []
    const cases: [string, unknown][] = [
      ['GET /instance/connectionState', { status: 401, body: { response: { message: [FAKE.token] } } }],
      ['GET /instance/connectionState', { status: 500, body: { token: FAKE.token } }],
      ['GET /instance/connectionState', { status: 200, body: { token: FAKE.token } }],
      ['GET /instance/connectionState', { status: 302, raw: '' }],
    ]
    for (const [route, reply] of cases) {
      evo.on(route, reply as never)
      errors.push((await failure(client().state())).message)
    }
    evo.on('POST /chat/findMessages', hang)
    errors.push((await failure(client({ timeoutMs: 20 }).findMessages({}))).message)
    for (const e of errors) expect(e).not.toContain(FAKE.token)
    // EvolutionClient registers the token with secret(): whatever reaches the log is redacted.
    expect(redact(`apikey usado: ${FAKE.token}`)).not.toContain(FAKE.token)
    expect(JSON.stringify(client())).not.toContain(FAKE.token)
  }, 10_000)

  it('recusa endereço, instância e token ruins antes de qualquer chamada', () => {
    expect(() => client({ url: 'http://evil.com' })).toThrow(/só com https/)
    expect(() => client({ instance: '../admin' })).toThrow(/Nome de instância inválido/)
    expect(() => client({ token: '' })).toThrow(/Cole o token/)
    expect(() => client({ token: 'com espaço' })).toThrow(/Cole o token/)
    expect(evo.calls).toHaveLength(0)
  })

  it('número só com dígitos e DDI; JID escolhido por fora não passa', async () => {
    for (const n of ['5511900000001@s.whatsapp.net', '120363000000000001@g.us', '+5511900000001', '123', '55119000000011234', 'status@broadcast']) {
      const err = await failure(client().sendText(n, 'texto de teste'))
      expect(err.kind).toBe('config')
    }
    await failure(client().checkNumber('1@g.us'))
    await failure(client().presence('x', 100))
    await failure(client().sendDocument('x', { fileName: 'a.pdf', base64: 'QUJD' }))
    expect(evo.callsTo('POST /message/sendText')).toHaveLength(0)
  })

  it('sendText manda número, texto e sem prévia de link; devolve o id da mensagem', async () => {
    expect(await client().sendText(FAKE.customer, 'texto de teste')).toEqual({ waId: '3EB0A1B2C3D4E5F6A7B8C9' })
    const [call] = evo.callsTo('POST /message/sendText')
    expect(call.instance).toBe('teste')
    expect(call.body).toEqual({ number: FAKE.customer, text: 'texto de teste', linkPreview: false })
    await failure(client().sendText(FAKE.customer, '   '))
    await failure(client().sendText(FAKE.customer, 'x'.repeat(4_001)))
  })

  it('número sem WhatsApp é um erro próprio', async () => {
    evo.on('POST /message/sendText', { status: 400, body: fixture('send-not-whatsapp') })
    const err = await failure(client().sendText('5511900000003', 'texto de teste'))
    expect(err).toMatchObject({ kind: 'not-whatsapp', status: 400 })
    expect(err.message).toBe('Esse número não tem WhatsApp. Confira o telefone na ficha do cliente.')
    expect(err.message).not.toContain('5511900000003')
  })

  it('sendDocument manda o PDF como documento, com nome limpo', async () => {
    expect(await client().sendDocument(FAKE.customer, { fileName: '../../fatura <nov>.PDF', base64: 'JVBERi0xLjQ=', caption: 'texto de teste' })).toEqual({
      waId: '3EB0B1B2C3D4E5F6A7B8C9',
    })
    expect(evo.callsTo('POST /message/sendMedia')[0].body).toEqual({
      number: FAKE.customer,
      mediatype: 'document',
      mimetype: 'application/pdf',
      fileName: 'fatura nov.PDF',
      media: 'JVBERi0xLjQ=',
      caption: 'texto de teste',
    })
    await client().sendDocument(FAKE.customer, { fileName: 'relatorio', base64: 'JVBERi0xLjQ=' })
    expect(evo.callsTo('POST /message/sendMedia')[1].body).toMatchObject({ fileName: 'relatorio.pdf' })
    await failure(client().sendDocument(FAKE.customer, { fileName: 'a.pdf', base64: 'não é base64' }))
  })

  it('"digitando…" dura no máximo 6 s', async () => {
    await client().presence(FAKE.customer, 60_000)
    await client().presence(FAKE.customer, -5)
    const calls = evo.callsTo('POST /chat/sendPresence')
    expect(calls[0].body).toEqual({ number: FAKE.customer, presence: 'composing', delay: MAX_PRESENCE_MS })
    expect((calls[1].body as { delay: number }).delay).toBe(0)
  })

  it('confere se o número tem WhatsApp', async () => {
    expect(await client().checkNumber(FAKE.customer)).toBe(true)
    expect(await client().checkNumber('5511900000003')).toBe(false)
    expect(evo.callsTo('POST /chat/whatsappNumbers')[0].body).toEqual({ numbers: [FAKE.customer] })
  })

  it('QR code, estado aberto e QR ainda não pronto', async () => {
    const qr = await client().qr()
    expect(qr.state).toBe('connecting')
    expect(qr.qr).toMatch(/^data:image\/png;base64,/)
    evo.on('GET /instance/connect', { status: 200, body: fixture('connect-open') })
    expect(await client().qr()).toEqual({ state: 'open' })
    evo.on('GET /instance/connect', { status: 200, body: { count: 0, pairingCode: 'ABCD-1234' } })
    expect(await client().qr()).toEqual({ state: 'connecting', pairingCode: 'ABCD-1234' })
    evo.on('GET /instance/connect', { status: 200, body: { base64: 'data:text/html;base64,PHNjcmlwdD4=' } })
    expect(await client().qr()).toEqual({ state: 'connecting' })
  })

  it('desconectar aceita a instância já desconectada', async () => {
    await client().logout()
    evo.on('DELETE /instance/logout', { status: 400, body: fixture('logout-not-connected') })
    await client().logout()
    evo.on('DELETE /instance/logout', { status: 400, body: { response: { message: ['outra coisa'] } } })
    await failure(client().logout())
  })

  it('estado fechado, número conectado e versão', async () => {
    evo.on('GET /instance/connectionState', { status: 200, body: fixture('connection-state-close') })
    expect(await client().state()).toBe('close')
    expect(await client().ownNumber()).toBe(FAKE.own)
    expect(evo.callsTo('GET /instance/fetchInstances')[0].query.get('instanceName')).toBe('teste')
    expect(await client().version()).toBe('2.3.7')
    expect(evo.callsTo('GET /')[0].headers.apikey).toBeUndefined()
    evo.on('GET /', { status: 200, body: { version: '<b>' } })
    expect(await client().version()).toBeUndefined()
  })

  it('busca mensagens por data, com página e tamanho', async () => {
    const r = await client().findMessages({ since: FAKE.t0, until: FAKE.t0 + 60_000, page: 1, size: 500 })
    expect(r).toMatchObject({ total: 4, pages: 1, page: 1 })
    expect(r.records).toHaveLength(4)
    expect(evo.callsTo('POST /chat/findMessages')[0].body).toEqual({
      where: { messageTimestamp: { gte: '2026-11-17T12:00:00.000Z', lte: '2026-11-17T12:01:00.000Z' } },
      page: 1,
      offset: 100,
    })
    expect((await client().findMessages({ since: FAKE.t0, until: FAKE.t0 + 60_000, page: 2, size: 2 })).records).toHaveLength(2)
    await client().findMessages({})
    expect(evo.callsTo('POST /chat/findMessages')[2].body).toEqual({ where: {}, page: 1, offset: 100 })
  })

  describe('findSent: a mensagem saiu mesmo?', () => {
    const at = Date.now()
    const sec = Math.floor(at / 1000)
    const ours = (id: string, o: { jid?: string; alt?: string; fromMe?: boolean; text?: string; sec?: number } = {}) => ({
      key: { remoteJid: o.jid ?? `${FAKE.customer}@s.whatsapp.net`, fromMe: o.fromMe ?? true, id, ...(o.alt ? { remoteJidAlt: o.alt } : {}) },
      message: { conversation: o.text ?? 'texto de teste' },
      messageTimestamp: o.sec ?? sec,
    })
    const find = (number: string = FAKE.customer) => client().findSent(number, 'texto de teste', at - 1_000)

    it('acha pelo número e pelo texto, só as nossas e desde a hora pedida', async () => {
      evo.records = [
        ours('3EB0000000000000000001', { text: 'outro texto' }),
        ours('3EB0000000000000000002', { fromMe: false }),
        ours('3EB0000000000000000003', { sec: sec - 120 }),
        ours('3EB0000000000000000004', { jid: '5511900000009@s.whatsapp.net' }),
      ]
      expect(await find()).toBeNull()
      const body = evo.callsTo('POST /chat/findMessages')[0].body as { where: { key: unknown; messageTimestamp: { gte: string } } }
      expect(body.where.key).toEqual({ fromMe: true })
      expect(body.where.messageTimestamp.gte).toBe(new Date(at - 1_000).toISOString())
      expect(body).toMatchObject({ page: 1, offset: 100 })
      evo.records.push(ours('3EB0000000000000000005'))
      expect(await find()).toEqual({ waId: '3EB0000000000000000005' })
    })

    it('o servidor guarda o JID sem o 9 ou um @lid: acha do mesmo jeito', async () => {
      evo.records = [ours('3EB0000000000000000006', { jid: '553188880001@s.whatsapp.net' })]
      expect(await find('5531988880001')).toEqual({ waId: '3EB0000000000000000006' })
      evo.records = [ours('3EB0000000000000000007', { jid: '123456789012345@lid', alt: `${FAKE.customer}@s.whatsapp.net` })]
      expect(await find()).toEqual({ waId: '3EB0000000000000000007' })
      // A @lid with no phone and the same text: on doubt, it went out (never send twice).
      evo.records = [ours('3EB0000000000000000008', { jid: '123456789012345@lid' })]
      expect(await find()).toEqual({ waId: '3EB0000000000000000008' })
      evo.records = [ours('3EB0000000000000000009', { jid: '123456789012345@lid', alt: '5511900000009@s.whatsapp.net' })]
      expect(await find()).toBeNull()
    })

    it('lê as páginas seguintes; sem conseguir saber, lança erro', async () => {
      const other = (n: number) => ours(`3EB1${String(n).padStart(18, '0')}`, { text: `outro texto ${n}` })
      evo.records = [ours('3EB0000000000000000010', { sec: sec - 1 }), ...Array.from({ length: 150 }, (_, i) => other(i))]
      expect(await find()).toEqual({ waId: '3EB0000000000000000010' })
      expect(evo.callsTo('POST /chat/findMessages').map((c) => (c.body as { page: number }).page)).toEqual([1, 2])
      evo.records = Array.from({ length: 350 }, (_, i) => other(i))
      expect((await failure(find())).message).toMatch(/Confira no celular/)
      evo.on('POST /chat/findMessages', { status: 500, body: {} })
      expect((await failure(find())).kind).toBe('http5xx')
      expect((await failure(client().findSent('5511900000001@s.whatsapp.net', 'texto de teste', at))).kind).toBe('config')
    })
  })

  it('reconhece a chave global colada no lugar do token, sem criar nada', async () => {
    expect(await client({ token: FAKE.global }).probeGlobalKey()).toBe(true)
    expect(await client().probeGlobalKey()).toBe(false)
    const body = evo.callsTo('POST /instance/create')[0].body as { instanceName: string; integration: string }
    expect(body.integration).toBe('NAO-EXISTE')
    expect(body.instanceName).toMatch(/^agent-office-sonda-[0-9a-f]{12}$/)
    evo.on('POST /instance/create', { status: 201, body: {} })
    expect(await client({ token: FAKE.global }).probeGlobalKey()).toBe(true)
    evo.on('POST /instance/create', { status: 500, body: {} })
    await failure(client().probeGlobalKey())
  })

  it('liga o WebSocket da instância com os eventos do CRM', async () => {
    expect(await client().setWebsocket()).toBe(true)
    expect(evo.callsTo('POST /websocket/set')[0].body).toEqual({
      websocket: { enabled: true, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'] },
    })
    // A server with WEBSOCKET_ENABLED=false answers with nothing.
    evo.on('POST /websocket/set', { status: 201, raw: '' })
    expect(await client().setWebsocket()).toBe(false)
  })

  it('abre o socket com o token no cabeçalho e o endereço do socket.io', () => {
    const opened: { url: string; headers: Record<string, string> }[] = []
    client().openEvents((url, headers) => {
      opened.push({ url, headers })
      return {} as never
    })
    new EvolutionClient({ url: 'https://evo.exemplo.com/api', instance: 'teste', token: FAKE.token, fetch: evo.fetch }).openEvents((url, headers) => {
      opened.push({ url, headers })
      return {} as never
    })
    expect(opened).toEqual([
      { url: 'ws://localhost:8080/socket.io/?EIO=4&transport=websocket', headers: { apikey: FAKE.token } },
      { url: 'wss://evo.exemplo.com/api/socket.io/?EIO=4&transport=websocket', headers: { apikey: FAKE.token } },
    ])
  })
})

describe('porta aberta na rede', () => {
  const ifaces = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: '192.168.0.112', family: 'IPv4', internal: false },
    ],
    bridge: [{ address: '169.254.10.1', family: 'IPv4', internal: false }],
    utun: [{ address: '10.8.0.2', family: 4, internal: false }],
  } as never

  it('só os IPv4 da rede, sem o loopback e o link-local', () => {
    expect(lanIPv4(ifaces)).toEqual(['192.168.0.112', '10.8.0.2'])
    expect(lanIPv4({} as never)).toEqual([])
  })

  it('a mesma porta respondendo pelo IP da rede é porta aberta', async () => {
    const asked: string[] = []
    const open = await lanExposed(8080, {
      interfaces: () => ifaces,
      fetch: (async (url: string) => {
        asked.push(url)
        if (url.startsWith('http://192.168.0.112:8080')) return new Response('{}')
        throw new TypeError('fetch failed')
      }) as never,
    })
    expect(open).toBe(true)
    expect(asked.sort()).toEqual(['http://10.8.0.2:8080/', 'http://192.168.0.112:8080/'])
  })

  it('porta só local (recusada pelos IPs da rede) não é aberta', async () => {
    const refused = (async () => {
      throw new TypeError('fetch failed')
    }) as never
    expect(await lanExposed(8080, { interfaces: () => ifaces, fetch: refused })).toBe(false)
    expect(await lanExposed(8080, { interfaces: () => ({}) as never, fetch: refused })).toBe(false)
  })
})

describe('cofre', () => {
  let dir: string
  /** A fake OS vault: reversible, but the plain token never shows in the file. */
  const sealer = (available = true): Sealer => ({
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`selado:${[...s].reverse().join('')}`),
    decryptString: (b) => [...b.toString().replace(/^selado:/, '')].reverse().join(''),
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ao-crm-cofre-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sem arquivo, o endereço padrão é a Evolution desta máquina', () => {
    expect(new CrmVault(dir, sealer()).settings()).toEqual({ url: DEFAULT_EVOLUTION_URL, instance: '', hasToken: false })
  })

  it('guarda o token selado, num arquivo 0600, e lê de volta', () => {
    const v = new CrmVault(dir, sealer())
    expect(v.save({ url: FAKE.url, instance: 'teste', token: FAKE.token })).toEqual({ url: FAKE.url, instance: 'teste', hasToken: true })
    const file = join(dir, VAULT_FILE)
    expect(readFileSync(file, 'utf8')).not.toContain(FAKE.token)
    if (unix) expect(mode(file)).toBe(0o600)
    expect(new CrmVault(dir, sealer()).token()).toBe(FAKE.token)
  })

  it('sem token no pedido, mantém; vazio, apaga', () => {
    const v = new CrmVault(dir, sealer())
    v.save({ url: FAKE.url, instance: 'teste', token: FAKE.token })
    v.save({ url: FAKE.url, instance: 'teste' })
    expect(v.token()).toBe(FAKE.token)
    v.save({ url: FAKE.url, instance: 'teste', token: '' })
    expect(v.settings().hasToken).toBe(false)
    expect(v.token()).toBeUndefined()
  })

  it('mudar o servidor ou a instância sem token novo apaga o token antigo', () => {
    const v = new CrmVault(dir, sealer())
    v.save({ url: FAKE.url, instance: 'teste', token: FAKE.token })
    v.save({ url: 'https://outro.exemplo.com', instance: 'teste' })
    expect(v.token()).toBeUndefined()
    v.save({ url: FAKE.url, instance: 'teste', token: FAKE.token })
    v.save({ url: FAKE.url, instance: 'outra' })
    expect(v.settings()).toEqual({ url: FAKE.url, instance: 'outra', hasToken: false })
  })

  it('sem cofre não guarda o token e diz o que fazer', () => {
    const v = new CrmVault(dir, sealer(false))
    expect(v.available()).toBe(false)
    expect(() => v.save({ url: FAKE.url, instance: 'teste', token: FAKE.token })).toThrow(NO_VAULT)
    expect(v.save({ url: FAKE.url, instance: 'teste' }).hasToken).toBe(false)
    expect(new CrmVault(dir, undefined).available()).toBe(false)
    const broken = { ...sealer(), isEncryptionAvailable: () => { throw new Error('x') } }
    expect(new CrmVault(dir, broken).available()).toBe(false)
  })

  it('no Linux sem chaveiro (basic_text) não conta como cofre', () => {
    const basic = { ...sealer(), getSelectedStorageBackend: () => 'basic_text' }
    expect(new CrmVault(dir, basic, 'linux').available()).toBe(false)
    expect(new CrmVault(dir, { ...sealer(), getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux').available()).toBe(true)
    expect(new CrmVault(dir, basic, 'darwin').available()).toBe(true)
  })

  it('arquivo estragado volta ao padrão; token que o cofre não abre some', () => {
    writeFileSync(join(dir, VAULT_FILE), '{ não é json')
    expect(new CrmVault(dir, sealer()).settings()).toEqual({ url: DEFAULT_EVOLUTION_URL, instance: '', hasToken: false })
    writeFileSync(join(dir, VAULT_FILE), JSON.stringify({ url: FAKE.url, instance: 'teste', sealed: 'QUJD' }))
    const failing = { ...sealer(), decryptString: () => { throw new Error('chave do cofre mudou') } }
    expect(new CrmVault(dir, failing).token()).toBeUndefined()
    expect(new CrmVault(dir, { ...sealer(), decryptString: () => 'com espaço' }).token()).toBeUndefined()
    writeFileSync(join(dir, VAULT_FILE), JSON.stringify({ url: 5, instance: ['x'], sealed: '<script>' }))
    expect(new CrmVault(dir, sealer()).settings()).toEqual({ url: DEFAULT_EVOLUTION_URL, instance: '', hasToken: false })
  })
})
