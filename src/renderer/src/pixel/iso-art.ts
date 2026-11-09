import * as THREE from 'three'
import { pxTag } from '../world/pixel-tag'

// The 2D view's furniture: our own isometric pixel art, bundled with the app
// (src/renderer/src/assets/iso/, drawn by `npm run arte:iso`). Each drawing faces one way:
//   front art: the object's front looks to the lower-right (direction 2); mirrored, direction 4;
//   back art ("<name>-back"): its back looks to the lower-right (direction 6); mirrored, 0.
// An object without back art shows its front from behind too. Tags with no art keep their
// 3D pieces, drawn flat by the painter.

const URLS = import.meta.glob('../assets/iso/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const urlOf = (name: string): string | undefined => URLS[`../assets/iso/${name}.png`]

/** Where a monitor's screen sits in its picture: its pixels (a mask) and its corners. */
export interface ScreenArea {
  mask: HTMLCanvasElement
  x: number
  y: number
  /** Leftmost and rightmost columns of the mask; the top of each; the screen's height. */
  left: number
  right: number
  topLeft: number
  topRight: number
  height: number
}

export interface FurniUse {
  img: HTMLCanvasElement
  dy: number
  /** Copies side by side (kitchen counter modules), along x or z. */
  repeat: { n: number; axis: 'x' | 'z' } | null
  /** Always false: mirrored pictures come ready, their screens mirrored with them. */
  flip: boolean
  /** A monitor: where its screen is, and what to show there (the agent's screen). */
  screen?: { area: ScreenArea; src: HTMLCanvasElement | HTMLImageElement | null }
}

interface Art {
  img: HTMLCanvasElement
  screen: ScreenArea | null
}

const sources = new Map<string, HTMLImageElement | 'loading' | 'missing'>()
const built = new Map<string, Art>()
const listeners = new Set<() => void>()

/** Runs whenever a picture finishes loading, so the view can draw it. */
export function onFurniArt(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** Pictures loaded so far, for the perf panel. */
export function furniArtCount(): number {
  let n = 0
  for (const s of sources.values()) if (s instanceof HTMLImageElement) n++
  return n
}

function source(name: string): HTMLImageElement | 'loading' | 'missing' {
  const got = sources.get(name)
  if (got) return got
  const url = urlOf(name)
  if (!url) {
    sources.set(name, 'missing')
    return 'missing'
  }
  const img = new Image()
  sources.set(name, 'loading')
  img.onload = () => {
    sources.set(name, img)
    for (const f of listeners) f()
  }
  img.onerror = () => sources.set(name, 'missing')
  img.src = url
  return 'loading'
}

const isScreen = (r: number, g: number, b: number) => r > 190 && g < 90 && b > 190

/** A picture ready to draw: mirrored or not, half size or not, its magenta screen cut out as a mask. */
function art(name: string, flip: boolean, half: boolean): Art | 'loading' | null {
  const key = `${name}|${flip ? 1 : 0}|${half ? 1 : 0}`
  const done = built.get(key)
  if (done) return done
  const src = source(name)
  if (src === 'missing') return null
  if (src === 'loading') return 'loading'
  const w = half ? Math.max(1, Math.round(src.naturalWidth / 2)) : src.naturalWidth
  const h = half ? Math.max(1, Math.round(src.naturalHeight / 2)) : src.naturalHeight
  const img = document.createElement('canvas')
  img.width = w
  img.height = h
  const ctx = img.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  if (flip) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(src, 0, 0, w, h)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const out: Art = { img, screen: screenOf(img) }
  built.set(key, out)
  return out
}

/** The magenta pixels of a picture become its screen: a mask, and a dark glass where they were. */
function screenOf(img: HTMLCanvasElement): ScreenArea | null {
  const ctx = img.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, img.width, img.height)
  const d = data.data
  const mask = document.createElement('canvas')
  mask.width = img.width
  mask.height = img.height
  const mctx = mask.getContext('2d')!
  const md = mctx.createImageData(img.width, img.height)
  let any = false
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || !isScreen(d[i], d[i + 1], d[i + 2])) continue
    any = true
    d.set([27, 31, 42, 255], i)
    md.data.set([255, 255, 255, 255], i)
  }
  if (!any) return null
  ctx.putImageData(data, 0, 0)
  mctx.putImageData(md, 0, 0)
  const column = (cx: number) => {
    let top = -1
    let bottom = -1
    for (let cy = 0; cy < mask.height; cy++)
      if (md.data[(cy * mask.width + cx) * 4 + 3]) {
        if (top < 0) top = cy
        bottom = cy
      }
    return { top, bottom }
  }
  let left = 0
  while (left < mask.width - 1 && column(left).top < 0) left++
  let right = mask.width - 1
  while (right > left && column(right).top < 0) right--
  const l = column(left)
  return { mask, x: 0, y: 0, left, right, topLeft: l.top, topRight: column(right).top, height: l.bottom - l.top + 1 }
}

