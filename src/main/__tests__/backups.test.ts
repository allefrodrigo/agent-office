import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyImport, backupCopies, backupsDir, buildExport, dailyBackup, KEEP_DAILY, listBackups, parseExport, restoreBackup, snapshot } from '../backups'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-backups-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (name: string, data: unknown) => writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data))
const read = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'))

describe('daily backups', () => {
  it('one copy a day, the last 14 days kept', () => {
    put('office.json', { settings: {} })
    put('tickets.json', { seq: 1, tickets: [] })
    for (let d = 1; d <= 20; d++) dailyBackup(dir, new Date(2026, 8, d, 10))
    // same day again: no new copy
    expect(dailyBackup(dir, new Date(2026, 8, 20, 18))).toBeNull()
    const days = readdirSync(backupsDir(dir)).sort()
    expect(days).toHaveLength(KEEP_DAILY)
    expect(days[0]).toBe('2026-09-07')
    expect(days.at(-1)).toBe('2026-09-20')
    expect(readdirSync(join(backupsDir(dir), '2026-09-20')).sort()).toEqual(['office.json', 'tickets.json'])
  })

  it('a broken file is not copied', () => {
    put('office.json', { settings: {} })
    put('tickets.json', '{"seq":')
    dailyBackup(dir, new Date(2026, 9, 1))
    expect(readdirSync(join(backupsDir(dir), '2026-10-01'))).toEqual(['office.json'])
  })

  it('backupCopies lists the newest first', () => {
    put('office.json', { v: 1 })
    dailyBackup(dir, new Date(2026, 9, 1))
    dailyBackup(dir, new Date(2026, 9, 2))
    expect(backupCopies(dir, 'office.json').map((p) => p.split('/').at(-2))).toEqual(['2026-10-02', '2026-10-01'])
  })
})

describe('restore', () => {
  it('puts the backup in place; the snapshot keeps the state before', () => {
    put('office.json', { v: 'old' })
    put('tickets.json', { seq: 1, tickets: [] })
    dailyBackup(dir, new Date(2026, 9, 1))
    put('office.json', { v: 'new' })
    put('tickets.json', { seq: 9, tickets: [] })
    put('tickets-closed.json', { tickets: [] })

    snapshot(dir)
    restoreBackup(dir, '2026-10-01')
    expect(read('office.json')).toEqual({ v: 'old' })
    expect(read('tickets.json')).toEqual({ seq: 1, tickets: [] })
    // the backup had no archive, so neither does the result
    expect(existsSync(join(dir, 'tickets-closed.json'))).toBe(false)

    const snap = listBackups(dir).find((b) => b.kind === 'snapshot')!
    expect(snap.files).toContain('tickets-closed.json')
    expect(JSON.parse(readFileSync(join(backupsDir(dir), snap.id, 'office.json'), 'utf8'))).toEqual({ v: 'new' })
  })

  it('refuses ids that are not backups', () => {
    expect(() => restoreBackup(dir, '../..')).toThrow()
    expect(() => restoreBackup(dir, '2026-01-01')).toThrow()
  })
})

describe('export / import', () => {
  it('an export imported elsewhere reproduces the data', () => {
    put('office.json', { settings: { playerName: 'Ana', accounts: [{ id: 'main' }] }, agents: [{ summary: { id: 'a1' } }] })
    put('tickets.json', { seq: 2, tickets: [{ key: 'AO-2' }] })
    const text = JSON.stringify(buildExport(dir))

    const other = mkdtempSync(join(tmpdir(), 'ao-import-'))
    try {
      writeFileSync(join(other, 'office.json'), '{}')
      applyImport(other, parseExport(text), '/Users/outra')
      expect(JSON.parse(readFileSync(join(other, 'office.json'), 'utf8'))).toEqual(read('office.json'))
      expect(JSON.parse(readFileSync(join(other, 'tickets.json'), 'utf8'))).toEqual(read('tickets.json'))
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('moves account folders to this home and drops odd ones; never imports "bypass"', () => {
    put('office.json', {
      settings: {
        defaultPermissionMode: 'bypassPermissions',
        accounts: [{ id: 'main' }, { id: 'b', configDir: '/Users/x/.claude-trabalho' }, { id: 'c', configDir: '/etc' }],
      },
    })
    const other = mkdtempSync(join(tmpdir(), 'ao-import-'))
    try {
      applyImport(other, parseExport(JSON.stringify(buildExport(dir))), '/Users/outra')
      const s = JSON.parse(readFileSync(join(other, 'office.json'), 'utf8')).settings
      expect(s.defaultPermissionMode).toBe('default')
      expect(s.accounts).toEqual([{ id: 'main' }, { id: 'b', configDir: '/Users/outra/.claude-trabalho' }])
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('rejects files that are not exports', () => {
    expect(() => parseExport('nope')).toThrow(/JSON/)
    expect(() => parseExport('{"format":"x"}')).toThrow(/exportação/)
    expect(() => parseExport('{"format":"agent-office-dados","version":1,"files":{}}')).toThrow(/office.json/)
  })
})
