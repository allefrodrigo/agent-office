import { Aura, AURA_COLORS } from '../world/aura'
import { HAIR_STYLES } from '@shared/describe'
import type { Look } from '@shared/types'
import type { Avatar } from '../world/avatar'
import type { Sprite } from './assets'
import type { Rect } from './engine'
import { blinking } from './eyes'
import { isoSprite } from './iso-art'
import { tinted } from './tint'
import { bounds, ellipse, gather, isoX, isoY, paint } from './voxel'

// People in the 2D view: our own isometric pixel-art office workers (npm run arte:pessoas), one
// recolorable sheet per hair style of the 3D avatar, dressed in each look's colors (pixel/tint.ts).
// Each sheet is drawn facing the viewer's lower-right (three-quarter front) and upper-right
// (three-quarter back); mirrored, those cover the other two diagonals. Until the sheets load, the
// 3D avatar is drawn flat.

/** One cell of a sheet, and where the soles sit in it (scripts/iso/people.mjs, PEOPLE_SHEET). */
const CELL_W = 64
const CELL_H = 100
const FOOT_X = 32
const FOOT_Y = 98
/**
 * Seated, the hips go on the seat: the seat's height in view pixels, and where the hips are in a
 * sitting cell, from the soles' point (FOOT_X, FOOT_Y). Every sitting pose has them about there.
 */
const SEAT_H = 18
const HIP = { x: -12, y: -20 }
/** Seen from behind, the hips sit in the middle of the cell. */
const HIP_BACK = { x: 0, y: -20 }
const BACK_SEATS = new Set<number>([7, 19])

/** Cells of a sheet (row * 4 + col). */
export const CELL = {
  front: 0,
  frontWalk: [1, 0, 2, 0],
  wave: 3,
  back: 4,
  backWalk: [5, 4, 6, 4],
  backSit: 7,
  frontSit: 8,
  down: 9,
  talk: 10,
  sitTalk: 11,
  // the extra sheet (molde-N-extra), numbered on from the main one
  playFront: [12, 13],
  playBack: [14, 15],
  relaxFront: [16, 17],
  typeFront: [8, 18],
  relaxBack: 19,
} as const

/** Tiles a player leans in towards the table game, so the hands reach the rods. */
const PLAY_REACH = 0.18

/** Cells past this one live in the extra sheet. */
const EXTRA = 12

/** Cells that show the face: they blink. */
const FACE_CELLS = new Set<number>([0, 1, 2, 3, 8, 10, 11, 12, 13, 16, 17, 18])

