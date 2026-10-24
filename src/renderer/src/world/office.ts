import * as THREE from 'three'
import * as F from './furniture'
import { box, mat } from './kit'
import { mergeStatic } from './merge'
import { BOSS_DESK, BOSS_SEAT, DESKS, ELEVATOR, H, LOUNGE, PARTITIONS, W, WALL_H, ZONES, type Partition, type Zone } from './layout'
import { Grid } from './pathfinding'
import { beacon, coffeeCorner, costBoard, routinesBoard, type Beacon, type CoffeeCorner, type CostBoard, type RoutinesBoard } from './props'
import { arcadePainter, LoopScreen, Screen } from './screens'
import { setNightLights } from './night'
import { workstation } from './workstation'
import { floorTexture, rugTexture, WindowSky } from './textures'
import { px } from './pixel-tag'

export interface Office {
  group: THREE.Group
  grid: Grid
  floor: THREE.Mesh
  deskScreens: Screen[]
  update(dt: number): void
  /** Opens the elevator doors for a moment (agent arriving or leaving). */
  ding(): void
  /** Lights one call button per floor on the elevator panel. */
  setFloors(n: number): void
  /** What this floor spent this session. */
  money: CostBoard
  /** Spins when an account this floor runs on hit its plan limit. */
  alarm: Beacon
  /** Next routine and the routines' LED, on the wall of your office or the Diretoria; a click opens Rotinas. */
  routines: RoutinesBoard
  /** Effects toned down (AO-32): the beacon turns slowly and stops strobing. */
  reducedMotion: boolean
  /** Modo noturno: lamps, windows and screens light the room (world/night.ts). */
  setNight(on: boolean): void
}

/** How fast the beacon runs with reduced effects: a slow turn, no strobe. */
export const CALM_BEACON = 0.15

export interface GroundFloor extends Office {
  /** Lounge monitor where Claude FM plays. */
  tv: F.MonitorTv
  /** The copa's espresso machine: a click opens the café corner (keep the screen awake). */
  coffee: CoffeeCorner
}

const WALL = '#aaa6d6'
const WAINSCOT = '#8f8ac2'
const BASEBOARD = '#5f5a8c'
const CAP = '#c9c5ea'

