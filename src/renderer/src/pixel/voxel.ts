import * as THREE from 'three'

/**
 * The 3D office drawn flat on a 2D canvas, without WebGL, in the classic 2:1 isometric pixel-art
 * projection: a floor tile is a 64 x 32 diamond, x runs down-right and z down-left, so the
 * back walls (z = 0 and x = 0) close the room at the top, as in the 3D view. Three faces of a
 * box show: its top, its +z face (left, lit) and its +x face (right, in shade).
 *
 * Our furniture sprites (pixel/iso-art.ts) replace these shapes object by object; whatever has
 * no sprite (walls, glass, live panels) is drawn from its 3D pieces here.
 */

/** Half the width and half the height of a floor tile, and the art pixels of one world unit up. */
export const HALF_W = 32
export const HALF_H = 16
export const UNIT_Y = 40

/** Screen x of a world point. */
export const isoX = (x: number, z: number): number => (x - z) * HALF_W
/** Screen y of a world point. */
export const isoY = (x: number, y: number, z: number): number => (x + z) * HALF_H - y * UNIT_Y

/** World floor point (y = 0) under an art pixel. */
export function floorAt(ax: number, ay: number): { x: number; z: number } {
  const a = ax / HALF_W
  const b = ay / HALF_H
  return { x: (b + a) / 2, z: (b - a) / 2 }
}

type Shape = 'box' | 'cyl' | 'ball' | 'front' | 'side' | 'top' | 'disc'

/** A face fill: a flat color or a texture (screens, books, rugs, the floor). */
type Paint = { color: string } | { image: CanvasImageSource; w: number; h: number; repeat: number }

export interface Piece {
  mesh: THREE.Mesh
  box: THREE.Box3
  shape: Shape
  top: Paint | null
  /** The +z face (left on screen). */
  front: Paint | null
  /** The +x face (right on screen). */
  side: Paint | null
  alpha: number
  /** Redrawn every frame: its texture changes (screens, skies, boards) or it moves on its own. */
  live: boolean
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const UP = new THREE.Vector3()
const FWD = new THREE.Vector3()
const styles = new Map<string, { top: string; front: string; side: string }>()
const tmp = new THREE.Color()
const WHITE = new THREE.Color('#ffffff')

/** CSS colors for a material color: top lit, left face a touch darker, right face in shade (light from the top-left). */
function shades(color: THREE.Color, lit: boolean): { top: string; front: string; side: string } {
  const key = `${color.getHex()}|${lit}`
  let s = styles.get(key)
  if (!s) {
    const flat = color.getStyle()
    s = lit
      ? {
          top: tmp.copy(color).lerp(WHITE, 0.12).getStyle(),
          front: tmp.copy(color).multiplyScalar(0.86).getStyle(),
          side: tmp.copy(color).multiplyScalar(0.68).getStyle(),
        }
      : { top: flat, front: flat, side: flat }
    styles.set(key, s)
  }
  return s
}

function paintOf(m: THREE.Material | undefined, face: 'top' | 'front' | 'side'): Paint | null {
  if (!m) return null
  const mat = m as THREE.MeshLambertMaterial
  const map = mat.map
  const img = map?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined
  if (img && img.width && img.height) return { image: img, w: img.width, h: img.height, repeat: Math.max(1, Math.round(map!.repeat.x)) }
  if (!mat.color) return null
  return { color: shades(mat.color, m.type !== 'MeshBasicMaterial')[face] }
}

function isLive(mesh: THREE.Mesh, animated: boolean): boolean {
  if (animated || mesh.userData.live) return true
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return mats.some((m) => (m as THREE.MeshBasicMaterial).map?.userData.live)
}

/** Isometric draw order of a box: the farther from the viewer (smaller x + z), the lower, first. */
export const depthOf = (b: THREE.Box3): number => (b.min.x + b.max.x) / 2 + (b.min.z + b.max.z) / 2 + b.min.y * 0.01

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
  out.sort((a, b) => depthOf(a.box) - depthOf(b.box) || a.box.max.y - b.box.max.y)
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
  let side: Paint | null
  if (Array.isArray(mesh.material)) {
    // BoxGeometry groups: +x, -x, +y, -y, +z, -z
    top = paintOf(mats[2], 'top')
    front = paintOf(mats[4], 'front')
    side = paintOf(mats[0], 'side')
  } else {
    top = paintOf(first, 'top')
    front = paintOf(first, 'front')
    side = paintOf(first, 'side')
  }
  if (type === 'PlaneGeometry' || type === 'CircleGeometry') {
    // a flat face: it shows only when it faces up, +z or +x (the viewer sits at +x +z)
    FWD.set(0, 0, 1).transformDirection(mesh.matrixWorld)
    if (FWD.y > 0.6) shape = type === 'CircleGeometry' ? 'disc' : 'top'
    else if (FWD.z > 0.6) shape = type === 'CircleGeometry' ? 'disc' : 'front'
    else if (FWD.x > 0.6) shape = type === 'CircleGeometry' ? 'disc' : 'side'
    else return null
    // a plane has one material: its picture goes on whichever face shows
    if (shape === 'side') side = paintOf(first, 'front')
  } else if (type === 'CylinderGeometry') {
    UP.set(0, 1, 0).transformDirection(mesh.matrixWorld)
    shape = Math.abs(UP.y) > 0.7 ? 'cyl' : 'box'
  } else if (type !== 'BoxGeometry') shape = 'ball'
  return { mesh, box, shape, top, front, side, alpha, live: isLive(mesh, animated) }
}

