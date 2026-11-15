import './chat.css'
import { botsOnFloor, snippet, sortBots, threadMarkdown } from '@shared/bots-view'
import { exportFileName } from '@shared/export-md'
import { BOT_LIMITS, type Bot, type Channel, type ThreadItem } from '@shared/types'
import type { State } from '../../state'
import { announce, modalA11y } from '../a11y'
import { h, icon } from '../dom'
import { saveMarkdown } from '../export'
import { confirmDialog, modal } from '../modals'
import { OPEN_AGENT_EVENT, openAgentPanel } from '../meetings/office'
import { entryView } from '../panel/entries'
import { channelForm, deleteChannel } from './channels/form'
import { ChannelHeader } from './channels/header'
import { channelStore } from './channels/store'
import { ChatHeader } from './header'
import { closeMenu } from './menu'
import { botForm, botGallery } from './new-bot'
import { OPEN_CHAT_EVENT, type OpenChatDetail } from './open'
import { ProfilePanel } from './profile'
import { ChatSidebar } from './sidebar'
import { chatStore } from './store'
import { Composer } from './composer'
import { ThreadView } from './thread'
import { botAgent, chatError, floorName, type Toast } from './util'

export { openChat, OPEN_CHAT_EVENT } from './open'
export { chatStore } from './store'

// Chat dos bots (CB-08 a CB-10, canais no CB-20): tela cheia no molde da sala de reunião. À
// esquerda os bots e os canais do andar, no centro o fio com a caixa de mensagem, à direita (ⓘ) o
// perfil do bot. Esc fecha; abre no último fio visto. Docs: docs/prd/chat-de-bots.md
// ("Experiência", "Canais").

/** localStorage: the last thread seen, where the Chat opens. */
const LAST_KEY = 'agent-office:chat-last'
/** localStorage: '1' when the profile panel was left open. */
const PROFILE_KEY = 'agent-office:chat-profile'
/** Reading marks the thread read after this long at the bottom. */
const READ_MS = 700
/** "Ver o log completo" shows the newest entries. */
const LOG_MAX = 400

interface Screen {
  select(id: string, itemId?: string): void
  close(): void
  /** The agent of the bot whose thread is on screen; null on the gallery, the form or an error. */
  agentId(): string | null
}

let screen: Screen | null = null

/** The Chat is on screen (for who decides whether a key is its own). */
export function chatScreenOpen(): boolean {
  return screen !== null
}

/**
 * The Chat shows this agent's thread: its requests appear there only, so the office does not
 * open the card nor tell that the agent is walking over (spec, "No escritório").
 */
export function chatShowsAgent(agentId: string): boolean {
  return screen?.agentId() === agentId
}

export interface ChatOptions {
  toast: Toast
  /** The floor on screen in the office ('terreo' or ProjectFloor.id). */
  currentFloor(): string
}

/**
 * Wires the Chat to the app, once at boot: the store starts (the "Chat" button counts unread
 * with the screen closed) and OPEN_CHAT_EVENT opens the screen (key C, the button, bot:open).
 */
export function mountChat(root: HTMLElement, state: State, opts: ChatOptions): void {
  void chatStore.start()
  window.addEventListener(OPEN_CHAT_EVENT, (e) => {
    const { threadId } = (e as CustomEvent<OpenChatDetail>).detail ?? {}
    openChatScreen(root, state, opts, typeof threadId === 'string' && threadId ? threadId : undefined)
  })
  // "Ver no escritório" opens the agent's panel under the Chat: close the Chat so it shows.
  window.addEventListener(OPEN_AGENT_EVENT, () => screen?.close())
}

type Mode = 'thread' | 'gallery' | 'form' | 'empty-floor' | 'error'

