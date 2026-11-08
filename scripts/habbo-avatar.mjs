#!/usr/bin/env node
// npm run habbo:avatar -- <pasta>: extracts, from a Habbo client pack, the catalog of the 2D
// view's avatars (src/renderer/src/pixel/figure.ts and the look editor): every selectable
// clothing set of the categories the editor offers, the parts each one is made of, the library
// each part lives in, what each set hides and the color palettes. Writes
// src/renderer/src/pixel/habbo-avatar.json.
//
// The pack is the ZIP of a client build on HabboAssets (https://www.habboassets.com/api/v2/swfs/builds,
// "download"); unzip it and pass the folder that has figuremap.xml and gamedata/figuredata.xml.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'renderer', 'src', 'pixel', 'habbo-avatar.json')

/** The categories of the look editor, in src/shared/habbo-look.ts order. */
const TYPES = ['hd', 'hr', 'ha', 'he', 'ea', 'fa', 'ch', 'cc', 'cp', 'ca', 'wa', 'lg', 'sh']

const dir = process.argv[2]
if (!dir) {
  console.error('Uso: npm run habbo:avatar -- <pasta do pacote do cliente, com figuremap.xml e gamedata/figuredata.xml>')
  process.exit(1)
}
const figuredata = readFileSync(join(dir, 'gamedata', 'figuredata.xml'), 'utf8')
const figuremap = readFileSync(join(dir, 'figuremap.xml'), 'utf8')

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))

// the library of every part
const libOf = {}
for (const [, id, body] of figuremap.matchAll(/<lib id="(\w+)"[^>]*>([\s\S]*?)<\/lib>/g))
  for (const [, part, type] of body.matchAll(/<part id="(\d+)" type="(\w+)"\/>/g)) libOf[`${type}:${part}`] ??= id

// palettes: every color anyone can pick, [id, hex, club], in the client's order (an array: an
// object with numeric keys would come back sorted by id)
const palettes = {}
for (const [, id, body] of figuredata.matchAll(/<palette id="(\d+)">([\s\S]*?)<\/palette>/g)) {
  const colors = [...body.matchAll(/<color ([^>]*)>([0-9A-Fa-f]{6})<\/color>/g)]
    .map(([, tag, hex]) => ({ ...attrs(tag), hex }))
    .filter((c) => c.selectable === '1')
    .sort((a, b) => Number(a.index) - Number(b.index))
  palettes[id] = colors.map((c) => [Number(c.id), `#${c.hex.toLowerCase()}`, c.club !== '0' && c.club ? 1 : 0])
}

const settypes = {}
const sets = {}
const libs = {}
for (const [, tag, body] of figuredata.matchAll(/<settype ([^>]*)>([\s\S]*?)<\/settype>/g)) {
  const a = attrs(tag)
  if (!TYPES.includes(a.type)) continue
  settypes[a.type] = { palette: a.paletteid, mandatory: { M: a.mand_m_0 === '1', F: a.mand_f_0 === '1' } }
  sets[a.type] = []
  for (const [, setTag, setBody] of body.matchAll(/<set ([^>]*)>([\s\S]*?)<\/set>/g)) {
    const s = attrs(setTag)
    // what the client's editor offers; sellable sets are store items
    if (s.selectable !== '1' || s.sellable === '1') continue
    const raw = [...setBody.matchAll(/<part ([^>]*)\/>/g)].map((m) => attrs(m[1]))
    // figuremap.xml lists some parts only under their main type: the top of the hair (hrb 4) lives
    // in the library of hr 4. A part with no library of its own uses the one of its set's others.
    const shared = raw.map((p) => libOf[`${p.type}:${p.id}`]).find(Boolean)
    const parts = raw
      .filter((p) => libOf[`${p.type}:${p.id}`] ?? shared)
      .map((p) => [p.type, Number(p.id), p.colorable === '1' ? Number(p.colorindex) : 0])
    if (!parts.length) continue
    for (const p of raw) if (libOf[`${p.type}:${p.id}`] ?? shared) libs[`${p.type}:${p.id}`] = libOf[`${p.type}:${p.id}`] ?? shared
    const colors = Math.max(0, ...parts.map((p) => p[2]))
    const hidden = [...setBody.matchAll(/parttype="(\w+)"/g)].map((m) => m[1])
    sets[a.type].push({ id: Number(s.id), g: s.gender, club: s.club !== '0' ? 1 : 0, colors, parts, ...(hidden.length ? { hidden } : {}) })
  }
}

writeFileSync(OUT, JSON.stringify({ settypes, palettes, sets, libs }) + '\n')
const count = Object.values(sets).reduce((n, list) => n + list.length, 0)
console.log(`${OUT}: ${count} conjuntos em ${TYPES.length} categorias, ${new Set(Object.values(libs)).size} bibliotecas`)
