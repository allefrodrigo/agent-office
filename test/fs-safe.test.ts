import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bakPath, loadJson, noticeFor, writeJsonAtomic } from '../src/main/fs-safe'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-fs-safe-'))
  file = join(dir, 'office.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const corrupts = () => readdirSync(dir).filter((n) => /^office\.corrupt-.+\.json$/.test(n))

describe('writeJsonAtomic', () => {
  it('writes the JSON and leaves no tmp file', () => {
    writeJsonAtomic(file, { a: 1 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1 })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('formats when asked', () => {
    writeJsonAtomic(file, { a: 1 }, { space: 2, newline: true })
    expect(readFileSync(file, 'utf8')).toBe('{\n  "a": 1\n}\n')
  })
})

describe('loadJson', () => {
  it('missing file: fresh start, no notice, nothing renamed', () => {
    const r = loadJson(file)
    expect(r.status).toBe('missing')
    expect(noticeFor(file, r)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('good file: loads and refreshes the .bak', () => {
    writeFileSync(file, JSON.stringify({ seq: 3 }))
    const r = loadJson<{ seq: number }>(file)
    expect(r).toEqual({ status: 'ok', data: { seq: 3 } })
    expect(JSON.parse(readFileSync(bakPath(file), 'utf8'))).toEqual({ seq: 3 })
  })

  it('truncated file: moved aside untouched, .bak loads, notice says where', () => {
    const good = JSON.stringify({ settings: { playerName: 'Ana' }, agents: [1, 2] })
    writeFileSync(bakPath(file), good)
    utimesSync(bakPath(file), new Date('2026-10-01T12:00:00Z'), new Date('2026-10-01T12:00:00Z'))
    const cut = good.slice(0, good.length / 2)
    writeFileSync(file, cut)

    const r = loadJson<Record<string, unknown>>(file)
    expect(r.status).toBe('restored')
    if (r.status !== 'restored') return
    expect(r.data).toEqual(JSON.parse(good))
    expect(existsSync(file)).toBe(false)
    expect(corrupts()).toHaveLength(1)
    expect(readFileSync(r.corruptPath, 'utf8')).toBe(cut)
    const n = noticeFor(file, r)
    expect(n?.kind).toBe('restored')
    expect(n?.text).toContain(r.corruptPath)
    expect(n?.text).toContain('restauramos o backup de')
  })

  it('empty file: counts as corrupt, never as a first run', () => {
    writeFileSync(file, '')
    const r = loadJson(file)
    expect(r.status).toBe('lost')
    expect(corrupts()).toHaveLength(1)
    expect(noticeFor(file, r)?.kind).toBe('lost')
  })

  it('wrong shape (null, array) is corrupt too', () => {
    writeFileSync(file, 'null')
    expect(loadJson(file).status).toBe('lost')
    writeFileSync(file, '[]')
    expect(loadJson(file).status).toBe('lost')
  })

  it('a broken .bak falls through to the next copy', () => {
    writeFileSync(file, '{"a":')
    writeFileSync(bakPath(file), '{"b":')
    const daily = join(dir, 'daily.json')
    writeFileSync(daily, '{"c":1}')
    const r = loadJson(file, { fallbacks: [daily] })
    expect(r.status).toBe('restored')
    if (r.status === 'restored') {
      expect(r.from).toBe(daily)
      expect(r.data).toEqual({ c: 1 })
    }
  })

  it('a restored load does not overwrite the .bak with anything', () => {
    writeFileSync(bakPath(file), '{"ok":true}')
    writeFileSync(file, '{')
    loadJson(file)
    expect(readFileSync(bakPath(file), 'utf8')).toBe('{"ok":true}')
  })
})
