// Modo mini: the agents on the bottom of the screen, side view. Each one has a desk on the floor
// beside the Dock; working, it sits and types there; idle, it strolls, jumps onto the Dock before
// running into it and falls off its far end. The art is `npm run pet` (scripts/pet-art.mjs).

import type { AgentSummary, PetGeometry } from '@shared/types'
import { tinted } from '../pixel/tint'
import type { Sprite } from '../pixel/assets'
import type { State } from '../state'

const urls = import.meta.glob('../assets/pet/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const sprites = new Map<string, Sprite>()
for (const [path, url] of Object.entries(urls)) {
  const key = path.replace(/^.*\//, '').replace(/\.png$/, '')
  const img = new Image()
  img.onload = () => sprites.set(key, { img, w: img.naturalWidth, h: img.naturalHeight, tint: key.startsWith('molde-') })
  img.src = url
}

/** Cell of the character sheets (scripts/pet/prompts.mjs): 4 x 3 poses of 64 x 64, feet 2 px above the bottom. */
const CELL = 64
const FOOT = 2
const POSE = {
  walk: [0, 1, 2, 3],
  stand: 4,
  crouch: 5,
  jump: 6,
  fall: 7,
  type: [8, 9],
  sleep: 10,
  wave: 11,
} as const
/** How far up the chair's seat lifts a sitting agent, in art pixels. */
const SEAT = 8
/** Templates, one per hair style (Look.hairStyle wraps around them). */
const TEMPLATES = 3

/** Art pixels per second. */
const WALK_SPEED = 34
const GRAVITY = 900
const JUMP_TIME = 0.5
const CROUCH_TIME = 0.12
const LAND_TIME = 0.14
/** Idle this long (s) with nothing to do: it goes to its chair and dozes. */
const DOZE_AFTER = 75

/** Where a desk station is: the chair's x (the agent sits there) and the desk on its right. */
interface Station {
  x: number
}

type Mode = 'walk' | 'stand' | 'crouch' | 'jump' | 'air' | 'land' | 'sit' | 'held'

interface Pet {
  id: string
  x: number
  /** Feet, in CSS px from the top of the window. */
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  mode: Mode
  t: number
  targetX: number | null
  /** Seconds until an idle pet picks a new place to stroll to. */
  think: number
  idleFor: number
  jump?: { x0: number; y0: number; x1: number; y1: number; peak: number }
  station: number
  seed: number
}

export interface StageHit {
  id: string
  kind: 'agent' | 'desk'
}

function hash(s: string): number {
  let n = 2166136261
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619)
  return n >>> 0
}

export class Stage {
  private ctx: CanvasRenderingContext2D
  private pets = new Map<string, Pet>()
  private stations: Station[] = []
  private g: PetGeometry
  /** CSS px per art pixel. */
  scale = 1.5
  hover: string | null = null
  /** Space the toolbar takes on the right of the floor (CSS px). */
  reserveRight = 0
  private time = 0
  /** How many agents the desks were laid out for. */
  private laidFor = -1

  constructor(
    private canvas: HTMLCanvasElement,
    private state: State,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.g = { width: innerWidth, height: innerHeight, floor: innerHeight, dock: null, exact: false }
    this.resize()
    addEventListener('resize', () => this.resize())
  }

  setGeometry(g: PetGeometry): void {
    this.g = g
    this.layout()
    // the Dock moved under someone: they fall or step onto the new ground
    for (const p of this.pets.values()) if (p.mode !== 'held' && p.mode !== 'jump') this.toAir(p, 0)
  }

  get geometry(): PetGeometry {
    return this.g
  }

  private resize(): void {
    const dpr = devicePixelRatio || 1
    this.canvas.width = Math.round(innerWidth * dpr)
    this.canvas.height = Math.round(innerHeight * dpr)
    this.canvas.style.width = `${innerWidth}px`
    this.canvas.style.height = `${innerHeight}px`
    this.layout()
  }

  /** Ground under x: the Dock's top over the Dock, the floor elsewhere. */
  private ground(x: number): number {
    const d = this.g.dock
    return d && x >= d.left && x <= d.right ? d.top : this.g.floor
  }

  private onDock(x: number): boolean {
    const d = this.g.dock
    return !!d && x >= d.left && x <= d.right
  }

  /**
   * Desk stations: on the floor beside the Dock first (the nearest to it first, both sides in
   * turn), then on top of the Dock when the floor is full. With still more agents than room, the
   * desks squeeze closer, never on top of each other.
   */
  private layout(): void {
    const s = this.scale
    const need = Math.max(1, this.state.agents.size)
    const full = (28 + 54 + 26) * s
    const tight = (28 + 54 + 2) * s
    const W = this.g.width
    const margin = 16 * s
    const right = W - margin - this.reserveRight
    const d = this.g.dock
    const floor: [number, number, -1 | 1][] = d
      ? [
          [margin, d.left - 12 * s, -1],
          [d.right + 12 * s, right, 1],
        ]
      : [[margin, right, 1]]
    const dock: [number, number, -1 | 1][] = d ? [[d.left + 10 * s, d.right - 10 * s, 1]] : []
    const fit = (spans: [number, number, -1 | 1][], w: number) => spans.map(([a, b]) => Math.max(0, Math.floor((b - a) / w)))
    const room = (w: number) => [...fit(floor, w), ...fit(dock, w)].reduce((n, k) => n + k, 0)
    // the widest spacing that still seats everyone (or the tightest one, if not even that does)
    let w = full
    while (w > tight && room(w) < need) w -= 2 * s
    const place = (spans: [number, number, -1 | 1][]) => {
      const per = fit(spans, w)
      const lists = spans.map(([a, b, dir], i) => Array.from({ length: per[i] }, (_, k) => (dir < 0 ? b - w * (k + 1) : a + w * k)))
      const out: number[] = []
      for (let k = 0; k < Math.max(0, ...per); k++) for (const list of lists) if (k < list.length) out.push(list[k])
      return out
    }
    const order = [...place(floor), ...place(dock)]
    if (!order.length) order.push(margin)
    // the chair's x: it sits on the left of the station, the desk on its right
    this.stations = order.map((x) => ({ x: x + 16 * s }))
  }

  private stationOf(i: number): Station {
    const n = this.stations.length
    // past every desk: they share, a little to the side
    const base = this.stations[i % n]
    return { x: base.x + Math.floor(i / n) * 10 * this.scale }
  }

  /** Agents in desk order: the order they arrived in the office. */
  private agents(): AgentSummary[] {
    return [...this.state.agents.values()]
  }

  /** Keeps one pet per agent: new ones drop in from the top, gone ones vanish. */
  sync(): void {
    const list = this.agents()
    const ids = new Set(list.map((a) => a.id))
    for (const id of this.pets.keys()) if (!ids.has(id)) this.pets.delete(id)
    if (list.length !== this.laidFor) {
      this.laidFor = list.length
      this.layout()
    }
    list.forEach((a, i) => {
      let p = this.pets.get(a.id)
      if (!p) {
        const st = this.stationOf(i)
        p = { id: a.id, x: st.x, y: -60, vx: 0, vy: 0, facing: 1, mode: 'air', t: 0, targetX: null, think: 2, idleFor: 0, station: i, seed: hash(a.id) }
        this.pets.set(a.id, p)
      }
      p.station = i
    })
  }

  private toAir(p: Pet, vy: number): void {
    p.mode = 'air'
    p.vy = vy
    p.t = 0
  }

  private busy(a: AgentSummary): boolean {
    return a.status === 'working' || a.status === 'starting'
  }

  /** Something for the player: a permission, a question or a result. */
  private calling(a: AgentSummary): 'ask' | 'done' | 'err' | null {
    const items = this.state.itemsFor(a.id)
    if (items.permissions.length || a.status === 'waiting') return 'ask'
    if (a.status === 'error') return 'err'
    if (items.results.length || a.status === 'done') return 'done'
    return null
  }

  update(dt: number): void {
    this.time += dt
    const s = this.scale
    for (const p of this.pets.values()) {
      const a = this.state.agents.get(p.id)
      if (!a) continue
      p.t += dt
      const st = this.stationOf(p.station)
      // where it wants to be
      if (p.mode !== 'held' && p.mode !== 'air' && p.mode !== 'jump') {
        if (this.busy(a)) p.targetX = st.x
        else if (this.calling(a)) p.targetX = st.x - 16 * s
        else {
          p.idleFor += dt
          if (p.idleFor > DOZE_AFTER) p.targetX = st.x
          else if (p.mode === 'stand' && (p.think -= dt) <= 0) {
            // stroll: anywhere on the strip, the Dock too, then a pause
            const r = ((p.seed = hash(String(p.seed + this.time))) % 1000) / 1000
            p.targetX = 30 * s + r * (this.g.width - 60 * s - this.reserveRight)
            p.think = 3 + (p.seed % 7)
          }
        }
        if (this.busy(a) || this.calling(a)) p.idleFor = 0
      }
      this.step(p, a, dt, st)
    }
  }

  private step(p: Pet, a: AgentSummary, dt: number, st: Station): void {
    const s = this.scale
    switch (p.mode) {
      case 'held':
        return
      case 'air': {
        p.vy += GRAVITY * s * dt
        p.y += p.vy * dt
        p.x += p.vx * dt
        const gy = this.ground(p.x)
        if (p.y >= gy && p.vy > 0) {
          p.y = gy
          p.vx = 0
          p.mode = 'land'
          p.t = 0
        }
        return
      }
      case 'jump': {
        const j = p.jump!
        const k = Math.min(1, p.t / JUMP_TIME)
        p.x = j.x0 + (j.x1 - j.x0) * k
        // a parabola through the start, the peak at the middle and the landing
        const lin = j.y0 + (j.y1 - j.y0) * k
        p.y = lin - 4 * j.peak * k * (1 - k)
        if (k >= 1) {
          p.y = j.y1
          p.mode = 'land'
          p.t = 0
        }
        return
      }
      case 'crouch':
        if (p.t >= CROUCH_TIME) {
          p.mode = 'jump'
          p.t = 0
        }
        return
      case 'land':
        if (p.t >= LAND_TIME) {
          p.mode = 'stand'
          p.t = 0
        }
        return
      case 'sit':
        if (p.targetX === null || Math.abs(p.targetX - p.x) > 2 || (!this.busy(a) && p.idleFor <= DOZE_AFTER)) {
          p.mode = 'stand'
          p.t = 0
        }
        return
      case 'stand':
      case 'walk': {
        if (p.targetX === null || Math.abs(p.targetX - p.x) < 1.5) {
          if (p.targetX !== null) p.x = p.targetX
          p.targetX = null
          const atDesk = Math.abs(p.x - st.x) < 2
          if (atDesk && (this.busy(a) || p.idleFor > DOZE_AFTER)) {
            p.mode = 'sit'
            p.facing = 1
          } else if (p.mode === 'walk') p.mode = 'stand'
          if (this.calling(a)) p.facing = 1
          return
        }
        p.mode = 'walk'
        const dir: 1 | -1 = p.targetX > p.x ? 1 : -1
        p.facing = dir
        const nx = p.x + dir * Math.min(Math.abs(p.targetX - p.x), WALK_SPEED * s * dt)
        const d = this.g.dock
        // on the floor, about to run into the Dock: crouch and jump onto it
        if (d && !this.onDock(p.x) && p.y >= this.g.floor - 1) {
          const edge = dir > 0 ? d.left : d.right
          const ahead = (edge - p.x) * dir
          const goingIn = dir > 0 ? p.targetX > d.left : p.targetX < d.right
          if (goingIn && ahead >= 0 && ahead < 14 * s) {
            p.mode = 'crouch'
            p.t = 0
            const land = edge + dir * 14 * s
            p.jump = { x0: p.x, y0: p.y, x1: land, y1: d.top, peak: (this.g.floor - d.top) * 0.35 + 18 * s }
            return
          }
        }
        p.x = nx
        // walked off the Dock's end: down it goes
        if (p.y < this.ground(p.x) - 1) {
          p.vx = dir * WALK_SPEED * s * 0.9
          this.toAir(p, -60 * s)
        }
        return
      }
    }
  }

  /** The cell of the sheet for this pet now. */
  private pose(p: Pet, a: AgentSummary): number {
    const frame = (fps: number, n: number) => Math.floor((this.time + (p.seed % 100) / 37) * fps) % n
    switch (p.mode) {
      case 'walk':
        return POSE.walk[frame(8, 4)]
      case 'crouch':
      case 'land':
        return POSE.crouch
      case 'jump':
        return p.t < JUMP_TIME / 2 ? POSE.jump : POSE.fall
      case 'air':
        return p.vy < 0 ? POSE.jump : POSE.fall
      case 'held':
        return POSE.fall
      case 'sit':
        return this.busy(a) ? POSE.type[frame(a.status === 'working' ? 5 : 1.5, 2)] : POSE.sleep
      default:
        return this.calling(a) && frame(1.2, 2) === 0 ? POSE.wave : POSE.stand
    }
  }

  draw(): void {
    const { ctx } = this
    const dpr = devicePixelRatio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false
    const s = this.scale
    const list = this.agents()
    // desks first, then whoever stands in front of them
    list.forEach((_, i) => this.drawStation(this.stationOf(i), i))
    const seated = [...this.pets.values()].sort((a, b) => Number(b.mode === 'sit') - Number(a.mode === 'sit'))
    for (const p of seated) {
      const a = this.state.agents.get(p.id)
      if (!a) continue
      const sheet = this.sheetFor(a)
      if (!sheet) continue
      const cell = this.pose(p, a)
      const sx = (cell % 4) * CELL
      const sy = Math.floor(cell / 4) * CELL
      const w = CELL * s
      const lift = p.mode === 'sit' ? SEAT * s : 0
      const x = Math.round(p.x - w / 2)
      const y = Math.round(p.y - (CELL - FOOT) * s - lift)
      ctx.save()
      if (p.facing < 0 && cell !== POSE.wave) {
        ctx.translate(x + w, y)
        ctx.scale(-1, 1)
        ctx.drawImage(sheet, sx, sy, CELL, CELL, 0, 0, w, w)
      } else ctx.drawImage(sheet, sx, sy, CELL, CELL, x, y, w, w)
      ctx.restore()
      // the desk's front goes over the hands of whoever types at it
      this.bubble(p, a, y + 8 * s)
      if (this.hover === p.id) this.nameTag(p.x, y + 6 * s, a.name)
    }
  }

  private drawStation(st: Station, i: number): void {
    const { ctx } = this
    const s = this.scale
    const chair = sprites.get('cadeira')
    const desk = sprites.get('mesa')
    const base = this.ground(st.x)
    const put = (sp: Sprite | undefined, x: number, bottom = base) => sp && ctx.drawImage(sp.img, Math.round(x), Math.round(bottom - sp.h * s), sp.w * s, sp.h * s)
    // a touch of life on some desks, behind the furniture
    const extra = ['planta', null, 'servidor', 'caneca', null, 'luminaria'][i % 6]
    const e = extra ? sprites.get(extra) : undefined
    if (e && extra !== 'caneca' && desk) put(e, st.x + (4 + desk.w - e.w + 4) * s)
    put(chair, st.x - 15 * s)
    put(desk, st.x + 4 * s)
    if (e && extra === 'caneca' && desk) put(e, st.x + 10 * s, base - (desk.h - 5) * s)
  }

  private sheetFor(a: AgentSummary): CanvasImageSource | null {
    const n = ((a.look.hairStyle % TEMPLATES) + TEMPLATES) % TEMPLATES
    const key = `molde-${n}`
    const tpl = sprites.get(key) ?? sprites.get('molde-0')
    if (!tpl) return null
    return tinted(`pet/${key}`, tpl, { skin: a.look.skin, hair: a.look.hair, shirt: a.look.shirt, pants: a.look.pants, shoes: a.look.shoes })
  }

  private bubble(p: Pet, a: AgentSummary, headY: number): void {
    const call = this.calling(a)
    const asleep = p.mode === 'sit' && !this.busy(a)
    if (!call && !asleep) return
    const { ctx } = this
    const s = this.scale
    const bob = Math.round(Math.sin(this.time * 5 + p.seed) * 2 * s)
    const cx = Math.round(p.x + (p.mode === 'sit' ? 4 * s : 0))
    const cy = Math.round(headY - 10 * s + (call ? bob : 0))
    const text = call === 'ask' ? '!' : call === 'err' ? '×' : call === 'done' ? '✓' : 'z'
    const fill = call === 'ask' ? '#ffc24b' : call === 'err' ? '#ff6b6b' : call === 'done' ? '#5ee08a' : '#c8d0ff'
    const r = 7 * s
    ctx.fillStyle = '#141414'
    ctx.beginPath()
    ctx.arc(cx, cy, r + s, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#141414'
    ctx.font = `bold ${Math.round(9 * s)}px ui-monospace, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, cx, cy + s * 0.5)
  }

  private nameTag(x: number, y: number, name: string): void {
    const { ctx } = this
    ctx.font = '600 12px -apple-system, system-ui, sans-serif'
    const w = ctx.measureText(name).width + 14
    const tx = Math.round(x - w / 2)
    const ty = Math.round(y - 22 - 18 * this.scale)
    ctx.fillStyle = 'rgba(20, 20, 32, 0.88)'
    ctx.beginPath()
    ctx.roundRect(tx, ty, w, 20, 10)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, x, ty + 10.5)
  }

  /** The agent (or the desk of the agent) under a point in CSS px. */
  hit(x: number, y: number): StageHit | null {
    const s = this.scale
    for (const p of this.pets.values()) {
      const lift = p.mode === 'sit' ? SEAT * s : 0
      if (Math.abs(x - p.x) <= 13 * s && y <= p.y - lift + 2 && y >= p.y - lift - 46 * s) return { id: p.id, kind: 'agent' }
    }
    const list = this.agents()
    for (let i = 0; i < list.length; i++) {
      const st = this.stationOf(i)
      const base = this.ground(st.x)
      if (x >= st.x - 15 * s && x <= st.x + 58 * s && y >= base - 36 * s && y <= base) return { id: list[i].id, kind: 'desk' }
    }
    return null
  }

  /** Where an agent is, for placing its panel and card (CSS px; null when unknown). */
  where(id: string): { x: number; top: number } | null {
    const p = this.pets.get(id)
    return p ? { x: p.x, top: p.y - 50 * this.scale } : null
  }

  /** Picked up with the mouse: it dangles from the pointer until dropped. */
  grab(id: string): void {
    const p = this.pets.get(id)
    if (!p) return
    p.mode = 'held'
    p.targetX = null
  }

  moveHeld(id: string, x: number, y: number): void {
    const p = this.pets.get(id)
    if (!p || p.mode !== 'held') return
    p.facing = x >= p.x ? 1 : -1
    p.x = Math.max(10, Math.min(this.g.width - 10, x))
    p.y = Math.min(this.ground(p.x), y + 40 * this.scale)
  }

  drop(id: string): void {
    const p = this.pets.get(id)
    if (!p || p.mode !== 'held') return
    p.vx = 0
    this.toAir(p, 0)
    p.think = 2
  }

  /** A little hop, to show which one the panel belongs to. */
  hop(id: string): void {
    const p = this.pets.get(id)
    if (!p || p.mode === 'held' || p.mode === 'air' || p.mode === 'jump') return
    this.toAir(p, -240 * this.scale)
  }

  get busyNow(): boolean {
    return [...this.pets.values()].some((p) => p.mode !== 'stand' && p.mode !== 'sit')
  }
}
