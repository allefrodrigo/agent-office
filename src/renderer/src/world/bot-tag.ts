import { BOT_COLORS, type Bot } from '@shared/types'

// A etiqueta "bot" no nome do agente (as duas vistas): quem é bot e em que cor. Puro, para o
// índice do Chat (ui/chat/bots-index.ts) e os testes. Spec: docs/prd/chat-de-bots.md, "No escritório".

/** What the name tag needs from a bot. */
export interface BotTagInfo {
  id: string
  name: string
  /** One of BOT_COLORS (the chip's background and the account diamond). */
  color: string
}

export interface BotIndex {
  /** Changes only when something the tag shows changes (not on every new message). */
  key: string
  byId: Map<string, BotTagInfo>
  /** Bot.agentId → Bot.id. */
  byAgent: Map<string, string>
}

const PALETTE = new Set<string>(BOT_COLORS)

/** The bot's color if it is one of BOT_COLORS (their contrast is checked); the first one otherwise. */
export function botColor(color: string | undefined): string {
  const c = color?.toLowerCase()
  return c && PALETTE.has(c) ? c : BOT_COLORS[0]
}

/** Indexes the bots by id and by the agent running them. */
export function indexBots(bots: readonly Pick<Bot, 'id' | 'name' | 'color' | 'agentId'>[]): BotIndex {
  const byId = new Map<string, BotTagInfo>()
  const byAgent = new Map<string, string>()
  const parts: string[] = []
  for (const b of bots) {
    const info = { id: b.id, name: b.name, color: botColor(b.color) }
    byId.set(b.id, info)
    if (b.agentId) byAgent.set(b.agentId, b.id)
    parts.push(`${b.id}\u0000${b.name}\u0000${info.color}\u0000${b.agentId ?? ''}`)
  }
  return { key: parts.join('\u0001'), byId, byAgent }
}

/**
 * The bot behind an agent: `AgentSummary.bot` first, then the bot that names the agent as its
 * own. An agent of a bot the list does not have yet still gets the tag, in the first color.
 */
export function botTagFor(index: BotIndex, agent: { id: string; bot?: string }): BotTagInfo | null {
  const id = agent.bot || index.byAgent.get(agent.id)
  if (!id) return null
  return index.byId.get(id) ?? { id, name: '', color: BOT_COLORS[0] }
}

/** The chip's tooltip and accessible name. */
export function botTagTitle(info: BotTagInfo): string {
  return info.name ? `Bot ${info.name}: abrir a conversa no Chat` : 'Bot: abrir a conversa no Chat'
}
