import { describe, expect, it } from 'vitest'
import { CRM_LIMITS, type ConversationItem } from '@shared/types'
import {
  connectionDotTone,
  evolutionPort,
  portWarning,
  qrImage,
  findSentIn,
  composePortFix,
  connectionView,
  cleanWaLine,
  cleanWaText,
  cutText,
  inboundItem,
  jidKind,
  jidPhone,
  namespaceFrame,
  nextStatus,
  previewOf,
  readConnectionUpdate,
  readSocketFrame,
  readWaId,
  readWaMessage,
  readWaUpdate,
  reconnectDelay,
  recordTime,
  syncSince,
  SYNC_MARGIN_MS,
  waContent,
  waItemId,
  waState,
  waStatus,
  type WaMessage,
} from '@shared/crm-inbound'
import { FAKE, fixture } from './mocks/evolution'

const NOW = FAKE.t0 + 3_600_000
const variety = fixture<Record<string, unknown>>('messages-variety')
const read = (name: string) => readWaMessage(variety[name], NOW)
const msg = (name: string): WaMessage => {
  const r = read(name)
  if (!r.ok) throw new Error(`${name}: ${r.skip}`)
  return r.message
}

// Built from code points, so the source file carries no invisible characters.
const RLO = String.fromCodePoint(0x202e)
const LRM = String.fromCodePoint(0x200e)
const ISOLATE = String.fromCodePoint(0x2066)
const EMOJI = String.fromCodePoint(0x1f600)

describe('texto que chega do WhatsApp', () => {
  it('tira caracteres de controle e marcas de direção, guarda quebras de linha', () => {
    expect(cleanWaText(`  Maria ${RLO}odagap\u0000\u0007${LRM}\r\nlinha 2\t!  `)).toBe('Maria odagap\nlinha 2\t!')
    expect(cleanWaText(`a${ISOLATE}b`)).toBe('ab')
    expect(cleanWaText(`a${String.fromCharCode(0x2028)}b`)).toBe('a\nb')
  })

  it('corta em 4.000 caracteres sem partir um emoji ao meio', () => {
    expect(cleanWaText('a'.repeat(5000))).toHaveLength(CRM_LIMITS.messageText)
    const cut = cutText('a'.repeat(3) + EMOJI, 4)
    expect(cut).toBe('aaa')
    expect(cutText('abc', 10)).toBe('abc')
  })

  it('uma linha (nome, arquivo) junta espaços e tira quebras', () => {
    expect(cleanWaLine(`  nota\n fiscal${RLO}.pdf  `, 120)).toBe('nota fiscal.pdf')
    expect(cleanWaLine('abcdef', 3)).toBe('abc')
  })
})

describe('JID', () => {
  it('reconhece pessoa, grupo, status, transmissão, canal e lid', () => {
    expect(jidKind('5511900000001@s.whatsapp.net')).toBe('user')
    expect(jidKind('5511900000001:12@s.whatsapp.net')).toBe('user')
    expect(jidKind('5511900000001@c.us')).toBe('user')
    expect(jidKind('120363000000000001@g.us')).toBe('group')
    expect(jidKind('status@broadcast')).toBe('status')
    expect(jidKind('1794916800@broadcast')).toBe('broadcast')
    expect(jidKind('120363000000000002@newsletter')).toBe('newsletter')
    expect(jidKind('100000000000001@lid')).toBe('lid')
    expect(jidKind('qualquer coisa')).toBe('other')
  })

  it('tira o telefone de uma pessoa e põe o 9º dígito que o WhatsApp ainda não escreve', () => {
    expect(jidPhone('5511900000001@s.whatsapp.net')).toBe('5511900000001')
    expect(jidPhone('553188880001@s.whatsapp.net')).toBe('5531988880001')
    expect(jidPhone('5511900000001:3@s.whatsapp.net')).toBe('5511900000001')
    expect(jidPhone('14155550123@s.whatsapp.net')).toBe('14155550123')
    expect(jidPhone('120363000000000001@g.us')).toBeNull()
    expect(jidPhone('100000000000001@lid')).toBeNull()
    expect(jidPhone(undefined)).toBeNull()
  })
})

