import * as THREE from 'three'
import { brandSign, type Brand } from './brand'
import * as F from './furniture'
import { beacon, costBoard } from './props'
import { workstation } from './workstation'
import { box, panel } from './kit'
import { mergeStatic } from './merge'
import { DIRECTOR_RECT, ELEVATOR, H, W, type ProjectPlan, type SectorRoom } from './layout'
import { buildPartitions, buildShell, type Office } from './office'
import { Grid } from './pathfinding'
import { arcadePainter, dashboardPainter, LoopScreen, Screen } from './screens'
import { rugTexture } from './textures'

/** A project floor. deskScreens holds the team desks first, then the sector desks (DeskSlot.index). */
export interface UpperFloor extends Office {
  plan: ProjectPlan
  /** Big screen in the Diretoria: clicking it hires a squad. */
  board: THREE.Object3D
}

const RUGS: [string, string, string][] = [
  ['#e6eef7', '#7b9cc4', '#4a6fa5'],
  ['#f3e4c4', '#c98b5e', '#d97757'],
  ['#e3f1e6', '#6fae86', '#2f8f83'],
  ['#efe6f7', '#9b85c9', '#6c5ce7'],
  ['#f7ebe1', '#d39a6a', '#b5651d'],
  ['#e9eef0', '#8aa1ab', '#4f6d7a'],
]

/** A project floor: Diretoria with the company's sign and the orchestrators' desks around the elevator, team and sector rooms. */
export function buildUpperFloor(plan: ProjectPlan, brand: Brand): UpperFloor {
  const group = new THREE.Group()
  const grid = new Grid(W, H)
  const loops: LoopScreen[] = []
  const place = (obj: THREE.Object3D, x: number, z: number, rot = 0, y = 0) => {
    obj.position.set(x, y, z)
    obj.rotation.y = rot
    group.add(obj)
    return obj
  }

  // planks in the Diretoria, carpet in the rooms (under their rugs), hall planks in the corridor
  const floor = buildShell(group, [{ id: 'boss', label: '', rect: DIRECTOR_RECT }, ...[...plan.team, ...plan.sectors].map((r) => ({ id: 'team' as const, label: '', rect: r.rect })), ...plan.commons.map((rect, i) => ({ id: COMMONS[i % COMMONS.length] === 'cafe' ? ('cafe' as const) : ('lounge' as const), label: '', rect }))])
  buildPartitions(group, grid, plan.partitions)

  // ---------- Diretoria ----------
  const [dx0, , dx1, dz1] = DIRECTOR_RECT
  const dcx = (dx0 + dx1) / 2
  place(F.rug(8, 4, rugTexture(8, 4, '#2d3a5c', '#1d2742', brand.color)), dcx, 5.5)
  for (const d of plan.directors) {
    place(F.bossDesk(d.w), d.x + d.w / 2, d.z + 0.5)
    grid.blockRect(d.x, d.z, d.w, 1)
    place(F.monitorBack(0.85), d.seat.x - 0.2, d.z + 0.35, Math.PI, 0.78)
    place(F.keyboard(), d.seat.x - 0.2, d.z + 0.1, Math.PI, 0.78)
    place(F.paperStack(), d.x + 0.4, d.z + 0.6, 0.2, 0.78)
    place(F.mug('#fdcb6e'), d.x + d.w - 0.4, d.z + 0.7, 0, 0.78)
    place(F.bossChair(), d.seat.x, d.seat.z, 0)
    place(F.simpleChair('#6c5ce7'), d.side.x, d.side.z, -Math.PI / 2)
  }
  // back wall, left to right: plant, the company's sign, cycle board, then the elevator
  place(F.plant('tall', '#e9edf2'), dx0 + 0.5, 0.5)
  grid.block(dx0, 0)
  place(brandSign(brand, 2.4), dx0 + 2.4, 0.03, 0, 1.75)
  place(F.plant('fern'), dx0 + 0.5, dz1 - 0.5)
  grid.block(dx0, dz1 - 1)
  place(F.plant('flower', '#f5f3ee'), dx1 - 0.5, dz1 - 0.5)
  grid.block(dx1 - 1, dz1 - 1)
  const dash = new LoopScreen(48, 26, dashboardPainter, 4)
  loops.push(dash)
  place(F.tv(dash.texture), dx0 + 5, 0.06, 0, 1.6)
  const board = new THREE.Object3D()
  board.position.set(dx0 + 5, 2.05, 0.3)
  group.add(board)
  // the elevator opens into the Diretoria
  const elev = F.elevator()
  place(elev.group, ELEVATOR.x, 0.04)

  // ---------- team and sector rooms ----------
  const deskScreens: Screen[] = []
  const rooms: [SectorRoom, number][] = [...plan.team.map((r): [SectorRoom, number] => [r, 0]), ...plan.sectors.map((r, i): [SectorRoom, number] => [r, i + 1])]
  rooms.forEach(([r, rug]) => {
    const [x0, z0, x1, z1] = r.rect
    const cx = (x0 + x1) / 2
    const [base, border, accent] = RUGS[rug % RUGS.length]
    place(F.rug(x1 - x0 - 1, z1 - z0 - 1, rugTexture(x1 - x0 - 1, z1 - z0 - 1, base, border, accent)), cx, (z0 + z1) / 2)
    for (const d of r.desks) {
      const screen = new Screen()
      deskScreens[d.index] = screen
      const ws = workstation(d.index + 2, screen.texture)
      loops.push(...ws.loops)
      place(ws.group, d.x + 1, d.z + 0.5)
      grid.blockRect(d.x, d.z, 2, 1)
    }
    // the sign: on the back wall for rooms along it, over the door for the front ones
    if (r.top) {
      place(sign(r.name, '#2d3142', '#ffffff'), cx, 0.03, 0, 2.0)
      place(F.plant('bush'), x0 + 0.5, 0.5)
      grid.block(x0, 0)
    } else {
      place(sign(r.name, '#2d3142', '#ffffff'), cx, z0 + 0.06, 0, 1.62)
      place(F.plant('fern'), x1 - 0.5, z1 - 0.5)
      grid.block(x1 - 1, z1 - 1)
    }
  })

  // ---------- common areas in the front rooms no sector took ----------
  plan.commons.forEach((rect, i) => commons(COMMONS[i % COMMONS.length], rect, place, grid, loops, brand.color))

  // the company's spending board on the side wall, the alarm above it
  const money = costBoard(brand.name, 2.2)
  place(money.group, 0.06, 5, Math.PI / 2, 1.0)
  const alarm = beacon()
  place(alarm.group, 0.04, 7.6, Math.PI / 2, 1.85)
  // every box that never moves becomes one mesh per material (AO-30)
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
    update(dt: number) {
      money.update(dt)
      alarm.update(dt)
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
  }
}

