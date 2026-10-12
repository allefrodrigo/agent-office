import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { DEFAULT_VIDEO } from '../src/shared/video'

// Store reads userData/office.json; each test gets its own folder through the electron mock.
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-store-'))
  app.setPath('userData', dir)
})

const write = (data: unknown) => writeFileSync(join(dir, 'office.json'), typeof data === 'string' ? data : JSON.stringify(data))

describe('Store: carga e migração das configurações', () => {
  it('sem arquivo: configurações padrão com a conta principal', () => {
    const s = new Store()
    expect(s.settings.playerName).toBe('Você')
    expect(s.settings.accounts.map((a) => a.id)).toEqual(['main'])
    expect(s.settings.projects).toEqual([])
    expect(s.agents).toEqual([])
    expect(s.results).toEqual([])
    expect(s.ledger).toEqual({ days: {}, agents: {}, switches: [] })
    expect(s.ledgerSessions).toEqual({})
  })

  it('v0.2: a pasta de squads vira o primeiro andar de projeto', () => {
    write({ settings: { playerName: 'Ana', squadFolder: '/Users/ana/loja-legal', squadFloorName: '' } })
    const s = new Store()
    expect(s.settings.playerName).toBe('Ana')
    expect(s.settings.projects).toEqual([{ id: 'p1', name: 'Loja Legal', cwd: '/Users/ana/loja-legal' }])
    expect('squadFolder' in s.settings).toBe(false)
    expect('squadFloorName' in s.settings).toBe(false)
  })

  it('v0.2 com nome do andar escolhido', () => {
    write({ settings: { squadFolder: '/x/y', squadFloorName: '  Fábrica  ' } })
    expect(new Store().settings.projects).toEqual([{ id: 'p1', name: 'Fábrica', cwd: '/x/y' }])
  })

  it('andares já existentes vencem a pasta antiga de squads', () => {
    const projects = [{ id: 'p9', name: 'Novo', cwd: '/novo' }]
    write({ settings: { squadFolder: '/velho', projects } })
    expect(new Store().settings.projects).toEqual(projects)
  })

  it('contas faltando: a principal entra primeiro; listas quebradas viram vazias', () => {
    const other = { id: 'a-1', name: 'Trabalho', provider: 'claude', color: '#4a8fe0', configDir: '/tmp/a-1' }
    write({ settings: { accounts: [other], defaultAccounts: 'a-1', projects: 'lixo' } })
    const s = new Store().settings
    expect(s.accounts.map((a) => a.id)).toEqual(['main', 'a-1'])
    expect(s.defaultAccounts).toEqual([])
    expect(s.projects).toEqual([])
  })

  it('accounts que não é lista vira só a principal', () => {
    write({ settings: { accounts: { main: true } } })
    expect(new Store().settings.accounts.map((a) => a.id)).toEqual(['main'])
  })

  it('campos novos chegam com o padrão em arquivos antigos', () => {
    write({ settings: { playerName: 'Ana' } })
    const s = new Store().settings
    expect(s.ticketAutoCloseDays).toBe(7)
    expect(s.maxSubagents).toBe(10)
    expect(s.agentBudgetUsd).toBe(0)
    expect(s.video).toEqual(DEFAULT_VIDEO)
  })

  it('vídeo: campo ruim volta ao padrão, os bons ficam', () => {
    write({ settings: { video: { shadows: false, fpsLimit: 45, effects: 'reduced', extra: 1 } } })
    expect(new Store().settings.video).toEqual({ ...DEFAULT_VIDEO, shadows: false, effects: 'reduced' })
  })

  it('JSON truncado não derruba o app: volta aos padrões', () => {
    write('{"settings":{"playerName":"Ana","accounts":[')
    const s = new Store()
    expect(s.settings.playerName).toBe('Você')
    expect(s.settings.accounts.map((a) => a.id)).toEqual(['main'])
  })

  it('livro-caixa antigo ganha as listas que faltam', () => {
    write({ settings: {}, ledger: { days: { '/p': {} } } })
    expect(new Store().ledger).toEqual({ days: { '/p': {} }, agents: {}, switches: [] })
  })
})

describe('Store: gravação', () => {
  it('flush grava e a próxima carga lê o mesmo', () => {
    const s = new Store()
    s.settings = { ...s.settings, playerName: 'Bia' }
    s.agents = []
    s.results = []
    s.ledgerSessions['sess'] = { total: 1, t: 1 }
    s.flush()
    const raw = JSON.parse(readFileSync(join(dir, 'office.json'), 'utf8'))
    expect(raw.settings.playerName).toBe('Bia')
    const again = new Store()
    expect(again.settings.playerName).toBe('Bia')
    expect(again.ledgerSessions).toEqual({ sess: { total: 1, t: 1 } })
  })

  it('save agrupa as gravações e flush cancela a pendente', () => {
    const s = new Store()
    s.save()
    s.save()
    s.flush()
    expect(JSON.parse(readFileSync(join(dir, 'office.json'), 'utf8')).settings.playerName).toBe('Você')
  })
})

describe('Store: forma do office.json (AO-24)', () => {
  it('agentes que não são lista contam como corrompido; o .bak carrega', () => {
    writeFileSync(join(dir, 'office.json.bak'), JSON.stringify({ settings: { playerName: 'Bak' }, agents: [] }))
    write({ settings: { playerName: 'Ruim' }, agents: { a: 1 } })
    const s = new Store()
    expect(s.settings.playerName).toBe('Bak')
    expect(s.agents).toEqual([])
  })

  it('aceita office.json com BOM', () => {
    write('\uFEFF' + JSON.stringify({ settings: { playerName: 'Ana' } }))
    expect(new Store().settings.playerName).toBe('Ana')
  })
})
