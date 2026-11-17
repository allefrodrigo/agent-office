import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, powerMonitor, session, type NativeImage } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { permissionNotice, realPathOf } from '@shared/permission-notice'
import { BOT_GROUND_FLOOR, type Actor, type AgentBrain, type OfficeEvent, type PermissionRequest } from '@shared/types'
import { Accounts, accountEnv } from './accounts'
import { AgentManager } from './agents'
import { badgePixels, encodePng } from './badge'
import { dockBadge, taskbarOverlay } from '@shared/meeting-tray'
import { Bridge } from './bridge'
import { TicketDesk } from './delegate'
import { prepareStress, startBotDemo, startCrmDemo, startCrmLoad, startDemo, startRoutineDemo, startStress } from './demo'
import { CostBook } from './ledger'
import { flushOnExit, setupData } from './data'
import { guardWindow, installFatalHandlers, onFatalFlush } from './crash'
import { captureConsole, initLog, log, secret } from './log'
import { dropInheritedClaudeEnv, loadShellPath, stressDataDirError } from './env'
import { isDir, loadSquads, squadInfo } from './squads'
import { MacJobs } from './mac-jobs'
import { RoutineScheduler, RoutineStore } from './routines'
import { MeetingStore } from './meetings/store'
import { Store } from './store'
import { SystemMonitor } from './system'
import { StatsReader } from './stats'
import { UsageMonitor } from './usage'
import { TicketBoard } from './tickets'
import { pruneWorktrees } from './git'
import { Caffeine } from './caffeine'
import { QuitFlow, runQuitHooks } from './quit'
import { Updater } from './updater'
import { captureShots, forceCrash, registerMeetingWavHook, runBench, seedAgents } from './dev-hooks'
import { installMediaPermissions } from './meetings/capture'
import { meetingLive, onMeetingLiveChange } from './meetings/tray'
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
import { registerCreativeIpc } from './ipc/creative'
import { registerVoiceIpc } from './ipc/voice'
import { registerCreativeLibraryIpc } from './ipc/creative-library'
import { registerMeetingsIpc } from './ipc/meetings'
import { registerBotsIpc } from './ipc/bots'
import { BotRunner } from './bots/runner'
import { BotStore } from './bots/store'
import { BotTools } from './bots/mcp'
import { BotTriggers } from './bots/triggers'
import { registerBotAutomationsIpc } from './ipc/bots-automations'
import { ChannelService, runnerHost } from './bots/channels'
import { makeRouter } from './bots/router'
import { channelTools } from './bots/mcp-channels'
import { registerBotChannelsIpc } from './ipc/bots-channels'
import { CrmStore } from './crm/store'
import { registerCrmIpc } from './ipc/crm'
import { registerCrmServerIpc } from './ipc/crm-server'
import { registerCrmWhatsappIpc, type CrmWhatsapp } from './ipc/crm-whatsapp'
import { handleMediaScheme, registerMediaScheme } from './creative/protocol'
import { stopAllWhisper } from './meetings/whisper'
import { PetMode } from './pet'

const here = fileURLToPath(new URL('.', import.meta.url))
let win: BrowserWindow | null = null
/** Modo mini: the agents on the bottom of the screen; set once the app is ready. */
let pet: PetMode | null = null
/** Where dialogs and cards go: the pet window while it is on (the office window is hidden then). */
const front = (): BrowserWindow | null => pet?.window ?? win

/** Set once the app is ready: closing the last window on Windows asks first, like ⌘Q. */
let quitFlow: QuitFlow | null = null

function createWindow(hidden = false): BrowserWindow {
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
  if (!headless && !hidden) w.once('ready-to-show', () => w.show())
  // Windows: stop blinking the taskbar button once the user looks at the office.
  if (process.platform === 'win32') w.on('focus', () => w.flashFrame(false))
  // Off macOS closing the window quits the app: with agents working, ask first.
  if (process.platform !== 'darwin') w.on('close', (e) => quitFlow?.intercept() && e.preventDefault())
  // The window only ever shows our own bundle.
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  // A crashed or frozen page loads again; the agents keep running in this process.
  guardWindow(w, loadPage)
  loadPage(w)
  return w
}

