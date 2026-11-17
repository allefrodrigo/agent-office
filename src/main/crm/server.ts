import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { CrmServerAction, CrmServerStatus } from '@shared/types'
import {
  CONTAINER_ID_RE,
  PROJECT_RE,
  PS_FORMAT,
  STATS_FORMAT,
  canStopEngine,
  colimaMemory,
  engineKindOf,
  evolutionState,
  findEvolution,
  parsePs,
  parseStats,
  toContainers,
  type EvolutionProject,
} from '@shared/crm-server'
import { findBin } from '../creative/tools'
import { log } from '../log'

// Servidor local da Evolution: lê o estado e liga ou desliga os contêineres do compose da
// Evolution e, no Mac, o Colima que roda o Docker. O usuário nem sempre usa o WhatsApp e quer
// devolver a memória da máquina sem abrir o terminal.
//
// WARNING (segurança): só execFile, sem shell. Os argumentos são fixos, ou ids de contêiner e
// nomes de projeto que o próprio docker devolveu, conferidos por regex antes de voltar à linha de
// comando. O renderer só escolhe entre 'status', 'start', 'stop' e 'stopEngine'. O app nunca lê o
// .env do compose (a chave global fica lá): `docker compose up` roda na pasta e o compose o lê.

export interface RunResult {
  code: number
  out: string
  err: string
}

export type Runner = (bin: string, args: string[], opts: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<RunResult>

const FILE_MODE = 0o600
const READ_MS = 15_000
const STATS_MS = 10_000
const ACT_MS = 90_000
const ENGINE_START_MS = 240_000
const ENGINE_WAIT_MS = 120_000
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']

/** execFile without a shell; never rejects (the code says how it went). */
export const execNoShell: Runner = (bin, args, opts) =>
  new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: opts.timeoutMs, cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
        resolve({ code, out: String(stdout ?? ''), err: String(stderr ?? (err ? err.message : '')) })
      },
    )
  })

export interface LocalServerDeps {
  /** userData: where crm-servidor.json remembers the compose folder. */
  dir: string
  run?: Runner
  platform?: NodeJS.Platform
  findBin?: (name: string) => string | undefined
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Every status after an action, for the chip on the CRM screen. */
  broadcast?: (status: CrmServerStatus) => void
}

interface Remembered {
  project?: string
  folder?: string
}

/** The first line of a command's error, without paths of the home folder. */
function short(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? ''
  return line.replaceAll(homedir(), '~').slice(0, 200)
}

/**
 * The Evolution that runs on this machine. One action at a time; `status` while an action runs
 * answers with `busy`. Every action ends with a fresh status, also broadcast.
 */
export class LocalServer {
  private run: Runner
  private platform: NodeJS.Platform
  private find: (name: string) => string | undefined
  private now: () => number
  private sleep: (ms: number) => Promise<void>
  private busy: CrmServerStatus['busy'] = undefined
  private last: CrmServerStatus | null = null

  constructor(private deps: LocalServerDeps) {
    this.run = deps.run ?? execNoShell
    this.platform = deps.platform ?? process.platform
    this.find = deps.findBin ?? findBin
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  private get file(): string {
    return join(this.deps.dir, 'crm-servidor.json')
  }

  private remembered(): Remembered {
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as Remembered
      return {
        project: typeof v.project === 'string' && PROJECT_RE.test(v.project) ? v.project : undefined,
        folder: typeof v.folder === 'string' && isAbsolute(v.folder) && v.folder.length < 1000 ? v.folder : undefined,
      }
    } catch {
      return {}
    }
  }

