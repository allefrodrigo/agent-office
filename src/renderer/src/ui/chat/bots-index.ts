import { botTagFor, indexBots, type BotIndex, type BotTagInfo } from '../../world/bot-tag'
import { chatStore } from './store'

export type { BotTagInfo } from '../../world/bot-tag'

// Quem é bot no escritório, para a etiqueta "bot" no nome do agente (3D e 2D). Lê a lista do
// store do Chat e só avisa quando muda o que a etiqueta mostra (nome, cor, agente), não a cada
// mensagem nova. Spec: docs/prd/chat-de-bots.md, "No escritório".

let index: BotIndex = indexBots([])
const listeners = new Set<() => void>()

chatStore.on(() => {
  const next = indexBots(chatStore.bots)
  if (next.key === index.key) return
  index = next
  for (const fn of listeners) fn()
})

/** The bot an office agent runs (by `agent.bot`, or by the bot's agentId); null for the others. */
export function botOf(agentId: string, botId?: string): BotTagInfo | null {
  return botTagFor(index, { id: agentId, bot: botId })
}

/** Runs `fn` when a bot's name, color or agent changes. Returns the function that stops it. */
export function onBotsIndex(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
