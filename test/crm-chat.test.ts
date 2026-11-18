process.env.TZ = 'America/Sao_Paulo'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationItem, ConversationSummary, CrmConnection, Customer, Draft, GateDecision, OfficeEvent } from '@shared/types'
import type { GateInput } from '@shared/crm-gate'
import { OPT_OUT_REPLY } from '@shared/crm-keywords'
import { AuditFile, textHash } from '../src/main/crm/audit'
import { CrmChat, type ChatLog } from '../src/main/crm/chat'
import type { EvolutionSender, OutItem } from '../src/main/crm/contracts'
import { Outbox, type GatePort } from '../src/main/crm/outbox'
import { CrmStore } from '../src/main/crm/store'
import { crmChatHandlers } from '../src/main/ipc/crm-chat'

// CR-14: a aba Conversas no main, com a fila de verdade, um portão falso (o de verdade é o CR-11),
// uma conversa em memória e uma Evolution falsa. Nada aqui fala com uma Evolution de verdade.

const SEC = 1000
const MIN = 60 * SEC
const T0 = new Date(2026, 10, 18, 10, 0).getTime()

// ---------- falsos ----------

class FakeLog implements ChatLog {
  items = new Map<string, Map<string, ConversationItem>>()
  waiting = new Map<string, 'handoff' | 'new-contact'>()
  read: string[] = []
  removed: string[] = []
  private all(customerId: string): ConversationItem[] {
    return [...(this.items.get(customerId)?.values() ?? [])].sort((a, b) => a.t - b.t)
  }
  put(customerId: string, item: ConversationItem): void {
    if (!this.items.has(customerId)) this.items.set(customerId, new Map())
    this.items.get(customerId)?.set(item.id, structuredClone(item))
  }
  get(customerId: string, itemId: string): ConversationItem | undefined {
    return this.items.get(customerId)?.get(itemId)
  }
  sentSince(customerId: string, since: number): OutItem[] {
    return this.all(customerId).filter((i): i is OutItem => i.kind === 'out' && i.t >= since)
  }
  page(customerId: string, before?: string) {
    const all = this.all(customerId)
    const end = before ? all.findIndex((x) => x.id === before) : all.length
    return { items: all.slice(0, end < 0 ? all.length : end), more: false }
  }
  summary(customerId: string): ConversationSummary | undefined {
    const all = this.all(customerId)
    if (!all.length) return undefined
    const last = all[all.length - 1]
    const w = this.waiting.get(customerId)
    return { customerId, t: last.t, preview: '', previewKind: last.kind, unread: 0, ...(w ? { waiting: w } : {}) }
  }
  summaries(): ConversationSummary[] {
    return [...this.items.keys()].map((id) => this.summary(id)).filter((x): x is ConversationSummary => !!x)
  }
  markRead(customerId: string): ConversationSummary | undefined {
    this.read.push(customerId)
    return this.summary(customerId)
  }
  setWaiting(customerId: string, flag: 'handoff' | 'new-contact' | undefined): ConversationSummary | undefined {
    if (flag) this.waiting.set(customerId, flag)
    else this.waiting.delete(customerId)
    return this.summary(customerId)
  }
  remove(customerId: string): void {
    this.removed.push(customerId)
    this.items.delete(customerId)
  }
  kinds(customerId: string): ConversationItem['kind'][] {
    return this.all(customerId).map((x) => x.kind)
  }
  notices(customerId: string): string[] {
    return this.all(customerId).flatMap((x) => (x.kind === 'notice' ? [x.text] : []))
  }
}

class FakeSender implements EvolutionSender {
  sent: { number: string; text: string }[] = []
  onSend?: () => void
  async sendText(number: string, text: string): Promise<{ waId: string }> {
    this.onSend?.()
    await new Promise((r) => setTimeout(r, 200))
    this.sent.push({ number, text })
    return { waId: `wa-${this.sent.length}` }
  }
  async sendDocument(): Promise<{ waId: string }> {
    throw new Error('sem documento nestes testes')
  }
  async presence(): Promise<void> {}
  async findSent(): Promise<{ waId: string } | null> {
    return null
  }
}

const connection = {
  connected: () => true,
  ownNumber: () => '5511999990000',
  current: (): CrmConnection => ({ state: 'open' }),
}

let decide: (i: GateInput) => GateDecision
let inputs: GateInput[]
const port: GatePort = {
  gate: (i) => {
    inputs.push(structuredClone(i))
    return decide(i)
  },
  fillPayment: (text) => text,
}

// ---------- montagem ----------

