import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, powerMonitor, session, shell } from 'electron'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { permissionNotice } from '@shared/permission-notice'
import { projectFor } from '@shared/projects'
import type { Actor, AgentBrain, HireRequest, OfficeEvent, OfficeState, PermissionRequest } from '@shared/types'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { Accounts } from './accounts'
import { AgentManager } from './agents'
import { Bridge } from './bridge'
import { TicketDesk } from './delegate'
import { prepareStress, startDemo, startStress } from './demo'
import { CostBook } from './ledger'
import { flushOnExit, setupData } from './data'
import { dataNotices } from './fs-safe'
import { diagnostics, guardWindow, installFatalHandlers, onFatalFlush, rendererError } from './crash'
import { captureConsole, initLog, log, logDir, secret } from './log'
import { dropInheritedClaudeEnv, loadShellPath } from './env'
import { isSessionId, openInTerminal, recentSessions, sessionEntry, transcript } from './sessions'
import { findSquad, isDir, loadSquads, squadInfo } from './squads'
import { Store } from './store'
import { SystemMonitor } from './system'
import { StatsReader } from './stats'
import { UsageMonitor } from './usage'
import { TicketBoard } from './tickets'
import { cleanLook, cleanTemplate, loadTemplates, upsertTemplate } from './templates'
import { commitChanges, discardChanges, fileDiff, insideRoot, openInEditor, openPullRequest, pruneWorktrees, removeWorktree, repoRoot, worktreeFromPath, worktreeState } from './git'
import {
  accountNameSchema,
  changedPathSchema,
  commitMessageSchema,
  prTitleSchema,
  uuidSchema,
  worktreeFlagSchema,
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
  copyTextSchema,
  markdownFileName,
  saveMarkdownArgsSchema,
} from './validate'
import { Updater } from './updater'

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

