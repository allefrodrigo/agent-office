import { blockLevel, BLOCK_SAMPLES, PcmBatcher } from '@shared/meeting-pcm'
import { SAMPLE_RATE } from '@shared/meeting-audio'
import type { Track } from '@shared/types/meetings'
import { bandEdges } from '@shared/voice'
import { micError } from '../ui/voice'
import type { PcmBlockMessage } from './pcm-worklet'
// `?worker&url`: o Vite compila o worklet (TS + o reamostrador de @shared) num arquivo próprio em
// out/renderer/assets e devolve a URL. Arquivo do próprio app, então passa na CSP script-src 'self'.
import workletUrl from './pcm-worklet.ts?worker&url'

// Captura da sala de reunião no renderer: só o microfone (no macOS o áudio do sistema vem do
// ajudante Swift, pelo main). O worklet pcm16k entrega blocos de 100 ms a 16 kHz; aqui eles viram
// pedaços de 1 s para o `send` (o IPC entra no RN-06). Docs: docs/prd/sala-de-reuniao.md.

/** remoto: microfone com cancelamento de eco (faixa `eu`); presencial: a sala inteira, sem cancelamento (faixa `sala`). */
export type CaptureMode = 'remoto' | 'presencial'

/** Um pedaço de 1 s (o último pode ser menor) para o `office:meetingAudio`. */
export interface CaptureChunk {
  track: Track
  /** Sequencial do pedaço na faixa, de 0. */
  seq: number
  /** Int16 mono a 16 kHz. */
  pcm: Int16Array
}

/** Um trecho em que a captura não ouviu o microfone. */
export interface CaptureGap {
  track: Track
  /** Seq do pedaço onde o trecho cai. */
  seq: number
  /** Duração aproximada; na troca de microfone o worklet preenche com silêncio, sem encolher a linha do tempo. */
  ms: number
  /** device: microfone trocado ou desligado e reaberto; blocks: blocos do worklet pulados. */
  reason: 'device' | 'blocks'
}

export interface MeetingCaptureOptions {
  mode: CaptureMode
  /** Recebe cada pedaço de 1 s; disparado pela chegada dos blocos do worklet, não por timer. */
  send: (chunk: CaptureChunk) => unknown
  /** Nível (RMS de 0 a 1) a cada bloco de 100 ms: o medidor da faixa. */
  onLevel?: (track: Track, rms: number) => void
  onGap?: (gap: CaptureGap) => void
  /** Algo deu errado sem parar a captura (envio falhou, microfone não reabriu). Texto para a pessoa. */
  onError?: (message: string) => void
  /** Microfone escolhido; ausente = o padrão do sistema. */
  deviceId?: string
}

/** Espera depois do `devicechange`: o evento vem em rajadas quando um fone conecta. */
const DEVICE_SETTLE_MS = 300

/**
 * Abre o microfone, passa pelo worklet pcm16k e entrega pedaços de 1 s ao `send`.
 * Reabre o microfone quando ele muda (`devicechange`) ou cai (`ended`), avisando o buraco.
 * Dev: com AGENT_OFFICE_MEETING_WAV, toca o WAV pelo mesmo caminho (em loop) no lugar do microfone.
 */
export class MeetingCapture {
  readonly track: Track
  private readonly opts: MeetingCaptureOptions
  private readonly batcher = new PcmBatcher()
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private analyser: AnalyserNode | null = null
  private source: AudioNode | null = null
  private stream: MediaStream | null = null
  private wav = false
  private stopped = false
  private reopening = false
  private settle = 0
  private spectrum = new Uint8Array(0)

  constructor(opts: MeetingCaptureOptions) {
    this.opts = opts
    this.track = opts.mode === 'presencial' ? 'sala' : 'eu'
  }

  /** Veio de um WAV (AGENT_OFFICE_MEETING_WAV), não do microfone. */
  get fromWav(): boolean {
    return this.wav
  }

