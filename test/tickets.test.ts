import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor, AgentSummary, OfficeEvent, ProjectFloor } from '@shared/types'

// The MCP server is the SDK's business: here each tool is just its handler.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => ({ name, handler }),
  createSdkMcpServer: (options: unknown) => options,
}))

const { TicketBoard } = await import('../src/main/tickets')

const me: Actor = { kind: 'player', name: 'Você' }
let dir: string
let board: InstanceType<typeof TicketBoard>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-tickets-'))
  board = new TicketBoard(dir)
})
afterEach(() => {
  board.flush()
  vi.useRealTimers()
})

const reload = () => {
  board.flush()
  board = new TicketBoard(dir)
  return board
}

describe('criar', () => {
  it('dá chaves em sequência e valores padrão', () => {
    const a = board.create({ title: 'Primeiro' }, me)
    const b = board.create({ title: 'Segundo', type: 'bug', priority: 'high', status: 'todo' }, me)
    expect(a).toMatchObject({ key: 'AO-1', type: 'task', priority: 'medium', status: 'backlog', order: 0, reporter: me })
    expect(b).toMatchObject({ key: 'AO-2', type: 'bug', priority: 'high', status: 'todo' })
    expect(a.activity[0].text).toContain('Backlog')
  })

  it('limpa o rascunho: título, tags, critérios, estimativa, prazo', () => {
    const t = board.create(
      {
        title: '  muitos   espaços \n aqui ',
        tags: ['Front End', 'front end', '', 'x'.repeat(50)],
        acceptance: [{ text: ' passa ', done: true }, { text: '   ', done: false }],
        estimate: 250,
        dueDate: 'amanhã',
        description: ' texto ',
      },
      me,
    )
    expect(t.title).toBe('muitos espaços aqui')
    expect(t.tags).toEqual(['front-end', 'x'.repeat(30)])
    expect(t.acceptance).toEqual([{ text: 'passa', done: true }])
    expect(t.estimate).toBe(100)
    expect(t.dueDate).toBeUndefined()
    expect(t.description).toBe('texto')
  })

  it('recusa sem título, pasta que não existe e rascunho que não é objeto', () => {
    expect(() => board.create({ title: '  ' }, me)).toThrow('Dê um título')
    expect(() => board.create({ title: 'x', cwd: join(dir, 'nada') }, me)).toThrow('pasta do projeto')
    expect(() => board.create(null as never, me)).toThrow('Ticket inválido')
    expect(() => board.create({ title: 'x', tags: 'a' as never }, me)).toThrow('Tags inválidas')
    expect(() => board.create({ title: 'x', acceptance: 'a' as never }, me)).toThrow('Critérios')
  })

  it('aceita pasta que existe e emite o evento', () => {
    const events: OfficeEvent[] = []
    board.on('event', (e) => events.push(e))
    const t = board.create({ title: 'x', cwd: dir, estimate: 2.25, dueDate: '2026-10-20' }, me)
    expect(t).toMatchObject({ cwd: dir, estimate: 2.3, dueDate: '2026-10-20' })
    expect(events).toEqual([{ type: 'ticket:upsert', ticket: expect.objectContaining({ key: 'AO-1' }) }])
  })
})