/** The page the window shows: the dev server, or index.html in the bundle. Only it gets the microphone. */
function appPageUrl(): string {
  return process.env.ELECTRON_RENDERER_URL || pathToFileURL(join(here, '../renderer/index.html')).href
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
  // Modo mini: the card opens over the agent on the bottom of the screen.
  const strip = pet?.window
  if (strip) {
    pet!.focus()
    strip.webContents.send('office:event', { type: 'notice:open', ...target } satisfies OfficeEvent)
    return
  }
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

/** A bot's notification was clicked: the office window comes forward with the Chat on the thread. */
function openBotThread(threadId: string): void {
  // The Chat lives in the office window: the modo mini gives way to it.
  if (pet?.on) void pet.leave()
  if (!win || win.isDestroyed()) win = createWindow()
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  const target = win
  const send = () => target.webContents.send('office:event', { type: 'bot:open', threadId } satisfies OfficeEvent)
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', send)
  else send()
}

/** Bot notices held while a meeting records with "Não perturbe" on: the newest per thread. */
const heldBotNotices = new Map<string, { title: string; body: string }>()

/** "Não perturbe" (RN-17, doNotDisturb in meeting-map.ts) holds the bots' notices; the Chat's thread keeps them. */
function botsQuiet(store: Store): boolean {
  return meetingLive() && store.settings.meetings?.doNotDisturb !== false
}

/**
 * A bot's system notification (the BotRunner already follows Configurações → Chat → notify).
 * During a meeting it waits; when the meeting ends, what waited comes as one notice.
 */
function notifyBot(store: Store, title: string, body: string, threadId: string): void {
  if (botsQuiet(store)) {
    heldBotNotices.delete(threadId)
    heldBotNotices.set(threadId, { title, body })
    return
  }
  if (!canNotify(store)) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => openBotThread(threadId))
  keepNotice(`bot:${threadId}`, n)
  n.show()
}

/** The meeting ended: the bots' held notices, one by itself or a count that opens the newest thread. */
function releaseBotNotices(store: Store): void {
  if (botsQuiet(store) || !heldBotNotices.size) return
  const held = [...heldBotNotices]
  heldBotNotices.clear()
  const [threadId, last] = held[held.length - 1]
  if (held.length === 1) return notifyBot(store, last.title, last.body, threadId)
  notifyBot(store, 'Chat dos bots', `${held.length} conversas com novidades durante a reunião. A mais recente: ${last.title}.`, threadId)
}

function canNotify(store: Store): boolean {
  return store.settings.notifications && Notification.isSupported() && !win?.isFocused()
}

function notify(store: Store, title: string, body: string, target?: NoticeTarget): void {
  if (!canNotify(store)) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => (target ? openFromNotice(target) : pet?.on ? pet.focus() : (win?.show(), win?.focus())))
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

