// Servidor local da Evolution (pedido do usuário na fase 2: "nem sempre vou precisar usar").
// Funções puras: ler o que o docker e o colima respondem e decidir o que a caixa "Servidor local"
// mostra. Quem roda os comandos é src/main/crm/server.ts.

import type { CrmServerContainer, CrmServerStatus } from './types/crm'

/** A container id as `docker ps` prints it (short or long). */
export const CONTAINER_ID_RE = /^[0-9a-f]{12,64}$/
/** A compose project name (compose's own rule: lowercase letters, digits, dash, underscore). */
export const PROJECT_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/
/** The Evolution API image, whoever publishes it: evoapicloud/evolution-api, atendai/evolution-api, a mirror. */
const EVOLUTION_IMAGE_RE = /(^|\/)evolution-api(:|@|$)/

/**
 * The `docker ps -a` format the main process asks for: one JSON array per line, so a folder with
 * a tab or a comma in its name still parses.
 */
export const PS_FORMAT =
  '[{{json .ID}},{{json .Image}},{{json .State}},{{json (.Label "com.docker.compose.project")}},{{json (.Label "com.docker.compose.service")}},{{json (.Label "com.docker.compose.project.working_dir")}}]'

/** The `docker stats --no-stream` format: id, CPU and memory, one JSON array per line. */
export const STATS_FORMAT = '[{{json .ID}},{{json .CPUPerc}},{{json .MemUsage}}]'

export interface PsRow {
  id: string
  image: string
  /** Docker's state: running, exited, created, restarting, paused, dead. */
  state: string
  project: string
  service: string
  folder: string
}

export interface StatsRow {
  id: string
  /** Percent of one CPU. */
  cpu: number
  /** Bytes. */
  mem: number
}

/** The Evolution's compose project: its name, folder and containers. */
export interface EvolutionProject {
  project: string
  folder: string
  rows: PsRow[]
}

