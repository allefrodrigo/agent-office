import { app, BrowserWindow, dialog, ipcMain, Notification, session, shell } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectFor } from '@shared/projects'
import type { Actor, AgentBrain, HireRequest, OfficeEvent, OfficeState } from '@shared/types'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { Accounts } from './accounts'
import { AgentManager } from './agents'
import { Bridge } from './bridge'
import { TicketDesk } from './delegate'
import { startDemo } from './demo'
import { CostBook } from './ledger'
import { dropInheritedClaudeEnv, loadShellPath } from './env'
import { isSessionId, openInTerminal, recentSessions, sessionEntry, transcript } from './sessions'
import { findSquad, isDir, loadSquads, squadInfo } from './squads'
import { Store } from './store'
import { SystemMonitor } from './system'
import { StatsReader } from './stats'
import { UsageMonitor } from './usage'
import { TicketBoard } from './tickets'
import {
  accountNameSchema,
  assigneeSchema,
  attachmentsSchema,
  cleanAccountIds,
  cleanBrain,
  cleanDelegateTarget,
  cleanHire,
  cleanLedgerQuery,
  cleanSettings,
  commentSchema,
  delegateMode,
  externalUrlSchema,
  floorIdSchema,
  idSchema,
  messageSchema,
  parse,
  pathSchema,
  permissionDecisionSchema,
  permissionModeSchema,
  searchSchema,
  squadCodeSchema,
  squadNoteSchema,
  ticketDraftSchema,
  ticketIdsSchema,
  ticketPatchSchema,
  ticketStatusSchema,
} from './validate'

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
  // Screenshot runs get the dev globals (__game…) so AGENT_OFFICE_EVAL can move the camera.
  else w.loadFile(join(here, '../renderer/index.html'), headless ? { query: { shots: '1' } } : undefined)
  return w
}

