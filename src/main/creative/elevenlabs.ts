import { app, safeStorage } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ElevenStatus, ElevenVoice } from '@shared/creative'
import { secret } from '../log'

// ElevenLabs for the studio's narration node. The key is either a file the player already keeps
// (~/.config/elevenlabs/*, read on each use, never copied) or one pasted in the app, stored
// encrypted with the OS keychain (safeStorage). The key never reaches the page or the log.

const API = 'https://api.elevenlabs.io'
const KEY_DIR = join(homedir(), '.config', 'elevenlabs')
const KEY_RE = /^sk_[A-Za-z0-9]{20,100}$/

interface Config {
  /** A key file of ~/.config/elevenlabs. */
  file?: string
  /** A pasted key, encrypted (base64). */
  sealed?: string
}

const configFile = () => join(app.getPath('userData'), 'elevenlabs.json')

function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(configFile(), 'utf8')) as Config
  } catch {
    return {}
  }
}

function writeConfig(c: Config): void {
  writeFileSync(configFile(), JSON.stringify(c), { mode: 0o600 })
}

/** Key files found in ~/.config/elevenlabs (names only). */
export function keyFiles(): string[] {
  if (!existsSync(KEY_DIR)) return []
  return readdirSync(KEY_DIR).filter((f) => {
    const p = join(KEY_DIR, f)
    try {
      return statSync(p).isFile() && statSync(p).size < 400 && KEY_RE.test(readFileSync(p, 'utf8').trim())
    } catch {
      return false
    }
  })
}

function apiKey(): string | null {
  const c = readConfig()
  let key = ''
  if (c.file && keyFiles().includes(c.file)) key = readFileSync(join(KEY_DIR, c.file), 'utf8').trim()
  else if (c.sealed && safeStorage.isEncryptionAvailable()) key = safeStorage.decryptString(Buffer.from(c.sealed, 'base64'))
  if (!KEY_RE.test(key)) return null
  secret(key)
  return key
}

async function call(path: string, init: RequestInit = {}, key = apiKey()): Promise<Response> {
  if (!key) throw new Error('Configure o ElevenLabs em Estúdio → Integrações.')
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'xi-api-key': key, ...(init.headers ?? {}) }, signal: init.signal ?? AbortSignal.timeout(120_000) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const msg = (() => {
      try {
        const j = JSON.parse(body) as { detail?: { message?: string } | string }
        return typeof j.detail === 'string' ? j.detail : (j.detail?.message ?? body)
      } catch {
        return body
      }
    })()
    if (res.status === 401) throw new Error('O ElevenLabs recusou a chave (401). Confira a chave em Integrações.')
    if (res.status === 429) throw new Error('O ElevenLabs está no limite de uso agora (429). Tente daqui a pouco.')
    throw new Error(`O ElevenLabs respondeu ${res.status}: ${msg.slice(0, 200)}`)
  }
  return res
}

export async function elevenStatus(): Promise<ElevenStatus> {
  const c = readConfig()
  const files = keyFiles()
  const source = c.file && files.includes(c.file) ? `~/.config/elevenlabs/${c.file}` : c.sealed ? 'chave guardada no app' : undefined
  const out: ElevenStatus = { configured: !!apiKey(), source, files }
  if (!out.configured) return out
  try {
    const sub = (await (await call('/v1/user/subscription')).json()) as { tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number }
    out.tier = sub.tier
    out.used = sub.character_count
    out.limit = sub.character_limit
    out.resetsAt = sub.next_character_count_reset_unix ? sub.next_character_count_reset_unix * 1000 : undefined
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
  }
  return out
}

/** Use a key file of ~/.config/elevenlabs (by name). */
export function useKeyFile(name: string): void {
  if (!keyFiles().includes(name)) throw new Error('Esse arquivo de chave não existe mais em ~/.config/elevenlabs.')
  writeConfig({ file: name })
}

/** Store a pasted key, encrypted. Checked against the API first. */
export async function storeKey(raw: string): Promise<void> {
  const key = raw.trim()
  if (!KEY_RE.test(key)) throw new Error('Essa não parece uma chave do ElevenLabs (começa com sk_).')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O sistema não oferece cofre para guardar a chave. Salve-a em ~/.config/elevenlabs/api_key e escolha o arquivo.')
  secret(key)
  await call('/v1/user/subscription', {}, key)
  writeConfig({ sealed: safeStorage.encryptString(key).toString('base64') })
}

export function forgetKey(): void {
  writeConfig({})
}

export async function voices(): Promise<ElevenVoice[]> {
  const j = (await (await call('/v1/voices')).json()) as { voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string }[] }
  return (j.voices ?? []).slice(0, 200).map((v) => ({
    id: v.voice_id,
    name: v.name,
    detail: [v.category, v.labels?.accent, v.labels?.gender, v.labels?.language].filter(Boolean).join(' · '),
  }))
}

/** Text to speech as MP3, written to `dest`. */
export async function speak(text: string, voiceId: string, model: string, dest: string, signal?: AbortSignal): Promise<void> {
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) throw new Error('Escolha uma voz no nó de narração.')
  const res = await call(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model }),
    signal: signal ?? AbortSignal.timeout(300_000),
  })
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}
