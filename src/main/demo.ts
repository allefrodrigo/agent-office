import type { SquadProgress } from '@shared/types'
import type { AgentManager } from './agents'
import { permissionFromTool } from './agents'
import type { SquadDefinition } from './squads'
import type { Store } from './store'

/**
 * Demo mode (AGENT_OFFICE_DEMO=1): fills the office with simulated agents so the
 * world can be previewed without spending tokens. Demo agents are not persisted.
 */
export function startDemo(manager: AgentManager, squads: SquadDefinition[] = []): void {
  // With a squad folder set, the biggest squad plays a cycle on the squad floor too.
  const squad = [...squads].sort((a, b) => b.members.length - a.members.length)[0]
  if (squad) setTimeout(() => startSquadDemo(manager, squad), 1500)

  const tools: [string, Record<string, unknown>][] = [
    ['Read', { file_path: 'src/app.tsx' }],
    ['Grep', { pattern: 'useEffect' }],
    ['Edit', { file_path: 'src/routes/api.ts' }],
    ['Bash', { command: 'npm test -- --watch=false' }],
    ['Write', { file_path: 'docs/README.md' }],
    ['WebSearch', { query: 'three.js pixel art' }],
  ]
  const names = ['Ada', 'Turing', 'Grace', 'Linus', 'Hedy', 'Radia']
  const ids = names.map((n, i) => manager.terminalAgent(`demo-${i}`, `/Users/demo/${n}`).id)

  ids.forEach((id, i) => {
    manager.terminalPrompt(id, 'Tarefa de demonstração')
    const tick = () => {
      const [tool, input] = tools[Math.floor(Math.random() * tools.length)]
      const summary = manager.list().find((a) => a.id === id)
      if (summary?.status === 'working') manager.terminalUpdate(id, 'working', null, { kind: 'tool', text: `${tool} ${JSON.stringify(input)}`, tool })
      if (summary?.status === 'working') manager.terminalUpdate(id, 'working', describe(tool, input))
      setTimeout(tick, 1800 + Math.random() * 2500)
    }
    setTimeout(tick, 500 + i * 300)
  })

  // Hedy finished earlier and is relaxing in the lounge.
  manager.terminalUpdate(ids[4], 'idle', 'Esperando no terminal')

  setTimeout(() => {
    manager.requestDecision(ids[1], permissionFromTool('Bash', { command: 'npm install three@latest', description: 'Atualiza o three.js' }, undefined, true), () => {
      manager.terminalUpdate(ids[1], 'working', 'Voltando ao trabalho')
    })
  }, 3000)

  // Linus keeps calling subagents, so the helpers show up next to his desk.
  let round = 0
  const helpers = () => {
    const files = ['agents.ts', 'bridge.ts', 'tickets.ts', 'store.ts', 'usage.ts']
    const count = 2 + (round % 3)
    for (let k = 0; k < count; k++) {
      const taskId = `demo-sub-${round}-${k}`
      const base = { type: 'system', uuid: taskId, session_id: 'demo' } as const
      manager.demoTask(ids[3], { ...base, subtype: 'task_started', task_id: taskId, description: `Contar linhas de ${files[k]}`, subagent_type: 'Explore', task_type: 'local_agent', is_backgrounded: true } as never)
      setTimeout(() => {
        manager.demoTask(ids[3], { ...base, subtype: 'task_notification', task_id: taskId, status: 'completed', output_file: '', summary: '', usage: { total_tokens: 9000 + k * 700, tool_uses: 2, duration_ms: 4000 } } as never)
      }, 2500 + Math.random() * 7000)
    }
    round++
    setTimeout(helpers, 16000)
  }
  setTimeout(helpers, 2000)

  setTimeout(() => {
    manager.terminalResult(
      ids[2],
      'Corrigi o bug do login.\n\n- O token expirava antes da hora por causa do fuso.\n- Adicionei 3 testes em `auth.test.ts`.\n- Todos os testes passam.',
    )
  }, 6000)
}

