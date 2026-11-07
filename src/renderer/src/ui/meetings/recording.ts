import { meetingClock } from '@shared/meeting-map'
import { isLive, recordedMs } from '@shared/meeting-room'
import type { Meeting, MeetingCreateInput, MeetingStartResult, MeetingWarning, Segment } from '@shared/types/meetings'
import { MeetingCapture } from '../../meetings/capture'
import { setMeetingLive } from '../../meetings/live'
import { h, icon } from '../dom'
import { cleanError } from '../modals'
import { MicButton } from '../voice'

// A gravação em curso (uma por vez, no app inteiro) e a faixa de gravação da tela.
// A gravação vive fora da tela: fechar a sala com Esc não para a reunião.

/** Estado do áudio do computador, para o ponto ao lado do medidor "Outros". */
export type SystemState = 'on' | 'waiting' | 'silent' | 'off'

type Listener = () => void

const MIC_BLOCK = 'O microfone está gravando a reunião. O ditado volta quando ela encerrar.'

/** RMS (0 a 1) → 0 a 1 numa escala de dB, de -60 dB a 0 dB: a voz normal enche metade. */
export function meterLevel(rms: number): number {
  if (!(rms > 0)) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60))
}

class LiveRecording {
  meeting: Meeting | null = null
  start: MeetingStartResult | null = null
  /** Date.now() do começo da pausa em curso. */
  pausedSince: number | null = null
  systemState: SystemState = 'off'
  /** Nível do microfone (0 a 1), com queda lenta. */
  mic = 0
  /** Atividade do computador (0 a 1): acende a cada fala de "Outros" que chega e apaga devagar. */
  others = 0
  private capture: MeetingCapture | null = null
  private listeners = new Set<Listener>()
  private busy = false