type Common = 'lounge' | 'cafe' | 'games' | 'quiet'
const COMMONS: Common[] = ['lounge', 'cafe', 'games', 'quiet']

/** Furnishes an open front area (8 x 11 tiles); its back edge faces the corridor. */
function commons(kind: Common, rect: [number, number, number, number], place: (o: THREE.Object3D, x: number, z: number, rot?: number, y?: number) => THREE.Object3D, grid: Grid, loops: LoopScreen[], accent: string): void {
  const [x0, z0, x1, z1] = rect
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2 + 0.5
  const block = (x: number, z: number, w = 1, h = 1) => grid.blockRect(Math.floor(x), Math.floor(z), w, h)
  switch (kind) {
    case 'lounge':
      place(F.rug(6, 5, rugTexture(6, 5, '#e6eef7', '#7b9cc4', accent)), cx, cz)
      place(F.sofa(3, '#3d4a6b'), cx, cz - 1.55, 0)
      block(cx - 1.5, cz - 2, 3)
      place(F.coffeeTable(3), cx, cz)
      block(cx - 1.5, cz, 3)
      place(F.armchair('#f4a259'), cx - 2.05, cz, Math.PI / 2)
      block(cx - 2.5, cz)
      place(F.armchair('#f4a259'), cx + 2.05, cz, -Math.PI / 2)
      block(cx + 1.5, cz)
      place(F.floorLamp(), x0 + 0.5, z0 + 1.5)
      block(x0, z0 + 1)
      place(F.plant('tall'), x1 - 0.5, z1 - 0.5)
      block(x1 - 1, z1 - 1)
      place(F.plant('bush'), x0 + 0.5, z1 - 0.5)
      block(x0, z1 - 1)
      break
    case 'cafe':
      place(F.kitchenCounter(3), cx, z1 - 0.7, Math.PI)
      block(cx - 1.5, z1 - 1, 3)
      place(F.coffeeMachine(), cx - 0.8, z1 - 0.75, Math.PI, 0.91)
      place(F.microwave(), cx + 0.3, z1 - 0.75, Math.PI, 0.91)
      place(F.fridge(), cx + 2.2, z1 - 0.6, Math.PI)
      block(cx + 1.5, z1 - 1)
      place(F.barTable(), cx - 1.5, cz - 1.5)
      block(cx - 2, cz - 2)
      for (const [dx, dz, c] of [[-0.8, 0, '#d97757'], [0.8, 0, '#2f8f83'], [0, -0.8, accent]] as const) place(F.stool(c), cx - 1.5 + dx, cz - 1.5 + dz)
      place(F.roundTable(0.55), cx + 1.5, cz)
      block(cx + 1, cz)
      for (const [dx, dz, r] of [[-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2], [0, -1, 0]] as const) place(F.simpleChair('#f4a259'), cx + 1.5 + dx, cz + dz, r)
      place(F.plant('fern'), x0 + 0.5, z1 - 0.5)
      block(x0, z1 - 1)
      break
    case 'games': {
      place(F.rug(6, 5, rugTexture(6, 5, '#f3e4c4', '#c98b5e', accent)), cx, cz)
      place(F.foosball(), cx - 1.5, cz - 1)
      block(cx - 2.5, cz - 1.5, 2)
      place(F.pingPong(), cx + 1.5, cz + 1, Math.PI / 2)
      block(cx + 1, cz + 0.5, 2)
      const screen = new LoopScreen(24, 20, arcadePainter, 7)
      loops.push(screen)
      place(F.arcade(screen.texture), x1 - 0.5, z1 - 0.6, Math.PI)
      block(x1 - 1, z1 - 1)
      place(F.plant('tall'), x0 + 0.5, z1 - 0.5)
      block(x0, z1 - 1)
      break
    }
    case 'quiet':
      place(F.rug(4, 4, rugTexture(4, 4, '#e3f1e6', '#6fae86', accent)), cx, cz)
      place(F.lowTable(), cx, cz)
      block(cx, cz)
      for (const [dx, dz, c] of [[-1.2, 0, '#a29bfe'], [1.2, 0, '#ff7675'], [0, 1.2, '#55efc4'], [0, -1.2, '#fdcb6e']] as const) {
        place(F.beanBag(c), cx + dx, cz + dz, Math.atan2(-dx, -dz))
        block(cx + dx, cz + dz)
      }
      // against the side wall when there is one, else facing into the area from the back
      if (x0 === 0) {
        place(F.bookshelf(2, 1.7, 5), 0.3, z0 + 3, Math.PI / 2)
        block(0, z0 + 2, 1, 2)
      } else {
        place(F.bookshelf(2, 1.7, 5), x0 + 1.2, z0 + 0.6)
        block(x0, z0, 2)
      }
      place(F.plant('fern'), x1 - 0.5, z1 - 0.5)
      block(x1 - 1, z1 - 1)
      place(F.plant('flower', '#f5f3ee'), x1 - 0.5, z0 + 1.5)
      block(x1 - 1, z0 + 1)
  }
}

/** A flat name plate (facing +z) for walls and doors. */
function sign(text: string, bg: string, fg: string, width = 2.2): THREE.Group {
  const g = new THREE.Group()
  const c = document.createElement('canvas')
  c.width = Math.round(116 * width)
  c.height = 48
  const ctx = c.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = fg
  ctx.font = 'bold 26px -apple-system, "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let label = text
  while (ctx.measureText(label).width > c.width - 24 && label.length > 4) label = label.slice(0, -2) + '…'
  ctx.fillText(label === text ? text : label, c.width / 2, c.height / 2 + 1)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const h = (width * c.height) / c.width
  box(g, width + 0.08, h + 0.08, 0.04, '#5f5a8c', 0, -0.04, 0, false)
  panel(g, width, h, tex, 0, h / 2, 0.025)
  return g
}
