import type { AgentManager } from './agents'
import { permissionFromTool } from './agents'

/**
 * Demo mode (AGENT_OFFICE_DEMO=1): fills the office with simulated agents so the
 * world can be previewed without spending tokens. Demo agents are not persisted.
 */
export function startDemo(manager: AgentManager): void {
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

  setTimeout(() => {
    manager.terminalResult(
      ids[2],
      'Corrigi o bug do login.\n\n- O token expirava antes da hora por causa do fuso.\n- Adicionei 3 testes em `auth.test.ts`.\n- Todos os testes passam.',
    )
  }, 6000)
}

function describe(tool: string, input: Record<string, unknown>): string {
  const v = Object.values(input)[0]
  const s = String(v ?? '')
  return `${tool === 'Bash' ? 'Rodando' : tool === 'Read' ? 'Lendo' : tool === 'Edit' ? 'Editando' : tool === 'Write' ? 'Escrevendo' : 'Buscando'} ${s.split('/').pop()}`
}