let dir: string
let store: CrmStore
let log: FakeLog
let sender: FakeSender
let audit: AuditFile
let outbox: Outbox
let chat: CrmChat
let events: OfficeEvent[]
let maria: Customer
let check: ((n: string) => Promise<boolean>) | null

const inbound = (id: string, text: string, t = Date.now()): ConversationItem => {
  const item: ConversationItem = { id, t, kind: 'in', text, waId: `x${id}` }
  log.put(maria.id, item)
  return item
}
const botDraft = (over: Partial<Draft> = {}): Draft => {
  const d: Draft = {
    id: 'd1',
    customerId: maria.id,
    category: 'service',
    text: 'Oi, Maria! Já confiro.',
    by: { kind: 'bot', botId: 'b1' },
    createdAt: Date.now(),
    status: 'held',
    decision: { action: 'hold', rule: 14, reason: 'Espera você: Atendimento está em Aprovação' },
    ...over,
  }
  log.put(maria.id, { id: d.id, t: d.createdAt, kind: 'draft', draft: d })
  return d
}
const types = () => events.map((e) => e.type)

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-chat-'))
  store = new CrmStore(dir, { now: () => Date.now() })
  log = new FakeLog()
  sender = new FakeSender()
  audit = new AuditFile(dir)
  events = []
  inputs = []
  decide = () => ({ action: 'send', rule: 0, reason: 'Dentro da regra.' })
  check = async () => true
  outbox = new Outbox({
    store,
    conversations: log,
    sender,
    connection,
    audit,
    broadcast: (e) => events.push(e),
    gate: port,
    random: () => 0,
  })
  chat = new CrmChat({ store, conversations: log, outbox, audit, checkNumber: () => check, broadcast: (e) => events.push(e) })
  maria = store.saveCustomer({ name: 'Maria', phones: ['5511900000001'] }).item
  maria = store.patchCustomer(maria.id, { phoneChecked: true }).item
})

