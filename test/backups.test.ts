import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyImport,
  backupCopies,
  backupsDir,
  backupTime,
  buildExport,
  dailyBackup,
  KEEP_DAILY,
  keptBy,
  listBackups,
  parseExport,
  readBackup,
  restoreBackup,
  snapshot,
} from '../src/main/backups'

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

  it('the date comes from the folder name, not its mtime (AO-25)', () => {
    put('office.json', { v: 1 })
    dailyBackup(dir, new Date(2026, 9, 1))
    dailyBackup(dir, new Date(2026, 9, 2))
    // the older folder was touched later (copied, synced)
    utimesSync(join(backupsDir(dir), '2026-10-01'), new Date(2030, 0, 1), new Date(2030, 0, 1))
    snapshot(dir, new Date('2026-10-01T15:00:00.000Z'))
    const list = listBackups(dir)
    expect(list.map((b) => b.id)).toEqual(['2026-10-02', 'antes-2026-10-01T15-00-00-000', '2026-10-01'])
    expect(list[0].at).toBe(new Date(2026, 9, 2).getTime())
    expect(backupTime('antes-2026-10-01T15-00-00-000')).toBe(Date.parse('2026-10-01T15:00:00.000Z'))
    expect(backupTime('antes-2026-10-01T15-00-00')).toBe(Date.parse('2026-10-01T15:00:00Z'))
  })

  it('a file with the wrong shape is not copied', () => {
    put('office.json', { settings: {} })
    put('tickets.json', { seq: 1, tickets: { a: 1 } })
    dailyBackup(dir, new Date(2026, 9, 1))
    expect(readdirSync(join(backupsDir(dir), '2026-10-01'))).toEqual(['office.json'])
  })

  it('backupCopies lists the newest first', () => {
    put('office.json', { v: 1 })
    dailyBackup(dir, new Date(2026, 9, 1))
    dailyBackup(dir, new Date(2026, 9, 2))
    expect(backupCopies(dir, 'office.json').map((p) => basename(dirname(p)))).toEqual(['2026-10-02', '2026-10-01'])
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

  it('a backup without office.json leaves the current one in place (AO-25)', () => {
    put('tickets.json', { seq: 1, tickets: [] })
    dailyBackup(dir, new Date(2026, 9, 1))
    put('office.json', { v: 'now' })
    put('office.json.bak', { v: 'bak' })
    restoreBackup(dir, '2026-10-01')
    expect(read('office.json')).toEqual({ v: 'now' })
    // the .bak of a file left alone stays too
    expect(read('office.json.bak')).toEqual({ v: 'bak' })
    expect(read('tickets.json')).toEqual({ seq: 1, tickets: [] })
  })

  it('a backup without tickets.json keeps the board and its archive', () => {
    put('office.json', { v: 'old' })
    dailyBackup(dir, new Date(2026, 9, 1))
    put('tickets.json', { seq: 9, tickets: [] })
    put('tickets-closed.json', { tickets: [{ key: 'AO-8' }] })
    expect(keptBy(readBackup(dir, '2026-10-01'))).toEqual(['tickets.json', 'tickets-closed.json', 'routines.json'])
    restoreBackup(dir, '2026-10-01')
    expect(read('office.json')).toEqual({ v: 'old' })
    expect(read('tickets.json')).toEqual({ seq: 9, tickets: [] })
    expect(read('tickets-closed.json')).toEqual({ tickets: [{ key: 'AO-8' }] })
  })

  it('refuses a backup whose file has the wrong shape', () => {
    const day = join(backupsDir(dir), '2026-10-03')
    mkdirSync(day, { recursive: true })
    writeFileSync(join(day, 'tickets.json'), JSON.stringify({ seq: 3, tickets: { a: 1 } }))
    expect(() => readBackup(dir, '2026-10-03')).toThrow(/formato/)
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
      // join, not a fixed string: on Windows the folder is \Users\outra\.claude-trabalho (AO-42).
      expect(s.accounts).toEqual([{ id: 'main' }, { id: 'b', configDir: join('/Users/outra', '.claude-trabalho') }])
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('takes account folders written on the other OS', () => {
    put('office.json', { settings: { accounts: [{ id: 'b', configDir: 'C:\\Users\\x\\.claude-trabalho' }] } })
    const other = mkdtempSync(join(tmpdir(), 'ao-import-'))
    try {
      applyImport(other, parseExport(JSON.stringify(buildExport(dir))), '/Users/outra')
      expect(JSON.parse(readFileSync(join(other, 'office.json'), 'utf8')).settings.accounts).toEqual([{ id: 'b', configDir: join('/Users/outra', '.claude-trabalho') }])
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('reads an export saved with a BOM; rejects one of the wrong shape', () => {
    const exp = JSON.stringify({ format: 'agent-office-dados', version: 1, files: { 'office.json': { settings: {} } } })
    expect(parseExport('\uFEFF' + exp).files['office.json']).toEqual({ settings: {} })
    const bad = { format: 'agent-office-dados', version: 1, files: { 'office.json': { agents: {} } } }
    expect(() => parseExport(JSON.stringify(bad))).toThrow(/formato/)
  })

  it('rejects files that are not exports', () => {
    expect(() => parseExport('nope')).toThrow(/JSON/)
    expect(() => parseExport('{"format":"x"}')).toThrow(/exportação/)
    expect(() => parseExport('{"format":"agent-office-dados","version":1,"files":{}}')).toThrow(/office.json/)
  })
})
