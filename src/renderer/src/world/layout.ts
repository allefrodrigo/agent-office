// Office floor plan. One unit = one tile. x grows to the screen's lower right,
// z grows to the screen's lower left; back walls run along x = 0 and z = 0.

export const W = 32
export const H = 24
export const WALL_H = 2.7

/**
 * Room walls (the Partitions): solid, a little lower than the outer walls so the rooms behind
 * them still read, with a lintel over every door. Whoever walks behind one shows through it as
 * a silhouette (pixel/painter.ts in 2D, Avatar.setXray in 3D).
 */
export const ROOM_WALL_H = 2.45
export const ROOM_WALL_T = 0.2
/** Top of a door opening: the lintel runs from here to the wall's top; room signs hang on it. */
export const DOOR_H = 1.98
/** Distance from a room wall's line to its face: whatever hangs on the wall goes there. */
export const WALL_FACE = ROOM_WALL_T / 2 + 0.03

export type FloorStyle = 'hall' | 'boss' | 'team' | 'lounge' | 'cafe' | 'meeting'

export interface Zone {
  id: FloorStyle
  label: string
  rect: [number, number, number, number] // x0, z0, x1, z1 (exclusive)
}

export const MEETING_ROOM = 'Sala de reunião'
/** Your office runs from the back wall down to the corridor at z = 13. */
const BOSS_RECT: [number, number, number, number] = [0, 0, 9, 13]
/** The ground floor's meeting room takes the front-left corner; its door opens on the corridor. */
const GROUND_MEETING_RECT: [number, number, number, number] = [0, 15, 10, 24]

export const ZONES: Zone[] = [
  { id: 'boss', label: 'Sua sala', rect: BOSS_RECT },
  { id: 'team', label: 'Time de agentes', rect: [11, 0, 32, 12] },
  { id: 'lounge', label: 'Lounge', rect: [11, 15, 32, 24] },
  { id: 'meeting', label: MEETING_ROOM, rect: GROUND_MEETING_RECT },
]

/** A room wall along a tile edge, solid, doors open. axis 'x' = line x = at, spanning z in [from, to). */
export interface Partition {
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
  doors: number[] // tile indices along the span left open
}

export const PARTITIONS: Partition[] = [
  { axis: 'x', at: BOSS_RECT[2], from: 0, to: BOSS_RECT[3], doors: [5, 6] },
  { axis: 'z', at: BOSS_RECT[3], from: 0, to: BOSS_RECT[2], doors: [] },
  // walls around the meeting room: the door on the corridor, a wall on the lounge side
  ...meetingPartitions(GROUND_MEETING_RECT),
]

/**
 * Is someone at (x, z) hidden, at least in part, by a room wall in front of them? Looks from
 * each of `heights` toward the isometric camera (45° around, 30° up: the line of sight rises
 * 0.816 per tile it crosses toward +x or +z) and asks whether it meets a wall tile, or a lintel,
 * below the wall's top. The 3D view turns its through-wall silhouette on with it.
 */
export function behindWall(walls: Partition[], x: number, z: number, heights: number[] = [0.3, 0.8, 1.3]): boolean {
  const RISE = 0.816
  for (const p of walls) {
    const ahead = p.axis === 'z' ? p.at - z : p.at - x
    if (ahead <= 0 || ahead * RISE >= ROOM_WALL_H) continue
    const along = p.axis === 'z' ? x + ahead : z + ahead
    const tile = Math.floor(along)
    if (tile < p.from || tile >= p.to) continue
    const door = p.doors.includes(tile)
    for (const h of heights) {
      const y = h + ahead * RISE
      if (y < ROOM_WALL_H && (!door || y >= DOOR_H)) return true
    }
  }
  return false
}

