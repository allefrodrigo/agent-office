import { unpackNitro } from './nitro'

// The desks' computers in the 2D view are Habbo's own flat-screen computer (computer_flatscreen),
// taken apart: its .nitro has the body (monitor, keyboard and mouse) on one layer and the screen
// on another. The monitor and the keyboard become two pictures, because a desk places them apart
// (and a desk with two monitors has one keyboard), and the screen layer gives the exact
// parallelogram where the agent's live screen is drawn.

const NAME = 'computer_flatscreen'
const RETRY_MS = 30_000

/** Which part of the computer: the monitor, or the keyboard and mouse. */
export type ComputerPart = 'monitor' | 'keyboard'

/** Where the screen sits in the monitor's picture: its pixels (a mask) and its corners. */
export interface ScreenArea {
  /** The screen's own pixels, at (x, y) in the picture. */
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

export interface ComputerArt {
  /** Same size and origin as the Imager's picture of the whole computer, so it stands in the same spot. */
  img: HTMLCanvasElement
  screen: ScreenArea | null
}

interface Bundle {
  assets: Record<string, { x: number; y: number; source?: string }>
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>
  image: ImageBitmap
}

let bundle: Bundle | 'loading' | { failedAt: number } | null = null
const built = new Map<string, ComputerArt | null>()
const listeners = new Set<() => void>()

/** Runs when the computer's art arrives. */
export function onComputerArt(f: () => void): void {
  listeners.add(f)
}

function load(): Bundle | null {
  if (bundle && bundle !== 'loading' && !('failedAt' in bundle)) return bundle
  if (bundle === 'loading') return null
  if (bundle && performance.now() - bundle.failedAt < RETRY_MS) return null
  bundle = 'loading'
  void read().then(
    (b) => {
      bundle = b
      for (const f of listeners) f()
    },
    (err) => {
      console.warn(`[habbo] ${NAME}: ${err instanceof Error ? err.message : err}`)
      bundle = { failedAt: performance.now() }
    },
  )
  return null
}

async function read(): Promise<Bundle> {
  const files = await unpackNitro(await window.office.habboFurni(NAME))
  const json = files.get(`${NAME}.json`)
  const png = files.get(`${NAME}.png`)
  if (!json || !png) throw new Error('pacote sem o JSON ou a imagem')
  const meta = JSON.parse(new TextDecoder().decode(json)) as { assets: Bundle['assets']; spritesheet: { frames: Bundle['frames'] } }
  const image = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
  return { assets: meta.assets, frames: meta.spritesheet.frames, image }
}

/** True once the art failed and is waiting to be asked again: draw the 3D pieces meanwhile. */
export function computerFailed(): boolean {
  return !!bundle && bundle !== 'loading' && 'failedAt' in bundle
}

/** One layer's sprite and offset for a direction (frame 0). */
function layer(b: Bundle, id: 'a' | 'b', dir: number): { c: HTMLCanvasElement; x: number; y: number } | null {
  const key = `${NAME}_64_${id}_${dir}_0`
  const asset = b.assets[key]
  const f = asset && b.frames[`${NAME}_${asset.source ?? key}`]?.frame
  if (!f) return null
  const c = document.createElement('canvas')
  c.width = f.w
  c.height = f.h
  c.getContext('2d')!.drawImage(b.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
  return { c, x: asset.x, y: asset.y }
}

/**
 * A part of the computer facing `dir` (0, 2, 4 or 6): 'loading' until the bundle arrives,
 * null when it has no such picture.
 */
export function computerArt(part: ComputerPart, dir: number): ComputerArt | 'loading' | null {
  const b = load()
  if (!b) return computerFailed() ? null : 'loading'
  const key = `${part}|${dir}`
  if (!built.has(key)) built.set(key, build(b, part, dir))
  return built.get(key)!
}

function build(b: Bundle, part: ComputerPart, dir: number): ComputerArt | null {
  const body = layer(b, 'a', dir)
  if (!body) return null
  const scr = layer(b, 'b', dir)
  // the back views have a 1-pixel placeholder for a screen
  const screen = scr && scr.c.width > 4 ? scr : null
  const img = body.c
  keepPart(img, part, screen ? { x: body.x - screen.x + (screen.c.width >> 1), y: body.y - screen.y + (screen.c.height >> 1) } : null)
  if (part === 'keyboard' || !screen) return { img, screen: null }
  return { img, screen: area(screen.c, body.x - screen.x, body.y - screen.y) }
}

/**
 * Erases, from the body, what is not the part: the monitor is the patch of pixels around the
 * screen's middle (or the biggest patch, seen from the back), the keyboard and mouse the rest.
 */
function keepPart(c: HTMLCanvasElement, part: ComputerPart, inMonitor: { x: number; y: number } | null): void {
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, c.width, c.height)
  const { width: w, height: h } = c
  const patch = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  for (let i = 0; i < w * h; i++) {
    if (patch[i] >= 0 || !data.data[i * 4 + 3]) continue
    const id = sizes.length
    let n = 0
    const stack = [i]
    patch[i] = id
    while (stack.length) {
      const p = stack.pop()!
      n++
      const px = p % w
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || (Math.abs((q % w) - px) > 1 && (q === p - 1 || q === p + 1))) continue
        if (patch[q] < 0 && data.data[q * 4 + 3]) {
          patch[q] = id
          stack.push(q)
        }
      }
    }
    sizes.push(n)
  }
  const monitor = inMonitor ? patch[inMonitor.y * w + inMonitor.x] : sizes.indexOf(Math.max(...sizes))
  for (let i = 0; i < w * h; i++) {
    if (patch[i] < 0) continue
    if ((patch[i] === monitor) !== (part === 'monitor')) data.data[i * 4 + 3] = 0
  }
  ctx.putImageData(data, 0, 0)
}

/** The screen layer's mask and corners, at (x, y) in the body's picture. */
function area(mask: HTMLCanvasElement, x: number, y: number): ScreenArea {
  const data = mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, mask.width, mask.height).data
  const column = (cx: number) => {
    let top = -1
    let bottom = -1
    for (let cy = 0; cy < mask.height; cy++)
      if (data[(cy * mask.width + cx) * 4 + 3]) {
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
  return { mask, x, y, left, right, topLeft: l.top, topRight: column(right).top, height: l.bottom - l.top + 1 }
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
