import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { AgentSummary, Bot } from '@shared/types'

// Chat dos bots, canais (CB-19): as ferramentas chat_post e bot_ask do servidor `office`, só para o
// agente de um bot que está em algum canal. O bot é o do agente (AgentSummary.bot, ligado aqui): o
// modelo nunca diz quem ele é, então não fala em nome de outro bot. O escopo (só os canais de que é
// membro, só bots que dividem um canal, nunca a si mesmo, profundidade e limite por hora) fica no
// ChannelService, que devolve a recusa como texto.

/** What the tools need from the ChannelService. */
export interface ChannelToolHost {
  botPost(botId: string, channel: string, text: string): string
  botAsk(fromBotId: string, bot: string, question: string, channel?: string): string
  /** The bot's channels and who else is in each. */
  channelSummary(botId: string): { name: string; members: string[] }[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChannelTool = SdkMcpToolDefinition<any>

/** Tools and lines for the office server's instructions (bots/mcp.ts BotToolSet). */
export interface ChannelToolSet {
  tools: ChannelTool[]
  instructions: string[]
}

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })
const fail = (err: unknown) => ({
  content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
  isError: true,
})
const run = (fn: () => string) => {
  try {
    return Promise.resolve(ok(fn()))
  } catch (err) {
    return Promise.resolve(fail(err))
  }
}

/** The instructions' line: the bot's channels, who it can ask and the rules. */
export function channelInstructions(channels: { name: string; members: string[] }[]): string {
  const list = channels.map((c) => `#${c.name}${c.members.length ? ` (com ${c.members.join(', ')})` : ''}`).join('; ')
  return (
    `Canais do Chat: você está em ${list}. chat_post posta uma mensagem num canal seu (use para avisar o canal no meio do trabalho; ` +
    'a sua resposta final já vai para o canal de onde veio a mensagem). bot_ask faz uma pergunta a outro membro dos seus canais e devolve na hora: ' +
    'não espere, siga o trabalho; a resposta chega depois como mensagem nova "[Resposta de …]". Nunca pergunte a si mesmo. Há limite de perguntas e posts por hora.'
  )
}

/**
 * The tool factory for BotTools.add (bots/mcp.ts): built per agent, per query. A bot in no
 * channel gets nothing, so the tools never show where they cannot work.
 */
export function channelTools(host: ChannelToolHost): (agent: AgentSummary, bot: Pick<Bot, 'id'>) => ChannelToolSet {
  return (_agent, bot) => {
    const channels = host.channelSummary(bot.id)
    if (!channels.length) return { tools: [], instructions: [] }
    const tools = [
      tool(
        'chat_post',
        'Posta uma mensagem num canal do Chat de que você é membro. Ela aparece no canal com o seu nome.',
        {
          channel: z.string().max(80).describe('Nome do canal, com ou sem #, ex.: lançamento'),
          text: z.string().max(20_000).describe('A mensagem, em Markdown, curta'),
        },
        (args) => run(() => host.botPost(bot.id, args.channel, args.text)),
      ),
      tool(
        'bot_ask',
        'Pergunta a outro bot que divide um canal com você. Devolve na hora; a resposta chega depois como mensagem nova. A pergunta aparece no canal, recolhida.',
        {
          bot: z.string().max(80).describe('Nome do bot, ex.: Revisor do dia'),
          question: z
            .string()
            .max(8000)
            .describe('A pergunta, com o contexto que o outro bot precisa para responder sem perguntar de volta'),
          channel: z
            .string()
            .max(80)
            .optional()
            .describe('Canal onde a conversa aparece; padrão: o da sua rodada atual ou o primeiro que vocês dividem'),
        },
        (args) => run(() => host.botAsk(bot.id, args.bot, args.question, args.channel)),
      ),
    ] as unknown as ChannelTool[]
    return { tools, instructions: [channelInstructions(channels)] }
  }
}