  get id(): string | null {
    return this.meeting?.id ?? null
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /** Cria a reunião e começa a gravar: o main liga o whisper e o áudio do computador; aqui, o microfone. */
  async begin(input: MeetingCreateInput, onWarning: (message: string) => void): Promise<Meeting> {
    if (this.meeting || this.busy) throw new Error('Já há uma reunião gravando. Encerre-a antes de começar outra.')
    this.busy = true
    try {
      const created = await window.office.meetingCreate(input)
      this.meeting = created
      const r = await window.office.meetingStart(created.id)
      this.start = r
      this.meeting = r.meeting
      this.systemState = r.systemAudio === 'none' ? 'off' : 'on'
      if (r.micTrack) {
        MicButton.block(MIC_BLOCK)
        const id = created.id
        const capture = new MeetingCapture({
          mode: r.micTrack === 'sala' ? 'presencial' : 'remoto',
          send: (c) => (this.pausedSince ? false : window.office.meetingAudio({ id, track: c.track, seq: c.seq, pcm: c.pcm })),
          onLevel: (_t, rms) => {
            const v = this.pausedSince ? 0 : meterLevel(rms)
            this.mic = Math.max(v, this.mic * 0.7)
          },
          onError: (msg) => onWarning(msg),
        })
        this.capture = capture
        try {
          await capture.start()
        } catch (err) {
          this.capture = null
          MicButton.block(null)
          if (r.systemAudio === 'none') {
            await window.office.meetingStop(id).catch(() => undefined)
            this.reset()
            throw err
          }
          onWarning(`${cleanError(err)} A reunião segue só com o áudio do computador.`)
        }
      }
      this.publish()
      this.emit()
      return this.meeting
    } catch (err) {
      // Não começou: a reunião vazia sai da lista.
      if (this.meeting && !this.start) {
        await window.office.meetingDelete(this.meeting.id).catch(() => undefined)
        this.reset()
      }
      throw err
    } finally {
      this.busy = false
    }
  }

  async pause(): Promise<void> {
    if (!this.meeting) return
    this.apply(await window.office.meetingPause(this.meeting.id))
  }

  async resume(): Promise<void> {
    if (!this.meeting) return
    this.apply(await window.office.meetingResume(this.meeting.id))
  }

  /** Encerra: para o microfone já (o main esvazia a fila do whisper e manda os upserts). */
  async stop(): Promise<void> {
    if (!this.meeting) return
    const id = this.meeting.id
    await this.release()
    await window.office.meetingStop(id)
  }

  /** Cada meeting:upsert. Devolve true quando era a reunião gravando. */
  apply(m: Meeting): boolean {
    if (!this.meeting || m.id !== this.meeting.id) return false
    const was = this.meeting.status
    this.meeting = m
    if (m.status === 'paused' && was !== 'paused') this.pausedSince = Date.now()
    if (m.status !== 'paused') this.pausedSince = null
    if (!isLive(m.status)) {
      void this.release()
      this.reset()
      setMeetingLive(null)
    } else this.publish()
    this.emit()
    return true
  }

  /** Cada meeting:segment: a fala de "Outros" acende o medidor do computador. */
  segment(meetingId: string, s: Segment): void {
    if (meetingId !== this.meeting?.id || s.track !== 'outros') return
    this.others = 1
    if (this.systemState !== 'off') this.systemState = 'on'
  }

  /** Cada meeting:warning da reunião gravando: o ponto do computador muda de cor. */
  warning(w: MeetingWarning): void {
    if (w.meetingId !== this.meeting?.id) return
    if (w.kind === 'system-audio-waiting') this.systemState = 'waiting'
    else if (w.kind === 'system-audio-silent') this.systemState = 'silent'
    else if (w.kind === 'system-audio-failed' || w.kind === 'system-audio-lost') this.systemState = 'off'
    this.emit()
  }

  /** Um quadro dos medidores: os níveis caem devagar entre um bloco e outro. */
  decay(): void {
    this.mic *= 0.92
    this.others *= 0.97
  }

  elapsed(now = Date.now()): number {
    return this.meeting ? recordedMs(this.meeting, now, this.pausedSince) : 0
  }

  private publish(): void {
    const m = this.meeting
    if (m && isLive(m.status)) setMeetingLive({ floor: m.floor, startedAt: m.startedAt, paused: m.status === 'paused' })
  }

  private async release(): Promise<void> {
    const c = this.capture
    this.capture = null
    MicButton.block(null)
    if (c) await c.stop().catch(() => undefined)
  }

  private reset(): void {
    this.meeting = null
    this.start = null
    this.pausedSince = null
    this.systemState = 'off'
    this.mic = 0
    this.others = 0
  }
}

/** A gravação do app (uma por vez). */
export const liveRecording = new LiveRecording()

const BARS = 6

function meter(label: string, extra?: HTMLElement): { el: HTMLElement; set(v: number): void } {
  const bars = Array.from({ length: BARS }, () => h('i'))
  const el = h(
    'div',
    { class: 'mr-meter', role: 'meter', 'aria-label': `Nível: ${label}`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
    h('span', { class: 'mr-meter-label' }, label),
    extra ?? null,
    h('span', { class: 'mr-bars', 'aria-hidden': 'true' }, bars),
  )
  let last = -1
  return {
    el,
    set(v) {
      const n = Math.round(v * BARS)
      if (n === last) return
      last = n
      bars.forEach((b, i) => b.classList.toggle('on', i < n))
      el.setAttribute('aria-valuenow', String(Math.round(v * 100)))
    },
  }
}

const SYSTEM_TEXT: Record<SystemState, string> = {
  on: 'Áudio do computador ligado',
  waiting: 'Aguardando a permissão do macOS',
  silent: 'O computador está em silêncio',
  off: 'Sem áudio do computador',
}

/**
 * A faixa de gravação: tempo, medidores "Você" e "Outros", Pausar/Retomar e Encerrar.
 * Os medidores andam num requestAnimationFrame enquanto a faixa está na tela.
 */
export function recordingStrip(opts: { onError(msg: string): void; onStop(): void }): { el: HTMLElement; destroy(): void } {
  const r = liveRecording
  const dot = h('span', { class: 'mr-rec-dot', 'aria-hidden': 'true' })
  const clock = h('span', { class: 'mr-clock', role: 'timer', 'aria-label': 'Tempo gravado' }, '00:00')
  const state = h('span', { class: 'mr-rec-state' })
  const you = meter('Você')
  const sysDot = h('span', { class: 'mr-sys-dot' })
  const others = meter('Outros', sysDot)
  const pauseBtn = h('button', { class: 'btn', type: 'button' })
  const stopBtn = h(
    'button',
    { class: 'btn btn-danger-soft', type: 'button', title: 'Encerrar a reunião e terminar a transcrição' },
    icon('stop', 15),
    'Encerrar',
  )
  const el = h(
    'div',
    { class: 'mr-strip', role: 'group', 'aria-label': 'Gravação' },
    dot,
    clock,
    state,
    h('span', { class: 'mr-strip-meters' }, you.el, others.el),
    h('span', { class: 'mr-strip-actions' }, pauseBtn, stopBtn),
  )

  const act = async (fn: () => Promise<void>, btn: HTMLButtonElement) => {
    btn.disabled = true
    try {
      await fn()
    } catch (err) {
      opts.onError(cleanError(err))
    } finally {
      btn.disabled = false
      sync()
    }
  }
  pauseBtn.addEventListener('click', () => void act(() => (r.meeting?.status === 'paused' ? r.resume() : r.pause()), pauseBtn))
  stopBtn.addEventListener('click', () => {
    opts.onStop()
    void act(() => r.stop(), stopBtn)
  })

  let lastStatus = ''
  let lastSys = ''
  const sync = () => {
    const m = r.meeting
    const paused = m?.status === 'paused'
    const key = `${m?.status}`
    if (key !== lastStatus) {
      lastStatus = key
      el.classList.toggle('paused', paused)
      pauseBtn.replaceChildren(icon(paused ? 'play' : 'pause', 15), paused ? 'Retomar' : 'Pausar')
      pauseBtn.title = paused ? 'Continuar gravando a mesma reunião' : 'Parar a captura por um tempo'
      state.textContent = paused ? 'Em pausa' : 'Gravando'
    }
    const sys = r.start?.systemAudio === 'none' ? 'none' : r.systemState
    if (sys !== lastSys) {
      lastSys = sys
      others.el.hidden = sys === 'none'
      sysDot.className = `mr-sys-dot ${sys}`
      const text = sys === 'none' ? '' : SYSTEM_TEXT[sys as SystemState]
      sysDot.title = text
      others.el.title = `${text}. O medidor acende quando chega fala do computador.`
    }
  }

  let frame = 0
  let lastSec = -1
  const draw = () => {
    r.decay()
    you.set(r.mic)
    others.set(r.others)
    const sec = Math.floor(r.elapsed() / 1000)
    if (sec !== lastSec) {
      lastSec = sec
      clock.textContent = meetingClock(sec * 1000)
    }
    frame = requestAnimationFrame(draw)
  }
  const off = r.onChange(sync)
  sync()
  draw()
  return {
    el,
    destroy() {
      cancelAnimationFrame(frame)
      off()
    },
  }
}