function jsonArray(line: string): unknown[] | null {
  try {
    const v: unknown = JSON.parse(line)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

/** One line of `docker ps -a --format PS_FORMAT`; null when it is not one. */
export function parsePsLine(line: string): PsRow | null {
  const a = jsonArray(line.trim())
  if (!a || a.length < 6 || !a.every((x) => typeof x === 'string')) return null
  const [id, image, state, project, service, folder] = a as string[]
  if (!CONTAINER_ID_RE.test(id)) return null
  return { id, image, state, project, service, folder }
}

/** Every container line of `docker ps -a`. */
export function parsePs(out: string): PsRow[] {
  return out.split('\n').flatMap((l) => {
    const r = parsePsLine(l)
    return r ? [r] : []
  })
}

/**
 * The compose project that runs the Evolution: the project of the first container whose image
 * is evolution-api, with every container of that project (its Postgres too). Null when none.
 */
export function findEvolution(rows: readonly PsRow[]): EvolutionProject | null {
  const api = rows.find((r) => EVOLUTION_IMAGE_RE.test(r.image) && PROJECT_RE.test(r.project))
  if (!api) return null
  return { project: api.project, folder: api.folder, rows: rows.filter((r) => r.project === api.project) }
}

/** "136MiB", "1.2GiB", "512kB", "0B" → bytes; NaN-free (0 when it does not parse). */
export function parseSize(text: string): number {
  const m = /^\s*([\d.]+)\s*([kKMGT]?i?B)\s*$/.exec(text)
  if (!m) return 0
  const n = Number(m[1])
  if (!Number.isFinite(n)) return 0
  const unit = m[2]
  const pow = { B: 0, k: 1, K: 1, M: 2, G: 3, T: 4 }[unit[0] as 'B' | 'k' | 'K' | 'M' | 'G' | 'T'] ?? 0
  const base = unit.includes('i') ? 1024 : 1000
  return Math.round(n * base ** pow)
}

/** One line of `docker stats --no-stream --format STATS_FORMAT`; null when it is not one. */
export function parseStatsLine(line: string): StatsRow | null {
  const a = jsonArray(line.trim())
  if (!a || a.length < 3 || !a.every((x) => typeof x === 'string')) return null
  const [id, cpuText, memText] = a as string[]
  if (!CONTAINER_ID_RE.test(id)) return null
  const cpu = Number(cpuText.replace('%', ''))
  return { id, cpu: Number.isFinite(cpu) ? cpu : 0, mem: parseSize(memText.split('/')[0] ?? '') }
}

export function parseStats(out: string): StatsRow[] {
  return out.split('\n').flatMap((l) => {
    const r = parseStatsLine(l)
    return r ? [r] : []
  })
}

/** Docker's state in the box's words. */
export function containerState(state: string): CrmServerContainer['state'] {
  if (state === 'running') return 'running'
  if (state === 'restarting') return 'starting'
  if (state === 'exited' || state === 'created' || state === 'dead') return 'stopped'
  return 'other'
}

/** The containers as the box lists them, with what `docker stats` measured. */
export function toContainers(rows: readonly PsRow[], stats: readonly StatsRow[] = []): CrmServerContainer[] {
  return rows.map((r) => {
    const s = stats.find((x) => x.id === r.id || x.id.startsWith(r.id) || r.id.startsWith(x.id))
    const state = containerState(r.state)
    return {
      service: r.service || r.image,
      image: r.image,
      state,
      ...(state === 'running' && s ? { mem: s.mem, cpu: s.cpu } : {}),
    }
  })
}

/** All running, all stopped, some of each, or none at all. */
export function evolutionState(rows: readonly PsRow[]): CrmServerStatus['evolution'] {
  if (!rows.length) return 'missing'
  const running = rows.filter((r) => r.state === 'running').length
  if (running === rows.length) return 'running'
  return running === 0 ? 'stopped' : 'partial'
}

/** Which engine the docker command talks to, from `docker context show` and `docker info`'s name. */
export function engineKindOf(context: string, infoName = ''): CrmServerStatus['engineKind'] {
  const c = context.trim().toLowerCase()
  const n = infoName.trim().toLowerCase()
  if (c.startsWith('colima') || n.startsWith('colima')) return 'colima'
  if (c === 'desktop-linux' || c === 'desktop-windows' || n === 'docker-desktop' || n === 'docker desktop') return 'docker-desktop'
  return 'other'
}

/** `colima list --json` (one object per line): the memory of the default profile, in bytes. */
export function colimaMemory(out: string, profile = 'default'): number | undefined {
  for (const line of out.split('\n')) {
    try {
      const v = JSON.parse(line) as { name?: unknown; memory?: unknown }
      if (v && v.name === profile && typeof v.memory === 'number' && v.memory > 0) return v.memory
    } catch {
      // not a line of JSON
    }
  }
  return undefined
}

/**
 * Colima may be stopped from the box only when stopping it costs nothing else: the engine is
 * Colima, it runs, the Evolution is already off and no other container is running.
 */
export function canStopEngine(s: Pick<CrmServerStatus, 'engine' | 'engineKind' | 'evolution' | 'others'>): boolean {
  return s.engine === 'running' && s.engineKind === 'colima' && s.evolution !== 'running' && s.evolution !== 'partial' && s.others === 0
}

/** The tag of the image, when it is a version ("v2.3.7" → "2.3.7"); latest and digests say nothing. */
export function imageVersion(image: string): string | undefined {
  const tag = /:([\w.-]+)$/.exec(image)?.[1]
  if (!tag || tag === 'latest') return undefined
  return /^v?\d+(\.\d+)*/.test(tag) ? tag.replace(/^v/, '') : undefined
}

/** 136 MB, 1,2 GB (pt-BR, decimal units: what Activity Monitor shows). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`
  return `${Math.max(1, Math.round(n / 1e6)).toLocaleString('pt-BR')} MB`
}

export type ServerTone = 'on' | 'off' | 'busy' | 'warn' | 'error'

/** What the box and the chip on the CRM screen show, and which buttons. */
export interface ServerView {
  tone: ServerTone
  /** One short line: "Ligado", "Desligado", "Ligando…". */
  label: string
  /** The line under it, with what to do when something is wrong. */
  detail: string
  /** The main button, when there is one. */
  primary?: 'start' | 'stop'
  /** "Desligar o Colima também". */
  engineStop: boolean
}

const BUSY_LABEL: Record<NonNullable<CrmServerStatus['busy']>, string> = {
  starting: 'Ligando a Evolution…',
  stopping: 'Desligando a Evolution…',
  'engine-starting': 'Ligando o Docker…',
  'engine-stopping': 'Desligando o Colima…',
}

const ENGINE_NAME: Record<NonNullable<CrmServerStatus['engineKind']>, string> = {
  colima: 'Colima',
  'docker-desktop': 'Docker Desktop',
  other: 'Docker',
}

/** The memory of the running containers, summed ("320 MB"), or ''. */
export function containersMemory(cs: readonly CrmServerContainer[]): string {
  const total = cs.reduce((sum, c) => sum + (c.mem ?? 0), 0)
  return total > 0 ? formatBytes(total) : ''
}

export function serverView(s: CrmServerStatus): ServerView {
  const engine = ENGINE_NAME[s.engineKind ?? 'other']
  if (s.busy) return { tone: 'busy', label: BUSY_LABEL[s.busy], detail: 'Isso leva de alguns segundos a um minuto.', engineStop: false }
  if (!s.docker) {
    return {
      tone: 'off',
      label: 'Docker não encontrado',
      detail:
        'Para rodar a Evolution neste computador, instale o Colima (brew install colima docker) ou o Docker Desktop. Veja o COMO-RODAR.md.',
      engineStop: false,
    }
  }
  if (s.engine !== 'running') {
    const canStart = s.engineKind === 'colima' || s.engineKind === 'docker-desktop'
    return {
      tone: 'off',
      label: `${engine} desligado`,
      detail: canStart
        ? `A Evolution está parada junto. "Ligar" liga o ${engine} e depois a Evolution.`
        : 'A Evolution está parada junto. Ligue o Docker e toque em Atualizar.',
      primary: canStart ? 'start' : undefined,
      engineStop: false,
    }
  }
  const version = s.containers.find((c) => EVOLUTION_IMAGE_RE.test(c.image))
  const ver = version ? imageVersion(version.image) : undefined
  const others = s.others ? ` ${s.others === 1 ? '1 outro contêiner usa' : `${s.others} outros contêineres usam`} o ${engine}.` : ''
  switch (s.evolution) {
    case 'missing':
      return {
        tone: 'warn',
        label: 'Evolution não encontrada',
        detail: s.folder
          ? `Os contêineres sumiram (docker compose down). "Ligar" sobe de novo o compose de ${s.folder}.`
          : 'Nenhum contêiner da Evolution neste Docker. Na pasta do docker-compose.yml da Evolution, rode "docker compose up -d" (veja o COMO-RODAR.md) e toque em Atualizar.',
        primary: s.folder ? 'start' : undefined,
        engineStop: false,
      }
    case 'running': {
      const mem = containersMemory(s.containers)
      return {
        tone: 'on',
        label: 'Ligado',
        detail:
          [ver ? `Evolution ${ver}` : 'Evolution', mem ? `${mem} de memória` : '', `no ${engine}.`].filter(Boolean).join(' · ') + others,
        primary: 'stop',
        engineStop: false,
      }
    }
    case 'partial':
      return {
        tone: 'warn',
        label: 'Ligado pela metade',
        detail: `Algum contêiner da Evolution parou. "Ligar" sobe o que falta; "Desligar" para tudo.`,
        primary: 'start',
        engineStop: false,
      }
    default: {
      const engineStop = canStopEngine(s)
      const vm = s.engineMem ? ` (reserva ${formatBytes(s.engineMem)})` : ''
      return {
        tone: 'off',
        label: 'Desligado',
        detail: engineStop
          ? `A Evolution está parada. O ${engine} continua ligado${vm} e nada mais usa ele: dá para desligá-lo também.`
          : `A Evolution está parada; a sessão do WhatsApp fica guardada e volta sem QR code ao ligar.${others}`,
        primary: 'start',
        engineStop,
      }
    }
  }
}