  /** Abre tudo. Erro com texto para a pessoa se o microfone não abrir. */
  async start(): Promise<void> {
    if (this.ctx) throw new Error('A captura já começou.')
    const wav = await window.office.devMeetingWav().catch(() => null)
    const ctx = new AudioContext()
    this.ctx = ctx
    try {
      await ctx.audioWorklet.addModule(workletUrl)
      const node = new AudioWorkletNode(ctx, 'pcm16k', { numberOfInputs: 1, numberOfOutputs: 0 })
      node.port.onmessage = (e: MessageEvent<PcmBlockMessage>) => this.onBlock(e.data)
      this.node = node
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.5
      analyser.minDecibels = -90
      analyser.maxDecibels = -25
      this.analyser = analyser
      this.spectrum = new Uint8Array(analyser.frequencyBinCount)
      if (wav) {
        this.wav = true
        const buffer = await ctx.decodeAudioData(wav.slice().buffer)
        const src = ctx.createBufferSource()
        src.buffer = buffer
        src.loop = true
        this.connect(src)
        src.start()
      } else {
        if (!(await window.office.micAccess())) throw new DOMException('mic-denied', 'NotAllowedError')
        await this.openMic()
        navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange)
      }
      await ctx.resume()
    } catch (err) {
      await this.teardown()
      throw new Error(micError(err), { cause: err })
    }
  }

  /** Para tudo: manda o que sobrou (menos de 1 s), solta o microfone e fecha o áudio. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    const rest = this.batcher.flush()
    if (rest) this.deliver(rest.seq, rest.pcm)
    await this.teardown()
  }

  /**
   * Níveis de 0 a 1 em `count` faixas de frequência (graves primeiro), como as barras do botão
   * de voz. Para desenhar num requestAnimationFrame; o envio não depende disto.
   */
  bands(count: number): Float32Array {
    const out = new Float32Array(count)
    const a = this.analyser
    if (!a || !this.ctx) return out
    a.getByteFrequencyData(this.spectrum)
    const edges = bandEdges(this.ctx.sampleRate, a.fftSize, count)
    for (let k = 0; k < count; k++) {
      let top = 0
      for (let j = edges[k]; j < edges[k + 1]; j++) top = Math.max(top, this.spectrum[j] ?? 0)
      out[k] = top / 255
    }
    return out
  }

  private onBlock(msg: PcmBlockMessage): void {
    if (this.stopped) return
    const pcm = new Int16Array(msg.pcm)
    this.opts.onLevel?.(this.track, blockLevel(pcm))
    const { batch, gap } = this.batcher.push(msg.seq, pcm)
    if (gap) this.opts.onGap?.({ track: this.track, seq: gap.seq, ms: (gap.blocks * BLOCK_SAMPLES * 1000) / SAMPLE_RATE, reason: 'blocks' })
    if (batch) this.deliver(batch.seq, batch.pcm)
  }

  private deliver(seq: number, pcm: Int16Array): void {
    try {
      const r = this.opts.send({ track: this.track, seq, pcm })
      if (r instanceof Promise) r.catch((err: unknown) => this.opts.onError?.(`Não consegui enviar o áudio: ${err instanceof Error ? err.message : String(err)}`))
    } catch (err) {
      this.opts.onError?.(`Não consegui enviar o áudio: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private constraints(deviceId = this.opts.deviceId): MediaStreamConstraints {
    // Presencial: o cancelamento de eco e o ganho automático cortariam quem fala longe do microfone.
    const process = this.opts.mode !== 'presencial'
    return {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: process,
        noiseSuppression: process,
        autoGainControl: process,
        channelCount: 1,
      },
    }
  }

  private async openMic(): Promise<void> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia(this.constraints())
    } catch (err) {
      // O microfone escolhido sumiu: vai o padrão do sistema.
      if (!this.opts.deviceId || !(err instanceof DOMException) || (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError')) throw err
      stream = await navigator.mediaDevices.getUserMedia(this.constraints(''))
    }
    if (this.stopped || !this.ctx) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.stream = stream
    stream.getAudioTracks()[0]?.addEventListener('ended', this.onTrackEnded)
    this.connect(this.ctx.createMediaStreamSource(stream))
  }

  private connect(src: AudioNode): void {
    this.source = src
    src.connect(this.node!)
    src.connect(this.analyser!)
  }

  private onTrackEnded = (): void => void this.reopen()

  private onDeviceChange = (): void => {
    window.clearTimeout(this.settle)
    this.settle = window.setTimeout(() => void this.checkDevice(), DEVICE_SETTLE_MS)
  }

  /** Reabre só se o microfone em uso caiu ou deixou de ser o escolhido (padrão do sistema ou `deviceId`). */
  private async checkDevice(): Promise<void> {
    if (this.stopped) return
    const track = this.stream?.getAudioTracks()[0]
    if (track?.readyState === 'live') {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
      const settings = track.getSettings()
      const still = this.opts.deviceId
        ? inputs.some((d) => d.deviceId === this.opts.deviceId) && settings.deviceId === this.opts.deviceId
        : // O Chromium lista o padrão como 'default', com o groupId do aparelho de verdade.
          inputs.find((d) => d.deviceId === 'default')?.groupId === settings.groupId
      if (still) return
    }
    await this.reopen()
  }

  private async reopen(): Promise<void> {
    if (this.stopped || this.reopening || this.wav) return
    this.reopening = true
    const t0 = performance.now()
    // O seq do pedaço em curso: o buraco cai nele.
    const seq = this.batcher.pending
    try {
      this.closeMic()
      await this.openMic()
      this.opts.onGap?.({ track: this.track, seq, ms: Math.round(performance.now() - t0), reason: 'device' })
    } catch (err) {
      this.opts.onError?.(micError(err))
    } finally {
      this.reopening = false
    }
  }

  private closeMic(): void {
    this.source?.disconnect()
    this.source = null
    this.stream?.getAudioTracks()[0]?.removeEventListener('ended', this.onTrackEnded)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }

  private async teardown(): Promise<void> {
    window.clearTimeout(this.settle)
    navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange)
    if (this.source instanceof AudioScheduledSourceNode) this.source.stop()
    this.closeMic()
    if (this.node) {
      this.node.port.onmessage = null
      this.node.disconnect()
      this.node = null
    }
    this.analyser = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined)
  }
}
