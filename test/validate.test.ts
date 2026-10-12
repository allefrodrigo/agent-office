import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Account, ProjectFloor, Settings } from '@shared/types'
import {
  assigneeSchema,
  attachmentsSchema,
  cleanAccountIds,
  cleanAccounts,
  cleanBrain,
  cleanDelegateTarget,
  cleanHire,
  cleanLedgerQuery,
  cleanProjects,
  cleanSettings,
  delegateMode,
  externalUrlSchema,
  idSchema,
  MAX_LOGO_CHARS,
  parse,
  permissionDecisionSchema,
  searchSchema,
  ticketDraftSchema,
  ticketPatchSchema,
} from '../src/main/validate'

const dir = mkdtempSync(join(tmpdir(), 'ao-validate-'))
const other = mkdtempSync(join(tmpdir(), 'ao-validate-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(other, { recursive: true, force: true })
})

const main: Account = { id: 'main', name: 'Principal', provider: 'claude', color: '#e0894a' }
const work: Account = { id: 'a-1', name: 'Trabalho', provider: 'claude', color: '#4a8fe0', configDir: '/tmp/a-1' }
const accounts = [main, work]

const settings = (): Settings => ({
  playerName: 'Você',
  playerLook: { skin: '#f6d3b3', hair: '#2b1d16', hairStyle: 1, shirt: '#4a8fe0', pants: '#2f3b5c', shoes: '#1e1e24' },
  pixelSize: 3,
  defaultModel: '',
  defaultEffort: '',
  defaultPermissionMode: 'default',
  notifications: true,
  bridgePort: 47821,
  projects: [],
  accounts: [...accounts],
  defaultAccounts: [],
  ticketAutoCloseDays: 7,
  maxSubagents: 10,
  agentBudgetUsd: 0,
})

describe('parse', () => {
  it('devolve o valor válido e lança a mensagem dada no inválido', () => {
    expect(parse(idSchema, 'abc', 'ruim')).toBe('abc')
    expect(() => parse(idSchema, '', 'ruim')).toThrow('ruim')
    expect(() => parse(idSchema, 42, 'ruim')).toThrow('ruim')
    expect(() => parse(idSchema, 'x'.repeat(201), 'ruim')).toThrow('ruim')
  })
})

describe('cleanBrain', () => {
  it('aceita modelo curto, esforço conhecido e contas que existem', () => {
    expect(cleanBrain({ model: 'opus', effort: 'high', accounts: ['a-1', 'a-1', 'nope'] }, accounts)).toEqual({
      model: 'opus',
      effort: 'high',
      accounts: ['a-1'],
    })
  })
  it('chave presente e inválida vira undefined (padrão do Claude Code)', () => {
    expect(cleanBrain({ model: 'rm -rf /', effort: 'turbo', accounts: 'main' }, accounts)).toEqual({ model: undefined, effort: undefined, accounts: [] })
  })
  it('chaves ausentes ficam ausentes; lixo vira objeto vazio', () => {
    expect(cleanBrain({}, accounts)).toEqual({})
    expect(cleanBrain(null, accounts)).toEqual({})
    expect(cleanBrain('opus', accounts)).toEqual({})
  })
  it('aceita ids com contexto de 1M', () => {
    expect(cleanBrain({ model: 'claude-opus-5-5[1m]' }, accounts).model).toBe('claude-opus-5-5[1m]')
  })
})

describe('cleanAccountIds', () => {
  it('filtra tipos, ids desconhecidos e repetidos', () => {
    expect(cleanAccountIds(['main', 3, 'main', 'x', 'a-1'], accounts)).toEqual(['main', 'a-1'])
    expect(cleanAccountIds('main', accounts)).toEqual([])
  })
})

describe('cleanAccounts', () => {
  it('só muda nome, cor e ordem; ids e pastas vêm do main', () => {
    const out = cleanAccounts(
      [
        { id: 'a-1', name: '  Cliente  ', color: '#00ff00', configDir: '/etc', provider: 'evil' },
        { id: 'main', name: '', color: 'red' },
      ],
      accounts,
    )
    expect(out).toEqual([
      { ...work, name: 'Cliente', color: '#00ff00' },
      { ...main },
    ])
  })
  it('ignora contas desconhecidas e repetidas, e nunca remove as que existem', () => {
    const out = cleanAccounts([{ id: 'ghost', name: 'x' }, { id: 'main', name: 'A' }, { id: 'main', name: 'B' }, 'lixo'], accounts)
    expect(out.map((a) => a.id)).toEqual(['main', 'a-1'])
    expect(out[0].name).toBe('A')
    expect(cleanAccounts(null, accounts)).toEqual(accounts)
  })
  it('corta nomes longos em 32', () => {
    expect(cleanAccounts([{ id: 'main', name: 'x'.repeat(100) }], accounts)[0].name).toHaveLength(32)
  })
})