function openChatScreen(root: HTMLElement, state: State, opts: ChatOptions, threadId?: string): void {
  if (screen) {
    if (threadId) screen.select(threadId)
    return
  }
  const toast = opts.toast
  let floor = opts.currentFloor()
  let selected: string | null = null
  let mode: Mode = 'thread'
  let profileOpen = localStorage.getItem(PROFILE_KEY) === '1'
  let closed = false
  let readTimer = 0
  let frame = 0

  // selected is a Bot.id or a Channel.id (ids never collide: channels are "canal-…" or "andar-…")
  const bot = (): Bot | undefined => chatStore.bot(selected)
  const channel = (): Channel | undefined => (bot() ? undefined : channelStore.channel(selected))
  const botName = (id: string) => chatStore.bot(id)?.name ?? 'Bot removido'
  /** The channel's members that still exist, on its floor. */
  const members = (): Bot[] => {
    const c = channel()
    if (!c) return []
    const ids = new Set(c.members)
    return sortBots(chatStore.bots.filter((b) => ids.has(b.id) && b.floor === c.floor))
  }
  // ThreadView reads only the id: a channel's thread loads like a bot's
  const threadOf = (c: Channel) => ({ id: c.id }) as Bot
  const findChannel = async (id: string): Promise<Channel | undefined> => {
    await channelStore.start()
    return channelStore.channel(id)
  }

  // ---------- frame ----------
  const center = h('div', { class: 'ch-center' })
  const main = h('main', { class: 'ch-main' })
  const box = h('div', { class: 'chat-screen' })
  const el = h('div', { class: 'backdrop chat-backdrop' }, box)
  const ctx = { root: el, state, toast }

  void channelStore.start()
  const sidebar = new ChatSidebar({
    ...ctx,
    host: box,
    selected: () => selected,
    floor: () => floor,
    setFloor: (f) => setFloor(f),
    select: (id, itemId) => void select(id, itemId),
    newBot: () => void showGallery(),
    newChannel: () => showChannelForm(),
    editChannel: (id) => {
      const c = channelStore.channel(id)
      if (c) showChannelForm(c)
    },
    removed: (id) => {
      if (id === selected) pickFirst()
    },
  })
  const channelHeader = new ChannelHeader({
    ...ctx,
    host: box,
    channel,
    members,
    edit: () => {
      const c = channel()
      if (c) showChannelForm(c)
    },
    remove: () => {
      const c = channel()
      if (c)
        void deleteChannel(ctx, c).then((gone) => {
          if (gone && selected === c.id) pickFirst()
        })
    },
    markUnread: () => {
      const c = channel()
      if (!c) return
      channelStore.markUnread(c.id).then(
        () => toast(`#${c.name} fica como não lido.`, 'ok'),
        (err: unknown) => toast(chatError(err), 'err'),
      )
    },
    openBot: (id) => void select(id),
    close: () => void close(),
  })
  const header = new ChatHeader({
    ...ctx,
    host: box,
    bot,
    profileOpen: () => profileOpen && mode === 'thread',
    toggleProfile: () => setProfile(!profileOpen),
    runNow: () => void runNow(),
    newConversation: () => void newConversation(),
    showInOffice: () => showInOffice(),
    showLog: () => void showLog(),
    exportMarkdown: () => void exportMarkdown(),
    close: () => void close(),
  })
  const thread = new ThreadView({
    bot,
    botName,
    live: (requestId) => state.permissions.has(requestId),
    activity: (botId) => botAgent(state, botId ? chatStore.bot(botId) : bot())?.activity ?? '',
    channel: () => {
      const c = channel()
      if (!c || mode !== 'thread') return null
      return { id: c.id, members, bot: (id) => chatStore.bot(id), reroute: (itemId, botId) => reroute(c.id, itemId, botId), menuHost: box }
    },
    respond: async (d) => {
      try {
        await window.office.respond(d)
      } catch (err) {
        throw new Error(chatError(err), { cause: err })
      }
    },
    toast,
    onSeen: () => scheduleRead(),
    suggest: (text) => composer.sendText(text),
  })
  const composer = new Composer({
    ...ctx,
    bot,
    channel,
    members,
    onSent: () => thread.toBottom(true),
    showRequest: (requestId) => {
      const id = thread.itemForRequest(requestId)
      if (id) void thread.reveal(id)
      else toast('O cartão desse pedido ainda não chegou ao fio.')
    },
  })
  const profile = new ProfilePanel({
    ...ctx,
    reveal: (itemId) => {
      void thread.reveal(itemId).then((found) => {
        if (!found) toast('Essa rodada não está mais no fio.')
      })
    },
    close: () => setProfile(false),
  })

  main.append(header.el, channelHeader.el, center)
  box.append(sidebar.el, main, profile.el)
  modalA11y(el, box, sidebar.heading)
  root.append(el)

  // files dropped anywhere on the conversation go to the message box
  const canDrop = () => mode === 'thread' && !!(bot() || channel())
  main.addEventListener('dragover', (e) => {
    if (!canDrop() || !e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    main.classList.add('drop-target')
  })
  main.addEventListener('dragleave', (e) => {
    if (!main.contains(e.relatedTarget as Node | null)) main.classList.remove('drop-target')
  })
  main.addEventListener('drop', (e) => {
    main.classList.remove('drop-target')
    if (!canDrop() || !e.dataTransfer?.files.length) return
    e.preventDefault()
    composer.attach([...e.dataTransfer.files])
    composer.focus()
  })

  // ---------- what the center shows ----------
  function setProfile(open: boolean): void {
    profileOpen = open
    localStorage.setItem(PROFILE_KEY, open ? '1' : '0')
    syncProfile()
    renderHeader()
  }

  /** A channel's thread swaps the bot's header for the channel's. */
  function renderHeader(): void {
    const showChannel = mode === 'thread' && !!channel()
    header.el.hidden = showChannel
    channelHeader.el.hidden = !showChannel
    center.classList.toggle('is-channel', showChannel)
    if (showChannel) channelHeader.render()
    else header.render()
  }

  function syncProfile(): void {
    const show = profileOpen && mode === 'thread' && !!bot()
    profile.el.hidden = !show
    box.classList.toggle('with-profile', show)
    if (show) profile.show(bot())
  }

  function showCenter(next: Mode, ...children: HTMLElement[]): void {
    mode = next
    center.className = `ch-center mode-${next}`
    center.replaceChildren(...children)
    syncProfile()
    renderHeader()
    sidebar.render()
  }

  function showGallery(fromEmpty = false): void {
    const hasBots = chatStore.bots.length > 0
    selected = fromEmpty ? null : selected
    showCenter(
      'gallery',
      botGallery({
        pitch: !hasBots,
        onPick: (t) => showForm(t),
        onCancel: hasBots && !fromEmpty ? () => (selected ? void select(selected) : pickFirst()) : undefined,
      }),
    )
    center.querySelector<HTMLElement>('.ch-tpl')?.focus()
  }

  function showForm(t: Parameters<typeof botForm>[1]): void {
    const form = botForm(
      {
        ...ctx,
        floor: () => (floor === 'all' ? opts.currentFloor() : floor),
        saved: (b) => {
          chatStore.upsertBot(b)
          void select(b.id)
        },
        cancel: () => showGallery(!chatStore.bots.length),
      },
      t,
    )
    showCenter('form', form.el)
    form.focus()
  }

  /** "＋ Canal" or "Editar canal". */
  function showChannelForm(existing?: Channel): void {
    const back = selected
    const form = channelForm(
      {
        ...ctx,
        floor: () => floor,
        saved: (c) => void select(c.id),
        removed: () => pickFirst(),
        cancel: () => (back && (chatStore.bot(back) || channelStore.channel(back)) ? void select(back) : pickFirst()),
      },
      existing,
    )
    showCenter('form', form.el)
    form.focus()
  }

  async function reroute(channelId: string, itemId: string, botId: string): Promise<void> {
    try {
      await window.office.rerouteChannelMessage(channelId, itemId, botId)
      toast(`A mensagem foi para ${botName(botId)}.`, 'ok')
    } catch (err) {
      toast(chatError(err), 'err')
    }
  }

  function showEmptyFloor(): void {
    selected = null
    showCenter(
      'empty-floor',
      h(
        'div',
        { class: 'ch-empty ch-empty-floor' },
        h('p', { class: 'ch-empty-title' }, `Nenhum bot no andar ${floorName(state, floor)}.`),
        h('p', {}, 'Crie um aqui, ou veja os bots de todos os andares.'),
        h(
          'div',
          { class: 'ch-suggestions' },
          h(
            'button',
            { type: 'button', class: 'btn ch-btn-accent', onclick: () => showGallery() },
            icon('plus', 15),
            'Novo bot neste andar',
          ),
          h('button', { type: 'button', class: 'btn', onclick: () => setFloor('all') }, 'Todos os andares'),
        ),
      ),
    )
  }

  function showError(): void {
    selected = null
    showCenter(
      'error',
      h(
        'div',
        { class: 'ch-empty ch-error', role: 'alert' },
        h('p', { class: 'ch-empty-title' }, 'Não consegui abrir os bots.'),
        h('p', {}, chatStore.error ?? ''),
        h('button', { type: 'button', class: 'btn', onclick: () => void chatStore.reload() }, 'Tentar de novo'),
      ),
    )
  }

  /** The first bot of the floor, or the right empty state. */
  function pickFirst(): void {
    if (chatStore.error && !chatStore.bots.length) return showError()
    if (!chatStore.loaded) return showCenter('thread', h('div', { class: 'ch-empty' }, h('p', {}, 'Carregando os bots…')))
    if (!chatStore.bots.length) return showGallery(true)
    const first = sortBots(botsOnFloor(chatStore.bots, floor))[0]
    if (first) return void select(first.id)
    showEmptyFloor()
  }

  function setFloor(f: string): void {
    floor = f
    const on = bot() ?? channel()
    if (mode === 'thread' && on && (f === 'all' || on.floor === f)) return sidebar.render()
    if (mode === 'form' || mode === 'gallery') return sidebar.render()
    pickFirst()
  }

  async function select(id: string, itemId?: string): Promise<void> {
    if (closed) return
    if (id !== selected && profile.hasChanges && !(await discardProfile())) return
    await chatStore.start()
    const b = chatStore.bot(id)
    const c = b ? undefined : await findChannel(id)
    const target = b ?? c
    if (closed) return
    if (!target) {
      toast('Esse fio não existe mais.', 'err')
      return pickFirst()
    }
    if (floor !== 'all' && target.floor !== floor) floor = target.floor
    const changed = id !== selected || mode !== 'thread'
    selected = id
    localStorage.setItem(LAST_KEY, id)
    if (changed) {
      showCenter('thread', thread.el, composer.el)
      if (c) composer.setChannel(c)
      else composer.setBot(b)
      await thread.load(c ? threadOf(c) : (b as Bot))
    } else sidebar.render()
    if (closed || selected !== id) return
    if (itemId && !(await thread.reveal(itemId))) toast('Essa mensagem não está mais no fio.')
    composer.focus()
  }

  function discardProfile(): Promise<boolean> {
    return confirmDialog(el, {
      title: 'Descartar as alterações do perfil?',
      text: 'O que você mudou no perfil e não salvou vai se perder.',
      confirm: 'Descartar',
      cancel: 'Continuar editando',
      danger: true,
    })
  }

  // ---------- reading ----------
  function scheduleRead(): void {
    clearTimeout(readTimer)
    readTimer = window.setTimeout(() => {
      if (closed || mode !== 'thread' || !selected || document.visibilityState !== 'visible' || !thread.atBottom) return
      if (channel()) channelStore.markRead(selected)
      else chatStore.markRead(selected)
    }, READ_MS)
  }

  // ---------- the bot's actions ----------
  async function runNow(): Promise<void> {
    const b = bot()
    if (!b) return
    try {
      await window.office.runBotNow(b.id)
      toast(`${b.name} começou a rodar.`, 'ok')
    } catch (err) {
      toast(chatError(err), 'err')
    }
  }

  async function newConversation(): Promise<void> {
    const b = bot()
    if (!b) return
    try {
      await window.office.newBotConversation(b.id)
      toast(`A próxima mensagem começa uma conversa nova com ${b.name}. O fio continua aqui.`, 'ok')
    } catch (err) {
      toast(chatError(err), 'err')
    }
  }

  function showInOffice(): void {
    const b = bot()
    const a = botAgent(state, b)
    if (!b) return
    if (!a) return toast(`${b.name} não está no escritório agora. Mande uma mensagem ou use Rodar agora e ele volta.`)
    openAgentPanel(a.id)
  }

  async function showLog(): Promise<void> {
    const b = bot()
    const a = botAgent(state, b)
    if (!b) return
    if (!a) return toast(`${b.name} não está no escritório agora. Os passos de cada rodada ficam no fio (clique na linha da rodada).`)
    const log = await state.log(a.id).catch((err: unknown) => {
      toast(chatError(err), 'err')
      return null
    })
    if (!log) return
    const entries = log.slice(-LOG_MAX)
    const body = h(
      'div',
      { class: 'panel-feed ch-log' },
      ...(entries.length ? entries.map(entryView) : [h('p', { class: 'ch-field-hint' }, 'O log está vazio.')]),
    )
    const done = () => w.remove()
    const w = modal(
      `Log de ${b.name}`,
      [body],
      [
        h(
          'span',
          { class: 'app-version' },
          log.length > LOG_MAX ? `As últimas ${LOG_MAX} de ${log.length} entradas` : `${log.length} entradas`,
        ),
        h('button', { class: 'btn btn-primary', onclick: done }, 'Fechar'),
      ],
      done,
    )
    w.classList.add('backdrop-chat-log')
    el.append(w)
    requestAnimationFrame(() => (body.scrollTop = body.scrollHeight))
  }

  async function exportMarkdown(): Promise<void> {
    const b = bot()
    if (!b) return
    try {
      let items: ThreadItem[] = []
      let before: string | undefined
      for (let i = 0; i < Math.ceil(BOT_LIMITS.threadItems / BOT_LIMITS.page); i++) {
        const page = await window.office.botThread(b.id, { before, limit: BOT_LIMITS.page })
        items = [...page.items, ...items]
        if (!page.more || !page.items.length) break
        before = page.items[0].id
      }
      if (!items.length) return toast(`A conversa com ${b.name} ainda está vazia.`)
      await saveMarkdown(exportFileName(b.name, 'chat'), threadMarkdown(b.name, items), toast, 'Conversa salva')
    } catch (err) {
      toast(chatError(err), 'err')
    }
  }

  // ---------- events ----------
  /** The bot or the channel on screen went away. */
  const gone = (): boolean => {
    if (mode !== 'thread' || !selected) return false
    return !bot() && !channel()
  }
  const offStore = chatStore.on(() => {
    if (closed) return
    channelStore.botsSeen(chatStore.bots)
    if (chatStore.error && !chatStore.bots.length) {
      if (mode !== 'error') showError()
      return
    }
    if (mode === 'error' || (mode === 'thread' && !selected) || gone()) return pickFirst()
    sidebar.render()
    renderHeader()
    composer.sync()
    if (!profile.el.hidden) profile.show(bot())
  })
  const offChannels = channelStore.on(() => {
    if (closed) return
    if (gone()) return pickFirst()
    sidebar.render()
    renderHeader()
    composer.sync()
  })
  const offItems = chatStore.onItem((threadId, item, added) => {
    if (closed || threadId !== selected || mode !== 'thread') return
    thread.add(item)
    if (added && (item.kind === 'bot' || item.kind === 'approval')) {
      const what = item.kind === 'bot' ? snippet(item.text, 160) : `pede você: ${snippet(item.request.title, 120)}`
      const c = channel()
      const who = c ? `${botName(item.botId)} em #${c.name}` : botName(threadId)
      announce(`${who}: ${what}`, item.kind === 'approval' ? 'assertive' : 'polite')
    }
  })
  // agents and requests: status lines, the composer, the cards
  const offState = state.onChange(() => {
    if (closed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (closed) return
      sidebar.render()
      renderHeader()
      composer.sync()
      if (mode === 'thread') thread.refresh()
    })
  })
  const onVisible = () => {
    if (document.visibilityState === 'visible') scheduleRead()
  }
  document.addEventListener('visibilitychange', onVisible)

  // ---------- keys and close ----------
  async function close(): Promise<void> {
    if (closed) return
    if (profile.hasChanges && !(await discardProfile())) return
    closed = true
    screen = null
    clearTimeout(readTimer)
    cancelAnimationFrame(frame)
    offStore()
    offItems()
    offChannels()
    offState()
    document.removeEventListener('visibilitychange', onVisible)
    closeMenu()
    el.remove()
  }

  el.addEventListener('keydown', (e) => {
    // a window over the Chat (confirm, log) handles its own keys
    if (el.querySelector('.backdrop')) return e.stopPropagation()
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault()
      if (closeMenu()) return e.stopPropagation()
      if (thread.searching) thread.closeSearch()
      else void close()
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f' && mode === 'thread' && selected) {
      e.preventDefault()
      thread.openSearch()
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      sidebar.focusSearch()
    }
    e.stopPropagation()
  })

  screen = {
    select: (id, itemId) => void select(id, itemId),
    close: () => void close(),
    agentId: () => (mode === 'thread' ? (botAgent(state, bot())?.id ?? null) : null),
  }

  // ---------- first paint ----------
  renderHeader()
  sidebar.render()
  syncProfile()
  void chatStore.start().then(async () => {
    if (closed) return
    const target = threadId ?? localStorage.getItem(LAST_KEY)
    // a channel's id waits for the channels; a bot's opens at once
    const on = chatStore.bot(target) ?? (target ? await findChannel(target) : undefined)
    if (closed) return
    if (on && (threadId || floor === 'all' || on.floor === floor)) void select(on.id)
    else if (threadId) {
      toast('Esse fio não existe mais.', 'err')
      pickFirst()
    } else pickFirst()
  })
}
