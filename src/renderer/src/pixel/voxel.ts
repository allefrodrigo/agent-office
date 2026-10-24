import * as THREE from 'three'

/**
 * The 3D office drawn as 2D pixel art, without WebGL: every mesh becomes flat shapes in a
 * front-top (3/4) oblique view, like a 16-bit RPG. One world unit is TILE art pixels; floor
 * tiles stay square and height goes straight up the screen, so a point (x, y, z) lands on
 * art pixel (x·T, (z − y)·T). Only two faces of a box show: its top and its front (+z).
 *
 * The catalog sprites (pixel/assets.ts) replace these shapes object by object; whatever has
 * no sprite yet is drawn from its 3D pieces here, so the 2D office is always complete.
 */

export const TILE = 32

export const artX = (x: number): number => x * TILE
export const artY = (y: number, z: number): number => (z - y) * TILE

type Shape = 'box' | 'cyl' | 'ball' | 'front' | 'top' | 'disc'

/** A face fill: a flat color or a texture (screens, books, rugs, the floor). */
type Paint = { color: string } | { image: CanvasImageSource; w: number; h: number; repeat: number }

export interface Piece {
  mesh: THREE.Mesh
  box: THREE.Box3
  shape: Shape
  top: Paint | null
  front: Paint | null
  alpha: number
  /** Redrawn every frame: its texture changes (screens, skies, boards) or it moves on its own. */
  live: boolean
}

const UP = new THREE.Vector3()
const FWD = new THREE.Vector3()
const styles = new Map<string, { top: string; front: string }>()
const tmp = new THREE.Color()
const WHITE = new THREE.Color('#ffffff')

/** CSS colors for a material color: the top a touch lighter, the front shaded (light from above). */
function shades(color: THREE.Color, lit: boolean): { top: string; front: string } {
  const key = `${color.getHex()}|${lit}`
  let s = styles.get(key)
  if (!s) {
    s = lit
      ? { top: tmp.copy(color).lerp(WHITE, 0.1).getStyle(), front: tmp.copy(color).multiplyScalar(0.78).getStyle() }
      : { top: color.getStyle(), front: color.getStyle() }
    styles.set(key, s)
  }
  return s
}

function paintOf(m: THREE.Material | undefined, face: 'top' | 'front'): Paint | null {
  if (!m) return null
  const mat = m as THREE.MeshLambertMaterial
  const map = mat.map
  const img = map?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined
  if (img && img.width && img.height) return { image: img, w: img.width, h: img.height, repeat: Math.max(1, Math.round(map!.repeat.x)) }
  if (!mat.color) return null
  const lit = m.type !== 'MeshBasicMaterial'
  const s = shades(mat.color, lit)
  return { color: face === 'top' ? s.top : s.front }
}

function isLive(mesh: THREE.Mesh, animated: boolean): boolean {
  if (animated || mesh.userData.live) return true
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return mats.some((m) => (m as THREE.MeshBasicMaterial).map?.userData.live)
}

/**
 * The visible meshes under `root` as pieces, back to front. World matrices must be current.
 * `skip` drops a subtree (its own drawer handles it).
 */
export function gather(root: THREE.Object3D, skip?: (o: THREE.Object3D) => boolean): Piece[] {
  const out: Piece[] = []
  const visit = (o: THREE.Object3D, animated: boolean) => {
    if (!o.visible || o.userData.pxSkip || (skip && o !== root && skip(o))) return
    const anim = animated || !!o.userData.animated
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      const p = piece(mesh, anim)
      if (p) out.push(p)
    }
    for (const c of o.children) visit(c, anim)
  }
  visit(root, false)
  // back to front: the deeper (smaller z) first, then the lower
  out.sort((a, b) => a.box.max.z - b.box.max.z || a.box.max.y - b.box.max.y)
  return out
}