export function buildOffice(): GroundFloor {
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
  buildPartitions(group, grid, PARTITIONS)

  // ---------- boss office ----------
  const bossRug = F.rug(6, 4, rugTexture(6, 4, '#8e3b46', '#5e2430', '#e0a96d'))
  place(bossRug, 4.5, 6)
  place(F.bossDesk(BOSS_DESK.w), BOSS_DESK.x + BOSS_DESK.w / 2, BOSS_DESK.z + 0.5)
  grid.blockRect(BOSS_DESK.x, BOSS_DESK.z, BOSS_DESK.w, 1)
  place(F.monitorBack(0.85), 4.3, BOSS_DESK.z + 0.35, Math.PI, 0.78)
  place(F.keyboard(), 4.3, BOSS_DESK.z + 0.1, Math.PI, 0.78)
  place(F.deskLamp(), 5.7, BOSS_DESK.z + 0.35, -0.6, 0.78)
  place(F.paperStack(), 3.4, BOSS_DESK.z + 0.6, 0.2, 0.78)
  place(F.plant('cactus', '#e9edf2'), 3.25, BOSS_DESK.z + 0.25, 0, 0.78)
  place(F.mug('#d97757'), 5.3, BOSS_DESK.z + 0.7, 0, 0.78)
  place(F.bossChair(), BOSS_SEAT.x, BOSS_SEAT.z, 0)
  place(F.bookshelf(2, 1.9, 4), 1.0, 0.25)
  grid.blockRect(0, 0, 2, 1)
  place(F.clock(), 1.0, 0.04, 0, 2.25)
  const skies: WindowSky[] = []
  const sky = (seed: number): WindowSky => {
    const s = new WindowSky(seed)
    skies.push(s)
    return s
  }
  place(F.wallWindow(2.4, 1.3, sky(11)), 5.5, 0.02, 0, 1.6)
  place(F.plant('tall', '#e9edf2'), 7.5, 0.5)
  grid.block(7, 0)
  place(F.art('mondrian', 1.1, 0.8), 0.04, 2.4, Math.PI / 2, 1.6)
  place(F.sofa(2, '#d97757'), 0.45, 6, Math.PI / 2)
  grid.blockRect(0, 5, 1, 2)
  // the routines board above the sofa
  const routines = routinesBoard()
  place(routines.group, 0.06, 6, Math.PI / 2, 1.22)
  place(F.floorLamp(), 0.5, 4.5)
  grid.block(0, 4)
  place(F.plant('fern'), 0.5, 8.5)
  grid.block(0, 8)
  place(F.plant('flower', '#f5f3ee'), 8.5, 8.5)
  grid.block(8, 8)

  // ---------- team floor ----------
  const deskScreens: Screen[] = []
  for (const d of DESKS) {
    const screen = new Screen()
    deskScreens.push(screen)
    const ws = workstation(d.index, screen.texture, screen.led)
    loops.push(...ws.loops)
    place(ws.group, d.x + 1, d.z + 0.5)
    grid.blockRect(d.x, d.z, 2, 1)
  }
  // a runner down the walkway between the two rows
  place(F.rug(14, 1.4, rugTexture(14, 1.4, '#7f88b3', '#5d6591', '#d97757')), 19, 5.5)
  for (const x of [13, 18, 23]) place(F.wallWindow(2.2, 1.3, sky(x)), x + 0.5, 0.02, 0, 1.6)
  for (const x of [15, 20, 25]) {
    place(F.plant(x === 20 ? 'tall' : 'bush'), x + 0.5, 0.5)
    grid.block(x, 0)
  }
  place(F.printer(), 26.5, 0.45)
  grid.block(26, 0)
  place(F.waterCooler(), 27.5, 0.45)
  grid.block(27, 0)
  const elev = F.elevator()
  place(elev.group, ELEVATOR.x, 0.04)
  elev.buttons[1].visible = false
  place(F.cabinet(1), 28.5, 7.5)
  place(F.cabinet(1), 29.5, 7.5)
  grid.blockRect(28, 7, 2, 1)
  place(F.plant('tall'), 31.5, 3.5)
  grid.block(31, 3)
  place(F.plant('fern'), 31.5, 11.5)
  grid.block(31, 11)
  place(F.plant('bush'), 27.5, 11.5)
  grid.block(27, 11)
  place(F.trash(), 30.6, 7.6)
  grid.block(30, 7)

  // ---------- corridor ----------
  place(F.plant('tall', '#e9edf2'), 10.5, 0.5)
  grid.block(10, 0)
  place(F.art('mountains', 1.0, 0.75), 0.04, 9.9, Math.PI / 2, 1.6)

  // ---------- café: counter and fridge on the side wall, tables, the spending board ----------
  const counter = F.kitchenCounter(4)
  place(counter, 0.35, 16, Math.PI / 2)
  grid.blockRect(0, 14, 1, 4)
  place(F.wallCabinets(4), 0.2, 16, Math.PI / 2)
  const coffee = coffeeCorner()
  place(coffee.group, 0.4, 14.6, Math.PI / 2, 0.91)
  place(F.microwave(), 0.4, 15.6, Math.PI / 2, 0.91)
  place(F.mug('#e17055'), 0.5, 16.3, 0, 0.91)
  place(F.mug('#74b9ff'), 0.45, 16.5, 0, 0.91)
  place(F.fridge(), 0.4, 18.6, Math.PI / 2)
  grid.blockRect(0, 18, 1, 1)
  place(F.barTable(), 4.5, 15.5)
  grid.block(4, 15)
  for (const [x, z, c] of [[3.7, 15.5, '#d97757'], [5.3, 15.5, '#2f8f83'], [4.5, 14.7, '#6c5ce7']] as const) place(F.stool(c), x, z)
  place(F.roundTable(0.55), 4.5, 20)
  grid.block(4, 19)
  grid.block(4, 20)
  for (const [x, z, r] of [[3.5, 20, Math.PI / 2], [5.5, 20, -Math.PI / 2], [4.5, 21, Math.PI]] as const) place(F.simpleChair('#f4a259'), x, z, r)
  // the skeleton stands here by the boss office (added by the game)
  grid.block(2, 12)
  place(F.plant('tall'), 0.5, 11.5)
  grid.block(0, 11)
  place(F.plant('fern'), 8.5, 23.5)
  grid.block(8, 23)
  place(F.plant('bush'), 0.5, 23.5)
  grid.block(0, 23)
  place(F.plant('flower', '#f5f3ee'), 8.5, 11.5)
  grid.block(8, 11)
  // the spending board on the side wall with the alarm above it
  const money = costBoard('Escritório inteiro', 2.2)
  place(money.group, 0.06, 21.3, Math.PI / 2, 1.0)
  const alarm = beacon()
  place(alarm.group, 0.04, 19.4, Math.PI / 2, 1.85)

  // ---------- lounge (one big room: living area, games, chill corner) ----------
  const { sofaA, tableA, armchairs, foosball, circle, circleBags, sofaC, tableC, bagsC, pingPong } = LOUNGE

  // living area
  place(F.rug(6, 5, rugTexture(6, 5, '#d7ecd9', '#5f9e7a', '#2f8f83')), tableA.x, tableA.z)
  place(F.sofa(3, '#2f8f83'), sofaA.x, sofaA.z, 0)
  grid.blockRect(13, 16, 3, 1)
  place(F.coffeeTable(3), tableA.x, tableA.z)
  grid.blockRect(13, 18, 3, 1)
  place(F.armchair('#f4a259'), armchairs[0].x, armchairs[0].z, Math.PI / 2)
  grid.block(12, 18)
  place(F.armchair('#f4a259'), armchairs[1].x, armchairs[1].z, -Math.PI / 2)
  grid.block(16, 18)
  place(F.floorLamp(), 11.5, 16.5)
  grid.block(11, 16)
  // Claude FM monitor against the corridor, facing the camera
  const tv = F.monitorTv()
  place(tv.group, 11.4, 21, Math.PI / 2)
  for (let z = 19; z <= 22; z++) grid.block(11, z)
  place(F.plant('tall'), 11.5, 15.5)
  grid.block(11, 15)
  place(F.plant('fern'), 17.5, 15.5)
  grid.block(17, 15)

  // games and a bean bag circle in the middle
  place(F.foosball(), foosball.x, foosball.z)
  grid.blockRect(20, 17, 2, 1)
  place(F.rug(3, 3, rugTexture(3, 3, '#ffeaa7', '#e17055', '#d97757')), circle.x, circle.z)
  place(F.lowTable(), circle.x, circle.z)
  grid.block(20, 21)
  for (const b of circleBags) {
    place(F.beanBag(b.color), b.x, b.z, Math.atan2(circle.x - b.x, circle.z - b.z))
    grid.block(Math.floor(b.x), Math.floor(b.z))
  }
  place(F.plant('tall'), 20.5, 15.5)
  grid.block(20, 15)

  // chill corner with the arcades
  place(F.rug(6, 5, rugTexture(6, 5, '#f3e4c4', '#c98b5e', '#d97757')), tableC.x, tableC.z)
  place(F.sofa(3, '#4a8fe0'), sofaC.x, sofaC.z, 0)
  grid.blockRect(25, 16, 3, 1)
  place(F.coffeeTable(3), tableC.x, tableC.z)
  grid.blockRect(25, 18, 3, 1)
  for (const b of bagsC) {
    place(F.beanBag(b.color), b.x, b.z, Math.atan2(tableC.x - b.x, tableC.z - b.z))
    grid.block(Math.floor(b.x), Math.floor(b.z))
  }
  const arcadeScreen = new LoopScreen(24, 20, arcadePainter, 8)
  loops.push(arcadeScreen)
  place(F.arcade(arcadeScreen.texture), 31.5, 15.5)
  grid.block(31, 15)
  const arcade2 = new LoopScreen(24, 20, arcadePainter, 7)
  loops.push(arcade2)
  place(F.arcade(arcade2.texture), 30.5, 15.5)
  grid.block(30, 15)
  place(F.pingPong(), pingPong.x, pingPong.z, Math.PI / 2)
  grid.blockRect(29, 22, 2, 1)
  place(F.bookshelf(2, 1.7, 9), 24, 15.3)
  grid.blockRect(23, 15, 2, 1)
  place(F.floorLamp(), 24.4, 16.5)
  grid.block(24, 16)
  place(F.plant('tall'), 28.5, 15.5)
  grid.block(28, 15)

  // plants along the front edge
  for (const [x, kind] of [
    [11, 'bush'],
    [15, 'fern'],
    [23, 'bush'],
    [31, 'fern'],
  ] as const) {
    place(F.plant(kind), x + 0.5, 23.5)
    grid.block(x, 23)
  }

  // every box that never moves becomes one mesh per material (AO-30)
  mergeStatic(group)

  // ---------- elevator animation ----------
  let doorOpen = 0
  let doorTimer = 0
  const [doorL, doorR] = elev.doors
  return {
    group,
    grid,
    floor,
    deskScreens,
    tv,
    coffee,
    money,
    alarm,
    routines,
    reducedMotion: false,
    update(dt: number) {
      money.update(dt)
      coffee.update(dt)
      alarm.update(this.reducedMotion ? dt * CALM_BEACON : dt)
      for (const s of deskScreens) s.update(dt)
      for (const l of loops) l.update(dt)
      for (const s of skies) s.update()
      doorTimer = Math.max(0, doorTimer - dt)
      const target = doorTimer > 0 ? 1 : 0
      doorOpen += (target - doorOpen) * Math.min(1, dt * 5)
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
      for (const s of skies) s.update(true)
    },
  }
}

