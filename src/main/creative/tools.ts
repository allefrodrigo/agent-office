import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CreativeStatus } from '@shared/creative'
import { elevenStatus } from './elevenlabs'

// The programs the creative floor runs: codex (ChatGPT images and the agents), ffmpeg and whisper-cli.
// Found on PATH (the login shell's, see env.ts) or in the usual install folders; never bundled.

const exe = (p: string) => {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** First executable named `name` on PATH or in the usual folders. */
export function findBin(name: string): string | undefined {
  const win = process.platform === 'win32'
  const sep = win ? ';' : ':'
  const dirs = [
    ...(process.env.PATH ?? '').split(sep),
    join(homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(win ? [join(process.env.APPDATA ?? '', 'npm')] : []),
  ]
  const names = win ? [`${name}.exe`, `${name}.cmd`] : [name]
  for (const d of dirs) for (const n of names) if (d && exe(join(d, n))) return join(d, n)
  return undefined
}

/** A ggml whisper model already on disk (hyperframes and whisper.cpp keep them here). Small beats base beats tiny. */
export function findWhisperModel(): string | undefined {
  const dirs = [
    process.env.AGENT_OFFICE_WHISPER_MODELS ?? '',
    join(homedir(), '.cache', 'hyperframes', 'whisper', 'models'),
    join(homedir(), '.cache', 'whisper'),
    join(homedir(), '.cache', 'whisper.cpp'),
    '/opt/homebrew/share/whisper-cpp/models',
    '/usr/local/share/whisper-cpp/models',
  ]
  const rank = (f: string) => ['large', 'medium', 'small', 'base', 'tiny'].findIndex((s) => f.includes(s))
  let best: { path: string; rank: number } | undefined
  for (const d of dirs) {
    if (!d || !existsSync(d)) continue
    let files: string[]
    try {
      files = readdirSync(d).filter((f) => /^ggml-.+\.bin$/.test(f) && !f.includes('.en'))
    } catch {
      continue
    }
    for (const f of files) {
      // large and medium are slow on a laptop: small is the sweet spot, then base.
      const r = rank(f)
      const score = r === 2 ? 0 : r === 3 ? 1 : r === 1 ? 2 : r === 4 ? 3 : r === 0 ? 4 : 5
      if (!best || score < best.rank) best = { path: join(d, f), rank: score }
    }
  }
  return best?.path
}

function run(bin: string, args: string[], timeout = 15000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, env: process.env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : 1) : 0
      resolve({ code, out: `${stdout ?? ''}${stderr ?? ''}`.trim() })
    })
  })
}

export async function creativeStatus(): Promise<CreativeStatus> {
  const codex = findBin('codex')
  const whisperBin = findBin('whisper-cli')
  const status: CreativeStatus = {
    codex: { installed: !!codex, path: codex, loggedIn: false },
    ffmpeg: !!findBin('ffmpeg') && !!findBin('ffprobe'),
    whisper: { bin: whisperBin, model: whisperBin ? findWhisperModel() : undefined },
    elevenlabs: await elevenStatus().catch((err: unknown) => ({ configured: false, files: [], error: err instanceof Error ? err.message : String(err) })),
  }
  if (!codex) return status
  const [ver, login] = await Promise.all([run(codex, ['--version']), run(codex, ['login', 'status'])])
  status.codex.version = ver.out.split('\n').pop()?.replace(/^codex-cli\s*/, '') || undefined
  // "Logged in using ChatGPT" / "Logged in using an API key - sk-…" / "Not logged in"
  const line = login.out.split('\n').find((l) => /logged in/i.test(l)) ?? login.out.split('\n')[0] ?? ''
  status.codex.loggedIn = login.code === 0 && /^logged in/i.test(line.trim())
  if (status.codex.loggedIn) status.codex.account = /chatgpt/i.test(line) ? 'ChatGPT' : /api key/i.test(line) ? 'chave de API' : line.trim()
  else if (login.code !== 0 && !/not logged in/i.test(login.out)) status.codex.error = login.out.slice(0, 300)
  return status
}

let loginProc: ChildProcess | null = null

/**
 * `codex login`: opens the ChatGPT sign-in in the browser and waits for the callback on
 * localhost. Resolves when the CLI exits (signed in, failed or cancelled).
 */
export function codexLogin(onUrl: (url: string) => void): Promise<void> {
  const codex = findBin('codex')
  if (!codex) return Promise.reject(new Error('O Codex não está instalado. Instale com "npm install -g @openai/codex" e tente de novo.'))
  loginProc?.kill()
  return new Promise((resolve, reject) => {
    const p = spawn(codex, ['login'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    loginProc = p
    let sent = false
    let out = ''
    const onData = (b: Buffer) => {
      out += b.toString()
      // The CLI opens the browser itself; the link it prints is the fallback the page offers.
      const url = out.match(/https:\/\/auth\.openai\.com\/[^\s"']+/)?.[0]
      if (url && !sent) {
        sent = true
        onUrl(url)
      }
    }
    p.stdout?.on('data', onData)
    p.stderr?.on('data', onData)
    const timer = setTimeout(() => p.kill(), 10 * 60_000)
    p.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      if (loginProc === p) loginProc = null
      if (code === 0) resolve()
      else reject(new Error(code === null ? 'O login do Codex foi cancelado.' : `O login do Codex não terminou: ${out.trim().split('\n').pop()?.slice(0, 200) || `código ${code}`}`))
    })
  })
}

export function cancelCodexLogin(): void {
  loginProc?.kill()
  loginProc = null
}

export async function codexLogout(): Promise<void> {
  const codex = findBin('codex')
  if (codex) await run(codex, ['logout'])
}
