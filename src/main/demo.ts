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
  manager.simulate = (id, prompt) => simulateRun(manager, id, prompt)

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

  // Linus keeps calling subagents (3 at a time), so the helpers show up next to his desk,
  // each with its own log and what it is doing in the balloon (AO-46).
  let round = 0
  const helpers = () => {
    const files = ['agents.ts', 'bridge.ts', 'tickets.ts', 'store.ts', 'usage.ts']
    for (let k = 0; k < 3; k++) {
      const file = files[(round + k) % files.length]
      simulateSubagent(manager, ids[3], { taskId: `demo-sub-${round}-${k}`, description: `Revisar ${file}`, type: k === 2 ? 'general-purpose' : 'Explore', steps: 5 + k * 2, everyMs: 1400, seed: k, fail: round % 4 === 3 && k === 1 })
    }
    round++
    setTimeout(helpers, 26000)
  }
  setTimeout(helpers, 2000)

  setTimeout(() => {
    manager.terminalResult(
      ids[2],
      'Corrigi o bug do login.\n\n- O token expirava antes da hora por causa do fuso.\n- Adicionei 3 testes em `auth.test.ts`.\n- Todos os testes passam.',
    )
  }, 6000)
}

/**
 * A hired or summoned agent in demo mode: reads the request, asks to run the tests, and
 * hands a result after the decision. Same path as a real run (permission card, result card).
 */
function simulateRun(manager: AgentManager, id: string, prompt: string): void {
  manager.terminalUpdate(id, 'working', 'Lendo seu pedido')
  setTimeout(() => {
    manager.terminalUpdate(id, 'working', 'Lendo src/app.tsx', { kind: 'tool', text: 'Read {"file_path":"src/app.tsx"}', tool: 'Read' })
  }, 1200)
  setTimeout(() => {
    manager.requestDecision(id, permissionFromTool('Bash', { command: 'npm test -- --watch=false', description: 'Roda os testes' }, undefined, true), (d) => {
      if (d.behavior === 'deny') return manager.terminalResult(id, `Não rodei os testes, como você pediu.${d.message ? `

Sua orientação: ${d.message}` : ''}`)
      manager.terminalUpdate(id, 'working', 'Rodando os testes')
      setTimeout(() => manager.terminalResult(id, `Feito (demonstração): ${prompt.slice(0, 120)}

- Li o código.
- Rodei os testes: 42 passaram.`), 2500)
    })
  }, 2500)
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

  // AO-46 load: the first agent keeps 20 subagents running at once, each sending a
  // message every ~300 ms. Updates reach the renderer grouped (one burst per 250 ms)
  // and each log stays under its cap; the counters go to stdout every 10 s.
  const boss = ids[0]
  let wave = 0
  const crowd = () => {
    for (let k = 0; k < 20; k++) simulateSubagent(manager, boss, { taskId: `stress-sub-${wave}-${k}`, description: `Carga ${wave + 1}.${k + 1}`, type: 'Explore', steps: 120, everyMs: 300, seed: k })
    wave++
    setTimeout(crowd, 120 * 300 + 4000)
  }
  setTimeout(crowd, 1500)
  setInterval(() => console.log(`[stress] subagentes: ${simulated.messages} mensagens simuladas, ${manager.subagentMemory(boss)} entradas na memória`), 10_000)
}

/** How many subagent messages the demo produced, for the load numbers. */
const simulated = { messages: 0 }

const SUB_TOOLS: [string, Record<string, unknown>][] = [
  ['Read', { file_path: 'src/main/agents.ts' }],
  ['Grep', { pattern: 'parent_tool_use_id', path: 'src' }],
  ['Edit', { file_path: 'src/main/git.ts', old_string: 'a', new_string: 'b' }],
  ['Bash', { command: 'npm test' }],
  ['Glob', { pattern: 'src/**/*.ts' }],
  ['Read', { file_path: 'src/renderer/src/ui/panel.ts' }],
]

/**
 * One simulated subagent (AO-46), as the SDK sends it: task_started with the id of the
 * Agent tool_use, then the subagent's own messages carrying that id as parent_tool_use_id,
 * task_progress now and then, and task_notification at the end.
 */
function simulateSubagent(
  manager: AgentManager,
  agentId: string,
  o: { taskId: string; description: string; type: string; steps: number; everyMs: number; seed: number; fail?: boolean },
): void {
  const toolUseId = `toolu_${o.taskId}`
  const base = { type: 'system', uuid: o.taskId, session_id: 'demo', task_id: o.taskId, tool_use_id: toolUseId } as const
  const started = Date.now()
  manager.demoTask(agentId, { ...base, subtype: 'task_started', description: o.description, subagent_type: o.type, task_type: 'local_agent', is_backgrounded: false, prompt: `${o.description} e diga o que achou (demonstração).` } as never)
  let i = 0
  let tokens = 0
  const step = () => {
    if (i >= o.steps) {
      const status = o.fail ? 'failed' : 'completed'
      const summary = o.fail ? 'Não consegui rodar os testes: faltou o node_modules (falha simulada).' : `Pronto: ${o.description.toLowerCase()} sem problemas (demonstração).`
      manager.demoTask(agentId, { ...base, subtype: 'task_notification', status, output_file: '', summary, usage: { total_tokens: tokens, tool_uses: o.steps, duration_ms: Date.now() - started } } as never)
      return
    }
    const [tool, input] = SUB_TOOLS[(i + o.seed) % SUB_TOOLS.length]
    const id = `${toolUseId}-${i}`
    const blocks: unknown[] = [{ type: 'tool_use', id, name: tool, input }]
    if (i % 3 === 0) blocks.unshift({ type: 'text', text: i ? `Seguindo: agora ${tool === 'Bash' ? 'os testes' : 'o próximo arquivo'}.` : 'Vou começar lendo o código.' })
    manager.demoSubagentMessage(agentId, toolUseId, 'assistant', blocks)
    simulated.messages++
    const n = i
    setTimeout(() => {
      manager.demoSubagentMessage(agentId, toolUseId, 'user', [{ type: 'tool_result', tool_use_id: id, content: `saída simulada de ${tool} (passo ${n + 1})`, is_error: o.fail && n === o.steps - 1 }])
      simulated.messages++
    }, o.everyMs / 2)
    tokens += 1200 + o.seed * 100
    if (i % 2) manager.demoTask(agentId, { ...base, subtype: 'task_progress', description: o.description, usage: { total_tokens: tokens, tool_uses: i + 1, duration_ms: Date.now() - started }, last_tool_name: tool } as never)
    i++
    setTimeout(step, o.everyMs * (0.7 + Math.random() * 0.6))
  }
  setTimeout(step, 300)
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