/** Floor slab and the two back walls, shared by every floor; `zones` paint the floor. */
export function buildShell(group: THREE.Group, zones?: Zone[]): THREE.Mesh {
  // ---------- floor slab ----------
  const side = mat('#4a4366')
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, H), [
    side,
    side,
    new THREE.MeshLambertMaterial({ map: floorTexture(zones) }),
    side,
    side,
    side,
  ])
  floor.position.set(W / 2, -0.2, H / 2)
  floor.receiveShadow = true
  floor.name = 'floor'
  group.add(px(floor, 'slab', { zones: zones ?? ZONES }))
  shell(box(group, W, 0.04, 0.02, '#36304f', W / 2, -0.4, H + 0.01, false))

  // ---------- back walls (z = 0 and x = 0) ----------
  const T = 0.25
  shell(box(group, W + T, WALL_H, T, WALL, (W - T) / 2, 0, -T / 2), 'wall')
  shell(box(group, T, WALL_H, H, WALL, -T / 2, 0, H / 2))
  shell(box(group, W + T + 0.04, 0.08, T + 0.04, CAP, (W - T) / 2, WALL_H, -T / 2, false), 'wall')
  shell(box(group, T + 0.04, 0.08, H + 0.02, CAP, -T / 2, WALL_H, H / 2, false))
  // wainscot + baseboard on the inner faces
  shell(box(group, W, 0.95, 0.03, WAINSCOT, W / 2, 0, 0.015, false), 'wall')
  shell(box(group, 0.03, 0.95, H, WAINSCOT, 0.015, 0, H / 2, false))
  shell(box(group, W, 0.04, 0.045, CAP, W / 2, 0.95, 0.02, false), 'wall')
  shell(box(group, 0.045, 0.04, H, CAP, 0.02, 0.95, H / 2, false))
  shell(box(group, W, 0.14, 0.05, BASEBOARD, W / 2, 0, 0.025, false), 'wall')
  shell(box(group, 0.05, 0.14, H, BASEBOARD, 0.025, 0, H / 2, false))

  return floor
}

