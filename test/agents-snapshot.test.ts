import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// AO-34: o CLI só começa depois do snapshot do git. Sem isso, um arquivo que o agente
// escreve logo no início entra no snapshot como mudança antiga do usuário e some do cartão.

const calls: string[] = []
let finishSnapshot: () => void = () => undefined
const prompts: unknown[] = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt }: { prompt: AsyncIterable<unknown> }) => {
    calls.push('query')
    // Lê as mensagens da fila como o CLI faria, sem nunca responder.
    void (async () => {
      for await (const m of prompt) prompts.push(m)
    })()
    return {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      close: () => undefined,
      interrupt: async () => undefined,
    }
  },
}))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/bin/false' }))
vi.mock('../src/main/git', () => ({
  createWorktree: async () => null,
  changesSince: async () => null,
  takeSnapshot: () => {
    calls.push('snapshot:start')
    return new Promise((done) => {
      finishSnapshot = () => {
        calls.push('snapshot:done')
        done(null)
      }
    })
  },
}))

const { Store } = await import('../src/main/store')
const { AgentManager } = await import('../src/main/agents')

beforeEach(() => {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'ao-agents-')))
  calls.length = 0
  prompts.length = 0
})

const flush = () => new Promise((r) => setTimeout(r, 10))

describe('snapshot antes do CLI (AO-34)', () => {
  it('a query só começa depois que o snapshot termina', async () => {
    const m = new AgentManager(new Store())
    const a = await m.hire({ name: 'Ada', cwd: tmpdir(), task: 'faça x', permissionMode: 'default', worktree: false })
    await flush()
    expect(calls).toEqual(['snapshot:start'])
    // Mensagem enviada enquanto espera: vai na mesma fila, sem abrir outro CLI.
    m.sendMessage(a.id, 'e também y')
    await flush()
    expect(calls).toEqual(['snapshot:start'])
    finishSnapshot()
    await flush()
    expect(calls).toEqual(['snapshot:start', 'snapshot:done', 'query'])
    expect(prompts).toHaveLength(2)
  })

  it('agente dispensado enquanto espera não abre o CLI', async () => {
    const m = new AgentManager(new Store())
    const a = await m.hire({ name: 'Bob', cwd: tmpdir(), task: 'faça x', permissionMode: 'default', worktree: false })
    m.fire(a.id)
    finishSnapshot()
    await flush()
    expect(calls).not.toContain('query')
  })
})
