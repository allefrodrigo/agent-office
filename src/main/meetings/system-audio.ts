import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { release } from 'node:os'
import { app } from 'electron'
import {
  buildSystemAudioArgs,
  LineSplitter,
  parseStatusLine,
  SYSTEM_AUDIO_KILL_AFTER_MS,
  SYSTEM_AUDIO_PERMISSION_HINT_MS,
  SYSTEM_AUDIO_READY_TIMEOUT_MS,
  systemAudioBinPath,
  systemAudioSupported,
  type SystemAudioEvent,
  type SystemAudioStatus,
} from '@shared/system-audio'
import { log } from '../log'
import { onQuit } from '../quit'

export interface SystemAudioStartOptions {
  /** Kept out of the tap with their direct children: the app's main and helper PIDs, so its own TTS and radio do not echo. */
  excludePids?: readonly number[]
  /** Stops by itself after this much audio (tests, smoke runs). */
  seconds?: number
  /** 16 kHz mono s16le, in whatever chunk sizes the pipe delivers (not sample aligned). */
  onPcm: (chunk: Buffer) => void
  onStatus?: (ev: SystemAudioStatus) => void
}

export interface SystemAudioCaptureOptions {
  /** The helper; by default resources/bin (dev) or Contents/Resources/bin (packaged). */
  binPath?: string
  platform?: string
  /** os.release(), the Darwin version. */
  osRelease?: string
  permissionHintMs?: number
  readyTimeoutMs?: number
  killAfterMs?: number
}

/**
 * The meeting room's "outros" track on macOS (ADR 0011): runs the Swift helper that taps
 * the system audio, hands its PCM to onPcm and its stderr status to onStatus.
 * One helper per meeting; start again after stop for the next one.
 *
 * The helper never outlives the app: stop() on the way out (onQuit), SIGKILL if SIGTERM
 * is ignored, and the helper leaves by itself when its stdin closes (the app crashed).
 */
export class SystemAudioCapture {
  private child: ChildProcess | null = null
  private exited: Promise<void> = Promise.resolve()
  private unhook: (() => void) | null = null

  constructor(private opts: SystemAudioCaptureOptions = {}) {}

  supported(): boolean {
    return systemAudioSupported(this.opts.platform ?? process.platform, this.opts.osRelease ?? release())
  }

  binPath(): string {
    return this.opts.binPath ?? systemAudioBinPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
  }

  get running(): boolean {
    return this.child !== null
  }

  /**
   * Starts the helper and resolves once the tap runs. The first run may wait on the macOS
   * permission prompt: after ~2 s onStatus gets 'waiting-permission', and the start gives up
   * after ~45 s. Rejects with a message for the user (what to do next).
   */
  start(o: SystemAudioStartOptions): Promise<void> {
    if (this.child) return Promise.reject(new Error('O áudio do sistema já está sendo gravado.'))
    if (!this.supported()) {
      return Promise.reject(new Error('Gravar o áudio do sistema precisa do macOS 14.2 ou mais novo. Grave só o microfone ou use o BlackHole.'))
    }
    const bin = this.binPath()
    if (!existsSync(bin)) {
      return Promise.reject(new Error('O ajudante de áudio do sistema não foi encontrado. Rode "npm run native" e tente de novo.'))
    }

    const startedAt = Date.now()
    const emit = (ev: SystemAudioStatus) => {
      try {
        o.onStatus?.(ev)
      } catch (err) {
        log.error('Áudio do sistema: falha no onStatus:', err)
      }
    }
    // Spawned directly, no shell: argv is only flags and validated PIDs. A bare environment, the helper needs none of ours.
    const child = spawn(bin, buildSystemAudioArgs({ excludePids: o.excludePids, seconds: o.seconds }), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
    })
    this.child = child
    this.unhook = onQuit(() => this.kill())
    let markExited: () => void = () => undefined
    this.exited = new Promise((r) => (markExited = r))