/** A bundled sprite by name (assets/iso/<name>.png), mirrored or not; null until it loads. */
export function isoSprite(name: string, flip = false): HTMLCanvasElement | null {
  const a = art(name, flip, false)
  return a && a !== 'loading' ? a.img : null
}

// ---------- which picture for which object ----------

/** Direction (2 = front facing +x, 4 = +z, 0 = −z, 6 = −x) of an object's front (+z local). */
const FWD = new THREE.Vector3()
export function furniDirection(obj: THREE.Object3D): number {
  FWD.set(0, 0, 1).transformDirection(obj.matrixWorld)
  if (Math.abs(FWD.x) > Math.abs(FWD.z)) return FWD.x > 0 ? 2 : 6
  return FWD.z >= 0 ? 4 : 0
}

/** The art of each px() tag; `back`: it has a back view. */
interface Item {
  name: string
  back?: boolean
}
const it = (name: string, back = false): Item => ({ name, back })

/**
 * Drawings that came out mirrored (front to the lower-left): the view flips them the other way.
 * Check where the front went after redrawing one (`npm run arte:iso -- <key>`).
 */
const DRAWN_LEFT = new Set(['officeChair', 'bossChair', 'simpleChair', 'armchair'])

const BY_TAG: Record<string, Item> = {
  desk: it('desk'),
  bossDesk: it('bossDesk'),
  monitor: it('monitor', true),
  monitorBack: it('monitor', true),
  keyboard: it('keyboard'),
  laptop: it('laptop'),
  deskLamp: it('deskLamp'),
  mug: it('mug'),
  paperStack: it('paperStack'),
  officeChair: it('officeChair', true),
  bossChair: it('bossChair', true),
  simpleChair: it('simpleChair', true),
  stool: it('stool'),
  beanBag: it('beanBag'),
  armchair: it('armchair', true),
  coffeeTable: it('coffeeTable'),
  lowTable: it('lowTable'),
  roundTable: it('roundTable'),
  barTable: it('barTable'),
  meetingTable: it('meetingTable'),
  floorLamp: it('floorLamp'),
  bookshelf: it('bookshelf'),
  arcade: it('arcade'),
  foosball: it('foosball'),
  pingPong: it('pingPong'),
  fridge: it('fridge'),
  microwave: it('microwave'),
  coffeeMachine: it('coffeeMachine'),
  kitchenCounter: it('kitchenCounter'),
  wallCabinets: it('wallCabinets'),
  waterCooler: it('waterCooler'),
  printer: it('printer'),
  cabinet: it('cabinet'),
  trash: it('trash'),
  clock: it('clock'),
}

/** Plant kinds of world/furniture.ts. */
const PLANTS: Record<string, Item> = {
  tall: it('plant-tall'),
  bush: it('plant-bush'),
  fern: it('plant-fern'),
  flower: it('plant-flower'),
  cactus: it('plant-cactus'),
}