describe('cleanProjects', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  it('aceita pastas que existem, um andar por pasta, com marca limpa', () => {
    const out = cleanProjects(
      [
        { id: 'p1', name: ' Loja ', cwd: dir, logo: png, brandColor: '#AABBCC', uniform: true },
        { id: 'p2', name: 'Repetida', cwd: dir },
        { id: 'p3', name: 'Some', cwd: join(dir, 'nao-existe') },
        { id: 'p4', name: 'Relativa', cwd: 'relativa' },
      ],
      [],
    )
    expect(out).toEqual([{ id: 'p1', name: 'Loja', cwd: dir, logo: png, brandColor: '#aabbcc', uniform: true }])
  })
  it('recusa SVG, logo gigante e cor fora do formato', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz4='
    const big = 'data:image/png;base64,' + 'A'.repeat(MAX_LOGO_CHARS)
    const [p] = cleanProjects([{ id: 'p1', cwd: dir, logo: svg, brandColor: 'red', uniform: 'yes' }], [])
    expect(p).toEqual({ id: 'p1', name: expect.any(String), cwd: dir })
    expect(cleanProjects([{ id: 'p1', cwd: dir, logo: big }], [])[0].logo).toBeUndefined()
  })
  it('troca id inválido ou repetido e dá nome pela pasta', () => {
    const out = cleanProjects(
      [
        { id: '../x', cwd: dir },
        { id: 'same', cwd: other },
      ],
      [],
    )
    expect(out[0].id).toMatch(/^p-[0-9a-f]{8}$/)
    expect(out[0].name).toBeTruthy()
    const twice = cleanProjects(
      [
        { id: 'same', cwd: dir },
        { id: 'same', cwd: other },
      ],
      [],
    )
    expect(twice[0].id).toBe('same')
    expect(twice[1].id).not.toBe('same')
  })
  it('mantém as contas do andar que já existia, nunca as do formulário', () => {
    const previous: ProjectFloor[] = [{ id: 'p1', name: 'Loja', cwd: dir, accounts: ['a-1'] }]
    const [p] = cleanProjects([{ id: 'p1', name: 'Loja', cwd: dir, accounts: ['main'] }], previous)
    expect(p.accounts).toEqual(['a-1'])
  })
  it('para no limite de andares e aceita lixo sem lançar', () => {
    const many = Array.from({ length: 10 }, () => ({ cwd: mkdtempSync(join(dir, 'f-')) }))
    expect(cleanProjects(many, [])).toHaveLength(6)
    expect(cleanProjects('lixo', [])).toEqual([])
    expect(cleanProjects([null, 3], [])).toEqual([])
  })
})

describe('cleanLedgerQuery', () => {
  it('mantém só dias YYYY-MM-DD e pasta absoluta', () => {
    expect(cleanLedgerQuery({ from: '2026-10-01', to: '2026-10-12', cwd: '/proj', extra: 1 })).toEqual({ from: '2026-10-01', to: '2026-10-12', cwd: '/proj' })
    expect(cleanLedgerQuery({ from: 'ontem', to: 20261012, cwd: 'rel' })).toEqual({})
    expect(cleanLedgerQuery(undefined)).toEqual({})
  })
})

describe('cleanHire', () => {
  const s = settings()
  it('permissionMode inválido cai no padrão do escritório', () => {
    const r = cleanHire({ name: 'Ana', cwd: dir, task: 'faz', permissionMode: 'rootMode' }, { ...s, defaultPermissionMode: 'plan' })
    expect(r.permissionMode).toBe('plan')
    expect(cleanHire({ cwd: dir, task: 'faz' }, s).permissionMode).toBe('default')
  })
  it('permissionMode válido passa', () => {
    expect(cleanHire({ cwd: dir, task: 'faz', permissionMode: 'acceptEdits' }, s).permissionMode).toBe('acceptEdits')
  })
  it('recusa pasta que não existe e tarefa vazia', () => {
    expect(() => cleanHire({ cwd: join(dir, 'nada'), task: 'x' }, s)).toThrow('Escolha uma pasta')
    expect(() => cleanHire({ cwd: 42, task: 'x' }, s)).toThrow('Escolha uma pasta')
    expect(() => cleanHire(null, s)).toThrow('Escolha uma pasta')
    expect(() => cleanHire({ cwd: dir, task: '   ' }, s)).toThrow('Descreva a tarefa')
    expect(() => cleanHire({ cwd: dir, task: ['x'] }, s)).toThrow('Descreva a tarefa')
  })
  it('corta o nome, limpa o cérebro e descarta chaves extras', () => {
    const r = cleanHire({ name: 'x'.repeat(100), cwd: dir, task: 't', model: 'opus', accounts: ['ghost'], evil: true }, s)
    expect(r).toEqual({ name: 'x'.repeat(40), cwd: dir, task: 't', model: 'opus', accounts: [], permissionMode: 'default' })
    expect(cleanHire({ name: 7, cwd: dir, task: 't' }, s).name).toBe('')
  })
})

