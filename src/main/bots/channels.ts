import { randomUUID } from 'node:crypto'
import {
  BOT_LIMITS,
  type AttachmentInfo,
  type AttachmentInput,
  type Bot,
  type BotRunStatus,
  type Channel,
  type ChatSettings,
  type OfficeEvent,
  type RunTrigger,
  type ThreadHit,
  type ThreadItem,
} from '@shared/types'
import {
  answerPrompt,
  askPrompt,
  channelLines,
  channelPrompt,
  floorChannelId,
  foldName,
  isFloorChannel,
  parseMentions,
  sortChannels,
} from '@shared/bots-mentions'
import { buildMessage } from '../attachments'
import { log } from '../log'
import { channelName, type CleanChannelDraft } from './channels-validate'
import type { Route, RouteFn } from './router'
import type { BotRunner, RunStart } from './runner'

// Chat dos bots, canais (CB-17 a CB-19): os canais de cada andar, a mensagem do jogador que vai para
// quem foi mencionado (ou para quem o roteador escolheu), o "trocar" e o que os bots fazem nos canais
// pelas ferramentas chat_post e bot_ask. O ChannelService não fala com o agente: ele entrega a
// mensagem ao BotRunner (ChannelRunHost.send) com o gatilho do canal, e o runner grava a rodada no
// fio do canal. Docs: docs/prd/chat-de-bots.md ("Canais", "Segurança").

type UserItem = Extract<ThreadItem, { kind: 'user' }>
type SideItem = Extract<ThreadItem, { kind: 'side' }>

/** One thread, as the ThreadStore keeps it (ThreadFile fits). */
export interface ThreadLike {
  all(): ThreadItem[]
  get(id: string): ThreadItem | undefined
  put(item: ThreadItem): void
  search(query: string, limit?: number): ThreadItem[]
}

/** What the service needs from the BotStore: the bots, the channels (assigning saves) and the threads. */
export interface ChannelStore {
  channels: Channel[]
  readonly bots: Bot[]
  bot(id: string): Bot | undefined
  thread(threadId: string): ThreadLike
  /** Deletes a thread's file (a channel's jsonl). */
  removeFolder(threadId: string): void
}

/** A bot's run ended (BotRunner's run:end), after it left the runner's active runs. */
export interface RunEndEvent {
  botId: string
  runId: string
  /** Where the run sat: a channel id or the bot's own id. */
  threadId: string
  status: BotRunStatus
  /** The reply bubble's text, when the run ended fine. */
  text?: string
  trigger?: RunTrigger
}

/** What the service needs from the BotRunner (runnerHost below adapts it). */
export interface ChannelRunHost {
  /**
   * BotRunner.send: a run with `trigger`, whose items (the run line, approvals, the reply bubble)
   * land in `opts.threadId` (a channel id, or the bot's own id), with no user line. A busy bot or
   * one past its daily cap skips it with a notice in that thread ({ skipped }).
   */
  send(
    botId: string,
    text: string,
    attachments: AttachmentInput[],
    trigger: RunTrigger,
    opts: { threadId: string; showUser: false },
  ): Promise<RunStart>
  onRunEnd(listener: (e: RunEndEvent) => void): void
  /** The thread of the bot's run in progress (a channel id or its own id); undefined when idle. */
  activeThread(botId: string): string | undefined
}

/** The BotRunner as the service's host: run:end, and the thread of a bot's run in progress (from Bot.runs). */
export function runnerHost(runner: Pick<BotRunner, 'send' | 'activeRun' | 'on'>, bot: (id: string) => Bot | undefined): ChannelRunHost {
  return {
    send: (botId, text, attachments, trigger, opts) => runner.send(botId, text, attachments, trigger, opts),
    onRunEnd: (listener) => void runner.on('run:end', listener),
    activeThread: (botId) => {
      const run = runner.activeRun(botId)
      if (!run) return undefined
      return bot(botId)?.runs.find((r) => r.id === run.runId)?.threadId ?? botId
    },
  }
}

