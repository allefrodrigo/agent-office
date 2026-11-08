import * as THREE from 'three'
import type { Avatar } from '../world/avatar'
import { H, W, WALL_H } from '../world/layout'
import type { Office } from '../world/office'
import { pxTag } from '../world/pixel-tag'
import { sprite } from './assets'
import type { PixelEngine, Rect } from './engine'
import { onFigureLibrary } from './figure'
import { allLibraries } from './habbo-catalog'
import { furniFor, onHabboImage, type FurniUse } from './habbo'
import { drawScreen } from './habbo-computer'
import { drawPerson, personKey } from './people'
import { bake, boxRect, depthOf, ellipse, gather, HALF_H, HALF_W, isoX, isoY, paint, type Piece } from './voxel'

/** What the painter reads from the game each frame. */
export interface PixelWorld {
  /** The floor on screen. */
  floor(): Office
  /** Everyone on that floor, the player included. */
  people(): Avatar[]
  /** The skeleton by the boss office, when the ground floor is on screen. */
  skeleton(): THREE.Object3D | null
  /** The tile under the mouse (its corner), or null. */
  hover(): { x: number; z: number; ok: boolean } | null
  /** Game time in seconds. */
  time(): number
}

/** One piece of furniture (or wall part, or glass pane) as the 2D view draws it. */
interface Unit {
  obj: THREE.Object3D
  /** Draw order: bigger = later = in front. */
  key: number
  rect: Rect
  box: THREE.Box3
  baked: { canvas: HTMLCanvasElement; ox: number; oy: number } | null
  /** Has parts that change (screens, LEDs, doors): they are drawn again every frame. */
  live: boolean
}

interface FloorArt {
  bg: HTMLCanvasElement
  bgX: number
  bgY: number
  units: Unit[]
  /** The modo noturno glows (world/night.ts): where, what color, how strong and how far. */
  lights: { x: number; y: number; color: string; strength: number; radius: number }[]
}

interface Drawable {
  key: number
  draw(order: number): void
}

/** Wall-mounted: hangs on the back wall (z ≈ 0) or the side wall (x ≈ 0), off the floor. */
const onWall = (b: THREE.Box3) => (b.max.z < 0.45 || b.max.x < 0.45) && b.min.y > 0.3

/**
 * Paints the floor on screen in the Habbo isometric view: a cached background (floor slab,
 * rugs, back walls), then furniture and people sorted back to front, then effects. Furniture
 * with a Habbo counterpart is drawn with the Imager's picture; the rest is baked from its 3D
 * pieces once per floor. Only screens, lights, doors and people are drawn again each frame.
 */
export class PixelPainter {
  private cache = new WeakMap<Office, FloorArt>()
  private order = 0

  constructor(
    private engine: PixelEngine,
    private world: PixelWorld,
  ) {
    engine.painter = (ctx, view) => this.paint(ctx, view)
    // Habbo pictures arrive after the first frames: draw again with each one
    onHabboImage(() => (engine.dirty = true))
    onFigureLibrary(() => (engine.dirty = true))
    // the whole wardrobe to disk in the background: any look then draws at once, offline too
    void window.office
      .habboPrefetch(allLibraries())
      .catch((err) => console.warn(`[habbo] cache: ${err instanceof Error ? err.message : err}`))
  }

  /** Forget the baked floors. */
  reset(): void {
    this.cache = new WeakMap()
  }

  private paint(ctx: CanvasRenderingContext2D, view: Rect): void {
    const office = this.world.floor()
    let art = this.cache.get(office)
    if (!art) this.cache.set(office, (art = this.build(office)))
    const t = this.world.time()
    this.order = 0
    ctx.drawImage(art.bg, art.bgX, art.bgY)
    const hover = this.world.hover()
    if (hover) diamond(ctx, hover.x, hover.z, hover.ok ? 'rgba(255,255,255,0.9)' : 'rgba(255,138,128,0.9)')

    const dynamic: Drawable[] = []
    for (const av of this.world.people()) {
      dynamic.push({
        key: personKey(av),
        draw: (order) => {
          const r = drawPerson(ctx, av, t)
          this.engine.hits.set(av.root, { ...r, order })
        },
      })
    }
    const sk = this.world.skeleton()
    if (sk?.visible) dynamic.push({ key: sk.position.x + sk.position.z + 0.05, draw: (order) => this.drawSkeleton(ctx, sk, order) })
    for (const fx of this.engine.scene.children)
      if (fx.userData.fx && fx.visible) dynamic.push({ key: fx.position.x + fx.position.z + 0.2, draw: () => this.drawFx(ctx, fx) })
    dynamic.sort((a, b) => a.key - b.key)

    // merge the still furniture (sorted once) with the moving things (sorted now)
    let d = 0
    const slack = 2 * HALF_W
    for (const u of art.units) {
      while (d < dynamic.length && dynamic[d].key <= u.key) dynamic[d++].draw(++this.order)
      // a Habbo picture can be bigger than the 3D pieces: some slack
      if (u.rect.x1 < view.x0 - slack || u.rect.x0 > view.x1 + slack || u.rect.y1 < view.y0 - slack || u.rect.y0 > view.y1 + slack * 2)
        continue
      this.drawUnit(ctx, u, ++this.order)
    }
    while (d < dynamic.length) dynamic[d++].draw(++this.order)
    if (this.engine.night) this.nightLight(ctx, view, art)
    this.engine.draws = this.order
  }

