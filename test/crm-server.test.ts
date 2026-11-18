import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CrmServerStatus } from '@shared/types'
import {
  canStopEngine,
  colimaMemory,
  containerState,
  engineKindOf,
  evolutionState,
  findEvolution,
  formatBytes,
  imageVersion,
  parsePs,
  parsePsLine,
  parseSize,
  parseStats,
  serverView,
  toContainers,
  type PsRow,
} from '@shared/crm-server'
import { LocalServer, type RunResult, type Runner } from '../src/main/crm/server'
import { cleanCrmServerAction } from '../src/main/validate'
import { crmServerHandlers } from '../src/main/ipc/crm-server'

const API = 'a'.repeat(12)
const PG = 'b'.repeat(12)
const OTHER = 'c'.repeat(12)
const FOLDER = '/Users/teste/evolution'
const row = (id: string, image: string, state: string, project = 'evolution', service = 'evolution-api', folder = FOLDER) =>
  JSON.stringify([id, image, state, project, service, folder])

const base: CrmServerStatus = {
  docker: true,
  engine: 'running',
  engineKind: 'colima',
  evolution: 'running',
  containers: [],
  others: 0,
  canStopEngine: false,
  at: 0,
}

describe('ler o docker', () => {
  it('lê uma linha do docker ps, mesmo com vírgula e tab na pasta', () => {
    expect(parsePsLine(row(API, 'evoapicloud/evolution-api:v2.3.7', 'running', 'evo', 'evolution-api', '/x/a,b\tc'))).toEqual({
      id: API,
      image: 'evoapicloud/evolution-api:v2.3.7',
      state: 'running',
      project: 'evo',
      service: 'evolution-api',
      folder: '/x/a,b\tc',
    })
  })

  it('recusa linha que não é do formato, id que não é hexadecimal e campo que não é texto', () => {
    expect(parsePsLine('')).toBeNull()
    expect(parsePsLine('Cannot connect to the Docker daemon')).toBeNull()
    expect(parsePsLine(row('nao-e-id; rm -rf /', 'x', 'running'))).toBeNull()
    expect(parsePsLine(JSON.stringify([API, 1, 'running', 'p', 's', '/']))).toBeNull()
    expect(parsePsLine('{"a":1}')).toBeNull()
  })

  it('acha o projeto da Evolution e leva o Postgres junto, sem os contêineres de outro projeto', () => {
    const rows = parsePs(
      [
        row(OTHER, 'public.ecr.aws/supabase/studio:1', 'running', 'supabase', 'studio', '/outro'),
        row(PG, 'postgres:15', 'exited', 'evolution', 'postgres'),
        row(API, 'evoapicloud/evolution-api:v2.3.7', 'exited'),
        'lixo',
      ].join('\n'),
    )
    const evo = findEvolution(rows)
    expect(evo?.project).toBe('evolution')
    expect(evo?.folder).toBe(FOLDER)
    expect(evo?.rows.map((r) => r.id)).toEqual([PG, API])
  })

  it('reconhece a imagem de outro publicador e ignora nome parecido', () => {
    const r = (image: string): PsRow[] => [{ id: API, image, state: 'running', project: 'p', service: 's', folder: '/' }]
    expect(findEvolution(r('atendai/evolution-api:v2.1.1'))).not.toBeNull()
    expect(findEvolution(r('evolution-api'))).not.toBeNull()
    expect(findEvolution(r('registry.local:5000/evolution-api@sha256:abc'))).not.toBeNull()
    expect(findEvolution(r('evolution-api-manager:1'))).toBeNull()
    expect(findEvolution(r('postgres:15'))).toBeNull()
    expect(findEvolution([{ ...r('evolution-api')[0], project: 'Projeto Inválido' }])).toBeNull()
  })

  it('converte tamanhos do docker stats', () => {
    expect(parseSize('136MiB')).toBe(136 * 1024 ** 2)
    expect(parseSize('1.5GiB')).toBe(Math.round(1.5 * 1024 ** 3))
    expect(parseSize('512kB')).toBe(512_000)
    expect(parseSize('0B')).toBe(0)
    expect(parseSize('muito')).toBe(0)
    expect(
      parseStats([JSON.stringify([API, '0.04%', '136MiB / 7.738GiB']), 'x', JSON.stringify([PG, '--', '-- / --'])].join('\n')),
    ).toEqual([
      { id: API, cpu: 0.04, mem: 136 * 1024 ** 2 },
      { id: PG, cpu: 0, mem: 0 },
    ])
  })

  it('traduz o estado do contêiner e o do conjunto', () => {
    expect(containerState('running')).toBe('running')
    expect(containerState('restarting')).toBe('starting')
    expect(containerState('exited')).toBe('stopped')
    expect(containerState('created')).toBe('stopped')
    expect(containerState('paused')).toBe('other')
    const rows = parsePs([row(API, 'evolution-api', 'running'), row(PG, 'postgres:15', 'exited', 'evolution', 'postgres')].join('\n'))
    expect(evolutionState([])).toBe('missing')
    expect(evolutionState(rows)).toBe('partial')
    expect(evolutionState(rows.map((r) => ({ ...r, state: 'running' })))).toBe('running')
    expect(evolutionState(rows.map((r) => ({ ...r, state: 'exited' })))).toBe('stopped')
  })

  it('põe a memória medida só nos contêineres ligados', () => {
    const rows = parsePs([row(API, 'evolution-api', 'running'), row(PG, 'postgres:15', 'exited', 'evolution', 'postgres')].join('\n'))
    const cs = toContainers(rows, [
      { id: API + 'f'.repeat(52), cpu: 1, mem: 100 },
      { id: PG, cpu: 0, mem: 50 },
    ])
    expect(cs).toEqual([
      { service: 'evolution-api', image: 'evolution-api', state: 'running', mem: 100, cpu: 1 },
      { service: 'postgres', image: 'postgres:15', state: 'stopped' },
    ])
  })

  it('sabe qual motor roda o docker', () => {
    expect(engineKindOf('colima\n')).toBe('colima')
    expect(engineKindOf('colima-trabalho')).toBe('colima')
    expect(engineKindOf('default', 'colima')).toBe('colima')
    expect(engineKindOf('desktop-linux')).toBe('docker-desktop')
    expect(engineKindOf('default', 'docker-desktop')).toBe('docker-desktop')
    expect(engineKindOf('default', 'meu-servidor')).toBe('other')
  })

  it('lê a memória da VM do Colima', () => {
    const out = '{"name":"outro","memory":1}\n{"name":"default","status":"Running","memory":8589934592}\nlixo'
    expect(colimaMemory(out)).toBe(8589934592)
    expect(colimaMemory('lixo')).toBeUndefined()
  })

  it('tira a versão da etiqueta da imagem', () => {
    expect(imageVersion('evoapicloud/evolution-api:v2.3.7')).toBe('2.3.7')
    expect(imageVersion('evoapicloud/evolution-api:2.2.3')).toBe('2.2.3')
    expect(imageVersion('evoapicloud/evolution-api:latest')).toBeUndefined()
    expect(imageVersion('evoapicloud/evolution-api')).toBeUndefined()
    expect(imageVersion('evoapicloud/evolution-api:homolog')).toBeUndefined()
  })

  it('escreve bytes em pt-BR', () => {
    expect(formatBytes(136 * 1024 ** 2)).toBe('143 MB')
    expect(formatBytes(8589934592)).toBe('8,6 GB')
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(10)).toBe('1 MB')
  })
})