describe('mensagem', () => {
  it('lê a mensagem do evento messages.upsert', () => {
    const r = readWaMessage(fixture('event-messages-upsert').data, NOW)
    expect(r).toEqual({
      ok: true,
      message: {
        waId: '3A5F0C1D2E3F4A5B6C7D',
        phone: FAKE.customer,
        fromMe: false,
        t: FAKE.t0,
        text: 'texto de teste',
        pushName: 'Cliente Teste',
      },
    })
  })

  it('lê texto, texto estendido, legenda, áudio, documento e o que vem embrulhado', () => {
    expect(msg('text').text).toBe('texto de teste')
    expect(msg('extended').text).toBe('texto de teste')
    expect(msg('image')).toMatchObject({ text: 'texto de teste', media: { type: 'image' } })
    expect(msg('audio')).toMatchObject({ text: '', media: { type: 'audio' } })
    expect(msg('document')).toMatchObject({ text: '', media: { type: 'document', name: 'contrato.pdf' } })
    expect(msg('documentWithCaption')).toMatchObject({ text: 'texto de teste', media: { type: 'document', name: 'nota.pdf' } })
    expect(msg('ephemeral').text).toBe('texto de teste')
    expect(msg('sticker')).toMatchObject({ text: '', media: { type: 'other' } })
    expect(msg('button').text).toBe('Sim')
  })

  it('descarta grupo, status, transmissão e canal', () => {
    expect(read('group')).toEqual({ ok: false, skip: 'group' })
    expect(read('status')).toEqual({ ok: false, skip: 'status' })
    expect(read('broadcast')).toEqual({ ok: false, skip: 'broadcast' })
    expect(read('newsletter')).toEqual({ ok: false, skip: 'newsletter' })
  })

  it('reação, edição, troca de chaves e id estranho não viram mensagem', () => {
    expect(read('reaction')).toEqual({ ok: false, skip: 'not-message' })
    expect(read('protocol')).toEqual({ ok: false, skip: 'not-message' })
    expect(read('contextOnly')).toEqual({ ok: false, skip: 'not-message' })
    expect(read('badId')).toEqual({ ok: false, skip: 'invalid' })
    expect(readWaMessage(null, NOW)).toEqual({ ok: false, skip: 'invalid' })
    expect(readWaMessage({ key: { id: '3A00000000000000000001' } }, NOW)).toEqual({ ok: false, skip: 'invalid' })
  })

  it('lid usa o telefone do campo alternativo; sem ele, fica de fora', () => {
    expect(msg('lidWithPhone').phone).toBe(FAKE.customer)
    expect(read('lidOnly')).toEqual({ ok: false, skip: 'lid' })
  })

  it('celular antigo ganha o 9º dígito; hora do futuro vira agora', () => {
    expect(msg('oldMobile').phone).toBe('5531988880001')
    expect(msg('future').t).toBe(NOW)
  })

  it('mensagem enviada daqui não leva o nome do perfil ("Você")', () => {
    const m = readWaMessage(fixture('event-messages-upsert-from-phone').data, NOW)
    expect(m.ok && m.message).toMatchObject({ fromMe: true, phone: FAKE.customer })
    expect(m.ok && m.message.pushName).toBeUndefined()
  })

  it('o nome do perfil chega limpo e cortado', () => {
    const raw = structuredClone(variety.text) as { pushName: string }
    raw.pushName = `Cliente${RLO} Teste\n${'x'.repeat(300)}`
    const r = readWaMessage(raw, NOW)
    expect(r.ok && r.message.pushName?.startsWith('Cliente Teste x')).toBe(true)
    expect(r.ok && r.message.pushName?.length).toBe(CRM_LIMITS.name)
  })

  it('aceita a hora como texto e sem hora usa agora', () => {
    const raw = structuredClone(variety.text) as { messageTimestamp: unknown }
    raw.messageTimestamp = String(FAKE.t0 / 1000)
    expect(readWaMessage(raw, NOW)).toMatchObject({ ok: true, message: { t: FAKE.t0 } })
    delete (raw as { messageTimestamp?: unknown }).messageTimestamp
    expect(readWaMessage(raw, NOW)).toMatchObject({ ok: true, message: { t: NOW } })
    expect(recordTime(variety.group, NOW)).toBe(FAKE.t0)
    expect(recordTime({}, NOW)).toBeUndefined()
  })

  it('waContent sem mensagem é nada', () => {
    expect(waContent(null)).toBeNull()
    expect(waContent({})).toBeNull()
    expect(waContent({ locationMessage: { degreesLatitude: 0 } })).toEqual({ text: '', media: { type: 'other' } })
    expect(waContent({ listResponseMessage: { title: 'Opção 2' } })).toEqual({ text: 'Opção 2' })
  })

  it('o id do send.message', () => {
    expect(readWaId(fixture('event-send-message').data)).toBe('3EB0A1B2C3D4E5F6A7B8C9')
    expect(readWaId({ key: { id: '../x' } })).toBeNull()
    expect(readWaId(null)).toBeNull()
  })
})

