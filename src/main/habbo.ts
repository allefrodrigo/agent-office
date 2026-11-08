import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

// The 2D view assembles its Habbo avatars from the clothing libraries of HabboAssets (one
// .nitro bundle per library: sprites + offsets of every action). The CDN that serves them sends
// no CORS header, so the page cannot fetch them itself: the main process does, and keeps each
// one on disk, so the avatars load offline after the first time.

const API = 'https://www.habboassets.com/api/v2/swfs/libraries/clothing'
/** A piece of furniture as a zip holding its .nitro (the renderer needs its layers apart: a monitor's screen). */
const FURNI_ZIP = 'https://www.habboassets.com/api/v2/furniture/zip'
const CDN_HOST = 'cdn.habboassets.com'
/** Library names in figuremap.xml: letters, digits and underscores. */
const NAME = /^[A-Za-z0-9_]{1,64}$/
/** The biggest clothing bundle is a few hundred kB; anything far past that is not one. */
const MAX_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 20_000
const HEADERS = { 'User-Agent': 'agent-office', Accept: 'application/json' }
/** HabboAssets answers 429 to bursts: wait (its Retry-After, or this) and try again, a few times. */
const RETRY_WAIT_MS = 15_000
const RETRIES = 3
/** Gap between two downloads of the background fill, so it never trips the rate limit. */
const PACE_MS = 1_500
/** The catalog has about 300 libraries; a list far longer than that is not one. */
const MAX_PREFETCH = 1000

interface LibraryInfo {
  data?: { revisions?: { revision?: string; nitro?: string }[] }
}

/** Downloads in flight, so two avatars asking for the same library share one request. */
const pending = new Map<string, Promise<Uint8Array>>()

/** The .nitro bundle of a clothing library, from the disk cache or HabboAssets. */
export function habboLibrary(cacheDir: string, name: unknown): Promise<Uint8Array> {
  if (typeof name !== 'string' || !NAME.test(name)) return Promise.reject(new Error('Nome de biblioteca Habbo inválido.'))
  let job = pending.get(name)
  if (!job) {
    job = load(cacheDir, name).finally(() => pending.delete(name))
    pending.set(name, job)
  }
  return job
}

async function load(cacheDir: string, name: string): Promise<Uint8Array> {
  const file = join(cacheDir, `${name}.nitro`)
  try {
    return new Uint8Array(await readFile(file))
  } catch {
    // not cached yet
  }
  const info = (await (await get(`${API}/${name}`)).json()) as LibraryInfo
  // the newest revision: the one the live client uses
  const latest = [...(info.data?.revisions ?? [])].sort((a, b) => Number(b.revision) - Number(a.revision))[0]
  const url = new URL(latest?.nitro ?? '')
  if (url.protocol !== 'https:' || url.hostname !== CDN_HOST) throw new Error(`HabboAssets não tem o pacote da biblioteca ${name}.`)
  const res = await get(url.href)
  const size = Number(res.headers.get('content-length') ?? 0)
  if (size > MAX_BYTES) throw new Error(`O pacote ${name} veio grande demais.`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) throw new Error(`O pacote ${name} veio grande demais.`)
  await mkdir(cacheDir, { recursive: true })
  // write then rename: a crash mid-write never leaves a broken bundle in the cache
  await writeFile(`${file}.tmp`, bytes)
  await rename(`${file}.tmp`, file)
  return bytes
}

/** The .nitro bundle of a piece of furniture (by classname), from the disk cache or HabboAssets. */
export function habboFurni(cacheDir: string, name: unknown): Promise<Uint8Array> {
  if (typeof name !== 'string' || !NAME.test(name)) return Promise.reject(new Error('Nome de móvel Habbo inválido.'))
  const key = `furni/${name}`
  let job = pending.get(key)
  if (!job) {
    job = loadFurni(join(cacheDir, 'furni'), name).finally(() => pending.delete(key))
    pending.set(key, job)
  }
  return job
}

async function loadFurni(dir: string, name: string): Promise<Uint8Array> {
  const file = join(dir, `${name}.nitro`)
  try {
    return new Uint8Array(await readFile(file))
  } catch {
    // not cached yet
  }
  const res = await get(`${FURNI_ZIP}?${new URLSearchParams({ classnames: name, format: 'nitro' })}`)
  const zip = new Uint8Array(await res.arrayBuffer())
  if (zip.byteLength > MAX_BYTES) throw new Error(`O pacote ${name} veio grande demais.`)
  const bytes = zipEntry(zip, `${name}.nitro`)
  if (!bytes) throw new Error(`HabboAssets não tem o pacote do móvel ${name}.`)
  await mkdir(dir, { recursive: true })
  await writeFile(`${file}.tmp`, bytes)
  await rename(`${file}.tmp`, file)
  return bytes
}

/** One file of a zip (stored or deflated), read from its local headers; null when it is not there. */
export function zipEntry(zip: Uint8Array, wanted: string): Uint8Array | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let at = 0
  while (at + 30 <= zip.byteLength && view.getUint32(at, true) === 0x04034b50) {
    const flags = view.getUint16(at + 6, true)
    const method = view.getUint16(at + 8, true)
    const size = view.getUint32(at + 18, true)
    const nameLen = view.getUint16(at + 26, true)
    const extraLen = view.getUint16(at + 28, true)
    const start = at + 30 + nameLen + extraLen
    // sizes after the data (bit 3): not what HabboAssets sends, and not worth a central-directory reader
    if (flags & 8 || start + size > zip.byteLength) return null
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLen))
    if (name === wanted) {
      const data = zip.subarray(start, start + size)
      if (method === 0) return data.slice()
      if (method === 8) return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_BYTES }))
      return null
    }
    at = start + size
  }
  return null
}

async function get(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) return res
    if (res.status !== 429 || attempt >= RETRIES) throw new Error(`HabboAssets respondeu ${res.status} para ${url}.`)
    const after = Number(res.headers.get('retry-after'))
    await sleep(after > 0 && after <= 120 ? after * 1000 : RETRY_WAIT_MS * (attempt + 1))
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let filling: Promise<number> | null = null

/**
 * Downloads, one at a time, every library of the list that is not on disk yet, so any look the
 * editor offers draws at once and offline. Returns how many it fetched; a library that fails
 * is left for the next run. One fill at a time: a second call shares the running one.
 */
export function prefetchHabbo(cacheDir: string, names: unknown): Promise<number> {
  if (!Array.isArray(names) || names.length > MAX_PREFETCH) return Promise.reject(new Error('Lista de bibliotecas Habbo inválida.'))
  filling ??= fill(cacheDir, names).finally(() => (filling = null))
  return filling
}

async function fill(cacheDir: string, names: unknown[]): Promise<number> {
  let fetched = 0
  for (const name of new Set(names)) {
    if (typeof name !== 'string' || !NAME.test(name)) continue
    if (
      await access(join(cacheDir, `${name}.nitro`)).then(
        () => true,
        () => false,
      )
    )
      continue
    try {
      await habboLibrary(cacheDir, name)
      fetched++
    } catch {
      // offline or refused: the next start tries again
    }
    await sleep(PACE_MS)
  }
  return fetched
}