/** Sofas by length. */
const SOFAS: Record<number, Item> = { 3: it('sofa3', true), 2: it('sofa2', true), 1: it('armchair', true) }

/** Tags drawn as a row of one-tile modules, `len` long (counters, wall cupboards). */
const MODULES = new Set(['kitchenCounter', 'wallCabinets'])

/** The picture of a monitor's screen: the texture of its live panel. */
const screens = new WeakMap<THREE.Object3D, HTMLCanvasElement | HTMLImageElement | null>()
function liveScreen(obj: THREE.Object3D): HTMLCanvasElement | HTMLImageElement | null {
  if (screens.has(obj)) return screens.get(obj)!
  let src: HTMLCanvasElement | HTMLImageElement | null = null
  obj.traverse((o) => {
    const mats = (o as THREE.Mesh).material
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      const image = (m as THREE.MeshBasicMaterial).map?.image as unknown
      if (!src && (image instanceof HTMLCanvasElement || image instanceof HTMLImageElement)) src = image
    }
  })
  screens.set(obj, src)
  return src
}

/**
 * The picture for a built object: 'loading' while it is on its way (draw nothing for a moment),
 * 'hidden' for parts another picture already shows, null when it has none (draw the 3D pieces).
 * `small` asks for the half-size picture (a plant on a desk).
 */
export function furniFor(obj: THREE.Object3D, small = false): FurniUse | 'loading' | 'hidden' | null {
  const tag = pxTag(obj)
  if (!tag) return null
  // the keyboard's picture comes with its mouse
  if (tag.key === 'mouse') return urlOf('keyboard') ? 'hidden' : null
  const item = tag.key === 'plant' ? PLANTS[String(tag.kind)] : tag.key === 'sofa' ? SOFAS[Number(tag.len)] : BY_TAG[tag.key]
  if (!item) return null
  const dir = furniDirection(obj)
  const away = dir === 0 || dir === 6
  const back = away && item.back && urlOf(`${item.name}-back`)
  // front art faces 2 (mirrored: 4); back art has its back to 2, the object facing 6 (mirrored: 0)
  const name = back ? `${item.name}-back` : item.name
  const flip = (back ? dir === 0 : dir === 4 || dir === 0) !== DRAWN_LEFT.has(name)
  const a = art(name, flip, small)
  if (!a || a === 'loading') return a
  const len = Number(tag.len) || 1
  const repeat = MODULES.has(tag.key) && len > 1 ? { n: len, axis: dir === 2 || dir === 6 ? ('z' as const) : ('x' as const) } : null
  return { img: a.img, dy: 0, repeat, flip: false, screen: a.screen ? { area: a.screen, src: liveScreen(obj) } : undefined }
}

const scratch = document.createElement('canvas')

/**
 * Draws `src` (the agent's screen) into the monitor's screen, the monitor's picture being at
 * (ox, oy): slanted along the screen's top edge, cut to its pixels.
 */
export function drawScreen(
  ctx: CanvasRenderingContext2D,
  area: ScreenArea,
  src: CanvasImageSource & { width: number; height: number },
  ox: number,
  oy: number,
): void {
  const { mask } = area
  if (!src.width || !src.height) return
  scratch.width = mask.width
  scratch.height = mask.height
  const s = scratch.getContext('2d')!
  const across = area.right - area.left + 1
  s.imageSmoothingEnabled = true
  s.imageSmoothingQuality = 'high'
  s.setTransform(across / src.width, (area.topRight - area.topLeft) / src.width, 0, area.height / src.height, area.left, area.topLeft)
  s.drawImage(src, 0, 0)
  s.setTransform(1, 0, 0, 1, 0, 0)
  s.globalCompositeOperation = 'destination-in'
  s.drawImage(mask, 0, 0)
  s.globalCompositeOperation = 'source-over'
  ctx.drawImage(scratch, ox + area.x, oy + area.y)
}
