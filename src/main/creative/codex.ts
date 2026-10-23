import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findBin } from './tools'

// One non-interactive Codex turn (`codex exec --json`). Images made by its image_gen tool land in
// $CODEX_HOME/generated_images/<thread id>/, which we collect after the turn.

export interface CodexRun {
  prompt: string
  /** Working folder of the turn (the node's run folder). */
  cwd: string
  /** Images attached to the prompt (-i). */
  images?: string[]
  /** JSON Schema file for a structured final answer (--output-schema). */
  schemaFile?: string
  signal?: AbortSignal
  /** A short line of what Codex is doing, for the node's status. */
  onProgress?(text: string): void
}

export interface CodexOutcome {
  threadId: string
  /** The last agent message (the answer). */
  message: string
  /** Images generated in this turn, oldest first. */
  images: string[]
}

const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex')

export function runCodex(run: CodexRun): Promise<CodexOutcome> {
  const codex = findBin('codex')
  if (!codex) return Promise.reject(new Error('O Codex não está instalado nesta máquina. Configure em Estúdio → Integrações.'))
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    // the turn only reads its attachments and draws; it never edits files
    '-s',
    'read-only',
    // the player's own Codex hooks (design checks…) have no business in a studio run
    '--disable',
    'hooks',
    '-C',
    run.cwd,
  ]
  for (const img of run.images ?? []) args.push('-i', img)
  if (run.schemaFile) args.push('--output-schema', run.schemaFile)
  // the prompt goes on stdin: no length limit, no shell quoting
  args.push('-')

  return new Promise((resolve, reject) => {
    const p = spawn(codex, args, { cwd: run.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let threadId = ''
    let message = ''
    let failure = ''
    let buf = ''
    let errTail = ''
    const abort = () => p.kill('SIGTERM')
    run.signal?.addEventListener('abort', abort, { once: true })

    const onEvent = (line: string) => {
      let e: { type?: string; thread_id?: string; item?: { type?: string; text?: string; command?: string }; error?: { message?: string }; message?: string }
      try {
        e = JSON.parse(line)
      } catch {
        return
      }
      if (e.type === 'thread.started' && e.thread_id) threadId = e.thread_id
      else if (e.type === 'item.started' && e.item?.type === 'command_execution') run.onProgress?.(`Codex está lendo: ${(e.item.command ?? '').replace(/^\/bin\/zsh -lc /, '').slice(0, 90)}`)
      else if (e.type === 'item.started' && e.item?.type === 'image_generation') run.onProgress?.('ChatGPT está desenhando…')
      else if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text) {
        message = e.item.text
        run.onProgress?.(e.item.text.split('\n')[0].slice(0, 140))
      } else if (e.type === 'turn.failed' || e.type === 'error') failure = e.error?.message ?? e.message ?? 'O Codex falhou.'
    }
    p.stdout.on('data', (b: Buffer) => {
      buf += b.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        onEvent(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    p.stderr.on('data', (b: Buffer) => (errTail = (errTail + b.toString()).slice(-2000)))
    p.on('error', (err) => {
      run.signal?.removeEventListener('abort', abort)
      reject(err)
    })
    p.on('close', (code) => {
      run.signal?.removeEventListener('abort', abort)
      if (buf.trim()) onEvent(buf)
      if (run.signal?.aborted) return reject(new Error('Cancelado.'))
      if (code !== 0 || failure) {
        const why = failure || errTail.trim().split('\n').filter((l) => !/^Reading additional input/.test(l)).pop() || `código ${code}`
        return reject(new Error(friendly(why)))
      }
      resolve({ threadId, message, images: threadImages(threadId) })
    })
    p.stdin.end(run.prompt)
  })
}

function friendly(why: string): string {
  if (/not logged in|401|unauthorized|login/i.test(why)) return 'O Codex não está logado. Entre com sua conta ChatGPT em Estúdio → Integrações.'
  if (/usage limit|rate limit|429/i.test(why)) return `O ChatGPT recusou por limite de uso: ${why.slice(0, 200)}`
  return `O Codex falhou: ${why.slice(0, 300)}`
}

function threadImages(threadId: string): string[] {
  if (!threadId) return []
  const dir = join(codexHome(), 'generated_images', threadId)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
}

/** The answer of a turn with --output-schema, parsed. */
export function parseJsonAnswer<T>(message: string): T {
  const raw = message.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  try {
    return JSON.parse(raw) as T
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0]) as T
    throw new Error('O Codex respondeu fora do formato esperado. Rode o nó de novo.')
  }
}
