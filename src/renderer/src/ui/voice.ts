import { autoStop, bandEdges, insertDictation, SETTLE_MS, SILENCE_STOP_MS, VOICE_MAX_SECONDS } from '@shared/voice'
import { h, icon } from './dom'
import { cleanError } from './modals/common'

/** Held at least this long, the button works as push-to-talk: letting go stops. A quicker click toggles. */
const HOLD_MS = 350
/** Shorter than this is a slip of the finger, not speech. */
const MIN_MS = 400
const MIME = 'audio/webm;codecs=opus'
/** Bars of the wave, mirrored around the middle one. */
const BARS = 19
/** Raw RMS of the mic above this counts as speech (quiet rooms sit near 0.003 with noise suppression). */
const SPEECH_RMS = 0.015

type Phase = 'idle' | 'asking' | 'recording' | 'transcribing' | 'error'
type StopReason = 'user' | 'cancel' | 'max' | 'silence' | 'nospeech'

/** An error stays up this long, then the tip goes away by itself. */
const ERROR_MS = 7000

/**
 * Modo voz: the mic beside the Send button of a text box. It records the microphone and
 * whisper-cli (the creative studio's) turns it into text on this machine; the text goes into
 * the box at the caret, ready to read and send. Hold to talk, or click to start and click
 * again (or go quiet) to stop. While it listens a tip over the button shows the voice's wave.
 */
export class MicButton {
  /** Only one mic records at a time, whichever box it sits in. */
  private static busy: MicButton | null = null
  /** Why every mic button is off (the meeting room holds the microphone); null = on. */
  private static blocked: string | null = null

  /**
   * Turns every mic button off (with the reason as the tip) or back on. The meeting room calls
   * this while it records, so dictation does not fight it for the microphone.
   */
  static block(reason: string | null): void {
    MicButton.blocked = reason
    if (reason) MicButton.busy?.close()
    for (const b of document.querySelectorAll<HTMLButtonElement>('button.mic-btn')) MicButton.applyBlock(b)
  }

  private static applyBlock(b: HTMLButtonElement): void {
    const reason = MicButton.blocked
    b.disabled = !!reason
    if (reason) {
      b.dataset.title ??= b.title
      b.title = reason
    } else if (b.dataset.title !== undefined) {
      b.title = b.dataset.title
      delete b.dataset.title
    }
  }
  readonly el: HTMLSpanElement
  private button: HTMLButtonElement
  private bars: HTMLSpanElement[]
  private tip: HTMLDivElement
  private status: HTMLSpanElement
  private meta: HTMLSpanElement
  private phase: Phase = 'idle'
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private audio: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private samples = new Float32Array(2048)
  private chunks: Blob[] = []
  private startedAt = 0
  private pressedAt = 0
  /** Last time the mic heard speech (0 = not yet). */
  private heardAt = 0
  /** Loudest RMS the animation saw since the last tick. */
  private peak = 0
  /** The pointer that started this recording is still down. */
  private holding = false
  private reason: StopReason = 'user'
  private tick = 0
  private frame = 0
  private hideTimer = 0

