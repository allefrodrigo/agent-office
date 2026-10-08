import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { cpus, freemem, totalmem } from 'node:os'
import { app } from 'electron'
import type { SystemStats } from '@shared/types'
import { cpuPercent, isClaudeImage, isDesktopPath, parseTasklistCsv, queryClaudeProcesses, sampleEveryMs } from './win-processes'

const EVERY_MS = 3000

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 2500, windowsHide: true }, (_err, out) => resolve(String(out ?? ''))))

/**
 * CPU and memory of the machine, of this app, and of every Claude Code process
 * (office agents and terminal sessions), every 3 seconds. Emits 'system'.
 */
export class SystemMonitor extends EventEmitter {
  private timer?: NodeJS.Timeout
  private prev = cpuTimes()
  private last: SystemStats | null = null

  start(): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), EVERY_MS)
  }

  stop(): void {
    clearInterval(this.timer)
  }

  current(): SystemStats | null {
    return this.last
  }

  private async tick(): Promise<void> {
    const now = cpuTimes()
    const busy = now.busy - this.prev.busy
    const total = now.total - this.prev.total
    this.prev = now
    const cores = cpus().length

    // Electron reports each of its processes as a share of one core.
    const metrics = app.getAppMetrics()
    const appCpu = metrics.reduce((s, m) => s + m.cpu.percentCPUUsage, 0) / cores
    const appMem = metrics.reduce((s, m) => s + m.memory.workingSetSize, 0) * 1024

    const [memUsed, claude] = await Promise.all([usedMemory(), claudeProcesses(cores)])
    this.last = {
      cpu: total > 0 ? Math.round((busy / total) * 100) : 0,
      memUsed,
      memTotal: totalmem(),
      app: { cpu: Math.round(appCpu), mem: appMem },
      claude,
    }
    this.emit('system', this.last)
  }
}

function cpuTimes(): { busy: number; total: number } {
  let busy = 0
  let total = 0
  for (const c of cpus()) {
    const t = c.times
    busy += t.user + t.nice + t.sys + t.irq
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }
  return { busy, total }
}

/**
 * "Memory used" the way Activity Monitor counts it on macOS: app memory, wired
 * and compressed. os.freemem() alone would show the Mac as almost full, because
 * macOS keeps file cache in RAM until it needs the space.
 */
async function usedMemory(): Promise<number> {
  if (process.platform !== 'darwin') return totalmem() - freemem()
  const out = await run('vm_stat', [])
  const page = Number(out.match(/page size of (\d+)/)?.[1] ?? 16384)
  const n = (label: string) => Number(out.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0)
  const used = (n('Anonymous pages') - n('Pages purgeable') + n('Pages wired down') + n('Pages occupied by compressor')) * page
  return used > 0 ? used : totalmem() - freemem()
}

/** Every Claude Code process on the machine, summed (on Windows, without the Claude Desktop app). */
async function claudeProcesses(cores: number): Promise<SystemStats['claude']> {
  if (process.platform === 'win32') return windowsClaude.read(cores)
  const out = await run('ps', ['-axo', '%cpu=,rss=,comm='])
  let count = 0
  let cpu = 0
  let mem = 0
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^([\d.]+)\s+(\d+)\s+(.+)$/)
    if (!m || !/(^|\/)claude$/.test(m[3])) continue
    count++
    cpu += Number(m[1])
    mem += Number(m[2]) * 1024
  }
  return { count, cpu: Math.round(cpu / cores), mem }
}

/**
 * Windows (ADR-run-4): `tasklist` every 3 s for count and memory, as before, now by
 * exact image name. A CIM query via PowerShell (~0.5 s of CPU each) runs in the
 * background every sampleEveryMs(cores), or after 5 s when an unknown PID shows up,
 * one at a time: it tells Claude Code from the Claude Desktop app (both claude.exe)
 * by executable path and gives CPU from the change in CPU time between samples.
 * If PowerShell fails, CPU stays null and every claude.exe counts (v0.2.0 behaviour),
 * with a single warning; it tries again after RETRY_MS.
 */
class WindowsClaude {
  private static readonly SOON_MS = 5000
  private static readonly RETRY_MS = 5 * 60_000
  private kind = new Map<number, 'code' | 'desktop'>()
  private ticks = new Map<number, number>()
  private sampledAt = 0
  private cpu: number | null = null
  private busy = false
  private retryAt = 0
  private warned = false

  async read(cores: number): Promise<SystemStats['claude']> {
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH'])
    const rows = parseTasklistCsv(out).filter((r) => isClaudeImage(r.name))
    // A PID not classified yet counts as Claude Code until the next sample.
    const code = rows.filter((r) => this.kind.get(r.pid) !== 'desktop')
    this.maybeSample(cores, rows.some((r) => !this.kind.has(r.pid)))
    return {
      count: code.length,
      cpu: this.cpu === null ? null : Math.round(this.cpu),
      mem: code.reduce((s, r) => s + r.mem, 0),
    }
  }

  private maybeSample(cores: number, unknown: boolean): void {
    const now = Date.now()
    if (this.busy || now < this.retryAt) return
    const since = now - this.sampledAt
    if (since < sampleEveryMs(cores) && !(unknown && since >= WindowsClaude.SOON_MS)) return
    this.busy = true
    void queryClaudeProcesses()
      .then((rows) => {
        if (!rows) return this.fail(now)
        const code = rows.filter((r) => !isDesktopPath(r.path))
        this.cpu = cpuPercent(this.ticks, code, now - this.sampledAt, cores)
        this.kind = new Map(rows.map((r) => [r.pid, isDesktopPath(r.path) ? 'desktop' : 'code']))
        this.ticks = new Map(code.map((r) => [r.pid, r.ticks]))
        this.sampledAt = now
      })
      .finally(() => {
        this.busy = false
      })
  }

  private fail(now: number): void {
    this.kind.clear()
    this.ticks.clear()
    this.cpu = null
    this.sampledAt = now
    this.retryAt = now + WindowsClaude.RETRY_MS
    if (!this.warned) console.warn('PowerShell/CIM indisponível: CPU do Claude Code fica vazia e o Claude Desktop entra na contagem.')
    this.warned = true
  }
}

const windowsClaude = new WindowsClaude()
