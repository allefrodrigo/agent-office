import { describe, expect, it } from 'vitest'
import {
  behindWall,
  DESKS,
  DIRECTOR_RECT,
  DOOR_H,
  GROUND_MEETING,
  H,
  LOUNGE,
  LOUNGE_SEATS,
  MEETING_ROOM,
  PARTITIONS,
  SPAWN_TILE,
  ROOM_WALL_H,
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
  it('fica no canto da antiga copa, sem sobrepor outra zona; não há mais copa', () => {
    expect(GROUND_MEETING.rect).toEqual([0, 15, 10, 24])
    expect(ZONES.find((z) => z.id === 'lounge')!.rect).toEqual([11, 15, 32, 24])
    expect(ZONES.find((z) => z.id === 'boss')!.rect).toEqual([0, 0, 9, 13])
    expect(ZONES.some((z) => z.id === 'cafe')).toBe(false)
    for (let i = 0; i < ZONES.length; i++) {
      for (let j = i + 1; j < ZONES.length; j++)
        expect(overlaps(ZONES[i].rect, ZONES[j].rect), `${ZONES[i].label} x ${ZONES[j].label}`).toBe(false)
    }
  })

  it('nenhum lugar do lounge fica dentro da sala; todos no lounge', () => {
    const lounge = ZONES.find((z) => z.id === 'lounge')!.rect
    for (const s of LOUNGE_SEATS) {
      expect(inside(s.x, s.z, lounge), `${s.x},${s.z}`).toBe(true)
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
    const path = g.findPath(12, 19, 9, 19)!
    expect(path.some(([, z]) => z < 15)).toBe(true)
  })
})

describe('lounge do térreo (0.4.0-beta.6)', () => {
  /** Tiles the lounge's big pieces take (world/office.ts blocks the same ones). */
  const furniture = (): Set<string> => {
    const t = new Set<string>()
    const rect = (x: number, z: number, w: number, h: number) => {
      for (let i = x; i < x + w; i++) for (let j = z; j < z + h; j++) t.add(`${i},${j}`)
    }
    rect(13, 15, 3, 2) // sectional
    rect(15, 17, 1, 1) // its chaise
    rect(13, 18, 2, 1) // coffee table
    rect(18, 20, 3, 3) // bleachers
    rect(20, 17, 2, 1) // foosball
    rect(22, 19, 1, 2) // ping-pong
    rect(26, 18, 4, 1) // café island
    rect(26, 20, 4, 3) // communal table and its benches
    for (const b of LOUNGE.tvBags) t.add(`${Math.floor(b.x)},${Math.floor(b.z)}`)
    return t
  }

  it('cada lugar se aproxima por um piso livre, e dois lugares não dividem a aproximação', () => {
    const taken = furniture()
    const seen = new Set<string>()
    for (const s of LOUNGE_SEATS) {
      const key = `${s.approach[0]},${s.approach[1]}`
      expect(taken.has(key), `aproximação ${key} em cima de um móvel`).toBe(false)
      expect(seen.has(key), `aproximação ${key} repetida`).toBe(false)
      seen.add(key)
    }
  })

  it('o café fica na ponta direita do lounge, com piso próprio', () => {
    const lounge = ZONES.find((z) => z.id === 'lounge')!.rect
    const cafe = LOUNGE.cafe.rect
    expect(cafe[0] > lounge[0] && cafe[2] === lounge[2] && cafe[1] === lounge[1] && cafe[3] === lounge[3]).toBe(true)
    for (const p of [LOUNGE.cafe.island, LOUNGE.cafe.table, LOUNGE.cafe.counter]) expect(inside(p.x, p.z, cafe)).toBe(true)
  })
})