// Claude FM's live restarts now and then under a new video ID; clau.de/radio always points at the current one.
const RADIO_FALLBACK = 'tRsQsTMvPNg'
async function radioVideo(): Promise<string> {
  try {
    const res = await fetch('https://clau.de/radio', { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    const id = new URL(res.headers.get('location') ?? '').searchParams.get('v') ?? ''
    if (/^[\w-]{11}$/.test(id)) return id
  } catch {
    // offline or the short link moved: keep the last known stream
  }
  return RADIO_FALLBACK
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

dropInheritedClaudeEnv()

// Windows only shows notifications for apps with an AppUserModelID.
app.setAppUserModelId('dev.allef.agentoffice')
// Dev helper: run a second, isolated instance (own data, own bridge port in its office.json).
if (process.env.AGENT_OFFICE_DATA_DIR) app.setPath('userData', process.env.AGENT_OFFICE_DATA_DIR)

app.whenReady().then(async () => {
  await loadShellPath()
  const store = new Store()
  const manager = new AgentManager(store)
  const book = new CostBook(store)
  manager.book = book
  const board = new TicketBoard(app.getPath('userData'))
  manager.officeTools = (agent) => board.toolsFor(agent, () => store.settings.projects)
  const desk = new TicketDesk(board, manager, () => store.settings)
  // Old tickets in "Feito" close by themselves: now, then every hour.
  board.autoClose(store.settings.ticketAutoCloseDays)
  setInterval(() => board.autoClose(store.settings.ticketAutoCloseDays), 3_600_000).unref()
  const player = (): Actor => ({ kind: 'player', name: store.settings.playerName })
  const defaultBrain = (): AgentBrain => ({ model: store.settings.defaultModel || undefined, effort: store.settings.defaultEffort || undefined })

  const broadcast = (e: OfficeEvent) => {
    if (win && !win.isDestroyed()) win.webContents.send('office:event', e)
  }

  const updateBadge = () => {
    const count = manager.pendingRequests().length + manager.pendingResults().length
    if (process.platform === 'darwin') app.dock?.setBadge(count ? String(count) : '')
    else app.setBadgeCount(count)
  }

  const nameOf = (agentId: string) => manager.list().find((a) => a.id === agentId)?.name ?? 'Agente'

  // Each project floor shows the squads of its folder.
  const squadDefs = () => store.settings.projects.flatMap((p) => (isDir(p.cwd) ? loadSquads(p.cwd) : []))
  const readSquads = () => squadDefs().map(squadInfo)
  let squads = readSquads()

  manager.on('event', (e: OfficeEvent) => {
    broadcast(e)
    if (e.type === 'permission:new') {
      notify(store, `${nameOf(e.request.agentId)} está indo até você`, e.request.context ? `${e.request.context}: ${e.request.title}` : e.request.title)
      if (process.platform === 'darwin' && !win?.isFocused()) app.dock?.bounce('informational')
    } else if (e.type === 'result:new') {
      notify(store, `${nameOf(e.result.agentId)} terminou`, e.result.text.slice(0, 140))
    }
    if (e.type.startsWith('permission:') || e.type.startsWith('result:')) updateBadge()
  })

  board.on('event', broadcast)
  book.on('today', (today) => broadcast({ type: 'ledger:today', today }))

  const system = new SystemMonitor()
  system.on('system', (s) => broadcast({ type: 'system', system: s }))

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
  void accounts.check()

  // ---------- IPC ----------
  // Every argument from the renderer passes through validate.ts first.
  const id = (raw: unknown) => parse(idSchema, raw, 'ID inválido.')
  const ticketId = (raw: unknown) => parse(idSchema, raw, 'Esse ticket não existe mais.')
  ipcMain.handle('office:getState', (): OfficeState => ({
    agents: manager.list(),
    permissions: manager.pendingRequests(),
    results: manager.pendingResults(),
    tickets: board.list(),
    bridge: bridge.status(),
    settings: store.settings,
    platform: process.platform,
    usage: usage.current(),
    accounts: accounts.statuses(),
    system: system.current(),
    squads,
    ledgerToday: book.today(),
  }))
  ipcMain.handle('office:getLedger', (_e, q: unknown) => book.query(cleanLedgerQuery(q)))
  ipcMain.handle('office:refreshUsage', () => usage.refresh())
  ipcMain.handle('office:getStats', () => stats.current())
  ipcMain.handle('office:refreshStats', () => stats.refresh())
  ipcMain.handle('office:checkAccounts', () => accounts.check())
  ipcMain.handle('office:addAccount', (_e, name: unknown) => {
    const account = accounts.create(accountNameSchema.parse(name))
    store.settings = { ...store.settings, accounts: [...store.settings.accounts, account] }
    broadcast({ type: 'settings', settings: store.settings })
    void accounts.check()
    void usage.refresh()
    return store.settings
  })
  ipcMain.handle('office:removeAccount', (_e, raw: unknown) => {
    const gone = id(raw)
    if (gone === MAIN_ACCOUNT) throw new Error('A conta principal não pode ser removida.')
    const s = store.settings
    const drop = (ids?: string[]) => ids?.filter((x) => x !== gone)
    store.settings = {
      ...s,
      accounts: s.accounts.filter((a) => a.id !== gone),
      defaultAccounts: drop(s.defaultAccounts) ?? [],
      projects: s.projects.map((p) => ({ ...p, accounts: drop(p.accounts) })),
    }
    broadcast({ type: 'settings', settings: store.settings })
    broadcast({ type: 'accounts', accounts: accounts.statuses() })
    broadcast({ type: 'usage', usage: usage.current() })
    return store.settings
  })
  ipcMain.handle('office:loginAccount', (_e, raw: unknown) => accounts.login(id(raw)))
  ipcMain.handle('office:setAccountPool', (_e, rawFloor: unknown, ids: unknown) => {
    const floorId = parse(floorIdSchema, rawFloor, 'Esse andar não existe mais.')
    const s = store.settings
    const pool = cleanAccountIds(ids, s.accounts)
    if (floorId === null) store.settings = { ...s, defaultAccounts: pool }
    else if (s.projects.some((p) => p.id === floorId)) store.settings = { ...s, projects: s.projects.map((p) => (p.id === floorId ? { ...p, accounts: pool.length ? pool : undefined } : p)) }
    else throw new Error('Esse andar não existe mais.')
    broadcast({ type: 'settings', settings: store.settings })
    return store.settings
  })
  ipcMain.handle('office:getLog', (_e, raw: unknown) => manager.getLog(id(raw)))
  // A permission mode outside the list falls back to the office default.
  ipcMain.handle('office:hire', (_e, req: unknown) => manager.hire(cleanHire(req, store.settings)))
  ipcMain.handle('office:summon', (_e, cwd: unknown, mode: unknown, brain: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Escolha uma pasta de projeto que exista.')
    const m = permissionModeSchema.safeParse(mode)
    const permissionMode = m.success ? m.data : store.settings.defaultPermissionMode
    return manager.summon(cwd, { ...defaultBrain(), ...cleanBrain(brain, store.settings.accounts), permissionMode })
  })
  ipcMain.handle('office:send', (_e, raw: unknown, text: unknown, attachments: unknown) =>
    manager.sendMessage(
      id(raw),
      parse(messageSchema, text, 'Mensagem grande demais. Mande em partes ou anexe como arquivo.'),
      undefined,
      parse(attachmentsSchema.optional(), attachments, 'Anexos inválidos.') ?? [],
    ),
  )
  ipcMain.handle('office:interrupt', (_e, raw: unknown) => manager.interrupt(id(raw)))
  ipcMain.handle('office:compact', (_e, raw: unknown) => manager.compact(id(raw)))
  ipcMain.handle('office:clearContext', (_e, raw: unknown) => manager.clearContext(id(raw)))
  ipcMain.handle('office:fire', (_e, raw: unknown) => manager.fire(id(raw)))
  ipcMain.handle('office:closeTerminal', (_e, raw: unknown) => bridge.closeSession(id(raw)))
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
      effort: defaultBrain().effort,
      permissionMode: store.settings.defaultPermissionMode,
    })
  })
  ipcMain.handle('office:openInTerminal', async (_e, sessionId: unknown) => {
    if (!isSessionId(sessionId)) return { ok: false, message: 'ID de sessão inválido.' }
    const entry = await sessionEntry(sessionId)
    if (!entry?.cwd) return { ok: false, message: 'Não sei em que pasta essa sessão rodava.' }
    return openInTerminal(sessionId, entry.cwd)
  })
  ipcMain.handle('office:respond', (_e, d: unknown) => manager.respond(parse(permissionDecisionSchema, d, 'Resposta inválida.')))
  ipcMain.handle('office:ackResult', (_e, raw: unknown) => {
    manager.ackResult(id(raw))
    updateBadge()
  })
  ipcMain.handle('office:pickFolder', async (_e, defaultPath?: unknown) => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Pasta do projeto',
      defaultPath: pathSchema.safeParse(defaultPath).success && existsSync(defaultPath as string) ? (defaultPath as string) : undefined,
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
  ipcMain.handle('office:saveSettings', (_e, patch: unknown) => {
    const before = JSON.stringify(store.settings.projects)
    const days = store.settings.ticketAutoCloseDays
    // Unknown keys are dropped; a bad value keeps the current one. The bridge port never changes here.
    store.settings = cleanSettings(patch, store.settings)
    const { projects, ticketAutoCloseDays } = store.settings
    broadcast({ type: 'settings', settings: store.settings })
    if (ticketAutoCloseDays !== days) board.autoClose(ticketAutoCloseDays)
    if (JSON.stringify(projects) !== before) {
      squads = readSquads()
      broadcast({ type: 'squads', squads })
      manager.relocate()
    }
    return store.settings
  })
  ipcMain.handle('office:createTicket', (_e, draft: unknown) => board.create(parse(ticketDraftSchema, draft, 'Ticket inválido.'), player()))
  ipcMain.handle('office:updateTicket', (_e, raw: unknown, patch: unknown) =>
    board.update(ticketId(raw), parse(ticketPatchSchema, patch, 'Ticket inválido.'), player()),
  )
  ipcMain.handle('office:moveTicket', (_e, raw: unknown, status: unknown, beforeId?: unknown) =>
    board.move(ticketId(raw), parse(ticketStatusSchema, status, 'Coluna inválida.'), beforeId ? ticketId(beforeId) : undefined, player()),
  )
  ipcMain.handle('office:commentTicket', (_e, raw: unknown, text: unknown) => {
    board.comment(ticketId(raw), parse(commentSchema, text, 'Comentário grande demais.'), player())
  })
  ipcMain.handle('office:deleteTicket', (_e, raw: unknown) => board.remove(ticketId(raw)))
  ipcMain.handle('office:closeTickets', (_e, ids?: unknown) => board.close(parse(ticketIdsSchema, ids, 'Tickets inválidos.'), player()))
  ipcMain.handle('office:listClosed', (_e, search?: unknown) => board.listClosed(searchSchema.parse(search)))
  ipcMain.handle('office:reopenTicket', (_e, raw: unknown) => board.reopen(ticketId(raw), player()))
  ipcMain.handle('office:assignTicket', (_e, raw: unknown, who: unknown) => {
    const t = board.assign(ticketId(raw), parse(assigneeSchema, who, 'Responsável inválido.') === 'me' ? player() : undefined, player())
    if (!t.assignee && t.status === 'doing') board.move(t.id, 'todo', undefined, player())
    else if (t.assignee && (t.status === 'backlog' || t.status === 'todo')) board.move(t.id, 'doing', undefined, player())
  })
  // A ticket may be written by someone else (or another agent): never run it with "bypass".
  ipcMain.handle('office:delegateTicket', (_e, raw: unknown, target: unknown) =>
    desk.delegate(ticketId(raw), cleanDelegateTarget(target, store.settings.accounts), player()),
  )
  ipcMain.handle('office:openExternal', (_e, url: unknown) => {
    // Only web links leave the app; file:// or custom schemes could run things.
    const link = externalUrlSchema.safeParse(url)
    if (link.success) return shell.openExternal(link.data)
  })
  ipcMain.handle('office:revealPath', (_e, p: unknown) => {
    const path = pathSchema.safeParse(p)
    if (path.success && existsSync(path.data)) shell.showItemInFolder(path.data)
  })
  ipcMain.handle('office:radioVideo', () => radioVideo())
  ipcMain.handle('office:listSquads', (_e, cwd: unknown) => (pathSchema.safeParse(cwd).success && isDir(cwd) ? loadSquads(cwd).map(squadInfo) : []))
  ipcMain.handle('office:runSquad', (_e, cwd: unknown, code: unknown, mode: unknown, note: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Essa pasta de squads não existe mais.')
    // Orchestrators work in the Diretoria of their project's floor.
    if (projectFor(store.settings.projects, cwd)?.cwd !== cwd) throw new Error('Crie um andar para esse projeto antes de contratar um squad.')
    const plain = squadCodeSchema.safeParse(code)
    const squad = plain.success ? findSquad(cwd, plain.data) : undefined
    if (!squad) throw new Error(`Não achei o squad ${plain.success ? plain.data : ''} em ${cwd}/squads.`)
    const extra = (squadNoteSchema.parse(note) ?? '').trim().slice(0, 2000)
    return manager.runSquad(
      squadInfo(squad),
      `Rode um ciclo do squad ${squad.name} (squads/${squad.code}), do primeiro passo do pipeline até o fim.${extra ? `\n\nRecado de ${store.settings.playerName}: ${extra}` : ''}`,
      `Rodar um ciclo de ${squad.icon} ${squad.name}${extra ? `\n\n${extra}` : ''}`,
      {
        ...defaultBrain(),
        // Same rule as tickets: a cycle reaches real systems, so it never runs with "bypass".
        permissionMode: delegateMode(mode),
      },
    )
  })
  // YouTube refuses embeds without a web Referer (error 153), and file:// sends none.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*'] }, (d, cb) => {
    cb({ requestHeaders: { ...d.requestHeaders, Referer: 'https://agent-office.local/' } })
  })

  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(here, '../../resources/icon.png'))
  win = createWindow()
  // Back from logging in on the terminal: check the logins again.
  let checkedAt = 0
  app.on('browser-window-focus', () => {
    if (!accounts.unsure() || Date.now() - checkedAt < 30000) return
    checkedAt = Date.now()
    void accounts.check().then(() => usage.refresh())
  })
  if (process.env.AGENT_OFFICE_DEMO === '1') startDemo(manager, squadDefs())
  if (process.env.AGENT_OFFICE_SEED) seedAgents(manager, process.env.AGENT_OFFICE_SEED)
  if (process.env.AGENT_OFFICE_SHOTS) captureShots(win, process.env.AGENT_OFFICE_SHOTS)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
  app.on('before-quit', () => {
    bridge.stop()
    usage.stop()
    stats.stop()
    system.stop()
    manager.shutdown()
    book.stop()
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
