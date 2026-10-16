import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { macJobFromPlist, parseLaunchctlList } from '@shared/mac-jobs'
import type { MacJob } from '@shared/types'
import { log } from './log'

const run = promisify(execFile)
const EVERY_MS = 60_000
/** The log tail the window shows: the end of the file, at most this many lines. */
const TAIL_BYTES = 16_384
const TAIL_LINES = 80

/**
 * The Mac's own scheduled jobs (launchd user agents in ~/Library/LaunchAgents), read
 * every minute for the Rotinas window and the routines boards. Never writes a plist or loads,
 * unloads or edits a job: launchd keeps running them with the app closed.
 */
export class MacJobs extends EventEmitter {
  private jobs: MacJob[] = []
  private timer: NodeJS.Timeout | null = null
  private seen = '[]'
  private readonly dir = join(homedir(), 'Library', 'LaunchAgents')

  start(): void {
    if (process.platform !== 'darwin' || this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  list(): MacJob[] {
    return this.jobs
  }

  async refresh(): Promise<MacJob[]> {
    if (process.platform !== 'darwin') return this.jobs
    try {
      const [files, statuses] = await Promise.all([readdir(this.dir).catch(() => [] as string[]), this.statuses()])
      const now = Date.now()
      const jobs: MacJob[] = []
      for (const file of files.filter((f) => f.endsWith('.plist')).sort()) {
        const plist = await this.readPlist(join(this.dir, file))
        if (!plist) continue
        const logPath = typeof plist.StandardOutPath === 'string' ? plist.StandardOutPath : typeof plist.StandardErrorPath === 'string' ? plist.StandardErrorPath : undefined
        const lastLogAt = logPath ? await stat(logPath).then((s) => s.mtimeMs, () => undefined) : undefined
        const job = macJobFromPlist(plist, typeof plist.Label === 'string' ? statuses.get(plist.Label) : undefined, lastLogAt, now)
        if (job) jobs.push(job)
      }
      jobs.sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.name.localeCompare(b.name))
      this.jobs = jobs
      const json = JSON.stringify(jobs)
      if (json !== this.seen) {
        this.seen = json
        this.emit('jobs', jobs)
      }
    } catch (err) {
      log.warn('Agendamentos do Mac: falha ao ler', err)
    }
    return this.jobs
  }

  /** Starts the job now, as launchd would at its time (`launchctl kickstart`). Leaves one already running alone. */
  async runNow(label: string): Promise<MacJob[]> {
    const job = this.find(label)
    if (!job.loaded) throw new Error(`${job.name} não está carregado no launchd. Carregue com launchctl bootstrap antes.`)
    if (job.running) throw new Error(`${job.name} já está rodando.`)
    await run('launchctl', ['kickstart', `gui/${userInfo().uid}/${job.label}`], { timeout: 10_000 })
    // launchctl returns at once; the status shows the run a moment later
    setTimeout(() => void this.refresh(), 1500)
    return this.refresh()
  }

  /** The last lines of the job's log, or why there is none. */
  async logTail(label: string): Promise<string> {
    const job = this.find(label)
    if (!job.log) return 'Este agendamento não grava log (sem StandardOutPath no plist).'
    let fh
    try {
      fh = await open(job.log, 'r')
      const { size } = await fh.stat()
      const start = Math.max(0, size - TAIL_BYTES)
      const buf = Buffer.alloc(size - start)
      await fh.read(buf, 0, buf.length, start)
      const lines = buf.toString('utf8').split('\n')
      if (start > 0) lines.shift() // the first line was cut in half
      return lines.slice(-TAIL_LINES).join('\n').trimEnd() || '(log vazio)'
    } catch {
      return `O log ainda não existe: ${job.log}`
    } finally {
      await fh?.close()
    }
  }

  /** Opens the log in the Mac's default app for it (Console or a text editor). */
  async openLog(label: string): Promise<void> {
    const job = this.find(label)
    if (!job.log) throw new Error('Este agendamento não grava log.')
    const err = await shell.openPath(job.log)
    if (err) throw new Error(`Não abri o log: ${err}`)
  }

  /** Only labels read from the plists reach launchctl. */
  private find(label: string): MacJob {
    const job = this.jobs.find((j) => j.label === label)
    if (!job) throw new Error('Esse agendamento não existe mais no Mac.')
    return job
  }

  private async statuses() {
    try {
      const { stdout } = await run('launchctl', ['list'], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
      return parseLaunchctlList(stdout)
    } catch {
      return parseLaunchctlList('')
    }
  }

  /** plutil reads XML and binary plists; ones with dates or data do not convert to JSON and are skipped. */
  private async readPlist(file: string): Promise<Record<string, unknown> | null> {
    try {
      const { stdout } = await run('plutil', ['-convert', 'json', '-o', '-', file], { timeout: 5000, maxBuffer: 1024 * 1024 })
      const v = JSON.parse(stdout)
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null
    } catch {
      return null
    }
  }
}