const URLS = import.meta.glob('../assets/iso/people/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const images = new Map<string, Sprite | 'loading' | 'missing'>()
/** Per sheet, the top row of each cell's art (the head), from the cell's top. */
const tops = new Map<string, number[]>()
const listeners = new Set<() => void>()

/** Runs when a sheet finishes loading, so the view can draw it. */
export function onPeopleArt(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

function load(name: string): Sprite | null {
  const got = images.get(name)
  if (got) return got === 'loading' || got === 'missing' ? null : got
  const url = URLS[`../assets/iso/people/${name}.png`]
  if (!url) {
    images.set(name, 'missing')
    return null
  }
  images.set(name, 'loading')
  const img = new Image()
  img.onload = () => {
    images.set(name, { img, w: img.naturalWidth, h: img.naturalHeight, tint: name !== 'aura' })
    for (const f of listeners) f()
  }
  img.onerror = () => images.set(name, 'missing')
  img.src = url
  return null
}

/** Where each cell's art starts (its top row), measured once per sheet. */
function topsOf(name: string, s: Sprite, cells = 12): number[] {
  let t = tops.get(name)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = s.w
  c.height = s.h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(s.img, 0, 0)
  const d = ctx.getImageData(0, 0, s.w, s.h).data
  t = Array.from({ length: cells }, (_, cell) => {
    const x0 = (cell % 4) * CELL_W
    const y0 = Math.floor(cell / 4) * CELL_H
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) if (d[((y0 + y) * s.w + x0 + x) * 4 + 3]) return y
    return CELL_H
  })
  tops.set(name, t)
  return t
}

/** A look's sheet, dressed: its image (eyes open or shut) and where each pose's head starts. */
export interface Dressed {
  image: CanvasImageSource
  /** Same sheet with the eyes shut, when there is one. */
  shut: CanvasImageSource | null
  /** The extra poses (playing, lounging, typing), open and shut eyes; null when missing. */
  extra: CanvasImageSource | null
  extraShut: CanvasImageSource | null
  /** Top of the art of every cell, the extra ones (12+) included when there. */
  tops: number[]
}

const styleOf = (look: Look) => ((look.hairStyle % HAIR_STYLES) + HAIR_STYLES) % HAIR_STYLES

/**
 * A look's sheet in its colors (`shirt`: the squad uniform); another style stands in for a
 * missing one. Null until the sheets load.
 */
export function dressLook(look: Look, shirt = look.shirt): Dressed | null {
  const want = styleOf(look)
  let style = want
  let sheet = load(`molde-${want}`)
  for (let i = 0; !sheet && i < HAIR_STYLES; i++) if (i !== want && (sheet = load(`molde-${i}`))) style = i
  if (!sheet) return null
  const palette = { skin: look.skin, hair: look.hair, shirt, pants: look.pants, shoes: look.shoes }
  const blink = load(`molde-${style}-blink`)
  const extra = load(`molde-${style}-extra`)
  const extraBlink = load(`molde-${style}-extra-blink`)
  return {
    image: tinted(`iso-people/${style}`, sheet, palette),
    shut: blink ? tinted(`iso-people/${style}-blink`, blink, palette) : null,
    extra: extra ? tinted(`iso-people/${style}-extra`, extra, palette) : null,
    extraShut: extraBlink ? tinted(`iso-people/${style}-extra-blink`, extraBlink, palette) : null,
    tops: [...topsOf(`molde-${style}`, sheet), ...(extra ? topsOf(`molde-${style}-extra`, extra, 8) : [])],
  }
}

/** The image and its own cell number for a cell of a dressed look; extra poses fall back to the main sheet. */
function source(d: Dressed, cell: number, shut: boolean): { img: CanvasImageSource; cell: number } {
  if (cell < EXTRA) return { img: (shut && d.shut) || d.image, cell }
  if (d.extra) return { img: (shut && d.extraShut) || d.extra, cell: cell - EXTRA }
  // no extra sheet: the nearest pose of the main one
  const plain: Record<number, number> = { 12: 0, 13: 0, 14: 4, 15: 4, 16: 8, 17: 8, 18: 8, 19: 7 }
  return { img: (shut && d.shut) || d.image, cell: plain[cell] ?? 0 }
}

const dressed = (av: Avatar): Dressed | null => dressLook(av.look, av.uniformColor ?? av.look.shirt)

const seated = (av: Avatar) => av.pose === 'sit' || av.pose === 'type' || av.pose === 'relax'

/**
 * The 8-way direction of a facing angle (0 = +z, π/2 = +x): 2 faces +x (down-right), 3 the
 * viewer, 4 faces +z (down-left), 0 and 6 look away, 7 straight up.
 */
export function avatarDirection(angle: number): number {
  return (((4 - Math.round(angle / (Math.PI / 4))) % 8) + 8) % 8
}

/** Facing away from the viewer: the chair's back covers the body. */
const away = (dir: number) => dir === 7 || dir === 0 || dir === 6

/** Draw order of a person among the furniture (bigger = later), on the same scale as voxel.depthOf. */
export function personKey(av: Avatar): number {
  const d = av.position.x + av.position.z
  if (av.isDown) return d + 0.3
  if (!seated(av) || av.stepping) return d + 0.05
  return away(avatarDirection(av.facing)) ? d - 0.2 : d + 0.4
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

type Posture = 'std' | 'wlk' | 'sit' | 'lay'

/** The cell to draw now, mirrored or not, and the posture (for the seat lift and the clicks). */
function frameOf(av: Avatar, t: number): { cell: number; flip: boolean; posture: Posture; dir: number } {
  const dir = avatarDirection(av.facing)
  const back = away(dir)
  // drawn facing 2 (front) and 0 (back); 4-5 and 6 are their mirrors
  const flip = back ? dir === 6 : dir === 4 || dir === 5
  if (av.isDown) return { cell: CELL.down, flip: dir >= 4, posture: 'lay', dir }
  if (av.stepping) {
    const step = Math.floor(av.stride / (Math.PI / 2)) & 3
    return { cell: (back ? CELL.backWalk : CELL.frontWalk)[step], flip, posture: 'wlk', dir }
  }
  const talking = av.pose === 'talk' && Math.floor(t * 7) % 2 === 1
  // each person keeps its own rhythm
  const phase = (hash(av.id) % 1000) / 1000
  if (av.pose === 'play') {
    // two frames rocking back and forth over the game, a beat each
    const beat = Math.floor(t * 3.2 + phase * 4) & 1
    return { cell: (back ? CELL.playBack : CELL.playFront)[beat], flip, posture: 'std', dir }
  }
  if (av.pose === 'relax') {
    // lounging; now and then an arm goes along the backrest for a while
    const stretch = (t / 7 + phase) % 1 > 0.7 ? 1 : 0
    return { cell: back ? CELL.relaxBack : CELL.relaxFront[stretch], flip, posture: 'sit', dir }
  }
  if (av.pose === 'type') return { cell: back ? CELL.backSit : CELL.typeFront[Math.floor(t * 6 + phase * 2) & 1], flip, posture: 'sit', dir }
  if (seated(av)) return { cell: back ? CELL.backSit : talking ? CELL.sitTalk : CELL.frontSit, flip, posture: 'sit', dir }
  // waving shows the face, whichever way they stood
  if (av.pose === 'wave') return { cell: Math.floor(t * 5) % 2 ? CELL.wave : CELL.front, flip: back ? dir === 0 : flip, posture: 'std', dir }
  return { cell: back ? CELL.back : talking ? CELL.talk : CELL.front, flip, posture: 'std', dir }
}

/** Draws one cell of a dressed sheet with its soles at (fx, fy), `s` screen pixels per art pixel. */
export function drawCell(ctx: CanvasRenderingContext2D, img: CanvasImageSource, cell: number, flip: boolean, fx: number, fy: number, s: number): void {
  const sx = (cell % 4) * CELL_W
  const sy = Math.floor(cell / 4) * CELL_H
  const w = Math.round(CELL_W * s)
  const h = Math.round(CELL_H * s)
  const y = fy - Math.round(FOOT_Y * s)
  if (flip) {
    ctx.save()
    ctx.translate(fx + Math.round(FOOT_X * s), y)
    ctx.scale(-1, 1)
    ctx.drawImage(img, sx, sy, CELL_W, CELL_H, 0, 0, w, h)
    ctx.restore()
  } else ctx.drawImage(img, sx, sy, CELL_W, CELL_H, fx - Math.round(FOOT_X * s), y, w, h)
}

/** Draws one person; returns where, for clicks. */
export function drawPerson(ctx: CanvasRenderingContext2D, av: Avatar, t: number): Rect {
  const s = av.root.scale.x
  const { cell, flip, posture, dir } = frameOf(av, t)
  const { fx, fy } = footOf(av, posture === 'sit' ? flip : null, BACK_SEATS.has(cell), av.pose === 'play' ? PLAY_REACH : 0)
  const sheet = dressed(av)
  // a flat dark ellipse under the feet (the seat casts its own)
  if (posture !== 'sit') {
    ctx.globalAlpha = 0.25
    ellipse(ctx, '#000000', fx, fy, (av.isDown ? 26 : 15) * s, 6 * s)
    ctx.globalAlpha = 1
  }

  if (!sheet) {
    // the sheets are not in yet: the 3D avatar itself, drawn flat
    av.root.updateMatrixWorld(true)
    const pieces = gather(av.root)
    paint(ctx, pieces)
    return bounds(pieces) ?? { x0: fx - 10, y0: fy - 60, x1: fx + 10, y1: fy }
  }
  const shake = av.flinch > 0 ? Math.round(Math.sin(t * 60) * 2) : 0
  const src = source(sheet, cell, FACE_CELLS.has(cell) && blinking(t, hash(av.id)))
  drawCell(ctx, src.img, src.cell, flip, fx + shake, fy, s)
  // from the soles to the top of the head, in this pose
  const tall = FOOT_Y - (sheet.tops[cell] ?? sheet.tops[src.cell])
  const rect: Rect =
    posture === 'lay'
      ? { x0: fx - 40 * s, y0: fy - 30 * s, x1: fx + 40 * s, y1: fy + 4 }
      : { x0: fx - 15 * s, y0: fy - tall * s, x1: fx + 15 * s, y1: fy }
  if (!av.isDown) drawCarry(ctx, av, dir, fx, fy, s, posture === 'sit')
  const gem = av.gemColor
  if (gem) drawGem(ctx, gem, fx, fy - Math.round((tall + 12) * s) + Math.round(Math.sin(t * 2.4 + hash(av.id)) * 1.5))
  return rect
}

/**
 * Where a person's sole point goes on screen: their floor spot standing; seated (`flip` = the
 * cell's mirroring), placed so the cell's hips land on the seat over that spot and the legs hang
 * over its front.
 */
function footOf(av: Avatar, flip: boolean | null, back = false, reach = 0): { fx: number; fy: number } {
  const s = av.root.scale.x
  // `reach`: tiles stepped forward, along the facing (0 = +z)
  const x = av.position.x + Math.sin(av.facing) * reach
  const z = av.position.z + Math.cos(av.facing) * reach
  const fx = Math.round(isoX(x, z))
  const fy = Math.round(isoY(x, 0, z))
  if (flip === null) return { fx, fy }
  const hip = back ? HIP_BACK : HIP
  return { fx: fx - Math.round(hip.x * s) * (flip ? -1 : 1), fy: fy - Math.round((SEAT_H + hip.y) * s) }
}

/**
 * The person standing towards the viewer, alone on a 64 x 110 canvas (CSS scales it up,
 * pixelated): the avatar of the reading screen, waving when `wave`. Drawn once its sheet loads.
 */
export function figureOf(av: Avatar, wave = false): HTMLCanvasElement | null {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 110
  c.className = 'figure'
  const ctx = c.getContext('2d')!
  const draw = () => {
    const sheet = dressed(av)
    if (!sheet) return false
    ctx.clearRect(0, 0, c.width, c.height)
    drawCell(ctx, sheet.image, wave ? CELL.wave : CELL.front, false, 32, 104, 1)
    return true
  }
  if (!draw()) {
    let tries = 0
    const timer = setInterval(() => {
      if (draw() || ++tries > 40 || !c.isConnected) clearInterval(timer)
    }, 500)
  }
  return c
}

// ---------- the effort aura ----------

/** Rows of the aura sheet, by effort; 4 frames each, 120 x 130, the base on the cell bottom. */
const AURA_ROW: Partial<Record<string, number>> = { high: 0, xhigh: 1, max: 2 }
const AURA_W = 120
const AURA_H = 130
const auras = new Map<string, HTMLCanvasElement>()

/** The grayscale aura sheet tinted with an effort's color: the white rim takes the color, the grays its shades. */
function auraIn(color: string): HTMLCanvasElement | null {
  const hit = auras.get(color)
  if (hit) return hit
  const sheet = load('aura')
  if (!sheet) return null
  const c = document.createElement('canvas')
  c.width = sheet.w
  c.height = sheet.h
  const ctx = c.getContext('2d')!
  ctx.drawImage(sheet.img, 0, 0)
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(sheet.img, 0, 0)
  auras.set(color, c)
  return c
}

/**
 * Draw order of a person's aura: just behind them, and behind the seat they sit on (the sofa's
 * back hides its lower part, the flames rise above it). Null without an aura.
 */
export function auraKey(av: Avatar): number | null {
  if (!av.effort || AURA_ROW[av.effort] === undefined || av.isDown) return null
  const d = av.position.x + av.position.z
  return seated(av) && !av.stepping ? d - 0.45 : personKey(av) - 0.01
}

/** The effort aura behind an agent: flickering flames, taller the harder it thinks, brighter while it works. */
export function drawAura(ctx: CanvasRenderingContext2D, av: Avatar, t: number): void {
  const s = av.root.scale.x
  const sitting = seated(av) && !av.stepping
  // centered on the body: seated, on the hips over the seat
  const fx = Math.round(isoX(av.position.x, av.position.z))
  const fy = Math.round(isoY(av.position.x, 0, av.position.z)) - (sitting ? Math.round(SEAT_H * s) : 0)
  const effort = av.effort
  const color = effort ? AURA_COLORS[effort] : undefined
  const row = effort ? AURA_ROW[effort] : undefined
  if (!color || row === undefined) return
  const art = auraIn(color)
  if (!art) {
    // the sheet is not in yet: a soft glow
    ctx.globalAlpha = 0.28
    ellipse(ctx, color, fx, fy - 36 * s, 22 * s, 42 * s)
    ctx.globalAlpha = 1
    return
  }
  const frame = Aura.reduced ? 0 : (Math.floor(t * 9 + (hash(av.id) % 4)) & 3)
  const w = Math.round(AURA_W * s)
  const h = Math.round(AURA_H * s)
  ctx.globalAlpha = av.auraFlares ? 0.8 : 0.5
  ctx.drawImage(art, frame * AURA_W, row * AURA_H, AURA_W, AURA_H, fx - Math.round(w / 2), fy - h + Math.round(4 * s), w, h)
  ctx.globalAlpha = 1
}

/** What each prop in hand is drawn with (assets/iso/<name>.png). */
const CARRY: Record<string, string> = { paper: 'carry-report', redPaper: 'carry-alert', mug: 'mug' }

/** Papers or a mug in the hand toward the viewer, at hand height, in front of the body. */
function drawCarry(ctx: CanvasRenderingContext2D, av: Avatar, dir: number, fx: number, fy: number, s: number, sitting: boolean): void {
  if (av.prop === 'none' || away(dir)) return
  const side = dir >= 4 ? -1 : 1
  const art = isoSprite(CARRY[av.prop], side < 0)
  if (!art) return
  // the hand: at the hip standing, on the lap sitting, a little to the side the figure faces
  const hand = sitting ? 22 : 30
  const w = Math.round(art.width * s)
  const h = Math.round(art.height * s)
  const x = Math.round(fx + side * 13 * s - w / 2)
  const y = Math.round(fy - hand * s - h / 2)
  ctx.drawImage(art, x, y, w, h)
}

/** The Sims-style diamond in the account's color, over the head. */
function drawGem(ctx: CanvasRenderingContext2D, color: string, cx: number, top: number): void {
  const rows = [1, 3, 5, 7, 7, 5, 3, 1]
  ctx.fillStyle = '#1c1830'
  rows.forEach((w, i) => ctx.fillRect(cx - (w + 2) / 2 + 0.5, top + i - 1, w + 2, 3))
  ctx.fillStyle = color
  rows.forEach((w, i) => ctx.fillRect(cx - w / 2 + 0.5, top + i, w, 1))
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillRect(cx - 1, top + 1, 1, 2)
}
