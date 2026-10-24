import * as THREE from 'three'
import type { Avatar } from '../world/avatar'
import { H, W, WALL_H, type Zone } from '../world/layout'
import type { Office } from '../world/office'
import { pxTag } from '../world/pixel-tag'
import { sprite, whenLoaded } from './assets'
import type { PixelEngine, Rect } from './engine'
import { doorsOpen, spriteFor, type SpriteUse } from './objects'
import { drawPerson, personKey } from './people'
import { tinted } from './tint'
import { artX, artY, bake, bounds, ellipse, gather, paint, TILE, type Piece } from './voxel'

/** What the painter reads from the game each frame. */
export interface PixelWorld {
  /** The floor on screen. */
  floor(): Office
  /** Everyone on that floor, the player included. */
  people(): Avatar[]
  /** The skeleton by the boss office, when the ground floor is on screen. */
  skeleton(): THREE.Object3D | null
  /** The tile under the mouse, or null. */
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
  /** The mesh whose picture goes into a catalog sprite's screen. */
  screen: THREE.Mesh | null
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

const ZONE_FLOOR: Record<string, string> = {
  hall: 'chao/chao-hall',
  boss: 'chao/chao-chefe',
  team: 'chao/chao-time',
  lounge: 'chao/chao-lounge',
  cafe: 'chao/chao-copa',
}

/** Wall-mounted: hangs on the back wall (z ≈ 0) or the side wall (x ≈ 0), off the floor. */
const onWall = (b: THREE.Box3) => (b.max.z < 0.45 || b.max.x < 0.45) && b.min.y > 0.3

/**
 * Paints the floor on screen: a cached background (floor, rugs, walls), then furniture and
 * people sorted back to front, then effects. Furniture is baked into small canvases once per
 * floor; only screens, lights, doors and people are drawn again each frame.
 */
export class PixelPainter {
  private cache = new WeakMap<Office, FloorArt>()
  private order = 0

  constructor(
    private engine: PixelEngine,
    private world: PixelWorld,
  ) {
    engine.painter = (ctx, view) => this.paint(ctx, view)
    // sprites decode after the first frame: the floors are baked again with them
    whenLoaded(() => {
      this.cache = new WeakMap()
      engine.dirty = true
    })
  }

  /** Forget the baked floors (2D layout moved something). */
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
    if (hover) {
      ctx.fillStyle = hover.ok ? 'rgba(255,255,255,0.85)' : 'rgba(255,138,128,0.85)'
      const x = artX(hover.x)
      const y = artY(0, hover.z)
      ctx.fillRect(x, y, TILE, 1)
      ctx.fillRect(x, y + TILE - 1, TILE, 1)
      ctx.fillRect(x, y, 1, TILE)
      ctx.fillRect(x + TILE - 1, y, 1, TILE)
    }

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
    if (sk?.visible) dynamic.push({ key: sk.position.z + 0.05, draw: (order) => this.drawSkeleton(ctx, sk, order) })
    for (const fx of this.engine.scene.children)
      if (fx.userData.fx && fx.visible) dynamic.push({ key: fx.position.z + 0.2, draw: () => this.drawFx(ctx, fx) })
    dynamic.sort((a, b) => a.key - b.key)

    // merge the still furniture (sorted once) with the moving things (sorted now)
    let d = 0
    for (const u of art.units) {
      while (d < dynamic.length && dynamic[d].key <= u.key) dynamic[d++].draw(++this.order)
      // a catalog sprite can be a little bigger than the 3D pieces: a tile of slack
      if (u.rect.x1 < view.x0 - TILE || u.rect.x0 > view.x1 + TILE || u.rect.y1 < view.y0 - TILE || u.rect.y0 > view.y1 + TILE) continue
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
        if (tag?.key === 'pergola' || tag?.key === 'skeleton' || tag?.key === 'wallCabinets') continue
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
      const rect = bounds(pieces)!
      units.push({
        obj,
        box,
        rect,
        key: onWall(box) ? box.max.z - 100 : box.max.z + box.min.y,
        baked: bake(pieces),
        live: pieces.some((p) => p.live),
        screen: screenOf(pieces),
      })
    }
    units.sort((a, b) => a.key - b.key)
    const lights: FloorArt['lights'] = []
    const at = new THREE.Vector3()
    group.traverse((o) => {
      const light = o as THREE.PointLight
      if (!o.userData.night || !light.isPointLight) return
      light.getWorldPosition(at)
      // the light pools on the floor below it, a little up the screen for its height
      lights.push({
        x: artX(at.x),
        y: artY(at.y * 0.4, at.z),
        color: `#${light.color.getHexString()}`,
        strength: Math.min(0.55, light.intensity * 0.16),
        radius: light.distance * TILE * 0.5,
      })
    })
    return { ...this.background(bgObjs), units, lights }
  }

