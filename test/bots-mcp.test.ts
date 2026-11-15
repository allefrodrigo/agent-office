import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { BOT_COLORS, BOT_LIMITS, SENSITIVE_KINDS, type AgentSummary, type Bot } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { BotStore } from '../src/main/bots/store'

// The MCP server is the SDK's business: each tool keeps its schema (parsed here like the SDK does) and handler.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _description: string, schema: unknown, handler: (args: unknown) => Promise<unknown>, extras?: unknown) => ({ name, schema, handler, extras }),
  createSdkMcpServer: (options: unknown) => options,
}))

const { BotTools, MEMORY_INSTRUCTIONS } = await import('../src/main/bots/mcp')
const { TicketBoard } = await import('../src/main/tickets')

type Tool = {
  name: string
  schema: z.ZodRawShape
  handler: (args: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
  extras?: { annotations?: { readOnlyHint?: boolean } }
}

let dir: string
let store: BotStore
let board: InstanceType<typeof TicketBoard>
let bots: InstanceType<typeof BotTools>

const makeBot = (id: string): Bot => ({
  id,
  name: id,
  tagline: '',
  role: 'Papel',
  color: BOT_COLORS[0],
  look: lookFromSeed(id),
  floor: 'terreo',
  cwd: dir,
  permissionMode: 'default',
  askBefore: [...SENSITIVE_KINDS],
  apps: 'all',
  worktree: false,
  dailyBudgetUsd: 0,
  pinned: false,
  hidden: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  lastReadAt: 0,
  runs: [],
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bots-mcp-'))
  store = new BotStore(dir)
  store.bots = [makeBot('gabi'), makeBot('leo')]
  board = new TicketBoard(dir)
  bots = new BotTools(store)
})

afterEach(() => {
  store.flush()
  board.flush()
  rmSync(dir, { recursive: true, force: true })
})

function server(agent: Partial<AgentSummary>) {
  const s = board.toolsFor({ id: 'ag', name: 'Gabi', cwd: dir, ...agent } as AgentSummary, () => [], undefined, bots) as unknown as { tools: Tool[]; instructions: string }
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const t = s.tools.find((x) => x.name === name)
    if (!t) throw new Error(`sem ${name}`)
    const r = await t.handler(z.object(t.schema).parse(args))
    return { text: r.content[0].text, isError: !!r.isError }
  }
  return { tools: s.tools, instructions: s.instructions, call }
}

describe('memória do bot pelo MCP', () => {
  it('agente comum não recebe as ferramentas nem a linha das instruções', () => {
    const s = server({})
    expect(s.tools.some((t) => t.name.startsWith('memory_'))).toBe(false)
    expect(s.instructions).not.toContain('memory_read')
    expect(s.tools.some((t) => t.name === 'ticket_create')).toBe(true)
  })

  it('agente de bot recebe memory_read (só leitura) e memory_write, e as instruções falam delas', () => {
    const s = server({ bot: 'gabi' })
    expect(s.tools.find((t) => t.name === 'memory_read')?.extras?.annotations?.readOnlyHint).toBe(true)
    expect(s.tools.some((t) => t.name === 'memory_write')).toBe(true)
    expect(s.instructions).toContain(MEMORY_INSTRUCTIONS)
  })

  it('escreve e lê; append acrescenta numa linha nova; replace reescreve', async () => {
    const { call } = server({ bot: 'gabi' })
    expect((await call('memory_read')).text).toBe('Sua memória está vazia.')
    expect((await call('memory_write', { text: '- Prefere tópicos.' })).text).toMatch(/^Memória gravada: 0,0 de 16 KB\.$/)
    await call('memory_write', { text: '- Reunião às 9h.', mode: 'append' })
    expect((await call('memory_read')).text).toBe('- Prefere tópicos.\n- Reunião às 9h.')
    await call('memory_write', { text: '# Notas\r\n- Só isto.\n', mode: 'replace' })
    expect(store.memory('gabi')).toBe('# Notas\n- Só isto.\n')
    const file = store.memoryPath('gabi')
    expect(readFileSync(file, 'utf8')).toBe('# Notas\n- Só isto.\n')
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('append que não cabe não grava nada; replace grande é cortado numa quebra de linha e avisa', async () => {
    const { call } = server({ bot: 'gabi' })
    const line = 'x'.repeat(99) + '\n'
    await call('memory_write', { text: line.repeat(160), mode: 'replace' })
    const before = store.memory('gabi')
    const r = await call('memory_write', { text: line.repeat(10), mode: 'append' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('Não coube')
    expect(store.memory('gabi')).toBe(before)
    const big = await call('memory_write', { text: line.repeat(200), mode: 'replace' })
    expect(big.isError).toBe(false)
    expect(big.text).toContain('o fim foi cortado')
    const kept = store.memory('gabi')
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(BOT_LIMITS.memoryBytes)
    expect(kept.endsWith('\n')).toBe(true)
  })

  it('recusa o que parece segredo', async () => {
    const { call } = server({ bot: 'gabi' })
    const r = await call('memory_write', { text: 'token: ghp_abcdefghijklmnopqrstuvwxyz0123' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('chaveiro do sistema')
    expect(store.memory('gabi')).toBe('')
  })

  it('um bot não alcança a memória de outro; bot apagado não tem memória', async () => {
    store.setMemory('leo', 'Segredo do Leo\n')
    const gabi = server({ bot: 'gabi' })
    expect((await gabi.call('memory_read')).text).toBe('Sua memória está vazia.')
    await gabi.call('memory_write', { text: 'Da Gabi', mode: 'replace' })
    expect(store.memory('leo')).toBe('Segredo do Leo\n')
    const gone = server({ bot: 'apagado' })
    const r = await gone.call('memory_read')
    expect(r.isError).toBe(true)
    expect(r.text).toContain('não existe mais')
  })

  it('outro módulo acrescenta ferramentas e instruções só para agentes de bot', () => {
    bots.add((_agent, bot) => ({ tools: [], instructions: [`Canal do ${bot.name}.`] }))
    expect(server({ bot: 'gabi' }).instructions).toContain('Canal do gabi.')
    expect(server({}).instructions).not.toContain('Canal do')
  })
})
