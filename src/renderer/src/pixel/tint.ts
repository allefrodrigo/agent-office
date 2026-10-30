import type { Sprite } from './assets'

// Recolorable art (pixel-catalog.json: the molde-N sheets and the sprites marked "tint") is painted
// in five key hues, three tones each. Here each key becomes the color the 3D office uses for that
// part: a person's skin, hair and clothes (Configurações → Você, the agents' looks, the squad
// uniform), a sofa's fabric, a desk's top. Light and dark tones keep their shading.

/** What each key hue stands for. Furniture uses shirt (red, "color A") and pants (blue, "color B"). */
export type Slot = 'shirt' | 'skin' | 'hair' | 'shoes' | 'pants'
export type Palette = Partial<Record<Slot, string>>

const KEYS: [number, Slot][] = [
  [0, 'shirt'],
  [60, 'skin'],
  [120, 'hair'],
  [180, 'shoes'],
  [240, 'pants'],
]
/** Below this chroma (max - min) a pixel is outline, white or gray: it keeps its color. */
const MIN_CHROMA = 90
/** ...unless it is a deep shade of a pure key hue (dark, yet this saturated); muted browns stay out. */
const DEEP_SATURATION = 0.9
const DEEP_MIN_MAX = 24
/** ...or a pale shine of a key hue (light, faintly tinted, right on the key's hue); beige stays out. */
const PALE_MIN_CHROMA = 30
const PALE_MIN_MIN = 150
const PALE_HUE_SLACK = 12
/** Hair shine drifts further from green; only the people templates use the green key. */
const PALE_HAIR_SLACK = 30
/** How far from a key hue a pixel may be and still count as that key, in degrees. */
const HUE_SLACK = 30

interface Analysis {
  data: Uint8ClampedArray
  w: number
  h: number
  /** Per pixel: 0 = keeps its color, else 1 + index in KEYS. */
  slot: Uint8Array
  /** Per pixel: its lightness over the key's base tone (1 = base, < 1 shade, > 1 highlight). */
  light: Float32Array
}

const analyses = new WeakMap<HTMLImageElement, Analysis>()
const cache = new Map<string, HTMLCanvasElement>()
/** Recolored copies kept at most (a look or a fabric each); past it the oldest go. */
const MAX_CACHED = 400

function hueOf(r: number, g: number, b: number, max: number, chroma: number): number {
  let h: number
  if (max === r) h = ((g - b) / chroma) % 6
  else if (max === g) h = (b - r) / chroma + 2
  else h = (r - g) / chroma + 4
  return (h * 60 + 360) % 360
}

function analyse(img: HTMLImageElement): Analysis {
  let a = analyses.get(img)
  if (a) return a
  const w = img.naturalWidth
  const h = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, w, h).data
  const slot = new Uint8Array(w * h)
  const lum = new Float32Array(w * h)
  const buckets = KEYS.map(() => new Uint32Array(32))
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    if (data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    const deep = max >= DEEP_MIN_MAX && chroma / max >= DEEP_SATURATION
    const pale = chroma >= PALE_MIN_CHROMA && min >= PALE_MIN_MIN
    if (chroma < MIN_CHROMA && !deep && !pale) continue
    const hue = hueOf(r, g, b, max, chroma)
    let best = -1
    const paleOnly = chroma < MIN_CHROMA && !deep
    let gap = HUE_SLACK
    KEYS.forEach(([k, slot], n) => {
      const d = Math.min(Math.abs(hue - k), 360 - Math.abs(hue - k))
      if (paleOnly && d > (slot === 'hair' ? PALE_HAIR_SLACK : PALE_HUE_SLACK)) return
      if (d <= gap) {
        gap = d
        best = n
      }
    })
    if (best < 0) continue
    slot[p] = best + 1
    lum[p] = (max + min) / 510
    buckets[best][Math.min(31, Math.floor(lum[p] * 32))]++
  }
  // the base tone of each key is its median lightness: in detailed art the most common tone can be
  // a deep shade (an afro's curls), which would blow every lighter tone out to white
  const base = buckets.map((b) => {
    const total = b.reduce((s, n) => s + n, 0)
    let seen = 0
    const i = b.findIndex((n) => (seen += n) * 2 >= total)
    return (Math.max(0, i) + 0.5) / 32
  })
  const light = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) if (slot[p]) light[p] = lum[p] / base[slot[p] - 1]
  a = { data, w, h, slot, light }
  analyses.set(img, a)
  return a
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The sprite with its key hues swapped for `palette`; keys the palette leaves out keep the key color. */
export function tinted(key: string, s: Sprite, palette: Palette): CanvasImageSource {
  if (!s.tint) return s.img
  const id = `${key}|${KEYS.map(([, k]) => palette[k] ?? '').join(',')}`
  const hit = cache.get(id)
  if (hit) return hit
  const a = analyse(s.img)
  const colors = KEYS.map(([, k]) => (palette[k] ? rgb(palette[k]!) : null))
  const out = new ImageData(new Uint8ClampedArray(a.data), a.w, a.h)
  const d = out.data
  for (let p = 0; p < a.w * a.h; p++) {
    const n = a.slot[p]
    const c = n ? colors[n - 1] : null
    if (!c) continue
    const f = a.light[p]
    const i = p * 4
    for (let k = 0; k < 3; k++) {
      // shade by darkening; highlight by going towards white
      d[i + k] = f <= 1 ? c[k] * f : c[k] + (255 - c[k]) * Math.min(1, (f - 1) * 0.9)
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = a.w
  canvas.height = a.h
  canvas.getContext('2d', { willReadFrequently: true })!.putImageData(out, 0, 0)
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(id, canvas)
  return canvas
}
