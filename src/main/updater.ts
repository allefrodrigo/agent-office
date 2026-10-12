import { app, ipcMain } from 'electron'
import type { AppUpdater } from 'electron-updater'
import type { OfficeEvent, UpdateChannel, UpdateInstallResult, UpdateStatus } from '@shared/types'

/** First check a little after launch, so it does not compete with startup; then every 6 h. */
const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 3_600_000
/**
 * Dev helper: AGENT_OFFICE_FAKE_UPDATE=0.9.0 pretends that version is downloaded, to
 * try the notice and the restart confirmation. "Reiniciar" then flushes and quits.
 */
const FAKE = !app.isPackaged ? process.env.AGENT_OFFICE_FAKE_UPDATE : undefined

export interface UpdaterDeps {
  channel(): UpdateChannel
  /** Office agents working and permissions waiting: restarting would cut them off. */
  busy(): { working: number; pending: number }
  /** Writes the store and the ticket board to disk now. */
  flush(): void
  broadcast(e: OfficeEvent): void
}

/**
 * Auto-update from GitHub Releases (publish in electron-builder.yml), only in the
 * packaged app. Checks at launch and every 6 h, downloads in the background and
 * tells the renderer when the new version is ready; restarting is the player's call.
 * On the Mac, Squirrel only installs over an app signed with a Developer ID.
 */
export class Updater {
  private status: UpdateStatus = FAKE ? { state: 'ready', version: FAKE } : { state: app.isPackaged ? 'idle' : 'disabled' }
  private updater: AppUpdater | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private deps: UpdaterDeps) {}

  start(): void {
    ipcMain.handle('office:updateStatus', () => this.status)
    ipcMain.handle('office:checkForUpdates', () => this.check())
    ipcMain.handle('office:installUpdate', (_e, force: unknown) => this.install(force === true))
    if (!app.isPackaged) return
    setTimeout(() => void this.check(), FIRST_CHECK_MS).unref()
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<UpdateStatus> {
    if (this.status.state === 'disabled') return this.status
    // Already on its way (or waiting for a restart): nothing new to ask.
    if (this.status.state === 'checking' || this.status.state === 'downloading' || this.status.state === 'ready') return this.status
    try {
      const u = await this.load()
      this.applyChannel(u)
      this.set({ state: 'checking' })
      const r = await u.checkForUpdates()
      // No result = the updater is inactive (e.g. no app-update.yml in this build).
      if (!r) this.set({ state: 'latest', checkedAt: Date.now() })
    } catch (err) {
      this.fail(err)
    }
    return this.status
  }

  async install(force: boolean): Promise<UpdateInstallResult> {
    if (this.status.state !== 'ready' || (!this.updater && !FAKE)) return { ok: false }
    const { working, pending } = this.deps.busy()
    if (!force && (working || pending)) return { ok: false, working, pending }
    // before-quit flushes too; doing it here means nothing is lost if the installer takes over first.
    this.deps.flush()
    const u = this.updater
    setImmediate(() => (u ? u.quitAndInstall() : app.quit()))
    return { ok: true }
  }

  private async load(): Promise<AppUpdater> {
    if (this.updater) return this.updater
    // CommonJS package: the default import carries the named exports.
    const { autoUpdater: u } = (await import('electron-updater')).default
    u.autoDownload = true
    // "Depois" still installs it the next time the app quits.
    u.autoInstallOnAppQuit = true
    u.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }))
    u.on('download-progress', (p) => {
      const percent = Math.floor(p.percent)
      if (percent !== this.status.percent) this.set({ ...this.status, state: 'downloading', percent })
    })
    u.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version, checkedAt: Date.now() }))
    u.on('update-not-available', () => this.set({ state: 'latest', checkedAt: Date.now() }))
    u.on('error', (err) => this.fail(err))
    this.updater = u
    return u
  }

  /** Beta follows pre-releases too. Neither channel installs an older version. */
  private applyChannel(u: AppUpdater): void {
    const beta = this.deps.channel() === 'beta'
    if (beta || u.channel) u.channel = beta ? 'beta' : 'latest'
    u.allowPrerelease = beta
    // Setting the channel turns downgrades on; leaving beta must not go back a version.
    u.allowDowngrade = false
  }

  private fail(err: unknown): void {
    const text = err instanceof Error ? err.message : String(err)
    // Keep the first line: electron-updater appends whole HTTP bodies and stacks.
    const first = text.split('\n')[0].trim()
    // The releases feed answers 404 when the repo is private or has no release yet.
    const message = /^404\b/.test(first) || /No published versions/i.test(first) ? 'nenhuma versão publicada no GitHub.' : first.slice(0, 200)
    this.set({ state: 'error', message, checkedAt: Date.now() })
  }

  private set(s: UpdateStatus): void {
    this.status = s
    this.deps.broadcast({ type: 'update', update: s })
  }
}
