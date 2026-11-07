import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_RECT,
  GROUND_MEETING,
  H,
  LOUNGE,
  LOUNGE_SEATS,
  MEETING_ROOM,
  PARTITIONS,
  SPAWN_TILE,
  STUDIO_ROOM,
  W,
  ZONES,
  projectPlan,
  type MeetingRoom,
  type ProjectPlan,
} from '../src/renderer/src/world/layout'
import { Grid } from '../src/renderer/src/world/pathfinding'

type Rect = [number, number, number, number]

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
const inside = (x: number, z: number, r: Rect) => x >= r[0] && x < r[2] && z >= r[1] && z < r[3]

/** A squad with `n` sectors, two subagents each, plus an inline member (it works in the Diretoria). */
function squads(n: number) {
  const members = Array.from({ length: n }, (_, i) => [
    { id: `s${i}a`, execution: 'subagent', sector: `Setor ${i + 1}` },
    { id: `s${i}b`, execution: 'subagent', sector: `Setor ${i + 1}` },
  ]).flat()
  return [{ code: 'sq', members: [...members, { id: 'orq', execution: 'inline', sector: '' }] }]
}

/** Every room of the plan with a rect: Diretoria, team, sectors, studio, meeting and the open areas. */
function rooms(plan: ProjectPlan): { name: string; rect: Rect }[] {
  return [
    { name: 'Diretoria', rect: DIRECTOR_RECT },
    ...plan.team,
    ...plan.sectors,
    ...(plan.studio ? [plan.studio] : []),
    ...(plan.meeting ? [plan.meeting] : []),
    ...plan.commons.map((rect, i) => ({ name: `commons ${i}`, rect })),
  ]
}

/** The floor's walls and the furniture the plan knows about: desks, Diretoria desks, meeting table and plants. */
function floorGrid(plan: ProjectPlan): Grid {
  const g = new Grid(W, H)
  for (const p of plan.partitions) g.blockPartition(p)
  for (const d of [...plan.teamDesks, ...plan.sectors.flatMap((s) => s.desks)]) g.blockRect(d.x, d.z, 2, 1)
  for (const d of plan.directors) g.blockRect(d.x, d.z, d.w, 1)
  for (const [x, z] of plan.meeting?.blocked ?? []) g.block(x, z)
  return g
}

/** Seats on free tiles of the room, one person per tile, every one reachable from the elevator by A*. */
function expectSeatsReachable(room: MeetingRoom, g: Grid): void {
  expect(room.seats).toHaveLength(6)
  const tiles = new Set(room.seats.map((s) => s.approach.join(',')))
  expect(tiles.size).toBe(6)
  for (const s of room.seats) {
    const [ax, az] = s.approach
    expect(inside(s.x, s.z, room.rect)).toBe(true)
    expect([Math.floor(s.x), Math.floor(s.z)]).toEqual([ax, az])
    expect(g.walkable(ax, az)).toBe(true)
    expect(g.findPath(SPAWN_TILE[0], SPAWN_TILE[1], ax, az), `assento ${ax},${az}`).not.toBeNull()
  }
}

describe('projectPlan: sala de reunião nos andares (RN-14)', () => {
  for (const studio of [false, true]) {
    for (let n = 0; n <= 5; n++) {
      it(`${n} setor(es), ${studio ? 'com' : 'sem'} estúdio: salas sem sobreposição, assentos alcançáveis`, () => {
        const plan = projectPlan(squads(n), studio, true)
        const all = rooms(plan)
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i].rect, all[j].rect), `${all[i].name} x ${all[j].name}`).toBe(false)
        }
        for (const r of all) expect(r.rect[0] >= 0 && r.rect[1] >= 0 && r.rect[2] <= W && r.rect[3] <= H).toBe(true)

        // the meeting room takes the front room after the studio (the first one without it)
        const meeting = plan.meeting!
        expect(meeting.name).toBe(MEETING_ROOM)
        expect(meeting.rect).toEqual(studio ? [16, 13, 24, 24] : [24, 13, 32, 24])
        expect(plan.studio?.name).toBe(studio ? STUDIO_ROOM : undefined)
        expect(inside(meeting.anchor[0], meeting.anchor[2], meeting.rect)).toBe(true)

        // every member still has a sector: sectors beyond the rooms go to "Outros setores"
        expect(plan.sectorOf.size).toBe(n * 2)
        expectSeatsReachable(meeting, floorGrid(plan))
      })
    }
  }

  it('sem a sala, o plano fica como antes', () => {
    const plan = projectPlan(squads(3), true)
    expect(plan.meeting).toBeUndefined()
    expect(plan.sectors.map((s) => s.rect[0])).toEqual([16, 8, 0])
  })
})

describe('sala de reunião do térreo (RN-16)', () => {
  it('fica na ponta direita do lounge, sem sobrepor outra zona', () => {
    expect(GROUND_MEETING.rect).toEqual([24, 15, 32, 24])
    expect(ZONES.find((z) => z.id === 'lounge')!.rect).toEqual([11, 15, 24, 24])
    for (let i = 0; i < ZONES.length; i++) {
      for (let j = i + 1; j < ZONES.length; j++)
        expect(overlaps(ZONES[i].rect, ZONES[j].rect), `${ZONES[i].label} x ${ZONES[j].label}`).toBe(false)
    }
  })

  it('nenhum lugar do lounge fica dentro da sala', () => {
    for (const s of LOUNGE_SEATS) {
      expect(inside(s.x, s.z, GROUND_MEETING.rect)).toBe(false)
      expect(inside(s.approach[0], s.approach[1], GROUND_MEETING.rect)).toBe(false)
    }
  })

  it('assentos alcançáveis do elevador pela porta do corredor', () => {
    const g = new Grid(W, H)
    for (const p of PARTITIONS) g.blockPartition(p)
    for (const a of LOUNGE.arcades) g.block(Math.floor(a.x), Math.floor(a.z))
    g.blockRect(Math.floor(LOUNGE.pingPong.x), Math.floor(LOUNGE.pingPong.z) - 1, 1, 2)
    for (const [x, z] of GROUND_MEETING.blocked) g.block(x, z)
    expectSeatsReachable(GROUND_MEETING, g)
    // the lounge side is glass: from the lounge you go round through the corridor door
    const path = g.findPath(23, 19, 25, 19)!
    expect(path.some(([, z]) => z < 15)).toBe(true)
  })
})