describe('o que a caixa mostra', () => {
  it('só oferece desligar o Colima quando nada mais depende dele', () => {
    expect(canStopEngine({ ...base, evolution: 'stopped' })).toBe(true)
    expect(canStopEngine({ ...base, evolution: 'missing' })).toBe(true)
    expect(canStopEngine({ ...base, evolution: 'running' })).toBe(false)
    expect(canStopEngine({ ...base, evolution: 'partial' })).toBe(false)
    expect(canStopEngine({ ...base, evolution: 'stopped', others: 9 })).toBe(false)
    expect(canStopEngine({ ...base, evolution: 'stopped', engineKind: 'docker-desktop' })).toBe(false)
    expect(canStopEngine({ ...base, evolution: 'stopped', engine: 'stopped' })).toBe(false)
  })

  it('ligado: versão, memória, motor e o botão Desligar', () => {
    const v = serverView({
      ...base,
      others: 9,
      containers: [
        { service: 'evolution-api', image: 'evoapicloud/evolution-api:v2.3.7', state: 'running', mem: 136e6 },
        { service: 'postgres', image: 'postgres:15', state: 'running', mem: 37e6 },
      ],
    })
    expect(v).toMatchObject({ tone: 'on', label: 'Ligado', primary: 'stop', engineStop: false })
    expect(v.detail).toContain('Evolution 2.3.7')
    expect(v.detail).toContain('173 MB')
    expect(v.detail).toContain('9 outros contêineres usam o Colima')
  })

  it('desligado: Ligar, e Desligar o Colima só sem outros contêineres', () => {
    expect(serverView({ ...base, evolution: 'stopped', canStopEngine: true, engineMem: 8e9 })).toMatchObject({
      tone: 'off',
      primary: 'start',
      engineStop: true,
    })
    const busy = serverView({ ...base, evolution: 'stopped', others: 1 })
    expect(busy).toMatchObject({ primary: 'start', engineStop: false })
    expect(busy.detail).toContain('1 outro contêiner usa')
  })

  it('motor desligado: Ligar liga o motor quando o app sabe qual é', () => {
    expect(serverView({ ...base, engine: 'stopped' })).toMatchObject({ label: 'Colima desligado', primary: 'start' })
    expect(serverView({ ...base, engine: 'stopped', engineKind: 'other' }).primary).toBeUndefined()
  })

  it('sem docker, sem contêiner, pela metade e ocupado', () => {
    expect(serverView({ ...base, docker: false }).label).toBe('Docker não encontrado')
    expect(serverView({ ...base, evolution: 'missing' }).primary).toBeUndefined()
    expect(serverView({ ...base, evolution: 'missing', folder: FOLDER })).toMatchObject({ primary: 'start' })
    expect(serverView({ ...base, evolution: 'partial' })).toMatchObject({ tone: 'warn', primary: 'start' })
    expect(serverView({ ...base, busy: 'engine-starting' })).toMatchObject({ tone: 'busy', label: 'Ligando o Docker…' })
    expect(serverView({ ...base, busy: 'stopping' }).primary).toBeUndefined()
  })
})