/** Walls of a meeting room: corridor side (z0) with a door in the middle, and the open side (x0, or x1 against the side wall). */
function meetingPartitions([x0, z0, x1, z1]: [number, number, number, number]): Partition[] {
  const mid = Math.floor((x0 + x1) / 2)
  return [
    { axis: 'z', at: z0, from: x0, to: x1, doors: [mid - 1, mid] },
    { axis: 'x', at: x0 === 0 ? x1 : x0, from: z0, to: z1, doors: [] },
  ]
}

/** Left end of the ground floor's desk benches. */
export const BENCH_X = 12

export interface DeskSlot {
  index: number
  /** Desk top-left tile; desks are 2 tiles wide along x, 1 deep. */
  x: number
  z: number
  /** Where the agent sits (world coords) and the tile it walks to first. */
  seat: { x: number; z: number }
  approach: [number, number]
}

/**
 * The ground floor's team: two benches of five desks side by side, like a startup's open plan,
 * with a planter behind each (world/office.ts). The front bench comes first, so the first agents
 * sit nearest the corridor.
 */
export const DESKS: DeskSlot[] = (() => {
  const out: DeskSlot[] = []
  let index = 0
  for (const z of [6, 2]) {
    for (let k = 0; k < 5; k++) {
      const x = BENCH_X + k * 2
      out.push({ index: index++, x, z, seat: { x: x + 1, z: z + 1.45 }, approach: [x, z + 1] })
    }
  }
  return out
})()

/** Where the player's own chair is, behind the big desk. */
export const BOSS_SEAT = { x: 4.5, z: 2.5 }
export const BOSS_DESK = { x: 3, z: 3, w: 3 }
/** Spots in front of the boss desk where visiting agents stand, best first. */
export const VISIT_SPOTS: [number, number][] = [
  [4, 4], [3, 4], [5, 4], [2, 4], [6, 4], [4, 5], [3, 5], [5, 5], [2, 5], [6, 5], [4, 6], [3, 6], [5, 6],
]

/** Tiles behind the boss desk, reserved for the player. */
export function behindBossDesk(x: number, z: number): boolean {
  return z <= 2 && x >= 2 && x <= 6
}

export const ELEVATOR = { x: 30, z: 0 }
export const SPAWN_TILE: [number, number] = [30, 1]
export const PLAYER_START: [number, number] = [4, 5]

/** Where idle agents hang out: final position, the point they look at, and the tile they walk to first. */
export interface HangSpot {
  x: number
  z: number
  look: [number, number]
  approach: [number, number]
  /** sit on a sofa or bean bag, stand around with a coffee, or play a game */
  kind: 'sit' | 'stand' | 'play'
}

// Lounge furniture centers, shared with office.ts. Three areas left to right: a living room
// around the sectional, the games with oak bleachers facing the ping-pong table, and the café
// (terrazzo floor) with its island and a long communal table.
export const LOUNGE = {
  /** The L-shaped sectional (3 x 1.8), facing the camera, its chaise at the right end. */
  sofaA: { x: 14.5, z: 16.5 },
  tableA: { x: 14, z: 18.5 },
  armchairs: [{ x: 12.45, z: 18.5 }],
  /** Bean bags facing Claude FM (the monitor on the left), in front of the living room. */
  tvBags: [
    { x: 13.8, z: 20.9, color: '#a29bfe' },
    { x: 14, z: 22.3, color: '#55efc4' },
    { x: 15.2, z: 21.6, color: '#ff7675' },
  ],
  foosball: { x: 21, z: 17.5 },
  /** Oak bleachers (3 long along z, 2 deep), their steps facing the ping-pong table. */
  bleachers: { x: 19.5, z: 21.5 },
  /** Two arcades by the corridor, between the games and the café corner. */
  arcades: [
    { x: 22.5, z: 15.5 },
    { x: 23.5, z: 15.5 },
  ],
  /** Ping-pong table along z, its net across x. */
  pingPong: { x: 22.5, z: 20 },
  /** The café at the lounge's right end: counter on the corridor side, an island, a communal table. */
  cafe: {
    rect: [25, 15, 32, 24] as [number, number, number, number],
    counter: { x: 28, z: 15.35, w: 4 },
    fridge: { x: 30.5, z: 15.4 },
    island: { x: 28, z: 18.5 },
    table: { x: 28, z: 21.5 },
  },
}

