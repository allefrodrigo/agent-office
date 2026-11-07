import { execFile, spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { wavBytes } from '@shared/meeting-audio'
import { parseVerboseJson, parseWhisperCliJson } from '@shared/meetings'
import type { Track, WhisperSegment } from '@shared/types/meetings'
import { findBin, findWhisperModel } from '../creative/tools'
import { log, secret } from '../log'

// Transcrição da sala de reunião (RN-03, ADR 0012): um whisper-server por reunião em
// 127.0.0.1, porta livre e token no caminho; fila serial dos trechos; whisper-cli por trecho
// quando o servidor não existe, não sobe ou cai duas vezes.
//
// WARNING (segurança): o whisper-server não tem autenticação e responde com
// `Access-Control-Allow-Origin: *`. O token no `--request-path` é a única barreira, por isso:
// token novo a cada processo, nunca em log nem em mensagem de erro, nunca `--convert`, nunca
// `/load`, e o processo morre com a reunião e com o app (stopAllWhisper no stopAll do main).

export const READY_TIMEOUT_MS = 15_000
export const REQUEST_TIMEOUT_MS = 60_000
const STOP_GRACE_MS = 2000

const INSTALL_WHISPER = 'Instale com `brew install whisper-cpp` e tente de novo.'
const INSTALL_MODEL =
  'Baixe o ggml-small.bin para ~/.cache/whisper com `curl -L --create-dirs -o ~/.cache/whisper/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin` e tente de novo.'
const INSTALL_FFMPEG = 'Instale com `brew install ffmpeg` e tente de novo.'

export interface TranscribeOptions {
  /** 'pt', 'en' ou 'auto'. */
  lang: string
  /** Vocabulário e fim do trecho anterior (whisperPrompt). */
  prompt?: string
}

export type Transcriber = (wav: Uint8Array, opts: TranscribeOptions) => Promise<WhisperSegment[]>

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess

// ---------- argumentos e segredo ----------

export interface ServerArgs {
  model: string
  port: number
  token: string
  lang: string
}

/** Linha de comando do whisper-server (ADR 0012). Nunca `--convert`: o app manda WAV 16 kHz que ele mesmo montou. */
export function buildServerArgs({ model, port, token, lang }: ServerArgs): string[] {
  return ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--request-path', `/${token}`, '-l', lang, '-nth', '0.6', '-sns']
}

/** Token de 32 bytes, 64 hex: a URL do servidor vira credencial. */
export const newToken = (): string => randomBytes(32).toString('hex')

/** Tira o token (e qualquer coisa com cara de token) de um texto que pode virar log ou erro. */
export function sanitize(text: string, token?: string): string {
  let out = token ? text.split(token).join('[token]') : text
  out = out.replace(/[0-9a-f]{32,}/gi, '[token]')
  return out
}

/** Erro sem `cause` de propósito: a causa de um fetch traz a URL, e a URL tem o token. */
const noCause = (message: string): Error => new Error(message)

/** Erro sem o token na mensagem e sem `cause`. */
const safeError = (err: unknown, token?: string): Error => noCause(sanitize(err instanceof Error ? err.message : String(err), token))

/** Porta livre em 127.0.0.1 (o sistema escolhe; fechamos e passamos ao servidor). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close(() => (port ? resolve(port) : reject(new Error('Não achei uma porta livre para o whisper-server.'))))
    })
  })
}

// ---------- whisper-cli por trecho ----------

export interface CliOptions extends TranscribeOptions {
  bin: string
  model: string
  timeoutMs?: number
  /** Testes trocam o processo; o padrão é execFile sem shell. */
  run?: (bin: string, args: string[], timeoutMs: number) => Promise<void>
}

function execNoShell(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, shell: false, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err) => {
      if (!err) return resolve()
      const killed = (err as { killed?: boolean }).killed
      reject(new Error(killed ? `O whisper-cli não terminou em ${Math.round(timeoutMs / 1000)} s.` : 'O whisper-cli falhou ao transcrever o trecho.'))
    })
  })
}

/**
 * Fallback: um trecho no whisper-cli. O WAV vai para uma pasta própria em os.tmpdir (0700,
 * arquivo 0600) e tudo some no fim, deu certo ou não.
 */