describe('item da conversa', () => {
  it('mensagem do cliente vira item "in" com o id da mensagem', () => {
    const item = inboundItem(msg('image'), () => false)
    expect(item).toEqual({
      id: 'wa-3A00000000000000000003',
      t: FAKE.t0,
      kind: 'in',
      text: 'texto de teste',
      waId: '3A00000000000000000003',
      media: { type: 'image' },
    })
    expect(waItemId('ABC1')).toBe('wa-ABC1')
  })

  it('mensagem daqui que o app enviou não entra de novo', () => {
    const m = { ...msg('text'), fromMe: true }
    expect(inboundItem(m, (id) => id === m.waId)).toBeNull()
  })

  it('mensagem daqui que o app não enviou entra como resposta pelo celular', () => {
    const m = { ...msg('audio'), fromMe: true }
    expect(inboundItem(m, () => false)).toEqual({
      id: 'wa-3A00000000000000000004',
      t: FAKE.t0,
      kind: 'out',
      text: '(mídia enviada pelo celular)',
      by: { kind: 'phone' },
      status: 'sent',
      waId: '3A00000000000000000004',
    })
  })
})

describe('entrega', () => {
  it('traduz os estados do Baileys', () => {
    expect(waStatus('SERVER_ACK')).toBe('sent')
    expect(waStatus('DELIVERY_ACK')).toBe('delivered')
    expect(waStatus('READ')).toBe('read')
    expect(waStatus('PLAYED')).toBe('read')
    expect(waStatus('ERROR')).toBe('failed')
    expect(waStatus('PENDING')).toBeNull()
  })

  it('lê o messages.update', () => {
    expect(readWaUpdate(fixture('event-messages-update').data)).toEqual({
      waId: '3EB0A1B2C3D4E5F6A7B8C9',
      phone: FAKE.customer,
      fromMe: true,
      status: 'delivered',
    })
    expect(readWaUpdate({ keyId: '3EB0A1B2C3D4E5F6A7B8C9', remoteJid: '100000000000001@lid', fromMe: true, status: 'READ' })).toEqual({
      waId: '3EB0A1B2C3D4E5F6A7B8C9',
      fromMe: true,
      status: 'read',
    })
    expect(readWaUpdate({ keyId: '3EB0A1B2C3D4E5F6A7B8C9', status: 'PENDING' })).toBeNull()
    expect(readWaUpdate('x')).toBeNull()
  })

  it('o estado só anda para a frente', () => {
    expect(nextStatus('sent', 'delivered')).toBe('delivered')
    expect(nextStatus('read', 'delivered')).toBe('read')
    expect(nextStatus('delivered', 'sent')).toBe('delivered')
    expect(nextStatus('sent', 'failed')).toBe('failed')
    expect(nextStatus('delivered', 'failed')).toBe('delivered')
    expect(nextStatus('failed', 'read')).toBe('read')
    expect(nextStatus('failed', 'sent')).toBe('failed')
    expect(nextStatus('queued', 'sent')).toBe('sent')
  })
})