// ---------- LocalServer com um docker falso ----------

interface Fake {
  engine: boolean
  rows: string[]
  others: number
  calls: { bin: string; args: string[]; cwd?: string; path?: string }[]
  fail?: RegExp
}

function fakeRunner(f: Fake): Runner {
  return async (bin, args, opts) => {
    f.calls.push({ bin, args, cwd: opts.cwd, path: opts.env?.PATH })
    const ok = (out = ''): RunResult => ({ code: 0, out, err: '' })
    const cmd = `${bin.split('/').pop()} ${args.join(' ')}`
    if (f.fail?.test(cmd)) return { code: 1, out: '', err: `falhou: ${cmd}\nmais linhas` }
    if (cmd === 'docker context show') return ok('colima\n')
    if (cmd.startsWith('docker info')) return f.engine ? ok('"colima"\n') : { code: 1, out: '', err: 'Cannot connect to the Docker daemon' }
    if (cmd === 'colima list --json') return ok('{"name":"default","memory":8589934592}\n')
    if (cmd === 'colima start') {
      f.engine = true
      return ok()
    }
    if (cmd === 'colima stop') {
      f.engine = false
      return ok()
    }
    if (!f.engine) return { code: 1, out: '', err: 'Cannot connect to the Docker daemon' }
    if (cmd.startsWith('docker ps -a')) return ok(f.rows.join('\n'))
    if (cmd.startsWith('docker ps -q')) {
      const mine = f.rows
        .map((l) => JSON.parse(l) as string[])
        .filter((r) => r[2] === 'running')
        .map((r) => r[0] + '0'.repeat(52))
      return ok([...mine, ...Array.from({ length: f.others }, (_, i) => String(i).padStart(64, 'd'))].join('\n'))
    }
    if (cmd.startsWith('docker stats')) return ok(JSON.stringify([API, '0.5%', '100MiB / 8GiB']))
    if (args[0] === 'start' || args[0] === 'stop') {
      const ids = args.filter((a) => /^[0-9a-f]{12}$/.test(a))
      f.rows = f.rows.map((l) => {
        const r = JSON.parse(l) as string[]
        return ids.includes(r[0]) ? JSON.stringify([r[0], r[1], args[0] === 'start' ? 'running' : 'exited', r[3], r[4], r[5]]) : l
      })
      return ok()
    }
    if (args[0] === 'compose') {
      f.rows = [row(PG, 'postgres:15', 'running', 'evolution', 'postgres'), row(API, 'evoapicloud/evolution-api:v2.3.7', 'running')]
      return ok()
    }
    return { code: 1, out: '', err: `comando inesperado: ${cmd}` }
  }
}