export async function transcribeCli(wav: Uint8Array, opts: CliOptions): Promise<WhisperSegment[]> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-office-whisper-'))
  try {
    const file = join(dir, 'trecho.wav')
    const out = join(dir, 'trecho')
    writeFileSync(file, wav, { mode: 0o600 })
    const args = ['-m', opts.model, '-f', file, '-l', opts.lang, '-oj', '-of', out]
    if (opts.prompt) args.push('--prompt', opts.prompt)
    args.push('-np')
    await (opts.run ?? execNoShell)(opts.bin, args, opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
    return parseWhisperCliJson(readFileSync(`${out}.json`, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- whisper-server supervisionado ----------

export type WhisperMode = 'idle' | 'server' | 'cli' | 'stopped'

export interface WhisperServerOptions {
  model: string
  /** whisper-server; sem ele, vai direto ao whisper-cli. */
  serverBin?: string
  /** whisper-cli para o fallback. */
  cliBin?: string
  lang?: string
  readyTimeoutMs?: number
  requestTimeoutMs?: number
  /** Testes trocam processo, rede e porta. */
  spawn?: SpawnFn
  fetch?: typeof fetch
  port?: () => Promise<number>
  cli?: (wav: Uint8Array, opts: CliOptions) => Promise<WhisperSegment[]>
  /** O servidor caiu e outro subiu, ou o app passou ao whisper-cli. */
  onModeChange?: (mode: WhisperMode, crashes: number) => void
}

/** Resposta do servidor vivo (não é queda): não adianta refazer. */
class HttpError extends Error {}

const live = new Set<WhisperServer>()
/** Todo processo ainda vivo, inclusive os que receberam SIGTERM e não saíram. */
const children = new Set<ChildProcess>()

/**
 * Um whisper-server por reunião. `start` sobe o processo e espera o GET /<token>/ responder;
 * `transcribe` manda o WAV para /<token>/inference. Se o processo morrer sem ser pedido, sobe
 * outro com token e porta novos; na segunda queda, cada trecho passa a rodar no whisper-cli.
 */
export class WhisperServer {
  private child: ChildProcess | null = null
  private token = ''
  private port = 0
  private crashes = 0
  private _mode: WhisperMode = 'idle'
  /** Subida em andamento (start ou reinício depois de uma queda). */
  private starting: Promise<void> | null = null
  /** Nem servidor nem cli: a mensagem para quem pedir um trecho. */
  private failure: string | undefined
  private readonly spawnFn: SpawnFn
  private readonly fetchFn: typeof fetch
  private readonly lang: string

  constructor(private opts: WhisperServerOptions) {
    this.spawnFn = opts.spawn ?? ((cmd, args, o) => nodeSpawn(cmd, args, o))
    this.fetchFn = opts.fetch ?? fetch
    this.lang = opts.lang ?? 'pt'
  }

  /** Com o que há na máquina; undefined quando falta modelo ou os dois binários. */
  static fromMachine(lang = 'pt'): WhisperServer | undefined {
    const model = findWhisperModel()
    const serverBin = findBin('whisper-server')
    const cliBin = findBin('whisper-cli')
    if (!model || (!serverBin && !cliBin)) return undefined
    return new WhisperServer({ model, serverBin, cliBin, lang })
  }

  get mode(): WhisperMode {
    return this._mode
  }

  get crashCount(): number {
    return this.crashes
  }

  /** O pid do processo atual (testes e diagnóstico; nunca a URL). */
  get pid(): number | undefined {
    return this.child?.pid
  }

  async start(): Promise<WhisperMode> {
    if (this._mode === 'stopped') throw new Error('Esta transcrição já foi encerrada. Comece outra reunião.')
    live.add(this)
    if (this._mode === 'server' || this._mode === 'cli') return this._mode
    this.starting ??= this.boot()
    await this.starting
    if (this.failure) throw new Error(this.failure)
    return this._mode
  }

  private async boot(): Promise<void> {
    try {
      if (!this.opts.serverBin) {
        this.toCli('sem whisper-server')
        return
      }
      const t0 = Date.now()
      await this.spawnServer()
      this.setMode('server')
      log.info(`whisper-server pronto em ${Date.now() - t0} ms (modelo ${basename(this.opts.model)})`)
    } catch (err) {
      if (this._mode === 'stopped') return
      this.kill()
      log.warn(`whisper-server não subiu (${sanitize(err instanceof Error ? err.message : String(err), this.token)})`)
      this.toCli('não subiu')
    } finally {
      this.starting = null
    }
  }

  private async spawnServer(): Promise<void> {
    this.token = newToken()
    secret(this.token)
    this.port = await (this.opts.port ?? freePort)()
    const args = buildServerArgs({ model: this.opts.model, port: this.port, token: this.token, lang: this.lang })
    // Sem shell e sem stdout/stderr: nada do processo (que pode ecoar o caminho) chega ao log.
    const child = this.spawnFn(this.opts.serverBin!, args, { shell: false, stdio: 'ignore', windowsHide: true })
    this.child = child
    children.add(child)
    let exited = false
    child.once('error', () => {
      exited = true
      children.delete(child)
    })
    child.once('exit', (code, signal) => {
      exited = true
      children.delete(child)
      if (this.child === child) this.onExit(code, signal)
    })
    const deadline = Date.now() + (this.opts.readyTimeoutMs ?? READY_TIMEOUT_MS)
    for (;;) {
      if (exited || this.child !== child) throw new Error('o processo saiu antes de ficar pronto')
      try {
        const r = await this.fetchFn(`${this.base()}/`, { signal: AbortSignal.timeout(1000) })
        if (r.ok) return
      } catch {
        // ainda subindo
      }
      if (Date.now() > deadline) throw new Error(`não ficou pronto em ${Math.round((this.opts.readyTimeoutMs ?? READY_TIMEOUT_MS) / 1000)} s`)
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null
    if (this._mode !== 'server') return // subindo (boot trata) ou encerrando
    this.crashes++
    log.warn(`whisper-server saiu sem ser pedido (código ${code ?? '-'}, sinal ${signal ?? '-'}; queda ${this.crashes})`)
    if (this.crashes >= 2) {
      this.toCli('caiu duas vezes')
      return
    }
    this.setMode('idle')
    this.starting = (async () => {
      try {
        await this.spawnServer()
        this.setMode('server')
        log.info('whisper-server reiniciado com token novo')
      } catch (err) {
        if (this._mode === 'stopped') return
        this.kill()
        log.warn(`whisper-server não voltou (${sanitize(err instanceof Error ? err.message : String(err), this.token)})`)
        this.toCli('não voltou')
      } finally {
        this.starting = null
      }
    })()
  }

  /** Passa ao whisper-cli; sem ele, guarda o erro que o próximo trecho vai receber. */
  private toCli(why: string): void {
    if (!this.opts.cliBin) {
      this.failure = `O whisper-server ${why} e o whisper-cli não está instalado. ${INSTALL_WHISPER}`
      log.warn(`Sem transcrição: whisper-server ${why}, sem whisper-cli`)
      this.setMode('idle')
      return
    }
    log.info(`Transcrição pelo whisper-cli por trecho (${why})`)
    this.setMode('cli')
  }

  private setMode(mode: WhisperMode): void {
    if (this._mode === mode || this._mode === 'stopped') return
    this._mode = mode
    if (mode !== 'idle') this.opts.onModeChange?.(mode, this.crashes)
  }

  private base(): string {
    return `http://127.0.0.1:${this.port}/${this.token}`
  }

  /** Um trecho em WAV 16 kHz; os tempos dos segmentos são relativos ao trecho. */
  async transcribe(wav: Uint8Array, opts: TranscribeOptions): Promise<WhisperSegment[]> {
    if (this._mode === 'stopped') throw new Error('A transcrição foi encerrada.')
    if (this._mode === 'idle' && !this.starting) await this.start()
    if (this.starting) await this.starting
    if (this.failure) throw new Error(this.failure)
    if (this._mode === 'cli') return this.viaCli(wav, opts)
    const token = this.token
    try {
      return await this.viaServer(wav, opts)
    } catch (err) {
      if (err instanceof HttpError) throw err
      // O servidor caiu no meio do trecho: espera o aviso de saída do processo e refaz uma vez
      // no que veio depois (outro servidor ou o cli).
      await new Promise((r) => setTimeout(r, 300))
      const mode = (): WhisperMode => this._mode // lido de novo depois de cada espera
      if (this.token !== token || this.starting || mode() !== 'server') {
        if (this.starting) await this.starting
        if (this.failure) throw noCause(this.failure)
        if (mode() === 'cli') return this.viaCli(wav, opts)
        if (mode() === 'server') return this.viaServer(wav, opts)
      }
      throw err
    }
  }

  private viaCli(wav: Uint8Array, opts: TranscribeOptions): Promise<WhisperSegment[]> {
    return (this.opts.cli ?? transcribeCli)(wav, { ...opts, bin: this.opts.cliBin!, model: this.opts.model, timeoutMs: this.opts.requestTimeoutMs })
  }

  private async viaServer(wav: Uint8Array, opts: TranscribeOptions): Promise<WhisperSegment[]> {
    const token = this.token
    const timeout = this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    const fd = new FormData()
    fd.append('file', new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'trecho.wav')
    fd.append('response_format', 'verbose_json')
    fd.append('temperature', '0')
    fd.append('language', opts.lang)
    if (opts.prompt) fd.append('prompt', opts.prompt)
    let res: Response
    try {
      res = await this.fetchFn(`${this.base()}/inference`, { method: 'POST', body: fd, signal: AbortSignal.timeout(timeout) })
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'TimeoutError' || name === 'AbortError') throw noCause(`O whisper-server não respondeu em ${Math.round(timeout / 1000)} s.`)
      throw noCause(`O whisper-server não respondeu (${sanitize(err instanceof Error ? err.message : String(err), token)}).`)
    }
    if (!res.ok) throw new HttpError(`O whisper-server recusou o trecho (HTTP ${res.status}).`)
    try {
      return parseVerboseJson(await res.text())
    } catch (err) {
      throw safeError(err, token)
    }
  }

  /** SIGTERM; se não sair em 2 s, SIGKILL. */
  async stop(): Promise<void> {
    this._mode = 'stopped'
    live.delete(this)
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // já saiu
        }
        resolve()
      }, STOP_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        child.kill('SIGTERM')
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
    log.info(`whisper-server encerrado (${this.crashes} queda(s))`)
  }

  /** Mata na hora (saída do processo do app, falha na subida). */
  kill(): void {
    const child = this.child
    this.child = null
    try {
      child?.kill('SIGKILL')
    } catch {
      // já saiu
    }
  }
}

/** Encerra todo whisper-server vivo. Chamado no stopAll do main (saída do app). */
export function stopAllWhisper(): Promise<void> {
  return Promise.all([...live].map((s) => s.stop())).then(() => undefined)
}

// Rede de segurança: se o app sair sem passar pelo stopAll, nenhum servidor fica para trás.
process.once('exit', () => {
  for (const c of children) {
    try {
      c.kill('SIGKILL')
    } catch {
      // já saiu
    }
  }
})

// ---------- fila ----------

export interface TranscriptionJob {
  meetingId: string
  track: Track
  /** ms desde o começo da reunião (Segmenter). */
  start: number
  end: number
  pcm: Int16Array
  /** Hora (Date.now) em que o trecho terminou de ser falado; padrão: startedAt + end, ou a hora do push. */
  endWall?: number
  prompt?: string
}

export interface QueueOptions {
  transcribe: Transcriber
  lang: string
  onResult: (job: TranscriptionJob, segments: WhisperSegment[]) => void
  onError?: (job: TranscriptionJob, err: Error) => void
  /** Atraso (agora menos o fim do trecho) e trechos esperando, a cada mudança. */
  onDelay?: (delayMs: number, pending: number) => void
  /** Date.now() do começo da reunião, para achar a hora do fim de cada trecho. */
  startedAt?: number
  now?: () => number
}

/**
 * Fila serial: um trecho por vez, em ordem de início, alternando as faixas quando as duas têm
 * trabalho. Mede o atraso de cada trecho entregue.
 */
export class TranscriptionQueue {
  private jobs: TranscriptionJob[] = []
  private running = false
  private lastTrack: Track | undefined
  private generation = 0
  private idle: (() => void)[] = []
  private _delay = 0
  private done = 0
  private readonly now: () => number

  constructor(private opts: QueueOptions) {
    this.now = opts.now ?? Date.now
  }

  get pending(): number {
    return this.jobs.length + (this.running ? 1 : 0)
  }

  /** Atraso do último trecho entregue, ou do mais antigo esperando se ele já passou disso. */
  get delayMs(): number {
    const oldest = this.jobs.reduce((m, j) => Math.min(m, j.endWall ?? Infinity), Infinity)
    return Math.max(this._delay, Number.isFinite(oldest) ? Math.max(0, this.now() - oldest) : 0)
  }

  get processed(): number {
    return this.done
  }

  push(job: TranscriptionJob): void {
    const endWall = job.endWall ?? (this.opts.startedAt !== undefined ? this.opts.startedAt + job.end : this.now())
    this.jobs.push({ ...job, endWall })
    this.opts.onDelay?.(this.delayMs, this.pending)
    void this.pump()
  }

  /** O próximo: o de menor início entre as faixas que não foram a última; senão o de menor início. */
  private pick(): TranscriptionJob | undefined {
    if (!this.jobs.length) return undefined
    const byStart = (a: TranscriptionJob, b: TranscriptionJob) => a.start - b.start
    const others = this.jobs.filter((j) => j.track !== this.lastTrack).sort(byStart)
    const next = others[0] ?? [...this.jobs].sort(byStart)[0]
    this.jobs.splice(this.jobs.indexOf(next), 1)
    return next
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    const gen = this.generation
    try {
      for (let job = this.pick(); job; job = this.generation === gen ? this.pick() : undefined) {
        this.lastTrack = job.track
        try {
          const segs = await this.opts.transcribe(wavBytes(job.pcm), { lang: this.opts.lang, prompt: job.prompt })
          if (this.generation !== gen) break
          this.done++
          this._delay = Math.max(0, this.now() - (job.endWall ?? this.now()))
          this.opts.onResult(job, segs)
        } catch (err) {
          if (this.generation !== gen) break
          this.opts.onError?.(job, err instanceof Error ? err : new Error(String(err)))
        }
        this.opts.onDelay?.(this.delayMs, this.jobs.length)
      }
    } finally {
      this.running = false
      if (!this.jobs.length) {
        const waiters = this.idle
        this.idle = []
        for (const w of waiters) w()
      } else if (this.generation !== gen) void this.pump()
    }
  }

  /** Espera a fila esvaziar (encerramento: "Terminando a transcrição…"). */
  drain(): Promise<void> {
    if (!this.running && !this.jobs.length) return Promise.resolve()
    return new Promise((resolve) => this.idle.push(resolve))
  }

  /** Descarta o que espera e ignora o resultado do trecho em andamento. */
  clear(): void {
    const dropped = this.jobs.length
    this.generation++
    this.jobs = []
    this._delay = 0
    const waiters = this.idle
    this.idle = []
    for (const w of waiters) w()
    if (dropped) log.info(`Fila do whisper descartou ${dropped} trecho(s)`)
  }
}

// ---------- doctor ----------

export interface DoctorItem {
  ok: boolean
  /** Caminho do binário, ou só o nome do arquivo do modelo. */
  found?: string
  /** O que fazer quando falta. */
  message?: string
}

export interface WhisperDoctor {
  whisperCli: DoctorItem
  whisperServer: DoctorItem
  model: DoctorItem
  ffmpeg: DoctorItem
  /** Dá para transcrever: modelo e pelo menos um dos binários. */
  canTranscribe: boolean
  /** As mensagens do que falta, na ordem em que importam. */
  problems: string[]
}

export interface DoctorDeps {
  bin: (name: string) => string | undefined
  model: () => string | undefined
}

/** O que há na máquina para transcrever reuniões e, para cada falta, como resolver. */
export function doctor(deps: DoctorDeps = { bin: findBin, model: findWhisperModel }): WhisperDoctor {
  const cli = deps.bin('whisper-cli')
  const server = deps.bin('whisper-server')
  const model = deps.model()
  const ffmpeg = deps.bin('ffmpeg')
  const r: WhisperDoctor = {
    whisperCli: cli ? { ok: true, found: cli } : { ok: false, message: `Falta o whisper-cli. ${INSTALL_WHISPER}` },
    whisperServer: server
      ? { ok: true, found: server }
      : { ok: false, message: `Falta o whisper-server; sem ele cada trecho roda no whisper-cli, mais devagar. ${INSTALL_WHISPER}` },
    model: model ? { ok: true, found: basename(model) } : { ok: false, message: `Falta um modelo do whisper. ${INSTALL_MODEL}` },
    ffmpeg: ffmpeg ? { ok: true, found: ffmpeg } : { ok: false, message: `Falta o ffmpeg. ${INSTALL_FFMPEG}` },
    canTranscribe: !!model && !!(cli || server),
    problems: [],
  }
  for (const k of ['whisperCli', 'whisperServer', 'model', 'ffmpeg'] as const) if (r[k].message) r.problems.push(r[k].message!)
  return r
}
