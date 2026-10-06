import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HireRequest, OfficeEvent, OfficeState, PermissionDecision, Settings } from '@shared/types'
import { AgentManager } from './agents'
import { Bridge } from './bridge'
import { startDemo } from './demo'
import { loadShellPath } from './env'
import { isSessionId, openInTerminal, recentSessions, sessionEntry, transcript } from './sessions'
import { Store } from './store'

const here = fileURLToPath(new URL('.', import.meta.url))
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
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

  const broadcast = (e: OfficeEvent) => {
    if (win && !win.isDestroyed()) win.webContents.send('office:event', e)
  }

  const updateBadge = () => {
    const count = manager.pendingRequests().length + manager.pendingResults().length
    if (process.platform === 'darwin') app.dock?.setBadge(count ? String(count) : '')
    else app.setBadgeCount(count)
  }

  const nameOf = (agentId: string) => manager.list().find((a) => a.id === agentId)?.name ?? 'Agente'

  manager.on('event', (e: OfficeEvent) => {
    broadcast(e)
    if (e.type === 'permission:new') {
      notify(store, `${nameOf(e.request.agentId)} está indo até você`, e.request.title)
      if (process.platform === 'darwin' && !win?.isFocused()) app.dock?.bounce('informational')
    } else if (e.type === 'result:new') {
      notify(store, `${nameOf(e.result.agentId)} terminou`, e.result.text.slice(0, 140))
    }
    if (e.type.startsWith('permission:') || e.type.startsWith('result:')) updateBadge()
  })

  const bridge = new Bridge(manager, store.settings.bridgePort, join(app.getPath('userData'), 'bridge-token'), (status) =>
    broadcast({ type: 'bridge:status', status }),
  )
  bridge.start()

  // ---------- IPC ----------
  ipcMain.handle('office:getState', (): OfficeState => ({
    agents: manager.list(),
    permissions: manager.pendingRequests(),
    results: manager.pendingResults(),
    bridge: bridge.status(),
    settings: store.settings,
    platform: process.platform,
  }))
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
  ipcMain.handle('office:send', (_e, id: string, text: string) => manager.sendMessage(String(id), String(text)))
  ipcMain.handle('office:interrupt', (_e, id: string) => manager.interrupt(String(id)))
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
  ipcMain.handle('office:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Pasta do projeto' })
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
  ipcMain.handle('office:openExternal', (_e, url: string) => {
    // Only web links leave the app; file:// or custom schemes could run things.
    if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url))
  })
  ipcMain.handle('office:revealPath', (_e, p: string) => {
    if (typeof p === 'string' && existsSync(p)) shell.showItemInFolder(p)
  })

  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(here, '../../resources/icon.png'))
  win = createWindow()
  if (process.env.AGENT_OFFICE_DEMO === '1') startDemo(manager)
  if (process.env.AGENT_OFFICE_SEED) seedAgents(manager, process.env.AGENT_OFFICE_SEED)
  if (process.env.AGENT_OFFICE_SHOTS) captureShots(win, process.env.AGENT_OFFICE_SHOTS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
  app.on('before-quit', () => {
    bridge.stop()
    manager.shutdown()
    store.flush()
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