function piece(mesh: THREE.Mesh, animated: boolean): Piece | null {
  const geo = mesh.geometry
  if (!geo.boundingBox) geo.computeBoundingBox()
  const box = geo.boundingBox!.clone().applyMatrix4(mesh.matrixWorld)
  if (box.isEmpty()) return null
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const first = mats[0] as THREE.MeshBasicMaterial
  const alpha = first.transparent ? first.opacity : 1
  if (alpha < 0.04 || !first.visible) return null
  const type = geo.type
  let shape: Shape = 'box'
  let top: Paint | null
  let front: Paint | null
  if (Array.isArray(mesh.material)) {
    // BoxGeometry groups: +x, -x, +y, -y, +z, -z
    top = paintOf(mats[2], 'top')
    front = paintOf(mats[4], 'front')
  } else {
    top = paintOf(first, 'top')
    front = paintOf(first, 'front')
  }
  if (type === 'PlaneGeometry' || type === 'CircleGeometry') {
    // a flat face: it shows only when it faces up or towards the viewer
    FWD.set(0, 0, 1).transformDirection(mesh.matrixWorld)
    if (FWD.z > 0.6) shape = type === 'CircleGeometry' ? 'disc' : 'front'
    else if (FWD.y > 0.6) shape = type === 'CircleGeometry' ? 'disc' : 'top'
    else return null
  } else if (type === 'CylinderGeometry') {
    UP.set(0, 1, 0).transformDirection(mesh.matrixWorld)
    shape = Math.abs(UP.y) > 0.7 ? 'cyl' : Math.abs(UP.z) > 0.7 ? 'disc' : 'box'
  } else if (type !== 'BoxGeometry') shape = 'ball'
  return { mesh, box, shape, top, front, alpha, live: isLive(mesh, animated) }
}

/** Art-pixel rectangle a piece covers. */
export function pieceRect(p: Piece): { x0: number; y0: number; x1: number; y1: number } {
  const b = p.box
  return {
    x0: Math.round(artX(b.min.x)),
    x1: Math.round(artX(b.max.x)),
    y0: Math.round(artY(b.max.y, b.min.z)),
    y1: Math.round(artY(b.min.y, b.max.z)),
  }
}

function fill(ctx: CanvasRenderingContext2D, paint: Paint | null, x0: number, y0: number, x1: number, y1: number): void {
  if (!paint || x1 <= x0 || y1 <= y0) return
  if ('color' in paint) {
    ctx.fillStyle = paint.color
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    return
  }
  const n = paint.repeat
  const w = (x1 - x0) / n
  for (let i = 0; i < n; i++) ctx.drawImage(paint.image, 0, 0, paint.w, paint.h, Math.round(x0 + i * w), y0, Math.round(w), y1 - y0)
}

/** A filled ellipse in whole pixels, row by row (arc() would blur the edge). */
export function ellipse(ctx: CanvasRenderingContext2D, color: string, cx: number, cy: number, rx: number, ry: number): void {
  if (rx < 0.5 || ry < 0.5) return
  ctx.fillStyle = color
  const top = Math.round(cy - ry)
  const bottom = Math.round(cy + ry)
  for (let y = top; y < bottom; y++) {
    const dy = (y + 0.5 - cy) / ry
    const half = rx * Math.sqrt(Math.max(0, 1 - dy * dy))
    const x0 = Math.round(cx - half)
    const x1 = Math.round(cx + half)
    if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1)
  }
}

const colorOf = (p: Paint | null): string => (p && 'color' in p ? p.color : '#888888')

