// Modo mini: the agents live on the bottom of the screen, desktop-pet style, in a transparent
// window that lets the mouse through everywhere except on them and their cards. The office window
// hides meanwhile; the agents keep running in this process either way.
import { app, BrowserWindow, screen } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PetGeometry } from '@shared/types'
import { log } from './log'

/** How often the Dock is measured again: it grows and shrinks as apps open and quit. */
const DOCK_EVERY_MS = 8000

interface PetDeps {
  dataDir: string
  preload: string
  /** Loads the page of the pet window (dev server or the built pet.html). */
  load(w: BrowserWindow): void
  /** The office window, hidden while the pet mode is on. */
  office(): BrowserWindow | null
  /** Opens the office window again when it was closed (macOS). */
  reopenOffice(): BrowserWindow
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((done) => execFile(cmd, args, { timeout: 4000 }, (err, out) => done(err ? '' : String(out))))
}

/**
 * Where the Dock sits, in screen points. The Accessibility API gives the exact box when the app
 * may use it; otherwise an estimate from the Dock's own settings and the apps running.
 */
async function dockSpan(screenWidth: number): Promise<{ left: number; right: number; exact: boolean } | null> {
  const ax = await run('osascript', ['-e', 'tell application "System Events" to tell process "Dock" to get {position, size} of list 1'])
  const n = ax.split(',').map((s) => Number(s.trim()))
  if (n.length === 4 && n.every(Number.isFinite) && n[2] > 0) return { left: n[0], right: n[0] + n[2], exact: true }
  const dock = await run('defaults', ['read', 'com.apple.dock'])
  if (!dock) return null
  const num = (key: string, fallback: number) => Number(dock.match(new RegExp(`\\b${key} = (\\d+(?:\\.\\d+)?)`))?.[1] ?? fallback)
  const tile = num('tilesize', 48)
  const section = (name: string) => {
    const i = dock.indexOf(`"${name}" =`)
    if (i < 0) return ''
    const j = dock.indexOf('\n    );', i)
    return dock.slice(i, j < 0 ? undefined : j)
  }
  const pinned = [...section('persistent-apps').matchAll(/"bundle-identifier" = "?([^";]+)"?;/g)].map((m) => m[1])
  const others = (section('persistent-others').match(/"tile-type" =/g) ?? []).length
  const apps = await run('lsappinfo', ['list'])
  const running = new Set(
    apps
      .split(/\n(?=\s*\d+\) )/)
      .filter((b) => /type="Foreground"/.test(b))
      .map((b) => b.match(/bundleID="([^"]+)"/)?.[1])
      .filter((id): id is string => !!id),
  )
  const extra = [...running].filter((id) => !pinned.includes(id)).length
  const recents = num('show-recents', 1) ? Math.min(extra, 3) : 0
  const items = pinned.length + recents + others + 1 // + trash
  const separators = 1 + (recents ? 1 : 0)
  const width = Math.min(screenWidth, items * tile * 1.1 + separators * 14 + 24)
  return { left: (screenWidth - width) / 2, right: (screenWidth + width) / 2, exact: false }
}

export class PetMode {
  private win: BrowserWindow | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private geometry: PetGeometry | null = null
  private file: string

  constructor(private deps: PetDeps) {
    this.file = join(deps.dataDir, 'modo-mini.json')
  }

