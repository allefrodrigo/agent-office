import { ipcMain } from 'electron'
import type { Bot, Channel } from '@shared/types'
import type { ChannelService } from '../bots/channels'
import { cleanChannelDraft, cleanPost, cleanRef } from '../bots/channels-validate'

// Chat dos bots, canais (CB-17): os handlers da fase 3. O fio de um canal usa os handlers dos bots
// (botThread, markBotRead, searchBots) com o id do canal. Todo argumento passa pela validação.

export interface BotChannelsIpcDeps {
  channels: Pick<ChannelService, 'list' | 'save' | 'remove' | 'post' | 'reroute'>
  /** The bots as the store keeps them (BotStore.bots). */
  bots(): readonly Pick<Bot, 'id' | 'floor'>[]
  /** 'terreo' and the project floors' ids. */
  floors(): string[]
  /** ipcMain.handle by default; the tests pass their own. */
  handle?(channel: string, listener: (e: unknown, ...args: unknown[]) => unknown): void
}

const GONE = 'Esse canal não existe mais. Ele pode ter sido apagado em outra janela.'

export function registerBotChannelsIpc(deps: BotChannelsIpcDeps): void {
  const handle = deps.handle ?? ((channel, listener) => ipcMain.handle(channel, listener))
  const { channels } = deps
  handle('office:listChannels', (): Channel[] => channels.list())
  handle('office:saveChannel', (_e, raw) =>
    channels.save(cleanChannelDraft(raw, { bots: deps.bots(), channels: channels.list(), floors: deps.floors() })),
  )
  handle('office:deleteChannel', (_e, id) => channels.remove(cleanRef(id, GONE)))
  handle('office:postToChannel', (_e, id, text, attachments) => {
    const post = cleanPost(text, attachments)
    return channels.post(cleanRef(id, GONE), post.text, post.attachments)
  })
  handle('office:rerouteChannelMessage', (_e, id, itemId, botId) =>
    channels.reroute(
      cleanRef(id, GONE),
      cleanRef(itemId, 'Essa mensagem não está mais no canal.'),
      cleanRef(botId, 'Esse bot não existe mais.'),
    ),
  )
}
