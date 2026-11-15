import { randomUUID } from 'node:crypto'
import { BOT_LIMITS, type Bot, type BotSpend, type Channel, type OfficeEvent, type Settings, type ThreadHit, type ThreadPage } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { looksLikeSecret } from '@shared/bots'
import {
  attachmentsSchema,
  botConfigureSchema,
  botMemorySchema,
  botSearchFloorSchema,
  botSearchQuerySchema,
  cleanBotDraft,
  cleanBotFlags,
  cleanThreadId,
  markReadAtSchema,
  messageSchema,
  parse,
  threadPageSchema,
} from '../validate'
import type { BotRunner } from './runner'
import type { BotStore } from './store'

export interface BotsApiDeps {
  store: BotStore
  runner: BotRunner
  settings(): Pick<Settings, 'projects' | 'accounts'>
  broadcast(e: OfficeEvent): void
  /** After a delete: the bot's routines and event automations go too (phase 2). */
  onDeleted?(botId: string): void
  now?: () => number
}

/** Hits of the sidebar's search, newest first, across threads. */
const SEARCH_MAX = 100

/**
 * The Chat's OfficeAPI methods (CB-07), one per name, as ipc/bots.ts registers them. Every
 * argument comes from the renderer and is cleaned by validate.ts here; errors are pt-BR
 * messages the screen can show as they are.
 */
