import * as THREE from 'three'
import * as F from './furniture'
import { box, panel } from './kit'
import { DIRECTOR_RECT, ELEVATOR, H, LOBBY_RECT, W, type SquadPlan } from './layout'
import { buildPartitions, buildShell, type Office } from './office'
import { Grid } from './pathfinding'
import { dashboardPainter, LoopScreen, Screen } from './screens'
import { rugTexture, WindowSky } from './textures'

export interface SquadFloor extends Office {
  plan: SquadPlan
  /** Big screen in the Diretoria: clicking it starts a cycle. */
  board: THREE.Object3D
}

const CHAIR_COLORS = ['#2f8f83', '#d97757', '#6c5ce7', '#3d4a6b', '#e1873b']
const RUGS: [string, string, string][] = [
  ['#e6eef7', '#7b9cc4', '#4a6fa5'],
  ['#f3e4c4', '#c98b5e', '#d97757'],
  ['#e3f1e6', '#6fae86', '#2f8f83'],
  ['#efe6f7', '#9b85c9', '#6c5ce7'],
  ['#f7ebe1', '#d39a6a', '#b5651d'],
  ['#e9eef0', '#8aa1ab', '#4f6d7a'],
]

/** The squad floor: Diretoria with the orchestrators' desks around the elevator, sector rooms with free desks, a lobby. */
export function buildSquadFloor(plan: SquadPlan, title: string): SquadFloor {
  const group = new THREE.Group()
  const grid = new Grid(W, H)
  const loops: LoopScreen[] = []
  const place = (obj: THREE.Object3D, x: number, z: number, rot = 0, y = 0) => {
    obj.position.set(x, y, z)
    obj.rotation.y = rot
    group.add(obj)
    return obj
  }

  const floor = buildShell(group)
  buildPartitions(group, grid, plan.partitions)

  // ---------- Diretoria ----------
  const [dx0, , dx1, dz1] = DIRECTOR_RECT
  const dcx = (dx0 + dx1) / 2
  place(F.rug(8, 4, rugTexture(8, 4, '#2d3a5c', '#1d2742', '#e0a96d')), dcx, 5.5)
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
  // back wall, left to right: plant, sign and clock, cycle board, then the elevator
  place(F.plant('tall', '#e9edf2'), dx0 + 0.5, 0.5)
  grid.block(dx0, 0)
  place(F.clock(), dx0 + 2.3, 0.04, 0, 2.25)
  place(sign('Diretoria', '#1d2742', '#f6c445'), dx0 + 2.3, 0.03, 0, 2.05)
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

  // ---------- sector rooms ----------
  const deskScreens: Screen[] = []
  plan.sectors.forEach((r, i) => {
    const [x0, z0, x1, z1] = r.rect
    const cx = (x0 + x1) / 2
    const [base, border, accent] = RUGS[i % RUGS.length]
    place(F.rug(x1 - x0 - 1, z1 - z0 - 1, rugTexture(x1 - x0 - 1, z1 - z0 - 1, base, border, accent)), cx, (z0 + z1) / 2)
    for (const d of r.desks) {
      place(F.desk(2), d.x + 1, d.z + 0.5)
      grid.blockRect(d.x, d.z, 2, 1)
      const screen = new Screen()
      deskScreens[d.index] = screen
      place(F.monitor(screen.texture, 0.95).group, d.x + 1, d.z + 0.28, 0, 0.76)
      place(F.keyboard(), d.x + 1, d.z + 0.68, 0, 0.76)
      place(F.mug(['#ffffff', '#fdcb6e', '#81ecec'][d.index % 3]), d.x + 0.3, d.z + 0.62, 0, 0.76)
      place(F.officeChair(CHAIR_COLORS[d.index % CHAIR_COLORS.length]), d.seat.x, d.seat.z - 0.05, Math.PI)
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

  // ---------- lobby ----------
  const [lx0, , lx1] = LOBBY_RECT
  place(sign(title, '#d97757', '#ffffff', 2.4), lx0 + 1.6, 0.03, 0, 1.95)
  const skies = [new WindowSky(31)]
  place(F.wallWindow(1.6, 1.3, skies[0]), lx1 - 1.4, 0.02, 0, 1.6)
  place(F.sofa(2, '#d97757'), lx0 + 1.5, 5.45, 0)
  grid.blockRect(lx0 + 1, 5, 2, 1)
  place(F.coffeeTable(2), lx0 + 1.5, 7)
  grid.blockRect(lx0 + 1, 7, 2, 1)
  place(F.plant('tall'), lx1 - 0.5, 8.5)
  grid.block(lx1 - 1, 8)
  place(F.waterCooler(), lx1 - 0.5, 6.5)
  grid.block(lx1 - 1, 6)

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
    update(dt: number) {
      for (const s of deskScreens) s?.update(dt)
      for (const l of loops) l.update(dt)
      for (const s of skies) s.update()
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
