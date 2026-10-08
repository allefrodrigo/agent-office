// Office floor plan. One unit = one tile. x grows to the screen's lower right,
// z grows to the screen's lower left; back walls run along x = 0 and z = 0.

export const W = 32
export const H = 24
export const WALL_H = 2.7

export type FloorStyle = 'hall' | 'boss' | 'team' | 'meeting' | 'lounge'

export interface Zone {
  id: FloorStyle
  label: string
  rect: [number, number, number, number] // x0, z0, x1, z1 (exclusive)
}

export const ZONES: Zone[] = [
  { id: 'boss', label: 'Sua sala', rect: [0, 0, 9, 9] },
  { id: 'team', label: 'Time de agentes', rect: [11, 0, 32, 12] },
  { id: 'meeting', label: 'Sala de reunião', rect: [0, 11, 9, 24] },
  { id: 'lounge', label: 'Lounge', rect: [11, 15, 32, 24] },
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
  { axis: 'z', at: 11, from: 0, to: 9, doors: [] },
  { axis: 'x', at: 9, from: 11, to: 24, doors: [13, 14] },
]

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
  sofaC: { x: 26.5, z: 16.45 },
  tableC: { x: 26.5, z: 18.5 },
  bagsC: [
    { x: 24.5, z: 20.5, color: '#e17055' },
    { x: 28.5, z: 20.5, color: '#00b894' },
    { x: 26.5, z: 21.5, color: '#fdcb6e' },
  ],
  pingPong: { x: 30, z: 22.5 },
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
  sofaSeat(26.5, 16.45),
  { x: 30.5, z: 16.45, look: [30.5, 15.5], approach: [30, 16], kind: 'play' },
  { x: 28.3, z: 22.5, look: [30, 22.5], approach: [28, 22], kind: 'play' },
  { x: 31.7, z: 22.5, look: [30, 22.5], approach: [31, 22], kind: 'play' },
  around(LOUNGE.armchairs[0], LOUNGE.tableA, [12, 19]),
  around(LOUNGE.circleBags[0], LOUNGE.circle, [19, 20]),
  sofaSeat(13.5, 16.45),
  sofaSeat(25.5, 16.45),
  { x: 31.5, z: 16.45, look: [31.5, 15.5], approach: [31, 16], kind: 'play' },
  around(LOUNGE.bagsC[0], LOUNGE.tableC, [24, 21]),
  around(LOUNGE.armchairs[1], LOUNGE.tableA, [16, 19]),
  around(LOUNGE.circleBags[1], LOUNGE.circle, [21, 20]),
  sofaSeat(15.5, 16.45),
  sofaSeat(27.5, 16.45),
  around(LOUNGE.bagsC[1], LOUNGE.tableC, [28, 21]),
  around(LOUNGE.circleBags[2], LOUNGE.circle, [20, 23]),
  around(LOUNGE.bagsC[2], LOUNGE.tableC, [26, 22]),
  { x: 18.5, z: 19.5, look: [17.5, 19.5], approach: [18, 19], kind: 'stand' },
  { x: 23.5, z: 19.5, look: [24.5, 19.5], approach: [23, 19], kind: 'stand' },
]

export function zoneAt(x: number, z: number): Zone | undefined {
  return ZONES.find((zn) => x >= zn.rect[0] && x < zn.rect[2] && z >= zn.rect[1] && z < zn.rect[3])
}

export function inBossRoom(x: number, z: number): boolean {
  return x >= 0 && x < 9 && z >= 0 && z < 9
}

// ---------- squad floor (1º andar) ----------
// Same footprint and elevator as the ground floor. Diretoria top-right around the
// elevator, so orchestrators and members step straight in and out of it; a lobby
// top-left, a corridor across the middle and up to six sector rooms around it.

export const DEFAULT_SECTOR = 'Equipe'
const MAX_DESKS_PER_SECTOR = 6
/** Sector rooms, filled in this order: the ones nearest the Diretoria first. */
const SECTOR_SLOTS: { rect: [number, number, number, number]; top: boolean }[] = [
  { rect: [14, 0, 22, 10], top: true },
  { rect: [6, 0, 14, 10], top: true },
  { rect: [24, 13, 32, 24], top: false },
  { rect: [16, 13, 24, 24], top: false },
  { rect: [8, 13, 16, 24], top: false },
  { rect: [0, 13, 8, 24], top: false },
]
export const DIRECTOR_RECT: [number, number, number, number] = [22, 0, 32, 10]
export const LOBBY_RECT: [number, number, number, number] = [0, 0, 6, 10]

export interface SectorRoom {
  name: string
  rect: [number, number, number, number]
  /** Rooms along the back wall open to the corridor at z = 10; front rooms at z = 13. */
  top: boolean
  desks: DeskSlot[]
  /** Free tiles where members stand when every desk of the sector is taken. */
  stand: [number, number][]
  /** Member ids that work here. */
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

export interface SquadPlan {
  sectors: SectorRoom[]
  directors: DirectorDesk[]
  partitions: Partition[]
  /** member id -> sector name, for every squad on the floor. */
  sectorOf: Map<string, string>
}

/** Squad members share one floor: `squad/member` ids keep two squads with the same member id apart. */
export const memberKey = (squad: string, member: string) => `${squad}/${member}`

export function squadPlan(squads: { code: string; members: { id: string; execution: string; sector: string }[] }[]): SquadPlan {
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
  // More sectors than rooms: the last room takes everyone left over.
  if (entries.length > SECTOR_SLOTS.length) {
    const rest = entries.slice(SECTOR_SLOTS.length - 1).flatMap(([, ids]) => ids)
    entries = [...entries.slice(0, SECTOR_SLOTS.length - 1), ['Outros setores', rest]]
  }
  const sectorOf = new Map<string, string>()
  let index = 0
  const sectors: SectorRoom[] = entries.map(([name, members], i) => {
    const { rect, top } = SECTOR_SLOTS[i]
    const [x0, z0] = rect
    for (const id of members) sectorOf.set(id, name)
    // Rows nearest the door first, so a lone member doesn't walk to the far wall.
    const rows = top ? [z0 + 7, z0 + 4, z0 + 1] : [z0 + 2, z0 + 5, z0 + 8]
    const desks: DeskSlot[] = []
    for (const z of rows) {
      for (const x of [x0 + 1, x0 + 5]) {
        if (desks.length >= Math.min(MAX_DESKS_PER_SECTOR, members.length)) break
        desks.push({ index: index++, x, z, seat: { x: x + 1, z: z + 1.45 }, approach: [x, z + 1] })
      }
    }
    const stand: [number, number][] = []
    for (const z of rows) stand.push([x0 + 3, z + 1], [x0 + 4, z + 1], [x0 + 3, z], [x0 + 4, z])
    return { name, rect, top, desks, stand, members }
  })

  const [dx0, dz0, dx1, dz1] = DIRECTOR_RECT
  const partitions: Partition[] = [
    { axis: 'x', at: dx0, from: dz0, to: dz1, doors: [] },
    { axis: 'z', at: dz1, from: dx0, to: dx1, doors: [Math.floor((dx0 + dx1) / 2) - 1, Math.floor((dx0 + dx1) / 2)] },
  ]
  const xWalls = new Set<string>()
  for (const r of sectors) {
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
  return { sectors, directors, partitions, sectorOf }
}