let dir: string
let fake: Fake
let clock = 1_000
const bins: Record<string, string> = { docker: '/opt/homebrew/bin/docker', colima: '/opt/homebrew/bin/colima' }
const make = (over: Partial<ConstructorParameters<typeof LocalServer>[0]> = {}) =>
  new LocalServer({
    dir,
    run: fakeRunner(fake),
    platform: 'darwin',
    findBin: (n) => bins[n],
    now: () => (clock += 1000),
    sleep: async () => {},
    ...over,
  })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-server-'))
  fake = {
    engine: true,
    rows: [row(PG, 'postgres:15', 'running', 'evolution', 'postgres'), row(API, 'evoapicloud/evolution-api:v2.3.7', 'running')],
    others: 0,
    calls: [],
  }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('LocalServer', () => {
  it('lê o estado, mede a memória e lembra a pasta do compose (0600)', async () => {
    const s = await make().status()
    expect(s).toMatchObject({
      docker: true,
      engine: 'running',
      engineKind: 'colima',
      engineMem: 8589934592,
      evolution: 'running',
      project: 'evolution',
      folder: FOLDER,
      others: 0,
    })
    expect(s.containers.find((c) => c.service === 'evolution-api')).toMatchObject({ state: 'running', mem: 100 * 1024 ** 2 })
    const file = join(dir, 'crm-servidor.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ project: 'evolution', folder: FOLDER })
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    // the PATH carries Homebrew: an app opened from the Finder lacks it, and colima needs limactl
    expect(fake.calls[0].path?.split(delimiter)).toContain('/opt/homebrew/bin')
  })

  it('sem docker instalado, diz isso e não roda nada', async () => {
    const s = await make({ findBin: () => undefined }).status()
    expect(s).toMatchObject({ docker: false, engine: 'missing', evolution: 'missing' })
    expect(fake.calls).toEqual([])
  })

  it('desliga a API antes do banco e avisa a tela', async () => {
    const seen: CrmServerStatus[] = []
    const s = await make({ broadcast: (x) => seen.push(x) }).act('stop')
    expect(s.evolution).toBe('stopped')
    expect(s.canStopEngine).toBe(true)
    const stop = fake.calls.find((c) => c.args[0] === 'stop')!
    expect(stop.args).toEqual(['stop', '--time', '15', API, PG])
    expect(seen[0].busy).toBe('stopping')
    expect(seen.at(-1)?.evolution).toBe('stopped')
    expect(seen.at(-1)?.busy).toBeUndefined()
  })

  it('liga o banco antes da API', async () => {
    fake.rows = fake.rows.map((l) => l.replace('"running"', '"exited"'))
    const s = await make().act('start')
    expect(s.evolution).toBe('running')
    expect(fake.calls.find((c) => c.args[0] === 'start')!.args).toEqual(['start', PG, API])
  })

  it('com o Colima desligado, Ligar liga o Colima e depois a Evolution', async () => {
    fake.engine = false
    fake.rows = fake.rows.map((l) => l.replace('"running"', '"exited"'))
    const server = make()
    expect(await server.status()).toMatchObject({ engine: 'stopped', engineKind: 'colima' })
    const s = await server.act('start')
    expect(s).toMatchObject({ engine: 'running', evolution: 'running' })
    const order = fake.calls.map((c) => `${c.bin.split('/').pop()} ${c.args[0]}`)
    expect(order.indexOf('colima start')).toBeLessThan(order.indexOf('docker start'))
  })

  it('não desliga o Colima com outro contêiner rodando, nem com a Evolution ligada', async () => {
    fake.others = 2
    await expect(make().act('stopEngine')).rejects.toThrow('Desligue a Evolution antes do Colima.')
    fake.rows = fake.rows.map((l) => l.replace('"running"', '"exited"'))
    await expect(make().act('stopEngine')).rejects.toThrow('2 outros contêineres usam ele')
    expect(fake.calls.some((c) => c.args[0] === 'stop' && c.bin.endsWith('colima'))).toBe(false)
  })

  it('desliga o Colima quando nada mais usa', async () => {
    fake.rows = fake.rows.map((l) => l.replace('"running"', '"exited"'))
    const s = await make().act('stopEngine')
    expect(s.engine).toBe('stopped')
    expect(fake.calls.some((c) => c.bin.endsWith('colima') && c.args[0] === 'stop')).toBe(true)
  })

  it('contêineres apagados (compose down): sobe de novo na pasta lembrada, sem ler o .env', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'ao-crm-compose-'))
    try {
      writeFileSync(join(folder, 'docker-compose.yml'), 'services: {}\n')
      writeFileSync(join(dir, 'crm-servidor.json'), JSON.stringify({ project: 'evolution', folder }))
      fake.rows = []
      const s = await make().act('start')
      expect(s.evolution).toBe('running')
      const up = fake.calls.find((c) => c.args[0] === 'compose')!
      expect(up.args).toEqual(['compose', '--project-name', 'evolution', '--file', 'docker-compose.yml', 'up', '--detach'])
      expect(up.cwd).toBe(folder)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('sem contêiner e sem pasta lembrada, diz o que rodar', async () => {
    fake.rows = []
    await expect(make().act('start')).rejects.toThrow('docker compose up -d')
  })

  it('pasta lembrada adulterada não vira argumento', async () => {
    writeFileSync(join(dir, 'crm-servidor.json'), JSON.stringify({ project: 'x; rm -rf /', folder: 'relativa' }))
    fake.rows = []
    await expect(make().act('start')).rejects.toThrow('Não achei os contêineres')
    expect(fake.calls.some((c) => c.args[0] === 'compose')).toBe(false)
  })

  it('erro do docker vira mensagem curta, com o que fazer', async () => {
    fake.rows = fake.rows.map((l) => l.replace('"running"', '"exited"'))
    fake.fail = /^docker start/
    await expect(make().act('start')).rejects.toThrow(/^O docker não ligou a Evolution: falhou: docker start/)
  })

  it('uma ação por vez; o estado no meio diz o que está acontecendo', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const inner = fakeRunner(fake)
    const server = make({
      run: async (bin, args, opts) => {
        if (args[0] === 'stop') await gate
        return inner(bin, args, opts)
      },
    })
    const first = server.act('stop')
    await new Promise((r) => setTimeout(r, 10))
    await expect(server.act('start')).rejects.toThrow('Espere a ação anterior')
    expect((await server.status()).busy).toBe('stopping')
    release()
    expect((await first).evolution).toBe('stopped')
    expect((await server.status()).busy).toBeUndefined()
  })
})

describe('IPC do servidor local', () => {
  it('só aceita as quatro ações', async () => {
    expect(cleanCrmServerAction('stop')).toBe('stop')
    expect(() => cleanCrmServerAction('rm -rf /')).toThrow('Ação inválida para o servidor local.')
    expect(() => cleanCrmServerAction(undefined)).toThrow()
    const acted: string[] = []
    const h = crmServerHandlers({ act: async (a) => (acted.push(a), base) })
    await h['office:crmServer']('status')
    expect(acted).toEqual(['status'])
    expect(() => h['office:crmServer']({ action: 'stop' })).toThrow()
  })
})