afterEach(() => {
  outbox.close()
  store.lock()
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

// ---------- testes ----------

describe('CrmChat.conversation', () => {
  it('a primeira página marca como lida e avisa a lista; voltar páginas não marca', () => {
    inbound('a', 'oi', T0 - 2 * MIN)
    inbound('b', 'tudo bem?', T0 - MIN)
    expect(chat.conversation(maria.id).items.map((x) => x.id)).toEqual(['a', 'b'])
    expect(log.read).toEqual([maria.id])
    expect(types()).toContain('crm:summary')
    expect(chat.conversation(maria.id, 'b').items.map((x) => x.id)).toEqual(['a'])
    expect(log.read).toHaveLength(1)
  })

  it('cliente que não existe dá erro claro', () => {
    expect(() => chat.conversation('nao-existe')).toThrow(/não existe mais/)
  })
})

describe('CrmChat.send: enviar à mão', () => {
  it('vira um rascunho seu, aprovado, que vai para a fila e sai', async () => {
    const saved = chat.send({ customerId: maria.id, category: 'service', text: 'Bom dia, Maria!' })
    expect(saved.by).toEqual({ kind: 'player' })
    expect(saved.status).toBe('scheduled')
    expect(inputs[0].approved).toBe(true)
    expect(inputs[0].override).toBe(false)
    await vi.advanceTimersByTimeAsync(10 * SEC)
    expect(sender.sent).toEqual([{ number: '5511900000001', text: 'Bom dia, Maria!' }])
    expect(log.kinds(maria.id)).toEqual(['draft', 'out'])
  })

  it('responde a última mensagem recebida sem resposta depois dela', () => {
    inbound('in1', 'quanto custa?', T0 - 5 * MIN)
    const d = chat.send({ customerId: maria.id, category: 'service', text: 'R$ 480.' })
    expect(d.replyTo).toBe('in1')
    expect(d.replyAt).toBe(T0 - 5 * MIN)
  })

  it('depois de uma enviada, a mensagem nova não é resposta (conta como iniciada)', () => {
    inbound('in1', 'obrigada', T0 - 10 * MIN)
    log.put(maria.id, { id: 'o1', t: T0 - 5 * MIN, kind: 'out', text: 'de nada', by: { kind: 'player' }, status: 'sent' })
    expect(chat.send({ customerId: maria.id, category: 'service', text: 'Mais alguma coisa?' }).replyTo).toBeUndefined()
  })

  it('replyTo da tela que não é mensagem recebida é ignorado', () => {
    log.put(maria.id, { id: 'o1', t: T0 - 5 * MIN, kind: 'out', text: 'oi', by: { kind: 'player' }, status: 'sent' })
    expect(chat.send({ customerId: maria.id, category: 'service', text: 'oi de novo', replyTo: 'o1' }).replyTo).toBeUndefined()
  })

  it('"Enviar mesmo assim" chega ao portão como override', () => {
    chat.send({ customerId: maria.id, category: 'service', text: 'Fora do horário', override: true })
    expect(inputs[0].override).toBe(true)
  })

  it('o portão barra: o rascunho volta com o motivo e nada sai', async () => {
    decide = () => ({ action: 'block', rule: 4, reason: 'Barrada: o cliente saiu das ofertas.' })
    const d = chat.send({ customerId: maria.id, category: 'offer', text: 'Promoção!' })
    expect(d.status).toBe('blocked')
    expect(d.decision?.rule).toBe(4)
    await vi.advanceTimersByTimeAsync(10 * SEC)
    expect(sender.sent).toEqual([])
  })
})

describe('CrmChat.draft: o cartão do rascunho', () => {
  it('Enviar aprova o rascunho do bot com a rodada da própria conversa', () => {
    botDraft()
    const d = chat.draft(maria.id, 'd1', 'send')
    expect(d.status).toBe('scheduled')
    expect(inputs[0].approved).toBe(true)
    expect(inputs[0].run).toEqual({ kind: 'customer', customerId: maria.id })
    expect(inputs[0].draft.edited).toBe(false)
  })

  it('texto editado num rascunho do bot continua texto de modelo (edited)', () => {
    botDraft()
    const d = chat.draft(maria.id, 'd1', 'send', 'Oi, Maria! Confiro agora.')
    expect(d.text).toBe('Oi, Maria! Confiro agora.')
    expect(d.edited).toBe(true)
    expect(inputs[0].draft.edited).toBe(true)
  })

  it('Enviar mesmo assim passa override; Descartar não chama o portão', () => {
    botDraft()
    chat.draft(maria.id, 'd1', 'override')
    expect(inputs[0].override).toBe(true)
    botDraft({ id: 'd2' })
    const gone = chat.draft(maria.id, 'd2', 'discard')
    expect(gone.status).toBe('discarded')
    expect(inputs).toHaveLength(1)
  })

  it('rascunho já decidido, sumido ou de outro cliente dá erro', () => {
    botDraft({ status: 'sent' })
    expect(() => chat.draft(maria.id, 'd1', 'send')).toThrow(/já foi enviado/)
    expect(() => chat.draft(maria.id, 'nada', 'send')).toThrow(/não existe mais/)
    const ana = store.saveCustomer({ name: 'Ana', phones: ['5511900000002'] }).item
    botDraft({ id: 'd3' })
    expect(() => chat.draft(ana.id, 'd3', 'send')).toThrow(/não existe mais/)
  })
})

describe('CrmChat.handOff', () => {
  it('Passar para mim liga a marca, põe em "Esperando você" e escreve um aviso; devolver tira', () => {
    const c = chat.handOff(maria.id, true)
    expect(c.handedToPlayer).toBe(true)
    expect(log.waiting.get(maria.id)).toBe('handoff')
    expect(log.notices(maria.id)).toHaveLength(1)
    // de novo não repete o aviso
    chat.handOff(maria.id, true)
    expect(log.notices(maria.id)).toHaveLength(1)
    expect(chat.handOff(maria.id, false).handedToPlayer).toBeUndefined()
    expect(log.waiting.has(maria.id)).toBe(false)
    expect(log.notices(maria.id)[1]).toMatch(/voltou para o bot/)
  })
})

describe('CrmChat.checkPhone', () => {
  it('sem conexão, pede para conectar', async () => {
    check = null
    await expect(chat.checkPhone(maria.id)).rejects.toThrow(/Conecte o WhatsApp/)
  })

  it('número sem WhatsApp: erro com o telefone mascarado', async () => {
    check = async () => false
    const err = await chat.checkPhone(maria.id).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toContain('5511900000001')
  })

  it('número com WhatsApp: fica conferido', async () => {
    const ana = store.saveCustomer({ name: 'Ana', phones: ['5511900000002'] }).item
    expect(ana.phoneChecked).toBeUndefined()
    expect((await chat.checkPhone(ana.id)).phoneChecked).toBe(true)
  })
})

describe('CrmChat.stopAll', () => {
  it('liga cancelando a fila; só você desliga', async () => {
    decide = () => ({ action: 'schedule', rule: 10, reason: 'Fora do horário.', at: T0 + 60 * MIN })
    chat.send({ customerId: maria.id, category: 'service', text: 'Amanhã cedo' })
    expect(chat.stopAll(true).stopAll).toBe(true)
    expect(store.outbox.every((x) => x.state === 'canceled')).toBe(true)
    expect(chat.stopAll(false).stopAll).toBe(false)
  })
})

describe('CrmChat.inbound: o que chega', () => {
  it('palavra de saída tira das ofertas na hora, põe a confirmação na fila e um aviso no fio', () => {
    const item = inbound('in1', 'PARAR')
    chat.inbound(maria.id, item)
    const c = store.customer(maria.id)
    expect(c?.consent.offers).toBe(false)
    expect(c?.consent.optOutAt).toBe(T0)
    const confirm = inputs.find((i) => i.draft.text === OPT_OUT_REPLY)
    expect(confirm?.draft.by).toBe('system')
    expect(confirm?.draft.replyTo?.id).toBe('in1')
    expect(log.notices(maria.id).join(' ')).toMatch(/sair das ofertas/)
  })

  it('"não quero parar" não tira das ofertas', () => {
    chat.inbound(maria.id, inbound('in1', 'não quero parar de receber'))
    expect(store.customer(maria.id)?.consent.optOutAt).toBeUndefined()
    expect(inputs).toHaveLength(0)
  })

  it('palavra de alerta passa a conversa para você, uma vez', () => {
    chat.inbound(maria.id, inbound('in1', 'quero falar com um atendente'))
    expect(store.customer(maria.id)?.handedToPlayer).toBe(true)
    expect(log.waiting.get(maria.id)).toBe('handoff')
    chat.inbound(maria.id, inbound('in2', 'atendente, por favor'))
    expect(log.notices(maria.id)).toHaveLength(1)
  })

  it('mensagem enviada ou rascunho não disparam nada', () => {
    chat.inbound(maria.id, { id: 'o', t: T0, kind: 'out', text: 'PARAR', by: { kind: 'phone' }, status: 'sent' })
    expect(store.customer(maria.id)?.consent.optOutAt).toBeUndefined()
  })
})

describe('CrmChat.forget: apagar o cliente', () => {
  it('leva a conversa, os itens da fila (com o texto) e o nome na auditoria', () => {
    decide = () => ({ action: 'schedule', rule: 10, reason: 'Fora do horário.', at: T0 + 60 * MIN })
    chat.send({ customerId: maria.id, category: 'service', text: 'Amanhã cedo' })
    decide = () => ({ action: 'block', rule: 8, reason: 'Repetida.' })
    chat.send({ customerId: maria.id, category: 'service', text: 'Repetida' })
    const keys = store.outbox.map((x) => x.key)
    expect(keys).toHaveLength(1)
    const delta = chat.forget(maria.id)
    expect(delta.outboxRemoved).toEqual(keys)
    expect(store.outbox).toEqual([])
    expect(log.removed).toEqual([maria.id])
    const lines = audit.read()
    expect(lines.length).toBeGreaterThan(0)
    expect(JSON.stringify(lines)).not.toContain(maria.id)
  })

  it('um envio no meio do caminho termina sem escrever nada sobre o cliente apagado', async () => {
    sender.onSend = () => {
      chat.forget(maria.id)
      store.deleteCustomer(maria.id)
    }
    chat.send({ customerId: maria.id, category: 'service', text: 'Oi!' })
    await vi.advanceTimersByTimeAsync(10 * SEC)
    expect(sender.sent).toHaveLength(1)
    expect(log.items.get(maria.id)).toBeUndefined()
    expect(store.outbox).toEqual([])
    const lines = audit.read()
    expect(JSON.stringify(lines)).not.toContain(maria.id)
    expect(lines.some((l) => 'outcome' in l && l.outcome === 'sent' && l.customerId === '(apagado)' && l.hash === textHash('Oi!'))).toBe(
      true,
    )
  })
})

describe('IPC da aba Conversas', () => {
  it('confere cada argumento antes do CrmChat', () => {
    const h = crmChatHandlers(chat)
    expect(() => h['office:crmConversation']('../x')).toThrow()
    expect(() => h['office:crmSend']({ customerId: maria.id, category: 'spam', text: 'oi' })).toThrow()
    expect(() => h['office:crmSend']({ customerId: maria.id, category: 'service', text: '   ' })).toThrow()
    expect(() => h['office:crmDraft'](maria.id, 'd1', 'aprovar')).toThrow()
    expect(() => h['office:crmDraft'](maria.id, '../d1', 'send')).toThrow()
    expect(() => h['office:crmHandOff'](maria.id, 'sim')).toThrow()
    expect(() => h['office:crmStopAll']('true')).toThrow()
    expect(h['office:crmConversations']()).toEqual([])
  })
})
