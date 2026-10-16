import { app, BrowserWindow, dialog, nativeImage, Notification, powerMonitor, session, type NativeImage } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { permissionNotice, realPathOf } from '@shared/permission-notice'
import type { Actor, AgentBrain, OfficeEvent, PermissionRequest } from '@shared/types'
import { Accounts } from './accounts'
import { AgentManager } from './agents'
import { badgeDescription, badgeLabel, badgePixels, encodePng } from './badge'
import { Bridge } from './bridge'
import { TicketDesk } from './delegate'
import { prepareStress, startDemo, startRoutineDemo, startStress } from './demo'
import { CostBook } from './ledger'
import { flushOnExit, setupData } from './data'
import { guardWindow, installFatalHandlers, onFatalFlush } from './crash'
import { captureConsole, initLog, log, secret } from './log'
import { dropInheritedClaudeEnv, loadShellPath, stressDataDirError } from './env'
import { isDir, loadSquads, squadInfo } from './squads'
import { MacJobs } from './mac-jobs'
import { RoutineScheduler, RoutineStore } from './routines'
import { Store } from './store'
import { SystemMonitor } from './system'
import { StatsReader } from './stats'
import { UsageMonitor } from './usage'
import { TicketBoard } from './tickets'
import { pruneWorktrees } from './git'
import { Updater } from './updater'
import { captureShots, forceCrash, runBench, seedAgents } from './dev-hooks'
import type { IpcContext } from './ipc/context'
import { registerAccountsIpc } from './ipc/accounts'
import { registerAgentsIpc } from './ipc/agents'
import { registerAppIpc } from './ipc/app'
import { registerSessionsIpc } from './ipc/sessions'
import { registerSettingsIpc } from './ipc/settings'
import { registerSquadsIpc } from './ipc/squads'
import { registerBackstageIpc } from './ipc/backstage'
import { Backstage } from './backstage'
import { ToolsDesk } from './backstage/tools'
import { registerRoutinesIpc } from './ipc/routines'
import { registerTicketsIpc } from './ipc/tickets'
import { registerWorktreesIpc } from './ipc/worktrees'

const here = fileURLToPath(new URL('.', import.meta.url))
let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  // Screenshot and bench runs (dev only) render in a hidden window so they never steal focus.
  const headless = !!process.env.AGENT_OFFICE_SHOTS || !!process.env.AGENT_OFFICE_BENCH
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
  // Windows: stop blinking the taskbar button once the user looks at the office.
  if (process.platform === 'win32') w.on('focus', () => w.flashFrame(false))
  // The window only ever shows our own bundle.
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  // A crashed or frozen page loads again; the agents keep running in this process.
  guardWindow(w, loadPage)
  loadPage(w)
  return w
}

function loadPage(w: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  // Screenshot and bench runs get the dev globals (__game…) so AGENT_OFFICE_EVAL can move the camera; the bench opens the perf panel too.
  else if (process.env.AGENT_OFFICE_BENCH) void w.loadFile(join(here, '../renderer/index.html'), { query: { shots: '1', perf: '1' } })
  else void w.loadFile(join(here, '../renderer/index.html'), process.env.AGENT_OFFICE_SHOTS ? { query: { shots: '1' } } : undefined)
}

/** A card the notification points at: a permission request or a result. */
interface NoticeTarget {
  agentId: string
  itemId: string
}

/**
 * Notifications on screen, by item. Holding them keeps the GC from dropping their click
 * and action handlers while they sit in the Notification Center.
 */
const notices = new Map<string, Notification>()
const MAX_NOTICES = 40

function keepNotice(itemId: string, n: Notification): void {
  dropNotice(itemId)
  notices.set(itemId, n)
  while (notices.size > MAX_NOTICES) notices.delete(notices.keys().next().value!)
}

/** The item was decided or acked (here, in the terminal or from the notification): take it off the screen. */
function dropNotice(itemId: string): void {
  notices.get(itemId)?.close()
  notices.delete(itemId)
}

