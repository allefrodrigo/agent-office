import * as THREE from 'three'
import { H, W } from '../world/layout'
import type { Viewport } from '../world/viewport'
import { artX, artY, TILE } from './voxel'

/** Device pixels per art pixel, smallest first: whole numbers keep every pixel the same size. */
const LEVELS = [1, 2, 3, 4, 5, 6, 8]
/** At least this many tiles fit the window's height at the starting zoom (the 3D view shows about 15). */
const START_TILES = 16

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Draws one frame on a context already moved so world art pixels land where they belong. */
export type Painter = (ctx: CanvasRenderingContext2D, view: Rect) => void

/**
 * The 2D pixel-art view (Configurações → Vídeo → Visual). A plain 2D canvas at art
 * resolution, scaled up by CSS with nearest-neighbour: no WebGL, no shadow map, no
 * post-processing buffers. The scene graph is the same one the 3D view uses; nothing in it
 * ever reaches the GPU.
 */
export class PixelEngine implements Viewport {
  readonly kind = '2d'
  readonly renderer = null
  readonly scene = new THREE.Scene()
  readonly target = new THREE.Vector3(W / 2, 0, H / 2)
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private focus = new THREE.Vector3(W / 2, 0, H / 2)
  private level = 2
  private dpr = 1
  /** CSS pixels per art pixel. */
  private scale = 1
  private width = 1
  private height = 1
  /** World art pixel at the canvas' top-left corner. */
  private camX = 0
  private camY = 0
  painter: Painter | null = null
  /** Where each pickable object was drawn in the last frame, in world art pixels; `order` = draw order. */
  readonly hits = new Map<THREE.Object3D, Rect & { order: number }>()
  /** Sprites and shapes drawn in the last frame, for the perf panel. */
  draws = 0
  dirty = true
  /** Modo noturno: the painter dims the floor and lights it with the glows of world/night.ts. */
  night = false

  constructor(private container: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.classList.add('world-canvas', 'world-canvas-2d')
    container.appendChild(this.canvas)
    // software canvas: at art resolution the CPU draws a frame in about a millisecond, and the
    // GPU only composites one layer (no textures, no buffers of its own)
    this.ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
    this.dpr = window.devicePixelRatio || 1
    const fit = (container.clientHeight * this.dpr) / (START_TILES * TILE)
    this.level = Math.max(
      0,
      LEVELS.findLastIndex((l) => l <= fit),
    )
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
  }

  /** The 3D pixel size has no meaning here: the zoom buttons pick the pixel size. */
  setPixelSize(): void {}

  /** No shadows in 2D. */
  setShadows(): void {}

  setNight(on: boolean): void {
    this.night = on
    this.dirty = true
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1
    this.scale = LEVELS[this.level] / this.dpr
    const cw = Math.max(1, this.container.clientWidth)
    const ch = Math.max(1, this.container.clientHeight)
    this.width = Math.ceil(cw / this.scale)
    this.height = Math.ceil(ch / this.scale)
    this.canvas.width = this.width
    this.canvas.height = this.height
    this.canvas.style.width = `${this.width * this.scale}px`
    this.canvas.style.height = `${this.height * this.scale}px`
    this.ctx.imageSmoothingEnabled = false
    this.dirty = true
  }

  zoomStep(delta: number): void {
    const next = Math.max(0, Math.min(LEVELS.length - 1, this.level + delta))
    if (next === this.level) return
    this.level = next
    this.resize()
  }

  jumpTo(x: number, z: number): void {
    this.target.set(x, 0, z)
    this.focus.copy(this.target)
  }

  get moving(): boolean {
    return this.focus.distanceToSquared(this.target) > 1e-6
  }

  step(dt: number): void {
    if ((window.devicePixelRatio || 1) !== this.dpr) this.resize()
    this.focus.lerp(this.target, 1 - Math.exp(-dt * 6))
    if (!this.moving) this.focus.copy(this.target)
    // a little above the floor point, so whoever stands there is in the middle
    const camX = Math.round(artX(this.focus.x) - this.width / 2)
    const camY = Math.round(artY(0.7, this.focus.z) - this.height / 2)
    if (camX !== this.camX || camY !== this.camY) this.dirty = true
    this.camX = camX
    this.camY = camY
  }

  render(): void {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#1c1d2e'
    ctx.fillRect(0, 0, this.width, this.height)
    ctx.setTransform(1, 0, 0, 1, -this.camX, -this.camY)
    this.hits.clear()
    this.draws = 0
    this.painter?.(ctx, { x0: this.camX, y0: this.camY, x1: this.camX + this.width, y1: this.camY + this.height })
    this.dirty = false
  }

  project(v: THREE.Vector3): { x: number; y: number } {
    return { x: Math.round((artX(v.x) - this.camX) * this.scale), y: Math.round((artY(v.y, v.z) - this.camY) * this.scale) }
  }

  /** World art pixel under a mouse position. */
  private art(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    return { x: (clientX - r.left) / this.scale + this.camX, y: (clientY - r.top) / this.scale + this.camY }
  }

  pickFloor(clientX: number, clientY: number): THREE.Vector3 | null {
    const a = this.art(clientX, clientY)
    return new THREE.Vector3(a.x / TILE, 0, a.y / TILE)
  }

  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    const a = this.art(clientX, clientY)
    const out: { hit: THREE.Intersection; order: number }[] = []
    for (const obj of objects) {
      const r = this.hits.get(obj) ?? this.boxRect(obj)
      if (!r || a.x < r.x0 || a.x >= r.x1 || a.y < r.y0 || a.y >= r.y1) continue
      const object = obj.userData.avatarId ? obj : (obj.getObjectByProperty('isMesh', true) ?? obj)
      out.push({ hit: { distance: -r.order, point: new THREE.Vector3(a.x / TILE, 0, a.y / TILE), object }, order: r.order })
    }
    // drawn last = on top = nearest
    return out.sort((p, q) => q.order - p.order).map((p) => p.hit)
  }

  /** Fallback for something the painter did not register: its 3D box, projected. */
  private boxRect(obj: THREE.Object3D): (Rect & { order: number }) | null {
    if (!obj.visible) return null
    const b = new THREE.Box3().setFromObject(obj)
    if (b.isEmpty()) return null
    return { x0: artX(b.min.x), x1: artX(b.max.x), y0: artY(b.max.y, b.min.z), y1: artY(b.min.y, b.max.z), order: -1 }
  }

  pan(dx: number, dy: number): void {
    this.target.x -= dx / this.scale / TILE
    this.target.z -= dy / this.scale / TILE
    this.target.x = Math.max(-2, Math.min(W + 2, this.target.x))
    this.target.z = Math.max(-2, Math.min(H + 2, this.target.z))
  }
}