  /** Floor slab, rugs and walls in one canvas; the catalog floors and wall strip go over them. */
  private background(objs: THREE.Object3D[]): { bg: HTMLCanvasElement; bgX: number; bgY: number } {
    const x0 = Math.floor(artX(-0.6))
    const y0 = Math.floor(artY(WALL_H + 0.4, 0))
    const x1 = Math.ceil(artX(W + 0.6))
    const y1 = Math.ceil(artY(-1.2, H + 0.4))
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
      this.floorTiles(ctx, o)
    }
    const pieces: Piece[] = rest.flatMap((o) => gather(o)).sort((a, b) => a.box.max.z - b.box.max.z || a.box.max.y - b.box.max.y)
    paint(ctx, pieces)
    this.wallStrip(ctx, rest)
    return { bg, bgX: x0, bgY: y0 }
  }

  /** Catalog floor textures (64 x 64, two tiles a side) over each zone of the slab. */
  private floorTiles(ctx: CanvasRenderingContext2D, slab: THREE.Object3D): void {
    const tag = pxTag(slab)!
    const b = new THREE.Box3().setFromObject(slab)
    const tileAt = (style: string | undefined) => (style ? sprite(style) : null)
    if (tag.deck) {
      const s = tileAt('chao/chao-deck')
      if (s)
        for (let z = Math.round(b.min.z); z < Math.round(b.max.z); z++)
          for (let x = Math.round(b.min.x); x < Math.round(b.max.x); x++) tile(ctx, s.img, x, z)
      return
    }
    const zones = (tag.zones as Zone[] | undefined) ?? []
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        const zone = [...zones].reverse().find((zn) => x >= zn.rect[0] && x < zn.rect[2] && z >= zn.rect[1] && z < zn.rect[3])
        const s = tileAt(ZONE_FLOOR[zone?.id ?? 'hall'])
        if (s) tile(ctx, s.img, x, z)
      }
  }

  /** The catalog back-wall strip along the wall's face, where the floor has that wall. */
  private wallStrip(ctx: CanvasRenderingContext2D, objs: THREE.Object3D[]): void {
    const s = sprite('chao/parede-fundo')
    if (!s) return
    const walls = objs.filter((o) => pxTag(o)?.key === 'shell' && pxTag(o)?.part === 'wall').map((o) => new THREE.Box3().setFromObject(o))
    if (!walls.length) return
    const from = Math.max(0, Math.min(...walls.map((b) => b.min.x)))
    const to = Math.min(W, Math.max(...walls.map((b) => b.max.x)))
    const bottom = Math.round(artY(0, 0))
    for (let x = artX(from); x < artX(to); x += s.w) {
      const w = Math.min(s.w, artX(to) - x)
      ctx.drawImage(s.img, 0, 0, w, s.h, x, bottom - s.h, w, s.h)
    }
  }

  // ---------- drawing ----------

  private drawUnit(ctx: CanvasRenderingContext2D, u: Unit, order: number): void {
    const use = spriteFor(u.obj, pxTag(u.obj)?.key === 'elevator' ? doorsOpen(u.obj) : 0)
    if (use) this.drawSprite(ctx, u, use)
    else {
      if (u.baked) ctx.drawImage(u.baked.canvas, u.baked.ox, u.baked.oy)
      if (u.live) {
        u.obj.updateMatrixWorld(true)
        paint(ctx, gather(u.obj), 'live')
      }
    }
    this.engine.hits.set(u.obj, { ...u.rect, order })
  }

  /** A catalog sprite, its bottom-center on the object's front edge; its screen gets the live picture. */
  private drawSprite(ctx: CanvasRenderingContext2D, u: Unit, use: SpriteUse): void {
    const { sprite: s, mirror, repeat } = use
    const img = tinted(use.key, s, use.palette)
    const b = u.box
    const copies = repeat?.n ?? 1
    for (let i = 0; i < copies; i++) {
      // modules of a counter, back to front
      const along = copies > 1 ? i - (copies - 1) / 2 : 0
      const cx = artX((b.min.x + b.max.x) / 2 + (repeat?.axis === 'x' ? along : 0))
      const front = repeat?.axis === 'z' ? b.max.z - (copies - 1 - i) : b.max.z
      const x = Math.round(cx - s.w / 2)
      const y = Math.round(artY(b.min.y, front) - s.h)
      if (s.screen) {
        // the screen is a hole in the sprite: the live picture goes under it (a window's cross stays on top)
        const [sx, sy, sw, sh] = s.screen
        const sxAt = mirror ? x + s.w - sx - sw : x + sx
        ctx.fillStyle = '#14161f'
        ctx.fillRect(sxAt, y + sy, sw, sh)
        const live = (u.screen?.material as THREE.MeshBasicMaterial | undefined)?.map?.image as CanvasImageSource | undefined
        if (live) ctx.drawImage(live, sxAt, y + sy, sw, sh)
      }
      if (mirror) {
        ctx.save()
        ctx.translate(x + s.w, y)
        ctx.scale(-1, 1)
        ctx.drawImage(img, 0, 0)
        ctx.restore()
      } else ctx.drawImage(img, x, y)
    }
    // the alarm's strobe and the café LED have no frames of their own
    const tag = pxTag(u.obj)
    if (tag?.key === 'beacon' && u.live) {
      const on = (tag.isOn as (() => boolean) | undefined)?.() ?? false
      if (on && Math.sin(this.world.time() * 12.6) > 0) {
        ctx.globalAlpha = 0.45
        ellipse(ctx, '#ff2a3d', artX((b.min.x + b.max.x) / 2), artY((b.min.y + b.max.y) / 2, b.max.z), 14, 10)
        ctx.globalAlpha = 1
      }
    }
  }

  /** The skeleton faces the viewer here (the 3D one turns towards the isometric camera). */
  private drawSkeleton(ctx: CanvasRenderingContext2D, sk: THREE.Object3D, order: number): void {
    const s = sprite('personagens/caveira')
    const fx = Math.round(artX(sk.position.x))
    const fy = Math.round(artY(0, sk.position.z))
    ctx.globalAlpha = 0.22
    ellipse(ctx, '#140f28', fx, fy - 1, 10, 4)
    ctx.globalAlpha = 1
    if (s) {
      const shake = sk.rotation.z ? Math.round(sk.rotation.z * 20) : 0
      const x = fx - Math.round(s.w / 2) + shake
      const y = fy - s.h + 2
      ctx.drawImage(s.img, x, y)
      this.engine.hits.set(sk, { x0: x + 8, y0: y + 6, x1: x + s.w - 8, y1: fy, order })
      return
    }
    const pieces = upright(sk)
    paint(ctx, pieces)
    const r = bounds(pieces)
    if (r) this.engine.hits.set(sk, { ...r, order })
  }

  /** Sparks, smoke, ghosts and the skull of a strike. */
  private drawFx(ctx: CanvasRenderingContext2D, fx: THREE.Object3D): void {
    const kind = fx.userData.fx as string
    const p = fx.position
    const x = Math.round(artX(p.x))
    const y = Math.round(artY(p.y, p.z))
    if (kind === 'skull') {
      const s = sprite('personagens/caveira-cabeca')
      if (s) ctx.drawImage(s.img, x - Math.round(s.w / 2), y - s.h)
      else paint(ctx, upright(fx))
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
    const size = Math.max(1, Math.round((kind === 'smoke' ? 0.22 : 0.06) * TILE * mesh.scale.x))
    ctx.globalAlpha = m.transparent ? m.opacity : 1
    ctx.fillStyle = m.color.getStyle()
    ctx.fillRect(x - (size >> 1), y - (size >> 1), size, size)
    ctx.globalAlpha = 1
  }
}

/** A floor tile from a 64 x 64 catalog texture (two tiles a side, so the pattern repeats less). */
function tile(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, z: number): void {
  const half = Math.min(img.naturalWidth, img.naturalHeight) / 2
  ctx.drawImage(img, (x & 1) * half, (z & 1) * half, half, half, artX(x), artY(0, z), TILE, TILE)
}

/** Its pieces turned to face the viewer, keeping any wobble around z. */
function upright(obj: THREE.Object3D): Piece[] {
  const ry = obj.rotation.y
  obj.rotation.y = 0
  obj.updateMatrixWorld(true)
  const pieces = gather(obj)
  obj.rotation.y = ry
  return pieces
}

/** The biggest live textured panel: what a catalog screen shows. */
function screenOf(pieces: Piece[]): THREE.Mesh | null {
  let best: Piece | null = null
  let area = 0
  for (const p of pieces) {
    if (!p.live || !p.front || !('image' in p.front)) continue
    const a = (p.box.max.x - p.box.min.x) * (p.box.max.y - p.box.min.y)
    if (a > area) {
      area = a
      best = p
    }
  }
  return best?.mesh ?? null
}