describe('seq nunca repete', () => {
  it('depois de apagar, de recarregar e de fechar', () => {
    const a = board.create({ title: 'a' }, me)
    board.create({ title: 'b' }, me)
    board.remove(a.id)
    expect(board.create({ title: 'c' }, me).key).toBe('AO-3')
    reload()
    expect(board.list().map((t) => t.key)).toEqual(['AO-2', 'AO-3'])
    const d = board.create({ title: 'd', status: 'done' }, me)
    expect(d.key).toBe('AO-4')
    board.close([d.id], me)
    reload()
    expect(board.create({ title: 'e' }, me).key).toBe('AO-5')
    const keys = [...board.list(), ...board.listClosed()].map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('arquivo sem seq começa do zero sem quebrar', () => {
    expect(new TicketBoard(mkdtempSync(join(tmpdir(), 'ao-empty-'))).create({ title: 'x' }, me).key).toBe('AO-1')
  })
})

describe('mover', () => {
  it('troca de coluna, registra a atividade e marca doneAt', () => {
    const t = board.create({ title: 'x' }, me)
    board.move(t.id, 'done', undefined, me)
    expect(board.get(t.id)).toMatchObject({ status: 'done', doneAt: expect.any(Number) })
    expect(board.get(t.id)!.activity.at(-1)!.text).toBe('moveu de Backlog para Feito')
    board.move(t.id, 'doing', undefined, me)
    expect(board.get(t.id)!.doneAt).toBeUndefined()
  })

  it('reordena dentro da coluna antes de beforeId', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((title) => board.create({ title, status: 'todo' }, me))
    board.move(c.id, 'todo', a.id, me)
    const order = board
      .list()
      .filter((t) => t.status === 'todo')
      .sort((x, y) => x.order - y.order)
      .map((t) => t.title)
    expect(order).toEqual(['c', 'a', 'b'])
    board.move(a.id, 'todo', 'nao-existe', me)
    expect(board.get(a.id)!.order).toBe(2)
    expect(board.get(b.id)!.order).toBe(1)
  })

  it('recusa coluna inválida e ticket que não existe', () => {
    const t = board.create({ title: 'x' }, me)
    expect(() => board.move(t.id, 'archived' as never, undefined, me)).toThrow('Coluna inválida')
    expect(() => board.move('ghost', 'todo', undefined, me)).toThrow('não existe')
  })
})

describe('editar, comentar, critérios, responsável', () => {
  it('update muda só o que veio e registra', () => {
    const t = board.create({ title: 'x', cwd: dir, tags: ['a'], estimate: 3, dueDate: '2026-01-01' }, me)
    board.update(t.id, { type: 'bug', priority: 'critical', description: 'nova', title: 'y', acceptance: [{ text: 'ok', done: false }] }, me)
    board.update(t.id, { cwd: null, tags: ['b'], estimate: null, dueDate: null, status: 'review' }, me)
    expect(board.get(t.id)).toMatchObject({ title: 'y', type: 'bug', priority: 'critical', description: 'nova', status: 'review', tags: ['b'] })
    expect(board.get(t.id)!.cwd).toBeUndefined()
    expect(board.get(t.id)!.estimate).toBeUndefined()
    expect(board.get(t.id)!.dueDate).toBeUndefined()
    const log = board.get(t.id)!.activity.map((a) => a.text)
    expect(log).toEqual(expect.arrayContaining(['mudou o tipo para Bug', 'mudou a prioridade para Crítica', 'editou a descrição']))
  })

  it('comentário vazio é recusado; o resto fica com o autor', () => {
    const t = board.create({ title: 'x' }, me)
    expect(() => board.comment(t.id, '   ', me)).toThrow('vazio')
    board.comment(t.id, ' oi ', me)
    expect(board.get(t.id)!.comments).toEqual([expect.objectContaining({ text: 'oi', author: me })])
  })

  it('check marca critérios por posição e recusa posições fora', () => {
    const t = board.create({ title: 'x', acceptance: [{ text: 'a', done: false }, { text: 'b', done: false }] }, me)
    board.check(t.id, [2, 9], true, me)
    expect(board.get(t.id)!.acceptance.map((c) => c.done)).toEqual([false, true])
    expect(() => board.check(t.id, [0, 3], true, me)).toThrow('2 critério')
  })

  it('assign, activeFor e agentLeft', () => {
    const agent: Actor = { kind: 'agent', name: 'Ada', id: 'ag-1' }
    const t = board.create({ title: 'x', status: 'doing' }, me)
    board.assign(t.id, agent, me)
    expect(board.activeFor('ag-1').map((x) => x.id)).toEqual([t.id])
    board.agentLeft('ag-1')
    expect(board.get(t.id)!.assignee).toEqual({ kind: 'agent', name: 'Ada' })
    board.assign(t.id, undefined, me)
    expect(board.get(t.id)!.assignee).toBeUndefined()
  })

  it('byKey aceita AO-12, ao-12 e 12', () => {
    const t = board.create({ title: 'x' }, me)
    expect(board.byKey('AO-1')?.id).toBe(t.id)
    expect(board.byKey(' ao-1 ')?.id).toBe(t.id)
    expect(board.byKey('1')?.id).toBe(t.id)
    expect(board.byKey('AO-99')).toBeUndefined()
  })

  it('remove de id desconhecido não faz nada', () => {
    board.create({ title: 'x' }, me)
    board.remove('ghost')
    expect(board.list()).toHaveLength(1)
  })
})

describe('fechar e reabrir', () => {
  it('close leva só os de Feito para o arquivo', () => {
    const done = board.create({ title: 'feito', status: 'done' }, me)
    const open = board.create({ title: 'aberto', status: 'todo' }, me)
    expect(board.close([done.id, open.id], me)).toBe(1)
    expect(board.list().map((t) => t.id)).toEqual([open.id])
    expect(board.listClosed()).toEqual([expect.objectContaining({ id: done.id, closedAt: expect.any(Number) })])
    expect(board.close(undefined, me)).toBe(0)
    expect(board.byKey(done.key)).toBeUndefined()
    expect(board.byKey(done.key, true)?.id).toBe(done.id)
  })

  it('close sem ids fecha todos os de Feito, e o arquivo sobrevive à recarga', () => {
    board.create({ title: 'a', status: 'done' }, me)
    board.create({ title: 'b', status: 'done', tags: ['pagamento'] }, me)
    expect(board.close(undefined, me)).toBe(2)
    reload()
    expect(board.listClosed()).toHaveLength(2)
    expect(board.listClosed('PAGAMENTO').map((t) => t.title)).toEqual(['b'])
    expect(board.listClosed('ao-1').map((t) => t.title)).toEqual(['a'])
  })

  it('reopen volta para A fazer com histórico; fechado de novo some', () => {
    const t = board.create({ title: 'x', status: 'done' }, me)
    board.comment(t.id, 'nota', me)
    board.close([t.id], me)
    const back = board.reopen(t.id, me)
    expect(back).toMatchObject({ status: 'todo', comments: [expect.objectContaining({ text: 'nota' })] })
    expect(back.closedAt).toBeUndefined()
    expect(back.doneAt).toBeUndefined()
    expect(back.activity.at(-1)!.text).toBe('reabriu o ticket em A fazer')
    expect(board.listClosed()).toEqual([])
    expect(() => board.reopen(t.id, me)).toThrow('não está entre os fechados')
    reload()
    expect(board.listClosed()).toEqual([])
    expect(board.get(t.id)?.status).toBe('todo')
  })

  it('autoClose fecha o que está em Feito há N dias; 0 desliga', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T12:00:00'))
    const old = board.create({ title: 'velho', status: 'done' }, me)
    vi.setSystemTime(new Date('2026-10-06T12:00:00'))
    const fresh = board.create({ title: 'novo', status: 'done' }, me)
    vi.setSystemTime(new Date('2026-10-08T12:00:00'))
    expect(board.autoClose(0)).toBe(0)
    expect(board.autoClose(7)).toBe(1)
    expect(board.listClosed().map((t) => t.id)).toEqual([old.id])
    expect(board.listClosed()[0].activity.at(-1)!.actor.name).toBe('Quadro')
    expect(board.get(fresh.id)?.status).toBe('done')
    expect(board.autoClose(Number.NaN)).toBe(0)
  })

  it('arquivo de fechados ilegível vira lista vazia', () => {
    expect(board.listClosed()).toEqual([])
  })
})