describe('conexão', () => {
  it('traduz o estado da instância', () => {
    expect(waState('open')).toBe('open')
    expect(waState('connecting')).toBe('connecting')
    expect(waState('close')).toBe('close')
    expect(waState('refused')).toBe('close')
    expect(waState(undefined)).toBe('close')
  })

  it('lê o connection.update, com o número conectado', () => {
    expect(readConnectionUpdate(fixture('event-connection-update').data)).toEqual({ state: 'open', phone: FAKE.own })
    expect(readConnectionUpdate(fixture('event-connection-refused').data)).toEqual({ state: 'close', refused: true })
    expect(readConnectionUpdate({ state: 'connecting' })).toEqual({ state: 'connecting' })
    expect(readConnectionUpdate({})).toBeNull()
  })

  it('mostra o estado em palavras', () => {
    expect(connectionView({ state: 'off' })).toMatchObject({ tone: 'off', label: 'WhatsApp não configurado' })
    expect(connectionView({ state: 'off', error: 'Use https.' })).toMatchObject({ tone: 'error', detail: 'Use https.' })
    expect(connectionView({ state: 'open', instance: 'teste', version: '2.3.7', via: 'websocket' })).toEqual({
      tone: 'on',
      label: 'WhatsApp conectado',
      detail: 'Instância teste · Evolution 2.3.7 · mensagens chegam na hora',
    })
    expect(connectionView({ state: 'open', via: 'polling' }).detail).toBe('buscando mensagens a cada 20 s')
    expect(connectionView({ state: 'connecting' }).tone).toBe('busy')
    expect(connectionView({ state: 'close', error: 'O QR code expirou.' }).detail).toBe('O QR code expirou.')
    expect(connectionView({ state: 'close' }).detail).toMatch(/Conectar/)
    expect(connectionView({ state: 'error', error: 'Não consegui falar.' })).toMatchObject({ tone: 'error', detail: 'Não consegui falar.' })
    expect(connectionView({ state: 'error' }).detail).toMatch(/ligada/)
  })

  it('a linha do docker-compose a trocar', () => {
    expect(composePortFix(8080)).toEqual({ from: '- "8080:8080"', to: '- "127.0.0.1:8080:8080"' })
    expect(composePortFix(9090)).toEqual({ from: '- "9090:8080"', to: '- "127.0.0.1:9090:8080"' })
    expect(composePortFix(0).to).toBe('- "127.0.0.1:8080:8080"')
  })
})

