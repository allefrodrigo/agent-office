import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOT_COLORS, BOT_LIMITS, SENSITIVE_KINDS, type Bot, type ThreadItem } from '@shared/types'
import { BotStore, isThreadId, loadBot } from '../src/main/bots/store'
import { ThreadFile } from '../src/main/bots/thread'
import { importSet, sanitizeImportedBots } from '../src/main/backups'

let dir: string
let opened: BotStore[] = []
const open = (d = dir) => {
  const s = new BotStore(d)
  opened.push(s)
  return s
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-bots-'))
})
afterEach(() => {
  vi.useRealTimers()
  for (const s of opened) s.lock()
  opened = []
  rmSync(dir, { recursive: true, force: true })
})

const look = { skin: '#f1c27d', hair: '#3b2a1a', hairStyle: 1, shirt: '#5b9cf0', pants: '#333333', shoes: '#111111' }
const bot = (over: Partial<Bot> = {}): Bot => ({
  id: 'b1',
  name: 'Resumo',
  tagline: 'Resumo da manhã',
  role: 'Você resume o dia.',
  color: BOT_COLORS[1],
  look,
  floor: 'terreo',
  cwd: '/tmp/x',
  permissionMode: 'default',
  askBefore: [...SENSITIVE_KINDS],
  apps: 'all',
  worktree: false,
  dailyBudgetUsd: 0,
  pinned: false,
  hidden: false,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  lastReadAt: 0,
  runs: [],
  ...over,
})
const note = (id: string, text = id): ThreadItem => ({ id, t: 1, kind: 'notice', text })
const mode = (p: string) => statSync(p).mode & 0o777
const unix = process.platform !== 'win32'

describe('loadBot', () => {
  it('reads a good bot back as it was', () => {
    expect(loadBot(bot())).toEqual(bot())
  })

  it('never loads "Sem pedir nada", nor a color outside the palette, nor a bad askBefore', () => {
    const b = loadBot({ ...bot(), permissionMode: 'bypassPermissions', color: '#123456', askBefore: ['send', 'hack'] })!
    expect(b.permissionMode).toBe('default')
    expect(b.color).toBe(BOT_COLORS[0])
    expect(b.askBefore).toEqual(['send'])
    expect(loadBot({ ...bot(), askBefore: ['hack'] })!.askBefore).toEqual([...SENSITIVE_KINDS])
    expect(loadBot({ ...bot(), askBefore: 'x' })!.askBefore).toEqual([...SENSITIVE_KINDS])
    expect(loadBot({ ...bot(), askBefore: [] })!.askBefore).toEqual([])
  })

  it('a run the app was following ends as failed', () => {
    const b = loadBot({ ...bot(), runs: [{ id: 'r1', trigger: { kind: 'message' }, startedAt: 5, status: 'running', steps: 2, threadId: 'b1', itemId: 'r1' }] })!
    expect(b.runs[0]).toMatchObject({ status: 'failed', endedAt: 5, error: 'O app fechou antes de a rodada terminar.' })
  })

  it('drops what cannot be a bot and fixes the rest', () => {
    expect(loadBot(null)).toBeNull()
    expect(loadBot({ ...bot(), id: '../x' })).toBeNull()
    expect(loadBot({ ...bot(), id: 'canais' })).toBeNull()
    expect(loadBot({ ...bot(), name: '  ' })).toBeNull()
    expect(loadBot({ ...bot(), role: 42 })).toBeNull()
    const b = loadBot({ ...bot(), look: { skin: 'red' }, dailyBudgetUsd: -1, apps: 'x', effort: 'turbo', agentId: 'a1' })!
    expect(b.look).toMatchObject({ hairStyle: expect.any(Number) })
    expect(b.dailyBudgetUsd).toBe(0)
    expect(b.apps).toBe('all')
    expect(b.effort).toBeUndefined()
    expect(b).not.toHaveProperty('agentId')
  })

  it('isThreadId only takes safe names', () => {
    expect(isThreadId('b-1_x')).toBe(true)
    for (const bad of ['', '../a', 'a/b', 'canais', 'x'.repeat(65), 1]) expect(isThreadId(bad)).toBe(false)
  })
})

