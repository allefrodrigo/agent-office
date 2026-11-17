import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditFile, textHash } from '../src/main/crm/audit'
import type { AuditEntry } from '../src/main/crm/contracts'

// CR-13: a auditoria do CRM. Uma linha por envio e por decisão do portão, nunca o texto, só cresce;
// apagar o cliente deixa só a data, a categoria e o hash.

let dir: string
const mode = (p: string) => statSync(p).mode & 0o777
const unix = process.platform !== 'win32'
const lines = (a: AuditFile) => readFileSync(a.file, 'utf8').split('\n').filter(Boolean)

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  t: 1_763_470_800_000,
  customerId: 'c1',
  category: 'service',
  by: { kind: 'bot', botId: 'b1' },
  outcome: 'sent',
  rule: 0,
  hash: textHash('Oi, Maria!'),
  key: 'k-0000-0001',
  ...over,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-audit-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('textHash', () => {
  it('é o sha256 do texto, em hex', () => {
    expect(textHash('Oi, Maria!')).toBe(createHash('sha256').update('Oi, Maria!').digest('hex'))
    expect(textHash('')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('AuditFile.record', () => {
  it('anexa uma linha por chamada em userData/crm/auditoria.jsonl, pasta 0700 e arquivo 0600', () => {
    const a = new AuditFile(dir)
    expect(a.file).toBe(join(dir, 'crm', 'auditoria.jsonl'))
    a.record(entry())
    a.record(entry({ outcome: 'blocked', rule: 6, key: undefined }))
    expect(lines(a)).toHaveLength(2)
    if (unix) {
      expect(mode(a.file)).toBe(0o600)
      expect(mode(join(dir, 'crm'))).toBe(0o700)
    }
    expect(a.read()).toEqual(
      [entry(), { ...entry({ outcome: 'blocked', rule: 6 }), key: undefined }].map((e) => JSON.parse(JSON.stringify(e))),
    )
  })

  it('grava só os campos da auditoria: um texto ou telefone a mais nunca chega ao arquivo', () => {
    const a = new AuditFile(dir)
    const leaky = {
      ...entry(),
      text: 'Oi, Maria! PIX 123',
      phone: '5511900000001',
      by: { kind: 'player', secret: 'x' },
    } as unknown as AuditEntry
    a.record(leaky)
    const raw = readFileSync(a.file, 'utf8')
    expect(raw).not.toContain('Oi, Maria')
    expect(raw).not.toContain('5511900000001')
    expect(raw).not.toContain('secret')
    expect(JSON.parse(raw)).toEqual({
      t: entry().t,
      customerId: 'c1',
      category: 'service',
      by: { kind: 'player' },
      outcome: 'sent',
      rule: 0,
      hash: entry().hash,
      key: 'k-0000-0001',
    })
  })

  it('autor bot guarda o id do bot; celular e sistema, só o tipo', () => {
    const a = new AuditFile(dir)
    a.record(entry({ by: { kind: 'phone' } }))
    a.record(entry({ by: { kind: 'system' } }))
    expect(a.read().map((e) => ('by' in e ? e.by : null))).toEqual([{ kind: 'phone' }, { kind: 'system' }])
  })

  it('arquivo que já existia com outra permissão volta para 0600 ao abrir', () => {
    if (!unix) return
    new AuditFile(dir).record(entry())
    const file = join(dir, 'crm', 'auditoria.jsonl')
    chmodSync(file, 0o644)
    new AuditFile(dir)
    expect(mode(file)).toBe(0o600)
  })

  it('disco que recusa a linha não derruba quem chamou', () => {
    const a = new AuditFile(dir)
    rmSync(join(dir, 'crm'), { recursive: true, force: true })
    writeFileSync(join(dir, 'crm'), 'não é pasta')
    expect(() => a.record(entry())).not.toThrow()
  })
})

describe('AuditFile: só cresce', () => {
  it('cada envio e cada bloqueio acrescentam; nada some', () => {
    const a = new AuditFile(dir)
    const outcomes: AuditEntry['outcome'][] = ['sent', 'blocked', 'held', 'scheduled', 'canceled', 'failed']
    let before = ''
    for (const [i, outcome] of outcomes.entries()) {
      a.record(entry({ outcome, t: entry().t + i }))
      const now = readFileSync(a.file, 'utf8')
      expect(now.startsWith(before)).toBe(true)
      expect(now.length).toBeGreaterThan(before.length)
      before = now
    }
    expect(a.read().map((e) => ('outcome' in e ? e.outcome : null))).toEqual(outcomes)
  })
})

describe('AuditFile.forget: apagar o cliente', () => {
  it('as linhas do cliente ficam só com data, categoria e hash; as outras, byte a byte', () => {
    const a = new AuditFile(dir)
    a.record(entry({ customerId: 'c1', category: 'billing', outcome: 'sent' }))
    a.record(entry({ customerId: 'c10', category: 'service' }))
    a.record(entry({ customerId: 'c1', category: 'offer', outcome: 'blocked', rule: 4, by: { kind: 'player' } }))
    const [, other] = lines(a)
    a.forget('c1')
    const after = lines(a)
    expect(after).toHaveLength(3)
    expect(after[1]).toBe(other)
    expect(JSON.parse(after[0])).toEqual({ t: entry().t, category: 'billing', hash: entry().hash, forgotten: true })
    expect(JSON.parse(after[2])).toEqual({ t: entry().t, category: 'offer', hash: entry().hash, forgotten: true })
    expect(readFileSync(a.file, 'utf8')).not.toContain('"c1"')
    if (unix) expect(mode(a.file)).toBe(0o600)
  })

  it('depois de esquecer, a auditoria continua crescendo do fim', () => {
    const a = new AuditFile(dir)
    a.record(entry())
    a.forget('c1')
    a.record(entry({ customerId: 'c2' }))
    expect(lines(a)).toHaveLength(2)
    expect(a.read()[1]).toMatchObject({ customerId: 'c2' })
  })

  it('linha danificada que cita o cliente some; a que não cita fica', () => {
    const a = new AuditFile(dir)
    a.record(entry())
    appendFileSync(a.file, '{"t":1,"customerId":"c1","hash"\n')
    appendFileSync(a.file, 'lixo sem cliente\n')
    a.forget('c1')
    const after = lines(a)
    expect(after[1]).toBe('{"damaged":true}')
    expect(after[2]).toBe('lixo sem cliente')
    expect(a.read()).toHaveLength(1)
  })

  it('cliente sem linhas, id vazio ou arquivo que ainda não existe não mudam nada', () => {
    const a = new AuditFile(dir)
    expect(() => a.forget('c1')).not.toThrow()
    a.record(entry())
    const before = readFileSync(a.file, 'utf8')
    a.forget('c9')
    a.forget('')
    expect(readFileSync(a.file, 'utf8')).toBe(before)
  })
})