describe('cleanDelegateTarget', () => {
  it('agente existente: só o id', () => {
    expect(cleanDelegateTarget({ agentId: 'ag-1', hire: { permissionMode: 'bypassPermissions' } }, accounts)).toEqual({ agentId: 'ag-1' })
    expect(() => cleanDelegateTarget({ agentId: {} }, accounts)).toThrow('Agente inválido')
  })
  it('contratação nunca roda com bypass', () => {
    expect(cleanDelegateTarget({ hire: { permissionMode: 'bypassPermissions', model: 'opus' } }, accounts)).toEqual({ hire: { model: 'opus', permissionMode: undefined } })
    expect(cleanDelegateTarget({ hire: { permissionMode: 'auto' } }, accounts)).toEqual({ hire: { permissionMode: 'auto' } })
    expect(cleanDelegateTarget(undefined, accounts)).toEqual({ hire: { permissionMode: undefined } })
  })
  it('delegateMode cai em default fora da lista', () => {
    expect(delegateMode('bypassPermissions')).toBe('default')
    expect(delegateMode('plan')).toBe('plan')
    expect(delegateMode(undefined)).toBe('default')
  })
})

describe('cleanSettings', () => {
  it('ignora chaves desconhecidas e nunca muda a porta da ponte', () => {
    const out = cleanSettings({ evil: '<script>', bridgePort: 1, __proto__: { playerName: 'Herdado' } }, settings())
    expect(out).toEqual(settings())
    expect('evil' in out).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('aplica campos válidos', () => {
    const out = cleanSettings(
      {
        playerName: '  Allef ',
        pixelSize: 4,
        defaultModel: 'sonnet',
        defaultEffort: 'max',
        defaultPermissionMode: 'auto',
        notifications: false,
        ticketAutoCloseDays: '14',
        maxSubagents: 0,
        agentBudgetUsd: 12.345,
      },
      settings(),
    )
    expect(out).toMatchObject({
      playerName: 'Allef',
      pixelSize: 4,
      defaultModel: 'sonnet',
      defaultEffort: 'max',
      defaultPermissionMode: 'auto',
      notifications: false,
      ticketAutoCloseDays: 14,
      maxSubagents: 0,
      agentBudgetUsd: 12.35,
    })
  })
  it('campo com tipo ou tamanho errado mantém o valor atual', () => {
    const before = settings()
    const out = cleanSettings(
      {
        playerName: 'x'.repeat(33),
        pixelSize: 99,
        defaultModel: 'a b',
        defaultEffort: 'ultra',
        defaultPermissionMode: 'god',
        notifications: 'sim',
        ticketAutoCloseDays: 1.5,
        maxSubagents: 101,
        agentBudgetUsd: -1,
        playerLook: { ...before.playerLook, shirt: 'url(javascript:1)' },
      },
      before,
    )
    expect(out).toEqual(before)
  })
  it('playerLook: valida cores e corte, descarta chaves extras', () => {
    const look = { skin: '#000000', hair: '#111111', hairStyle: 5, shirt: '#222222', pants: '#333333', shoes: '#444444', extra: 'x' }
    const { extra: _extra, ...clean } = look
    expect(cleanSettings({ playerLook: look }, settings()).playerLook).toEqual(clean)
    expect(cleanSettings({ playerLook: { ...look, hairStyle: 6 } }, settings()).playerLook).toEqual(settings().playerLook)
  })
  it('playerName vazio mantém o atual; modelo e esforço vazios são o padrão', () => {
    const cur = { ...settings(), defaultModel: 'opus', defaultEffort: 'high' as const }
    const out = cleanSettings({ playerName: '   ', defaultModel: '', defaultEffort: '' }, cur)
    expect(out.playerName).toBe('Você')
    expect(out.defaultModel).toBe('')
    expect(out.defaultEffort).toBe('')
  })
  it('contas, contas padrão e andares passam pelos limpadores', () => {
    const out = cleanSettings(
      {
        accounts: [{ id: 'a-1', name: 'Novo' }],
        defaultAccounts: ['a-1', 'ghost'],
        projects: [{ id: 'p1', name: 'Loja', cwd: dir }, { cwd: '/nao/existe' }],
      },
      settings(),
    )
    expect(out.accounts.map((a) => [a.id, a.name])).toEqual([
      ['a-1', 'Novo'],
      ['main', 'Principal'],
    ])
    expect(out.defaultAccounts).toEqual(['a-1'])
    expect(out.projects).toEqual([{ id: 'p1', name: 'Loja', cwd: dir }])
  })
  it('patch que não é objeto não muda nada', () => {
    expect(cleanSettings(null, settings())).toEqual(settings())
    expect(cleanSettings('x', settings())).toEqual(settings())
  })
})

describe('schemas do IPC', () => {
  it('PermissionDecision: comportamento conhecido, sem chaves extras', () => {
    const ok = permissionDecisionSchema.parse({ requestId: 'r1', behavior: 'allow', answers: { 'Qual?': 'A' }, evil: 1 })
    expect(ok).toEqual({ requestId: 'r1', behavior: 'allow', answers: { 'Qual?': 'A' } })
    expect(permissionDecisionSchema.safeParse({ requestId: 'r1', behavior: 'sudo' }).success).toBe(false)
    expect(permissionDecisionSchema.safeParse({ requestId: '', behavior: 'deny' }).success).toBe(false)
    expect(permissionDecisionSchema.safeParse({ requestId: 'r1', behavior: 'deny', message: 'x'.repeat(10_001) }).success).toBe(false)
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`q${i}`, 'a']))
    expect(permissionDecisionSchema.safeParse({ requestId: 'r1', behavior: 'allow', answers: many }).success).toBe(false)
  })
  it('TicketDraft: exige título, aceita nulos, descarta chaves extras', () => {
    const d = ticketDraftSchema.parse({ title: 'T', cwd: null, estimate: null, dueDate: null, acceptance: [{ text: 'a' }], key: 'AO-1', id: 'x' })
    expect(d).toEqual({ title: 'T', cwd: null, estimate: null, dueDate: null, acceptance: [{ text: 'a', done: false }] })
    expect(ticketDraftSchema.safeParse({}).success).toBe(false)
    expect(ticketDraftSchema.safeParse({ title: 'T', type: 'epic' }).success).toBe(false)
    expect(ticketDraftSchema.safeParse({ title: 'T', tags: 'a,b' }).success).toBe(false)
    expect(ticketDraftSchema.safeParse({ title: 'T', description: 'x'.repeat(100_001) }).success).toBe(false)
    expect(ticketDraftSchema.parse({ title: 'T', estimate: Number.NaN }).estimate).toBeNull()
  })
  it('TicketPatch: tudo opcional', () => {
    expect(ticketPatchSchema.parse({})).toEqual({})
    expect(ticketPatchSchema.parse({ status: 'review', reporter: { name: 'x' } })).toEqual({ status: 'review' })
    expect(ticketPatchSchema.safeParse({ status: 'archived' }).success).toBe(false)
  })
  it('anexos: forma conhecida e tamanho limitado', () => {
    expect(attachmentsSchema.parse([{ name: 'a.png', dataBase64: 'AAAA', other: 1 }])).toEqual([{ name: 'a.png', dataBase64: 'AAAA' }])
    expect(attachmentsSchema.safeParse([{ path: '/x' }]).success).toBe(false)
    expect(attachmentsSchema.safeParse('x').success).toBe(false)
  })
  it('links externos só http(s)', () => {
    expect(externalUrlSchema.safeParse('https://claude.ai').success).toBe(true)
    expect(externalUrlSchema.safeParse('file:///etc/passwd').success).toBe(false)
    expect(externalUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
  })
  it('busca e responsável toleram lixo', () => {
    expect(searchSchema.parse(42)).toBeUndefined()
    expect(searchSchema.parse('ao-1')).toBe('ao-1')
    expect(assigneeSchema.parse(null)).toBeNull()
    expect(assigneeSchema.parse(undefined)).toBeUndefined()
    expect(assigneeSchema.safeParse('admin').success).toBe(false)
  })
})
