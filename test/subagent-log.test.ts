import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry, OfficeEvent, SubagentInfo } from '@shared/types'
import { AgentManager } from '../src/main/agents'
import { Store } from '../src/main/store'
import {
  agentCallsFromTranscript,
  applyStep,
  Coalescer,
  endSubagent,
  findSubagent,
  pushCapped,
  SUB_DONE_KEEP,
  SUB_FLUSH_MS,
  SUB_LOG_LIMIT,
  SubagentLogs,
  subagentStep,
} from '../src/main/subagent-log'

let n = 0
const newId = () => `e${n++}`
const entry = (text: string): LogEntry => ({ id: newId(), t: 0, kind: 'system', text })
const sub = (id: string, extra: Partial<SubagentInfo> = {}): SubagentInfo => ({ id, description: id, startedAt: 1, background: false, ...extra })

describe('subagentStep: mensagem do subagente → entradas do log e atividade', () => {
  it('tool_use vira entrada "tool" e a atividade atual', () => {
    const s = subagentStep('assistant', [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/main/git.ts' } }], newId)
    expect(s.entries).toMatchObject([{ kind: 'tool', tool: 'Edit', text: 'Edit src/main/git.ts' }])
    expect(s.activity).toBe('Editando git.ts')
    expect(s.tool).toBe('Edit')
    expect(s.toolUses).toBe(1)
  })

  it('texto, raciocínio e Bash', () => {
    const s = subagentStep('assistant', [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'Vou rodar os testes.' }, { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'npm test' } }], newId)
    expect(s.entries.map((e) => e.kind)).toEqual(['assistant', 'tool'])
    expect(s.activity).toBe('Rodando npm test')
  })

  it('só raciocínio: "Pensando…", sem entrada', () => {
    const s = subagentStep('assistant', [{ type: 'thinking', thinking: 'x' }], newId)
    expect(s.entries).toEqual([])
    expect(s.activity).toBe('Pensando…')
  })

  it('tool_result (texto ou blocos) e erro', () => {
    const s = subagentStep('user', [
      { type: 'tool_result', tool_use_id: 't', content: 'ok' },
      { type: 'tool_result', tool_use_id: 'u', content: [{ type: 'text', text: 'falhou' }], is_error: true },
    ], newId)
    expect(s.entries).toMatchObject([{ kind: 'tool_result', text: 'ok' }, { kind: 'tool_result', text: 'falhou', isError: true }])
    expect(s.activity).toBeUndefined()
  })

  it('saída longa é cortada; conteúdo estranho não quebra', () => {
    const s = subagentStep('user', [{ type: 'tool_result', content: 'x'.repeat(5000) }], newId)
    expect(s.entries[0].text).toHaveLength(1200)
    expect(subagentStep('assistant', null, newId).entries).toEqual([])
    expect(subagentStep('assistant', [null, 3, { type: 'tool_use' }], newId).entries).toEqual([])
    expect(subagentStep('user', 'o prompt', newId).entries).toMatchObject([{ kind: 'user', text: 'o prompt' }])
  })
})

describe('ligação mensagem → subagente', () => {
  it('findSubagent acha pelo tool_use_id do Agent tool, e pelo task_id na falta dele', () => {
    const subs = [sub('task-a', { toolUseId: 'toolu_a' }), sub('task-b')]
    expect(findSubagent(subs, 'toolu_a')?.id).toBe('task-a')
    expect(findSubagent(subs, 'task-b')?.id).toBe('task-b')
    expect(findSubagent(subs, 'toolu_x')).toBeUndefined()
    expect(findSubagent(undefined, 'toolu_a')).toBeUndefined()
  })

  it('applyStep atualiza atividade, ferramenta e contagem; sem mudança devolve false', () => {
    const s = sub('a')
    expect(applyStep(s, { entries: [], activity: 'Lendo x.ts', tool: 'Read', toolUses: 1 })).toBe(true)
    expect(s).toMatchObject({ activity: 'Lendo x.ts', lastTool: 'Read', toolUses: 1 })
    expect(applyStep(s, { entries: [], toolUses: 0 })).toBe(false)
  })
})

