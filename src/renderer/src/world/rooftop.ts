import * as THREE from 'three'
import { brandSign, type Brand } from './brand'
import * as F from './furniture'
import { box, mat } from './kit'
import { DIRECTOR_RECT, ELEVATOR, H, ROOF_RECT, W, WALL_H, type ProjectPlan } from './layout'
import { mergeStatic } from './merge'
import { CALM_BEACON, shell } from './office'
import { glow, setNightLights } from './night'
import { Grid } from './pathfinding'
import { beacon, costBoard, routinesBoard } from './props'
import { dashboardPainter, LoopScreen, Screen } from './screens'
import { canvas, pixelTexture, rng, rugTexture, TILE_PX } from './textures'
import type { UpperFloor } from './upper-floor'
import { workstation } from './workstation'
import { px } from './pixel-tag'

// The creative floor: a rooftop on top of the building, smaller than a project floor. An open
// studio under a pergola, a penthouse wall by the elevator with the studio screen, a deck, glass
// railings, planters and the roof's machinery (water tank, AC units).

const DECK = ['#b07a4f', '#a46f47', '#bb8559', '#9c6842']

function deckTexture(w: number, h: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(w * TILE_PX, h * TILE_PX)
  const r = rng(11)
  // planks along x, 4 px tall, offset joints
  for (let y = 0; y < c.height; y += 4) {
    let x = -Math.floor(r() * 40)
    while (x < c.width) {
      const len = 28 + Math.floor(r() * 36)
      ctx.fillStyle = DECK[Math.floor(r() * DECK.length)]
      ctx.fillRect(x, y, len, 4)
      ctx.fillStyle = 'rgba(60,35,20,0.35)'
      ctx.fillRect(x, y + 3, len, 1)
      ctx.fillRect(x + len - 1, y, 1, 4)
      x += len
    }
  }
  return pixelTexture(c)
}

/** Glass railing along one edge (axis x: runs along z at x = at). */
function railing(group: THREE.Group, axis: 'x' | 'z', at: number, from: number, to: number): void {
  const glass = new THREE.MeshLambertMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.25, depthWrite: false })
  const len = to - from
  const mid = (from + to) / 2
  const along = (w: number, h: number, d: number, m: string | THREE.Material, y: number) => (axis === 'z' ? box(group, len * w, h, d, m, mid, y, at, false) : box(group, d, h, len * w, m, at, y, mid, false))
  along(1, 0.22, 0.2, '#6d6a8f', 0)
  const pane = along(0.995, 0.8, 0.03, glass, 0.22)
  pane.renderOrder = 2
  along(1, 0.06, 0.12, '#d9d6f0', 1.02)
  for (let i = from; i <= to; i += 2) {
    if (axis === 'z') box(group, 0.08, 1.08, 0.08, '#6d6a8f', i, 0, at)
    else box(group, 0.08, 1.08, 0.08, '#6d6a8f', at, 0, i)
  }
}

