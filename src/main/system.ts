import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { cpus, freemem, totalmem } from 'node:os'
import { app } from 'electron'
import type { SystemStats } from '@shared/types'

const EVERY_MS = 3000

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 2500, windowsHide: true }, (_err, out) => resolve(String(out ?? ''))))

/**
 * CPU and memory of the Mac, of this app, and of every Claude Code process
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

/** Every `claude` process on the machine, summed. */
async function claudeProcesses(cores: number): Promise<SystemStats['claude']> {
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH'])
    const rows = out.split(/\r?\n/).filter((l) => /claude\.exe/i.test(l))
    const mem = rows.reduce((s, l) => s + Number((l.split('","')[4] ?? '').replace(/[^\d]/g, '')) * 1024, 0)
    return { count: rows.length, cpu: null, mem }
  }
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
