import * as THREE from 'three'
import { pxTag } from '../world/pixel-tag'
import { computerArt, onComputerArt, type ComputerPart, type ScreenArea } from './habbo-computer'

// The 2D view draws the office with Habbo art, fetched live from the HabboAssets Imager
// (https://www.habboassets.com/api, "Imager"): furniture by classname and direction, and the
// standing avatar by figure string while its clothing libraries load (pixel/figure.ts
// assembles the animated ones). The Imager is public and needs no token; renders it has not cached yet are
// limited to 60 a minute per IP, so a refused image is asked again later. Until an image
// arrives (or when the network is down) the painter draws that object from its 3D pieces.

const IMAGER = 'https://www.habboassets.com/imaging'
/** How long to wait before asking again for an image the Imager refused (429) or failed to send. */
const RETRY_MS = [15_000, 60_000, 300_000]

interface Entry {
  img: HTMLImageElement
  ok: boolean
  tries: number
  /** No new request before this time (after an error). */
  waitUntil: number
}

const images = new Map<string, Entry>()
const listeners = new Set<() => void>()
onComputerArt(() => {
  for (const f of listeners) f()
})

/** Runs whenever a Habbo image arrives, so the view can draw it. */
export function onHabboImage(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

function load(url: string): HTMLImageElement | null {
  let e = images.get(url)
  if (e?.ok) return e.img
  const now = performance.now()
  if (e && e.img.src && !e.img.complete) return null
  if (e && now < e.waitUntil) return null
  if (!e) {
    e = { img: new Image(), ok: false, tries: 0, waitUntil: 0 }
    images.set(url, e)
  }
  const entry = e
  const img = new Image()
  // the Imager answers with Access-Control-Allow-Origin: *, so the canvas stays readable
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.onload = () => {
    entry.img = img
    entry.ok = true
    for (const f of listeners) f()
  }
  img.onerror = () => {
    entry.waitUntil = performance.now() + RETRY_MS[Math.min(entry.tries, RETRY_MS.length - 1)]
    entry.tries++
  }
  entry.img = img
  img.src = url
  return null
}

/** One of our own sprites, bundled with the app: no retries, no CORS. */
function loadLocal(url: string): HTMLImageElement | null {
  let e = images.get(url)
  if (!e) {
    const img = new Image()
    e = { img, ok: false, tries: 0, waitUntil: 0 }
    images.set(url, e)
    const entry = e
    img.onload = () => {
      entry.ok = true
      for (const f of listeners) f()
    }
    img.src = url
  }
  return e.ok ? e.img : null
}

/** The Imager refused or failed this image at least once and it has not arrived since. */
function failed(url: string): boolean {
  const e = images.get(url)
  return !!e && !e.ok && e.tries > 0
}

/** Images the Imager has sent so far, for the perf panel. */
export function habboCount(): number {
  let n = 0
  for (const e of images.values()) if (e.ok) n++
  return n
}

// ---------- furniture ----------

/** Habbo direction (2 = facing +x, 4 = +z, 0 = −z, 6 = −x) for an object's front (+z local). */
const FWD = new THREE.Vector3()
export function furniDirection(obj: THREE.Object3D): number {
  FWD.set(0, 0, 1).transformDirection(obj.matrixWorld)
  if (Math.abs(FWD.x) > Math.abs(FWD.z)) return FWD.x > 0 ? 2 : 6
  return FWD.z >= 0 ? 4 : 0
}

/** Directions each item has in the Imager; the rest fall back to the nearest one it has. */
interface Furni {
  name: string
  dirs: number[]
  /** Nudge in art pixels, for art whose floor point is not its lowest pixel. */
  dy?: number
  /** Our own art (src/renderer/src/assets/habbo/<name>.png), drawn facing `dirs[0]`; the other direction is its mirror. */
  local?: boolean
}
const f = (name: string, dirs: number[] = [0, 2, 4, 6], dy = 0): Furni => ({ name, dirs, dy })

// Office furniture the Habbo catalog lacks, drawn in its style with Codex (npm run habbo:moveis).
const LOCAL_URLS = import.meta.glob('../assets/habbo/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const localUrl = (name: string): string | undefined => LOCAL_URLS[`../assets/habbo/${name}.png`]
/**
 * `facing`: the direction whose placement the art shows as drawn (2: the object's length, or its
 * front, along the down-left diagonal; 4: along the down-right one). The other is its mirror.
 */
const own = (name: string, facing: 2 | 4, dy = 0): Furni => ({ name, dirs: [facing, 6 - facing], dy, local: true })

/** Plant kinds of world/furniture.ts. */
const PLANTS: Record<string, Furni> = {
  tall: f('plant_yukka', [0]),
  bush: f('rela_plant', [0]),
  fern: f('plant_cruddy', [0]),
  flower: f('plant_rose', [0]),
  cactus: f('plant_small_cactus', [0]),
}

/** The Habbo furniture that stands in for each px() tag; missing tags keep their 3D pieces. */
const BY_TAG: Record<string, Furni> = {
  desk: f('uni_desk', [2, 4]),
  bossDesk: f('exe_table', [2, 4]),
  officeChair: f('exe_chair2'),
  bossChair: f('exe_chair2'),
  simpleChair: f('chair_norja'),
  armchair: f('sofachair_silo'),
  coffeeTable: f('exe_s_table', [0]),
  lowTable: f('table_silo_small', [0]),
  roundTable: f('table_plasto_round', [0]),
  bookshelf: f('shelves_polyfon', [2, 4]),
  printer: f('exe_copier', [2, 4]),
  floorLamp: f('lamp_basic', [0]),
  trash: f('room_wl15_trashbin', [0]),
  arcade: f('arcade_cab', [2, 4]),
  beanBag: f('cubie_beanbag_b', [2, 4]),
  stool: f('hc2_barchair', [0]),
  fridge: f('fridge', [2, 4]),
  microwave: f('hygge_c25_microwave', [2, 4]),
  coffeeMachine: f('ktchn15_coffeemaker', [2, 4]),
  kitchenCounter: f('hygge_c25_counter1', [2, 4]),
  laptop: f('computer_laptop'),
  cabinet: f('army_c15_cabinet', [2, 4]),
  // ours (the facing is the one each drawing came out in)
  waterCooler: own('waterCooler', 2),
  foosball: own('foosball', 4),
  pingPong: own('pingPong', 2),
  barTable: own('barTable', 2),
  meetingTable: own('meetingTable', 2),
  clock: own('clock', 4),
  wallCabinets: own('wallCabinets', 4),
  paperStack: own('paperStack', 2),
  mug: own('mug', 2),
  deskLamp: own('deskLamp', 2),
}

/** Tags drawn as a row of one-tile modules, `len` long (counters, wall cupboards). */
const MODULES = new Set(['kitchenCounter', 'wallCabinets'])

/** Sofas by length: the three-seat and the two-seat Habbo sofas. */
const SOFAS: Record<number, Furni> = { 3: f('exe_sofa', [2, 4]), 2: f('sofa_silo', [2, 4]) }

function nearest(dirs: number[], want: number): number {
  if (dirs.includes(want)) return want
  // a back view it lacks shows the front; a side it lacks shows the other side
  const order: Record<number, number[]> = { 0: [2, 6, 4], 6: [4, 0, 2], 2: [4, 0, 6], 4: [2, 6, 0] }
  return order[want].find((d) => dirs.includes(d)) ?? dirs[0]
}

/** The parts of Habbo's computer each tag shows (pixel/habbo-computer.ts). */
const COMPUTER: Record<string, ComputerPart> = { monitor: 'monitor', keyboard: 'keyboard', monitorBack: 'monitor' }

export interface FurniUse {
  img: HTMLImageElement | HTMLCanvasElement
  dy: number
  /** Copies side by side (kitchen counter modules), along x or z. */
  repeat: { n: number; axis: 'x' | 'z' } | null
  /** Draw mirrored: our own art seen from the other side. */
  flip: boolean
  /** A monitor: where its screen is, and what to show there (the agent's screen). */
  screen?: { area: ScreenArea; src: HTMLCanvasElement | HTMLImageElement | null }
}

/** The picture a monitor's screen shows: the texture of its live panel. */
const screens = new WeakMap<THREE.Object3D, HTMLCanvasElement | HTMLImageElement | null>()
function screenOf(obj: THREE.Object3D): HTMLCanvasElement | HTMLImageElement | null {
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
 * The Habbo picture for a built object. 'loading' while it is on its way (draw nothing: the 3D
 * pieces would flash for a moment), null when it has none or the Imager failed (draw the 3D
 * pieces). `small` asks for the half-size render (a plant on a desk).
 */
export function furniFor(obj: THREE.Object3D, small = false): FurniUse | 'loading' | 'hidden' | null {
  const tag = pxTag(obj)
  if (!tag) return null
  const part = COMPUTER[tag.key]
  if (part) {
    const art = computerArt(part, furniDirection(obj))
    if (!art || art === 'loading') return art
    return { img: art.img, dy: 0, repeat: null, flip: false, screen: art.screen ? { area: art.screen, src: screenOf(obj) } : undefined }
  }
  // Habbo's keyboard comes with its mouse
  if (tag.key === 'mouse') return computerArt('keyboard', 4) === null ? null : 'hidden'
  const item = tag.key === 'plant' ? PLANTS[String(tag.kind)] : tag.key === 'sofa' ? SOFAS[Number(tag.len)] : BY_TAG[tag.key]
  if (!item) return null
  const want = furniDirection(obj)
  // our art keeps the object's axis: a back view (0, 6) is the mirror-free view of its axis
  const dir = item.local ? (want === 0 || want === 4 ? 4 : 2) : nearest(item.dirs, want)
  const local = item.local ? localUrl(item.name) : undefined
  if (item.local && !local) return null
  const url = local ?? `${IMAGER}/furniture/${item.name}.png?direction=${dir}${small ? '&size=32' : ''}`
  const img = local ? loadLocal(local) : load(url)
  if (!img) return local || !failed(url) ? 'loading' : null
  const len = Number(tag.len) || 1
  const repeat = MODULES.has(tag.key) && len > 1 ? { n: len, axis: dir === 2 || dir === 6 ? ('z' as const) : ('x' as const) } : null
  return { img, dy: item.dy ?? 0, repeat, flip: !!local && dir !== item.dirs[0] }
}

// ---------- avatars ----------

/**
 * Habbo avatar direction for a facing angle (0 = +z, π/2 = +x): 2 faces +x (down-right),
 * 3 the viewer, 4 faces +z (down-left), 0 and 6 look away.
 */
export function avatarDirection(angle: number): number {
  return (((4 - Math.round(angle / (Math.PI / 4))) % 8) + 8) % 8
}

const avatarUrl = (figure: string, direction: number) => `${IMAGER}/avatar.png?figure=${encodeURIComponent(figure)}&direction=${direction}`

/**
 * The standing avatar (64 x 110) for a figure, turned to `direction`. The first call asks for
 * all 8 directions at once, so turning never waits on the network; until the wanted one arrives,
 * the nearest direction that has arrived stands in. 'loading' while none has arrived yet, null
 * when the Imager failed every one (the view then draws the 3D avatar).
 */
export function avatarImage(figure: string, direction: number): HTMLImageElement | 'loading' | null {
  let pending = false
  for (const step of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const d = (((direction + step) % 8) + 8) % 8
    const url = avatarUrl(figure, d)
    const img = load(url)
    if (img) {
      // keep asking for the rest in the background
      for (let k = 0; k < 8; k++) load(avatarUrl(figure, k))
      return img
    }
    if (!failed(url)) pending = true
  }
  return pending ? 'loading' : null
}