/** Window forward and the card of the item open right away, without waiting for the walk. */
function openFromNotice(target: NoticeTarget): void {
  if (!win || win.isDestroyed()) {
    // Window closed (macOS): it opens again and the card comes when the agent arrives.
    win = createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('office:event', { type: 'notice:open', ...target } satisfies OfficeEvent)
}

function canNotify(store: Store): boolean {
  return store.settings.notifications && Notification.isSupported() && !win?.isFocused()
}

function notify(store: Store, title: string, body: string, target?: NoticeTarget): void {
  if (!canNotify(store)) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => (target ? openFromNotice(target) : (win?.show(), win?.focus())))
  if (target) keepNotice(target.itemId, n)
  n.show()
}

/**
 * Permission request. On macOS: "Permitir" (only for what permissionNotice deems safe to
 * approve unseen) and an inline reply that denies with an instruction. Windows and Linux:
 * the click opens the card (toast actions there need a registered COM activator).
 */
function notifyPermission(store: Store, manager: AgentManager, req: PermissionRequest, agentName: string, cwd: string | undefined): void {
  if (!canNotify(store)) return
  const notice = permissionNotice(req, agentName, process.platform, { cwd, realpath: realPathOf })
  const n = new Notification({
    title: notice.title,
    body: notice.body,
    silent: false,
    actions: notice.allow ? [{ type: 'button', text: 'Permitir' }] : [],
    hasReply: notice.reply,
    replyPlaceholder: req.kind === 'plan' ? 'O que mudar no plano?' : 'Negar e dizer o que fazer…',
  })
  const target = { agentId: req.agentId, itemId: req.id }
  n.on('click', () => openFromNotice(target))
  n.on('action', (details, index) => {
    // Checked again at the click: a path swapped since the notice (e.g. a new symlink) loses the button.
    if (!notice.allow || (details.actionIndex ?? index) !== 0) return
    if (!permissionNotice(req, agentName, process.platform, { cwd, realpath: realPathOf }).allow) {
      openFromNotice(target)
      return
    }
    manager.respond({ requestId: req.id, behavior: 'allow' })
  })
  n.on('reply', (details, reply) => {
    if (!notice.reply) return
    const text = String(details.reply ?? reply ?? '').trim().slice(0, 2000)
    manager.respond({ requestId: req.id, behavior: 'deny', message: text || (req.kind === 'plan' ? 'Revise o plano.' : 'Negado pela notificação.') })
  })
  keepNotice(req.id, n)
  n.show()
}

dropInheritedClaudeEnv()

// Before anything reads or writes userData: the stress demo never opens the real office (AO-31).
const stressError = stressDataDirError()
if (stressError) {
  console.error(stressError)
  // showErrorBox works before ready and blocks until closed.
  dialog.showErrorBox('Modo de carga sem pasta de dados', stressError)
  // process.exit, not app.exit: nothing below may run, not even initLog.
  process.exit(1)
}

// Windows only shows notifications for apps with an AppUserModelID.
app.setAppUserModelId('dev.allef.agentoffice')
// Dev helper: run a second, isolated instance (own data, own bridge port in its office.json).
if (process.env.AGENT_OFFICE_DATA_DIR) app.setPath('userData', process.env.AGENT_OFFICE_DATA_DIR)
// Dev helper: AGENT_OFFICE_LOG_MAX_KB rotates the log sooner, to test rotation.
initLog(app.getPath('userData'), { maxBytes: !app.isPackaged ? Number(process.env.AGENT_OFFICE_LOG_MAX_KB) * 1024 || undefined : undefined })
captureConsole()
installFatalHandlers()
log.info(`Agent Office ${app.getVersion()} iniciando (${process.platform} ${process.arch}, Electron ${process.versions.electron})`)