/** Caminho real, symlinks resolvidos; para um arquivo que ainda não existe, vale a pasta existente mais próxima. */
function realPathOf(p: string): string {
  let head = p
  const tail: string[] = []
  while (!existsSync(head)) {
    const parent = dirname(head)
    if (parent === head) break
    tail.unshift(basename(head))
    head = parent
  }
  return [realpathSync(head), ...tail].join('/').replace(/^\/\//, '/')
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
    // Checked again here: the button exists only when allow is true.
    if (!notice.allow || (details.actionIndex ?? index) !== 0) return
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
  // A fatal error saves what is in memory before asking what to do.
  onFatalFlush(() => {
    store.flush()
    board.flush()
  })
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
      notifyPermission(store, manager, e.request, nameOf(e.request.agentId), manager.list().find((a) => a.id === e.request.agentId)?.cwd)
      if (process.platform === 'darwin' && !win?.isFocused()) app.dock?.bounce('informational')
    } else if (e.type === 'result:new') {
      notify(store, `${nameOf(e.result.agentId)} terminou`, e.result.text.slice(0, 140), { agentId: e.result.agentId, itemId: e.result.id })
    } else if (e.type === 'permission:resolved') dropNotice(e.requestId)
    else if (e.type === 'result:acked') dropNotice(e.resultId)
    if (e.type.startsWith('permission:') || e.type.startsWith('result:')) updateBadge()
  })

  board.on('event', broadcast)
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
    },
    broadcast,
  })
  updater.start()

  // Durable saves on kill, crash and sleep (AO-26); backups, restore, export and import (AO-25).
  const flushAll = () => {
    store.flush()
    board.flush()
  }
  flushOnExit({ flush: flushAll, stopAll: () => stopAll() })
  setupData({
    dataDir: app.getPath('userData'),
    win: () => win,
    broadcast,
    flush: flushAll,
    stopAll: () => stopAll(),
    lock: () => {
      store.lock()
      board.lock()
    },
  })

  // Worktrees whose folder was deleted by hand: git forgets them (`git worktree prune`).
  void pruneWorktrees([...store.settings.projects.map((p) => p.cwd), ...manager.list().flatMap((a) => (a.worktree ? [a.worktree.repo] : []))])

  // ---------- IPC ----------
  // Every argument from the renderer passes through validate.ts first.
  const id = (raw: unknown) => parse(idSchema, raw, 'ID inválido.')
  const ticketId = (raw: unknown) => parse(idSchema, raw, 'Esse ticket não existe mais.')
  ipcMain.on('office:rendererError', (e, payload: unknown) => {
    if (e.sender === win?.webContents) rendererError(payload)
  })
  ipcMain.handle('office:openLogs', async () => {
    const err = await shell.openPath(logDir())
    if (err) throw new Error(`Não consegui abrir a pasta de logs: ${err}`)
  })
  // Copied here, not in the page: the page's clipboard needs focus, and the text never passes through it.
  ipcMain.handle('office:copyDiagnostics', async () => {
    clipboard.writeText(await diagnostics())
  })
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
    dataNotices: dataNotices(),
    onBattery,
  }))
  ipcMain.handle('office:getLedger', (_e, q: unknown) => book.query(cleanLedgerQuery(q)))
  ipcMain.handle('office:refreshUsage', () => usage.refresh())
  ipcMain.handle('office:getStats', () => stats.current())
  ipcMain.handle('office:refreshStats', () => stats.refresh())
  ipcMain.handle('office:copyText', (_e, text: unknown) => {
    clipboard.writeText(parse(copyTextSchema, text, 'Não consegui copiar: o texto veio inválido.'))
  })
  ipcMain.handle('office:saveMarkdown', async (_e, ...args: unknown[]) => {
    const [fileName, content] = parse(saveMarkdownArgsSchema, args, 'Não consegui exportar: o conteúdo veio inválido.')
    const r = await dialog.showSaveDialog(win!, {
      title: 'Exportar em Markdown',
      defaultPath: join(app.getPath('documents'), markdownFileName(fileName)),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, content, 'utf8')
    return r.filePath
  })
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
  ipcMain.handle('office:hire', (_e, req: unknown) =>
    manager.hire({ ...cleanHire(req, store.settings), look: cleanLook((req as { look?: unknown } | null)?.look) }),
  )
  ipcMain.handle('office:summon', (_e, cwd: unknown, mode: unknown, brain: unknown, worktree: unknown) => {
    if (!pathSchema.safeParse(cwd).success || !isDir(cwd)) throw new Error('Escolha uma pasta de projeto que exista.')
    const m = permissionModeSchema.safeParse(mode)
    const permissionMode = m.success ? m.data : store.settings.defaultPermissionMode
    return manager.summon(cwd, { ...defaultBrain(), ...cleanBrain(brain, store.settings.accounts), permissionMode }, worktreeFlagSchema.parse(worktree))
  })
  ipcMain.handle('office:isGitRepo', async (_e, cwd: unknown) => {
    const p = pathSchema.safeParse(cwd)
    return p.success && isAbsolute(p.data) && isDir(p.data) && !!(await repoRoot(p.data))
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
  ipcMain.handle('office:closeTerminal', (_e, raw: unknown) => bridge.closeSession(id(raw)))

  // ---------- worktrees (AO-33) ----------
  // What the player chose in the native dialog of prepareFire. Only that dialog can
  // authorize removing a worktree: the renderer never sends "remove".
  const fireChoices = new Map<string, { remove: boolean; dirty: number }>()
  const agentId = (raw: unknown) => parse(uuidSchema, raw, 'Esse agente não está mais no escritório.')
  ipcMain.handle('office:prepareFire', async (_e, raw: unknown) => {
    const a = manager.agent(agentId(raw))
    const wt = a?.worktree
    if (!a || !wt) return 'plain'
    const st = await worktreeState(wt).catch(() => null)
    if (!st?.exists) {
      fireChoices.set(a.id, { remove: false, dirty: 0 })
      return 'plain'
    }
    const kept = st.ahead ? ` O branch tem ${st.ahead} commit${st.ahead > 1 ? 's' : ''} e fica no repositório mesmo se você remover a cópia.` : ''
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Manter a cópia', 'Remover a cópia', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      message: `Dispensar ${a.name}?`,
      detail:
        `A sessão para e o agente vai embora. Ele trabalhava numa cópia isolada (branch ${wt.branch}) em ${wt.root}.\n\n` +
        (st.dirty ? `A cópia tem ${st.dirty} arquivo${st.dirty > 1 ? 's' : ''} com mudanças não commitadas.` : 'A cópia não tem mudanças não commitadas.') +
        kept,
    })
    if (response === 2) return 'cancelled'
    if (response === 1 && st.dirty) {
      const sure = await dialog.showMessageBox(win!, {
        type: 'warning',
        buttons: ['Apagar e dispensar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        message: `Apagar ${st.dirty} mudança${st.dirty > 1 ? 's' : ''} não commitada${st.dirty > 1 ? 's' : ''}?`,
        detail: 'Não dá para desfazer. Para guardar o trabalho, cancele e use "Commitar" no cartão de resultado.',
      })
      if (sure.response !== 0) return 'cancelled'
    }
    fireChoices.set(a.id, { remove: response === 1, dirty: st.dirty })
    return 'confirmed'
  })
  ipcMain.handle('office:fire', async (_e, raw: unknown) => {
    const aid = id(raw)
    const wt = manager.agent(aid)?.worktree
    const choice = fireChoices.get(aid)
    fireChoices.delete(aid)
    manager.fire(aid)
    if (!wt) return
    if (!choice?.remove) return `A cópia isolada ficou em ${wt.root} (branch ${wt.branch}).`
    // Forced only when the player confirmed losing changes; anything newer than that keeps the copy.
    const now = await worktreeState(wt).catch(() => null)
    const force = !!choice.dirty && !!now && now.dirty <= choice.dirty
    return removeWorktree(wt, force).catch((err) => `Não consegui remover a cópia: ${err instanceof Error ? err.message : String(err)}`)
  })

  // ---------- result card: changed files (AO-34) ----------
  const changesFor = (raw: unknown) => {
    const r = manager.result(parse(uuidSchema, raw, 'Esse resultado já foi recebido.'))
    if (!r) throw new Error('Esse resultado já foi recebido.')
    if (!r.changes) throw new Error('Ainda não sei o que esse agente mudou.')
    return { r, c: r.changes }
  }
  ipcMain.handle('office:resultDiff', (_e, raw: unknown, path: unknown) => {
    const { c } = changesFor(raw)
    return fileDiff(c, parse(changedPathSchema, path, 'Caminho inválido.'))
  })
  ipcMain.handle('office:openResultInEditor', async (_e, raw: unknown, path: unknown) => {
    const { c } = changesFor(raw)
    const p = changedPathSchema.optional().safeParse(path)
    const file = p.success && p.data && c.files.some((f) => f.path === p.data) ? p.data : undefined
    if (await openInEditor(c.root, file)) return true
    // No Cursor or VS Code: show it in Finder. Never shell.openPath: the agent may have
    // written a .command or .app, and the default app would run it.
    const target = file ? insideRoot(c.root, file) : c.root
    if (target && existsSync(target)) shell.showItemInFolder(target)
    return false
  })
  ipcMain.handle('office:discardResult', async (_e, raw: unknown) => {
    const { r, c } = changesFor(raw)
    if (!c.git || c.committed || c.discarded) throw new Error('Não há mudanças para descartar aqui.')
    const n = c.files.filter((f) => f.restorable).length
    const { response } = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Descartar mudanças', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      message: `Descartar as mudanças de ${n} arquivo${n === 1 ? '' : 's'}?`,
      detail:
        `Os arquivos voltam a ser como eram quando ${nameOf(r.agentId)} começou a tarefa, em ${c.root}. Arquivos criados pela tarefa são apagados. ` +
        'Mudanças que você já tinha antes da tarefa ficam. Não dá para desfazer.',
    })
    if (response !== 0) return null
    const done = await discardChanges(c)
    const next = { ...c, discarded: true }
    manager.setChanges(r.id, next)
    if (done.skipped.length) dialog.showErrorBox('Alguns arquivos ficaram como estão', `Não deu para restaurar:\n${done.skipped.slice(0, 20).join('\n')}`)
    return next
  })
  ipcMain.handle('office:commitResult', async (_e, raw: unknown, message: unknown) => {
    const { r, c } = changesFor(raw)
    const msg = parse(commitMessageSchema, message, 'Escreva uma mensagem de commit (até 2000 caracteres).')
    if (!c.git || c.committed || c.discarded) throw new Error('Não há mudanças para commitar aqui.')
    const sha = await commitChanges(c, msg)
    const next = { ...c, committed: sha }
    manager.setChanges(r.id, next)
    return next
  })
  ipcMain.handle('office:openResultPR', async (_e, raw: unknown, title: unknown) => {
    const { r } = changesFor(raw)
    const wt = manager.agent(r.agentId)?.worktree
    if (!wt) throw new Error('Só dá para abrir PR de um agente que trabalha numa cópia isolada (worktree).')
    const t = parse(prTitleSchema, title, 'Escreva um título para o PR.')
    const { response } = await dialog.showMessageBox(win!, {
      type: 'question',
      buttons: ['Enviar e abrir PR', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: `Abrir um pull request do branch ${wt.branch}?`,
      detail: `Vamos rodar git push do branch para o remoto do repositório e gh pr create com o título "${t}" e o relatório do agente como descrição.`,
    })
    if (response !== 0) return null
    const body = `${r.text.slice(0, 6000)}\n\n---\nAberto pelo Agent Office (${nameOf(r.agentId)}, branch \`${wt.branch}\`).`
    return openPullRequest(wt, t, body)
  })
  ipcMain.handle('office:listSessions', () => recentSessions())
  ipcMain.handle('office:recall', async (_e, sessionId: unknown) => {
    if (!isSessionId(sessionId)) throw new Error('ID de sessão inválido.')
    const entry = await sessionEntry(sessionId)
    if (!entry) throw new Error('Não achei essa sessão no disco.')
    if (!entry.cwd || !existsSync(entry.cwd) || !statSync(entry.cwd).isDirectory()) {
      throw new Error(`A pasta dessa sessão não existe mais${entry.cwd ? `: ${entry.cwd}` : '.'}`)
    }
    const { log, model } = await transcript(sessionId).catch(() => ({ log: [], model: undefined }))
    // A session that ran in an agent's worktree comes back on the project's floor, in that copy.
    const isolated = await worktreeFromPath(entry.cwd)
    return manager.recall(
      sessionId,
      isolated?.cwd ?? entry.cwd,
      log,
      {
        // keep the model the conversation was using
        model: model ?? store.settings.defaultModel,
        effort: defaultBrain().effort,
        permissionMode: store.settings.defaultPermissionMode,
      },
      isolated?.worktree,
    )
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
  ipcMain.handle('office:saveTemplate', (_e, raw: unknown) => {
    const t = cleanTemplate(raw, store.settings.projects)
    store.settings = { ...store.settings, templates: upsertTemplate(store.settings.templates, t) }
    broadcast({ type: 'settings', settings: store.settings })
    return t
  })
  ipcMain.handle('office:deleteTemplate', (_e, raw: unknown) => {
    const templateId = id(raw)
    store.settings = { ...store.settings, templates: store.settings.templates.filter((t) => t.id !== templateId) }
    broadcast({ type: 'settings', settings: store.settings })
  })
  ipcMain.handle('office:saveSettings', (_e, patch: unknown) => {
    const before = JSON.stringify(store.settings.projects)
    const days = store.settings.ticketAutoCloseDays
    // Unknown keys are dropped; a bad value keeps the current one. The bridge port never changes here.
    const cleaned = cleanSettings(patch, store.settings)
    // Templates change only through saveTemplate/deleteTemplate; a removed floor turns its templates global.
    store.settings = { ...cleaned, templates: loadTemplates(store.settings.templates, cleaned.projects) }
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
  // Stress floors go in before the window asks for the state.
  const stress = process.env.AGENT_OFFICE_DEMO === 'stress' && prepareStress(store)
  if (stress) squads = readSquads()
  win = createWindow()
  // Back from logging in on the terminal: check the logins again.
  let checkedAt = 0
  app.on('browser-window-focus', () => {
    if (!accounts.unsure() || Date.now() - checkedAt < 30000) return
    checkedAt = Date.now()
    void accounts.check().then(() => usage.refresh())
  })
  if (process.env.AGENT_OFFICE_DEMO === '1') startDemo(manager, squadDefs())
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
    system.stop()
    manager.shutdown()
    book.stop()
    store.flush()
    board.flush()
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

/**
 * Dev helper: AGENT_OFFICE_SHOTS="out/shot:3000,8000" saves screenshots at those
 * times (ms after load) as out/shot-1.png, out/shot-2.png, then quits.
 * AGENT_OFFICE_EVAL runs a snippet in the page before each shot (e.g. to move the camera).
 * An entry `keys:N Enter Alt+Right =texto ;; js` first types real key presses (trusted,
 * with default actions: Enter clicks the focused button, Tab moves the focus), then runs
 * the js after `;;`. `=texto` types text (`_` is a space). Tests the app by keyboard (AO-38).
 */
function captureShots(w: BrowserWindow, spec: string): void {
  const [prefix, times] = spec.split(':')
  const delays = (times ?? '4000').split(',').map(Number)
  const evals = (process.env.AGENT_OFFICE_EVAL ?? '').split('|||')
  w.webContents.on('console-message', (e) => console.log('[renderer]', e.message))
  w.webContents.once('did-finish-load', () => {
    delays.forEach((ms, i) => {
      setTimeout(async () => {
        let js = evals[i] ?? ''
        if (js.trim().startsWith('keys:')) {
          const [keys, rest] = js.trim().slice(5).split(';;')
          await pressKeys(w, keys)
          js = rest ?? ''
        }
        if (js.trim()) {
          const out = await w.webContents.executeJavaScript(js).catch((e) => `eval failed: ${e}`)
          if (out !== undefined) console.log(`[shot ${i + 1}]`, typeof out === 'string' ? out : JSON.stringify(out))
        }
        await new Promise((r) => setTimeout(r, 400))
        try {
          const img = await w.webContents.capturePage()
          writeFileSync(`${prefix}-${i + 1}.png`, img.toPNG())
        } catch (err) {
          // The window is hidden, so the fatal-error dialog would wait forever: report and quit.
          console.error(`[shot ${i + 1}] falhou:`, err)
          app.exit(1)
          return
        }
        if (i === delays.length - 1) app.quit()
      }, ms)
    })
  })
}

type KeyModifier = 'shift' | 'alt' | 'meta' | 'control'
const KEY_MODIFIERS: Record<string, KeyModifier> = { shift: 'shift', alt: 'alt', meta: 'meta', cmd: 'meta', ctrl: 'control' }

/** Real key presses for AGENT_OFFICE_EVAL `keys:` entries, 120 ms apart. */
async function pressKeys(w: BrowserWindow, spec: string): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const press = (keyCode: string, modifiers: KeyModifier[] = []) => {
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    // Chromium clicks a focused button on Enter's char event (keypress), not on keydown.
    const char = keyCode === 'Enter' ? '\r' : keyCode.length === 1 ? keyCode : null
    if (char && modifiers.every((m) => m === 'shift')) w.webContents.sendInputEvent({ type: 'char', keyCode: char, modifiers })
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  for (const token of spec.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith('=')) {
      for (const ch of token.slice(1).replace(/_/g, ' ')) {
        press(ch)
        await wait(30)
      }
    } else {
      const parts = token.split('+')
      const key = parts.pop()!
      press(key, parts.map((m) => KEY_MODIFIERS[m.toLowerCase()]).filter(Boolean))
    }
    await wait(120)
  }
}

/**
 * Dev helper (`npm run bench`): AGENT_OFFICE_BENCH=out/bench.json waits for the office
 * to fill up, records the frames for AGENT_OFFICE_BENCH_S seconds (30 by default),
 * writes the report there and quits.
 */
function runBench(w: BrowserWindow, file: string): void {
  const seconds = Number(process.env.AGENT_OFFICE_BENCH_S) || 30
  const warmup = Number(process.env.AGENT_OFFICE_BENCH_WARMUP_S) || 8
  w.webContents.on('console-message', (e) => console.log('[renderer]', e.message))
  w.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const paced = process.env.AGENT_OFFICE_BENCH_LIVE === '1'
        const report = await w.webContents.executeJavaScript(`window.__perf.record(${seconds * 1000}, ${paced})`)
        const gpu = app.getGPUFeatureStatus()
        const out = {
          version: app.getVersion(),
          date: new Date().toISOString(),
          demo: process.env.AGENT_OFFICE_DEMO ?? '',
          paced,
          platform: `${process.platform}-${process.arch}`,
          electron: process.versions.electron,
          gpu,
          window: w.getContentSize(),
          ...report,
        }
        writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
        console.log(`bench: ${out.frames} frames, ${out.frameMs.mean} ms/frame (p95 ${out.frameMs.p95}), ${out.drawCalls.mean} draw calls -> ${file}`)
      } catch (err) {
        console.error('bench failed:', err)
        process.exitCode = 1
      }
      app.quit()
    }, warmup * 1000)
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
      manager.hire({ ...req, permissionMode: req.permissionMode ?? 'default' }).catch((err) => console.error('seed:', err))
    }, 2500 + i * 1500),
  )
}