/** Stress mode: 50 agents spread over the ground floor and three project floors. */
const STRESS_AGENTS = 50
const STRESS_FLOORS = 3
const STRESS_ROOT = '/Users/demo/stress'

/**
 * AGENT_OFFICE_DEMO=stress, step 1 (before the window opens): three project floors,
 * in memory only. Refuses to run without AGENT_OFFICE_DATA_DIR, so the stress floors
 * never end up in the user's own office.json. Returns false when it refused.
 */
export function prepareStress(store: Store): boolean {
  if (!process.env.AGENT_OFFICE_DATA_DIR) {
    console.error('AGENT_OFFICE_DEMO=stress precisa de AGENT_OFFICE_DATA_DIR (ex.: AGENT_OFFICE_DATA_DIR=$(mktemp -d)) para não tocar nos seus dados.')
    return false
  }
  const colors = ['#2f8f83', '#6c5ce7', '#e17055']
  const s = store.settings
  // Mutated in place: no save is scheduled for it (and the data dir is a throwaway anyway).
  s.notifications = false
  s.projects = Array.from({ length: STRESS_FLOORS }, (_, i) => ({ id: `stress-${i + 1}`, name: `Carga ${i + 1}`, cwd: `${STRESS_ROOT}/andar-${i + 1}`, brandColor: colors[i], uniform: i === 1 }))
  return true
}

/**
 * AGENT_OFFICE_DEMO=stress, step 2: 50 terminal agents, a quarter per floor. They keep
 * switching between working and idle, and every few seconds one of them walks over to
 * deliver a result (riding the elevator down from its floor), which is acked a bit later.
 */
export function startStress(manager: AgentManager): void {
  const cwds = ['/Users/demo/terreo', ...Array.from({ length: STRESS_FLOORS }, (_, i) => `${STRESS_ROOT}/andar-${i + 1}`)]
  const ids: string[] = []
  for (let i = 0; i < STRESS_AGENTS; i++) {
    const a = manager.terminalAgent(`stress-${i}`, `${cwds[i % cwds.length]}/repo-${i}`)
    manager.terminalPrompt(a.id, 'Carga de teste')
    ids.push(a.id)
  }
  const tools = ['Read src/app.tsx', 'Edit src/routes/api.ts', 'Bash npm test', 'Grep useEffect', 'Write docs/README.md']
  for (const id of ids) {
    const tick = () => {
      const a = manager.list().find((x) => x.id === id)
      if (!a) return
      if (a.status === 'working' || a.status === 'idle') {
        const busy = Math.random() < 0.75
        manager.terminalUpdate(id, busy ? 'working' : 'idle', busy ? tools[Math.floor(Math.random() * tools.length)] : 'Esperando no terminal')
      }
      setTimeout(tick, 2000 + Math.random() * 4000)
    }
    setTimeout(tick, 500 + Math.random() * 3000)
  }
  // Someone walks to the boss office with a result every ~4 s; the player "reads" it 8 s later.
  const deliver = () => {
    const free = manager.list().filter((a) => ids.includes(a.id) && a.status === 'working')
    const a = free[Math.floor(Math.random() * free.length)]
    if (a) {
      manager.terminalResult(a.id, 'Resultado de carga (simulado).')
      setTimeout(() => {
        for (const r of manager.pendingResults()) if (r.agentId === a.id) manager.ackResult(r.id)
        manager.terminalUpdate(a.id, 'working', 'Voltando ao trabalho')
      }, 8000)
    }
    setTimeout(deliver, 4000)
  }
  setTimeout(deliver, 3000)
}

function describe(tool: string, input: Record<string, unknown>): string {
  const v = Object.values(input)[0]
  const s = String(v ?? '')
  return `${tool === 'Bash' ? 'Rodando' : tool === 'Read' ? 'Lendo' : tool === 'Edit' ? 'Editando' : tool === 'Write' ? 'Escrevendo' : 'Buscando'} ${s.split('/').pop()}`
}