// Estúdio criativo: local images and videos reach the page through office-media://, never file://.
registerMediaScheme()

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
  // Before any page loads: microphone only for our own page, everything else denied (sala de reunião).
  installMediaPermissions(session.defaultSession, appPageUrl())
  await loadShellPath()
  const store = new Store()
  const manager = new AgentManager(store)
  const book = new CostBook(store)
  manager.book = book
  const board = new TicketBoard(app.getPath('userData'))
  const routineStore = new RoutineStore(app.getPath('userData'))
  const meetingStore = new MeetingStore(app.getPath('userData'))
  // Chat dos bots: bots.json and each bot's folder (thread, memory).
  const botStore = new BotStore(app.getPath('userData'))
  const botTools = new BotTools(botStore)
  // Sala de CRM: crm.json (customers, deals, payments, recurrences and the rules).
  const crmStore = new CrmStore(app.getPath('userData'))
  // Sala de CRM, phase 2: the WhatsApp link and the conversations (registered with the IPC below).
  let crmWhatsapp: CrmWhatsapp | null = null
  // A meeting the app closed on while recording keeps its audio on disk: it shows as interrupted.
  meetingStore.recoverInterrupted()
  // A fatal error saves what is in memory before asking what to do.
  onFatalFlush(() => {
    store.flush()
    board.flush()
    routineStore.flush()
    meetingStore.flush()
    botStore.flush()
    crmStore.flush()
    crmWhatsapp?.flush()
  })
  manager.officeTools = (agent) => board.toolsFor(agent, () => store.settings.projects, meetingStore, botTools)
  const desk = new TicketDesk(board, manager, () => store.settings)
  // Old tickets in "Feito" close by themselves: now, then every hour.
  board.autoClose(store.settings.ticketAutoCloseDays)
  setInterval(() => board.autoClose(store.settings.ticketAutoCloseDays), 3_600_000).unref()
  const player = (): Actor => ({ kind: 'player', name: store.settings.playerName })
  const defaultBrain = (): AgentBrain => ({ model: store.settings.defaultModel || undefined, effort: store.settings.defaultEffort || undefined })

  // Chat dos bots: event automations watch tickets and meetings; channels follow the bots (set further down).
  const botEvents: { triggers?: BotTriggers; channels?: ChannelService } = {}
  const broadcast = (e: OfficeEvent) => {
    if (botEvents.triggers && (e.type.startsWith('ticket:') || e.type.startsWith('meeting:'))) botEvents.triggers.handle(e)
    if (e.type === 'bots') botEvents.channels?.botsChanged()
    // A crashed page reloads by itself and gets the state again; sending now only makes noise (AO-27).
    if (win && !win.isDestroyed() && !win.webContents.isCrashed()) win.webContents.send('office:event', e)
    const strip = pet?.window
    if (strip && !strip.webContents.isCrashed()) strip.webContents.send('office:event', e)
  }

  // Windows has no app badge: the taskbar shows an overlay icon instead.
  // Images depend only on a count computed here, never on renderer data.
  const overlays = new Map<string, NativeImage>()
  const overlayFor = (label: string): NativeImage => {
    let img = overlays.get(label)
    if (!img) {
      img = nativeImage.createFromBuffer(encodePng(16, 16, badgePixels(label, 16)))
      img.addRepresentation({ scaleFactor: 2, buffer: encodePng(32, 32, badgePixels(label, 32)) })
      overlays.set(label, img) // at most 11 labels: 1…9, 9+ and ● (meeting recording)
    }
    return img
  }

  // RN-08: a meeting recording adds a red dot — '● 3' on the Dock, the dot on the taskbar overlay.
  const updateBadge = () => {
    const count = manager.pendingRequests().length + manager.pendingResults().length
    const recording = meetingLive()
    if (process.platform === 'darwin') app.dock?.setBadge(dockBadge(count, recording))
    else if (process.platform === 'win32') {
      const overlay = taskbarOverlay(count, recording)
      if (win && !win.isDestroyed()) win.setOverlayIcon(overlay ? overlayFor(overlay.label) : null, overlay?.description ?? '')
    } else app.setBadgeCount(count)
  }
  onMeetingLiveChange(updateBadge)
  onMeetingLiveChange(() => releaseBotNotices(store))

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
      const caller = manager.list().find((a) => a.id === e.request.agentId)
      // A bot's approval is noticed by the BotRunner, with a click that opens its thread.
      if (!caller?.bot) notifyPermission(store, manager, e.request, callerOf(e.request.agentId), caller?.cwd)
      if (process.platform === 'darwin' && !win?.isFocused()) app.dock?.bounce('informational')
      flash()
    } else if (e.type === 'result:new') {
      // Runs before the scheduler's own listener, so the run is still on.
      const routine = routines.activeRun(e.result.agentId)?.routine
      const title = !routine ? `${nameOf(e.result.agentId)} terminou` : e.result.isError ? `Rotina ${routine.name} falhou` : `Rotina ${routine.name}: ${nameOf(e.result.agentId)} terminou`
      // A bot's result is noticed by the BotRunner (Configurações > Chat > entregar no escritório too).
      if (!manager.list().find((a) => a.id === e.result.agentId)?.bot) notify(store, title, e.result.text.slice(0, 140), { agentId: e.result.agentId, itemId: e.result.id })
      flash()
    } else if (e.type === 'permission:resolved') dropNotice(e.requestId)
    else if (e.type === 'result:acked') dropNotice(e.resultId)
    if (e.type.startsWith('permission:') || e.type.startsWith('result:')) updateBadge()
  })

  board.on('event', broadcast)

  // Chat dos bots: each bot runs on an office agent; its work goes into its thread.
  const bots = new BotRunner({
    store: botStore,
    manager,
    settings: () => store.settings,
    broadcast,
    notify: (title, body, threadId) => notifyBot(store, title, body, threadId),
    book,
  })
  manager.botHooks = bots.hooks()
  // Scheduled routines (the routines board on every floor). Made after the listener above, so
  // the notifications there still see a run that the scheduler is about to close. A bot's
  // schedule is a routine with who { kind: 'bot' }: it runs through the BotRunner.
  const routines = new RoutineScheduler({
    store: routineStore,
    manager,
    settings: () => store.settings,
    broadcast: (list) => broadcast({ type: 'routines', routines: list }),
    notify: (title, body, target) => notify(store, title, body, target),
    bots,
  })
  // Event automations: a ticket created or moved, an ata ready, another bot done.
  const triggers = new BotTriggers({
    store: botStore,
    bots,
    settings: () => store.settings,
    tickets: () => board.list(),
    ata: (id) => {
      const markdown = meetingStore.readAtaMd(id)
      if (markdown === null) return null
      return { markdown, actions: (meetingStore.readAta(id) ?? []).filter((b) => b.kind === 'action').map((b) => b.text) }
    },
    botOfAgent: (id) => manager.agent(id)?.bot,
    broadcast: (triggers) => broadcast({ type: 'botTriggers', triggers }),
  })
  botEvents.triggers = triggers
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
  // A bot's result that stays in the Chat moves the numbers too.
  manager.on('quietResult', () => usage.nudge())

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
      // Called right before it restarts to install: the player already confirmed.
      quit.allow()
      store.flush()
      board.flush()
      routineStore.flush()
      meetingStore.flush()
      botStore.flush()
      crmStore.flush()
      crmWhatsapp?.flush()
    },
    broadcast,
  })
  updater.start()

  // Agents working or waiting for you: the café corner and the quit dialog count them.
  const busyAgents = () => manager.list().filter((a) => a.status === 'working' || a.status === 'starting' || a.status === 'waiting')
  const caffeine = new Caffeine({
    mode: () => store.settings.caffeine ?? 'off',
    working: () => busyAgents().length,
    changed: (awake) => broadcast({ type: 'caffeine', awake }),
  })
  manager.on('event', (e: OfficeEvent) => {
    if (e.type === 'agent:upsert' || e.type === 'agent:removed') caffeine.check()
  })
  caffeine.start()
  const quit = new QuitFlow({
    win: front,
    working: () => busyAgents().filter((a) => a.source === 'office'),
    pending: () => manager.pendingRequests().length,
    interrupt: (id) => manager.interrupt(id),
    background: () => backstage.current().filter((p) => p.owner.kind !== 'terminal'),
    stopProcess: (id) => backstage.stopProcess(id),
    holdRoutines: (hold) => (hold ? routines.stop() : routines.start()),
    broadcast: (wait) => broadcast({ type: 'quit', wait }),
  })
  quitFlow = quit

  // Durable saves on kill, crash and sleep (AO-26); backups, restore, export and import (AO-25).
  const flushAll = () => {
    store.flush()
    board.flush()
    routineStore.flush()
    meetingStore.flush()
    botStore.flush()
    crmStore.flush()
    crmWhatsapp?.flush()
  }
  flushOnExit({ flush: flushAll, stopAll: () => stopAll() })
  setupData({
    dataDir: app.getPath('userData'),
    win: front,
    broadcast,
    flush: flushAll,
    stopAll: () => stopAll(),
    lock: () => {
      routines.stop()
      store.lock()
      board.lock()
      routineStore.lock()
      meetingStore.lock()
      botStore.lock()
      crmStore.lock()
    },
  })

  // Worktrees whose folder was deleted by hand: git forgets them (`git worktree prune`).
  void pruneWorktrees([...store.settings.projects.map((p) => p.cwd), ...manager.list().flatMap((a) => (a.worktree ? [a.worktree.repo] : []))])

  // ---------- IPC ----------
  // One file per area in ipc/; every argument from the renderer passes through validate.ts first.
  const ipc: IpcContext = {
    win: front,
    store,
    manager,
    board,
    book,
    desk,
    routines,
    meetings: meetingStore,
    macJobs,
    caffeine,
    quit,
    bridge,
    usage,
    accounts,
    system,
    stats,
    backstage,
    tools,
    botStore,
    bots,
    // Deleting a bot takes its routines and event automations along (and pauses the ones waiting on it).
    botDeleted: (id: string) => {
      routines.removeForBot(id)
      triggers.removeForBot(id)
    },
    crmStore,
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
  registerCreativeIpc(ipc)
  registerCreativeLibraryIpc(ipc)
  registerMeetingsIpc(ipc)
  registerBotsIpc(ipc)
  // Sala de CRM, phase 1: customers, deals, payments; the api also runs the recurrences once a day.
  const crm = registerCrmIpc(ipc)
  // Sala de CRM, phase 2: the local Evolution (Docker or Colima), turned on and off from the app.
  registerCrmServerIpc(ipc, app.getPath('userData'))
  // Sala de CRM, phase 2: the WhatsApp (Evolution), its events and the conversations (CR-08 a CR-10).
  crmWhatsapp = registerCrmWhatsappIpc(ipc, app.getPath('userData'))
  registerBotAutomationsIpc({
    triggers,
    routines,
    bots: () => botStore.bots,
    settings: () => store.settings,
    claudeFor: (floorId) => {
      const floor = store.settings.projects.find((x) => x.id === floorId)
      const account = accounts.pick({ cwd: floor?.cwd ?? '', accounts: floor?.accounts })
      return { env: accountEnv(account), account: account.id }
    },
    scratchDir: () => app.getPath('userData'),
    book,
  })
  // Chat dos bots, phase 3: channels with several bots and the player, the router that picks who
  // answers, and the chat_post / bot_ask tools of a bot that is in a channel.
  const chatFloors = () => [{ id: BOT_GROUND_FLOOR, name: 'Térreo' }, ...store.settings.projects.map((p) => ({ id: p.id, name: p.name }))]
  const channels = new ChannelService({
    store: botStore,
    host: runnerHost(bots, (id) => botStore.bot(id)),
    route: makeRouter({
      model: () => store.settings.chat?.routerModel,
      place: (floorId) => {
        const floor = store.settings.projects.find((x) => x.id === floorId)
        const account = accounts.pick({ cwd: floor?.cwd ?? '', accounts: floor?.accounts })
        return { cwd: floor && isDir(floor.cwd) ? floor.cwd : app.getPath('userData'), env: accountEnv(account), account: account.id }
      },
      ledger: { book, category: 'bots' },
    }),
    floors: chatFloors,
    chat: () => store.settings.chat ?? {},
    broadcast,
  })
  botEvents.channels = channels
  botTools.add(channelTools(channels))
  registerBotChannelsIpc({ channels, bots: () => botStore.bots, floors: () => chatFloors().map((f) => f.id) })
  registerVoiceIpc()
  // Dev only: AGENT_OFFICE_MEETING_WAV feeds the meeting capture from a WAV instead of the mic.
  registerMeetingWavHook(app.isPackaged ? undefined : process.env.AGENT_OFFICE_MEETING_WAV)
  handleMediaScheme()

  // YouTube refuses embeds without a web Referer (error 153), and file:// sends none.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (d, cb) => {
    cb({ requestHeaders: { ...d.requestHeaders, Referer: 'https://agent-office.local/' } })
  })

  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(here, '../../resources/icon.png'))
  // Modo mini: its own transparent window; the office window waits hidden.
  const strip = new PetMode({
    dataDir: app.getPath('userData'),
    preload: join(here, '../preload/index.cjs'),
    load: (w) => {
      if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pet.html`)
      else void w.loadFile(join(here, '../renderer/pet.html'))
    },
    office: () => (win && !win.isDestroyed() ? win : null),
    reopenOffice: () => (win = createWindow()),
  })
  pet = strip
  ipcMain.handle('office:petEnter', () => strip.enter())
  ipcMain.handle('office:petLeave', () => void strip.leave())
  ipcMain.handle('office:petGeometry', () => strip.current())
  ipcMain.on('office:petInteractive', (e, on: unknown) => {
    if (e.sender === strip.window?.webContents) strip.setInteractive(on === true)
  })
  ipcMain.on('office:petFocus', (e) => {
    if (e.sender === strip.window?.webContents) strip.focus()
  })
  // Stress floors go in before the window asks for the state.
  const stress = process.env.AGENT_OFFICE_DEMO === 'stress' && prepareStress(store)
  if (stress) squads = readSquads()
  const startCompact = strip.remembered && !process.env.AGENT_OFFICE_SHOTS && !process.env.AGENT_OFFICE_BENCH
  win = createWindow(startCompact)
  if (startCompact) strip.enter()
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
    startBotDemo(manager, botStore, bots)
    startCrmDemo(crmStore)
  }
  // `npm run bench -- --crm`: the CRM with 2 000 customers, in memory only.
  if (process.env.AGENT_OFFICE_DEMO === 'crm') startCrmLoad(crmStore)
  // After the demo is in place: what was due while the app was closed runs (or is skipped) now.
  routines.start()
  // Recurrences make the payments already due: now, then on each new local day (checked hourly and on wake).
  crm.tick()
  setInterval(() => crm.tick(), 3_600_000).unref()
  powerMonitor.on('resume', () => crm.tick())
  // The WhatsApp link starts with the CRM on (and a token in the vault); never in the demo.
  if (store.settings.crm?.enabled && !process.env.AGENT_OFFICE_DEMO) crmWhatsapp.start()
  // Bot agents restored from office.json go back to their bots; idle ones leave after a while.
  bots.start()
  macJobs.start()
  if (stress) startStress(manager)
  if (process.env.AGENT_OFFICE_SEED) seedAgents(manager, process.env.AGENT_OFFICE_SEED)
  if (process.env.AGENT_OFFICE_SHOTS) captureShots(win, process.env.AGENT_OFFICE_SHOTS)
  if (process.env.AGENT_OFFICE_BENCH) runBench(win, process.env.AGENT_OFFICE_BENCH)
  if (process.env.AGENT_OFFICE_CRASH && !app.isPackaged) forceCrash(win, process.env.AGENT_OFFICE_CRASH)

  app.on('activate', () => {
    // The Dock icon in the modo mini brings the whole office back.
    if (strip.on) return void strip.leave()
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
  const stopAll = () => {
    log.info('Saindo')
    // Child processes registered with onQuit (the meeting room's audio helper).
    runQuitHooks()
    caffeine.stop()
    updater.stop()
    bridge.stop()
    usage.stop()
    stats.stop()
    backstage.stop()
    system.stop()
    manager.shutdown()
    book.stop()
    routines.stop()
    bots.dispose()
    crmWhatsapp?.stop()
    macJobs.stop()
    void stopAllWhisper()
    store.flush()
    board.flush()
    routineStore.flush()
    meetingStore.flush()
    botStore.flush()
    crmStore.flush()
    crmWhatsapp?.flush()
  }
  app.on('before-quit', (e) => {
    // Agents working: the quit dialog decides (wait, interrupt or stay); stopAll runs on the way out.
    if (quit.intercept()) return e.preventDefault()
    stopAll()
  })
}).catch((err) => {
  // E.g. a corrupt data file that could not be moved aside: stop rather than write over it.
  log.error('Falha ao abrir:', err)
  dialog.showErrorBox('O Agent Office não conseguiu abrir', err instanceof Error ? err.message : String(err))
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
