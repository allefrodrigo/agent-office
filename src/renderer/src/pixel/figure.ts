import type { Figure } from './habbo-catalog'
import { unpackNitro } from './nitro'

// Habbo avatars assembled part by part, like the Habbo client does: each piece of the figure
// (body, head, face, hair, shirt, sleeves, legs, shoes) is a sprite of its clothing library
// (.nitro from HabboAssets, fetched and cached by the main process), tinted with its palette
// color and drawn in the order of its direction. Every action of the client is there: walking
// (4 frames), sitting, lying, waving, carrying, talking and blinking.
//
// The parts of each look come from pixel/habbo-catalog.ts. The draw order per direction was measured
// against the HabboAssets Imager, which renders the standing pose: same parts, same pixels.

interface Library {
  assets: Record<string, { x: number; y: number; source?: string }>
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>
  image: ImageBitmap
}

/**
 * Draw order of the part types per direction (0-7), back to front. Measured: each order is the
 * one whose standing picture matches the Imager's best, across faces, hair (with and without a
 * hat), hats, glasses, sleeved and sleeveless shirts, coats, prints and belts.
 */
// prettier-ignore
const ORDER: Record<number, string[]> = {
  0: ['bd', 'sh', 'lg', 'lh', 'ls', 'lc', 'ch', 'cp', 'wa', 'rh', 'ca', 'rs', 'cc', 'rc', 'hd', 'fc', 'ey', 'hr', 'hrb', 'fa', 'ea', 'ha', 'he'],
  1: ['lc', 'ls', 'bd', 'sh', 'lg', 'lh', 'ch', 'cc', 'cp', 'wa', 'ca', 'rh', 'rs', 'rc', 'hd', 'hr', 'hrb', 'fc', 'fa', 'ey', 'ea', 'ha', 'he'],
  2: ['lh', 'bd', 'sh', 'lg', 'ls', 'lc', 'ch', 'cp', 'wa', 'rh', 'ca', 'rs', 'cc', 'rc', 'hd', 'hr', 'hrb', 'fc', 'fa', 'ey', 'ea', 'ha', 'he'],
  3: ['bd', 'sh', 'lg', 'ch', 'cp', 'cc', 'wa', 'ca', 'lh', 'ls', 'lc', 'rh', 'rs', 'rc', 'hd', 'hr', 'hrb', 'fc', 'fa', 'ey', 'ea', 'ha', 'he'],
  4: ['rh', 'bd', 'sh', 'lg', 'rs', 'rc', 'ch', 'cp', 'wa', 'lh', 'ca', 'ls', 'cc', 'lc', 'hd', 'hr', 'hrb', 'fc', 'fa', 'ey', 'ea', 'ha', 'he'],
  5: ['rs', 'rh', 'rc', 'bd', 'sh', 'lg', 'ch', 'cc', 'cp', 'wa', 'ca', 'lh', 'ls', 'lc', 'hd', 'hr', 'hrb', 'fc', 'fa', 'ey', 'ea', 'ha', 'he'],
  6: ['bd', 'sh', 'lg', 'rh', 'rs', 'rc', 'ch', 'cp', 'wa', 'lh', 'ca', 'ls', 'cc', 'lc', 'hd', 'fc', 'ey', 'hr', 'hrb', 'fa', 'ea', 'ha', 'he'],
  7: ['rh', 'lh', 'fa', 'ea', 'bd', 'sh', 'lg', 'ls', 'lc', 'rs', 'rc', 'ch', 'ca', 'cp', 'cc', 'wa', 'hd', 'fc', 'ey', 'hr', 'hrb', 'ha', 'he'],
}
/** Directions 4-6 are 2-0 mirrored, with left and right swapped. */
const MIRROR: Record<number, number> = { 4: 2, 5: 1, 6: 0 }
const SIDE: Record<string, string> = { lh: 'rh', rh: 'lh', ls: 'rs', rs: 'ls', lc: 'rc', rc: 'lc' }

const POSTURE_PARTS = new Set(['bd', 'lg', 'sh', 'lh', 'rh', 'ls', 'rs', 'lc', 'rc', 'ch', 'cc', 'cp', 'wa', 'ca'])
const HEAD_PARTS = new Set(['hd', 'hr', 'fc'])
const LEFT_ARM = new Set(['lh', 'ls', 'lc'])
const RIGHT_ARM = new Set(['rh', 'rs', 'rc'])

/** Canvas of one frame and where the asset origin sits in it (the Imager's 64 x 110 picture has it at 0, 100). */
const CW = 128
const CH = 128
const OX = 32
const OY = 112
/** The floor point under the feet, in frame pixels. */
export const FOOT = { x: OX + 32, y: OY + 4 }
export const FRAME = { w: CW, h: CH }

// ---------- libraries ----------

const libraries = new Map<string, Library | 'loading' | { failedAt: number }>()
const listeners = new Set<() => void>()
const RETRY_MS = 30_000

/** Runs whenever a library arrives, so the view can draw the avatars that wait for it. */
export function onFigureLibrary(f: () => void): void {
  listeners.add(f)
}

function library(name: string): Library | null {
  const got = libraries.get(name)
  if (got && got !== 'loading' && !('failedAt' in got)) return got
  if (got === 'loading') return null
  if (got && 'failedAt' in got && performance.now() - got.failedAt < RETRY_MS) return null
  libraries.set(name, 'loading')
  void loadLibrary(name).then(
    (lib) => {
      libraries.set(name, lib)
      for (const f of listeners) f()
    },
    (err) => {
      console.warn(`[habbo] biblioteca ${name}: ${err instanceof Error ? err.message : err}`)
      libraries.set(name, { failedAt: performance.now() })
    },
  )
  return null
}

