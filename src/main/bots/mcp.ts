import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { BOT_LIMITS, type AgentSummary, type Bot } from '@shared/types'
import { cleanMemory, looksLikeSecret, memoryBytes } from '@shared/bots'
import type { BotStore } from './store'

/**
 * The bot's memory tools (Chat dos bots, CB-06), composed into the agent's `office` server only
 * when the agent runs a bot. They reach one file: the memoria.md of the agent's own bot, bound
 * here from AgentSummary.bot. The model never names a bot, so it cannot touch another's memory.
 */

export type MemoryStore = Pick<BotStore, 'bot' | 'memory' | 'setMemory'>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BotTool = SdkMcpToolDefinition<any>

/** What the office server gains for a bot's agent: tools and lines for its instructions. */
export interface BotToolSet {
  tools: BotTool[]
  instructions: string[]
}

/** Tools another module adds for bot agents (phase 3: chat_post, bot_ask). Built per agent, per query. */
export type BotToolFactory = (agent: AgentSummary, bot: Bot) => BotToolSet

/**
 * The bot tools of the office server: the memory, plus what other modules add with `add`.
 * Agents that do not run a bot get none.
 */
export class BotTools {
  private factories: BotToolFactory[] = []

  constructor(private store: MemoryStore) {}

  add(factory: BotToolFactory): void {
    this.factories.push(factory)
  }

  for(agent: AgentSummary): BotToolSet {
    if (!agent.bot) return { tools: [], instructions: [] }
    const bot = this.store.bot(agent.bot)
    const memory = memoryTools(this.store, agent.bot) as unknown as BotTool[]
    const sets: BotToolSet[] = [{ tools: memory, instructions: [MEMORY_INSTRUCTIONS] }, ...(bot ? this.factories.map((f) => f(agent, bot)) : [])]
    return { tools: sets.flatMap((x) => x.tools), instructions: sets.flatMap((x) => x.instructions) }
  }
}

/** The line the office server's instructions gain for a bot's agent. */
export const MEMORY_INSTRUCTIONS =
  'Memória do bot: memory_read lê o seu memoria.md e memory_write grava nele (mode "append" acrescenta, "replace" reescreve tudo). ' +
  `Até ${Math.round(BOT_LIMITS.memoryBytes / 1024)} KB. Nunca guarde chaves, senhas, tokens ou dados pessoais.`

const kb = (bytes: number) => (bytes / 1024).toFixed(1).replace('.', ',')
const LIMIT = `${Math.round(BOT_LIMITS.memoryBytes / 1024)} KB`

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const fail = (err: unknown) => ({ content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true })
const run = (fn: () => string) => {
  try {
    return Promise.resolve(ok(fn()))
  } catch (err) {
    return Promise.resolve(fail(err))
  }
}

/** Appended text starts on a line of its own. */
function appended(before: string, text: string): string {
  if (!before) return text
  return before.endsWith('\n') ? before + text : `${before}\n${text}`
}

export function memoryTools(store: MemoryStore, botId: string) {
  const mine = () => {
    if (!store.bot(botId)) throw new Error('Este bot não existe mais: não há memória para usar.')
  }
  return [
    tool(
      'memory_read',
      'Lê o seu memoria.md: as notas que duram entre conversas (decisões, preferências, onde as coisas estão).',
      {},
      () =>
        run(() => {
          mine()
          const text = store.memory(botId)
          return text.trim() ? text : 'Sua memória está vazia.'
        }),
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'memory_write',
      'Grava no seu memoria.md. mode "append" acrescenta no fim; "replace" reescreve o arquivo inteiro (use para resumir e tirar o que ficou velho).',
      {
        text: z.string().max(BOT_LIMITS.memoryBytes * 2).describe('O texto, em Markdown'),
        mode: z.enum(['append', 'replace']).default('append').describe('append acrescenta; replace reescreve tudo'),
      },
      (args) =>
        run(() => {
          mine()
          // WARNING: memoria.md is plain text on disk and goes to the model on every run.
          if (looksLikeSecret(args.text)) {
            throw new Error('Isso parece uma chave, senha ou token, e a memória não guarda segredos. Peça para a pessoa guardar no chaveiro do sistema ou no .env do projeto.')
          }
          const before = store.memory(botId)
          const wanted = (args.mode === 'replace' ? args.text : appended(before, args.text)).replace(/\r\n?/g, '\n')
          const size = memoryBytes(wanted)
          // An append that does not fit would lose its own end: nothing is written.
          if (args.mode === 'append' && size > BOT_LIMITS.memoryBytes) {
            throw new Error(`Não coube: a memória ficaria com ${kb(size)} KB, e o limite é ${LIMIT}. Reescreva com mode "replace", resumindo as notas.`)
          }
          const kept = store.setMemory(botId, cleanMemory(wanted))
          if (memoryBytes(kept) < size) {
            return `Gravei ${kb(memoryBytes(kept))} de ${LIMIT}: o texto passou do limite e o fim foi cortado numa quebra de linha. Resuma e grave de novo com mode "replace".`
          }
          return `Memória gravada: ${kb(memoryBytes(kept))} de ${LIMIT}.`
        }),
    ),
  ]
}