const sofaSeat = (x: number, z: number, approach: [number, number]): HangSpot => ({ x, z, look: [x, z + 2], approach, kind: 'sit' })
const around = (p: { x: number; z: number }, c: { x: number; z: number }, approach: [number, number]): HangSpot => ({
  x: p.x,
  z: p.z,
  look: [c.x, c.z],
  approach,
  kind: 'sit',
})
/** A step of the bleachers, looking at the ping-pong table. */
const bleacher = (z: number): HangSpot => ({ x: 20.2, z, look: [22.5, 20.5], approach: [21, Math.floor(z)], kind: 'sit' })

/** Ordered so even a few idle agents spread across the lounge. */
export const LOUNGE_SEATS: HangSpot[] = [
  sofaSeat(14.5, 16.15, [14, 17]),
  { x: 21, z: 16.55, look: [21, 17.5], approach: [21, 16], kind: 'play' },
  { x: 21, z: 18.45, look: [21, 17.5], approach: [21, 18], kind: 'play' },
  { x: 22.5, z: 18.3, look: [22.5, 20], approach: [22, 18], kind: 'play' },
  { x: 22.5, z: 16.45, look: [22.5, 15.5], approach: [22, 16], kind: 'play' },
  // a coffee at the café counter
  { x: 26.6, z: 16.5, look: [26.6, 15.4], approach: [26, 16], kind: 'stand' },
  around(LOUNGE.armchairs[0], LOUNGE.tableA, [12, 19]),
  bleacher(21.5),
  sofaSeat(13.5, 16.15, [13, 17]),
  { x: 22.5, z: 21.7, look: [22.5, 20], approach: [22, 21], kind: 'play' },
  // the communal table's far bench, facing the camera
  { x: 27.2, z: 20.85, look: [27.2, 21.5], approach: [27, 19], kind: 'sit' },
  bleacher(20.5),
  sofaSeat(15.5, 16.3, [16, 17]),
  { x: 23.5, z: 16.45, look: [23.5, 15.5], approach: [23, 16], kind: 'play' },
  { x: 28.8, z: 20.85, look: [28.8, 21.5], approach: [28, 19], kind: 'sit' },
  // a chat over the island, mug in hand
  { x: 27.6, z: 17.4, look: [27.6, 18.5], approach: [27, 17], kind: 'stand' },
  { x: 28.5, z: 16.5, look: [28.5, 15.4], approach: [28, 16], kind: 'stand' },
  bleacher(22.5),
  { ...LOUNGE.tvBags[0], look: [11.4, 21], approach: [13, 19], kind: 'sit' },
  { x: 27.5, z: 22.15, look: [27.5, 21.5], approach: [27, 23], kind: 'sit' },
  { x: 28.6, z: 17.4, look: [28.6, 18.5], approach: [28, 17], kind: 'stand' },
  { ...LOUNGE.tvBags[2], look: [11.4, 21], approach: [16, 21], kind: 'sit' },
  { ...LOUNGE.tvBags[1], look: [11.4, 21], approach: [14, 23], kind: 'sit' },
]

/**
 * A meeting room: a long table along z in the middle, three chairs on each side, the tag
 * over the sign above the door. Shared by the project floors and the ground floor.
 */
export interface MeetingRoom extends SectorRoom {
  /** Long table: center and size in tiles (w along x, d along z). */
  table: { x: number; z: number; w: number; d: number }
  /** The six chairs, in the order people take them: nearest the door first. */
  seats: HangSpot[]
  /** World point over the door where the room's tag goes (RN-15). */
  anchor: [number, number, number]
  /** Tiles the furniture takes: the table, the sideboard under the TV and the two plants in the far corners. */
  blocked: [number, number][]
}