app.whenReady().then(async () => {
  await loadShellPath()
  const store = new Store()
  const manager = new AgentManager(store)
  const book = new CostBook(store)
  manager.book = book
  const board = new TicketBoard(app.getPath('userData'))
  const routineStore = new RoutineStore(app.getPath('userData'))
  // A fatal error saves what is in memory before asking what to do.
  onFatalFlush(() => {
    store.flush()
    board.flush()
    routineStore.flush()
  })
  manager.officeTools = (agent) => board.toolsFor(agent, () => store.settings.projects)
  const desk = new TicketDesk(board, manager, () => store.settings)
  // Old tickets in "Feito" close by themselves: now, then every hour.
  board.autoClose(store.settings.ticketAutoCloseDays)
  setInterval(() => board.autoClose(store.settings.ticketAutoCloseDays), 3_600_000).unref()
  const player = (): Actor => ({ kind: 'player', name: store.settings.playerName })
  const defaultBrain = (): AgentBrain => ({ model: store.settings.defaultModel || undefined, effort: store.settings.defaultEffort || undefined })

  const broadcast = (e: OfficeEvent) => {
    // A crashed page reloads by itself and gets the state again; sending now only makes noise (AO-27).
    if (win && !win.isDestroyed() && !win.webContents.isCrashed()) win.webContents.send('office:event', e)
  }

  // Windows has no app badge: the taskbar shows an overlay icon instead.
  // Images depend only on a count computed here, never on renderer data.
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
  // window is not focused (macOS keeps its Dock bounce).
  const flash = () => {
    if (process.platform === 'win32' && win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true)
  }

  const nameOf = (agentId: string) => manager.list().find((a) => a.id === agentId)?.name ?? 'Agente'
  /** "Ada (rotina Relatório diário)" while the agent runs a routine, so the notification says why it calls. */
  const callerOf = (agentId: string) => {
    const r = routines.activeRun(agentId)?.routine
    return r ? `${nameOf(agentId)} (rotina ${r.name})` : nameOf(agentId)
  }

  // Each project floor shows the squads of its folder.
  const squadDefs = () => store.settings.projects.flatMap((p) => (isDir(p.cwd) ? loadSquads(p.cwd) : []))
  const readSquads = () => squadDefs().map(squadInfo)
  let squads = readSquads()

  manager.on('event', (e: OfficeEvent) => {
    broadcast(e)
    if (e.type === 'permission:new') {
      notifyPermission(store, manager, e.request, callerOf(e.request.agentId), manager.list().find((a) => a.id === e.request.agentId)?.cwd)
      if (process.platform === 'darwin' && !win?.isFocused()) app.dock?.bounce('informational')
      flash()
    } else if (e.type === 'result:new') {
      // Runs before the scheduler's own listener, so the run is still on.
      const routine = routines.activeRun(e.result.agentId)?.routine
      const title = !routine ? `${nameOf(e.result.agentId)} terminou` : e.result.isError ? `Rotina ${routine.name} falhou` : `Rotina ${routine.name}: ${nameOf(e.result.agentId)} terminou`
      notify(store, title, e.result.text.slice(0, 140), { agentId: e.result.agentId, itemId: e.result.id })
      flash()
    } else if (e.type === 'permission:resolved') dropNotice(e.requestId)
    else if (e.type === 'result:acked') dropNotice(e.resultId)
    if (e.type.startsWith('permission:') || e.type.startsWith('result:')) updateBadge()
  })

  board.on('event', broadcast)

  // Scheduled routines (the routines board on every floor). Made after the listener above, so
  // the notifications there still see a run that the scheduler is about to close.
  const routines = new RoutineScheduler({
    store: routineStore,
    manager,
    settings: () => store.settings,
    broadcast: (list) => broadcast({ type: 'routines', routines: list }),
    notify: (title, body, target) => notify(store, title, body, target),
  })
  // Timers stop while the Mac sleeps: runs whose time passed follow the routine's choice.
  powerMonitor.on('resume', () => routines.check())
  // launchd's own schedules (Mochilinho, backups…), read only, beside the routines
  const macJobs = new MacJobs()
  macJobs.on('jobs', (jobs) => broadcast({ type: 'macJobs', jobs }))
  book.on('today', (today) => broadcast({ type: 'ledger:today', today }))

  const system = new SystemMonitor()
  system.on('system', (s) => broadcast({ type: 'system', system: s }))

  // Battery or charger (AO-32): the scene drops to Economia on battery when the player asked for it.
  // Dev only: AGENT_OFFICE_BATTERY=1 starts on battery, =flip switches every 5 s (to test without pulling the cable).
  const fakePower = !app.isPackaged ? process.env.AGENT_OFFICE_BATTERY : undefined
  let onBattery = fakePower ? true : powerMonitor.isOnBatteryPower()
  const setPower = (v: boolean) => {
    if (v === onBattery) return
    onBattery = v
    log.info(v ? 'Na bateria' : 'Na tomada')
    broadcast({ type: 'power', onBattery: v })
  }
  powerMonitor.on('on-battery', () => setPower(true))
  powerMonitor.on('on-ac', () => setPower(false))
  if (fakePower === 'flip') setInterval(() => setPower(!onBattery), 5000).unref()

  const usage = new UsageMonitor(() => store.settings.accounts)
  usage.on('usage', (u) => broadcast({ type: 'usage', usage: u }))
  const accounts = new Accounts(() => store.settings, () => usage.current())
  manager.accounts = accounts
  accounts.on('changed', (a) => broadcast({ type: 'accounts', accounts: a }))
  // A limit hit moves the numbers: read them again.
  accounts.on('limit', () => usage.nudge())
  manager.on('event', (e: OfficeEvent) => {
    if (e.type === 'result:new') usage.nudge()
  })

  const bridge = new Bridge(manager, store.settings.bridgePort, join(app.getPath('userData'), 'bridge-token'), (status) =>
    broadcast({ type: 'bridge:status', status }),
  )
  // The bridge token must never reach the log: the Bridge just wrote it, read it back.
  try {
    secret(readFileSync(join(app.getPath('userData'), 'bridge-token'), 'utf8'))
  } catch (err) {
    log.warn('Não consegui ler o bridge-token para escondê-lo do log:', err)
  }
  bridge.start()
  usage.start()
  system.start()
  // Claude Code statistics: disk only (transcripts + stats.json), never an API call.
  const stats = new StatsReader(app.getPath('userData'), {
    accounts: () => store.settings.accounts,
    switches: () => store.ledger.switches,
    plan: () => usage.current(),
  })
  stats.on('stats', (s) => broadcast({ type: 'stats', stats: s }))
  stats.start()
  // Bastidores: what the agents left running (processes, ports, orphans), their MCP servers and skills.
  const backstage = new Backstage({
    live: () => manager.liveAgents(),
    terminals: () => manager.list().filter((a) => a.source === 'terminal').map((summary) => ({ summary, pid: bridge.pidOf(summary.sessionId) })),
    stopTask: (agentId, taskId) => manager.stopTask(agentId, taskId),
    broadcast: (processes) => broadcast({ type: 'backstage', processes }),
  })
  manager.on('tasks', () => backstage.poke())
  backstage.start()
  const tools = new ToolsDesk({
    live: () => manager.liveAgents(),
    mcpStatus: () => manager.mcpStatus(),
    commands: () => manager.commands(),
    usage: () => stats.toolUsage(7),
    settings: () => store.settings,
  })
  void accounts.check()
  // Auto-update (packaged app only): restarting asks first while agents work or permissions wait.
  const updater = new Updater({
    channel: () => (store.settings.updateChannel === 'beta' ? 'beta' : 'stable'),
    busy: () => ({
      working: manager.list().filter((a) => a.source === 'office' && (a.status === 'working' || a.status === 'starting')).length,
      pending: manager.pendingRequests().length,
    }),
    flush: () => {
      store.flush()
      board.flush()
      routineStore.flush()
    },
    broadcast,
  })
  updater.start()

  // Durable saves on kill, crash and sleep (AO-26); backups, restore, export and import (AO-25).
  const flushAll = () => {
    store.flush()
    board.flush()
    routineStore.flush()
  }
  flushOnExit({ flush: flushAll, stopAll: () => stopAll() })
  setupData({
    dataDir: app.getPath('userData'),
    win: () => win,
    broadcast,
    flush: flushAll,
    stopAll: () => stopAll(),
    lock: () => {
      routines.stop()
      store.lock()
      board.lock()
      routineStore.lock()
    },
  })

  // Worktrees whose folder was deleted by hand: git forgets them (`git worktree prune`).
  void pruneWorktrees([...store.settings.projects.map((p) => p.cwd), ...manager.list().flatMap((a) => (a.worktree ? [a.worktree.repo] : []))])

  // ---------- IPC ----------
  // One file per area in ipc/; every argument from the renderer passes through validate.ts first.
  const ipc: IpcContext = {
    win: () => win,
    store,
    manager,
    board,
    book,
    desk,
    routines,
    macJobs,
    bridge,
    usage,
    accounts,
    system,
    stats,
    backstage,
    tools,
    broadcast,
    updateBadge,
    nameOf,
    player,
    defaultBrain,
    squads: () => squads,
    rereadSquads: () => (squads = readSquads()),
    onBattery: () => onBattery,
  }
  registerAppIpc(ipc)
  registerAccountsIpc(ipc)
  registerAgentsIpc(ipc)
  registerWorktreesIpc(ipc)
  registerSessionsIpc(ipc)
  registerSettingsIpc(ipc)
  registerTicketsIpc(ipc)
  registerSquadsIpc(ipc)
  registerRoutinesIpc(ipc)
  registerBackstageIpc(ipc)

  // YouTube refuses embeds without a web Referer (error 153), and file:// sends none.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (d, cb) => {
    cb({ requestHeaders: { ...d.requestHeaders, Referer: 'https://agent-office.local/' } })
  })

  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(here, '../../resources/icon.png'))
  // Stress floors go in before the window asks for the state.
  const stress = process.env.AGENT_OFFICE_DEMO === 'stress' && prepareStress(store)
  if (stress) squads = readSquads()
  win = createWindow()
  // Results restored from office.json show in the taskbar overlay right away.
  if (process.platform === 'win32') win.once('ready-to-show', updateBadge)
  // Back from logging in on the terminal: check the logins again.
  let checkedAt = 0
  app.on('browser-window-focus', () => {
    if (!accounts.unsure() || Date.now() - checkedAt < 30000) return
    checkedAt = Date.now()
    void accounts.check().then(() => usage.refresh())
  })
  if (process.env.AGENT_OFFICE_DEMO === '1') {
    startDemo(manager, squadDefs())
    startRoutineDemo(manager, routines)
  }
  // After the demo is in place: what was due while the app was closed runs (or is skipped) now.
  routines.start()
  macJobs.start()
  if (stress) startStress(manager)
  if (process.env.AGENT_OFFICE_SEED) seedAgents(manager, process.env.AGENT_OFFICE_SEED)
  if (process.env.AGENT_OFFICE_SHOTS) captureShots(win, process.env.AGENT_OFFICE_SHOTS)
  if (process.env.AGENT_OFFICE_BENCH) runBench(win, process.env.AGENT_OFFICE_BENCH)
  if (process.env.AGENT_OFFICE_CRASH && !app.isPackaged) forceCrash(win, process.env.AGENT_OFFICE_CRASH)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
  const stopAll = () => {
    log.info('Saindo')
    updater.stop()
    bridge.stop()
    usage.stop()
    stats.stop()
    backstage.stop()
    system.stop()
    manager.shutdown()
    book.stop()
    routines.stop()
    macJobs.stop()
    store.flush()
    board.flush()
    routineStore.flush()
  }
  app.on('before-quit', stopAll)
}).catch((err) => {
  // E.g. a corrupt data file that could not be moved aside: stop rather than write over it.
  log.error('Falha ao abrir:', err)
  dialog.showErrorBox('O Agent Office não conseguiu abrir', err instanceof Error ? err.message : String(err))
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
