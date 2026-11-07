// Office floor plan. One unit = one tile. x grows to the screen's lower right,
// z grows to the screen's lower left; back walls run along x = 0 and z = 0.

export const W = 32
export const H = 24
export const WALL_H = 2.7

export type FloorStyle = 'hall' | 'boss' | 'team' | 'lounge' | 'cafe' | 'meeting'

export interface Zone {
  id: FloorStyle
  label: string
  rect: [number, number, number, number] // x0, z0, x1, z1 (exclusive)
}

export const MEETING_ROOM = 'Sala de reunião'
/** The ground floor's meeting room takes the right end of the lounge; its door opens on the corridor. */
const GROUND_MEETING_RECT: [number, number, number, number] = [24, 15, 32, 24]

export const ZONES: Zone[] = [
  { id: 'boss', label: 'Sua sala', rect: [0, 0, 9, 9] },
  { id: 'team', label: 'Time de agentes', rect: [11, 0, 32, 12] },
  { id: 'lounge', label: 'Lounge', rect: [11, 15, 24, 24] },
  { id: 'cafe', label: 'Copa', rect: [0, 11, 9, 24] },
  { id: 'meeting', label: MEETING_ROOM, rect: GROUND_MEETING_RECT },
]

/** Glass partition along a tile edge. axis 'x' = line x = at, spanning z in [from, to). */
export interface Partition {
  axis: 'x' | 'z'
  at: number
  from: number
  to: number
  doors: number[] // tile indices along the span left open
}

export const PARTITIONS: Partition[] = [
  { axis: 'x', at: 9, from: 0, to: 9, doors: [5, 6] },
  { axis: 'z', at: 9, from: 0, to: 9, doors: [] },
  // glass around the meeting room: the door on the corridor, a wall on the lounge side
  ...meetingPartitions(GROUND_MEETING_RECT),
]

/** Glass of a meeting room: corridor side (z0) with a door in the middle, lounge or neighbor side (x0). */
function meetingPartitions([x0, z0, x1, z1]: [number, number, number, number]): Partition[] {
  const mid = Math.floor((x0 + x1) / 2)
  return [
    { axis: 'z', at: z0, from: x0, to: x1, doors: [mid - 1, mid] },
    { axis: 'x', at: x0, from: z0, to: z1, doors: [] },
  ]
}

export interface DeskSlot {
  index: number
  /** Desk top-left tile; desks are 2 tiles wide along x, 1 deep. */
  x: number
  z: number
  /** Where the agent sits (world coords) and the tile it walks to first. */
  seat: { x: number; z: number }
  approach: [number, number]
}