/** Lays out a meeting room in `rect`; the door is on its z0 side. */
export function meetingRoomPlan(rect: Rect): MeetingRoom {
  const [x0, z0, x1, z1] = rect
  const cx = (x0 + x1) / 2
  // three tiles long, centered on a tile so every chair sits in the middle of one
  const tz = Math.floor((z0 + z1) / 2) + 0.5
  const seats: HangSpot[] = []
  for (const dz of [-1, 0, 1]) {
    for (const side of [-1, 1]) {
      const x = cx + side * 1.35
      const z = tz + dz
      seats.push({ x, z, look: [cx, z], approach: [Math.floor(x), Math.floor(z)], kind: 'sit' })
    }
  }
  const table = { x: cx, z: tz, w: 1.6, d: 3 }
  const blocked: [number, number][] = [
    [x0, z1 - 1],
    [x1 - 1, z1 - 1],
    // the sideboard under the TV, left of the door, and the one under the living wall
    [x0, z0],
    [x0 + 1, z0],
    [x0 + 2, z0],
    [x0, tz - 1.5],
    [x0, tz - 0.5],
  ]
  for (let x = Math.floor(table.x - table.w / 2); x < Math.ceil(table.x + table.w / 2); x++)
    for (let z = Math.floor(table.z - table.d / 2); z < Math.ceil(table.z + table.d / 2); z++) blocked.push([x, z])
  // the tag floats over the wall above the door, clear of the sign and its lamp
  return { name: MEETING_ROOM, rect, top: false, desks: [], stand: [], members: [], table, seats, anchor: [cx, ROOM_WALL_H + 0.35, z0 + 0.3], blocked }
}

/** The ground floor's meeting room, in the front-left corner. */
export const GROUND_MEETING: MeetingRoom = meetingRoomPlan(GROUND_MEETING_RECT)

export function zoneAt(x: number, z: number): Zone | undefined {
  return ZONES.find((zn) => x >= zn.rect[0] && x < zn.rect[2] && z >= zn.rect[1] && z < zn.rect[3])
}

export function inBossRoom(x: number, z: number): boolean {
  const [x0, z0, x1, z1] = BOSS_RECT
  return x >= x0 && x < x1 && z >= z0 && z < z1
}

// ---------- project floors (1º andar and up) ----------
// Same footprint and elevator as the ground floor. Diretoria top-right around the
// elevator, so orchestrators and members step straight in and out of it, with the
// company's sign; the team rooms with the project's agents along the back wall; a corridor
// across the middle and the squad sectors in front of it.

export const DEFAULT_SECTOR = 'Equipe'
export const TEAM_ROOM = 'Agentes'
const DESKS_PER_ROOM = 6
type Rect = [number, number, number, number]
/** Back rooms open to the corridor at z = 10, nearest the Diretoria first. */
const BACK_ROOMS: Rect[] = [
  [11, 0, 22, 10],
  [0, 0, 11, 10],
]
/** Front rooms open to the corridor at z = 13, nearest the Diretoria first. */
const FRONT_ROOMS: Rect[] = [
  [24, 13, 32, 24],
  [16, 13, 24, 24],
  [8, 13, 16, 24],
  [0, 13, 8, 24],
]
export const DIRECTOR_RECT: Rect = [22, 0, 32, 10]
/** The corridor between the back rooms and the front ones: z0 and z1 (exclusive). */
export const CORRIDOR: [number, number] = [10, 13]

export interface SectorRoom {
  name: string
  rect: Rect
  /** Rooms along the back wall open to the corridor at z = 10; front rooms at z = 13. */
  top: boolean
  desks: DeskSlot[]
  /** Free tiles where members stand when every desk of the sector is taken. */
  stand: [number, number][]
  /** Member ids that work here; empty for team rooms. */
  members: string[]
}

