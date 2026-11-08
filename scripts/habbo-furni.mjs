// npm run habbo:moveis: draws, with Codex (its image_gen tool, on your ChatGPT login), the office
// furniture the Habbo catalog does not have (water cooler, foosball, ping-pong...), in the style of
// Habbo furniture, and turns each into a sprite at Habbo scale for the 2D view
// (src/renderer/src/assets/habbo/<key>.png, read by src/renderer/src/pixel/habbo.ts).
//   npm run habbo:moveis                 every sprite still missing
//   npm run habbo:moveis -- foosball mug redraws these
//   npm run habbo:moveis -- --process    only cuts the raw images again (arte-2d/habbo/) into sprites
// Real Habbo furniture from the HabboAssets Imager rides along as the style ruler.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexBin, drawImage } from './pixel/codex.mjs'
import { crop, downscaleMode, opaqueBounds, removeBackground, removeSpecks, createImage, paste } from './pixel/core.mjs'
import { decodePng, encodePng } from './pixel/png.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(root, 'arte-2d', 'habbo')
const OUT = join(root, 'src', 'renderer', 'src', 'assets', 'habbo')

/** Habbo furniture whose look the new art should match. */
const RULERS = ['uni_desk', 'fridge', 'exe_copier', 'table_plasto_round']

const STYLE = `Isometric pixel-art furniture sprite in the exact style of classic Habbo Hotel furniture (the reference images are real Habbo furniture: match their look).
Camera: Habbo's 2:1 isometric view from above (edges going sideways rise 1 pixel every 2 pixels).
Facing: the object's front faces the viewer's lower-RIGHT; its length runs along the diagonal from the upper-right to the lower-left.
Style: crisp hard-edged pixel art with clearly visible square pixels, a 1-pixel dark outline around the object, flat colors with 2-3 tone shading, light from the top-left, the top faces lightest. No anti-aliasing, no blur, no gradients, no texture noise.
ONE object only, whole, centered, filling most of the image. No floor, no floor tile, no wall, no shadow, no text, no labels, no people.
Background: perfectly flat solid pure green #00FF00 over the whole canvas (chroma key). Never use green #00FF00 in the object.`

/**
 * One job per sprite: what to draw and its width in Habbo pixels (a floor tile is 64 wide, so
 * a one-tile object is at most ~64 and a two-by-one ~96).
 */
export const JOBS = {
  waterCooler: {
    w: 40,
    prompt:
      'An office water cooler: a tall white plastic stand with a big upside-down translucent light-blue water bottle on top, a blue tap and a red tap on the front, a small drip tray under them, a stack of white paper cups on one side.',
  },
  foosball: {
    w: 84,
    prompt:
      'A foosball table (table football): a long red-painted wooden cabinet on four dark wooden legs, a green playing field with a white center line inside, several silver metal rods across the field with small red and blue player figures on them, black rod handles sticking out of both long sides.',
  },
  pingPong: {
    w: 100,
    prompt:
      'A ping-pong table (table tennis): a dark green table top with white border lines and a white center line, a low white net across the middle, four dark grey metal legs, two red paddles and a small white ball lying on top.',
  },
  barTable: {
    w: 44,
    prompt: 'A tall round standing bar table: a round light-oak wooden top on a single chrome pole with a flat round chrome base.',
  },
  meetingTable: {
    w: 150,
    prompt:
      'A big conference table for eight people: a WIDE rectangular top, about twice as long as it is wide (as wide as a door is tall, so it reads as a table, not a bench), smooth dark walnut wood with a slightly lighter edge, standing at desk height on two solid dark grey panel legs near the ends.',
  },
  clock: {
    w: 24,
    wall: true,
    prompt:
      'A round office wall clock hanging flat on a wall (the wall itself is not drawn): white face, black hour marks, black hands, a thin dark-grey frame. Seen in the isometric view, so the circle looks like a slanted ellipse facing the lower-right.',
  },
  wallCabinets: {
    w: 46,
    wall: true,
    prompt:
      'One module of a white kitchen wall cupboard hanging on a wall (the wall itself is not drawn): a box with two white doors on the front and two small silver handles, a light-grey bottom edge.',
  },
  paperStack: {
    w: 15,
    prompt: 'A neat stack of white paper sheets, slightly uneven, lying on a desk (the desk is not drawn).',
  },
  mug: {
    w: 11,
    prompt: 'A plain white coffee mug with a handle on the right side, with dark coffee inside.',
  },
  deskLamp: {
    w: 20,
    prompt:
      'A small adjustable desk lamp standing on a desk (the desk is not drawn): a round dark base, a thin bent metal arm, and a small cone-shaped lampshade pointing down and forward.',
  },
}

