import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// log.ts keeps its folder and file in module state: each test loads a fresh copy.
type LogModule = typeof import('../src/main/log')
let dir: string
let mod: LogModule

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ao-log-'))
  vi.resetModules()
  mod = await import('../src/main/log')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const logs = () => readdirSync(join(dir, 'logs')).filter((f) => f.startsWith('main-'))
const all = () =>
  logs()
    .map((f) => readFileSync(join(dir, 'logs', f), 'utf8'))
    .join('')

describe('log: arquivos', () => {
  it('escreve em logs/main-<data>.log com nível', () => {
    mod.initLog(dir)
    mod.log.info('olá')
    mod.log.error('falhou', new Error('boom'))
    expect(logs()).toHaveLength(1)
    expect(logs()[0]).toMatch(/^main-\d{4}-\d{2}-\d{2}\.log$/)
    expect(all()).toMatch(/INFO {2}olá/)
    expect(all()).toMatch(/ERROR falhou Error: boom/)
    expect(mod.tail(1)[0]).toMatch(/^\s+at /) // the stack goes indented under its line
  })

  it('debug só entra com AGENT_OFFICE_DEBUG', () => {
    mod.initLog(dir)
    const before = process.env.AGENT_OFFICE_DEBUG
    delete process.env.AGENT_OFFICE_DEBUG
    mod.log.debug('escondido')
    process.env.AGENT_OFFICE_DEBUG = '1'
    mod.log.debug('visível')
    if (before === undefined) delete process.env.AGENT_OFFICE_DEBUG
    else process.env.AGENT_OFFICE_DEBUG = before
    expect(all()).not.toContain('escondido')
    expect(all()).toContain('visível')
  })

  it('passou do limite: renomeia e começa outro; ficam só os 5 mais novos', () => {
    mod.initLog(dir, { maxBytes: 200 })
    for (let i = 0; i < 40; i++) mod.log.info(`linha ${i} `.padEnd(80, 'x'))
    const files = logs()
    expect(files).toHaveLength(5)
    // the current file plus rotated ones with a time stamp
    expect(files.filter((f) => /^main-\d{4}-\d{2}-\d{2}\.log$/.test(f))).toHaveLength(1)
    expect(files.filter((f) => /^main-\d{4}-\d{2}-\d{2}-\d{6}-[\d-]+\.log$/.test(f))).toHaveLength(4)
    // the newest line survived, the oldest is gone
    expect(all()).toContain('linha 39 ')
    expect(all()).not.toContain('linha 0 ')
  })

  it('sem pasta de logs: logDir e logFile vazios, nada quebra', () => {
    // a file where the folder should go: mkdir fails
    writeFileSync(join(dir, 'arquivo'), '')
    mod.initLog(join(dir, 'arquivo'))
    expect(mod.logDir()).toBe('')
    expect(mod.logFile()).toBe('')
    expect(() => mod.log.error('sem lugar')).not.toThrow()
    expect(mod.tail(5)).toEqual([])
  })
})

describe('log: redact', () => {
  it('tira tokens, chaves e cabeçalhos de autorização', () => {
    const out = mod.redact(
      [
        'x-agent-office-token: abc123456789',
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
        'chave sk-ant-api03-AbC_dEf-123',
        '{"token":"t0k3n-valor","password":"segredo"}',
        'api_key=minha-chave',
      ].join('\n'),
    )
    for (const s of ['abc123456789', 'eyJhbGciOiJIUzI1NiJ9', 'sk-ant-api03', 't0k3n-valor', 'segredo', 'minha-chave']) expect(out).not.toContain(s)
    expect(out).toContain('[redacted]')
  })

  it('o segredo registrado some de qualquer linha, também no arquivo', () => {
    mod.initLog(dir)
    mod.secret('ponte-1234567890')
    mod.log.info('url http://127.0.0.1:47821/?k=ponte-1234567890')
    expect(all()).not.toContain('ponte-1234567890')
    // short values are not registered: they would blank common words
    mod.secret('abc')
    expect(mod.redact('abc')).toBe('abc')
  })
})

describe('log: console', () => {
  it('"Render frame was disposed" do Electron não vira ERROR', () => {
    expect(mod.consoleLevel('error', ['Error sending from webContents:', new Error('Render frame was disposed before WebFrameMain could be accessed')])).toBe('debug')
    expect(mod.consoleLevel('error', ['outra coisa'])).toBe('error')
    expect(mod.consoleLevel('warn', ['aviso'])).toBe('warn')
  })
})
