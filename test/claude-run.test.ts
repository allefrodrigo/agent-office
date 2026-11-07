import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanUseTool, Options } from '@anthropic-ai/claude-agent-sdk'

// The SDK never runs here: query() records its options and answers with a canned result.
const calls: { options: Options }[] = []
let answer: Record<string, unknown> = {}
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Options }) => {
    calls.push({ options })
    return (async function* () {
      yield answer
    })()
  },
}))
vi.mock('../src/main/claude-path', () => ({ findClaude: () => '/bin/claude' }))
vi.mock('../src/main/creative/media', () => ({ toJpegSmall: vi.fn() }))

const { claudeOptions, runClaude } = await import('../src/main/claude-run')
const studio = await import('../src/main/creative/claude')

const success = (over: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'ok',
  structured_output: { a: 1 },
  total_cost_usd: 0.12,
  num_turns: 2,
  duration_ms: 3000,
  modelUsage: {},
  ...over,
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-run-'))
  calls.length = 0
  answer = success()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const ask = async (opts: Options, tool: string, input: Record<string, unknown>) => {
  const ctx = { signal: new AbortController().signal, toolUseID: 't1' } as unknown as Parameters<CanUseTool>[2]
  const r = await (opts.canUseTool as CanUseTool)(tool, input, ctx)
  if (!r) throw new Error('sem resposta de permissão')
  return r
}

describe('claudeOptions', () => {
  it('sem readRoots não há ferramenta nenhuma e toda permissão é negada', async () => {
    const o = claudeOptions({ prompt: 'p', system: 'S', cwd: dir, env: {} }, '/bin/claude', new AbortController())
    expect(o.tools).toEqual([])
    expect((await ask(o, 'Read', { file_path: join(dir, 'x.txt') })).behavior).toBe('deny')
    expect((await ask(o, 'Bash', { command: 'ls' })).behavior).toBe('deny')
  })

  it('readRoots vazio também fica sem ferramentas', () => {
    const o = claudeOptions({ prompt: 'p', system: 'S', cwd: dir, env: {}, readRoots: [] }, '/bin/claude', new AbortController())
    expect(o.tools).toEqual([])
  })

  it('com readRoots só as de leitura, e só dentro das pastas', async () => {
    const o = claudeOptions(
      { prompt: 'p', system: 'S', cwd: dir, env: {}, readRoots: [dir], denyMessage: 'não' },
      '/bin/claude',
      new AbortController(),
    )
    expect(o.tools).toEqual(['Read', 'Glob', 'Grep', 'LS'])
    expect((await ask(o, 'Read', { file_path: join(dir, 'x.txt') })).behavior).toBe('allow')
    expect(await ask(o, 'Read', { file_path: '/etc/passwd' })).toMatchObject({ behavior: 'deny', message: 'não' })
    expect((await ask(o, 'Write', { file_path: join(dir, 'x.txt') })).behavior).toBe('deny')
  })

  it('system prompt vem do chamador; modelo padrão sonnet; schema vira json_schema', () => {
    const o = claudeOptions(
      { prompt: 'p', system: 'Faça a ata.', cwd: dir, env: { A: '1' }, schema: { type: 'object' } },
      '/bin/claude',
      new AbortController(),
    )
    expect(o.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Faça a ata.' })
    expect(o.model).toBe('sonnet')
    expect(o.persistSession).toBe(false)
    expect(o.outputFormat).toEqual({ type: 'json_schema', schema: { type: 'object' } })
    expect(o.env).toMatchObject({ A: '1', AGENT_OFFICE_MANAGED: '1' })
  })
})

describe('runClaude', () => {
  it('devolve texto, saída estruturada e custo', async () => {
    const r = await runClaude({ prompt: 'p', system: 'S', cwd: dir, env: {} })
    expect(r).toEqual({ text: 'ok', structured: { a: 1 }, costUsd: 0.12 })
  })

  it('com ledger, registra o custo na categoria', async () => {
    const book = { recordCategory: vi.fn(() => 0.12) }
    await runClaude({
      prompt: 'p',
      system: 'S',
      cwd: dir,
      env: {},
      ledger: { book, category: 'reunioes', cwd: '/andar', account: 'acc-2' },
    })
    expect(book.recordCategory).toHaveBeenCalledWith('reunioes', {
      cwd: '/andar',
      account: 'acc-2',
      costUsd: 0.12,
      modelUsage: {},
      turns: 2,
      durationMs: 3000,
    })
  })

  it('um livro de custos que falha não perde a resposta', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const book = {
      recordCategory: () => {
        throw new Error('disco cheio')
      },
    }
    const r = await runClaude({ prompt: 'p', system: 'S', cwd: dir, env: {}, ledger: { book, category: 'reunioes', cwd: '/andar' } })
    expect(r.text).toBe('ok')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('resultado com erro vira exceção e não registra custo', async () => {
    answer = success({ subtype: 'error_max_turns' })
    const book = { recordCategory: vi.fn(() => 0) }
    await expect(
      runClaude({ prompt: 'p', system: 'S', cwd: dir, env: {}, ledger: { book, category: 'reunioes', cwd: '/andar' } }),
    ).rejects.toThrow('O Claude parou')
    expect(book.recordCategory).not.toHaveBeenCalled()
  })
})

describe('estúdio', () => {
  it('chama o runClaude genérico com o system prompt de hoje e sem ledger', async () => {
    await studio.runClaude({ prompt: 'p', cwd: dir, model: 'opus', env: {} })
    const o = calls[0].options
    expect(o.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: studio.STUDIO_SYSTEM })
    expect(studio.STUDIO_SYSTEM).toMatch(/^You are a creative strategist inside a creative studio\./)
    expect(o.model).toBe('opus')
    expect(o.tools).toEqual([])
  })

  it('a negação de leitura mantém a frase do estúdio', async () => {
    await studio.runClaude({ prompt: 'p', cwd: dir, model: 'sonnet', env: {}, readRoots: [dir] })
    expect(await ask(calls[0].options, 'Read', { file_path: '/etc/passwd' })).toMatchObject({
      behavior: 'deny',
      message: studio.STUDIO_DENY,
    })
  })
})
