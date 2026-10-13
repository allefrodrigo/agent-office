import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TicketBoard } from '../src/main/tickets'

let dir: string
const ticket = (n: number, extra: Record<string, unknown> = {}) => ({ id: `t${n}`, key: `AO-${n}`, title: `T${n}`, description: '', tags: [], ...extra })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-tickets-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('TicketBoard load', () => {
  it('first run: empty board, no corrupt file', () => {
    const b = new TicketBoard(dir)
    expect(b.list()).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  it('cut tickets.json: the .bak loads and the bad file is kept', () => {
    const good = JSON.stringify({ seq: 5, tickets: [ticket(5)] })
    writeFileSync(join(dir, 'tickets.json.bak'), good)
    writeFileSync(join(dir, 'tickets.json'), good.slice(0, 20))
    const b = new TicketBoard(dir)
    expect(b.list().map((t) => t.key)).toEqual(['AO-5'])
    expect(readdirSync(dir).some((n) => n.startsWith('tickets.corrupt-'))).toBe(true)
  })

  it('no good copy: the next key still goes past the archive', () => {
    writeFileSync(join(dir, 'tickets.json'), '')
    writeFileSync(join(dir, 'tickets-closed.json'), JSON.stringify({ tickets: [ticket(41, { closedAt: 1 })] }))
    const b = new TicketBoard(dir)
    // seq came back at least to the highest key handed out
    b.flush()
    expect(JSON.parse(readFileSync(join(dir, 'tickets.json'), 'utf8')).seq).toBe(41)
  })

  it('tickets that are not a list count as corrupt (AO-24)', () => {
    writeFileSync(join(dir, 'tickets.json.bak'), JSON.stringify({ seq: 2, tickets: [ticket(2)] }))
    writeFileSync(join(dir, 'tickets.json'), JSON.stringify({ seq: 3, tickets: { a: 1 } }))
    writeFileSync(join(dir, 'tickets-closed.json'), JSON.stringify({ tickets: 'x' }))
    const b = new TicketBoard(dir)
    expect(b.list().map((t) => t.key)).toEqual(['AO-2'])
    expect(b.listClosed()).toEqual([])
    expect(readdirSync(dir).some((n) => n.startsWith('tickets.corrupt-'))).toBe(true)
    expect(readdirSync(dir).some((n) => n.startsWith('tickets-closed.corrupt-'))).toBe(true)
    // and the board works: no "filter is not a function"
    expect(b.create({ title: 'Novo' }, { kind: 'player', name: 'Ana' }).key).toBe('AO-3')
  })

  it('cut archive: moved aside, not written over by the next flush', () => {
    writeFileSync(join(dir, 'tickets.json'), JSON.stringify({ seq: 1, tickets: [] }))
    writeFileSync(join(dir, 'tickets-closed.json'), '{"tickets":[{"key":')
    const b = new TicketBoard(dir)
    expect(b.listClosed()).toEqual([])
    b.flush()
    expect(existsSync(join(dir, 'tickets-closed.json'))).toBe(false)
    expect(readdirSync(dir).some((n) => n.startsWith('tickets-closed.corrupt-'))).toBe(true)
  })
})
