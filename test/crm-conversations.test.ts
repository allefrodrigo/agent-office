import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConversationItem, Draft } from '@shared/types'
import { ConversationStore } from '../src/main/crm/conversations'

const unix = process.platform !== 'win32'
const mode = (p: string) => statSync(p).mode & 0o777
const C = 'cliente-1'
const D = 'cliente-2'

let dir: string
let opened: ConversationStore[] = []
const open = () => {
  const s = new ConversationStore(dir)
  opened.push(s)
  return s
}

const inbound = (n: number, t = n * 1000): ConversationItem => ({ id: `wa-IN${n}`, t, kind: 'in', text: `texto de teste ${n}`, waId: `IN${n}` })
const out = (n: number, t = n * 1000, status: 'sent' | 'delivered' = 'sent'): ConversationItem => ({
  id: `out-${n}`,
  t,
  kind: 'out',
  text: `resposta ${n}`,
  by: { kind: 'player' },
  status,
  waId: `OUT${n}`,
})
const draft = (n: number, status: Draft['status'], t = n * 1000): ConversationItem => ({
  id: `d-${n}`,
  t,
  kind: 'draft',
  draft: { id: `d-${n}`, customerId: C, category: 'service', text: `rascunho ${n}`, by: { kind: 'player' }, createdAt: t, status },
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-conversas-'))
})
afterEach(() => {
  for (const s of opened) s.flush()
  opened = []
  rmSync(dir, { recursive: true, force: true })
})

