#!/usr/bin/env node
// npm run arte:iso: draws, with Codex (its image_gen tool, on your ChatGPT login), the furniture of
// the 2D view in the office's own isometric pixel style, and turns each drawing into a sprite
// (src/renderer/src/assets/iso/<key>.png, read by src/renderer/src/pixel/iso-art.ts).
// All the art is ours: no third-party sprite rides along. The first drawing (the desk) becomes
// the style ruler of the others, so the set stays coherent.
//   npm run arte:iso                      every sprite still missing (4 at a time)
//   npm run arte:iso -- desk sofa3        redraws these
//   npm run arte:iso -- --process [keys]  only cuts the raw images again (arte-2d/iso/) into sprites
//   npm run arte:iso -- --list            the jobs and which ones are done
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexBin, drawImage } from './pixel/codex.mjs'
import { createImage, crop, downscaleMode, opaqueBounds, removeBackground, removeSpecks } from './pixel/core.mjs'
import { decodePng, encodePng } from './pixel/png.mjs'
import { ISO_JOBS, ISO_STYLE, RULER } from './iso/prompts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(root, 'arte-2d', 'iso')
const OUT = join(root, 'src', 'renderer', 'src', 'assets', 'iso')
const PARALLEL = 4

const rawFile = (key) => join(RAW, `${key}.png`)
const outFile = (key) => join(OUT, `${key}.png`)

/** Raw Codex image -> sprite: background off, specks off, cropped, scaled down to the job's width. */
function processRaw(key) {
  const job = ISO_JOBS[key]
  const img = decodePng(new Uint8Array(readFileSync(rawFile(key))))
  const { image: clean } = removeBackground(img)
  const tidy = removeSpecks(clean, Math.round(clean.width * clean.height * 0.0004))
  const box = opaqueBounds(tidy)
  if (!box) throw new Error('a imagem ficou vazia depois de tirar o fundo')
  const art = crop(tidy, box)
  const w = job.w
  const h = Math.max(1, Math.round((art.height * w) / art.width))
  const small = downscaleMode(art, w, h)
  // the reduction leaves half-transparent edges: a sprite pixel is either there or not
  for (let i = 3; i < small.data.length; i += 4) small.data[i] = small.data[i] >= 128 ? 255 : 0
  mkdirSync(OUT, { recursive: true })
  writeFileSync(outFile(key), encodePng(small))
  return `${w} x ${h}`
}

/**
 * The blockout of a job: its box in exact 2:1 isometric (length to the upper-right, depth to the
 * upper-left, front face lower-right), gray on the green key, 6x. Codex draws the object into it,
 * so every sprite shares the floor's angle.
 */
function blockout(key) {
  const [L, D, H] = ISO_JOBS[key].size
  const S = 6
  const W = 1024
  const img = createImage(W, W)
  for (let i = 0; i < img.data.length; i += 4) img.data.set([0, 255, 0, 255], i)
  const a = [32 * S * L, -16 * S * L]
  const d = [-32 * S * D, -16 * S * D]
  const u = [0, -40 * S * H]
  const add = (...vs) => vs.reduce((p, v) => [p[0] + v[0], p[1] + v[1]], [0, 0])
  // center the box's picture in the canvas
  const pts = [[0, 0], a, d, u, add(a, d), add(a, u), add(d, u), add(a, d, u)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const o = [W / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, W / 2 - (Math.min(...ys) + Math.max(...ys)) / 2]
  const at = (...vs) => add(o, ...vs)
  const faces = [
    [[at(), at(a), at(a, u), at(u)], [150, 150, 150]],
    [[at(), at(d), at(d, u), at(u)], [190, 190, 190]],
    [[at(u), at(a, u), at(a, d, u), at(d, u)], [225, 225, 225]],
  ]
  const inside = (poly, x, y) => {
    let sign = 0
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i]
      const [x2, y2] = poly[(i + 1) % poly.length]
      const c = Math.sign((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1))
      if (c && sign && c !== sign) return false
      if (c) sign = c
    }
    return true
  }
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++)
      for (const [poly, rgb] of faces) if (inside(poly, x + 0.5, y + 0.5)) img.data.set([...rgb, 255], (y * W + x) * 4)
  const file = join(RAW, `_blockout-${key}.png`)
  writeFileSync(file, encodePng(img))
  return file
}

const argv = process.argv.slice(2)
const only = argv.filter((a) => !a.startsWith('--'))
if (argv.includes('--blockout')) {
  mkdirSync(RAW, { recursive: true })
  for (const key of only) console.log(blockout(key))
  process.exit(0)
}
if (argv.includes('--list')) {
  for (const key of Object.keys(ISO_JOBS)) console.log(`${existsSync(outFile(key)) ? '✓' : '·'} ${key}`)
  process.exit(0)
}
const unknown = only.filter((k) => !ISO_JOBS[k])
if (unknown.length) {
  console.error(`Não conheço: ${unknown.join(', ')}. Veja a lista com npm run arte:iso -- --list`)
  process.exit(1)
}
if (argv.includes('--process')) {
  for (const key of only.length ? only : Object.keys(ISO_JOBS).filter((k) => existsSync(rawFile(k)))) console.log(`${key}: ${processRaw(key)}`)
  process.exit(0)
}
const bin = codexBin()
if (!bin) {
  console.error('O Codex não está instalado. Instale (npm i -g @openai/codex) e entre com sua conta ChatGPT (codex login).')
  process.exit(1)
}
mkdirSync(RAW, { recursive: true })
const keys = only.length ? only : Object.keys(ISO_JOBS).filter((k) => !existsSync(outFile(k)))
let failed = 0

async function run(key) {
  const t0 = Date.now()
  try {
    const job = ISO_JOBS[key]
    // the ruler: our own first drawing, so every piece shares its pixel size and palette
    const ruler = key !== RULER && existsSync(rawFile(RULER))
    const refs = [blockout(key), ...(ruler ? [rawFile(RULER)] : [])]
    const guide = `GEOMETRY: the first attached image is a gray blockout box in the exact camera angle. Draw the object in the same position, angle and size, so it fills that box (the lighter top is its top, the darkest face is the side that faces the lower-right). Keep every edge parallel to the box's edges. Do not draw the gray box itself.${ruler ? ' STYLE: the second attached image is an approved sprite of the same game; match its pixel size, outline, shading and palette.' : ''}`
    const img = await drawImage(bin, `${ISO_STYLE}\n\n${guide}\n\nThe object: ${job.prompt}`, refs)
    copyFileSync(img, rawFile(key))
    console.log(`ok     ${key} em ${Math.round((Date.now() - t0) / 1000)} s, sprite ${processRaw(key)}`)
  } catch (e) {
    failed++
    console.log(`falhou ${key}: ${e instanceof Error ? e.message : e}`)
  }
}

// the ruler first, alone; the rest a few at a time
const queue = [...keys]
if (queue.includes(RULER)) await run(queue.splice(queue.indexOf(RULER), 1)[0])
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (queue.length) await run(queue.shift())
  }),
)
if (!keys.length) console.log('Nada a gerar: todos os sprites existem. Passe o nome para redesenhar um.')
else console.log(failed ? `${failed} falharam. Rode de novo com os nomes que faltaram.` : 'Pronto.')
process.exit(failed ? 1 : 0)