/** Part of a floor's shell: the 2D view paints it once under everything; 'wall' marks the back wall's face. */
export function shell<T extends THREE.Object3D>(obj: T, part: 'wall' | 'base' = 'base'): T {
  return px(obj, 'shell', { part })
}

/** Glass partitions with doors; each pane also blocks its tile edge in the grid. */
export function buildPartitions(group: THREE.Group, grid: Grid, partitions: Partition[]): void {
  const glass = new THREE.MeshLambertMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.22, depthWrite: false })
  const frame = '#6d6a8f'
  for (const p of partitions) {
    for (let i = p.from; i < p.to; i++) {
      const isDoor = p.doors.includes(i)
      const cx = p.axis === 'x' ? p.at : i + 0.5
      const cz = p.axis === 'x' ? i + 0.5 : p.at
      const along = (w: number, h: number, d: number, color: string | THREE.Material, y: number) =>
        p.axis === 'x' ? box(group, d, h, w, color, cx, y, cz, false) : box(group, w, h, d, color, cx, y, cz, false)
      if (isDoor) continue
      along(1, 0.14, 0.1, frame, 0)
      along(1, 0.06, 0.08, frame, 1.36)
      const pane = along(0.98, 1.22, 0.03, glass, 0.14)
      pane.castShadow = false
      pane.renderOrder = 2
      if (p.axis === 'x') grid.blockEdgeX(p.at, i)
      else grid.blockEdgeZ(p.at, i)
    }
    // posts at every tile boundary, plus door jambs
    for (let i = p.from; i <= p.to; i++) {
      const prevDoor = p.doors.includes(i - 1) || i === p.from
      const nextDoor = p.doors.includes(i) || i === p.to
      if (prevDoor && nextDoor && i !== p.from && i !== p.to) continue
      const px = p.axis === 'x' ? p.at : i
      const pz = p.axis === 'x' ? i : p.at
      box(group, 0.08, 1.42, 0.08, frame, px, 0, pz)
    }
  }
}
