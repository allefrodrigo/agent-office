#!/usr/bin/env node
// npm run arte:pessoas: draws, with Codex, the people of the 2D view in the office's own isometric
// pixel style: one recolorable sheet per hair style of the 3D avatar (Look.hairStyle 0-5), painted
// in key hues that the app swaps for each agent's skin, hair and clothes (pixel/tint.ts). The
// sheets land in src/renderer/src/assets/iso/people/, read by src/renderer/src/pixel/people.ts.
//   npm run arte:pessoas                      every sheet still missing (molde-0 first: the ruler)
//   npm run arte:pessoas -- molde-3           redraws this one
//   npm run arte:pessoas -- --process [keys]  only cuts the raw sheets again (arte-2d/iso/people/)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexBin, drawImage } from './pixel/codex.mjs'
import { cellArt, createImage, downscaleMode, paste, processSheet, removeBackground, removeSpecks, sliceSheet, snapKeyHues } from './pixel/core.mjs'
import { decodePng, encodePng } from './pixel/png.mjs'
import { AURA_PROMPT, AURA_SHEET, EXTRA_JOBS, EXTRA_SHEET, PEOPLE_JOBS as PEOPLE, PEOPLE_RULER, PEOPLE_SHEET } from './iso/people.mjs'

/** The people sheets, and the effort aura (same pipeline, no key hues). */
const PEOPLE_JOBS = { ...PEOPLE, ...EXTRA_JOBS, aura: () => AURA_PROMPT }
const isExtra = (key) => key.endsWith('-extra')
/** The main sheet an extra one rides with, as its reference. */
const baseOf = (key) => key.replace(/-extra$/, '')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(root, 'arte-2d', 'iso', 'people')
const OUT = join(root, 'src', 'renderer', 'src', 'assets', 'iso', 'people')
const PARALLEL = 3

const rawFile = (key) => join(RAW, `${key}.png`)
const outFile = (key) => join(OUT, `${key}.png`)

/** Height of each aura row (high, xhigh, max) in the processed sheet. */
const AURA_ROW_H = [92, 110, 128]

/**
 * The aura sheet: each row scaled as one (its 4 frames keep one scale, so the loop does not
 * pump), to its row's height, centered with the base on the cell bottom.
 */
function processAura(img) {
  const [cw, ch] = AURA_SHEET.cell
  const [cols, rows] = AURA_SHEET.grid
  const { image: clean } = removeBackground(img)
  const solid = removeSpecks(clean, Math.round(img.width * img.height * 0.0005))
  const { cells, warnings, labels } = sliceSheet(solid, cols, rows, { noun: ['quadro', 'quadros'] })
  const sheet = createImage(cw * cols, ch * rows)
  for (let r = 0; r < rows; r++) {
    const row = cells.slice(r * cols, r * cols + cols).filter((c) => c.box)
    const tallest = Math.max(...row.map((c) => c.box.h))
    const widest = Math.max(...row.map((c) => c.box.w))
    const k = Math.min(AURA_ROW_H[r] / tallest, (cw - 2) / widest)
    cells.slice(r * cols, r * cols + cols).forEach((cell, c) => {
      if (!cell.box) return
      const art = cellArt(solid, cell, labels)
      const ow = Math.max(1, Math.round(art.width * k))
      const oh = Math.max(1, Math.round(art.height * k))
      paste(sheet, downscaleMode(art, ow, oh), c * cw + Math.floor((cw - ow) / 2), r * ch + ch - 1 - oh)
    })
  }
  // grayscale art: a pixel that leans green is the key's fringe
  const d = sheet.data
  for (let i = 0; i < d.length; i += 4) if (d[i + 1] > d[i] + 24 && d[i + 1] > d[i + 2] + 24) d.fill(0, i, i + 4)
  return { image: sheet, warnings }
}

/** Cells with the face toward the viewer (scripts/iso/people.mjs, PEOPLE_SHEET.poses and EXTRA_SHEET.poses). */
const FACE_CELLS = { main: [0, 1, 2, 3, 8, 10, 11], extra: [0, 1, 4, 5, 6] }

/**
 * The same sheet with the eyes shut, for blinking: in each face cell, the eyes (dark pixels and
 * their white shine, fenced in by skin, the topmost such blots of the head) become skin with a
 * dark line across. Returns the image and how many eyes it found per cell.
 */