/**
 * Dev helper (never in a packaged app): AGENT_OFFICE_CRASH=main|rejection|renderer|hang|page-error
 * breaks something 6 s after start, to check the error handling.
 */
function forceCrash(w: BrowserWindow, what: string): void {
  setTimeout(() => {
    log.warn(`AGENT_OFFICE_CRASH=${what}: quebrando de propósito`)
    if (what === 'main') throw new Error('Erro de teste no processo principal (AGENT_OFFICE_CRASH=main)')
    if (what === 'rejection') void Promise.reject(new Error('Rejeição de teste (AGENT_OFFICE_CRASH=rejection)'))
    if (what === 'renderer') w.webContents.forcefullyCrashRenderer()
    if (what === 'hang') {
      void w.webContents.executeJavaScript('for (;;) {}')
      // "unresponsive" comes from input the page does not answer: poke it like a mouse would.
      const poke = setInterval(() => (w.isDestroyed() ? clearInterval(poke) : w.webContents.sendInputEvent({ type: 'mouseMove', x: 100, y: 100 })), 500)
      setTimeout(() => clearInterval(poke), 30_000)
    }
    if (what === 'page-error') void w.webContents.executeJavaScript("setTimeout(() => { throw new Error('Erro de teste na janela') }); Promise.reject(new Error('Rejeição de teste na janela')); 1")
  }, 6000)
}