/** An orchestrator's desk in the Diretoria. It sits behind it facing the room, like the player downstairs. */
export interface DirectorDesk {
  index: number
  x: number
  z: number
  w: number
  seat: { x: number; z: number }
  approach: [number, number]
  /** Where an inline member sits during its step, beside the orchestrator. */
  side: { x: number; z: number }
  sideApproach: [number, number]
  /** Tiles in front of the desk where members hand over their delivery. */
  deliver: [number, number][]
}

export interface ProjectPlan {
  /** Rooms with a desk for each of the project's agents. */
  team: SectorRoom[]
  /** Team desks in order: an agent's desk number indexes this list. */
  teamDesks: DeskSlot[]
  /** Corridor tiles for agents beyond the team desks. */
  teamStand: [number, number][]
  sectors: SectorRoom[]
  directors: DirectorDesk[]
  partitions: Partition[]
  /** member id -> sector name, for every squad on the floor. */
  sectorOf: Map<string, string>
  /** Front rooms no sector uses: open common areas (lounge, games, quiet corner). */
  commons: Rect[]
  /** The Estúdio criativo, in the front room nearest the elevator, while Codex is ready. */
  studio?: SectorRoom
  /** The Sala de reunião, in the front room after the studio (the first one without it). */
  meeting?: MeetingRoom
}

/** Squad members share one floor: `squad/member` ids keep two squads with the same member id apart. */
export const memberKey = (squad: string, member: string) => `${squad}/${member}`

/**
 * Desks of a room as benches: desks side by side in rows, every agent facing the back wall (its
 * screen toward the camera). Back rooms (11 x 10) take two benches of three by the windows and
 * keep the front, behind the corridor wall, for walking; front rooms (8 x 11) take three
 * benches of two on the left and keep the right, behind the next room's wall, as the aisle.
 * Rows nearest the door first, so a lone agent doesn't walk to the far wall. `stand`: free tiles
 * behind the benches where members wait when every desk is taken.
 */
function roomDesks(rect: Rect, top: boolean, count: number, first: number): { desks: DeskSlot[]; stand: [number, number][] } {
  const [x0, z0, x1] = rect
  const rows = top ? [z0 + 4, z0 + 1] : [z0 + 2, z0 + 5, z0 + 8]
  const perRow = top ? 3 : 2
  const left = top ? x0 + Math.floor((x1 - x0 - perRow * 2) / 2) : x0 + 1
  const desks: DeskSlot[] = []
  for (const z of rows) {
    for (let k = 0; k < perRow; k++) {
      if (desks.length >= Math.min(DESKS_PER_ROOM, count)) break
      const x = left + k * 2
      desks.push({ index: first + desks.length, x, z, seat: { x: x + 1, z: z + 1.45 }, approach: [x, z + 1] })
    }
  }
  // the walkway behind each bench's chairs
  const stand: [number, number][] = []
  for (const z of rows) for (let k = 0; k < perRow * 2; k++) stand.push([left + k, z + 2])
  return { desks, stand }
}

export const STUDIO_ROOM = 'Estúdio criativo'

/**
 * Plan of a project floor. Team rooms take the back wall; squad sectors the front.
 * A project with more sectors than front rooms gives one back room to them.
 * `studio` keeps the front room nearest the elevator for the Estúdio criativo; `meeting` the next
 * one (the first, without a studio) for the Sala de reunião.
 */