describe('ferramentas dos agentes', () => {
  const agent = { id: 'ag-1', name: 'Ada', cwd: dir, project: 'p1' } as AgentSummary
  type Tool = { name: string; handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }> }
  const tools = (projects: ProjectFloor[]) => {
    const server = board.toolsFor({ ...agent, cwd: dir }, () => projects) as unknown as { tools: Tool[] }
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await server.tools.find((t) => t.name === name)!.handler(args)
      return { text: r.content[0].text, isError: !!r.isError }
    }
    return call
  }

  it('cria, lista no andar, lê, atualiza, marca e comenta', async () => {
    const call = tools([{ id: 'p1', name: 'Loja', cwd: dir }])
    const created = await call('ticket_create', { title: 'Corrigir', type: 'bug', priority: 'high', description: 'd', acceptance: ['a', 'b'], tags: [], status: 'todo' })
    expect(created.text).toBe('Criei AO-1: Corrigir (A fazer).')
    board.create({ title: 'Outro andar' }, me)
    const list = await call('tickets_list', {})
    expect(list.text).toContain('AO-1 [todo] Corrigir (bug, high · 0/2 critérios)')
    expect(list.text).not.toContain('Outro andar')
    expect((await call('tickets_list', { all_floors: true })).text).toContain('Outro andar')
    expect((await call('tickets_list', { search: 'nada' })).text).toContain('Nenhum ticket')
    expect((await call('ticket_get', { key: 'AO-1' })).text).toContain('Status: todo')
    expect((await call('ticket_update', { key: 'AO-1', status: 'review' })).text).toContain('Revisão')
    expect((await call('ticket_check', { key: '1', items: [1, 2], done: true })).text).toBe('AO-1: 2/2 critérios cumpridos.')
    expect((await call('ticket_comment', { key: 'AO-1', text: 'feito' })).text).toBe('Comentei em AO-1.')
    expect(board.byKey('AO-1')!.comments[0].author).toEqual({ kind: 'agent', name: 'Ada', id: 'ag-1' })
    expect((await call('tickets_list', { status: ['review'], mine: true })).text).toBe('Nenhum ticket com esses filtros neste andar. Use all_floors=true para ver os outros andares.')
  })

  it('fechado só se lê; ticket que não existe vira erro legível', async () => {
    const call = tools([{ id: 'p1', name: 'Loja', cwd: dir }])
    const t = board.create({ title: 'Velho', status: 'done', cwd: dir }, me)
    board.close([t.id], me)
    expect((await call('ticket_get', { key: t.key })).text).toContain('Status: fechado')
    const upd = await call('ticket_update', { key: t.key, status: 'todo' })
    expect(upd).toMatchObject({ isError: true, text: expect.stringContaining('está fechado') })
    expect((await call('ticket_comment', { key: 'AO-77', text: 'x' })).isError).toBe(true)
    expect((await call('ticket_get', { key: 'AO-77' })).isError).toBe(true)
    expect((await call('tickets_list', { closed: true })).text).toContain(`${t.key} [done] Velho`)
    expect((await call('tickets_list', { closed: true, search: 'nada' })).text).toContain('Nenhum ticket fechado')
  })
})