export function botsApi(d: BotsApiDeps) {
  const { store, runner } = d
  const now = d.now ?? (() => Date.now())
  const must = (raw: unknown): Bot => {
    const bot = store.bot(cleanThreadId(raw))
    if (!bot) throw new Error('Esse bot não existe mais. Ele pode ter sido apagado em outra janela.')
    return bot
  }
  const channelOf = (id: string): Channel | undefined => store.channels.find((c) => c.id === id)
  /** A bot's or a channel's thread id that exists. */
  const threadOf = (raw: unknown): string => {
    const id = cleanThreadId(raw)
    if (!store.bot(id) && !channelOf(id)) throw new Error('Essa conversa não existe mais.')
    return id
  }
  const roomFor = () => {
    if (store.bots.filter((b) => !b.demo).length >= BOT_LIMITS.count) throw new Error(`Limite de ${BOT_LIMITS.count} bots atingido. Apague algum antes de criar outro.`)
  }
  const nextOrder = () => Math.max(0, ...store.bots.map((b) => b.order)) + 1

  return {
    listBots: (): Bot[] => runner.list(),

    /** Creates (no id, or an unknown one) or replaces a bot. */
    saveBot: (raw: unknown): Bot => {
      const draft = cleanBotDraft(raw, { settings: d.settings() })
      const before = draft.id ? store.bot(draft.id) : undefined
      const at = now()
      const { schedule: _schedule, id: _id, ...fields } = draft
      if (!before) {
        roomFor()
        const id = randomUUID()
        const bot: Bot = {
          ...fields,
          id,
          look: draft.look ?? lookFromSeed(`bot:${id}`),
          pinned: false,
          hidden: false,
          order: nextOrder(),
          createdAt: at,
          updatedAt: at,
          lastReadAt: at,
          runs: [],
        }
        store.bots = [...store.bots, bot]
        runner.changed()
        return runner.view(bot)
      }
      const bot: Bot = {
        ...before,
        ...fields,
        look: draft.look ?? before.look,
        // Fields the form does not send stay as they were, or go when the draft dropped them.
        model: draft.model,
        effort: draft.effort,
        accounts: draft.accounts,
        cwd: draft.cwd,
        templateId: draft.templateId ?? before.templateId,
        updatedAt: at,
      }
      for (const k of ['model', 'effort', 'accounts', 'cwd', 'templateId'] as const) if (bot[k] === undefined) delete bot[k]
      store.update(bot)
      runner.updated(before, bot)
      return runner.view(bot)
    },

    /** Deletes the bot, its folder (thread, memory) and its event automations; its agent leaves. */
    deleteBot: (raw: unknown): void => {
      const bot = must(raw)
      runner.forget(bot.id)
      store.bots = store.bots.filter((b) => b.id !== bot.id)
      if (store.eventTriggers.some((t) => t.botId === bot.id)) {
        store.eventTriggers = store.eventTriggers.filter((t) => t.botId !== bot.id)
        d.broadcast({ type: 'botTriggers', triggers: store.eventTriggers })
      }
      if (store.channels.some((c) => c.members.includes(bot.id))) {
        store.channels = store.channels.map((c) => (c.members.includes(bot.id) ? { ...c, members: c.members.filter((m) => m !== bot.id) } : c))
        d.broadcast({ type: 'channels', channels: store.channels })
      }
      store.setWorktree(bot.id, undefined)
      if (!bot.demo) store.removeFolder(bot.id)
      runner.changed()
      d.onDeleted?.(bot.id)
    },

    /** A copy with the same job, settings and memory; no conversation, no runs. */
    duplicateBot: (raw: unknown): Bot => {
      const src = must(raw)
      roomFor()
      const at = now()
      const id = randomUUID()
      const { agentId: _agentId, sessionId: _sessionId, unread: _unread, last: _last, ...rest } = structuredClone(src)
      const copy: Bot = {
        ...rest,
        id,
        name: `${src.name} (cópia)`.slice(0, BOT_LIMITS.name),
        look: lookFromSeed(`bot:${id}`),
        pinned: false,
        hidden: false,
        order: nextOrder(),
        createdAt: at,
        updatedAt: at,
        lastReadAt: at,
        runs: [],
      }
      store.bots = [...store.bots, copy]
      const memory = store.memory(src.id)
      if (memory) store.setMemory(id, memory)
      runner.changed()
      return runner.view(copy)
    },

    setBotFlags: (raw: unknown, patch: unknown): Bot => {
      const bot = must(raw)
      const flags = cleanBotFlags(patch)
      if (flags.pinned !== undefined) bot.pinned = flags.pinned
      if (flags.hidden !== undefined) bot.hidden = flags.hidden
      if (flags.order !== undefined) bot.order = flags.order
      store.update(bot)
      runner.changed()
      return runner.view(bot)
    },

    /** Read up to `at` (now by default); an earlier time marks it unread. */
    markBotRead: (raw: unknown, at: unknown): void => {
      const id = threadOf(raw)
      const t = parse(markReadAtSchema, at, 'Hora inválida.') ?? now()
      const bot = store.bot(id)
      if (bot) {
        bot.lastReadAt = t
        store.update(bot)
        runner.changed()
        return
      }
      store.channels = store.channels.map((c) => (c.id === id ? { ...c, lastReadAt: t } : c))
      d.broadcast({ type: 'channels', channels: store.channels })
    },

    botThread: (raw: unknown, opts: unknown): ThreadPage => {
      const id = threadOf(raw)
      const o = parse(threadPageSchema, opts ?? {}, 'Página inválida da conversa.')
      return store.thread(id).page(o.before, o.limit)
    },

    /** Every word of the query, in the bots' and channels' threads of the floor (all floors without one). */
    searchBots: (rawQuery: unknown, rawFloor: unknown): ThreadHit[] => {
      const query = parse(botSearchQuerySchema, rawQuery, 'Busca inválida.')
      const floor = parse(botSearchFloorSchema, rawFloor ?? undefined, 'Andar inválido.')
      if (!query.trim()) return []
      const here = (f: string) => !floor || f === floor
      const ids = [...store.bots.filter((b) => here(b.floor)).map((b) => b.id), ...store.channels.filter((c) => here(c.floor)).map((c) => c.id)]
      const hits = ids.flatMap((threadId) => store.thread(threadId).search(query, SEARCH_MAX).map((item) => ({ threadId, item })))
      return hits.sort((a, b) => b.item.t - a.item.t).slice(0, SEARCH_MAX)
    },

    sendToBot: async (raw: unknown, text: unknown, attachments: unknown): Promise<void> => {
      const bot = must(raw)
      const body = parse(messageSchema, text, 'Mensagem grande demais. Envie o texto como anexo.')
      const files = parse(attachmentsSchema, attachments ?? [], 'Anexos inválidos. Tente anexar de novo.')
      await runner.send(bot.id, body, files)
    },

    runBotNow: (raw: unknown): Promise<void> => runner.runNow(must(raw).id),
    stopBot: (raw: unknown): Promise<void> => runner.stop(must(raw).id),
    newBotConversation: (raw: unknown): void => runner.newConversation(must(raw).id),

    configureBot: (raw: unknown, patch: unknown): Bot => {
      const bot = must(raw)
      const p = parse(botConfigureSchema, patch, 'Modelo ou esforço inválido.')
      return runner.view(runner.configure(bot.id, p))
    },

    botMemory: (raw: unknown): string => store.memory(must(raw).id),

    saveBotMemory: (raw: unknown, text: unknown): void => {
      const bot = must(raw)
      const body = parse(botMemorySchema, text, `A memória passou muito de ${Math.round(BOT_LIMITS.memoryBytes / 1024)} KB. Encurte o texto.`)
      // WARNING: memoria.md is plain text on disk and goes to the model on every run.
      if (looksLikeSecret(body)) {
        throw new Error('Isso parece uma chave, senha ou token. A memória vai para o modelo a cada rodada: guarde segredos no chaveiro do sistema ou no .env do projeto.')
      }
      store.setMemory(bot.id, body)
    },

    botSpend: (raw: unknown): BotSpend => runner.spend(must(raw).id),
  }
}

export type BotsApi = ReturnType<typeof botsApi>