export interface ChannelDeps {
  store: ChannelStore
  host: ChannelRunHost
  /** The router (router.ts makeRouter), or a fake. */
  route: RouteFn
  /** 'terreo' and the project floors, with their names. */
  floors(): { id: string; name: string }[]
  chat(): Partial<Pick<ChatSettings, 'maxEventRunsPerHour'>>
  /** 'channels' and 'bot:item' for the renderer. */
  broadcast(e: OfficeEvent): void
  /** What the thread keeps of the files; buildMessage's check by default (it throws a message when a file can't go). */
  attachmentInfos?(attachments: AttachmentInput[]): AttachmentInfo[]
  now?(): number
}

/** A message on its way to a bot; it waits in the outbox while the bot is in another run. */
interface Delivery {
  text: string
  attachments: AttachmentInput[]
  trigger: RunTrigger
  threadId: string
  /** The ask chain depth of the run it starts. */
  depth: number
  started?(runId: string | undefined): void
  failed(message: string): void
  /** The runner skipped it (busy, daily cap) and told so in `threadId`. */
  skipped?(why: string): void
}

/** A bot_ask whose answer has not come yet. */
interface Ask {
  sideId: string
  channelId: string
  fromId: string
  toId: string
  /** The asked bot's run depth (the asker's + 1). */
  depth: number
  /** Where the asker's answer run goes: the thread of the run it asked from. */
  origin: string
  sent: boolean
  runId?: string
}

/** @mentions answered per message; the rest are told to write again. */
const MAX_MENTIONS = 4
/** Messages waiting per busy bot. */
const OUTBOX_MAX = 10
/** Posts of chat_post per bot per hour. */
const POSTS_PER_HOUR = BOT_LIMITS.perHourMax
const POST_MAX = 8000
const QUESTION_MAX = 4000
const ANSWER_MAX = 4000
const HOUR = 3_600_000
/** Attachments kept for "trocar" (posts, newest). */
const FILES_KEPT = 20

