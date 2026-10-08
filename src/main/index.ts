import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, shell, type NativeImage } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Actor, DelegateTarget, HireRequest, OfficeEvent, OfficePermissionMode, OfficeState, PermissionDecision, Settings, TicketDraft, TicketPatch, TicketStatus } from '@shared/types'
import { AgentManager } from './agents'
import { badgeDescription, badgeLabel, badgePixels, encodePng } from './badge'
import { Bridge } from './bridge'
import { TicketDesk } from './delegate'
import { startDemo } from './demo'
import { loadShellPath } from './env'
import { isSessionId, openInTerminal, recentSessions, sessionEntry, transcript } from './sessions'
import { Store } from './store'
import { SystemMonitor } from './system'
import { UsageMonitor } from './usage'
import { windowFrame } from './window-frame'
import { TicketBoard } from './tickets'

const here = fileURLToPath(new URL('.', import.meta.url))
const DELEGATE_MODES: OfficePermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan']
let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  // Screenshot runs (dev only) render in a hidden window so they never steal focus.
  const headless = !!process.env.AGENT_OFFICE_SHOTS
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#1b1d2b',
    title: 'Agent Office',
    // macOS: inset traffic lights · Windows: title bar overlay in the office colours · Linux: default frame
    ...windowFrame(process.platform),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !headless,
    },
    paintWhenInitiallyHidden: true,
  })
  if (!headless) w.once('ready-to-show', () => w.show())
  // Windows: stop blinking the taskbar button once the user looks at the office.
  if (process.platform === 'win32') w.on('focus', () => w.flashFrame(false))
  // The window only ever shows our own bundle.
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else w.loadFile(join(here, '../renderer/index.html'))
  return w
}

function notify(store: Store, title: string, body: string): void {
  if (!store.settings.notifications || !Notification.isSupported()) return
  if (win?.isFocused()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => {
    win?.show()
    win?.focus()
  })
  n.show()
}

// Windows only shows notifications for apps with an AppUserModelID.
app.setAppUserModelId('dev.allef.agentoffice')
// Dev helper: run a second, isolated instance (own data, own bridge port in its office.json).
if (process.env.AGENT_OFFICE_DATA_DIR) app.setPath('userData', process.env.AGENT_OFFICE_DATA_DIR)