async function loadLibrary(name: string): Promise<Library> {
  const files = await unpackNitro(await window.office.habboLibrary(name))
  const json = files.get(`${name}.json`)
  const png = files.get(`${name}.png`)
  if (!json || !png) throw new Error('pacote sem o JSON ou a imagem')
  const meta = JSON.parse(new TextDecoder().decode(json)) as { assets: Library['assets']; spritesheet: { frames: Library['frames'] } }
  const image = await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
  return { assets: meta.assets, frames: meta.spritesheet.frames, image }
}

/** True once every library of the figure is in (asks for the missing ones). */
export function figureReady(fig: Figure): boolean {
  let ok = true
  for (const p of fig.parts) if (!library(p.lib)) ok = false
  return ok
}

// ---------- one frame ----------

/** What each group of parts does in a frame; the frame number goes with the action. */
export interface Pose {
  /** Body and legs: std, wlk (frames 0-3), sit or lay. */
  posture: 'std' | 'wlk' | 'sit' | 'lay'
  frame: number
  /** The left arm waves (frames 0-1), or the right hand carries something. */
  arms?: 'wav' | 'crr'
  armFrame?: number
  /** The mouth moves (frames 0-1). */
  talk?: number
  /** Eyes shut. */
  blink?: boolean
}

const tints = new Map<string, HTMLCanvasElement>()
const frames = new Map<string, HTMLCanvasElement>()

/** A part's sprite, tinted with its palette color (multiply, as the client does); cached. */
function sprite(lib: Library, libName: string, asset: string, color: string | null): HTMLCanvasElement | null {
  const key = `${libName}|${asset}|${color}`
  let c = tints.get(key)
  if (c) return c
  const src = lib.assets[asset]?.source ?? asset
  const f = lib.frames[`${libName}_${src}`]?.frame
  if (!f) return null
  c = document.createElement('canvas')
  c.width = f.w
  c.height = f.h
  const ctx = c.getContext('2d')!
  ctx.drawImage(lib.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
  if (color) {
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, f.w, f.h)
    // multiply fills the transparent pixels too: keep only the sprite's own
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(lib.image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
  }
  tints.set(key, c)
  return c
}

/** The action (and frame) a part takes in a pose, most specific first. */
function actionsFor(type: string, pose: Pose): [string, number][] {
  const out: [string, number][] = []
  if (pose.posture === 'lay') out.push(['lay', 0])
  else {
    if (pose.arms === 'wav' && LEFT_ARM.has(type)) out.push(['wav', pose.armFrame ?? 0])
    if (pose.arms === 'crr' && RIGHT_ARM.has(type)) out.push(['crr', 0])
    if (type === 'ey' && pose.blink) out.push(['eyb', 0])
    if (HEAD_PARTS.has(type) && pose.talk !== undefined) out.push(['spk', pose.talk])
    if (POSTURE_PARTS.has(type) && pose.posture !== 'std') out.push([pose.posture, pose.frame])
  }
  out.push(['std', 0])
  return out
}

/**
 * One frame of the figure facing `dir` (0-7, Habbo directions) in a pose, on a 128 x 128
 * canvas with the feet at FOOT; cached. Null until its libraries arrive.
 */
export function figureFrame(fig: Figure, dir: number, pose: Pose): HTMLCanvasElement | null {
  const key = `${fig.key}|${dir}|${pose.posture}${pose.frame}|${pose.arms ?? ''}${pose.armFrame ?? ''}|${pose.talk ?? ''}|${pose.blink ? 1 : 0}`
  const cached = frames.get(key)
  if (cached) return cached
  if (!figureReady(fig)) return null
  const canvas = document.createElement('canvas')
  canvas.width = CW
  canvas.height = CH
  const ctx = canvas.getContext('2d')!
  const flip = dir in MIRROR
  const sd = MIRROR[dir] ?? dir
  for (const type of ORDER[dir]) {
    for (const part of fig.parts) {
      if (part.type !== type) continue
      const lib = library(part.lib)
      if (!lib) continue
      // mirrored, the left arm is drawn with the right arm's art
      const art = flip ? (SIDE[type] ?? type) : type
      let img: HTMLCanvasElement | null = null
      let off: { x: number; y: number } | undefined
      for (const [action, frame] of actionsFor(type, pose)) {
        for (const f of frame ? [frame, 0] : [0]) {
          const name = `h_${action}_${art}_${part.id}_${sd}_${f}`
          off = lib.assets[name]
          if (off) img = sprite(lib, part.lib, name, type === 'ey' ? null : part.color)
          if (img) break
        }
        if (img) break
      }
      if (!img || !off) continue
      const y = OY - off.y
      if (flip) {
        // mirrored around the middle of the Imager's 64-pixel picture
        const x = OX + 64 + off.x - img.width
        ctx.save()
        ctx.translate(x + img.width, y)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0)
        ctx.restore()
      } else ctx.drawImage(img, OX - off.x, y)
    }
  }
  // a long session meets many looks and poses: start over rather than grow without end
  if (frames.size > 4000) frames.clear()
  frames.set(key, canvas)
  return canvas
}
