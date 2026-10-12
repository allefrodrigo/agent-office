import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findSquad, isDir, loadSquads, memberAgents, orchestratorPrompt, outsideTeam, readProgress, squadDir, squadInfo, teamGuard } from '../src/main/squads'

let cwd: string
const put = (rel: string, text: string) => {
  const p = join(cwd, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ao-squads-'))
  // A secret outside the squad folder that a hostile squad.yaml tries to reach.
  put('segredo.md', '---\nname: Segredo\n---\nNÃO PODE VAZAR')
})

function goodSquad() {
  put(
    'squads/produto/squad.yaml',
    [
      'code: produto',
      'name: Ciclo de Produto',
      'icon: 🚀',
      'description: " Faz produto "',
      'agents:',
      '  - id: pm',
      '    name: Paula',
      '    setor: Produto',
      '  - id: dev',
      '  - id: pm',
      '  - id: "a b"',
      'pipeline:',
      '  entry: pipeline/pipeline.yaml',
    ].join('\n'),
  )
  put('squads/produto/agents/pm.agent.md', '---\ntitle: Gerente\nicon: 📋\n---\nVocê é a PM.')
  put('squads/produto/agents/dev.agent.md', '---\nexecution: inline\n: : quebrado\n---\nDev inline.')
  put('squads/produto/pipeline/pipeline.yaml', 'steps:\n  - id: spec\n    name: Spec\n    agent: pm\n  - type: checkpoint\n  - {}\n')
}

