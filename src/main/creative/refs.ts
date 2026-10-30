import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'
import { cleanTag, MAX_TAGS, type RefItem } from '@shared/social'
import { insideRoot } from './flow'

// Referências: creatives kept to study and copy. Files live in <floor>/referencias/<anunciante>/,
// the list (tags, where it came from, days running) in .criativo/referencias.json.

const MAX_REFS = 400
const VIDEO = /\.(mp4|mov|m4v|webm)$/i
const IMAGE = /\.(png|jpe?g|webp|gif)$/i
export const refsDir = (root: string) => join(root, 'referencias')
const indexFile = (root: string) => join(root, '.criativo', 'referencias.json')

function clean(root: string, raw: unknown): RefItem | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (typeof r.id !== 'string' || !/^[\w-]{1,40}$/.test(r.id) || typeof r.path !== 'string' || !insideRoot(root, r.path)) return null
  const kind = VIDEO.test(r.path) ? 'video' : IMAGE.test(r.path) ? 'image' : null
  if (!kind) return null
  return {
    id: r.id,
    path: r.path,
    kind,
    anunciante: typeof r.anunciante === 'string' ? r.anunciante.slice(0, 80) : '',
    ...(typeof r.inicio === 'string' ? { inicio: r.inicio.slice(0, 80) } : {}),
    ...(typeof r.dias === 'number' && Number.isFinite(r.dias) ? { dias: Math.max(0, Math.round(r.dias)) } : {}),
    ...(typeof r.link === 'string' && r.link.startsWith('https://www.facebook.com/ads/library/') ? { link: r.link.slice(0, 200) } : {}),
    tags: [...new Set((Array.isArray(r.tags) ? r.tags : []).map(cleanTag).filter((t): t is string => !!t))].slice(0, MAX_TAGS),
    capturedAt: typeof r.capturedAt === 'number' && Number.isFinite(r.capturedAt) ? r.capturedAt : Date.now(),
  }
}

/** The floor's references, newest first. Files deleted by hand drop out. */
export function listRefs(root: string): RefItem[] {
  try {
    const raw = JSON.parse(readFileSync(indexFile(root), 'utf8')) as { items?: unknown }
    const out: RefItem[] = []
    for (const r of Array.isArray(raw.items) ? raw.items : []) {
      const it = clean(root, r)
      if (it && !out.some((o) => o.id === it.id) && existsSync(it.path)) out.push(it)
    }
    return out
  } catch {
    return []
  }
}

function writeRefs(root: string, items: RefItem[]): RefItem[] {
  const list = items.sort((a, b) => b.capturedAt - a.capturedAt).slice(0, MAX_REFS)
  mkdirSync(join(root, '.criativo'), { recursive: true })
  writeFileSync(`${indexFile(root)}.tmp`, JSON.stringify({ version: 1, items: list }, null, 1))
  renameSync(`${indexFile(root)}.tmp`, indexFile(root))
  return list
}

/** New or recaptured items; a recaptured ad keeps its tags. */
export function addRefs(root: string, items: RefItem[]): RefItem[] {
  const now = listRefs(root)
  for (const it of items) {
    const old = now.find((o) => o.id === it.id)
    if (old) Object.assign(old, { ...it, tags: old.tags, capturedAt: old.capturedAt })
    else now.push(it)
  }
  return writeRefs(root, now)
}

/** Files picked by hand: copied to referencias/manual/ (they may come from anywhere on the machine). */
export function addManualRefs(root: string, paths: unknown): RefItem[] {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && isAbsolute(p) && (VIDEO.test(p) || IMAGE.test(p)) && existsSync(p)).slice(0, 40) : []
  if (!list.length) return listRefs(root)
  const dir = join(refsDir(root), 'manual')
  mkdirSync(dir, { recursive: true })
  const items: RefItem[] = list.map((src, i) => {
    const id = `m-${Date.now().toString(36)}${i}`
    const dest = insideRoot(root, src) ? src : join(dir, `${id}-${basename(src, extname(src)).slice(0, 40)}${extname(src).toLowerCase()}`)
    if (dest !== src) copyFileSync(src, dest)
    return { id, path: dest, kind: VIDEO.test(src) ? 'video' : 'image', anunciante: 'Manual', tags: [], capturedAt: Date.now() + i }
  })
  return addRefs(root, items)
}

export function setRefTags(root: string, id: unknown, tags: unknown): RefItem[] {
  const now = listRefs(root)
  const it = now.find((o) => o.id === id)
  if (!it) throw new Error('Essa referência não existe mais.')
  it.tags = [...new Set((Array.isArray(tags) ? tags : []).map(cleanTag).filter((t): t is string => !!t))].slice(0, MAX_TAGS)
  return writeRefs(root, now)
}

/** Out of the list; the file goes to referencias/.lixeira (never deleted outright). */
export function removeRef(root: string, id: unknown): RefItem[] {
  const now = listRefs(root)
  const it = now.find((o) => o.id === id)
  if (!it) return now
  const bin = join(refsDir(root), '.lixeira')
  mkdirSync(bin, { recursive: true })
  if (existsSync(it.path) && insideRoot(root, it.path)) renameSync(it.path, join(bin, `${Date.now()}-${basename(it.path)}`))
  return writeRefs(
    root,
    now.filter((o) => o !== it),
  )
}