describe('BotStore', () => {
  it('creates, saves and reads back; agentId and demo bots stay out of the file', () => {
    const s = open()
    s.bots = [bot({ agentId: 'a1' }), bot({ id: 'demo1', demo: true })]
    s.flush()
    const raw = JSON.parse(readFileSync(join(dir, 'bots.json'), 'utf8'))
    expect(raw.bots).toHaveLength(1)
    expect(raw.bots[0]).not.toHaveProperty('agentId')
    if (unix) expect(mode(join(dir, 'bots.json'))).toBe(0o600)
    const again = open()
    expect(again.bots).toEqual([bot()])
  })

  it('a broken file falls back to the last good copy', () => {
    const s = open()
    s.bots = [bot()]
    s.flush()
    open() // a good load refreshes bots.json.bak
    writeFileSync(join(dir, 'bots.json'), '{"bots": [')
    expect(open().bots.map((b) => b.id)).toEqual(['b1'])
  })

  it('a file with the wrong shape loads empty, never crashes', () => {
    writeFileSync(join(dir, 'bots.json'), '{"bots": {"no": "list"}}')
    expect(open().bots).toEqual([])
  })

  it('memory: 0600 in a 0700 folder, cut at the limit', () => {
    const s = open()
    s.bots = [bot()]
    expect(s.memory('b1')).toBe('')
    const kept = s.setMemory('b1', 'linha\r\n'.repeat(5000))
    expect(new TextEncoder().encode(kept).length).toBeLessThanOrEqual(BOT_LIMITS.memoryBytes)
    expect(s.memory('b1')).toBe(kept)
    if (unix) {
      expect(mode(s.memoryPath('b1'))).toBe(0o600)
      expect(mode(join(dir, 'bots', 'b1'))).toBe(0o700)
      expect(mode(join(dir, 'bots'))).toBe(0o700)
    }
    expect(() => s.memoryPath('../x')).toThrow()
  })

  it('demo bots keep thread and memory in memory', () => {
    const s = open()
    s.bots = [bot({ id: 'demo1', demo: true })]
    s.thread('demo1').put(note('n1'))
    s.setMemory('demo1', 'nota')
    s.flush()
    expect(s.memory('demo1')).toBe('nota')
    expect(s.thread('demo1').all()).toHaveLength(1)
    expect(existsSync(join(dir, 'bots', 'demo1'))).toBe(false)
  })

  it('channels keep their threads in bots/canais', () => {
    const s = open()
    s.channels = [{ id: 'c1', name: 'geral', floor: 'terreo', topic: '', members: ['b1'], createdAt: 1, updatedAt: 1, lastReadAt: 0, order: 0 }]
    s.thread('c1').put(note('n1'))
    s.flush()
    expect(existsSync(join(dir, 'bots', 'canais', 'c1.jsonl'))).toBe(true)
  })

  it('deleting a bot removes its folder, thread and memory included', () => {
    const s = open()
    s.bots = [bot()]
    s.thread('b1').put(note('n1'))
    s.setMemory('b1', 'x')
    s.flush()
    expect(existsSync(join(dir, 'bots', 'b1', 'fio.jsonl'))).toBe(true)
    s.removeFolder('b1')
    expect(existsSync(join(dir, 'bots', 'b1'))).toBe(false)
    s.removeFolder('../..')
    expect(existsSync(dir)).toBe(true)
  })

  it('an invalid thread id is refused', () => {
    expect(() => open().thread('../x')).toThrow('Conversa inválida.')
  })

  it('after lock nothing is written', () => {
    const s = open()
    s.bots = [bot()]
    s.lock()
    s.bots = [bot(), bot({ id: 'b2' })]
    s.flush()
    expect(JSON.parse(readFileSync(join(dir, 'bots.json'), 'utf8')).bots).toHaveLength(1)
  })
})