  /** `target` is the box the text goes into; `size` the icon size of the box's other buttons. */
  constructor(
    private target: HTMLTextAreaElement | HTMLInputElement,
    opts: { size?: number; small?: boolean } = {},
  ) {
    this.bars = Array.from({ length: BARS }, (_, i) => h('span', { style: `--i: ${i}` }))
    this.button = h(
      'button',
      {
        type: 'button',
        class: `btn btn-icon mic-btn${opts.small ? ' btn-small' : ''}`,
        title: 'Falar (segure para falar, ou clique para gravar e clique de novo para parar)',
        'aria-label': 'Ditar por voz: grava e transcreve com o whisper',
        'aria-pressed': 'false',
        onpointerdown: (e: Event) => this.press(e as PointerEvent),
        onpointerup: () => this.release(),
        onpointercancel: () => this.release(),
        // Enter or Space (no pointer): toggle.
        onclick: (e: Event) => (e as MouseEvent).detail === 0 && this.toggle(),
      },
      icon('mic', opts.size ?? 16),
    )
    this.status = h('span', { class: 'mic-status' })
    this.meta = h('span', { class: 'mic-meta' })
    this.tip = h(
      'div',
      { class: 'mic-tip hidden', role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'mic-wave', 'aria-hidden': 'true' }, this.bars),
      h('div', { class: 'mic-line' }, h('span', { class: 'mic-dot' }), this.status, h('button', { type: 'button', class: 'icon-btn mic-close', title: 'Fechar', 'aria-label': 'Fechar', onclick: () => this.close() }, icon('x', 12))),
      this.meta,
    )
    this.el = h('span', { class: 'mic' }, this.tip, this.button)
    if (MicButton.blocked) MicButton.applyBlock(this.button)
  }

  private press(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    if (this.phase === 'recording') return this.stop('user')
    if (this.phase === 'asking' || this.phase === 'transcribing') return
    if ((MicButton.busy && MicButton.busy !== this) || MicButton.blocked) return
    this.button.setPointerCapture(e.pointerId)
    this.pressedAt = performance.now()
    this.holding = true
    void this.start()
  }

  private release(): void {
    if (!this.holding) return
    this.holding = false
    if (this.phase !== 'recording') return
    if (performance.now() - this.pressedAt >= HOLD_MS) this.stop('user')
    // A quick click (or let go while macOS was asking for the microphone): it stays on until the next click or a silence.
    else this.status.textContent = 'Ouvindo… clique para parar'
  }

  private toggle(): void {
    if (this.phase === 'recording') this.stop('user')
    else if (this.phase !== 'asking' && this.phase !== 'transcribing' && !MicButton.blocked && (!MicButton.busy || MicButton.busy === this)) void this.start()
  }

  private async start(): Promise<void> {
    MicButton.busy = this
    this.set('asking', 'Pedindo o microfone…')
    try {
      if (!(await window.office.micAccess())) throw new Error('mic-denied')
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    } catch (err) {
      this.holding = false
      return this.fail(micError(err))
    }
    this.chunks = []
    this.reason = 'user'
    this.heardAt = 0
    this.peak = 0
    const rec = new MediaRecorder(this.stream, MediaRecorder.isTypeSupported(MIME) ? { mimeType: MIME } : undefined)
    rec.ondataavailable = (ev) => ev.data.size && this.chunks.push(ev.data)
    rec.onstop = () => void this.finish(rec.mimeType)
    this.recorder = rec
    rec.start()
    this.startedAt = performance.now()
    this.meter(this.stream)
    this.set('recording', this.holding ? 'Ouvindo… solte para transcrever' : 'Ouvindo… clique para parar')
    this.tick = window.setInterval(() => this.listen(), 250)
    window.addEventListener('keydown', this.onKey, true)
  }

  /** Four times a second: the clock, and whether the take should end by itself. */
  private listen(): void {
    const now = performance.now()
    // The animation pauses with the window in the background; sample here too.
    const level = Math.max(this.peak, this.rms())
    this.peak = 0
    if (level > SPEECH_RMS && now - this.startedAt > SETTLE_MS) this.heardAt = now
    const s = (now - this.startedAt) / 1000
    if (s >= VOICE_MAX_SECONDS) return this.stop('max')
    // Holding the button is the player saying when to stop.
    const auto = this.holding ? null : autoStop(now, this.startedAt, this.heardAt)
    if (auto) return this.stop(auto)
    this.meta.textContent = this.holding ? `${clock(s)} · Esc cancela` : `${clock(s)} · ${SILENCE_STOP_MS / 1000} s de silêncio encerra · Esc cancela`
  }

  /** Esc while recording throws the take away (and does not close the panel behind). */
  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || this.phase !== 'recording') return
    e.preventDefault()
    e.stopPropagation()
    this.stop('cancel')
  }

  private stop(reason: StopReason): void {
    if (this.recorder?.state !== 'recording') return
    this.reason = reason
    this.recorder.stop()
  }

  private async finish(mime: string): Promise<void> {
    const took = performance.now() - this.startedAt
    this.holding = false
    this.teardown()
    if (this.reason === 'cancel') return this.close()
    if (this.reason === 'nospeech') return this.fail('Não ouvi nada e parei sozinho. Fale mais perto do microfone e tente de novo.')
    if (took < MIN_MS) return this.fail('Curto demais. Segure o botão enquanto fala, ou clique uma vez para gravar e outra para parar.')
    this.set('transcribing', 'Transcrevendo com o whisper…')
    this.meta.textContent = `${clock(took / 1000)} de áudio`
    try {
      const bytes = new Uint8Array(await new Blob(this.chunks, { type: mime }).arrayBuffer())
      const d = await window.office.transcribe(bytes)
      this.chunks = []
      if (!d.text) return this.fail('Não ouvi nada. Fale mais perto do microfone e tente de novo.')
      this.write(d.text)
      this.close()
    } catch (err) {
      this.fail(cleanError(err))
    }
  }

  /** The text goes into the box at the caret, as if typed: the box resizes and keeps its draft. */
  private write(text: string): void {
    const t = this.target
    if (!t.isConnected) return
    const { value, caret } = insertDictation(t.value, t.selectionStart ?? t.value.length, t.selectionEnd ?? t.value.length, text)
    t.value = value
    t.dispatchEvent(new Event('input', { bubbles: true }))
    t.focus({ preventScroll: true })
    t.setSelectionRange(caret, caret)
  }

  /** Mic off, wave off, timers off; the take (chunks) stays until it is sent. */
  private teardown(): void {
    window.clearInterval(this.tick)
    cancelAnimationFrame(this.frame)
    window.removeEventListener('keydown', this.onKey, true)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.audio?.close()
    this.audio = null
    this.analyser = null
    this.recorder = null
    for (const bar of this.bars) bar.style.removeProperty('transform')
  }

  /**
   * The bars follow the voice as it sounds: each one is a slice of the spectrum, low pitches
   * in the middle and high ones at the ends, mirrored. They jump up and fall back slowly.
   */
  private meter(stream: MediaStream): void {
    this.audio = new AudioContext()
    void this.audio.resume()
    const analyser = this.audio.createAnalyser()
    analyser.fftSize = this.samples.length
    analyser.smoothingTimeConstant = 0.5
    analyser.minDecibels = -90
    analyser.maxDecibels = -25
    this.audio.createMediaStreamSource(stream).connect(analyser)
    this.analyser = analyser
    const half = Math.ceil(BARS / 2)
    const mid = Math.floor(BARS / 2)
    const edges = bandEdges(this.audio.sampleRate, analyser.fftSize, half)
    const spectrum = new Uint8Array(analyser.frequencyBinCount)
    const levels = new Float32Array(half)
    const draw = () => {
      analyser.getByteFrequencyData(spectrum)
      for (let k = 0; k < half; k++) {
        let top = 0
        for (let j = edges[k]; j < edges[k + 1]; j++) top = Math.max(top, spectrum[j] ?? 0)
        const v = top / 255
        levels[k] = v > levels[k] ? v : levels[k] * 0.86 + v * 0.14
      }
      this.bars.forEach((bar, i) => (bar.style.transform = `scaleY(${(0.14 + 0.86 * levels[Math.abs(i - mid)]).toFixed(3)})`))
      this.peak = Math.max(this.peak, this.rms())
      this.frame = requestAnimationFrame(draw)
    }
    draw()
  }

  /** Loudness of the last ~40 ms of the mic. */
  private rms(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const v of this.samples) sum += v * v
    return Math.sqrt(sum / this.samples.length)
  }

  private set(phase: Phase, status: string): void {
    window.clearTimeout(this.hideTimer)
    this.phase = phase
    this.el.dataset.phase = phase
    this.button.setAttribute('aria-pressed', String(phase === 'recording'))
    this.status.textContent = status
    this.meta.textContent = ''
    this.tip.classList.remove('hidden')
  }

  private fail(message: string): void {
    this.teardown()
    this.set('error', 'Não deu certo')
    this.meta.textContent = message
    if (MicButton.busy === this) MicButton.busy = null
    this.hideTimer = window.setTimeout(() => this.close(), ERROR_MS)
  }

  private close(): void {
    window.clearTimeout(this.hideTimer)
    if (this.phase === 'recording') {
      this.reason = 'cancel'
      this.recorder?.stop()
    }
    this.phase = 'idle'
    this.el.dataset.phase = 'idle'
    this.button.setAttribute('aria-pressed', 'false')
    this.tip.classList.add('hidden')
    if (MicButton.busy === this) MicButton.busy = null
  }
}

function clock(s: number): string {
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** What went wrong opening the microphone, in words the player can act on (also used by the meeting capture). */
export function micError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.message : ''
  if (name === 'mic-denied' || name === 'NotAllowedError')
    return 'O microfone está bloqueado para o Agent Office. Libere em Ajustes do Sistema › Privacidade e Segurança › Microfone e tente de novo.'
  if (name === 'NotFoundError') return 'Não achei nenhum microfone. Conecte um e tente de novo.'
  if (name === 'NotReadableError') return 'Outro app está usando o microfone. Feche-o e tente de novo.'
  return `Não consegui abrir o microfone: ${cleanError(err)}`
}