export function projectPlan(squads: { code: string; members: { id: string; execution: string; sector: string }[] }[], studio = false, meeting = false): ProjectPlan {
  // Sectors in order of first appearance; inline members work in the Diretoria, so they need no room.
  const bySector = new Map<string, string[]>()
  for (const s of squads) {
    for (const m of s.members) {
      if (m.execution !== 'subagent') continue
      const name = m.sector || DEFAULT_SECTOR
      bySector.set(name, [...(bySector.get(name) ?? []), memberKey(s.code, m.id)])
    }
  }
  let entries = [...bySector.entries()]
  const reserved = (studio ? 1 : 0) + (meeting ? 1 : 0)
  const front = FRONT_ROOMS.slice(reserved)
  const teamRects = entries.length > front.length ? BACK_ROOMS.slice(0, 1) : BACK_ROOMS
  const sectorSlots = [...front.map((rect) => ({ rect, top: false })), ...BACK_ROOMS.slice(teamRects.length).map((rect) => ({ rect, top: true }))]
  // More sectors than rooms: the last room takes everyone left over.
  if (entries.length > sectorSlots.length) {
    const rest = entries.slice(sectorSlots.length - 1).flatMap(([, ids]) => ids)
    entries = [...entries.slice(0, sectorSlots.length - 1), ['Outros setores', rest]]
  }

  // Team desks come first, so an agent's desk number is its index in teamDesks.
  let index = 0
  const team: SectorRoom[] = teamRects.map((rect) => {
    const { desks, stand } = roomDesks(rect, true, DESKS_PER_ROOM, index)
    index += desks.length
    return { name: TEAM_ROOM, rect, top: true, desks, stand, members: [] }
  })
  const sectorOf = new Map<string, string>()
  const sectors: SectorRoom[] = entries.map(([name, members], i) => {
    const { rect, top } = sectorSlots[i]
    for (const id of members) sectorOf.set(id, name)
    const { desks, stand } = roomDesks(rect, top, members.length, index)
    index += desks.length
    return { name, rect, top, desks, stand, members }
  })
  const studioRoom: SectorRoom | undefined = studio ? { name: STUDIO_ROOM, rect: FRONT_ROOMS[0], top: false, desks: [], stand: [], members: [] } : undefined
  const meetingRoom = meeting ? meetingRoomPlan(FRONT_ROOMS[studio ? 1 : 0]) : undefined

  const [dx0, dz0, dx1, dz1] = DIRECTOR_RECT
  const partitions: Partition[] = [
    { axis: 'x', at: dx0, from: dz0, to: dz1, doors: [] },
    { axis: 'z', at: dz1, from: dx0, to: dx1, doors: [Math.floor((dx0 + dx1) / 2) - 1, Math.floor((dx0 + dx1) / 2)] },
  ]
  const xWalls = new Set<string>()
  for (const r of [...team, ...sectors, ...(studioRoom ? [studioRoom] : []), ...(meetingRoom ? [meetingRoom] : [])]) {
    const [x0, z0, x1, z1] = r.rect
    const mid = Math.floor((x0 + x1) / 2)
    partitions.push({ axis: 'z', at: r.top ? 10 : 13, from: x0, to: x1, doors: [mid - 1, mid] })
    for (const x of [x0, x1]) {
      if (x <= 0 || x >= W || (r.top && x === dx0) || xWalls.has(`${x},${z0}`)) continue
      xWalls.add(`${x},${z0}`)
      partitions.push({ axis: 'x', at: x, from: z0, to: z1, doors: [] })
    }
  }

  // Desks below the elevator: the second one is a couple of tiles from its doors.
  const directors: DirectorDesk[] = [23, 27].map((x, i) => ({
    index: i,
    x,
    z: 3,
    w: 3,
    seat: { x: x + 1.5, z: 2.5 },
    approach: [x + 1, 2],
    side: { x: x + 3.5, z: 3.5 },
    sideApproach: [x + 3, 4],
    deliver: [[x + 1, 5], [x + 2, 5], [x, 5], [x + 1, 6], [x + 2, 6], [x, 6]],
  }))
  // The middle row of the corridor, off the doors, so people still get by.
  const doors = new Set(partitions.filter((p) => p.axis === 'z').flatMap((p) => p.doors))
  const teamStand: [number, number][] = []
  // x = 0 is the café corner's counter
  for (let x = 1; x < dx0; x++) if (!doors.has(x)) teamStand.push([x, 11])
  const commons = front.filter((rect) => !sectors.some((s) => s.rect === rect))
  return { team, teamDesks: team.flatMap((r) => r.desks), teamStand, sectors, directors, partitions, sectorOf, commons, studio: studioRoom, meeting: meetingRoom }
}