    return new Promise<void>((resolve, reject) => {
      let ready = false
      let lastError: SystemAudioEvent | null = null
      let silenceLogged = false
      const timers: NodeJS.Timeout[] = []
      const clearTimers = () => timers.splice(0).forEach(clearTimeout)
      const fail = (err: Error) => {
        clearTimers()
        if (!ready) reject(err)
      }

      timers.push(
        setTimeout(() => {
          if (!ready) emit({ event: 'waiting-permission' })
        }, this.opts.permissionHintMs ?? SYSTEM_AUDIO_PERMISSION_HINT_MS),
        setTimeout(() => {
          if (ready) return
          log.warn(`Áudio do sistema: sem resposta em ${Date.now() - startedAt} ms, desistindo`)
          fail(new Error('O macOS não liberou o áudio do sistema a tempo. Libere em Ajustes > Privacidade e Segurança > Gravação de Tela e Áudio do Sistema e tente de novo.'))
          void this.stop()
        }, this.opts.readyTimeoutMs ?? SYSTEM_AUDIO_READY_TIMEOUT_MS),
      )

      const onEvent = (ev: SystemAudioEvent) => {
        if (ev.event === 'ready' && !ready) {
          ready = true
          clearTimers()
          log.info(`Áudio do sistema: pronto em ${ev.startupMs} ms, ${ev.excluded} processo(s) fora da captura`)
          resolve()
        } else if (ev.event === 'error') {
          lastError = ev
          log.warn(`Áudio do sistema: erro em ${ev.step} (OSStatus ${ev.osstatus})`)
        } else if (ev.event === 'warning' && !silenceLogged) {
          silenceLogged = true
          log.warn(`Áudio do sistema: aviso ${ev.kind} após ${ev.seconds} s`)
        } else if (ev.event === 'summary') {
          log.info(`Áudio do sistema: parou (${ev.reason}), ${ev.outSeconds} s gravados, ${ev.zeroSeconds} s em silêncio total`)
        }
        emit(ev)
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        try {
          o.onPcm(chunk)
        } catch (err) {
          log.error('Áudio do sistema: falha no onPcm:', err)
        }
      })
      const lines = new LineSplitter()
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        for (const line of lines.push(chunk)) {
          const ev = parseStatusLine(line)
          if (ev) onEvent(ev)
        }
      })
      // EPIPE when the helper is already gone: the exit handler reports it.
      child.stdin?.on('error', () => undefined)

      child.on('error', (err: NodeJS.ErrnoException) => {
        log.error(`Áudio do sistema: não abriu (${err.code ?? 'erro'})`)
        fail(new Error('Não deu para abrir o ajudante de áudio do sistema. Rode "npm run native" e tente de novo.'))
      })
      child.on('close', (code, signal) => {
        for (const line of lines.end()) {
          const ev = parseStatusLine(line)
          if (ev) onEvent(ev)
        }
        if (this.child === child) this.child = null
        this.unhook?.()
        this.unhook = null
        log.info(`Áudio do sistema: ajudante saiu (código ${code ?? '-'}, sinal ${signal ?? '-'}) após ${Date.now() - startedAt} ms`)
        emit({ event: 'exit', code, signal })
        markExited()
        const why = lastError
        fail(
          new Error(
            why?.event === 'error'
              ? `O áudio do sistema falhou ao iniciar (${why.step}, OSStatus ${why.osstatus}). Confira a permissão em Ajustes > Privacidade e Segurança > Gravação de Tela e Áudio do Sistema e tente de novo.`
              : 'O ajudante de áudio do sistema fechou antes de começar. Tente de novo.',
          ),
        )
      })
    })
  }

  /** Stops the helper: SIGTERM (it tears the tap down), SIGKILL if it is still there after ~2 s. */
  async stop(): Promise<void> {
    const child = this.child
    if (!child) return this.exited
    this.kill()
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        log.warn('Áudio do sistema: o ajudante não saiu com SIGTERM, forçando')
        child.kill('SIGKILL')
      }
    }, this.opts.killAfterMs ?? SYSTEM_AUDIO_KILL_AFTER_MS)
    await this.exited
    clearTimeout(force)
  }

  /** Synchronous, for the way out: asks the helper to leave and closes its stdin. */
  private kill(): void {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    child.stdin?.end()
  }
}
