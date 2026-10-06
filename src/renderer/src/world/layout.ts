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
