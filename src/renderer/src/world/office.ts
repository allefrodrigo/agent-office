import * as THREE from 'three'
import * as F from './furniture'
import { box, mat } from './kit'
import { mergeStatic } from './merge'
import { BENCH_X, BOSS_DESK, BOSS_SEAT, DESKS, DOOR_H, ELEVATOR, GROUND_MEETING, H, LOUNGE, PARTITIONS, ROOM_WALL_H, ROOM_WALL_T, W, WALL_H, ZONES, type Partition, type Zone } from './layout'
import { meetingRoom, type MeetingRoomView } from './meeting-room'
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
  /** The room walls, for the 3D view's through-wall silhouettes (layout.ts behindWall). */
  walls: Partition[]
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
  /** The lounge's espresso machine: a click opens the café corner (keep the screen awake). */
  coffee: CoffeeCorner
  /** Over the Sala de reunião's door: where its tag goes. */
  meetingAnchor: THREE.Object3D
  /** The Sala de reunião: its sign and TV light up during a meeting (RN-17). */
  meeting: MeetingRoomView
}

// warm white walls over a sage wainscot, charcoal frames: the startup palette of 0.4.0-beta.6
const WALL = '#ebe6dd'
const WAINSCOT = '#aebdb3'
const BASEBOARD = '#56635c'
const CAP = '#f8f5ef'
const DOOR_FRAME = '#3d4247'

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

  const floor = buildShell(group, [...ZONES, { id: 'cafe', label: '', rect: LOUNGE.cafe.rect }])
  buildPartitions(group, grid, PARTITIONS)

  // ---------- boss office ----------
  const bossRug = F.rug(6, 4, rugTexture(6, 4, '#8e3b46', '#5e2430', '#e0a96d', 'kilim'))
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
  // a low sideboard under the window, behind your chair
  place(F.credenza(2), 5, 0.3)
  grid.blockRect(4, 0, 2, 1)
  place(F.plant('flower', '#f5f3ee'), 5.6, 0.3, 0, 0.64)
  place(F.plant('tall', '#e9edf2'), 7.5, 0.5)
  grid.block(7, 0)
  place(F.greenWall(2, 1.1), 0.04, 2.4, Math.PI / 2, 2.15)
  place(F.sofa(2, '#d97757'), 0.45, 6, Math.PI / 2)
  grid.blockRect(0, 5, 1, 2)
  // the routines board above the sofa
  const routines = routinesBoard()
  place(routines.group, 0.06, 6, Math.PI / 2, 1.22)
  place(F.floorLamp(), 0.5, 4.5)
  grid.block(0, 4)
  // the extra room down to the corridor: a reading corner (clear of the wall in front) and the spending board
  place(F.rug(4, 3, rugTexture(4, 3, '#f3e4c4', '#c98b5e', '#d97757', 'stripes')), 4.5, 9.5)
  place(F.armchair('#2f8f83'), 3.45, 9.5, Math.PI / 2)
  place(F.lowTable(), 4.5, 9.5)
  place(F.armchair('#2f8f83'), 5.55, 9.5, -Math.PI / 2)
  grid.blockRect(3, 9, 3, 1)
  place(F.plant('fern'), 0.5, 12.5)
  grid.block(0, 12)
  place(F.plant('flower', '#f5f3ee'), 8.5, 12.5)
  grid.block(8, 12)
  place(F.plant('tall'), 8.5, 9.5)
  grid.block(8, 9)
  // the spending board on the side wall with the alarm above it
  const money = costBoard('Escritório inteiro', 2.2)
  place(money.group, 0.06, 10.6, Math.PI / 2, 1.0)
  const alarm = beacon()
  place(alarm.group, 0.04, 8.7, Math.PI / 2, 1.85)

  // ---------- team floor: two benches of sit-stand desks on oak, planters behind them ----------
  const deskScreens: Screen[] = []
  for (const d of DESKS) {
    const screen = new Screen()
    deskScreens.push(screen)
    const ws = workstation(d.index, screen.texture, screen.led, d.z === 2 ? 'walnut' : 'white')
    loops.push(...ws.loops)
    place(ws.group, d.x + 1, d.z + 0.5)
    grid.blockRect(d.x, d.z, 2, 1)
  }
  // leaves peek between the monitors; the walkway runs between the benches
  for (const z of [2, 6]) {
    for (let x = BENCH_X; x < BENCH_X + 10; x += 2) place(F.planter(2), x + 1, z - 0.45)
    grid.blockRect(BENCH_X, z - 1, 10, 1)
  }
  // a window behind each pair of desks
  for (const x of [13.5, 17.5, 21.5]) place(F.wallWindow(2.2, 1.3, sky(Math.round(x))), x, 0.02, 0, 1.6)
  // two phone booths against the back wall, for calls away from the bench
  for (const x of [23, 24]) {
    place(F.phoneBooth(), x + 0.5, 0.5)
    grid.block(x, 0)
  }
  place(F.plant('bush'), 25.5, 0.5)
  grid.block(25, 0)
  place(F.printer(), 26.5, 0.45)
  grid.block(26, 0)
  place(F.waterCooler(), 27.5, 0.45)
  grid.block(27, 0)
  const elev = F.elevator()
  place(elev.group, ELEVATOR.x, 0.04)
  elev.buttons[1].visible = false
  // a huddle corner beside the benches: whiteboard on wheels, a round table, three chairs
  place(F.rug(4, 4, rugTexture(4, 4, '#efe7da', '#2f8f83', '#e0b34a', 'bauhaus')), 26.5, 5.5)
  place(F.mobileWhiteboard(), 26.5, 3.6)
  grid.block(26, 3)
  place(F.roundTable(0.55), 26.5, 5.6)
  grid.block(26, 5)
  for (const [dx, dz, r] of [[-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2], [0, 1, Math.PI]] as const) place(F.meetingChair(), 26.5 + dx, 5.6 + dz, r)
  // open shelves frame the huddle from the corridor
  place(F.shelfDivider(2), 26.5, 9.4)
  grid.blockRect(25, 9, 3, 1)
  // a hanging egg chair by the elevator, a lamp beside it
  place(F.floorLamp(), 31.5, 5.5)
  grid.block(31, 5)
  place(F.eggChair(), 30.5, 7)
  grid.block(30, 7)
  place(F.plant('tall'), 31.5, 3.5)
  grid.block(31, 3)
  place(F.plant('fern'), 31.5, 11.5)
  grid.block(31, 11)
  // low planters edge the open plan along the hall, with gaps to walk through
  for (const x of [13, 17, 21]) {
    place(F.planter(2), x, 11.4)
    grid.blockRect(x - 1, 11, 2, 1)
  }
  place(F.plant('bush'), 23.5, 11.5)
  grid.block(23, 11)

  // ---------- corridor ----------
  place(F.plant('tall', '#e9edf2'), 10.5, 0.5)
  grid.block(10, 0)
  place(F.art('mountains', 1.0, 0.75), 0.04, 14, Math.PI / 2, 1.6)

  // ---------- lounge: living room, games with bleachers, café ----------
  const { sofaA, tableA, armchairs, foosball, bleachers, pingPong, cafe } = LOUNGE

  // living room: the sectional facing the camera, Claude FM on the left
  place(F.rug(6, 5, rugTexture(6, 5, '#efe7da', '#c4693f', '#2f8f83', 'bauhaus')), 14, 18)
  place(F.sectional('#c4693f'), sofaA.x, sofaA.z)
  grid.blockRect(13, 15, 3, 2)
  grid.block(15, 17)
  place(F.coffeeTable(2), tableA.x, tableA.z)
  grid.blockRect(13, 18, 2, 1)
  place(F.armchair('#2f8f83'), armchairs[0].x, armchairs[0].z, Math.PI / 2)
  grid.block(12, 18)
  place(F.eggChair(), 17.2, 17.6)
  grid.block(17, 17)
  // a movie corner in front of Claude FM: bean bags round a low table
  place(F.rug(4, 3, rugTexture(4, 3, '#e9eef0', '#4f6d7a', '#e0b34a', 'stripes')), 14, 22)
  for (const b of LOUNGE.tvBags) {
    place(F.beanBag(b.color), b.x, b.z, -Math.PI / 2)
    grid.block(Math.floor(b.x), Math.floor(b.z))
  }
  place(F.lowTable(), 12.6, 21.5)
  grid.block(12, 21)
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

  // games: foosball, two arcades, ping-pong, and the bleachers watching it
  place(F.foosball(), foosball.x, foosball.z)
  grid.blockRect(20, 17, 2, 1)
  LOUNGE.arcades.forEach((a, i) => {
    const screen = new LoopScreen(24, 20, arcadePainter, 8 - i)
    loops.push(screen)
    place(F.arcade(screen.texture), a.x, a.z)
    grid.block(Math.floor(a.x), Math.floor(a.z))
  })
  place(F.pingPong(), pingPong.x, pingPong.z)
  grid.blockRect(Math.floor(pingPong.x), Math.floor(pingPong.z) - 1, 1, 2)
  place(F.bleachers(), bleachers.x, bleachers.z, Math.PI / 2)
  grid.blockRect(18, 20, 3, 3)

  // ---------- café: counter and fridge on the corridor side, the island, a communal table ----------
  place(F.kitchenCounter(cafe.counter.w), cafe.counter.x, cafe.counter.z)
  grid.blockRect(cafe.counter.x - cafe.counter.w / 2, 15, cafe.counter.w, 1)
  const coffee = coffeeCorner()
  place(coffee.group, cafe.counter.x - 1.4, cafe.counter.z + 0.05, 0, 0.91)
  place(F.microwave(), cafe.counter.x - 0.4, cafe.counter.z + 0.05, 0, 0.91)
  place(F.mug('#e17055'), cafe.counter.x + 0.5, cafe.counter.z + 0.15, 0, 0.91)
  place(F.mug('#74b9ff'), cafe.counter.x + 0.75, cafe.counter.z + 0.1, 0, 0.91)
  place(F.fridge(), cafe.fridge.x, cafe.fridge.z)
  grid.block(Math.floor(cafe.fridge.x), Math.floor(cafe.fridge.z))
  place(F.kitchenIsland(), cafe.island.x, cafe.island.z)
  grid.blockRect(26, 18, 4, 1)
  for (const x of [26.7, 29.3]) place(F.stool('#2f8f83'), x, cafe.island.z - 0.95)
  place(F.communalTable(), cafe.table.x, cafe.table.z)
  grid.blockRect(26, 20, 4, 3)
  // the skeleton stands in the corner here (added by the game)
  grid.block(31, 22)
  place(F.plant('tall'), 31.5, 15.5)
  grid.block(31, 15)
  place(F.plant('bush'), 31.5, 18.5)
  grid.block(31, 18)

  // plants along the front edge (the meeting room has its own)
  for (const [x, kind] of [
    [11, 'bush'],
    [17, 'fern'],
    [24, 'bush'],
  ] as const) {
    place(F.plant(kind), x + 0.5, 23.5)
    grid.block(x, 23)
  }

  // ---------- Sala de reunião in the front-left corner (RN-16) ----------
  const meeting = meetingRoom(GROUND_MEETING, place, grid, loops, '#d97757', group)

  // every box that never moves becomes one mesh per material (AO-30)
  mergeStatic(group)

  // ---------- elevator animation ----------
  let doorOpen = 0
  let doorTimer = 0
  const [doorL, doorR] = elev.doors
  return {
    group,
    grid,
    walls: PARTITIONS,
    floor,
    deskScreens,
    tv,
    coffee,
    meetingAnchor: meeting.anchor,
    meeting,
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
  const side = mat('#3d3b47')
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
  shell(box(group, W, 0.04, 0.02, '#2e2c36', W / 2, -0.4, H + 0.01, false))

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

/**
 * The room walls: solid, a lintel over every door, a frame around each opening. Each tile of a
 * wall is its own group tagged 'wall' (the 2D view sorts it on its own and shows whoever walks
 * behind it as a silhouette); each tile also blocks its edge in the grid.
 */
export function buildPartitions(group: THREE.Group, grid: Grid, partitions: Partition[]): void {
  const T = ROOM_WALL_T
  const TOP = ROOM_WALL_H
  const RAIL = 0.95
  // trims sit a hair proud of the wall's visible face (+z or +x: the camera's side)
  const FACE = T / 2 + 0.012
  for (const p of partitions) {
    grid.blockPartition(p)
    const isDoor = (i: number) => p.doors.includes(i)
    for (let i = p.from; i < p.to; i++) {
      const door = isDoor(i)
      const g = new THREE.Group()
      // a box `w` along the wall and `d` across it, from y0 to y1; `off` across, `along` along the wall
      const part = (w: number, d: number, y0: number, y1: number, color: string, off = 0, along = 0, shadows = false) =>
        p.axis === 'x'
          ? box(g, d, y1 - y0, w, color, p.at + off, y0, i + 0.5 + along, shadows)
          : box(g, w, y1 - y0, d, color, i + 0.5 + along, y0, p.at + off, shadows)
      if (door) {
        // the lintel over the opening, framed underneath
        part(1, T, DOOR_H, TOP, WALL, 0, 0, true)
        part(1, T + 0.06, DOOR_H - 0.05, DOOR_H, DOOR_FRAME)
        if (!isDoor(i - 1)) part(0.09, T + 0.06, 0, DOOR_H, DOOR_FRAME, 0, -0.455)
        if (!isDoor(i + 1)) part(0.09, T + 0.06, 0, DOOR_H, DOOR_FRAME, 0, 0.455)
      } else {
        part(1, T, 0, RAIL, WAINSCOT, 0, 0, true)
        part(1, T, RAIL, TOP, WALL, 0, 0, true)
        part(1, 0.03, RAIL, RAIL + 0.04, CAP, FACE)
        part(1, 0.03, 0, 0.14, BASEBOARD, FACE)
      }
      part(1, T + 0.04, TOP, TOP + 0.06, CAP)
      // a post closes each end of the wall
      if (i === p.from) part(T, T + 0.04, 0, TOP + 0.06, CAP, 0, -0.5)
      if (i === p.to - 1) part(T, T + 0.04, 0, TOP + 0.06, CAP, 0, 0.5)
      group.add(px(g, 'wall', { axis: p.axis, at: p.at, tile: i, door }))
    }
  }
}