describe('conversas', () => {
  it('guarda em JSONL só anexando, pasta 0700 e arquivo 0600', () => {
    const s = open()
    s.put(C, inbound(1))
    s.put(C, out(2))
    const file = join(s.dir, `${C}.jsonl`)
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2)
    if (unix) {
      expect(mode(file)).toBe(0o600)
      expect(mode(s.dir)).toBe(0o700)
      expect(mode(join(dir, 'crm'))).toBe(0o700)
    }
    s.flush()
    if (unix) expect(mode(join(s.dir, 'index.json'))).toBe(0o600)
  })

  it('mesmo id atualiza; a leitura fica com a versão mais nova', () => {
    const s = open()
    s.put(C, out(1))
    s.put(C, out(1, 1000, 'delivered'))
    expect(s.get(C, 'out-1')).toMatchObject({ status: 'delivered' })
    expect(s.page(C).items).toHaveLength(1)
    expect(open().get(C, 'out-1')).toMatchObject({ status: 'delivered' })
  })

  it('páginas de trás para frente, pela hora (mensagem fora de ordem entra no lugar)', () => {
    const s = open()
    for (let n = 1; n <= 150; n++) if (n !== 75) s.put(C, inbound(n))
    s.put(C, inbound(75))
    const last = s.page(C)
    expect(last.items).toHaveLength(100)
    expect(last.more).toBe(true)
    expect(last.items[0].id).toBe('wa-IN51')
    expect(last.items[99].id).toBe('wa-IN150')
    expect(last.items.map((x) => x.t)).toEqual([...last.items.map((x) => x.t)].sort((a, b) => a - b))
    const older = s.page(C, last.items[0].id)
    expect(older.items).toHaveLength(50)
    expect(older.items[0].id).toBe('wa-IN1')
    expect(last.items[24].id).toBe('wa-IN75')
    expect(older.more).toBe(false)
    expect(s.page(C, 'wa-IN1')).toEqual({ items: [], more: false })
    expect(s.page(C, undefined, 10).items).toHaveLength(10)
    expect(s.page(C, 'nao-existe', 5).items.map((x) => x.id)).toEqual(['wa-IN146', 'wa-IN147', 'wa-IN148', 'wa-IN149', 'wa-IN150'])
    expect(s.page('sem-conversa')).toEqual({ items: [], more: false })
  })

  it('o que enviamos desde uma hora, do mais velho ao mais novo', () => {
    const s = open()
    s.put(C, out(3))
    s.put(C, inbound(2))
    s.put(C, out(1))
    s.put(C, out(5))
    expect(s.sentSince(C, 2000).map((x) => x.id)).toEqual(['out-3', 'out-5'])
    expect(s.sentSince(C, 0).map((x) => x.id)).toEqual(['out-1', 'out-3', 'out-5'])
  })

  it('resumos: o mais novo primeiro, com prévia, não lidas e marcar como lida', () => {
    const s = open()
    s.put(C, inbound(1))
    s.put(C, inbound(2))
    s.put(D, inbound(3))
    s.put(D, out(4))
    expect(s.summaries()).toEqual([
      { customerId: D, t: 4000, preview: 'resposta 4', previewKind: 'out', unread: 1 },
      { customerId: C, t: 2000, preview: 'texto de teste 2', previewKind: 'in', unread: 2 },
    ])
    // A repeated message does not count twice.
    s.put(C, inbound(2))
    expect(s.summary(C)?.unread).toBe(2)
    expect(s.markRead(C)).toMatchObject({ unread: 0 })
    expect(s.markRead('sem-conversa')).toBeUndefined()
  })

  it('mensagem velha que chega tarde não troca a prévia', () => {
    const s = open()
    s.put(C, inbound(5))
    s.put(C, inbound(1))
    expect(s.summary(C)).toMatchObject({ t: 5000, preview: 'texto de teste 5' })
    // An update of the item on show refreshes the preview.
    s.put(C, { ...(inbound(5) as Extract<ConversationItem, { kind: 'in' }>), text: 'editado' })
    expect(s.summary(C)?.preview).toBe('editado')
  })

  it('"Esperando você": rascunho, envio barrado e contato novo', () => {
    const s = open()
    s.put(C, inbound(1))
    expect(s.setWaiting(C, 'new-contact')).toMatchObject({ waiting: 'new-contact' })
    s.put(C, draft(2, 'pending'))
    expect(s.summary(C)).toMatchObject({ waiting: 'draft', preview: 'rascunho 2', previewKind: 'draft' })
    s.put(C, draft(2, 'sent'))
    expect(s.summary(C)?.waiting).toBe('new-contact')
    s.markRead(C)
    expect(s.summary(C)?.waiting).toBeUndefined()
    s.put(C, draft(3, 'blocked'))
    expect(s.summary(C)?.waiting).toBe('blocked')
    s.put(C, draft(3, 'discarded'))
    expect(s.setWaiting(C, 'handoff')).toMatchObject({ waiting: 'handoff' })
    expect(s.setWaiting(C, undefined)?.waiting).toBeUndefined()
    expect(s.setWaiting('sem-conversa', 'handoff')).toBeUndefined()
  })

  it('acha a mensagem pelo id do WhatsApp e o cliente dela', () => {
    const s = open()
    s.put(C, out(1))
    expect(s.findByWaId(C, 'OUT1')?.id).toBe('out-1')
    expect(s.findByWaId(C, 'OUT9')).toBeUndefined()
    expect(s.customerOfWa('OUT1')).toBe(C)
    expect(open().findByWaId(C, 'OUT1')?.id).toBe('out-1')
  })

  it('apagar o cliente (LGPD) apaga a conversa', () => {
    const s = open()
    s.put(C, out(1))
    s.put(D, inbound(1))
    s.remove(C)
    expect(existsSync(join(s.dir, `${C}.jsonl`))).toBe(false)
    expect(s.summaries().map((x) => x.customerId)).toEqual([D])
    expect(s.customerOfWa('OUT1')).toBeUndefined()
    s.flush()
    expect(open().summaries().map((x) => x.customerId)).toEqual([D])
  })

  it('recusa id de cliente que é caminho e item fora do formato', () => {
    const s = open()
    expect(() => s.put('../../etc', inbound(1))).toThrow('Esse cliente não existe mais.')
    expect(() => s.get('a/b', 'x')).toThrow()
    expect(() => s.put(C, { ...inbound(1), id: '../x' })).toThrow('Item de conversa inválido.')
    expect(() => s.put(C, { id: 'x', t: 1, kind: 'in' } as unknown as ConversationItem)).toThrow('Item de conversa inválido.')
  })

  it('reabre do disco: índice, última mensagem vista e linhas ruins de fora', () => {
    const s = open()
    s.put(C, inbound(1))
    s.markSeen(5000)
    s.markSeen(4000)
    s.flush()
    appendFileSync(join(s.dir, `${C}.jsonl`), '{linha quebrada\n{"id":"sem-tipo","t":1}\n')
    const again = open()
    expect(again.lastSeen()).toBe(5000)
    expect(again.page(C).items.map((x) => x.id)).toEqual(['wa-IN1'])
    expect(again.summaries()).toHaveLength(1)
  })

  it('sem índice (ou com ele estragado), refaz a partir dos fios', () => {
    const s = open()
    s.put(C, inbound(1))
    s.put(D, out(2))
    s.flush()
    rmSync(join(s.dir, 'index.json'))
    const rebuilt = open()
    expect(rebuilt.summaries().map((x) => x.customerId)).toEqual([D, C])
    expect(rebuilt.lastSeen()).toBe(2000)
    writeFileSync(join(s.dir, 'index.json'), '{"v":2}')
    expect(open().summaries()).toHaveLength(2)
  })

  it('o app fechou antes do índice: o fio mais novo que ele entra de novo', () => {
    const s = open()
    s.put(C, inbound(1))
    s.flush()
    // Closed without flush: the line is on disk, the index is not.
    appendFileSync(join(s.dir, `${D}.jsonl`), JSON.stringify(inbound(9)) + '\n')
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(s.dir, 'index.json'), past, past)
    utimesSync(join(s.dir, `${C}.jsonl`), past, past)
    const again = open()
    expect(again.summaries().map((x) => x.customerId)).toEqual([D, C])
  })

  it('compacta o arquivo quando as versões velhas passam do limite', () => {
    const s = open()
    for (let i = 0; i < 260; i++) s.put(C, { ...out(1), text: `versão ${i}` })
    const lines = readFileSync(join(s.dir, `${C}.jsonl`), 'utf8').trim().split('\n')
    expect(lines.length).toBeLessThan(60)
    expect(open().get(C, 'out-1')).toMatchObject({ text: 'versão 259' })
  })
})