const rawFile = (key) => join(RAW, `${key}.png`)
const outFile = (key) => join(OUT, `${key}.png`)

/** Real Habbo furniture, 4x and nearest-neighbor, so Codex sees its pixels. */
async function rulers() {
  const files = []
  mkdirSync(RAW, { recursive: true })
  for (const name of RULERS) {
    const file = join(RAW, `_regua-${name}.png`)
    if (!existsSync(file)) {
      const res = await fetch(`https://www.habboassets.com/imaging/furniture/${name}.png?direction=2`, {
        headers: { 'User-Agent': 'agent-office' },
      })
      if (!res.ok) continue
      const img = decodePng(new Uint8Array(await res.arrayBuffer()))
      const big = createImage(img.width * 4, img.height * 4)
      for (let y = 0; y < big.height; y++)
        for (let x = 0; x < big.width; x++) {
          const s = ((y >> 2) * img.width + (x >> 2)) * 4
          big.data.set(img.data.subarray(s, s + 4), (y * big.width + x) * 4)
        }
      // a light background, like the Habbo catalog
      const bg = createImage(big.width + 32, big.height + 32)
      bg.data.fill(255)
      paste(bg, big, 16, 16)
      writeFileSync(file, encodePng(bg))
    }
    files.push(file)
  }
  return files
}

/** Raw Codex image -> sprite: background off, specks off, cropped, scaled down to the job's width. */
function processRaw(key) {
  const job = JOBS[key]
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

const argv = process.argv.slice(2)
const only = argv.filter((a) => !a.startsWith('--'))
const unknown = only.filter((k) => !JOBS[k])
if (unknown.length) {
  console.error(`Não conheço: ${unknown.join(', ')}. Os móveis são: ${Object.keys(JOBS).join(', ')}.`)
  process.exit(1)
}
if (argv.includes('--process')) {
  for (const key of only.length ? only : Object.keys(JOBS).filter((k) => existsSync(rawFile(k)))) console.log(`${key}: ${processRaw(key)}`)
  process.exit(0)
}
const bin = codexBin()
if (!bin) {
  console.error('O Codex não está instalado. Instale (npm i -g @openai/codex) e entre com sua conta ChatGPT (codex login).')
  process.exit(1)
}
const refs = await rulers()
const keys = only.length ? only : Object.keys(JOBS).filter((k) => !existsSync(outFile(k)))
let failed = 0
for (const key of keys) {
  const t0 = Date.now()
  process.stdout.write(`${key} … `)
  try {
    const job = JOBS[key]
    const img = await drawImage(bin, `${STYLE}\n\nThe object: ${job.prompt}`, refs)
    mkdirSync(RAW, { recursive: true })
    copyFileSync(img, rawFile(key))
    console.log(`ok em ${Math.round((Date.now() - t0) / 1000)} s, sprite ${processRaw(key)}`)
  } catch (e) {
    failed++
    console.log(`falhou: ${e instanceof Error ? e.message : e}`)
  }
}
if (!keys.length) console.log('Nada a gerar: todos os sprites existem. Passe o nome para redesenhar um.')
process.exit(failed ? 1 : 0)
