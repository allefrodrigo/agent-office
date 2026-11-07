import { app, BrowserWindow, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { isMeetingLive, meetingElapsedMs, trayTitle, trayTooltip } from '@shared/meeting-tray'
import type { Meeting, OfficeEvent } from '@shared/types'
import { dotPixels, encodePng } from '../badge'
import { log } from '../log'
import { onQuit } from '../quit'

/**
 * Sala de reunião fora do app (RN-08): um ícone na barra de menus (bandeja no Windows) só enquanto
 * a reunião grava ou está pausada, com o tempo no título e o menu "Abrir a sala", "Pausar"/"Retomar"
 * e "Encerrar reunião". Pausar e encerrar seguem o mesmo caminho da tela (o gravador).
 * O ponto do Dock e o overlay da barra de tarefas leem meetingLive() em index.ts (updateBadge).
 */

export interface MeetingTrayDeps {
  /** A janela do escritório agora (null com ela fechada no macOS). */
  win(): BrowserWindow | null
  pause(id: string): unknown
  resume(id: string): unknown
  stop(id: string): Promise<unknown>
}

let live = false
const liveListeners = new Set<() => void>()

/** Uma reunião grava ou está pausada: o Dock mostra o ponto vermelho. */
export function meetingLive(): boolean {
  return live
}

/** Avisa quando meetingLive() muda; devolve a função que tira o aviso. */
export function onMeetingLiveChange(fn: () => void): () => void {
  liveListeners.add(fn)
  return () => liveListeners.delete(fn)
}

function setLive(on: boolean): void {
  if (live === on) return
  live = on
  for (const fn of liveListeners) {
    try {
      fn()
    } catch (err) {
      log.warn('Reunião: falha ao atualizar o Dock:', (err as Error).message)
    }
  }
}

const RED = [0xe5, 0x48, 0x4d] as const
const GREY = [0x8a, 0x8a, 0x8a] as const
const BLACK = [0, 0, 0] as const

/** Gravando: ponto vermelho. Pausada: ponto em modelo (o macOS pinta na cor da barra); cinza no Windows. */
function iconFor(paused: boolean): NativeImage {
  const template = paused && process.platform === 'darwin'
  const rgb = paused ? (template ? BLACK : GREY) : RED
  // 16 pt na barra de menus do macOS; 16 px na bandeja do Windows (32 px em telas 2×)
  const img = nativeImage.createFromBuffer(encodePng(16, 16, dotPixels(16, rgb)))
  img.addRepresentation({ scaleFactor: 2, buffer: encodePng(32, 32, dotPixels(32, rgb)) })
  if (template) img.setTemplateImage(true)
  return img
}

export class MeetingTray {
  private tray: Tray | null = null
  private meeting: Meeting | null = null
  /** Início da pausa em curso: ela só entra em meeting.pauses ao retomar. */
  private pausedSince: number | null = null
  private timer: NodeJS.Timeout | null = null
  private icons = new Map<boolean, NativeImage>()

  constructor(private deps: MeetingTrayDeps) {
    onQuit(() => this.destroy())
  }

  /** Cada meeting:upsert passa por aqui: mostra, atualiza ou tira o ícone. */
  update(m: Meeting): void {
    if (!isMeetingLive(m.status)) {
      if (this.meeting?.id === m.id) this.destroy()
      return
    }
    const prev = this.meeting?.id === m.id ? this.meeting : null
    if (m.status === 'paused') {
      if (prev?.status !== 'paused' || this.pausedSince === null) this.pausedSince = Date.now()
    } else this.pausedSince = null
    this.meeting = m
    try {
      if (!this.tray) {
        this.tray = new Tray(this.icon(m.status === 'paused'))
        // Windows: o clique esquerdo abre a sala; o direito, o menu (o macOS abre o menu nos dois).
        if (process.platform === 'win32') this.tray.on('click', () => this.open())
      } else if (prev?.status !== m.status) this.tray.setImage(this.icon(m.status === 'paused'))
      if (prev?.status !== m.status || prev.title !== m.title) this.tray.setContextMenu(this.menu(m))
      this.tick()
      this.timer ??= setInterval(() => this.tick(), 1000)
      setLive(true)
    } catch (err) {
      log.warn('Reunião: ícone da barra de menus não abriu:', (err as Error).message)
    }
  }

  /** Reunião encerrada ou app saindo: some o ícone e o ponto do Dock. */
  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tray?.destroy()
    this.tray = null
    this.meeting = null
    this.pausedSince = null
    setLive(false)
  }

  private icon(paused: boolean): NativeImage {
    let img = this.icons.get(paused)
    if (!img) {
      img = iconFor(paused)
      this.icons.set(paused, img)
    }
    return img
  }

  private tick(): void {
    const m = this.meeting
    if (!m || !this.tray) return
    const ms = meetingElapsedMs(m, Date.now(), this.pausedSince)
    const title = trayTitle(m.status, ms)
    if (process.platform === 'darwin') this.tray.setTitle(title, { fontType: 'monospacedDigit' })
    this.tray.setToolTip(trayTooltip(m.title, m.status, ms))
  }

  private menu(m: Meeting): Menu {
    const paused = m.status === 'paused'
    const act = (what: string, fn: () => unknown) => () => {
      try {
        const r = fn()
        if (r instanceof Promise) r.catch((err: unknown) => log.warn(`Reunião: ${what} pela barra de menus falhou:`, (err as Error).message))
      } catch (err) {
        log.warn(`Reunião: ${what} pela barra de menus falhou:`, (err as Error).message)
      }
    }
    return Menu.buildFromTemplate([
      { label: m.title, enabled: false },
      { type: 'separator' },
      { label: 'Abrir a sala', click: () => this.open() },
      paused ? { label: 'Retomar', click: act('retomar', () => this.deps.resume(m.id)) } : { label: 'Pausar', click: act('pausar', () => this.deps.pause(m.id)) },
      { type: 'separator' },
      { label: 'Encerrar reunião', click: act('encerrar', () => this.deps.stop(m.id)) },
    ])
  }

  /** Janela à frente e a tela da Sala de reunião aberta no andar da reunião. */
  private open(): void {
    const m = this.meeting
    if (!m) return
    const event: OfficeEvent = { type: 'meeting:open', floor: m.floor, meetingId: m.id }
    let w = this.deps.win()
    if (!w || w.isDestroyed()) {
      // Janela fechada (macOS): o 'activate' do index.ts abre outra; a sala abre quando a página carregar.
      app.emit('activate')
      w = this.deps.win() ?? BrowserWindow.getAllWindows()[0] ?? null
      if (!w) return
      const fresh = w
      fresh.webContents.once('did-finish-load', () => {
        if (!fresh.isDestroyed()) fresh.webContents.send('office:event', event)
      })
      return
    }
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
    if (process.platform === 'darwin') app.focus({ steal: true })
    w.webContents.send('office:event', event)
  }
}