describe('ThreadFile', () => {
  const file = () => join(dir, 'fio.jsonl')

  it('appends, updates in place and reads back folded', () => {
    const t = new ThreadFile(file())
    t.put(note('a'))
    t.put(note('b'))
    t.put(note('a', 'a2'))
    t.flush()
    const back = new ThreadFile(file()).all()
    expect(back.map((i) => (i.kind === 'notice' ? i.text : ''))).toEqual(['a2', 'b'])
    if (unix) expect(mode(file())).toBe(0o600)
  })

  it('updates wait and land as one line', () => {
    vi.useFakeTimers()
    const t = new ThreadFile(file())
    for (let k = 0; k < 10; k++) t.put(note('run', `passo ${k}`))
    expect(existsSync(file())).toBe(false)
    vi.advanceTimersByTime(600)
    expect(readFileSync(file(), 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('compacts when the file has more than twice the lines it needs', () => {
    const t = new ThreadFile(file())
    t.put(note('a'))
    for (let k = 0; k < 40; k++) {
      t.put(note('a', `v${k}`))
      t.flush()
    }
    const lines = readFileSync(file(), 'utf8').trim().split('\n')
    expect(lines.length).toBeLessThanOrEqual(22)
    expect(new ThreadFile(file()).all()).toEqual([note('a', 'v39')])
  })

  it('keeps the newest BOT_LIMITS.threadItems', () => {
    const t = new ThreadFile(file())
    for (let k = 0; k < BOT_LIMITS.threadItems + 3; k++) t.put(note(`n${k}`))
    t.flush()
    const back = new ThreadFile(file()).all()
    expect(back).toHaveLength(BOT_LIMITS.threadItems)
    expect(back[0].id).toBe('n3')
  })

  it('pages from the end, oldest first, with more', () => {
    const t = new ThreadFile(null)
    for (let k = 0; k < 5; k++) t.put(note(`n${k}`))
    expect(t.page(undefined, 2)).toEqual({ items: [note('n3'), note('n4')], more: true })
    expect(t.page('n3', 2)).toEqual({ items: [note('n1'), note('n2')], more: true })
    expect(t.page('n1', 2)).toEqual({ items: [note('n0')], more: false })
    expect(t.page('nao-existe', 10).items).toHaveLength(5)
    expect(t.get('n2')).toEqual(note('n2'))
  })

  it('searches without accents, newest first', () => {
    const t = new ThreadFile(null)
    t.put(note('a', 'Reunião de produto'))
    t.put(note('b', 'reuniao do time'))
    t.put(note('c', 'outra coisa'))
    expect(t.search('REUNIAO').map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('skips bad lines', () => {
    writeFileSync(file(), `${JSON.stringify(note('a'))}\nnão é json\n{"id":"x"}\n`)
    expect(new ThreadFile(file()).all()).toEqual([note('a')])
  })

  it('discard drops what is pending', () => {
    const t = new ThreadFile(file())
    t.put(note('a'))
    t.discard()
    t.flush()
    expect(existsSync(file())).toBe(false)
  })
})

describe('import', () => {
  it('bots arrive without the other machine\'s sessions, never bypass, automations paused', () => {
    const data = {
      bots: [{ ...bot(), permissionMode: 'bypassPermissions', agentId: 'a1', sessionId: 's1' }],
      channels: [],
      eventTriggers: [{ id: 't1', botId: 'b1', enabled: true }],
    }
    const out = sanitizeImportedBots(data) as typeof data
    expect(out.bots[0]).toMatchObject({ permissionMode: 'default' })
    expect(out.bots[0]).not.toHaveProperty('agentId')
    expect(out.bots[0]).not.toHaveProperty('sessionId')
    expect(out.eventTriggers[0].enabled).toBe(false)
    expect(sanitizeImportedBots(null)).toBeNull()
    const set = importSet({ format: 'agent-office-export', version: '1', exportedAt: '', files: { 'office.json': { settings: {} }, 'bots.json': data } } as never)
    expect(JSON.parse(set['bots.json']!).bots[0].permissionMode).toBe('default')
  })
})