  /**
   * Modo noturno: the whole floor goes dark blue (multiply), then each glow of the 3D scene
   * adds its light back around it (additive), the way the point lights do in 3D.
   */
  private nightLight(ctx: CanvasRenderingContext2D, view: Rect, art: FloorArt): void {
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = '#454b85'
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0)
    ctx.globalCompositeOperation = 'lighter'
    for (const l of art.lights) {
      if (l.x + l.radius < view.x0 || l.x - l.radius > view.x1 || l.y + l.radius < view.y0 || l.y - l.radius > view.y1) continue
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.radius)
      g.addColorStop(0, l.color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = l.strength
      ctx.fillStyle = g
      ctx.fillRect(l.x - l.radius, l.y - l.radius, l.radius * 2, l.radius * 2)
    }
    ctx.restore()
  }

  // ---------- one floor, baked ----------

  private build(office: Office): FloorArt {
    const group = office.group
    group.updateMatrixWorld(true)
    const bgObjs: THREE.Object3D[] = []
    const objs: THREE.Object3D[] = []
    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        const tag = pxTag(c)
        // over everyone's heads (the rooftop pergola) or drawn on its own (the skeleton)
        if (tag?.key === 'pergola' || tag?.key === 'skeleton') continue
        if (tag?.key === 'shell' || tag?.key === 'slab' || tag?.key === 'rug') bgObjs.push(c)
        else if (tag || (c as THREE.Mesh).isMesh) objs.push(c)
        else walk(c)
      }
    }
    walk(group)

    const units: Unit[] = []
    for (const obj of objs) {
      const pieces = gather(obj)
      if (!pieces.length) continue
      const box = new THREE.Box3()
      for (const p of pieces) box.union(p.box)
      // flat on the floor: part of the background
      if (box.max.y < 0.06 && !pieces.some((p) => p.live)) {
        bgObjs.push(obj)
        continue
      }
      units.push({
        obj,
        box,
        rect: boxRect(box),
        key: onWall(box) ? depthOf(box) - 1 : depthOf(box),
        baked: bake(pieces),
        live: pieces.some((p) => p.live),
      })
    }
    // what stands on a desk or a table comes after it: the Habbo desk's picture would hide the
    // things on its back half (the boss's monitor) behind its top
    for (const u of units) {
      if (u.box.min.y < 0.3) continue
      for (const s of units)
        if (
          s !== u &&
          Math.abs(s.box.max.y - u.box.min.y) < 0.1 &&
          s.box.min.x <= u.box.max.x &&
          s.box.max.x >= u.box.min.x &&
          s.box.min.z <= u.box.max.z &&
          s.box.max.z >= u.box.min.z
        )
          u.key = Math.max(u.key, s.key + 0.001)
    }
    units.sort((a, b) => a.key - b.key)
    // ask the Imager for every picture of the floor now, not as each comes into view
    for (const u of units) habboOf(u)
    const lights: FloorArt['lights'] = []
    const at = new THREE.Vector3()
    group.traverse((o) => {
      const light = o as THREE.PointLight
      if (!o.userData.night || !light.isPointLight) return
      light.getWorldPosition(at)
      // the light pools on the floor below it
      lights.push({
        x: isoX(at.x, at.z),
        y: isoY(at.x, at.y * 0.4, at.z),
        color: `#${light.color.getHexString()}`,
        strength: Math.min(0.55, light.intensity * 0.16),
        radius: light.distance * HALF_W * 0.7,
      })
    })
    return { ...this.background(bgObjs), units, lights }
  }

  /** Floor slab, rugs and the two back walls in one canvas. */
  private background(objs: THREE.Object3D[]): { bg: HTMLCanvasElement; bgX: number; bgY: number } {
    const x0 = Math.floor(isoX(-1, H + 1))
    const x1 = Math.ceil(isoX(W + 1, -1))
    const y0 = Math.floor(isoY(-1, WALL_H + 0.6, -1))
    const y1 = Math.ceil(isoY(W + 1, -1, H + 1))
    const bg = document.createElement('canvas')
    bg.width = x1 - x0
    bg.height = y1 - y0
    const ctx = bg.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingEnabled = false
    ctx.translate(-x0, -y0)
    const slab = objs.filter((o) => pxTag(o)?.key === 'slab')
    const rest = objs.filter((o) => pxTag(o)?.key !== 'slab')
    for (const o of slab) {
      paint(ctx, gather(o))
      this.tileLines(ctx, o)
    }
    const pieces: Piece[] = rest.flatMap((o) => gather(o)).sort((a, b) => depthOf(a.box) - depthOf(b.box) || a.box.max.y - b.box.max.y)
    paint(ctx, pieces)
    return { bg, bgX: x0, bgY: y0 }
  }

  /** Faint Habbo tile seams over the floor slab, one diamond per tile. */
  private tileLines(ctx: CanvasRenderingContext2D, slab: THREE.Object3D): void {
    const b = new THREE.Box3().setFromObject(slab)
    const y = b.max.y
    ctx.fillStyle = 'rgba(0,0,0,0.07)'
    const x0 = Math.round(b.min.x)
    const x1 = Math.round(b.max.x)
    const z0 = Math.round(b.min.z)
    const z1 = Math.round(b.max.z)
    // lines along x (z fixed) and along z (x fixed), a pixel per half-tile step
    for (let z = z0 + 1; z < z1; z++)
      for (let i = 0; i < (x1 - x0) * HALF_W; i++) ctx.fillRect(Math.round(isoX(x0, z) + i), Math.round(isoY(x0, y, z) + i / 2), 1, 1)
    for (let x = x0 + 1; x < x1; x++)
      for (let i = 0; i < (z1 - z0) * HALF_W; i++) ctx.fillRect(Math.round(isoX(x, z0) - i), Math.round(isoY(x, y, z0) + i / 2), 1, 1)
  }

  // ---------- drawing ----------

  private drawUnit(ctx: CanvasRenderingContext2D, u: Unit, order: number): void {
    const habbo = habboOf(u)
    if (habbo === 'loading' || habbo === 'hidden') this.engine.hits.set(u.obj, { ...u.rect, order })
    else if (habbo) this.drawHabbo(ctx, u, habbo, order)
    else {
      if (u.baked) ctx.drawImage(u.baked.canvas, u.baked.ox, u.baked.oy)
      if (u.live) {
        u.obj.updateMatrixWorld(true)
        paint(ctx, gather(u.obj), 'live')
      }
      this.engine.hits.set(u.obj, { ...u.rect, order })
    }
    if (u.live) this.beacon(ctx, u)
  }

  /**
   * A Habbo picture standing on the object's floor spot: centered on its footprint, its lowest
   * pixel on the footprint's front corner (the Imager crops each picture to its art).
   */
  private drawHabbo(ctx: CanvasRenderingContext2D, u: Unit, use: FurniUse, order: number): void {
    const { img, repeat, dy } = use
    // a canvas has no natural size; an image's width is its natural one until laid out
    const iw = img instanceof HTMLImageElement ? img.naturalWidth : img.width
    const ih = img instanceof HTMLImageElement ? img.naturalHeight : img.height
    const b = u.box
    const copies = repeat?.n ?? 1
    const hit: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (let i = 0; i < copies; i++) {
      // modules of a counter, back to front
      const along = copies > 1 ? i - (copies - 1) / 2 : 0
      const cx = (b.min.x + b.max.x) / 2 + (repeat?.axis === 'x' ? along : 0)
      const cz = (b.min.z + b.max.z) / 2 + (repeat?.axis === 'z' ? along : 0)
      const hx = repeat?.axis === 'x' ? 0.5 : (b.max.x - b.min.x) / 2
      const hz = repeat?.axis === 'z' ? 0.5 : (b.max.z - b.min.z) / 2
      const x = Math.round(isoX(cx, cz) - iw / 2)
      const y = Math.round(isoY(cx + hx, b.min.y, cz + hz) - ih + dy)
      if (use.flip) {
        ctx.save()
        ctx.translate(x + iw, y)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0)
        ctx.restore()
      } else ctx.drawImage(img, x, y)
      if (use.screen?.src) drawScreen(ctx, use.screen.area, use.screen.src, x, y)
      hit.x0 = Math.min(hit.x0, x)
      hit.y0 = Math.min(hit.y0, y)
      hit.x1 = Math.max(hit.x1, x + iw)
      hit.y1 = Math.max(hit.y1, y + ih)
    }
    this.engine.hits.set(u.obj, { ...hit, order })
  }

  /** The alarm's strobe has no frames of its own. */
  private beacon(ctx: CanvasRenderingContext2D, u: Unit): void {
    const tag = pxTag(u.obj)
    if (tag?.key !== 'beacon') return
    const on = (tag.isOn as (() => boolean) | undefined)?.() ?? false
    if (!on || Math.sin(this.world.time() * 12.6) <= 0) return
    const b = u.box
    ctx.globalAlpha = 0.45
    ellipse(ctx, '#ff2a3d', isoX((b.min.x + b.max.x) / 2, b.max.z), isoY((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z), 16, 11)
    ctx.globalAlpha = 1
  }

  /** The skeleton faces the viewer here (the 3D one turns towards the isometric camera). */
  private drawSkeleton(ctx: CanvasRenderingContext2D, sk: THREE.Object3D, order: number): void {
    const s = sprite('personagens/caveira')
    const fx = Math.round(isoX(sk.position.x, sk.position.z))
    const fy = Math.round(isoY(sk.position.x, 0, sk.position.z))
    ctx.globalAlpha = 0.25
    ellipse(ctx, '#000000', fx, fy, 14, 6)
    ctx.globalAlpha = 1
    if (s) {
      const shake = sk.rotation.z ? Math.round(sk.rotation.z * 20) : 0
      const x = fx - Math.round(s.w / 2) + shake
      const y = fy - s.h + 2
      ctx.drawImage(s.img, x, y)
      this.engine.hits.set(sk, { x0: x + 8, y0: y + 6, x1: x + s.w - 8, y1: fy, order })
      return
    }
    sk.updateMatrixWorld(true)
    const pieces = gather(sk)
    paint(ctx, pieces)
    const r = pieces.length ? boxRect(new THREE.Box3().setFromObject(sk)) : null
    if (r) this.engine.hits.set(sk, { ...r, order })
  }

  /** Sparks, smoke, ghosts and the skull of a strike. */
  private drawFx(ctx: CanvasRenderingContext2D, fx: THREE.Object3D): void {
    const kind = fx.userData.fx as string
    const p = fx.position
    const x = Math.round(isoX(p.x, p.z))
    const y = Math.round(isoY(p.x, p.y, p.z))
    if (kind === 'skull') {
      const s = sprite('personagens/caveira-cabeca')
      if (s) ctx.drawImage(s.img, x - Math.round(s.w / 2), y - s.h)
      else paint(ctx, gather(fx))
      return
    }
    if (kind === 'ghost') {
      const body = (fx.children[0] as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined
      ctx.globalAlpha = body?.opacity ?? 0.85
      ellipse(ctx, '#f4f2ff', x, y - 8, 7, 8)
      ctx.fillStyle = '#f4f2ff'
      ctx.fillRect(x - 7, y - 8, 14, 9)
      for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * 5 - 2, y + 1, 4, 2)
      ctx.fillStyle = '#1d1b26'
      ctx.fillRect(x - 4, y - 9, 2, 3)
      ctx.fillRect(x + 2, y - 9, 2, 3)
      ctx.globalAlpha = 1
      return
    }
    const mesh = fx as THREE.Mesh
    const m = mesh.material as THREE.MeshBasicMaterial
    const size = Math.max(1, Math.round((kind === 'smoke' ? 0.22 : 0.06) * HALF_W * 2 * mesh.scale.x))
    ctx.globalAlpha = m.transparent ? m.opacity : 1
    ctx.fillStyle = m.color.getStyle()
    ctx.fillRect(x - (size >> 1), y - (size >> 1), size, size)
    ctx.globalAlpha = 1
  }
}

/** The Habbo picture of a unit; a plant on a table or a desk gets the half-size one. */
function habboOf(u: Unit): ReturnType<typeof furniFor> {
  return furniFor(u.obj, pxTag(u.obj)?.key === 'plant' && u.box.min.y > 0.3)
}

/** The Habbo hover outline: a one-pixel diamond around the floor tile whose corner is (x, z). */
function diamond(ctx: CanvasRenderingContext2D, x: number, z: number, color: string): void {
  ctx.fillStyle = color
  const tx = Math.round(isoX(x, z))
  const ty = Math.round(isoY(x, 0, z))
  for (let i = 0; i < HALF_W; i++) {
    const dy = Math.floor(i / 2)
    // top to right, top to left, left to bottom, right to bottom
    ctx.fillRect(tx + i, ty + dy, 1, 1)
    ctx.fillRect(tx - i - 1, ty + dy, 1, 1)
    ctx.fillRect(tx - HALF_W + i, ty + HALF_H + dy, 1, 1)
    ctx.fillRect(tx + HALF_W - i - 1, ty + HALF_H + dy, 1, 1)
  }
}