/**
 * A simulated orchestrator walks the squad's pipeline: checkpoints come to you as
 * questions, consecutive subagent steps run together (up to 7, like the lentes) and
 * one member fails, so every animation of the squad floor shows up.
 */
function startSquadDemo(manager: AgentManager, squad: SquadDefinition): void {
  const id = manager.demoOrchestrator(squad).id
  const steps = squad.steps
  const total = steps.length
  const member = (mid?: string) => squad.members.find((m) => m.id === mid)
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const progress = (i: number, status = 'running'): SquadProgress => ({ current: i + 1, total, label: steps[i].name, status, type: steps[i].type, agent: steps[i].agent })
  let tasks = 0
  let failed = false

  const ask = (i: number) =>
    new Promise<void>((resolve) => {
      manager.demoStep(id, progress(i), 'working', `Checkpoint: ${steps[i].name}`)
      const question = `Passo ${i + 1} · ${steps[i].name}: posso seguir? (demonstração)`
      manager.requestDecision(
        id,
        {
          kind: 'question',
          toolName: 'AskUserQuestion',
          title: 'Tenho uma pergunta',
          detail: '',
          input: {},
          questions: [{ question, header: 'Checkpoint', multiSelect: false, options: [{ label: 'Seguir', description: 'Aprova e continua o ciclo' }, { label: 'Seguir com ajustes', description: 'Continua e anota o pedido' }] }],
          canAlwaysAllow: false,
          context: `${squad.name} · Passo ${i + 1}/${total} · ${steps[i].name}`,
        },
        () => resolve(),
      )
    })

  const work = (i: number, ms: number, fail: boolean) =>
    new Promise<void>((resolve) => {
      const task = `demo-squad-${tasks++}`
      const base = { type: 'system', uuid: task, session_id: 'demo' } as const
      manager.demoTask(id, { ...base, subtype: 'task_started', task_id: task, description: steps[i].name, subagent_type: steps[i].agent, task_type: 'local_agent' } as never)
      setTimeout(() => {
        manager.demoTask(id, { ...base, subtype: 'task_progress', task_id: task, description: steps[i].name, usage: { total_tokens: 8000 + Math.round(Math.random() * 20000), tool_uses: 3, duration_ms: ms / 2 }, last_tool_name: 'Read' } as never)
      }, ms / 2)
      setTimeout(() => {
        const status = fail ? 'failed' : 'completed'
        manager.demoTask(id, { ...base, subtype: 'task_notification', task_id: task, status, output_file: '', summary: fail ? 'Não achei o arquivo de entrada do passo (falha simulada).' : '', usage: { total_tokens: 24000, tool_uses: 6, duration_ms: ms } } as never)
        resolve()
      }, ms)
    })

  const cycle = async (): Promise<void> => {
    for (let i = 0; i < total; i++) {
      const s = steps[i]
      if (s.type === 'checkpoint') {
        await ask(i)
        continue
      }
      const m = member(s.agent)
      if (!m) continue
      if (m.execution === 'inline') {
        manager.demoStep(id, progress(i), 'working', `${m.icon} ${m.name}: ${s.name}`)
        await wait(8000)
        continue
      }
      // consecutive subagent steps run in parallel, as the runner does with the lentes
      const group = [i]
      while (group.length < 7 && steps[group.at(-1)! + 1]?.type === 'agent' && member(steps[group.at(-1)! + 1].agent)?.execution === 'subagent') group.push(group.at(-1)! + 1)
      manager.demoStep(id, progress(i), 'working', group.length > 1 ? `Chamando ${group.length} membros em paralelo` : `Chamando ${m.icon} ${m.name}`)
      const failAt = !failed && group.length >= 3 ? group[2] : -1
      if (failAt >= 0) failed = true
      await Promise.all(group.map((k) => work(k, 7000 + Math.random() * 9000, k === failAt)))
      i = group.at(-1)!
    }
    manager.demoStep(id, { current: total, total, label: steps[total - 1]?.name ?? '', status: 'completed' }, 'idle', 'Ciclo concluído')
    await wait(20000)
    failed = false
    return cycle()
  }
  void cycle()
}