  private remember(p: EvolutionProject): void {
    const r = this.remembered()
    if (r.project === p.project && r.folder === p.folder) return
    try {
      writeFileSync(this.file, JSON.stringify({ project: p.project, folder: isAbsolute(p.folder) ? p.folder : undefined }), {
        mode: FILE_MODE,
      })
    } catch (err) {
      log.warn(`CRM: não consegui guardar a pasta da Evolution: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** PATH with the tools' folders: an app opened from the Finder gets only /usr/bin:/bin. Colima needs limactl beside it. */
  private env(bins: (string | undefined)[]): NodeJS.ProcessEnv {
    const dirs = [
      ...bins.filter((b): b is string => !!b).map((b) => dirname(b)),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      process.env.PATH ?? '',
    ]
    return { ...process.env, PATH: [...new Set(dirs.flatMap((d) => d.split(delimiter)).filter(Boolean))].join(delimiter) }
  }

  private docker(args: string[], timeoutMs = READ_MS, cwd?: string): Promise<RunResult> {
    const bin = this.find('docker')
    if (!bin) return Promise.resolve({ code: 127, out: '', err: 'docker não encontrado' })
    return this.run(bin, args, { timeoutMs, cwd, env: this.env([bin, this.find('colima')]) })
  }

  private colima(args: string[], timeoutMs = READ_MS): Promise<RunResult> {
    const bin = this.find('colima')
    if (!bin) return Promise.resolve({ code: 127, out: '', err: 'colima não encontrado' })
    return this.run(bin, args, { timeoutMs, env: this.env([bin, this.find('docker')]) })
  }

  /** Reads everything. `measure` adds docker stats (about 2 s): the box asks for it, the chip does not. */
  async status(measure = true): Promise<CrmServerStatus> {
    const at = this.now()
    const base: CrmServerStatus = {
      docker: false,
      engine: 'missing',
      evolution: 'missing',
      containers: [],
      others: 0,
      canStopEngine: false,
      at,
    }
    if (this.busy) return { ...(this.last ?? base), busy: this.busy, at }
    const status = await this.read(measure, base)
    this.last = status
    return status
  }

  private async read(measure: boolean, base: CrmServerStatus): Promise<CrmServerStatus> {
    if (!this.find('docker')) return base
    const s: CrmServerStatus = { ...base, docker: true, engine: 'stopped' }
    const ctx = await this.docker(['context', 'show'])
    const info = await this.docker(['info', '--format', '{{json .Name}}'])
    const infoName = (() => {
      try {
        return info.code === 0 ? String(JSON.parse(info.out.trim())) : ''
      } catch {
        return ''
      }
    })()
    s.engineKind = engineKindOf(ctx.code === 0 ? ctx.out : '', infoName)
    if (s.engineKind !== 'colima' && this.find('colima') && ctx.code !== 0) s.engineKind = 'colima'
    if (s.engineKind === 'colima') {
      const list = await this.colima(['list', '--json'])
      if (list.code === 0) s.engineMem = colimaMemory(list.out)
    }
    const r = this.remembered()
    s.project = r.project
    s.folder = r.folder
    if (info.code !== 0) return s
    s.engine = 'running'

    const ps = await this.docker(['ps', '-a', '--filter', 'label=com.docker.compose.project', '--format', PS_FORMAT])
    if (ps.code !== 0) return { ...s, error: `O docker não listou os contêineres: ${short(ps.err)}` }
    const evo = findEvolution(parsePs(ps.out))
    const running = await this.docker(['ps', '-q', '--no-trunc', '--filter', 'status=running'])
    const runningIds =
      running.code === 0
        ? running.out
            .split('\n')
            .map((x) => x.trim())
            .filter((x) => CONTAINER_ID_RE.test(x))
        : []
    const mine = new Set(evo?.rows.map((x) => x.id) ?? [])
    s.others = runningIds.filter((id) => ![...mine].some((m) => id.startsWith(m))).length
    if (evo) {
      this.remember(evo)
      s.project = evo.project
      s.folder = isAbsolute(evo.folder) ? evo.folder : s.folder
      s.evolution = evolutionState(evo.rows)
      const up = evo.rows.filter((x) => x.state === 'running').map((x) => x.id)
      const stats = measure && up.length ? await this.docker(['stats', '--no-stream', '--format', STATS_FORMAT, ...up], STATS_MS) : null
      s.containers = toContainers(evo.rows, stats?.code === 0 ? parseStats(stats.out) : [])
    }
    s.canStopEngine = canStopEngine(s)
    return s
  }

  /** Runs one action, then answers with the new status. Throws a pt-BR message when it cannot. */
  async act(action: CrmServerAction): Promise<CrmServerStatus> {
    if (action === 'status') return this.status()
    if (this.busy) throw new Error('Espere a ação anterior do servidor terminar.')
    const before = await this.status(false)
    this.busy =
      action === 'start'
        ? before.engine === 'running'
          ? 'starting'
          : 'engine-starting'
        : action === 'stop'
          ? 'stopping'
          : 'engine-stopping'
    this.deps.broadcast?.({ ...before, busy: this.busy, at: this.now() })
    let failure: Error | null = null
    try {
      if (action === 'start') await this.start(before)
      else if (action === 'stop') await this.stop()
      else await this.stopEngine()
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err))
    } finally {
      this.busy = undefined
    }
    const after = await this.status(false)
    this.deps.broadcast?.(after)
    if (failure) {
      log.warn(`CRM: servidor local, ${action} falhou: ${failure.message}`)
      throw failure
    }
    log.info(`CRM: servidor local, ${action}: evolution ${after.evolution}, motor ${after.engine}`)
    return after
  }

  private async containers(): Promise<EvolutionProject | null> {
    const ps = await this.docker(['ps', '-a', '--filter', 'label=com.docker.compose.project', '--format', PS_FORMAT])
    if (ps.code !== 0) throw new Error(`O docker não listou os contêineres: ${short(ps.err)}`)
    return findEvolution(parsePs(ps.out))
  }

  private async start(before: CrmServerStatus): Promise<void> {
    if (!before.docker) throw new Error('O docker não está instalado. Instale o Colima (brew install colima docker) ou o Docker Desktop.')
    if (before.engine !== 'running') await this.startEngine(before)
    this.busy = 'starting'
    this.deps.broadcast?.({ ...before, busy: this.busy, at: this.now() })
    const evo = await this.containers()
    if (!evo) return this.composeUp()
    // The database first, the API after it (the compose's depends_on).
    const order = [...evo.rows.filter((r) => !/evolution-api/.test(r.image)), ...evo.rows.filter((r) => /evolution-api/.test(r.image))]
    const ids = order.filter((r) => r.state !== 'running' && CONTAINER_ID_RE.test(r.id)).map((r) => r.id)
    if (!ids.length) return
    const r = await this.docker(['start', ...ids], ACT_MS)
    if (r.code !== 0) throw new Error(`O docker não ligou a Evolution: ${short(r.err)}`)
  }

  /** The containers are gone (compose down): brings the compose of the remembered folder up again. */
  private async composeUp(): Promise<void> {
    const { project, folder } = this.remembered()
    const file = folder ? COMPOSE_FILES.find((f) => existsSync(join(folder, f))) : undefined
    if (!project || !folder || !file) {
      throw new Error(
        'Não achei os contêineres da Evolution. Na pasta do docker-compose.yml dela, rode "docker compose up -d" (veja o COMO-RODAR.md).',
      )
    }
    const r = await this.docker(['compose', '--project-name', project, '--file', file, 'up', '--detach'], ENGINE_START_MS, folder)
    if (r.code !== 0)
      throw new Error(
        `O docker compose não subiu a Evolution: ${short(r.err)}. Rode "docker compose up -d" em ${folder.replaceAll(homedir(), '~')} para ver o erro inteiro.`,
      )
  }

  private async startEngine(before: CrmServerStatus): Promise<void> {
    if (before.engineKind === 'colima') {
      if (!this.find('colima')) throw new Error('O Colima não está instalado. Instale com brew install colima e tente de novo.')
      const r = await this.colima(['start'], ENGINE_START_MS)
      if (r.code !== 0)
        throw new Error(`O Colima não ligou: ${short(r.err || r.out)}. Rode "colima start" no terminal para ver o erro inteiro.`)
    } else if (before.engineKind === 'docker-desktop' && this.platform === 'darwin') {
      const r = await this.run('/usr/bin/open', ['-a', 'Docker'], { timeoutMs: READ_MS })
      if (r.code !== 0) throw new Error('Não consegui abrir o Docker Desktop. Abra-o pelo Launchpad e toque em Ligar de novo.')
    } else {
      throw new Error('Ligue o Docker (abra o Docker Desktop ou rode "colima start") e toque em Ligar de novo.')
    }
    // colima start returns with the engine up; Docker Desktop takes a while after `open`.
    const until = this.now() + ENGINE_WAIT_MS
    while ((await this.docker(['info', '--format', '{{json .Name}}'])).code !== 0) {
      if (this.now() > until) throw new Error('O Docker não respondeu em 2 minutos. Confira se ele abriu e toque em Ligar de novo.')
      await this.sleep(2000)
    }
  }

  private async stop(): Promise<void> {
    const evo = await this.containers()
    if (!evo) return
    // The API first: it stops writing before its database goes.
    const order = [...evo.rows.filter((r) => /evolution-api/.test(r.image)), ...evo.rows.filter((r) => !/evolution-api/.test(r.image))]
    const ids = order.filter((r) => r.state === 'running' && CONTAINER_ID_RE.test(r.id)).map((r) => r.id)
    if (!ids.length) return
    const r = await this.docker(['stop', '--time', '15', ...ids], ACT_MS)
    if (r.code !== 0) throw new Error(`O docker não desligou a Evolution: ${short(r.err)}`)
  }

  private async stopEngine(): Promise<void> {
    // Checked again now: something may have started since the box drew the button.
    const now = await this.read(false, {
      docker: false,
      engine: 'missing',
      evolution: 'missing',
      containers: [],
      others: 0,
      canStopEngine: false,
      at: this.now(),
    })
    if (!canStopEngine(now)) {
      if (now.evolution === 'running' || now.evolution === 'partial') throw new Error('Desligue a Evolution antes do Colima.')
      if (now.others)
        throw new Error(
          `O Colima continua ligado: ${now.others === 1 ? '1 outro contêiner usa' : `${now.others} outros contêineres usam`} ele.`,
        )
      throw new Error('O Colima não está ligado, ou não é ele que roda o Docker aqui.')
    }
    const r = await this.colima(['stop'], ACT_MS)
    if (r.code !== 0) throw new Error(`O Colima não desligou: ${short(r.err || r.out)}`)
  }
}
