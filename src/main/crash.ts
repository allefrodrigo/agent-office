import { app, BrowserWindow, dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import { arch, release, type } from 'node:os'
import { findClaude } from './claude-path'
import { log, logDir, logFile, redact, tail } from './log'

/**
 * What keeps the app standing when something breaks: errors nobody caught in the
 * main process, a crashed or frozen page, and errors the page reports itself.
 * The agents live in the main process, so the page can reload without them noticing.
 */

let flushData: () => void = () => {}
let showing = false

/** Saves office.json and tickets.json right away; set once the stores exist. */
export function onFatalFlush(fn: () => void): void {
  flushData = fn
}

/** uncaughtException/unhandledRejection: log, save the data and tell the user instead of vanishing. */
export function installFatalHandlers(): void {
  process.on('uncaughtException', (err) => fatal('Erro não tratado no processo principal', err, false))
  process.on('unhandledRejection', (reason) => fatal('Promessa rejeitada sem tratamento', reason, true))
}

function fatal(what: string, err: unknown, recoverable: boolean): void {
  log.error(`${what}:`, err)
  let saved = true
  try {
    flushData()
  } catch (e) {
    saved = false
    log.error('Falha ao salvar os dados depois do erro:', e)
  }
  // One dialog at a time: an error loop must not stack windows.
  if (showing) return
  const message = 'O Agent Office encontrou um erro'
  // Only say the data is safe when the flush worked (AO-27).
  const after = saved
    ? 'Os dados foram salvos. O log tem os detalhes para investigar.'
    : 'Não consegui salvar os dados: o que mudou desde o último salvamento pode se perder. Reinicie o app e confira o log.'
  const detail = `${err instanceof Error ? err.message : String(err)}\n\n${after}`
  if (!app.isReady()) {
    dialog.showErrorBox(message, detail)
    app.exit(1)
    return
  }
  showing = true
  void ask(message, detail, recoverable).finally(() => (showing = false))
}

async function ask(message: string, detail: string, recoverable: boolean): Promise<void> {
  const buttons = recoverable ? ['Continuar', 'Reiniciar', 'Abrir log'] : ['Reiniciar', 'Abrir log', 'Sair']
  log.info('Diálogo de erro aberto')
  for (;;) {
    const opts = { type: 'error' as const, message, detail, buttons, defaultId: 0, cancelId: recoverable ? 0 : 2, noLink: true }
    // Attached to the window it is a sheet; on its own, macOS runs it modal and the agents' streams wait.
    const parent = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    const { response } = await (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts))
    const choice = buttons[response]
    if (choice === 'Abrir log') {
      openLog()
      continue
    }
    if (choice === 'Reiniciar') {
      log.info('Reiniciando depois do erro')
      app.relaunch()
      app.exit(0)
    } else if (choice === 'Sair') {
      app.exit(1)
    }
    return
  }
}

/** Opens the log file; without a log folder (it could not be made) there is nothing to open. */
function openLog(): void {
  const f = logFile()
  if (f) void shell.openPath(f)
}

const CRASH_WINDOW_MS = 60_000
const MAX_RELOADS = 3
const HANG_MS = 10_000

/**
 * A crashed page reloads by itself; a page frozen for 10 s is crashed on purpose
 * and then reloads. More than 3 crashes in a minute stops the loop and asks.
 */
export function guardWindow(w: BrowserWindow, load: (w: BrowserWindow) => void): void {
  const crashes: number[] = []
  let hang: NodeJS.Timeout | null = null
  const clearHang = () => {
    if (hang) clearTimeout(hang)
    hang = null
  }

  w.webContents.on('render-process-gone', (_e, details) => {
    clearHang()
    log.error(`Processo da janela caiu: ${details.reason} (código ${details.exitCode})`)
    if (details.reason === 'clean-exit' || w.isDestroyed()) return
    const now = Date.now()
    crashes.push(now)
    while (crashes.length && now - crashes[0] > CRASH_WINDOW_MS) crashes.shift()
    if (crashes.length > MAX_RELOADS) {
      log.error('A janela caiu várias vezes seguidas; parei de recarregar')
      void dialog
        .showMessageBox(w, {
          type: 'error',
          message: 'A janela do Agent Office caiu várias vezes',
          detail: 'Os agentes continuam trabalhando. Recarregue quando quiser ou abra o log para ver o que houve.',
          buttons: ['Recarregar', 'Abrir log'],
          noLink: true,
        })
        .then(({ response }) => {
          if (response === 1) openLog()
          crashes.length = 0
          if (!w.isDestroyed()) load(w)
        })
      return
    }
    log.info('Recarregando a janela; os agentes seguem rodando')
    load(w)
  })

  w.on('unresponsive', () => {
    log.warn('A janela parou de responder')
    if (hang) return
    hang = setTimeout(() => {
      hang = null
      if (w.isDestroyed()) return
      log.error(`A janela ficou travada por ${HANG_MS / 1000} s; reiniciando o processo dela`)
      w.webContents.forcefullyCrashRenderer()
    }, HANG_MS)
  })
  w.on('responsive', () => {
    if (!hang) return
    clearHang()
    log.info('A janela voltou a responder')
  })
}

const MAX_RENDERER_ERRORS = 30
let rendererErrors: number[] = []

/**
 * An error the page reports (window.onerror / unhandledrejection). The payload
 * comes from the page, so only short strings pass, and at most 30 a minute.
 */
export function rendererError(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const r = raw as Record<string, unknown>
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  const kind = r.kind === 'rejection' ? 'rejection' : 'error'
  const message = str(r.message, 2000)
  if (!message) return
  const now = Date.now()
  rendererErrors = rendererErrors.filter((t) => now - t < 60_000)
  if (rendererErrors.length >= MAX_RENDERER_ERRORS) return
  rendererErrors.push(now)
  const where = str(r.source, 300)
  const stack = str(r.stack, 6000)
  log.error(`Janela (${kind}): ${message}${where ? ` @ ${where}` : ''}${stack ? `\n${stack}` : ''}`)
}

/** Version, OS, Claude Code version and the last 200 log lines, ready to paste in a bug report. */
export async function diagnostics(): Promise<string> {
  const claude = findClaude()
  const claudeVersion = claude
    ? await new Promise<string>((resolve) =>
        execFile(claude, ['--version'], { timeout: 5000 }, (err, out) => resolve(err ? `erro: ${err.message}` : out.trim())),
      )
    : 'não encontrado'
  const lines = [
    `Agent Office ${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}`,
    `Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · Node ${process.versions.node}`,
    `Sistema: ${type()} ${release()} ${arch()} (${process.platform})`,
    `Claude Code: ${claudeVersion}`,
    `Logs: ${logDir()}`,
    '',
    '--- últimas 200 linhas do log ---',
    ...tail(200),
  ]
  return redact(lines.join('\n'))
}
