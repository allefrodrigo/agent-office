import { app, dialog, type BrowserWindow } from 'electron'
import type { AgentSummary, BgProcess, QuitWait } from '@shared/types'
import { log } from './log'

export interface QuitDeps {
  win: () => BrowserWindow | null
  /** Office agents working right now (terminal sessions are the terminal's to close). */
  working: () => AgentSummary[]
  /** Permission requests still waiting for you. */
  pending: () => number
  interrupt: (agentId: string) => Promise<void>
  /** What the office agents left running, plus the orphans (Bastidores). */
  background: () => BgProcess[]
  stopProcess: (id: string) => Promise<unknown>
  /** No new routine runs while the app waits to leave. */
  holdRoutines: (hold: boolean) => void
  broadcast: (wait: QuitWait | null) => void
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Resolves when `p` settles or after `ms`, whichever comes first. */
const settle = (p: Promise<unknown>, ms: number) => Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, ms))])

/**
 * Leaving the office on purpose: the "Sair" button, ⌘Q or closing the window on Windows.
 * Asks first, then either waits for the agents to finish, interrupts them (each
 * conversation stays saved and comes back on the next start) or stays. Background
 * processes of the agents can go too. Only then does before-quit run the usual stopAll.
 */
export class QuitFlow {
  private allowed = false
  private asking = false
  private wait: { stopBg: boolean; timer: NodeJS.Timeout } | null = null

  constructor(private deps: QuitDeps) {}

  /** Lets the next quit through without asking (the updater installing, a data restore). */
  allow(): void {
    this.allowed = true
  }

  /**
   * before-quit: true = hold the quit and ask. A plain quit (⌘Q) with nobody working
   * goes through as it always did; the Sair button always asks.
   */
  intercept(): boolean {
    if (this.allowed) return false
    if (!this.deps.working().length && !this.deps.pending()) return false
    void this.ask()
    return true
  }

  async ask(): Promise<'quit' | 'waiting' | 'cancelled'> {
    if (this.asking) return 'cancelled'
    this.asking = true
    try {
      return await this.dialog()
    } finally {
      this.asking = false
    }
  }

  private async dialog(): Promise<'quit' | 'waiting' | 'cancelled'> {
    const working = this.deps.working()
    const pending = this.deps.pending()
    const bg = this.deps.background()
    const win = this.deps.win()
    const checkboxLabel = bg.length
      ? `Parar também ${plural(bg.length, 'processo em segundo plano', 'processos em segundo plano')} dos agentes (servidores, vigias)`
      : undefined
    const box = (opts: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))

    if (!working.length && !pending) {
      const r = await box({
        type: 'question',
        buttons: ['Sair', 'Cancelar'],
        defaultId: 0,
        cancelId: 1,
        message: 'Sair do Agent Office?',
        detail: 'Os agentes ficam salvos e voltam quando você abrir de novo, com a conversa onde parou.',
        checkboxLabel,
        checkboxChecked: true,
      })
      if (r.response !== 0) return 'cancelled'
      await this.leave(r.checkboxChecked && bg.length > 0)
      return 'quit'
    }

    const who = working.map((a) => `• ${a.name}: ${a.activity || 'trabalhando'}`).join('\n')
    const waits = pending ? `\n\n${plural(pending, 'pedido de permissão espera', 'pedidos de permissão esperam')} você.` : ''
    const r = await box({
      type: 'warning',
      buttons: ['Esperar terminarem e sair', 'Interromper e sair', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      message: working.length
        ? `${plural(working.length, 'agente está trabalhando', 'agentes estão trabalhando')}`
        : 'Tem pedido esperando você',
      detail:
        `${who}${waits}\n\n` +
        'Esperar: o app sai sozinho quando o último terminar, e nenhuma rotina nova começa até lá.\n' +
        'Interromper: cada agente para onde está. A conversa fica salva; quando você voltar, é só pedir para continuar.',
      checkboxLabel,
      checkboxChecked: true,
    })
    const stopBg = r.checkboxChecked && bg.length > 0
    if (r.response === 2) return 'cancelled'
    if (r.response === 1) {
      await this.interruptAll()
      await this.leave(stopBg)
      return 'quit'
    }
    this.startWaiting(stopBg)
    return 'waiting'
  }

  private startWaiting(stopBg: boolean): void {
    this.cancelWait()
    this.deps.holdRoutines(true)
    log.info('Saindo quando os agentes terminarem')
    const tick = () => {
      const working = this.deps.working().length
      const pending = this.deps.pending()
      if (!working && !pending) {
        void this.leave(stopBg)
        return
      }
      this.deps.broadcast({ working, pending })
    }
    this.wait = { stopBg, timer: setInterval(tick, 2000) }
    tick()
  }

  /** "Ficar" on the banner: the app goes on as before. */
  cancelWait(): void {
    if (!this.wait) return
    clearInterval(this.wait.timer)
    this.wait = null
    this.deps.holdRoutines(false)
    this.deps.broadcast(null)
    log.info('Saída cancelada')
  }

  /** "Interromper e sair agora" on the banner. */
  async now(): Promise<void> {
    const stopBg = this.wait?.stopBg ?? false
    await this.interruptAll()
    await this.leave(stopBg)
  }

  private async interruptAll(): Promise<void> {
    const working = this.deps.working()
    if (!working.length) return
    log.info(`Interrompendo ${working.length} agente(s) para sair`)
    await settle(Promise.all(working.map((a) => this.deps.interrupt(a.id))), 5000)
  }

  private async leave(stopBg: boolean): Promise<void> {
    if (this.wait) clearInterval(this.wait.timer)
    this.wait = null
    if (stopBg) {
      const bg = this.deps.background()
      log.info(`Parando ${bg.length} processo(s) em segundo plano antes de sair`)
      await settle(Promise.all(bg.map((p) => this.deps.stopProcess(p.id))), 5000)
    }
    this.allowed = true
    // before-quit runs stopAll: sessions closed, everything written to disk.
    app.quit()
  }
}