/** Art-pixel rectangle a box covers on screen. */
export function boxRect(b: THREE.Box3): Rect {
  return {
    x0: Math.floor(isoX(b.min.x, b.max.z)),
    x1: Math.ceil(isoX(b.max.x, b.min.z)),
    y0: Math.floor(isoY(b.min.x, b.max.y, b.min.z)),
    y1: Math.ceil(isoY(b.max.x, b.min.y, b.max.z)),
  }
}

type Pt = [number, number]

/**
 * A convex polygon filled row by row with whole-pixel spans: crisp edges, no anti-aliasing,
 * like the sprites (a path fill would blur every slanted edge).
 */
function polygon(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  let top = Infinity
  let bottom = -Infinity
  for (const [, y] of pts) {
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  const y0 = Math.round(top)
  const y1 = Math.round(bottom)
  for (let y = y0; y < y1; y++) {
    const sy = y + 0.5
    let left = Infinity
    let right = -Infinity
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[(i + 1) % pts.length]
      if ((sy < ay && sy < by) || (sy > ay && sy > by) || ay === by) continue
      const x = ax + ((sy - ay) / (by - ay)) * (bx - ax)
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
    if (right <= left) continue
    const l = Math.round(left)
    const r = Math.round(right)
    if (r > l) ctx.fillRect(l, y, r - l, 1)
  }
}

/** A picture laid on a parallelogram: `o` its top-left corner, `u` its top edge, `v` its left edge. */
function texture(
  ctx: CanvasRenderingContext2D,
  p: { image: CanvasImageSource; w: number; h: number; repeat: number },
  o: Pt,
  u: Pt,
  v: Pt,
): void {
  const n = p.repeat
  ctx.save()
  ctx.transform(u[0] / n / p.w, u[1] / n / p.w, v[0] / p.h, v[1] / p.h, o[0], o[1])
  for (let i = 0; i < n; i++) ctx.drawImage(p.image, i * p.w, 0)
  ctx.restore()
}

function face(ctx: CanvasRenderingContext2D, paint: Paint | null, o: Pt, u: Pt, v: Pt): void {
  if (!paint) return
  if ('color' in paint) {
    ctx.fillStyle = paint.color
    polygon(ctx, [o, [o[0] + u[0], o[1] + u[1]], [o[0] + u[0] + v[0], o[1] + u[1] + v[1]], [o[0] + v[0], o[1] + v[1]]])
  } else texture(ctx, paint, o, u, v)
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
const P = (x: number, y: number, z: number): Pt => [isoX(x, z), isoY(x, y, z)]

/** Paints pieces in world art coordinates (the context's transform places them on screen). */
export function paint(ctx: CanvasRenderingContext2D, pieces: Piece[], which: 'all' | 'static' | 'live' = 'all'): void {
  for (const p of pieces) {
    if ((which === 'static' && p.live) || (which === 'live' && !p.live)) continue
    const { min: a, max: b } = p.box
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    // the screen vectors of one step along each axis
    const ux: Pt = [dx * HALF_W, dx * HALF_H]
    const uz: Pt = [-dz * HALF_W, dz * HALF_H]
    const down: Pt = [0, dy * UNIT_Y]
    ctx.globalAlpha = p.alpha
    switch (p.shape) {
      case 'box':
        // left (+z) and right (+x) faces hang from the top's front edges, then the top
        face(ctx, p.front, P(a.x, b.y, b.z), ux, down)
        face(ctx, p.side, P(b.x, b.y, b.z), [dz * HALF_W, -dz * HALF_H], down)
        face(ctx, p.top, P(a.x, b.y, a.z), ux, uz)
        break
      case 'front':
        face(ctx, p.front, P(a.x, b.y, b.z), ux, down)
        break
      case 'side':
        face(ctx, p.side, P(b.x, b.y, b.z), [-uz[0], -uz[1]], down)
        break
      case 'top':
        face(ctx, p.top, P(a.x, b.y, a.z), ux, uz)
        break
      case 'cyl':
      case 'disc':
      case 'ball': {
        const cx = isoX((a.x + b.x) / 2, (a.z + b.z) / 2)
        const r = Math.max(dx, dz) / 2
        const rx = r * HALF_W * Math.SQRT2
        const ry = r * HALF_H * Math.SQRT2
        const cTop = isoY((a.x + b.x) / 2, b.y, (a.z + b.z) / 2)
        const cBottom = isoY((a.x + b.x) / 2, a.y, (a.z + b.z) / 2)
        if (p.shape === 'ball') {
          const h = (cBottom - cTop) / 2 + ry
          ellipse(ctx, colorOf(p.front), cx, (cTop + cBottom) / 2, Math.max(rx, 0.5), Math.max(h, 0.5))
          ellipse(ctx, colorOf(p.top), cx - rx * 0.2, (cTop + cBottom) / 2 - h * 0.3, rx * 0.5, h * 0.4)
          break
        }
        if (p.shape === 'cyl' && cBottom - cTop >= 1) {
          ellipse(ctx, colorOf(p.side), cx, cBottom, rx, Math.max(0.5, ry))
          ctx.fillStyle = colorOf(p.front)
          ctx.fillRect(Math.round(cx - rx), Math.round(cTop), Math.round(rx * 2), Math.round(cBottom - cTop))
        }
        ellipse(ctx, colorOf(dy < 0.05 || p.shape === 'cyl' ? p.top : p.front), cx, cTop, rx, Math.max(0.5, ry))
        break
      }
    }
  }
  ctx.globalAlpha = 1
}

/** Art-pixel bounds of a set of pieces. */
export function bounds(pieces: Piece[]): Rect | null {
  if (!pieces.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pieces) {
    const r = boxRect(p.box)
    x0 = Math.min(x0, r.x0)
    y0 = Math.min(y0, r.y0)
    x1 = Math.max(x1, r.x1)
    y1 = Math.max(y1, r.y1)
  }
  return { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 }
}

/**
 * Bakes the still pieces of an object into a small canvas with a 1-pixel dark outline, like the
 * sprites. `ox, oy` is where its top-left goes in world art pixels.
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
    d[i * 4 + 3] = 220
  }
  ctx.putImageData(img, 0, 0)
}