export function buildRooftop(plan: ProjectPlan, brand: Brand): UpperFloor {
  const group = new THREE.Group()
  const grid = new Grid(W, H)
  const [rx0, rz0, rx1, rz1] = ROOF_RECT
  const rw = rx1 - rx0
  const rh = rz1 - rz0
  const place = (obj: THREE.Object3D, x: number, z: number, rot = 0, y = 0) => {
    obj.position.set(x, y, z)
    obj.rotation.y = rot
    group.add(obj)
    return obj
  }
  // only the roof is walkable
  for (let x = 0; x < W; x++) for (let z = 0; z < H; z++) if (x < rx0 || x >= rx1 || z < rz0 || z >= rz1) grid.block(x, z)

  // ---------- slab and deck ----------
  const side = mat('#4a4366')
  const floor = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.4, rh), [side, side, new THREE.MeshLambertMaterial({ map: deckTexture(rw, rh) }), side, side, side])
  floor.position.set(rx0 + rw / 2, -0.2, rz0 + rh / 2)
  floor.receiveShadow = true
  floor.name = 'floor'
  group.add(px(floor, 'slab', { deck: true }))
  // the building's top edge: a thicker band under the deck
  shell(box(group, rw + 0.3, 0.5, rh + 0.3, '#3b3556', rx0 + rw / 2, -0.9, rz0 + rh / 2, false))

  // ---------- penthouse wall by the elevator ----------
  const T = 0.25
  const px0 = DIRECTOR_RECT[0] - 4
  shell(box(group, rx1 - px0 + T, WALL_H, T, '#aaa6d6', (px0 + rx1) / 2, 0, -T / 2), 'wall')
  shell(box(group, rx1 - px0 + T + 0.04, 0.08, T + 0.04, '#c9c5ea', (px0 + rx1) / 2, WALL_H, -T / 2, false), 'wall')
  shell(box(group, rx1 - px0, 0.14, 0.05, '#6d6a8f', (px0 + rx1) / 2, 0, 0.025, false), 'wall')
  // its side wall, short, so the roof reads as open air past it
  box(group, T, WALL_H, 1.6, '#aaa6d6', px0 - T / 2, 0, 0.8)
  const elev = F.elevator()
  place(elev.group, ELEVATOR.x, 0.04)

  // railings on the open edges
  railing(group, 'z', 0.02, rx0, px0)
  railing(group, 'x', rx0 + 0.02, rz0, rz1)
  railing(group, 'z', rz1 - 0.02, rx0, rx1)
  railing(group, 'x', rx1 - 0.02, 1.7, rz1)

  // ---------- the studio screen, sign and boards on the penthouse wall ----------
  const [dx0] = DIRECTOR_RECT
  place(brandSign(brand, 2.4), dx0 + 1.6, 0.03, 0, 1.75)
  const loops: LoopScreen[] = []
  const dash = new LoopScreen(48, 26, dashboardPainter, 4)
  loops.push(dash)
  place(F.tv(dash.texture), dx0 + 4, 0.06, 0, 1.6)
  const board = new THREE.Object3D()
  board.position.set(dx0 + 4, 2.05, 0.3)
  group.add(board)
  const routines = routinesBoard()
  place(routines.group, dx0 + 6, 0.06, 0, 1.22)
  const money = costBoard(brand.name, 2.2)
  place(money.group, px0 + 1.6, 0.06, 0, 1.0)
  const alarm = beacon()
  place(alarm.group, px0 + 3.3, 0.06, 0, 1.85)

  // the Diretoria corner: the directors' desks stay, as a review table by the screen
  for (const d of plan.directors) {
    place(F.bossDesk(d.w), d.x + d.w / 2, d.z + 0.5)
    grid.blockRect(d.x, d.z, d.w, 1)
    place(F.laptop(), d.seat.x - 0.2, d.z + 0.3, Math.PI, 0.78)
    place(F.mug('#fdcb6e'), d.x + d.w - 0.4, d.z + 0.7, 0, 0.78)
    place(F.bossChair(), d.seat.x, d.seat.z, 0)
  }

  // ---------- open studio under a pergola ----------
  const deskScreens: Screen[] = []
  for (const r of plan.team) {
    const [x0, z0, x1, z1] = r.rect
    place(F.rug(x1 - x0 - 1, z1 - z0 - 1, rugTexture(x1 - x0 - 1, z1 - z0 - 1, '#efe6f7', '#9b85c9', brand.color)), (x0 + x1) / 2, (z0 + z1) / 2)
    for (const d of r.desks) {
      const screen = new Screen()
      deskScreens[d.index] = screen
      const ws = workstation(d.index + 2, screen.texture, screen.led)
      loops.push(...ws.loops)
      place(ws.group, d.x + 1, d.z + 0.5)
      grid.blockRect(d.x, d.z, 2, 1)
    }
    // pergola: posts on the corners, beams on top and thin slats across
    const wood = '#7a5235'
    // over everyone's heads: the 2D view leaves it out, it would cover the desks
    const pergola = px(new THREE.Group(), 'pergola')
    group.add(pergola)
    const posts: [number, number][] = [
      [x0 + 0.3, z0 + 0.4],
      [x1 - 0.3, z0 + 0.4],
      [x0 + 0.3, z1 - 0.3],
      [x1 - 0.3, z1 - 0.3],
    ]
    for (const [x, z] of posts) box(pergola, 0.16, 2.6, 0.16, wood, x, 0, z)
    box(pergola, x1 - x0 - 0.4, 0.14, 0.12, wood, (x0 + x1) / 2, 2.6, z0 + 0.4, false)
    box(pergola, x1 - x0 - 0.4, 0.14, 0.12, wood, (x0 + x1) / 2, 2.6, z1 - 0.3, false)
    for (let x = x0 + 1; x < x1; x += 1.25) box(pergola, 0.07, 0.07, z1 - z0 - 0.6, wood, x, 2.74, (z0 + z1) / 2, false)
    // string lights along the front beam
    const bulb = new THREE.MeshBasicMaterial({ color: '#ffe8a3' })
    for (let x = x0 + 0.8; x < x1 - 0.4; x += 0.7) box(pergola, 0.08, 0.08, 0.08, bulb, x, 2.42 + Math.sin(x * 1.7) * 0.06, z1 - 0.3, false)
    for (const f of [0.3, 0.7]) glow(group, '#ffd98a', 2.6, 5, x0 + (x1 - x0) * f, 2.2, z1 - 0.6)
    place(F.plant('tall'), x0 + 0.7, z1 - 0.7)
    grid.block(x0, z1 - 1)
  }

  // ---------- the roof: lounge, planters and machinery ----------
  const block = (x: number, z: number, w = 1, h = 1) => grid.blockRect(Math.floor(x), Math.floor(z), w, h)
  // lounge in front of the penthouse
  place(F.rug(4, 2, rugTexture(4, 2, '#f3e4c4', '#c98b5e', brand.color)), 26, 12)
  place(F.lowTable(), 26, 12)
  block(26, 12)
  for (const [dx, c] of [[-1.3, '#a29bfe'], [1.3, '#ff7675']] as const) {
    place(F.beanBag(c), 26 + dx, 12, dx < 0 ? Math.PI / 2 : -Math.PI / 2)
    block(26 + dx, 12)
  }
  // planters along the front railing
  for (const [x, kind] of [[12.5, 'bush'], [16.5, 'fern'], [20.5, 'bush'], [23.3, 'flower']] as const) {
    place(F.plant(kind), x, rz1 - 0.6)
    block(x, rz1 - 1)
  }
  // water tank and AC units at the far corner
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 12), mat('#8fa3b8'))
  tank.position.set(30.7, 0.9, 12.2)
  tank.castShadow = true
  group.add(px(tank, 'tank'))
  box(group, 0.9, 0.15, 0.9, '#5d6b7a', 30.7, 0, 12.2)
  block(30, 11, 2, 2)
  for (const z of [8.3, 9.6]) {
    px(box(group, 1.1, 0.7, 1.0, '#c9ced6', 31.2, 0, z), 'acUnit')
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.02, 10), mat('#4a5361'))
    fan.position.set(31.2, 0.71, z)
    group.add(fan)
    block(31, Math.floor(z))
  }

  mergeStatic(group)

  let doorOpen = 0
  let doorTimer = 0
  const [doorL, doorR] = elev.doors
  return {
    group,
    grid,
    floor,
    deskScreens,
    plan,
    board,
    money,
    alarm,
    routines,
    reducedMotion: false,
    update(dt: number) {
      money.update(dt)
      alarm.update(this.reducedMotion ? dt * CALM_BEACON : dt)
      for (const s of deskScreens) s?.update(dt)
      for (const l of loops) l.update(dt)
      doorTimer = Math.max(0, doorTimer - dt)
      doorOpen += ((doorTimer > 0 ? 1 : 0) - doorOpen) * Math.min(1, dt * 5)
      const w = 0.72 * (1 - doorOpen * 0.9)
      doorL.scale.x = doorR.scale.x = w
      doorL.position.x = -0.72 + w / 2
      doorR.position.x = 0.72 - w / 2
    },
    ding() {
      doorTimer = 2.2
    },
    setFloors(n: number) {
      elev.buttons.forEach((b, i) => (b.visible = i < n))
    },
    setNight(on: boolean) {
      setNightLights(group, on)
    },
  }
}
