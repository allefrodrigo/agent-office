import { execFile } from 'node:child_process'
import { closeSync, fstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import type { AgentSummary, BgOwner, BgProcess } from '@shared/types'
import type { BgTask } from '../agents'
import { log } from '../log'
import {
  childrenOf,
  commandLabel,
  type Found,
  isClaude,
  kindOf,
  mainPorts,
  OrphanBook,
  parseListen,
  parsePs,
  type PsRow,
  sessionOf,
  shellsUnder,
  taskOutputCandidates,
} from './procs'

const EVERY_MS = 5000
/** A terminal session's shell younger than this is a command in progress, not something left running. */
const MIN_AGE_MS = 15_000
/** What a stopped process gets before SIGKILL. */
const GRACE_MS = 3000
const OUTPUT_BYTES = 8192

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: 4000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (_err, out) => resolve(String(out ?? ''))),
  )

export interface BackstageDeps {
  /** Office agents with a running CLI and their background tasks. */
  live(): { summary: AgentSummary; tasks: BgTask[] }[]
  /** Terminal sessions and the PID of their claude, when the bridge found it. */
  terminals(): { summary: AgentSummary; pid?: number }[]
  stopTask(agentId: string, taskId: string): Promise<void>
  broadcast(list: BgProcess[]): void
}

/**
 * Bastidores: what the agents left running. Office agents' background tasks come from their
 * CLI (background_tasks_changed); the process table adds ports and memory, the terminal
 * sessions' long commands, and the processes nobody holds anymore (orphans). macOS and
 * Linux read the process table; Windows shows the office agents' tasks only.
 */
export class Backstage {
  private timer?: NodeJS.Timeout
  private soon?: NodeJS.Timeout
  private list: BgProcess[] = []
  private sent = ''
  private book = new OrphanBook()
  /** What a stop may kill, as last scanned: pid -> it and the processes below it, each with its start. */
  private killable = new Map<number, Map<number, number>>()
  private scanning: Promise<void> | null = null
  private readonly table = process.platform !== 'win32'

  constructor(private deps: BackstageDeps) {}

