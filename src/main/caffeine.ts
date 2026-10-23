import { powerSaveBlocker } from 'electron'
import type { CaffeineMode } from '@shared/types'
import { log } from './log'

/**
 * The café corner: keeps the screen (and the computer) awake with Electron's
 * powerSaveBlocker, the same thing `caffeinate -d` does, on macOS and Windows.
 * 'agents' holds it only while some agent works; 'on' always; 'off' never.
 */
export class Caffeine {
  private blocker: number | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private deps: {
      mode: () => CaffeineMode
      /** Agents working or waiting for you right now. */
      working: () => number
      changed: (awake: boolean) => void
    },
  ) {}

  get awake(): boolean {
    return this.blocker !== null && powerSaveBlocker.isStarted(this.blocker)
  }

  start(): void {
    this.check()
    // Agent status changes come as events; this catches anything they miss.
    this.timer = setInterval(() => this.check(), 5000)
    this.timer.unref()
  }

  /** Holds or lets go, from the mode and the agents now. */
  check(): void {
    const mode = this.deps.mode()
    const want = mode === 'on' || (mode === 'agents' && this.deps.working() > 0)
    if (want === this.awake) return
    if (want) {
      this.blocker = powerSaveBlocker.start('prevent-display-sleep')
      log.info('Café: tela acordada')
    } else {
      if (this.blocker !== null) powerSaveBlocker.stop(this.blocker)
      this.blocker = null
      log.info('Café: tela livre para apagar')
    }
    this.deps.changed(this.awake)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.blocker !== null) powerSaveBlocker.stop(this.blocker)
    this.blocker = null
  }
}