app.whenReady().then(async () => {
  await loadShellPath()
  const store = new Store()
  const manager = new AgentManager(store)
  const board = new TicketBoard(app.getPath('userData'))
  manager.officeTools = (agent) => board.toolsFor(agent)
  const desk = new TicketDesk(board, manager, () => store.settings)
  const player = (): Actor => ({ kind: 'player', name: store.settings.playerName })

  const broadcast = (e: OfficeEvent) => {
    if (win && !win.isDestroyed()) win.webContents.send('office:event', e)
  }

  // Windows has no app badge: the taskbar shows an overlay icon instead (ADR-run-2).
  // Images depend only on a count computed here, never on renderer data (I-05).
  const overlays = new Map<string, NativeImage>()
  const overlayFor = (label: string): NativeImage => {
    let img = overlays.get(label)
    if (!img) {
      img = nativeImage.createFromBuffer(encodePng(16, 16, badgePixels(label, 16)))
      img.addRepresentation({ scaleFactor: 2, buffer: encodePng(32, 32, badgePixels(label, 32)) })
      overlays.set(label, img) // at most 10 labels: 1…9 and 9+
    }
    return img
  }

  const updateBadge = () => {
    const count = manager.pendingRequests().length + manager.pendingResults().length
    if (process.platform === 'darwin') app.dock?.setBadge(count ? String(count) : '')
    else if (process.platform === 'win32') {
      if (win && !win.isDestroyed()) win.setOverlayIcon(count > 0 ? overlayFor(badgeLabel(count)) : null, badgeDescription(count))
    } else app.setBadgeCount(count)
  }

  // Windows: blink the taskbar button when something new waits for the user and the
  // window is not focused (macOS keeps its Dock bounce; Linux: nothing new).
  const flash = () => {
    if (process.platform === 'win32' && win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true)
  }

  const nameOf = (agentId: string) => manager.list().find((a) => a.id === agentId)?.name ?? 'Agente'

  manager.on('event', (e: OfficeEvent) => {
    broadcast(e)
    if (e.type === 'permission:new') {
      notify(store, `${nameOf(e.request.agentId)} está indo até você`, e.request.title)
      if (process.platform === 'darwin' && !win?.isFocused()) app.dock?.bounce('informational')
      flash()
    } else if (e.type === 'result:new') {
      notify(store, `${nameOf(e.result.agentId)} terminou`, e.result.text.slice(0, 140))
      flash()
    }
    if (e.type.startsWith('permission:') || e.type.startsWith('result:')) updateBadge()
  })

  board.on('event', broadcast)

  const system = new SystemMonitor()
  system.on('system', (s) => broadcast({ type: 'system', system: s }))

  const usage = new UsageMonitor()
  usage.on('usage', (u) => broadcast({ type: 'usage', usage: u }))
  manager.on('event', (e: OfficeEvent) => {
    if (e.type === 'result:new') usage.nudge()
  })

  const bridge = new Bridge(manager, store.settings.bridgePort, join(app.getPath('userData'), 'bridge-token'), (status) =>
    broadcast({ type: 'bridge:status', status }),
  )
  bridge.start()
  usage.start()
  system.start()

  // ---------- IPC ----------
  ipcMain.handle('office:getState', (): OfficeState => ({
    agents: manager.list(),
    permissions: manager.pendingRequests(),
    results: manager.pendingResults(),
    tickets: board.list(),
    bridge: bridge.status(),
    settings: store.settings,
    platform: process.platform,
    usage: usage.current(),
    system: system.current(),
  }))
  ipcMain.handle('office:refreshUsage', () => usage.refresh())
  ipcMain.handle('office:getLog', (_e, id: string) => manager.getLog(String(id)))
  ipcMain.handle('office:hire', (_e, req: HireRequest) => {
    if (!req || typeof req.cwd !== 'string' || !existsSync(req.cwd) || !statSync(req.cwd).isDirectory()) {
      throw new Error('Escolha uma pasta de projeto que exista.')
    }
    if (typeof req.task !== 'string' || !req.task.trim()) throw new Error('Descreva a tarefa do agente.')
    return manager.hire({
      name: String(req.name ?? '').slice(0, 40),
      cwd: req.cwd,
      task: req.task,
      model: req.model ? String(req.model) : undefined,
      permissionMode: req.permissionMode,
    })
  })
  ipcMain.handle('office:summon', (_e, cwd: unknown, mode: unknown) => {
    if (typeof cwd !== 'string' || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('Escolha uma pasta de projeto que exista.')
    const modes: OfficePermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions']
    const permissionMode = modes.includes(mode as OfficePermissionMode) ? (mode as OfficePermissionMode) : store.settings.defaultPermissionMode
    return manager.summon(cwd, { model: store.settings.defaultModel, permissionMode })
  })
  ipcMain.handle('office:send', (_e, id: string, text: string, attachments: unknown) =>
    manager.sendMessage(String(id), String(text), undefined, Array.isArray(attachments) ? attachments : []),
  )
  ipcMain.handle('office:interrupt', (_e, id: string) => manager.interrupt(String(id)))
  ipcMain.handle('office:compact', (_e, id: string) => manager.compact(String(id)))
  ipcMain.handle('office:clearContext', (_e, id: string) => manager.clearContext(String(id)))
  ipcMain.handle('office:fire', (_e, id: string) => manager.fire(String(id)))
  ipcMain.handle('office:closeTerminal', (_e, id: string) => bridge.closeSession(String(id)))
  ipcMain.handle('office:listSessions', () => recentSessions())
  ipcMain.handle('office:recall', async (_e, sessionId: unknown) => {
    if (!isSessionId(sessionId)) throw new Error('ID de sessão inválido.')
    const entry = await sessionEntry(sessionId)
    if (!entry) throw new Error('Não achei essa sessão no disco.')
    if (!entry.cwd || !existsSync(entry.cwd) || !statSync(entry.cwd).isDirectory()) {
      throw new Error(`A pasta dessa sessão não existe mais${entry.cwd ? `: ${entry.cwd}` : '.'}`)
    }
    const { log, model } = await transcript(sessionId).catch(() => ({ log: [], model: undefined }))
    return manager.recall(sessionId, entry.cwd, log, {
      // keep the model the conversation was using
      model: model ?? store.settings.defaultModel,
      permissionMode: store.settings.defaultPermissionMode,
    })
  })
  ipcMain.handle('office:openInTerminal', async (_e, sessionId: unknown) => {
    if (!isSessionId(sessionId)) return { ok: false, message: 'ID de sessão inválido.' }
    const entry = await sessionEntry(sessionId)
    if (!entry?.cwd) return { ok: false, message: 'Não sei em que pasta essa sessão rodava.' }
    return openInTerminal(sessionId, entry.cwd)
  })
  ipcMain.handle('office:respond', (_e, d: PermissionDecision) => manager.respond(d))
  ipcMain.handle('office:ackResult', (_e, id: string) => {
    manager.ackResult(String(id))
    updateBadge()
  })
  ipcMain.handle('office:pickFolder', async (_e, defaultPath?: unknown) => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Pasta do projeto',
      defaultPath: typeof defaultPath === 'string' && existsSync(defaultPath) ? defaultPath : undefined,
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('office:installBridge', async () => {
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Conectar', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: 'Conectar sessões do Claude Code no terminal?',
      detail:
        'Vamos adicionar hooks HTTP em ~/.claude/settings.json (com backup em settings.json.agent-office.bak). ' +
        'Cada sessão do terminal vira um agente no escritório, e pedidos de permissão chegam até você aqui. ' +
        'Se o app estiver fechado, o Claude Code segue normal no terminal.',
    })
    if (response !== 0) return bridge.status()
    try {
      return bridge.install()
    } catch (err) {
      dialog.showErrorBox('Não consegui editar ~/.claude/settings.json', err instanceof Error ? err.message : String(err))
      return bridge.status()
    }
  })
  ipcMain.handle('office:uninstallBridge', () => {
    try {
      return bridge.uninstall()
    } catch (err) {
      dialog.showErrorBox('Não consegui editar ~/.claude/settings.json', err instanceof Error ? err.message : String(err))
      return bridge.status()
    }
  })
  ipcMain.handle('office:saveSettings', (_e, patch: Partial<Settings>) => {
    store.settings = { ...store.settings, ...patch, bridgePort: store.settings.bridgePort }
    broadcast({ type: 'settings', settings: store.settings })
    return store.settings
  })
  ipcMain.handle('office:createTicket', (_e, draft: TicketDraft) => board.create(draft, player()))
  ipcMain.handle('office:updateTicket', (_e, id: string, patch: TicketPatch) => board.update(String(id), patch, player()))
  ipcMain.handle('office:moveTicket', (_e, id: string, status: TicketStatus, beforeId?: string) =>
    board.move(String(id), status, beforeId ? String(beforeId) : undefined, player()),
  )
  ipcMain.handle('office:commentTicket', (_e, id: string, text: string) => {
    board.comment(String(id), String(text), player())
  })
  ipcMain.handle('office:deleteTicket', (_e, id: string) => board.remove(String(id)))
  ipcMain.handle('office:assignTicket', (_e, id: string, who: unknown) => {
    const t = board.assign(String(id), who === 'me' ? player() : undefined, player())
    if (!t.assignee && t.status === 'doing') board.move(t.id, 'todo', undefined, player())
    else if (t.assignee && (t.status === 'backlog' || t.status === 'todo')) board.move(t.id, 'doing', undefined, player())
  })
  ipcMain.handle('office:delegateTicket', (_e, id: string, target: DelegateTarget) => {
    const t: DelegateTarget =
      target && typeof target === 'object' && 'agentId' in target
        ? { agentId: String(target.agentId) }
        : {
            hire: {
              model: typeof target?.hire?.model === 'string' ? target.hire.model : undefined,
              // A ticket may be written by someone else (or another agent): never run it with "bypass".
              permissionMode: DELEGATE_MODES.includes(target?.hire?.permissionMode as never) ? target.hire.permissionMode : undefined,
            },
          }
    return desk.delegate(String(id), t, player())
  })
  ipcMain.handle('office:openExternal', (_e, url: string) => {
    // Only web links leave the app; file:// or custom schemes could run things.
    if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url))
  })
  ipcMain.handle('office:revealPath', (_e, p: string) => {
    if (typeof p === 'string' && existsSync(p)) shell.showItemInFolder(p)
  })

  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(here, '../../resources/icon.png'))
  win = createWindow()
  // Results restored from office.json show in the taskbar overlay right away.
  if (process.platform === 'win32') win.once('ready-to-show', updateBadge)
  if (process.env.AGENT_OFFICE_DEMO === '1') startDemo(manager)
  if (process.env.AGENT_OFFICE_SEED) seedAgents(manager, process.env.AGENT_OFFICE_SEED)
  if (process.env.AGENT_OFFICE_SHOTS) captureShots(win, process.env.AGENT_OFFICE_SHOTS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
  app.on('before-quit', () => {
    bridge.stop()
    usage.stop()
    system.stop()
    manager.shutdown()
    store.flush()
    board.flush()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Dev helper: AGENT_OFFICE_SHOTS="out/shot:3000,8000" saves screenshots at those
 * times (ms after load) as out/shot-1.png, out/shot-2.png, then quits.
 * AGENT_OFFICE_EVAL runs a snippet in the page before each shot (e.g. to move the camera).
 */
function captureShots(w: BrowserWindow, spec: string): void {
  const [prefix, times] = spec.split(':')
  const delays = (times ?? '4000').split(',').map(Number)
  const evals = (process.env.AGENT_OFFICE_EVAL ?? '').split('|||')
  w.webContents.on('console-message', (e) => console.log('[renderer]', e.message))
  w.webContents.once('did-finish-load', () => {
    delays.forEach((ms, i) => {
      setTimeout(async () => {
        if (evals[i]) {
          const out = await w.webContents.executeJavaScript(evals[i]).catch((e) => `eval failed: ${e}`)
          if (out !== undefined) console.log(`[shot ${i + 1}]`, typeof out === 'string' ? out : JSON.stringify(out))
        }
        await new Promise((r) => setTimeout(r, 400))
        const img = await w.webContents.capturePage()
        writeFileSync(`${prefix}-${i + 1}.png`, img.toPNG())
        if (i === delays.length - 1) app.quit()
      }, ms)
    })
  })
}

/**
 * Dev helper: AGENT_OFFICE_SEED=/path/seed.json hires the agents listed there
 * (an array of HireRequest) at startup, one every 1.5 s so they arrive in a line.
 */
function seedAgents(manager: AgentManager, file: string): void {
  let list: HireRequest[]
  try {
    list = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    console.error('seed: cannot read', file, err)
    return
  }
  list.forEach((req, i) =>
    setTimeout(() => {
      if (!existsSync(req.cwd)) return console.error('seed: missing folder', req.cwd)
      manager.hire({ ...req, permissionMode: req.permissionMode ?? 'default' })
    }, 2500 + i * 1500),
  )
}