function blinkSheet(img, faceCells) {
  const out = { width: img.width, height: img.height, data: new Uint8Array(img.data) }
  const d = out.data
  const [cw, ch] = PEOPLE_SHEET.cell
  const cols = PEOPLE_SHEET.grid[0]
  const at = (x, y) => (y * img.width + x) * 4
  // any tone of the skin key, its deep shade included
  const skin = (i) => d[i + 3] && Math.min(d[i], d[i + 1]) > d[i + 2] + 30 && Math.abs(d[i] - d[i + 1]) < 40
  // near-black and colorless: a dark eyebrow (hair key) is not an eye. `limit` 90 takes any dark
  // pixel; 12 only the pure black of the eyes, so lashes touching the outline (#141414) let go
  const darkness = (limit) => (i) => d[i + 3] && Math.max(d[i], d[i + 1], d[i + 2]) < limit && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) < 30
  const white = (i) => d[i + 3] && Math.min(d[i], d[i + 1], d[i + 2]) > 200
  const found = {}
  /** The two eyes of a face cell under this idea of dark, at most two. */
  const eyesOf = (x0, y0, dark) => {
    // the head: from the first opaque row, 40 rows down
    let top = y0
    while (top < y0 + ch && ![...Array(cw).keys()].some((x) => d[at(x0 + x, top) + 3])) top++
    const y1 = Math.min(y0 + ch, top + 40)
    const seen = new Uint8Array(cw * ch)
    const blots = []
    for (let y = top; y < y1; y++)
      for (let x = x0; x < x0 + cw; x++) {
        const k = (y - y0) * cw + (x - x0)
        if (seen[k] || !(dark(at(x, y)) || white(at(x, y)))) continue
        const px = []
        let fenced = true
        let skinSides = 0
        let otherSides = 0
        const stack = [[x, y]]
        seen[k] = 1
        while (stack.length) {
          const [cx, cy] = stack.pop()
          px.push([cx, cy])
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (nx < x0 || nx >= x0 + cw || ny < y0 || ny >= y1) {
              fenced = false
              continue
            }
            const i = at(nx, ny)
            const nk = (ny - y0) * cw + (nx - x0)
            if (dark(i) || white(i)) {
              if (!seen[nk]) {
                seen[nk] = 1
                stack.push([nx, ny])
              }
            } else if (!d[i + 3]) fenced = false
            else if (skin(i)) skinSides++
            else otherSides++
          }
        }
        if (fenced && skinSides >= 3 * otherSides && px.length >= 2 && px.length <= 30 && px.some(([a, b]) => dark(at(a, b)))) blots.push(px)
      }
    const topOf = (b) => Math.min(...b.map((p) => p[1]))
    const first = Math.min(...blots.map(topOf))
    return blots
      .filter((b) => topOf(b) - first <= 5)
      .sort((a, b) => b.length - a.length)
      .slice(0, 2)
  }
  for (const cell of faceCells) {
    const x0 = (cell % cols) * cw
    const y0 = Math.floor(cell / cols) * ch
    let eyes = eyesOf(x0, y0, darkness(90))
    if (eyes.length < 2) eyes = eyesOf(x0, y0, darkness(12))
    // one eye shut alone would read as a wink: such a cell stays open
    if (eyes.length < 2) eyes = []
    found[cell] = eyes.length
    for (const eye of eyes) {
      const ys = eye.map((p) => p[1])
      const t = Math.min(...ys)
      const line = t + Math.floor(((Math.max(...ys) - t + 1) * 2) / 3)
      // the skin right above the eye paints it over
      const [sx, sy] = eye.find((p) => p[1] === t)
      const fill = d.slice(at(sx, sy - 1), at(sx, sy - 1) + 4)
      for (const [ex, ey] of eye) d.set(ey === line ? [20, 20, 20, 255] : fill, at(ex, ey))
    }
  }
  return { image: out, found }
}

function processRaw(key) {
  const img = decodePng(new Uint8Array(readFileSync(rawFile(key))))
  const aura = key === 'aura'
  const { image, warnings } = aura ? processAura(img) : processSheet(img, isExtra(key) ? EXTRA_SHEET : PEOPLE_SHEET)
  if (!aura) snapKeyHues(image)
  mkdirSync(OUT, { recursive: true })
  writeFileSync(outFile(key), encodePng(image))
  if (!aura) {
    const faces = isExtra(key) ? FACE_CELLS.extra : FACE_CELLS.main
    const { image: shut, found } = blinkSheet(image, faces)
    writeFileSync(join(OUT, `${key}-blink.png`), encodePng(shut))
    const missing = faces.filter((c) => found[c] !== 2)
    if (missing.length) console.log(`  aviso ${key}: olhos que não achei inteiros (célula: olhos) ${missing.map((c) => `${c}: ${found[c]}`).join(', ')}`)
  }
  for (const w of warnings) console.log(`  aviso ${key}: ${w}`)
  return `${image.width} x ${image.height}`
}

const argv = process.argv.slice(2)
const only = argv.filter((a) => !a.startsWith('--'))
const unknown = only.filter((k) => !PEOPLE_JOBS[k])
if (unknown.length) {
  console.error(`Não conheço: ${unknown.join(', ')}. Conheço: ${Object.keys(PEOPLE_JOBS).join(', ')}`)
  process.exit(1)
}
if (argv.includes('--process')) {
  for (const key of only.length ? only : Object.keys(PEOPLE_JOBS).filter((k) => existsSync(rawFile(k)))) console.log(`${key}: ${processRaw(key)}`)
  process.exit(0)
}
const bin = codexBin()
if (!bin) {
  console.error('O Codex não está instalado. Instale (npm i -g @openai/codex) e entre com sua conta ChatGPT (codex login).')
  process.exit(1)
}
mkdirSync(RAW, { recursive: true })
const keys = only.length ? only : Object.keys(PEOPLE_JOBS).filter((k) => !existsSync(outFile(k)))
let failed = 0

async function run(key) {
  const t0 = Date.now()
  try {
    const ref = isExtra(key) ? rawFile(baseOf(key)) : key !== PEOPLE_RULER && key !== 'aura' ? rawFile(PEOPLE_RULER) : null
    const ruler = !!ref && existsSync(ref)
    const img = await drawImage(bin, PEOPLE_JOBS[key](ruler), ruler ? [ref] : [])
    copyFileSync(img, rawFile(key))
    console.log(`ok     ${key} em ${Math.round((Date.now() - t0) / 1000)} s, folha ${processRaw(key)}`)
  } catch (e) {
    failed++
    console.log(`falhou ${key}: ${e instanceof Error ? e.message : e}`)
  }
}

const queue = [...keys]
if (queue.includes(PEOPLE_RULER)) await run(queue.splice(queue.indexOf(PEOPLE_RULER), 1)[0])
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (queue.length) await run(queue.shift())
  }),
)
if (!keys.length) console.log('Nada a gerar: todas as folhas existem. Passe o nome para redesenhar uma.')
else console.log(failed ? `${failed} falharam. Rode de novo com os nomes que faltaram.` : 'Pronto.')
process.exit(failed ? 1 : 0)