export const DESKS: DeskSlot[] = (() => {
  const out: DeskSlot[] = []
  let index = 0
  for (const z of [2, 7]) {
    for (let k = 0; k < 5; k++) {
      const x = 12 + k * 3
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

// Lounge furniture centers, shared with office.ts.
export const LOUNGE = {
  sofaA: { x: 14.5, z: 16.45 },
  tableA: { x: 14.5, z: 18.5 },
  armchairs: [
    { x: 12.45, z: 18.5 },
    { x: 16.55, z: 18.5 },
  ],
  foosball: { x: 21, z: 17.5 },
  circle: { x: 20.5, z: 21.5 },
  circleBags: [
    { x: 19.4, z: 21.5, color: '#a29bfe' },
    { x: 21.6, z: 21.5, color: '#ff7675' },
    { x: 20.5, z: 22.6, color: '#55efc4' },
  ],
  /** Two arcades against the corridor glass, by the meeting room's wall. */
  arcades: [
    { x: 22.5, z: 15.5 },
    { x: 23.5, z: 15.5 },
  ],
  /** Ping-pong table along z, its net across x. */
  pingPong: { x: 22.5, z: 20 },
}

const sofaSeat = (x: number, z: number): HangSpot => ({ x, z, look: [x, z + 2], approach: [Math.floor(x), Math.floor(z) + 1], kind: 'sit' })
const around = (p: { x: number; z: number }, c: { x: number; z: number }, approach: [number, number]): HangSpot => ({
  x: p.x,
  z: p.z,
  look: [c.x, c.z],
  approach,
  kind: 'sit',
})

/** Ordered so even a few idle agents spread across the lounge. */
export const LOUNGE_SEATS: HangSpot[] = [
  sofaSeat(14.5, 16.45),
  { x: 21, z: 16.55, look: [21, 17.5], approach: [21, 16], kind: 'play' },
  { x: 21, z: 18.45, look: [21, 17.5], approach: [21, 18], kind: 'play' },
  { x: 22.5, z: 18.3, look: [22.5, 20], approach: [22, 18], kind: 'play' },
  { x: 22.5, z: 16.45, look: [22.5, 15.5], approach: [22, 16], kind: 'play' },
  // a coffee at the café counter
  { x: 1.5, z: 14.6, look: [0.5, 14.6], approach: [1, 14], kind: 'stand' },
  around(LOUNGE.armchairs[0], LOUNGE.tableA, [12, 19]),
  around(LOUNGE.circleBags[0], LOUNGE.circle, [19, 20]),
  sofaSeat(13.5, 16.45),
  { x: 22.5, z: 21.7, look: [22.5, 20], approach: [22, 21], kind: 'play' },
  around(LOUNGE.armchairs[1], LOUNGE.tableA, [16, 19]),
  around(LOUNGE.circleBags[1], LOUNGE.circle, [21, 20]),
  sofaSeat(15.5, 16.45),
  { x: 23.5, z: 16.45, look: [23.5, 15.5], approach: [23, 16], kind: 'play' },
  around(LOUNGE.circleBags[2], LOUNGE.circle, [20, 23]),
  { x: 18.5, z: 19.5, look: [17.5, 19.5], approach: [18, 19], kind: 'stand' },
  { x: 4.5, z: 16.5, look: [4.5, 15.5], approach: [4, 16], kind: 'stand' },
  { x: 1.5, z: 16.6, look: [0.5, 16.6], approach: [1, 16], kind: 'stand' },
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
  /** Tiles the furniture takes: the table and the two plants in the far corners. */
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
  ]
  for (let x = Math.floor(table.x - table.w / 2); x < Math.ceil(table.x + table.w / 2); x++)
    for (let z = Math.floor(table.z - table.d / 2); z < Math.ceil(table.z + table.d / 2); z++) blocked.push([x, z])
  return { name: MEETING_ROOM, rect, top: false, desks: [], stand: [], members: [], table, seats, anchor: [cx, 2.1, z0 + 0.3], blocked }
}

/** The ground floor's meeting room, at the right end of the lounge. */
export const GROUND_MEETING: MeetingRoom = meetingRoomPlan(GROUND_MEETING_RECT)

export function zoneAt(x: number, z: number): Zone | undefined {
  return ZONES.find((zn) => x >= zn.rect[0] && x < zn.rect[2] && z >= zn.rect[1] && z < zn.rect[3])
}

export function inBossRoom(x: number, z: number): boolean {
  return x >= 0 && x < 9 && z >= 0 && z < 9
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
  /** Front rooms no sector uses: open common areas (lounge, café, games…). */
  commons: Rect[]
  /** The Estúdio criativo, in the front room nearest the elevator, while Codex is ready. */
  studio?: SectorRoom
  /** The Sala de reunião, in the front room after the studio (the first one without it). */
  meeting?: MeetingRoom
}

/** Squad members share one floor: `squad/member` ids keep two squads with the same member id apart. */
export const memberKey = (squad: string, member: string) => `${squad}/${member}`

/** Desks of a room, rows nearest the door first so a lone agent doesn't walk to the far wall. */
function roomDesks(rect: Rect, top: boolean, count: number, first: number): { desks: DeskSlot[]; stand: [number, number][] } {
  const [x0, z0, x1] = rect
  const rows = top ? [z0 + 7, z0 + 4, z0 + 1] : [z0 + 2, z0 + 5, z0 + 8]
  // two-tile desks every four tiles, as many as the room is wide, centered
  const n = Math.floor((x1 - x0 - 4) / 4) + 1
  const left = x0 + Math.floor((x1 - x0 - (n * 4 - 2)) / 2)
  const cols = Array.from({ length: n }, (_, i) => left + i * 4)
  const desks: DeskSlot[] = []
  for (const z of rows) {
    for (const x of cols) {
      if (desks.length >= Math.min(DESKS_PER_ROOM, count)) break
      desks.push({ index: first + desks.length, x, z, seat: { x: x + 1, z: z + 1.45 }, approach: [x, z + 1] })
    }
  }
  const stand: [number, number][] = []
  // the aisle between the first two desk columns
  const aisle = cols[0] + 2
  for (const z of rows) stand.push([aisle, z + 1], [aisle + 1, z + 1], [aisle, z], [aisle + 1, z])
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
  for (let x = 1; x < dx0; x++) if (!doors.has(x)) teamStand.push([x, 11])
  const commons = front.filter((rect) => !sectors.some((s) => s.rect === rect))
  return { team, teamDesks: team.flatMap((r) => r.desks), teamStand, sectors, directors, partitions, sectorOf, commons, studio: studioRoom, meeting: meetingRoom }
}
