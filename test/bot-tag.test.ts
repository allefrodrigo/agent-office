import { describe, expect, it } from 'vitest'
import { BOT_COLORS } from '@shared/types'
import { botColor, botTagFor, botTagTitle, indexBots } from '../src/renderer/src/world/bot-tag'

// CB-11: a etiqueta "bot" no nome do agente, nas duas vistas.

const bot = (id: string, extra: { name?: string; color?: string; agentId?: string } = {}) => ({
  id,
  name: extra.name ?? `Bot ${id}`,
  color: extra.color ?? BOT_COLORS[1],
  agentId: extra.agentId,
})

describe('etiqueta "bot" no nome do agente', () => {
  it('acha o bot pelo AgentSummary.bot e pelo agente que o bot aponta', () => {
    const index = indexBots([bot('b1', { agentId: 'a1' }), bot('b2')])
    expect(botTagFor(index, { id: 'qualquer', bot: 'b2' })).toEqual({ id: 'b2', name: 'Bot b2', color: BOT_COLORS[1] })
    expect(botTagFor(index, { id: 'a1' })?.id).toBe('b1')
  })

  it('AgentSummary.bot ganha do agentId de outro bot', () => {
    const index = indexBots([bot('b1', { agentId: 'a1' }), bot('b2')])
    expect(botTagFor(index, { id: 'a1', bot: 'b2' })?.id).toBe('b2')
  })

  it('agente comum fica sem etiqueta', () => {
    expect(botTagFor(indexBots([bot('b1', { agentId: 'a1' })]), { id: 'a9' })).toBeNull()
    expect(botTagFor(indexBots([]), { id: 'a9', bot: '' })).toBeNull()
  })

  it('bot que a lista ainda não trouxe mostra a etiqueta na primeira cor', () => {
    expect(botTagFor(indexBots([]), { id: 'a1', bot: 'b9' })).toEqual({ id: 'b9', name: '', color: BOT_COLORS[0] })
  })

  it('aceita só as cores de BOT_COLORS (o contraste delas é conferido)', () => {
    expect(botColor(BOT_COLORS[3].toUpperCase())).toBe(BOT_COLORS[3])
    expect(botColor('#123456')).toBe(BOT_COLORS[0])
    expect(botColor('red; background: url(x)')).toBe(BOT_COLORS[0])
    expect(botColor(undefined)).toBe(BOT_COLORS[0])
    expect(indexBots([bot('b1', { color: '#000000' })]).byId.get('b1')?.color).toBe(BOT_COLORS[0])
  })

  it('a chave muda com nome, cor e agente, e só com eles', () => {
    const base = indexBots([bot('b1', { agentId: 'a1' })]).key
    expect(indexBots([bot('b1', { agentId: 'a1' })]).key).toBe(base)
    expect(indexBots([{ ...bot('b1', { agentId: 'a1' }), unread: 3 } as ReturnType<typeof bot>]).key).toBe(base)
    expect(indexBots([bot('b1', { agentId: 'a1', name: 'Outro' })]).key).not.toBe(base)
    expect(indexBots([bot('b1', { agentId: 'a1', color: BOT_COLORS[2] })]).key).not.toBe(base)
    expect(indexBots([bot('b1')]).key).not.toBe(base)
  })

  it('o título diz o que o clique faz', () => {
    expect(botTagTitle({ id: 'b1', name: 'Chefe de gabinete', color: BOT_COLORS[0] })).toBe(
      'Bot Chefe de gabinete: abrir a conversa no Chat',
    )
    expect(botTagTitle({ id: 'b1', name: '', color: BOT_COLORS[0] })).toBe('Bot: abrir a conversa no Chat')
  })
})