const clip = (text: string, max: number) => {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const hashName = (c: Channel) => `#${c.name}`

/** The bot a tool named: by id or whole name first, else the one whose name starts that way (as an @mention). */
function pickBot(ref: string, list: readonly Bot[]): Bot | undefined {
  const want = foldName(ref)
  const exact = list.find((b) => b.id === ref || foldName(b.name) === want)
  if (exact || !want) return exact
  const ids = parseMentions(`@${ref}`, list)
  return ids.length === 1 ? list.find((b) => b.id === ids[0]) : undefined
}

export class ChannelService {
  private now: () => number
  /** itemId -> the files of that post, for "trocar" (memory only). */
  private files = new Map<string, AttachmentInput[]>()
  /** botId -> deliveries waiting for its run in progress to end. */
  private outbox = new Map<string, Delivery[]>()
  /** botId -> the ask chain depth of its run in progress (missing = 0). */
  private depth = new Map<string, { d: number; runId?: string }>()
  /** sideItemId -> the question waiting for its answer. */
  private asks = new Map<string, Ask>()
  private askTimes = new Map<string, number[]>()
  private postTimes = new Map<string, number[]>()
  private work = new Set<Promise<void>>()

  constructor(private d: ChannelDeps) {
    this.now = d.now ?? (() => Date.now())
    d.host.onRunEnd((e) => this.onRunEnd(e))
  }

  // ---------- reads ----------

  /** Every channel, after the floors' channels and the members are brought up to date. */
  list(): Channel[] {
    this.sync()
    return sortChannels(this.d.store.channels)
  }

  channel(id: string): Channel | undefined {
    return this.d.store.channels.find((c) => c.id === id)
  }

  has(id: string): boolean {
    return !!this.channel(id)
  }

  /** The channel's members that exist now and live on its floor. */
  members(c: Channel): Bot[] {
    return c.members.map((id) => this.d.store.bot(id)).filter((b): b is Bot => !!b && b.floor === c.floor)
  }

  /** The channels the bot belongs to. */
  channelsOf(botId: string): Channel[] {
    const bot = this.d.store.bot(botId)
    if (!bot) return []
    return sortChannels(this.d.store.channels.filter((c) => c.floor === bot.floor && c.members.includes(botId)))
  }

  /** The bot's channels and who else is in each, for the office server's instructions. */
  channelSummary(botId: string): { name: string; members: string[] }[] {
    return this.channelsOf(botId).map((c) => ({
      name: c.name,
      members: this.members(c)
        .filter((b) => b.id !== botId)
        .map((b) => b.name),
    }))
  }

  /** Search in the channels of a floor (or all): the hits, newest first. */
  search(query: string, floor?: string, limit = 50): ThreadHit[] {
    const hits: ThreadHit[] = []
    for (const c of this.d.store.channels) {
      if (floor && c.floor !== floor) continue
      for (const item of this.d.store.thread(c.id).search(query, limit)) hits.push({ threadId: c.id, item })
    }
    return hits.sort((a, b) => b.item.t - a.item.t).slice(0, limit)
  }

  // ---------- the channels ----------

  /**
   * Brings the channels up to date with the bots: each floor with bots gets its own channel (named
   * after the floor, with the floor's bots); bots made after the floor's channel was last edited
   * join it; members that are gone or moved to another floor leave. Broadcasts when it changed.
   */
  sync(): boolean {
    const { store } = this.d
    const floors = this.d.floors()
    let changed = false
    const list = store.channels.map((c) => {
      const members = c.members.filter((id, i) => store.bot(id)?.floor === c.floor && c.members.indexOf(id) === i)
      if (isFloorChannel(c)) {
        for (const b of store.bots) if (b.floor === c.floor && b.createdAt > c.updatedAt && !members.includes(b.id)) members.push(b.id)
      }
      if (members.length === c.members.length && members.every((m, i) => m === c.members[i])) return c
      changed = true
      return { ...c, members }
    })
    const now = this.now()
    for (const f of floors) {
      const id = floorChannelId(f.id)
      const bots = store.bots.filter((b) => b.floor === f.id)
      if (!bots.length || list.some((c) => c.id === id) || list.length >= BOT_LIMITS.channels) continue
      const base = channelName(f.name) || 'geral'
      const taken = (n: string) => list.some((c) => c.floor === f.id && c.name === n)
      let name = base
      for (let k = 2; taken(name); k++) name = `${base.slice(0, BOT_LIMITS.channelName - 3)}-${k}`
      list.push({
        id,
        name,
        floor: f.id,
        topic: `Conversa geral do andar ${f.name}.`,
        members: bots.map((b) => b.id),
        createdAt: now,
        updatedAt: now,
        lastReadAt: 0,
        order: 0,
      })
      changed = true
      log.info(`[canais] canal do andar ${f.id} criado com ${bots.length} bots`)
    }
    // questions and messages for bots that are gone
    for (const ask of [...this.asks.values()]) if (!store.bot(ask.fromId) || !store.bot(ask.toId)) this.fail(ask)
    for (const id of [...this.outbox.keys()]) if (!store.bot(id)) this.outbox.delete(id)
    if (changed) {
      store.channels = list
      this.changed()
    }
    return changed
  }

  /** The bots changed (saved, moved, deleted): the channels follow. */
  botsChanged(): void {
    this.sync()
  }

  /** Creates (no id) or edits a channel; the draft came through cleanChannelDraft. */
  save(draft: CleanChannelDraft): Channel {
    const { store } = this.d
    const now = this.now()
    const list = store.channels
    let saved: Channel
    if (draft.id) {
      const old = list.find((c) => c.id === draft.id)
      if (!old) throw new Error('Esse canal não existe mais. Ele pode ter sido apagado em outra janela.')
      saved = { ...old, name: draft.name, topic: draft.topic, members: draft.members, updatedAt: now }
      store.channels = list.map((c) => (c.id === old.id ? saved : c))
    } else {
      const order = list.filter((c) => c.floor === draft.floor).reduce((m, c) => Math.max(m, c.order), 0) + 1
      saved = {
        id: `canal-${randomUUID()}`,
        name: draft.name,
        floor: draft.floor,
        topic: draft.topic,
        members: draft.members,
        createdAt: now,
        updatedAt: now,
        lastReadAt: now,
        order,
      }
      store.channels = [...list, saved]
    }
    log.info(`[canais] canal ${saved.id} ${draft.id ? 'editado' : 'criado'} com ${saved.members.length} membros`)
    this.changed()
    return saved
  }

  /** Deletes a channel and its thread. The floor's own channel stays while the floor exists. */
  remove(id: string): void {
    const { store } = this.d
    const c = this.must(id)
    if (isFloorChannel(c) && this.d.floors().some((f) => f.id === c.floor)) {
      throw new Error(`${hashName(c)} é o canal do andar e não pode ser apagado. Para tirar um bot dele, edite os membros.`)
    }
    for (const ask of [...this.asks.values()]) if (ask.channelId === id) this.asks.delete(ask.sideId)
    store.channels = store.channels.filter((x) => x.id !== id)
    store.removeFolder(id)
    log.info(`[canais] canal ${id} apagado`)
    this.changed()
  }

  /** The player read the channel up to `at`. */
  markRead(id: string, at: number): boolean {
    const c = this.channel(id)
    if (!c) return false
    if (c.lastReadAt === at) return true
    // updatedAt stays: it is when the player last edited the channel (see sync)
    this.d.store.channels = this.d.store.channels.map((x) => (x.id === id ? { ...x, lastReadAt: at } : x))
    this.changed()
    return true
  }

  // ---------- the player writes ----------

  /**
   * The player wrote in the channel. The message shows at once; then the @mentioned members, or
   * the ones the router picks, get it with the topic and the last messages. Resolves once the
   * message is in the thread: the routing and the runs go on in the background (idle() waits).
   */
  async post(channelId: string, text: string, attachments: AttachmentInput[] = []): Promise<void> {
    this.must(channelId)
    this.sync()
    const c = this.must(channelId)
    if (!this.members(c).length) throw new Error(`${hashName(c)} não tem bots. Edite o canal e escolha os membros.`)
    const infos = attachments.length ? this.infos(attachments) : []
    const item: UserItem = { id: randomUUID(), t: this.now(), kind: 'user', text, ...(infos.length ? { attachments: infos } : {}) }
    const before = this.d.store.thread(c.id).all()
    this.put(c.id, item)
    if (attachments.length) this.keepFiles(item.id, attachments)
    log.info(`[canais] mensagem em ${c.id}: ${text.length} caracteres, ${attachments.length} anexos`)
    this.track(this.dispatch(c, item, attachments, before))
  }

  /** "→ Bot · trocar": the message goes to this member instead. */
  async reroute(channelId: string, itemId: string, botId: string): Promise<void> {
    const c = this.must(channelId)
    const thread = this.d.store.thread(c.id)
    const item = thread.get(itemId)
    if (!item || item.kind !== 'user') throw new Error('Essa mensagem não está mais no canal.')
    const bot = this.members(c).find((b) => b.id === botId)
    if (!bot) throw new Error(`Esse bot não é membro de ${hashName(c)}. Edite o canal para incluí-lo.`)
    if (item.to?.length === 1 && item.to[0] === botId) throw new Error(`A mensagem já foi para ${bot.name}.`)
    const all = thread.all()
    const before = all.slice(
      0,
      Math.max(
        0,
        all.findIndex((x) => x.id === itemId),
      ),
    )
    const next: UserItem = { ...item, to: [botId], route: { by: 'player' } }
    this.put(c.id, next)
    const files = this.files.get(itemId) ?? []
    if ((item.attachments?.length ?? 0) > files.length) {
      this.notice(
        c.id,
        `Os anexos dessa mensagem não vão para ${bot.name}: o app reiniciou depois que ela foi enviada. Anexe de novo se ele precisar.`,
        'info',
      )
    }
    log.info(`[canais] mensagem ${itemId} de ${c.id} trocada para ${botId}`)
    this.track(this.toMember(c, next, bot, 'player', files, before))
  }

  private async dispatch(c: Channel, item: UserItem, attachments: AttachmentInput[], before: ThreadItem[]): Promise<void> {
    const members = this.members(c)
    const mentioned = parseMentions(item.text, members)
    let route: Route
    let by: 'mention' | 'router' = 'mention'
    let trouble = ''
    if (mentioned.length) route = { bots: mentioned.slice(0, MAX_MENTIONS), why: '' }
    else {
      by = 'router'
      try {
        route = await this.d.route({ channel: c, members, items: before, names: this.names(), message: item.text })
      } catch (err) {
        route = { bots: [], why: '' }
        trouble = `Não consegui escolher quem responde (${clip(errText(err), 200)}).`
        log.warn(`[canais] roteador falhou em ${c.id}`)
      }
    }
    // the router's answer stays among the members, whatever it said
    const to = route.bots.filter((id) => members.some((b) => b.id === id))
    this.put(c.id, { ...item, to, route: { by, ...(route.why ? { why: route.why } : {}) } })
    if (!to.length) {
      const names = members.map((b) => b.name).join(', ')
      const why = trouble || `Ninguém em ${hashName(c)} parece ser quem responde a isso.`
      this.notice(c.id, `Para quem é? ${why} Use "escolher" na sua mensagem ou escreva @ e o nome: ${names}.`, trouble ? 'warn' : 'info')
      return
    }
    if (mentioned.length > MAX_MENTIONS) {
      this.notice(c.id, `Mandei para os ${MAX_MENTIONS} primeiros mencionados. Chame os outros numa mensagem à parte.`, 'info')
    }
    await Promise.all(to.map((id) => this.toMember(c, item, this.d.store.bot(id)!, by, attachments, before)))
  }

  /** One member gets the player's message with the channel's topic and last messages. */
  private async toMember(
    c: Channel,
    item: UserItem,
    bot: Bot,
    by: 'mention' | 'router' | 'player',
    attachments: AttachmentInput[],
    before: readonly ThreadItem[],
  ): Promise<void> {
    const text = channelPrompt({
      channel: c,
      me: bot,
      members: this.members(c),
      recent: channelLines(before, this.names()),
      message: item.text,
      attachments: attachments.length,
      at: item.t,
      by,
    })
    await this.deliver(bot.id, {
      text,
      attachments,
      trigger: { kind: 'channel', channelId: c.id },
      threadId: c.id,
      depth: 0,
      failed: (msg) => this.notice(c.id, `${bot.name} não recebeu a mensagem: ${msg}`, 'error'),
    })
  }

  // ---------- the bots' tools (mcp-channels.ts) ----------

  /** chat_post: the bot writes in a channel it belongs to. */
  botPost(botId: string, channelRef: string, text: string): string {
    const bot = this.mustBot(botId)
    const c = this.resolveChannel(botId, channelRef, this.channelsOf(botId))
    const body = clip(text, POST_MAX)
    if (!body) throw new Error('Escreva o texto da mensagem.')
    this.limit(
      this.postTimes,
      botId,
      POSTS_PER_HOUR,
      `Você já postou ${POSTS_PER_HOUR} vezes na última hora, o limite. Junte o que falta numa mensagem só, mais tarde.`,
    )
    this.put(c.id, { id: randomUUID(), t: this.now(), kind: 'bot', botId: bot.id, text: body })
    log.info(`[canais] ${botId} postou em ${c.id}: ${body.length} caracteres`)
    return `Postei em ${hashName(c)}.`
  }

  /**
   * bot_ask: the bot asks another member of a channel they share. Returns at once; the question
   * shows in the channel folded, goes to the other bot (trigger 'ask', in its own thread), and
   * its answer comes back to the asker as a new message. Never itself; chains stop at
   * BOT_LIMITS.chainDepth; at most chat.maxEventRunsPerHour questions per bot per hour.
   */
  botAsk(fromId: string, toRef: string, question: string, channelRef?: string): string {
    const from = this.mustBot(fromId)
    const mine = this.channelsOf(fromId)
    if (!mine.length) throw new Error('Você não está em nenhum canal: bot_ask só pergunta a bots que dividem um canal com você.')
    const peers = new Map<string, Bot>()
    for (const c of mine) for (const b of this.members(c)) if (b.id !== fromId) peers.set(b.id, b)
    const peerNames = [...peers.values()].map((b) => b.name).join(', ') || 'nenhum'
    const ref = toRef.trim().replace(/^@/, '')
    const to = pickBot(ref, [from, ...peers.values()])
    if (to?.id === fromId) throw new Error('Você não pode perguntar a si mesmo. Pergunte a outro membro do canal, ou ao usuário.')
    if (!to) {
      if (pickBot(ref, this.d.store.bots)) throw new Error(`Você só pode perguntar a bots dos seus canais: ${peerNames}.`)
      throw new Error(`Não achei "${clip(ref, 60)}" nos seus canais. Membros que você pode chamar: ${peerNames}.`)
    }
    const shared = mine.filter((c) => c.members.includes(to.id))
    const current = this.d.host.activeThread(fromId)
    const c = channelRef?.trim()
      ? this.resolveChannel(
          fromId,
          channelRef,
          shared,
          `${to.name} não está nesse canal. Canais que vocês dividem: ${shared.map(hashName).join(', ')}.`,
        )
      : (shared.find((x) => x.id === current) ?? shared[0])
    const q = clip(question, QUESTION_MAX)
    if (!q) throw new Error('Escreva a pergunta.')
    const depth = (this.depth.get(fromId)?.d ?? 0) + 1
    if (depth >= BOT_LIMITS.chainDepth) {
      throw new Error(
        'Esta conversa entre bots já tem elos demais e para aqui, para não virar um laço. Resolva com o que você tem ou pergunte ao usuário.',
      )
    }
    const perHour = Math.min(BOT_LIMITS.perHourMax, Math.max(1, this.d.chat().maxEventRunsPerHour || BOT_LIMITS.perHourDefault))
    this.limit(
      this.askTimes,
      fromId,
      perHour,
      `Você já fez ${perHour} perguntas a outros bots na última hora, o limite. Resolva com o que você tem ou pergunte ao usuário.`,
    )
    const at = this.now()
    const side: SideItem = {
      id: `pergunta-${randomUUID()}`,
      t: at,
      kind: 'side',
      fromBotId: fromId,
      toBotId: to.id,
      question: q,
      status: 'asked',
    }
    this.put(c.id, side)
    // the asker's answer goes back to where it asked from: this channel, or its own thread
    const origin = current && (current === fromId || this.channelsOf(fromId).some((x) => x.id === current)) ? current : c.id
    const ask: Ask = { sideId: side.id, channelId: c.id, fromId, toId: to.id, depth, origin, sent: false }
    this.asks.set(side.id, ask)
    log.info(`[canais] ${fromId} perguntou a ${to.id} em ${c.id} (elo ${depth})`)
    this.track(
      this.deliver(to.id, {
        text: askPrompt({ from, channel: c, question: q, at }),
        attachments: [],
        trigger: { kind: 'ask', fromBotId: fromId },
        threadId: to.id,
        depth,
        started: (runId) => {
          ask.sent = true
          ask.runId = runId
        },
        failed: (msg) => {
          this.fail(ask)
          this.notice(c.id, `${to.name} não recebeu a pergunta de ${from.name}: ${msg}`, 'error')
        },
        // the runner's notice went to the asked bot's own thread: the channel hears it too
        skipped: (why) => {
          this.fail(ask)
          this.notice(c.id, `${to.name} não recebeu a pergunta de ${from.name}: ${why}`, 'warn')
        },
      }),
    )
    return `Perguntei ao ${to.name}; a resposta chega como mensagem nova.`
  }

  // ---------- runs ending ----------

  private onRunEnd(e: RunEndEvent): void {
    for (const ask of [...this.asks.values()]) {
      if (!ask.sent || ask.toId !== e.botId) continue
      const mine = ask.runId ? ask.runId === e.runId : !e.trigger || (e.trigger.kind === 'ask' && e.trigger.fromBotId === ask.fromId)
      if (mine) {
        this.answer(ask, e)
        break
      }
    }
    const d = this.depth.get(e.botId)
    if (d && (!d.runId || d.runId === e.runId)) this.depth.delete(e.botId)
    // the next message waiting for this bot goes once the runner is done with this one
    void Promise.resolve().then(() => this.flush(e.botId))
  }

  private answer(ask: Ask, e: RunEndEvent): void {
    this.asks.delete(ask.sideId)
    const text = e.text?.trim() ?? ''
    const side = this.d.store.thread(ask.channelId).get(ask.sideId)
    if (e.status !== 'ok' || !text) {
      if (side?.kind === 'side') this.put(ask.channelId, { ...side, status: 'failed' })
      return
    }
    if (side?.kind === 'side') this.put(ask.channelId, { ...side, status: 'answered', answer: clip(text, ANSWER_MAX) })
    const from = this.d.store.bot(ask.toId)
    const asker = this.d.store.bot(ask.fromId)
    if (!from || !asker) return
    const origin = ask.origin === asker.id || this.channelsOf(asker.id).some((c) => c.id === ask.origin) ? ask.origin : asker.id
    this.track(
      this.deliver(asker.id, {
        text: answerPrompt(from, clip(text, ANSWER_MAX)),
        attachments: [],
        trigger: { kind: 'ask', fromBotId: from.id },
        threadId: origin,
        depth: Math.max(0, ask.depth - 1),
        failed: (msg) => this.notice(ask.channelId, `${asker.name} não recebeu a resposta de ${from.name}: ${msg}`, 'error'),
      }),
    )
  }

  private fail(ask: Ask): void {
    this.asks.delete(ask.sideId)
    const side = this.channel(ask.channelId) ? this.d.store.thread(ask.channelId).get(ask.sideId) : undefined
    if (side?.kind === 'side' && side.status === 'asked') this.put(ask.channelId, { ...side, status: 'failed' })
  }

  // ---------- delivering to a bot ----------

  /** Sends now, or waits in the bot's outbox while it is in another run. */
  private async deliver(botId: string, d: Delivery): Promise<void> {
    if (this.d.host.activeThread(botId) !== undefined) {
      const q = this.outbox.get(botId) ?? []
      if (q.length >= OUTBOX_MAX) return d.failed('ele tem mensagens demais esperando. Espere a rodada atual terminar.')
      q.push(d)
      this.outbox.set(botId, q)
      return
    }
    await this.start(botId, d)
  }

  private async start(botId: string, d: Delivery): Promise<void> {
    const keep: { d: number; runId?: string } | undefined = d.depth > 0 ? { d: d.depth } : undefined
    if (keep) this.depth.set(botId, keep)
    try {
      const r = await this.d.host.send(botId, d.text, d.attachments, d.trigger, { threadId: d.threadId, showUser: false })
      if ('skipped' in r) {
        if (keep && this.depth.get(botId) === keep) this.depth.delete(botId)
        d.skipped?.(clip(r.skipped, 300))
        return
      }
      const runId = r.queued ? undefined : r.runId
      if (keep && runId && this.depth.get(botId) === keep) keep.runId = runId
      d.started?.(runId)
    } catch (err) {
      if (keep && this.depth.get(botId) === keep) this.depth.delete(botId)
      d.failed(clip(errText(err), 300))
    }
  }

  private flush(botId: string): void {
    const q = this.outbox.get(botId)
    if (!q?.length || this.d.host.activeThread(botId) !== undefined) return
    const next = q.shift()!
    if (!q.length) this.outbox.delete(botId)
    this.track(this.start(botId, next))
  }

  /** Waits until every routing and delivery started so far is done (tests, quitting). */
  async idle(): Promise<void> {
    while (this.work.size) await Promise.all([...this.work])
  }

  private track(p: Promise<void>): void {
    const w = p
      .catch((err: unknown) => log.warn(`[canais] tarefa falhou: ${errText(err).slice(0, 200)}`))
      .finally(() => this.work.delete(w))
    this.work.add(w)
  }

  // ---------- helpers ----------

  private must(id: string): Channel {
    const c = this.channel(id)
    if (!c) throw new Error('Esse canal não existe mais. Ele pode ter sido apagado em outra janela.')
    return c
  }

  private mustBot(id: string): Bot {
    const b = this.d.store.bot(id)
    if (!b) throw new Error('Este bot não existe mais.')
    return b
  }

  /** A channel the bot named (id, or name with or without #), among `allowed`. */
  private resolveChannel(botId: string, ref: string, allowed: Channel[], notAllowed?: string): Channel {
    const want = channelName(ref)
    const named = (c: Channel) => c.id === ref.trim() || (!!want && c.name === want)
    const hit = allowed.find(named)
    if (hit) return hit
    const list = this.channelsOf(botId).map(hashName).join(', ') || 'nenhum'
    if (this.d.store.channels.some(named)) throw new Error(notAllowed ?? `Você não é membro desse canal. Seus canais: ${list}.`)
    throw new Error(`Não achei o canal "${clip(ref, 60)}". Seus canais: ${list}.`)
  }

  /** Counts one more use in the last hour, or throws `message` when the cap is reached. */
  private limit(times: Map<string, number[]>, botId: string, max: number, message: string): void {
    const now = this.now()
    const recent = (times.get(botId) ?? []).filter((t) => now - t < HOUR)
    if (recent.length >= max) {
      times.set(botId, recent)
      log.info(`[canais] limite por hora de ${botId} atingido (${max})`)
      throw new Error(message)
    }
    times.set(botId, [...recent, now])
  }

  private infos(attachments: AttachmentInput[]): AttachmentInfo[] {
    return this.d.attachmentInfos ? this.d.attachmentInfos(attachments) : buildMessage('', attachments).infos
  }

  private keepFiles(itemId: string, attachments: AttachmentInput[]): void {
    this.files.set(itemId, attachments)
    while (this.files.size > FILES_KEPT) this.files.delete(this.files.keys().next().value!)
  }

  private names(): Record<string, string> {
    return Object.fromEntries(this.d.store.bots.map((b) => [b.id, b.name]))
  }

  private notice(threadId: string, text: string, tone: 'info' | 'warn' | 'error'): void {
    this.put(threadId, { id: randomUUID(), t: this.now(), kind: 'notice', text, tone })
  }

  private put(threadId: string, item: ThreadItem): void {
    this.d.store.thread(threadId).put(item)
    this.d.broadcast({ type: 'bot:item', threadId, item })
  }

  private changed(): void {
    this.d.broadcast({ type: 'channels', channels: sortChannels(this.d.store.channels) })
  }
}
