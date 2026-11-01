import { autoStop, bandEdges, SETTLE_MS, SILENCE_STOP_MS, VOICE_MAX_SECONDS, type Dictation } from '@shared/voice'
import { h, icon } from './dom'
import { cleanError } from './modals/common'

/** Held at least this long, the button works as push-to-talk: letting go stops. A quicker click toggles. */
const HOLD_MS = 350
/** Shorter than this is a slip of the finger, not speech. */
const MIN_MS = 400
const MIME = 'audio/webm;codecs=opus'
/** Bars of the wave, mirrored around the middle one. */
const BARS = 23
/** Raw RMS of the mic above this counts as speech (quiet rooms sit near 0.003 with noise suppression). */
const SPEECH_RMS = 0.015

type Phase = 'idle' | 'asking' | 'recording' | 'transcribing' | 'done' | 'error'
type StopReason = 'user' | 'cancel' | 'max' | 'silence' | 'nospeech'

/**
 * Modo voz, first test: the round button at the bottom left records the microphone and
 * whisper-cli (the creative studio's) turns it into text on this machine. While it listens
 * the button opens into a pill whose bars follow the voice; the text shows in a card above.
 * Hold to talk, or click to start and click again (or go quiet) to stop.
 */
export class VoiceButton {
  readonly el: HTMLDivElement
  private button: HTMLButtonElement
  private bars: HTMLSpanElement[]
  private card: HTMLDivElement
  private status: HTMLSpanElement
  private text: HTMLParagraphElement
  private meta: HTMLSpanElement
  private actions: HTMLDivElement
  private phase: Phase = 'idle'
  private last: Dictation | null = null
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

  constructor(root: HTMLElement) {
    this.bars = Array.from({ length: BARS }, (_, i) => h('span', { style: `--i: ${i}` }))
    this.button = h(
      'button',
      {
        class: 'voice-btn',
        title: 'Modo voz (teste): segure para falar, ou clique para gravar e clique de novo para parar',
        'aria-label': 'Gravar a voz e transcrever com o whisper',
        'aria-pressed': 'false',
        onpointerdown: (e: Event) => this.press(e as PointerEvent),
        onpointerup: () => this.release(),
        onpointercancel: () => this.release(),
        // Enter or Space (no pointer): toggle.
        onclick: (e: Event) => (e as MouseEvent).detail === 0 && this.toggle(),
      },
      icon('mic', 22),
      h('span', { class: 'voice-wave', 'aria-hidden': 'true' }, this.bars),
    )
    this.status = h('span', { class: 'voice-status' })
    this.text = h('p', { class: 'voice-text' })
    this.meta = h('span', { class: 'voice-meta' })
    this.actions = h(
      'div',
      { class: 'voice-actions' },
      h('button', { class: 'icon-btn', title: 'Copiar o texto', 'aria-label': 'Copiar o texto', onclick: () => void this.copy() }, icon('copy', 14)),
      h('button', { class: 'icon-btn', title: 'Fechar', 'aria-label': 'Fechar', onclick: () => this.close() }, icon('x', 14)),
    )
    this.card = h(
      'div',
      { class: 'voice-card card hidden', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'voice-head' }, h('span', { class: 'voice-dot' }), this.status, this.actions),
      this.text,
      this.meta,
    )
    this.el = h('div', { class: 'voice' }, this.card, this.button)
    // Toasts and the radio card stack above the button and its card, whatever their height.
    new ResizeObserver(() => document.documentElement.style.setProperty('--voice-h', `${this.el.offsetHeight}px`)).observe(this.el)
    root.append(this.el)
  }

  private press(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    if (this.phase === 'recording') return this.stop('user')
    if (this.phase === 'asking' || this.phase === 'transcribing') return
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
    else if (this.phase !== 'asking' && this.phase !== 'transcribing') void this.start()
  }

  private async start(): Promise<void> {
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

  /** Esc while recording throws the take away. */
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
    const why = this.reason === 'silence' ? 'parou no silêncio' : this.reason === 'max' ? 'parou no limite' : ''
    this.set('transcribing', 'Transcrevendo com o whisper…')
    this.meta.textContent = [`${clock(took / 1000)} de áudio`, why].filter(Boolean).join(' · ')
    try {
      const bytes = new Uint8Array(await new Blob(this.chunks, { type: mime }).arrayBuffer())
      const d = await window.office.transcribe(bytes)
      this.chunks = []
      if (!d.text) return this.fail('Não ouvi nada. Fale mais perto do microfone e tente de novo.')
      this.last = d
      this.set('done', 'Transcrição')
      this.text.textContent = d.text
      this.meta.textContent = [d.lang, d.model.replace(/^ggml-|\.bin$/g, ''), `${(d.ms / 1000).toFixed(1).replace('.', ',')} s`, why].filter(Boolean).join(' · ')
    } catch (err) {
      this.fail(cleanError(err))
    }
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
    this.phase = phase
    this.el.dataset.phase = phase
    this.button.setAttribute('aria-pressed', String(phase === 'recording'))
    this.status.textContent = status
    this.text.textContent = ''
    this.meta.textContent = ''
    this.actions.classList.toggle('hidden', phase !== 'done' && phase !== 'error')
    this.actions.firstElementChild?.classList.toggle('hidden', phase !== 'done')
    this.card.classList.remove('hidden')
  }

  private fail(message: string): void {
    this.teardown()
    this.set('error', 'Não deu certo')
    this.text.textContent = message
  }

  private close(): void {
    this.phase = 'idle'
    this.el.dataset.phase = 'idle'
    this.button.setAttribute('aria-pressed', 'false')
    this.card.classList.add('hidden')
  }

  private async copy(): Promise<void> {
    if (!this.last) return
    await window.office.copyText(this.last.text)
    this.status.textContent = 'Copiado'
  }
}

function clock(s: number): string {
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function micError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.message : ''
  if (name === 'mic-denied' || name === 'NotAllowedError')
    return 'O microfone está bloqueado para o Agent Office. Libere em Ajustes do Sistema › Privacidade e Segurança › Microfone e tente de novo.'
  if (name === 'NotFoundError') return 'Não achei nenhum microfone. Conecte um e tente de novo.'
  if (name === 'NotReadableError') return 'Outro app está usando o microfone. Feche-o e tente de novo.'
  return `Não consegui abrir o microfone: ${cleanError(err)}`
}