describe('loadSquads', () => {
  it('lê membros, passos e prompts; ignora ids repetidos ou com espaço', () => {
    goodSquad()
    const [s] = loadSquads(cwd)
    expect(s).toMatchObject({ code: 'produto', name: 'Ciclo de Produto', icon: '🚀', description: 'Faz produto', cwd })
    expect(s.members).toEqual([
      { id: 'pm', name: 'Paula', icon: '📋', title: 'Gerente', execution: 'subagent', sector: 'Produto' },
      { id: 'dev', name: 'dev', icon: '•', title: '', execution: 'subagent', sector: 'Equipe' },
    ])
    expect(s.prompts.pm).toBe('Você é a PM.')
    expect(s.steps).toEqual([
      { id: 'spec', name: 'Spec', type: 'agent', agent: 'pm' },
      { id: 'step-2', name: 'Passo 2', type: 'checkpoint', agent: undefined },
      { id: 'step-3', name: 'Passo 3', type: 'agent', agent: undefined },
    ])
    expect(squadInfo(s)).not.toHaveProperty('prompts')
    expect(squadDir(s)).toBe(join(cwd, 'squads', 'produto'))
  })

  it('pasta sem squads: lista vazia; squad.yaml quebrado é ignorado', () => {
    expect(loadSquads(cwd)).toEqual([])
    put('squads/ruim/squad.yaml', 'agents: [')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(loadSquads(cwd)).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('squad.yaml com path traversal falha de forma segura', () => {
  beforeEach(() => {
    put(
      'squads/hostil/squad.yaml',
      [
        'code: ../../../etc',
        'agents:',
        '  - id: ladrao',
        '    file: ../../segredo.md',
        '  - id: absoluto',
        `    file: ${join(cwd, 'segredo.md')}`,
        '  - id: ../fora',
        'pipeline:',
        '  entry: ../../segredo.md',
      ].join('\n'),
    )
  })

  it('code inválido vira o nome da pasta, e o caminho não sai de squads/', () => {
    const [s] = loadSquads(cwd)
    expect(s.code).toBe('hostil')
    expect(squadDir(s)).toBe(join(cwd, 'squads', 'hostil'))
  })

  it('arquivo de membro fora da pasta do squad não é lido', () => {
    const [s] = loadSquads(cwd)
    expect(s.members.map((m) => m.id)).toEqual(['ladrao', 'absoluto'])
    expect(Object.values(s.prompts).join('\n')).not.toContain('NÃO PODE VAZAR')
    expect(s.members[0].name).toBe('ladrao')
  })

  it('pipeline fora da pasta não é lido', () => {
    expect(loadSquads(cwd)[0].steps).toEqual([])
  })

  it('findSquad não acha códigos com ..', () => {
    expect(findSquad(cwd, '../../../etc')).toBeUndefined()
    expect(findSquad(cwd, 'hostil')?.code).toBe('hostil')
  })
})

describe('equipe fechada', () => {
  beforeEach(goodSquad)

  it('memberAgents só traz quem roda como subagente, sem poder chamar outros', () => {
    put('squads/produto/agents/dev.agent.md', '---\nexecution: inline\n---\nDev inline.')
    const s = findSquad(cwd, 'produto')!
    const agents = memberAgents(s)
    expect(Object.keys(agents)).toEqual(['pm'])
    expect(agents.pm.disallowedTools).toEqual(['Agent', 'Task'])
    expect(agents.pm.description).toContain('Paula, Gerente')
  })

  it('outsideTeam bloqueia quem não é da equipe e membros inline', () => {
    put('squads/produto/agents/dev.agent.md', '---\nexecution: inline\n---\nDev inline.')
    const s = findSquad(cwd, 'produto')!
    expect(outsideTeam(s, 'Read', {})).toBeNull()
    expect(outsideTeam(s, 'Agent', { subagent_type: 'pm' })).toBeNull()
    expect(outsideTeam(s, 'Task', {})).toContain('"general-purpose" não é da equipe')
    expect(outsideTeam(s, 'Agent', { subagent_type: 'dev' })).toContain('membro inline')
    expect(orchestratorPrompt(s)).toContain('Inline members')
  })

  it('teamGuard nega fora da equipe e força primeiro plano', async () => {
    const s = findSquad(cwd, 'produto')!
    const hook = teamGuard(s)[0].hooks[0]
    const call = (tool_input: unknown, hook_event_name = 'PreToolUse') => hook({ hook_event_name, tool_name: 'Agent', tool_input } as never, undefined, { signal: new AbortController().signal })
    expect(await call({ subagent_type: 'Explore' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } })
    expect(await call({ subagent_type: 'pm', run_in_background: true })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'allow', updatedInput: { subagent_type: 'pm', run_in_background: false } },
    })
    expect(await call({}, 'PostToolUse')).toEqual({})
  })

  it('orchestratorPrompt cita o código e a equipe', () => {
    const p = orchestratorPrompt(findSquad(cwd, 'produto')!)
    expect(p).toContain('code produto')
    expect(p).toContain('- pm: 📋 Paula (Gerente)')
    expect(p).toContain('the Opensquad pipeline runner')
    put('_opensquad/core/runner.pipeline.md', '#')
    expect(orchestratorPrompt(findSquad(cwd, 'produto')!)).toContain('`_opensquad/core/runner.pipeline.md`')
  })
})

describe('readProgress', () => {
  beforeEach(goodSquad)

  it('sem state.json: undefined; com: passo pelo número ou pelo id', () => {
    const s = squadInfo(findSquad(cwd, 'produto')!)
    expect(readProgress(s)).toBeUndefined()
    put('squads/produto/state.json', JSON.stringify({ step: { current: 1 } }))
    expect(readProgress(s)).toEqual({ current: 1, total: 3, label: 'Spec', status: 'running', type: 'agent', agent: 'pm' })
    put('squads/produto/state.json', JSON.stringify({ status: 'completed', step: { current: 9, total: 4, label: 'spec' } }))
    expect(readProgress(s)).toMatchObject({ current: 9, total: 4, label: 'Spec', status: 'completed' })
    put('squads/produto/state.json', JSON.stringify({ step: { label: 'Livre' } }))
    expect(readProgress(s)).toMatchObject({ current: 0, label: 'Livre', type: undefined })
  })
})

describe('isDir', () => {
  it('só pastas que existem', () => {
    expect(isDir(cwd)).toBe(true)
    expect(isDir(join(cwd, 'segredo.md'))).toBe(false)
    expect(isDir(join(cwd, 'nada'))).toBe(false)
    expect(isDir(42)).toBe(false)
  })
})