  start(): void {
    void this.scan()
    this.timer = setInterval(() => void this.scan(), EVERY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    clearInterval(this.timer)
    clearTimeout(this.soon)
  }

  current(): BgProcess[] {
    return this.list
  }

  /** A task started or ended: scan again in a moment instead of waiting for the next round. */
  poke(): void {
    clearTimeout(this.soon)
    this.soon = setTimeout(() => void this.scan(), 300)
    this.soon.unref?.()
  }

  scan(): Promise<void> {
    this.scanning ??= this.read()
      .catch((err) => log.warn('Bastidores: não consegui ler os processos:', err instanceof Error ? err.message : String(err)))
      .finally(() => (this.scanning = null))
    return this.scanning
  }

  private async read(): Promise<void> {
    const now = Date.now()
    const live = this.deps.live()
    const terms = this.deps.terminals()
    const rows = this.table ? parsePs(await run('ps', ['-axo', 'pid=,ppid=,etime=,%cpu=,rss=,args=']), now) : []
    const byPid = new Map(rows.map((r) => [r.pid, r]))
    const kids = childrenOf(rows)
    const claudes = rows.filter((r) => isClaude(r.args))
    const held = new Set<number>()
    const shellsOf = (pid: number | undefined, owner: BgOwner): Found[] => {
      if (!pid || !byPid.has(pid)) return []
      const found = shellsUnder(pid, kids)
      for (const f of found) {
        this.book.note(f, owner, byPid)
        for (const p of f.pids) held.add(p)
      }
      return found
    }

    const office = live.map((a) => {
      const owner: BgOwner = { kind: 'office', name: a.summary.name, agentId: a.summary.id, accountId: a.summary.account }
      const pid = claudes.find((c) => sessionOf(c.args) === a.summary.sessionId)?.pid
      return { a, owner, shells: shellsOf(pid, owner) }
    })
    const terminal = terms.map((t) => {
      const owner: BgOwner = { kind: 'terminal', name: t.summary.name, agentId: t.summary.id }
      const pid = t.pid && isClaude(byPid.get(t.pid)?.args ?? '') ? t.pid : undefined
      return { owner, shells: shellsOf(pid, owner).filter((f) => now - f.root.startedAt >= MIN_AGE_MS) }
    })
    const orphans = this.table ? this.book.orphans(rows, held, kids) : []

    const candidates = [...office.flatMap((o) => o.shells), ...terminal.flatMap((t) => t.shells), ...orphans].flatMap((f) => f.pids)
    const ports = candidates.length ? parseListen(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'])) : new Map<number, number[]>()
    const portsOf = (pids: number[]) => mainPorts(pids.flatMap((p) => ports.get(p) ?? []))
    const cores = cpus().length || 1
    const load = (f: { cpu: number; rss: number }) => ({
      cpu: Math.round(f.cpu / cores),
      mem: Math.round((f.rss * 1024) / 1048576) * 1048576,
    })

    const list: BgProcess[] = []
    const killable = new Map<number, Map<number, number>>()
    for (const { a, owner, shells } of office) {
      for (const t of a.tasks) {
        const cmd = t.command?.trim()
        // The shell running the task carries the same command line.
        const f = cmd ? shells.find((s) => s.command === cmd || s.command.startsWith(cmd.slice(0, 120))) : undefined
        const label = cmd ? commandLabel(cmd) : t.description
        const p = f ? portsOf(f.pids) : []
        const kind = kindOf(label, p, t.type)
        list.push({
          id: `task:${a.summary.id}:${t.id}`,
          owner,
          kind,
          label,
          startedAt: f?.root.startedAt ?? t.startedAt,
          ports: p,
          ...(f ? load(f) : {}),
          output: kind !== 'helper',
        })
      }
    }
    const fromTable = (f: { root: PsRow; command: string; pids: number[]; cpu: number; rss: number }, owner: BgOwner) => {
      const p = portsOf(f.pids)
      const label = commandLabel(f.command)
      killable.set(f.root.pid, new Map(f.pids.flatMap((p) => (byPid.has(p) ? [[p, byPid.get(p)!.startedAt] as const] : []))))
      list.push({
        id: `pid:${f.root.pid}`,
        owner,
        kind: kindOf(label, p),
        label,
        startedAt: f.root.startedAt,
        ports: p,
        ...load(f),
        output: false,
      })
    }
    for (const { owner, shells } of terminal) for (const f of shells) fromTable(f, owner)
    for (const o of orphans) fromTable(o, o.owner)

    const rank = (p: BgProcess) => (p.owner.kind === 'gone' ? 0 : 1)
    list.sort((x, y) => rank(x) - rank(y) || x.owner.name.localeCompare(y.owner.name) || x.startedAt - y.startedAt)
    this.list = list
    this.killable = killable
    const json = JSON.stringify(list)
    if (json !== this.sent) {
      this.sent = json
      this.deps.broadcast(list)
    }
  }

  async stopProcess(id: string): Promise<void> {
    const task = /^task:([\w-]+):([\w-]{1,64})$/.exec(id)
    if (task) {
      await this.deps.stopTask(task[1], task[2])
      this.poke()
      return
    }
    const pid = Number(/^pid:(\d+)$/.exec(id)?.[1])
    const entry = this.killable.get(pid)
    // Only what the last scan found under a claude (or left by one): never a pid from elsewhere.
    if (!entry) throw new Error('Esse processo já terminou.')
    // Each pid must still be the process that was scanned: a reused pid never gets a signal.
    const alive = async () => {
      const rows = parsePs(await run('ps', ['-o', 'pid=,ppid=,etime=,%cpu=,rss=,args=', '-p', [...entry.keys()].join(',')]), Date.now())
      return rows.filter((r) => Math.abs(r.startedAt - (entry.get(r.pid) ?? -1e15)) <= 2000).map((r) => r.pid)
    }
    const first = await alive()
    if (!first.includes(pid)) throw new Error('Esse processo já terminou.')
    const signal = (pids: number[], sig: NodeJS.Signals) => {
      for (const p of pids) {
        try {
          process.kill(p, sig)
        } catch {
          // already gone
        }
      }
    }
    signal(first, 'SIGTERM')
    await new Promise((r) => setTimeout(r, GRACE_MS))
    signal(await alive(), 'SIGKILL')
    log.info(`Bastidores: parei o processo ${pid} e ${first.length - 1} filho(s)`)
    this.book.forget([...entry.keys()])
    this.killable.delete(pid)
    this.poke()
  }

  /** The end of what an office agent's background task printed, from the file Claude Code writes. */
  output(id: string): string {
    const m = /^task:([\w-]+):([\w-]{1,64})$/.exec(id)
    const agent = m ? this.deps.live().find((a) => a.summary.id === m[1]) : undefined
    if (!m || !agent?.summary.sessionId) throw new Error('Só dá para ver a saída dos processos dos agentes do escritório.')
    const roots = [...new Set([process.env.CLAUDE_CODE_TMPDIR, '/tmp', tmpdir()].filter((r): r is string => !!r).map(real))]
    const list = (dir: string) => {
      try {
        return readdirSync(dir)
      } catch {
        return []
      }
    }
    const uid = process.getuid?.()
    for (const file of taskOutputCandidates(roots, uid, list, agent.summary.sessionId, m[2])) {
      const text = tail(file)
      if (text !== null) return text
    }
    return ''
  }
}

function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** The last 8 KB of a file, without terminal colors; null when it cannot be read. */
function tail(file: string): string | null {
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    const len = Math.min(size, OUTPUT_BYTES)
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len)
    // eslint-disable-next-line no-control-regex
    return buf.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