describe('SubagentLogs: log limitado por subagente', () => {
  it('guarda por subagente e entrega o pendente agrupado', () => {
    const logs = new SubagentLogs()
    logs.start('a', 'toolu_a')
    logs.start('b', 'toolu_b')
    expect(logs.add('toolu_a', [entry('1'), entry('2')])).toBe('a')
    expect(logs.add('toolu_b', [entry('3')])).toBe('b')
    expect(logs.add('toolu_a', [entry('4')])).toBe('a')
    expect(logs.get('a').map((e) => e.text)).toEqual(['1', '2', '4'])
    const sent = logs.take()
    expect(sent.map((x) => [x.subId, x.entries.length])).toEqual([['a', 3], ['b', 1]])
    expect(logs.take()).toEqual([])
    expect(logs.hasPending).toBe(false)
  })

  it(`não passa de ${SUB_LOG_LIMIT} entradas, nem no log nem no pendente`, () => {
    const logs = new SubagentLogs()
    logs.start('a', 'toolu_a')
    for (let i = 0; i < 2000; i++) logs.add('toolu_a', [entry(String(i))])
    expect(logs.get('a')).toHaveLength(SUB_LOG_LIMIT)
    expect(logs.get('a')[0].text).toBe('1500')
    expect(logs.take()[0].entries).toHaveLength(SUB_LOG_LIMIT)
  })

  it('mensagens antes do task_started esperam e entram quando ele chega', () => {
    const logs = new SubagentLogs()
    expect(logs.add('toolu_x', [entry('cedo')])).toBeUndefined()
    expect(logs.size).toBe(1)
    logs.start('x', 'toolu_x')
    expect(logs.get('x').map((e) => e.text)).toEqual(['cedo'])
  })

  it('órfãs têm limite de chaves', () => {
    const logs = new SubagentLogs()
    for (let i = 0; i < 100; i++) logs.add(`toolu_${i}`, [entry(String(i))])
    expect(logs.size).toBeLessThanOrEqual(20)
  })

  it('note só escreve em subagente conhecido; forget e seed', () => {
    const logs = new SubagentLogs()
    logs.note('nada', entry('x'))
    expect(logs.has('nada')).toBe(false)
    logs.seed('r', [entry('antigo')])
    expect(logs.get('r')).toHaveLength(1)
    expect(logs.hasPending).toBe(false)
    logs.forget('r')
    expect(logs.get('r')).toEqual([])
  })
})

describe('endSubagent: lista dos que terminaram', () => {
  it(`fica com os ${SUB_DONE_KEEP} mais novos e devolve os que saíram`, () => {
    const done: SubagentInfo[] = []
    const dropped: string[] = []
    for (let i = 0; i < SUB_DONE_KEEP + 3; i++) dropped.push(...endSubagent(done, sub(`s${i}`)))
    expect(done).toHaveLength(SUB_DONE_KEEP)
    expect(dropped).toEqual(['s0', 's1', 's2'])
    endSubagent(done, sub('s5'))
    expect(done.at(-1)?.id).toBe('s5')
    expect(done).toHaveLength(SUB_DONE_KEEP)
  })
})

describe('Coalescer: agrupa rajadas', () => {
  it('várias marcas na mesma janela viram um envio só', () => {
    let timer: (() => void) | null = null
    const flush = vi.fn()
    const c = new Coalescer(flush, 250, { set: (fn) => (timer = fn), clear: () => (timer = null) })
    for (let i = 0; i < 100; i++) c.mark()
    expect(flush).not.toHaveBeenCalled()
    timer!()
    expect(flush).toHaveBeenCalledTimes(1)
    c.mark()
    c.now()
    expect(flush).toHaveBeenCalledTimes(2)
    expect(timer).toBeNull()
  })
})

describe('agentCallsFromTranscript: retomada', () => {
  it('liga o agentId do tool_result à chamada do Agent tool', () => {
    const calls = agentCallsFromTranscript([
      { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { description: 'Achar o bug', subagent_type: 'Explore' } }] } },
      { type: 'assistant', parent_tool_use_id: 'toolu_1', message: { content: [{ type: 'tool_use', id: 'inner', name: 'Agent', input: {} }] } },
      { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'Achei.\nagentId: a1b2c3 (use SendMessage…)' }] }] } },
      { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'outro', content: 'agentId: zzz' }] } },
    ])
    expect([...calls]).toEqual([['a1b2c3', { toolUseId: 'toolu_1', description: 'Achar o bug', type: 'Explore', isError: false }]])
  })
})