  /** The player left the app in the pet mode last time. */
  get remembered(): boolean {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')).on === true
    } catch {
      return false
    }
  }

  private remember(on: boolean): void {
    try {
      writeFileSync(this.file, JSON.stringify({ on }))
    } catch (err) {
      log.warn('Não consegui salvar o modo mini:', err)
    }
  }

  get on(): boolean {
    return !!this.win && !this.win.isDestroyed()
  }

  get window(): BrowserWindow | null {
    return this.on ? this.win : null
  }

  enter(): void {
    this.remember(true)
    this.deps.office()?.hide()
    if (this.on) return void this.win!.showInactive()
    const display = screen.getPrimaryDisplay()
    const { bounds, workArea } = display
    // From under the menu bar down to the bottom edge: the Dock's strip included, so they can stand on it.
    const top = workArea.y
    const w = new BrowserWindow({
      x: bounds.x,
      y: top,
      width: bounds.width,
      height: bounds.y + bounds.height - top,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      title: 'Agent Office (modo mini)',
      acceptFirstMouse: true,
      webPreferences: { preload: this.deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    })
    w.setAlwaysOnTop(true, 'floating')
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Clicks go to whatever is behind, until the page says the pointer is over an agent or a card.
    w.setIgnoreMouseEvents(true, { forward: true })
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    w.once('ready-to-show', () => w.showInactive())
    w.on('closed', () => {
      if (this.win === w) this.win = null
      this.stopTimer()
    })
    // Bounds can come back constrained by the system: lay them out again once shown.
    w.once('show', () => w.setBounds({ x: bounds.x, y: top, width: bounds.width, height: bounds.y + bounds.height - top }))
    this.win = w
    this.deps.load(w)
    void this.measure()
    this.timer = setInterval(() => void this.measure(), DOCK_EVERY_MS)
    // Dev only: AGENT_OFFICE_PET_SHOT=<file.png> saves the strip every 3 s, to check the art without screen recording.
    const shot = !app.isPackaged ? process.env.AGENT_OFFICE_PET_SHOT : undefined
    if (shot) {
      const t = setInterval(() => {
        if (w.isDestroyed()) return clearInterval(t)
        void w.webContents.capturePage().then((img) => writeFileSync(shot, img.toPNG()))
      }, 3000)
    }
    screen.on('display-metrics-changed', this.relayout)
    log.info('Modo mini ligado')
  }

  /** Back to the office window, which shows (and opens again if it was closed). */
  leave(): BrowserWindow {
    this.remember(false)
    const w = this.win
    this.win = null
    this.stopTimer()
    if (w && !w.isDestroyed()) w.destroy()
    let office = this.deps.office()
    if (!office || office.isDestroyed()) office = this.deps.reopenOffice()
    office.show()
    office.focus()
    log.info('Modo mini desligado')
    return office
  }

  /** The page asks: let the mouse through (false) or catch it (true, over an agent or a card). */
  setInteractive(on: boolean): void {
    const w = this.window
    if (!w) return
    w.setIgnoreMouseEvents(!on, { forward: true })
    if (on) w.setFocusable(true)
  }

  /** The panel or a card wants the keyboard: the window takes the focus. */
  focus(): void {
    const w = this.window
    if (!w) return
    w.setIgnoreMouseEvents(false)
    w.focus()
  }

  current(): PetGeometry | null {
    return this.geometry
  }

  private relayout = () => {
    const w = this.window
    if (!w) return
    const { bounds, workArea } = screen.getPrimaryDisplay()
    w.setBounds({ x: bounds.x, y: workArea.y, width: bounds.width, height: bounds.y + bounds.height - workArea.y })
    void this.measure()
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    screen.off('display-metrics-changed', this.relayout)
  }

  /** Floor and Dock in the window's own coordinates; sent to the page when they change. */
  private async measure(): Promise<void> {
    const w = this.window
    if (!w) return
    const { bounds, workArea } = screen.getPrimaryDisplay()
    const height = bounds.y + bounds.height - workArea.y
    const below = bounds.y + bounds.height - (workArea.y + workArea.height)
    let g: PetGeometry
    if (process.platform === 'darwin' && below > 8) {
      // Dock at the bottom: the floor is the screen's edge, the Dock a platform in the middle.
      const span = await dockSpan(bounds.width)
      g = span
        ? { width: bounds.width, height, floor: height, dock: { left: span.left, right: span.right, top: height - below + 4 }, exact: span.exact }
        : { width: bounds.width, height, floor: height - below, dock: null, exact: false }
    } else {
      // Windows taskbar, Linux panel, a hidden Dock or one on the side: they stand right above it.
      g = { width: bounds.width, height, floor: height - below, dock: null, exact: true }
    }
    if (!this.on) return
    if (JSON.stringify(g) === JSON.stringify(this.geometry)) return
    this.geometry = g
    w.webContents.send('office:event', { type: 'pet:geometry', geometry: g })
  }
}