describe('socket.io à mão', () => {
  const inst = FAKE.instance
  it('lê abertura, ping, fechamento, entrada no canal e recusa', () => {
    expect(readSocketFrame('0{"sid":"x","pingInterval":25000,"pingTimeout":20000}', inst)).toEqual({
      type: 'open',
      pingInterval: 25_000,
      pingTimeout: 20_000,
    })
    expect(readSocketFrame('0{"sid":"x"}', inst)).toEqual({ type: 'open', pingInterval: 25_000, pingTimeout: 20_000 })
    expect(readSocketFrame('0{"pingInterval":1}', inst)).toMatchObject({ pingInterval: 1_000 })
    expect(readSocketFrame('0nada', inst)).toEqual({ type: 'other' })
    expect(readSocketFrame('2', inst)).toEqual({ type: 'ping' })
    expect(readSocketFrame('1', inst)).toEqual({ type: 'close' })
    expect(readSocketFrame('40/teste,{"sid":"y"}', inst)).toEqual({ type: 'connected' })
    expect(readSocketFrame('41/teste,', inst)).toEqual({ type: 'disconnected' })
    expect(readSocketFrame('44/teste,{"message":"apiKey is required"}', inst)).toEqual({ type: 'refused', message: 'apiKey is required' })
    expect(namespaceFrame(inst)).toBe('40/teste,')
  })

  it('lê um evento do canal da instância, com ou sem id de resposta', () => {
    const env = fixture('event-messages-upsert')
    const frame = `42/teste,${JSON.stringify(['messages.upsert', env])}`
    expect(readSocketFrame(frame, inst)).toEqual({ type: 'event', name: 'messages.upsert', payload: env })
    expect(readSocketFrame(`42/teste,7${JSON.stringify(['messages.upsert', env])}`, inst)).toMatchObject({ type: 'event' })
  })

  it('ignora outro canal, evento desconhecido e lixo', () => {
    const env = fixture('event-messages-upsert')
    expect(readSocketFrame(`42/outra,${JSON.stringify(['messages.upsert', env])}`, inst)).toEqual({ type: 'other' })
    expect(readSocketFrame(`42${JSON.stringify(['messages.upsert', env])}`, inst)).toEqual({ type: 'other' })
    expect(readSocketFrame(`42/teste,${JSON.stringify(['chats.upsert', env])}`, inst)).toEqual({ type: 'other' })
    expect(readSocketFrame('42/teste,["messages.upsert","texto"]', inst)).toEqual({ type: 'other' })
    expect(readSocketFrame('42/teste,{nao json', inst)).toEqual({ type: 'other' })
    expect(readSocketFrame('43/teste,[]', inst)).toEqual({ type: 'other' })
    expect(readSocketFrame('6', inst)).toEqual({ type: 'other' })
    expect(readSocketFrame('', inst)).toEqual({ type: 'other' })
    expect(readSocketFrame(`42/teste,${'x'.repeat(2 * 1024 * 1024)}`, inst)).toEqual({ type: 'other' })
  })

  it('reconecta de 1 s a 60 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 30].map(reconnectDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000])
    expect(reconnectDelay(-3)).toBe(1_000)
  })
})

describe('sincronização', () => {
  it('a primeira vez começa agora; depois, da última vista menos a margem', () => {
    expect(syncSince(undefined, NOW)).toBe(NOW)
    expect(syncSince(FAKE.t0, NOW)).toBe(FAKE.t0 - SYNC_MARGIN_MS)
    expect(syncSince(NOW + 1_000, NOW)).toBe(NOW - SYNC_MARGIN_MS)
  })
})

describe('lista de conversas', () => {
  const at = { id: 'x', t: 1 }
  it('a prévia é texto puro, de até 140 caracteres', () => {
    expect(previewOf({ ...at, kind: 'in', text: 'oi\ntudo bem?', waId: 'ABCD' })).toBe('oi tudo bem?')
    expect(previewOf({ ...at, kind: 'in', text: '', waId: 'ABCD', media: { type: 'audio' } })).toBe('[Áudio]')
    expect(previewOf({ ...at, kind: 'in', text: 'segue', waId: 'ABCD', media: { type: 'document', name: 'nota.pdf' } })).toBe(
      '[nota.pdf] segue',
    )
    expect(previewOf({ ...at, kind: 'out', text: 'x'.repeat(500), by: { kind: 'player' }, status: 'sent' })).toHaveLength(140)
    expect(previewOf({ ...at, kind: 'notice', text: 'aviso' })).toBe('aviso')
    const draft = { ...at, kind: 'draft', draft: { text: 'rascunho' } } as unknown as ConversationItem
    expect(previewOf(draft)).toBe('rascunho')
  })
})