describe('bancadas de mesas (0.4.0-beta.6)', () => {
  for (const n of [0, 1, 3, 5]) {
    it(`${n} setor(es): mesas dentro da sala, sem sobrepor, todas alcançáveis do elevador`, () => {
      const plan = projectPlan(squads(n), true, true)
      const g = floorGrid(plan)
      for (const room of [...plan.team, ...plan.sectors]) {
        const taken = new Set<string>()
        for (const d of room.desks) {
          // a desk is 2 x 1 tiles and its chair row is inside the room too
          expect(inside(d.x, d.z, room.rect) && inside(d.x + 1, d.z + 1, room.rect), `${room.name} mesa ${d.index}`).toBe(true)
          for (const t of [`${d.x},${d.z}`, `${d.x + 1},${d.z}`]) {
            expect(taken.has(t), `${room.name} mesa ${d.index} sobrepõe`).toBe(false)
            taken.add(t)
          }
          expect(g.findPath(SPAWN_TILE[0], SPAWN_TILE[1], d.approach[0], d.approach[1]), `${room.name} mesa ${d.index}`).not.toBeNull()
        }
        for (const [x, z] of room.stand) expect(inside(x, z, room.rect) && g.walkable(x, z), `${room.name} em pé ${x},${z}`).toBe(true)
      }
    })
  }

  it('as salas de trás ficam com duas bancadas de três, longe da parede do corredor', () => {
    const plan = projectPlan(squads(0))
    for (const room of plan.team) {
      expect(room.desks).toHaveLength(6)
      expect(new Set(room.desks.map((d) => d.z)).size).toBe(2)
      // the corridor wall hides about three tiles behind it: every seat stays clear of that band
      for (const d of room.desks) expect(room.rect[3] - d.seat.z).toBeGreaterThan(3)
    }
  })

  it('térreo: duas bancadas de cinco, todas alcançáveis', () => {
    expect(DESKS).toHaveLength(10)
    const g = new Grid(W, H)
    for (const p of PARTITIONS) g.blockPartition(p)
    for (const d of DESKS) g.blockRect(d.x, d.z, 2, 1)
    for (const z of new Set(DESKS.map((d) => d.z))) g.blockRect(DESKS[0].x, z - 1, 10, 1)
    for (const d of DESKS) expect(g.findPath(SPAWN_TILE[0], SPAWN_TILE[1], d.approach[0], d.approach[1]), `mesa ${d.index}`).not.toBeNull()
  })
})

describe('behindWall: quem está atrás de uma parede de sala', () => {
  // a wall along x at z = 10, x from 0 to 8, with a door on tiles 3 and 4
  const walls = [{ axis: 'z' as const, at: 10, from: 0, to: 8, doors: [3, 4] }]

  it('atrás da parede, perto dela: escondido; na frente: não', () => {
    expect(behindWall(walls, 1.5, 9.5)).toBe(true)
    expect(behindWall(walls, 1.5, 10.5)).toBe(false)
  })

  it('longe atrás da parede, a linha de visão passa por cima dela', () => {
    const solid = [{ axis: 'z' as const, at: 10, from: 0, to: 12, doors: [] }]
    const far = (ROOM_WALL_H - 0.3) / 0.816 + 0.5
    expect(behindWall(solid, 2, 10 - far)).toBe(false)
    expect(behindWall(solid, 2, 10 - far + 1)).toBe(true)
  })

  it('na linha da porta, só a verga pode cobrir: a cabeça, não os pés', () => {
    // straight back from the door's middle the line of sight crosses the opening
    const x = 3.5 - 0.5
    expect(behindWall(walls, x, 9.5, [0.3])).toBe(false)
    expect(behindWall(walls, x, 9.5, [DOOR_H])).toBe(true)
  })

  it('parede ao longo de z (x fixo) também conta', () => {
    const side = [{ axis: 'x' as const, at: 5, from: 0, to: 10, doors: [] }]
    expect(behindWall(side, 4.5, 4)).toBe(true)
    expect(behindWall(side, 5.5, 4)).toBe(false)
  })
})
