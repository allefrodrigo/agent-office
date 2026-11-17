import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// S-3: the send gate's decision table (docs/adr/0017-portao-de-envio.md). The gate itself is
// CR-11 (phase 2); this only keeps the corpus coherent so CR-11 can run it as is.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Obj = { [k: string]: Json }

interface GateCase {
  id: string
  group: number | 'ordem'
  title: string
  tz?: string
  patch: Obj
  expect: { action: 'send' | 'hold' | 'block' | 'schedule'; rule: number; at?: string; rehearsal?: boolean; overridable?: boolean }
}

const file = join(__dirname, 'fixtures', 'crm-gate-cases.json')
const doc = JSON.parse(readFileSync(file, 'utf8')) as { version: number; tz: string; base: Obj; cases: GateCase[] }

const isObj = (v: Json | undefined): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** base + patch, as the fixture says: objects merge, everything else (lists and null too) replaces. */
function merge(base: Obj, patch: Obj): Obj {
  const out: Obj = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k]
    out[k] = isObj(v) && isObj(cur) ? merge(cur, v) : v
  }
  return out
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
const cases = doc.cases.map((c) => ({ ...c, ctx: merge(doc.base, c.patch) }))

describe('corpus do portão de envio (S-3)', () => {
  it('tem pelo menos 80 casos, com ids únicos', () => {
    expect(doc.cases.length).toBeGreaterThanOrEqual(80)
    expect(new Set(doc.cases.map((c) => c.id)).size).toBe(doc.cases.length)
  })

  it('cobre o envio e cada uma das 14 regras como a que decide', () => {
    const rules = new Set(doc.cases.map((c) => c.expect.rule))
    for (let r = 0; r <= 14; r++) expect(rules.has(r), `regra ${r}`).toBe(true)
  })

  it('o caso base passa em todas as regras', () => {
    const plain = doc.cases.find((c) => Object.keys(c.patch).length === 0)
    expect(plain?.expect).toEqual({ action: 'send', rule: 0 })
  })

  it('só remenda campos que a base tem', () => {
    for (const c of doc.cases) for (const k of Object.keys(c.patch)) expect(Object.hasOwn(doc.base, k), `${c.id}: ${k}`).toBe(true)
  })

  it('envio é regra 0, e regra 0 é envio', () => {
    for (const c of doc.cases) expect(c.expect.action === 'send', c.id).toBe(c.expect.rule === 0)
  })

  it('agendar traz a hora; os outros resultados não', () => {
    for (const c of doc.cases) {
      if (c.expect.action === 'schedule') expect(c.expect.at, c.id).toMatch(ISO)
      else expect(c.expect.at, c.id).toBeUndefined()
    }
  })

  it('cada regra devolve só a ação da tabela', () => {
    const allowed: Record<number, string[]> = {
      1: ['block'], 2: ['block'], 3: ['block'], 4: ['block'], 5: ['block'], 6: ['block'], 7: ['hold'],
      8: ['block'], 9: ['hold'], 10: ['schedule'], 11: ['hold'], 12: ['schedule'], 13: ['hold'], 14: ['hold'],
    }
    for (const c of doc.cases) if (c.expect.rule > 0) expect(allowed[c.expect.rule], c.id).toContain(c.expect.action)
  })

  it('"enviar mesmo assim" nunca aparece nas regras 1, 2, 3, 7, 9, 12, 13 e 14', () => {
    for (const c of doc.cases) if ([1, 2, 3, 7, 9, 12, 13, 14].includes(c.expect.rule)) expect(c.expect.overridable ?? false, c.id).toBe(false)
  })

  it('"teria sido enviada" só aparece na regra 13', () => {
    for (const c of doc.cases) expect(c.expect.rehearsal ?? false, c.id).toBe(c.expect.rule === 13)
  })

  it('nenhuma oferta a quem saiu ou não aceitou ofertas é enviada', () => {
    for (const { id, ctx, expect: e } of cases) {
      const draft = ctx.draft as Obj
      const customer = ctx.customer as Obj | null
      const consent = customer?.consent as Obj | undefined
      if (draft.category === 'offer' && consent && (consent.offers === false || consent.optOutAt)) expect(e.action, id).toBe('block')
    }
  })

  it('todo horário é ISO com deslocamento, e o autor é bot, você ou o sistema', () => {
    for (const { id, ctx } of cases) {
      expect(ctx.now, id).toMatch(ISO)
      const draft = ctx.draft as Obj
      expect(['bot', 'player', 'system'], id).toContain(draft.by)
      const reply = draft.replyTo as Obj | null
      if (reply) expect(reply.at, id).toMatch(ISO)
      for (const h of ctx.history as Obj[]) expect(h.at, id).toMatch(ISO)
    }
  })

  it('mensagem sua e texto do sistema não têm rodada', () => {
    for (const { id, ctx } of cases) {
      const by = (ctx.draft as Obj).by
      if (by === 'player' || by === 'system') expect(ctx.run, id).toBeNull()
    }
  })
})