describe('conferir um envio (findSent)', () => {
  const rec = (id: string, message: unknown, o: { fromMe?: unknown; sec?: number; jid?: string } = {}) => ({
    key: { remoteJid: o.jid ?? `${FAKE.customer}@s.whatsapp.net`, fromMe: o.fromMe ?? true, id },
    message,
    messageTimestamp: o.sec ?? 1_794_916_800,
  })
  const q = { phone: FAKE.customer, text: 'texto de teste\nlinha 2', since: FAKE.t0 }

  it('compara o texto limpo, nas duas pontas', () => {
    expect(findSentIn([rec('3EB0AAAA', { conversation: 'texto de teste\r\nlinha 2' })], q)).toBe('3EB0AAAA')
    expect(findSentIn([rec('3EB0AAAB', { extendedTextMessage: { text: 'texto de teste\nlinha 2' } })], q)).toBe('3EB0AAAB')
    expect(findSentIn([rec('3EB0AAAC', { conversation: 'texto de teste' })], q)).toBeUndefined()
  })

  it('deixa de fora mídia, a mensagem do cliente, o que veio antes e o que está fora do formato', () => {
    expect(findSentIn([rec('3EB0AAAD', { imageMessage: { caption: q.text } })], q)).toBeUndefined()
    expect(findSentIn([rec('3EB0AAAE', { conversation: q.text }, { fromMe: false })], q)).toBeUndefined()
    expect(findSentIn([rec('3EB0AAAF', { conversation: q.text }, { sec: 1_794_916_799 })], q)).toBeUndefined()
    expect(findSentIn([rec('<b>', { conversation: q.text }), null, 'x', { key: 1 }], q)).toBeUndefined()
    expect(findSentIn([rec('3EB0AAB0', { conversation: q.text }, { jid: '120363000000000001@g.us' })], q)).toBeUndefined()
    expect(findSentIn([rec('3EB0AAB1', { conversation: q.text })], { ...q, phone: 'abc' })).toBeUndefined()
    expect(findSentIn([rec('3EB0AAB2', { conversation: '' })], { ...q, text: '' })).toBeUndefined()
  })
})

describe('tela de conexão', () => {
  it('QR code só como PNG em data URL', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    expect(qrImage(png)).toBe(png)
    expect(qrImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeUndefined()
    expect(qrImage('javascript:alert(1)')).toBeUndefined()
    expect(qrImage('data:image/png;base64,"><script>')).toBeUndefined()
    expect(qrImage(undefined)).toBeUndefined()
  })

  it('o ponto do topo: verde, âmbar, vermelho ou cinza', () => {
    expect(connectionDotTone({ state: 'open', via: 'websocket' })).toBe('on')
    expect(connectionDotTone({ state: 'connecting' })).toBe('busy')
    expect(connectionDotTone({ state: 'close' })).toBe('error')
    expect(connectionDotTone({ state: 'error', error: 'Sem rede.' })).toBe('error')
    expect(connectionDotTone({ state: 'off' })).toBe('off')
    expect(connectionDotTone({ state: 'off', error: 'Use https.' })).toBe('error')
  })

  it('porta aberta na rede gera o aviso, com a linha do docker-compose a trocar', () => {
    expect(portWarning({ state: 'open', lanExposed: true }, 'http://localhost:8080')).toEqual({
      port: 8080,
      from: '- "8080:8080"',
      to: '- "127.0.0.1:8080:8080"',
    })
    expect(portWarning({ state: 'connecting', lanExposed: true }, 'http://127.0.0.1:9090')).toMatchObject({
      port: 9090,
      to: '- "127.0.0.1:9090:8080"',
    })
  })

  it('porta só local não gera o aviso', () => {
    expect(portWarning({ state: 'open', lanExposed: false }, 'http://localhost:8080')).toBeUndefined()
    // Not checked yet, or a remote Evolution (https): no warning either.
    expect(portWarning({ state: 'open' }, 'http://localhost:8080')).toBeUndefined()
    expect(portWarning({ state: 'open' }, 'https://evolution.exemplo.com.br')).toBeUndefined()
  })

  it('a porta do endereço, para a linha do docker-compose', () => {
    expect(evolutionPort('http://localhost:8080')).toBe(8080)
    expect(evolutionPort('http://127.0.0.1:9090/')).toBe(9090)
    expect(evolutionPort('http://[::1]:8081')).toBe(8081)
    expect(evolutionPort('http://localhost')).toBe(80)
    expect(evolutionPort('https://evolution.exemplo.com.br')).toBe(443)
    expect(evolutionPort('lixo')).toBe(8080)
  })
})