/** Paints pieces in world art coordinates (the context's transform places them on screen). */
export function paint(ctx: CanvasRenderingContext2D, pieces: Piece[], which: 'all' | 'static' | 'live' = 'all'): void {
  for (const p of pieces) {
    if ((which === 'static' && p.live) || (which === 'live' && !p.live)) continue
    const b = p.box
    const x0 = Math.round(artX(b.min.x))
    const x1 = Math.max(x0 + 1, Math.round(artX(b.max.x)))
    const yTop = Math.round(artY(b.max.y, b.min.z))
    const yEdge = Math.round(artY(b.max.y, b.max.z))
    const yBottom = Math.max(yEdge, Math.round(artY(b.min.y, b.max.z)))
    ctx.globalAlpha = p.alpha
    switch (p.shape) {
      case 'box':
        fill(ctx, p.top, x0, yTop, x1, Math.max(yTop + (b.max.z - b.min.z > 0.02 ? 1 : 0), yEdge))
        fill(ctx, p.front, x0, yEdge, x1, Math.max(yEdge + 1, yBottom))
        break
      case 'front':
        fill(ctx, p.front, x0, Math.round(artY(b.max.y, b.max.z)), x1, Math.max(yEdge + 1, yBottom))
        break
      case 'top':
        fill(ctx, p.top, x0, yTop, x1, Math.max(yTop + 1, yEdge))
        break
      case 'cyl': {
        // the body as a band, the cap as an ellipse on top
        const cx = (artX(b.min.x) + artX(b.max.x)) / 2
        const rx = (artX(b.max.x) - artX(b.min.x)) / 2
        const ry = ((b.max.z - b.min.z) * TILE) / 2
        const cy = artY(b.max.y, (b.min.z + b.max.z) / 2)
        fill(
          ctx,
          p.front,
          x0,
          Math.round(cy),
          x1,
          Math.max(Math.round(cy) + 1, Math.round(artY(b.min.y, (b.min.z + b.max.z) / 2) + ry * 0.6)),
        )
        ellipse(ctx, colorOf(p.top), cx, cy, rx, Math.max(0.5, ry))
        break
      }
      case 'disc': {
        const cx = (artX(b.min.x) + artX(b.max.x)) / 2
        const rx = Math.max(0.5, (artX(b.max.x) - artX(b.min.x)) / 2)
        const facingUp = b.max.y - b.min.y < 0.05
        const ry = facingUp ? ((b.max.z - b.min.z) * TILE) / 2 : ((b.max.y - b.min.y) * TILE) / 2
        const cy = facingUp ? artY(b.max.y, (b.min.z + b.max.z) / 2) : artY((b.min.y + b.max.y) / 2, b.max.z)
        ellipse(ctx, colorOf(facingUp ? p.top : p.front), cx, cy, rx, Math.max(0.5, ry))
        break
      }
      case 'ball': {
        const cx = (artX(b.min.x) + artX(b.max.x)) / 2
        const rx = (artX(b.max.x) - artX(b.min.x)) / 2
        const ry = (yBottom - yTop) / 2
        ellipse(ctx, colorOf(p.front), cx, yTop + ry, rx, ry)
        // a highlight on the upper left, where the light comes from
        ellipse(ctx, colorOf(p.top), cx - rx * 0.2, yTop + ry * 0.7, rx * 0.55, ry * 0.45)
        break
      }
    }
  }
  ctx.globalAlpha = 1
}

/** Art-pixel bounds of a set of pieces. */
export function bounds(pieces: Piece[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!pieces.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pieces) {
    const r = pieceRect(p)
    x0 = Math.min(x0, r.x0)
    y0 = Math.min(y0, r.y0)
    x1 = Math.max(x1, r.x1)
    y1 = Math.max(y1, r.y1 + 1)
  }
  return { x0: Math.floor(x0) - 1, y0: Math.floor(y0) - 1, x1: Math.ceil(x1) + 1, y1: Math.ceil(y1) + 1 }
}

/**
 * Bakes the still pieces of an object into a small canvas with a 1-pixel dark outline, the
 * pixel-art look. `ox, oy` is where its top-left goes in world art pixels.
 */
export function bake(pieces: Piece[], outline = true): { canvas: HTMLCanvasElement; ox: number; oy: number } | null {
  const still = pieces.filter((p) => !p.live)
  const r = bounds(still)
  if (!r) return null
  const w = r.x1 - r.x0 + 2
  const h = r.y1 - r.y0 + 2
  if (w <= 0 || h <= 0 || w * h > 4096 * 4096) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  ctx.translate(1 - r.x0, 1 - r.y0)
  paint(ctx, still, 'static')
  if (outline && w * h < 400 * 400) outlined(ctx, w, h)
  return { canvas, ox: r.x0 - 1, oy: r.y0 - 1 }
}

/** Darkens the transparent pixels that touch an opaque one: a 1-pixel outline around the shape. */
function outlined(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 160
  const mark: number[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) continue
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) mark.push(y * w + x)
    }
  for (const i of mark) {
    d[i * 4] = 28
    d[i * 4 + 1] = 24
    d[i * 4 + 2] = 44
    d[i * 4 + 3] = 200
  }
  ctx.putImageData(img, 0, 0)
}