describe('AgentManager: subagentes ao vivo (carga com 20)', () => {
  let events: OfficeEvent[]
  let manager: AgentManager
  beforeEach(() => {
    vi.useFakeTimers()
    app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-sub-')))
    manager = new AgentManager(new Store())
    events = []
    manager.on('event', (e: OfficeEvent) => events.push(e))
  })
  afterEach(() => vi.useRealTimers())

  const base = (task: string) => ({ type: 'system', uuid: task, session_id: 'demo', task_id: task, tool_use_id: `toolu_${task}` }) as const

  it('mensagens do filho vão para o log dele, não para o do pai, e chegam agrupadas', () => {
    const parent = manager.terminalAgent('s1', '/tmp/x').id
    const tasks = Array.from({ length: 20 }, (_, i) => `t${i}`)
    for (const t of tasks) manager.demoTask(parent, { ...base(t), subtype: 'task_started', description: `Carga ${t}`, subagent_type: 'Explore', task_type: 'local_agent', prompt: 'faça' } as never)
    const parentLog = manager.getLog(parent).length
    events = []
    // 20 subagentes × 50 mensagens dentro de uma janela de agrupamento
    for (let k = 0; k < 50; k++) {
      for (const t of tasks) manager.demoSubagentMessage(parent, `toolu_${t}`, 'assistant', [{ type: 'tool_use', id: `${t}-${k}`, name: 'Read', input: { file_path: `src/f${k}.ts` } }])
    }
    expect(events).toHaveLength(0)
    vi.advanceTimersByTime(SUB_FLUSH_MS)
    const sublogs = events.filter((e) => e.type === 'agent:sublog')
    const upserts = events.filter((e) => e.type === 'agent:upsert')
    // one burst with all 20 logs plus one summary, instead of 1000 events
    expect(sublogs).toHaveLength(1)
    expect(sublogs[0].type === 'agent:sublog' && sublogs[0].logs).toHaveLength(20)
    expect(upserts).toHaveLength(1)
    expect(manager.getLog(parent)).toHaveLength(parentLog)
    const card = manager.list().find((a) => a.id === parent)!.subagents!.find((s) => s.id === 't3')!
    expect(card).toMatchObject({ activity: 'Lendo f49.ts', toolUses: 50, toolUseId: 'toolu_t3' })
    // prompt + 50 tools
    expect(manager.getSubagentLog(parent, 't3')).toHaveLength(51)
  })

  it('log de cada um fica no limite mesmo com muitas mensagens', () => {
    const parent = manager.terminalAgent('s2', '/tmp/y').id
    manager.demoTask(parent, { ...base('a'), subtype: 'task_started', description: 'A', task_type: 'local_agent' } as never)
    for (let k = 0; k < 3000; k++) manager.demoSubagentMessage(parent, 'toolu_a', 'user', [{ type: 'tool_result', tool_use_id: 'x', content: `saída ${k}` }])
    vi.advanceTimersByTime(SUB_FLUSH_MS)
    expect(manager.getSubagentLog(parent, 'a')).toHaveLength(SUB_LOG_LIMIT)
    expect(manager.subagentMemory(parent)).toBe(SUB_LOG_LIMIT)
  })

  it('task_notification passa o ajudante para os terminados, com status e o log guardado', () => {
    const parent = manager.terminalAgent('s3', '/tmp/z').id
    manager.demoTask(parent, { ...base('b'), subtype: 'task_started', description: 'B', task_type: 'local_agent' } as never)
    manager.demoSubagentMessage(parent, 'toolu_b', 'assistant', [{ type: 'text', text: 'oi' }])
    manager.demoTask(parent, { ...base('b'), subtype: 'task_progress', description: 'B', usage: { total_tokens: 5000, tool_uses: 2, duration_ms: 10 }, last_tool_name: 'Grep', summary: 'Procurando o bug' } as never)
    manager.demoTask(parent, { ...base('b'), subtype: 'task_notification', status: 'failed', output_file: '', summary: 'Deu errado', usage: { total_tokens: 7000, tool_uses: 3, duration_ms: 1200 } } as never)
    const a = manager.list().find((x) => x.id === parent)!
    expect(a.subagents).toBeUndefined()
    expect(a.subagentsDone).toMatchObject([{ id: 'b', status: 'failed', tokens: 7000, summary: 'Procurando o bug' }])
    const log = manager.getSubagentLog(parent, 'b')
    expect(log.map((e) => e.kind)).toEqual(['assistant', 'result', 'error'])
    // sent right away, without waiting for the window
    expect(events.some((e) => e.type === 'agent:sublog' && e.logs.some((x) => x.subId === 'b'))).toBe(true)
  })

  it('workflow vira ajudante com o nome do workflow', () => {
    const parent = manager.terminalAgent('s4', '/tmp/w').id
    manager.demoTask(parent, { ...base('w'), subtype: 'task_started', description: 'revisão', task_type: 'local_workflow', workflow_name: 'spec' } as never)
    expect(manager.list().find((x) => x.id === parent)!.subagents).toMatchObject([{ id: 'w', description: 'spec: revisão', type: 'Workflow', workflow: true }])
  })

  it('retomada: recall traz os ajudantes terminados com seus logs', () => {
    const helpers = [{ info: sub('h1', { status: 'completed' }), log: [entry('passo')] }]
    const a = manager.recall('00000000-0000-4000-8000-000000000000', '/tmp/r', [], { permissionMode: 'default' }, undefined, helpers)
    expect(a.subagentsDone?.map((s) => s.id)).toEqual(['h1'])
    expect(manager.getSubagentLog(a.id, 'h1').map((e) => e.text)).toEqual(['passo'])
  })
})

describe('pushCapped', () => {
  it('corta do começo', () => {
    expect(pushCapped([1, 2], [3, 4, 5], 3)).toEqual([3, 4, 5])
  })
})
