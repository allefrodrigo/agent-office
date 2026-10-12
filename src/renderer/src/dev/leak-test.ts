import type { AgentSummary, ProjectFloor } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import type { Game } from '../game'
import { perf } from '../perf'
import type { State } from '../state'

/**
 * Dev only (AO-28): adds and removes a floor 20 times, hires and dismisses 30 agents
 * and uses the skull 10 times, reading renderer.info.memory after each round. Agents
 * are fake summaries pushed through the same agent:upsert / agent:removed events the
 * main process sends, so nothing reaches Claude or the store.
 *
 * Run it from the console (`await __leakTest()`) or headless:
 *   AGENT_OFFICE_DATA_DIR=$(mktemp -d) AGENT_OFFICE_SHOTS=out/leak:150000 \
 *   AGENT_OFFICE_EVAL='__leakTest().then(r => JSON.stringify(r))' npx electron .
 */

interface Snapshot {
  step: string
  geometries: number
  textures: number
  programs: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const FLOOR_ID = 'leak-test-floor'

/** A tiny PNG logo whose color changes every round, so each rebuild draws a new one. */
function logo(i: number): string {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')!
  ctx.fillStyle = `hsl(${(i * 47) % 360} 70% 50%)`
  ctx.fillRect(0, 0, 32, 32)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(8, 8, 16, 16)
  return c.toDataURL('image/png')
}

function fakeAgent(i: number, project?: string): AgentSummary {
  const id = `leak-${i}`
  return {
    id,
    name: `Teste ${i}`,
    source: 'terminal',
    cwd: `/tmp/leak/${i}`,
    permissionMode: 'default',
    status: 'working',
    activity: 'Testando vazamento',
    desk: i % 10,
    look: lookFromSeed(id),
    costUsd: 0,
    createdAt: Date.now(),
    project,
    // two helpers on every third agent, so subagents come and go too
    subagents: i % 3 ? [] : [0, 1].map((k) => ({ id: `${id}-sub-${k}`, description: 'Contar linhas', startedAt: Date.now(), background: true })),
  }
}

export async function leakTest(game: Game, state: State): Promise<{ snapshots: Snapshot[]; summary: Record<string, unknown> }> {
  const snapshots: Snapshot[] = []
  const snap = async (step: string) => {
    // a few frames so whatever is on screen gets uploaded (or released) first
    await sleep(400)
    const m = perf.memory()
    const s: Snapshot = { step, geometries: m.geometries, textures: m.textures, programs: m.programs }
    snapshots.push(s)
    console.log(`[leak] ${step}: geometries ${s.geometries}, textures ${s.textures}, programs ${s.programs}`)
    return s
  }
  const original = state.settings
  const setFloors = (projects: ProjectFloor[]) => state.apply({ type: 'settings', settings: { ...state.settings, projects } })
  // With AGENT_OFFICE_DEMO=1 the demo's own agents stay: wait until only they are left.
  const base = game.population.actors
  const empty = async (timeoutMs = 40000) => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (game.population.actors <= base) {
        // the test agents' helpers wave goodbye for a moment after their parent leaves
        await sleep(2000)
        return true
      }
      await sleep(250)
    }
    return false
  }

  game.goFloor(0)
  const start = await snap('início')

  // ---------- 1. a floor added and removed 20 times (new logo each time) ----------
  for (let i = 0; i < 20; i++) {
    setFloors([...original.projects, { id: FLOOR_ID, name: `Teste ${i}`, cwd: '/tmp/leak-floor', logo: logo(i), brandColor: '#2f8f83', uniform: true }])
    game.goFloor(original.projects.length + 1)
    await sleep(300)
    game.goFloor(0)
    setFloors(original.projects)
    await snap(`andar ${i + 1}/20`)
  }
  const afterFloors = snapshots.at(-1)!

  // ---------- 2. 30 agents hired and dismissed, half of them on a uniformed floor ----------
  const floorWith = (i: number) => [...original.projects, { id: FLOOR_ID, name: 'Uniforme', cwd: '/tmp/leak-floor', logo: logo(100 + i), brandColor: '#6c5ce7', uniform: true }]
  let id = 0
  for (let round = 0; round < 3; round++) {
    setFloors(floorWith(round))
    const upstairs = original.projects.length + 1
    for (const [floor, project] of [[0, undefined], [upstairs, FLOOR_ID]] as const) {
      game.goFloor(floor)
      const batch = Array.from({ length: 5 }, () => fakeAgent(id++, project))
      for (const a of batch) state.apply({ type: 'agent:upsert', agent: a })
      await sleep(2500)
      for (const a of batch) state.apply({ type: 'agent:removed', agentId: a.id })
      await empty()
    }
    game.goFloor(0)
    setFloors(original.projects)
    await snap(`agentes ${id}/30`)
  }
  const afterAgents = snapshots.at(-1)!

  // ---------- 3. the skull, 10 times ----------
  for (let i = 0; i < 10; i++) {
    const a = fakeAgent(1000 + i)
    a.subagents = []
    state.apply({ type: 'agent:upsert', agent: a })
    await sleep(1500)
    await new Promise<void>((done) => {
      game.dismiss(a.id, () => {
        state.apply({ type: 'agent:removed', agentId: a.id })
        done()
      })
    })
    await empty()
    // smoke and sparks fade in under a second
    await sleep(1200)
    game.goFloor(0)
    await snap(`caveira ${i + 1}/10`)
  }
  const end = snapshots.at(-1)!

  const delta = (a: Snapshot, b: Snapshot) => ({ geometries: b.geometries - a.geometries, textures: b.textures - a.textures })
  return {
    snapshots,
    summary: {
      início: { geometries: start.geometries, textures: start.textures },
      andares: delta(start, afterFloors),
      agentes: delta(afterFloors, afterAgents),
      caveira: delta(afterAgents, end),
      fim: { geometries: end.geometries, textures: end.textures },
    },
  }
}
