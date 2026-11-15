import './chat.css'
import { botsOnFloor, snippet, sortBots, threadMarkdown } from '@shared/bots-view'
import { exportFileName } from '@shared/export-md'
import { BOT_LIMITS, type Bot, type ThreadItem } from '@shared/types'
import type { State } from '../../state'
import { announce, modalA11y } from '../a11y'
import { h, icon } from '../dom'
import { saveMarkdown } from '../export'
import { confirmDialog, modal } from '../modals'
import { OPEN_AGENT_EVENT, openAgentPanel } from '../meetings/office'
import { entryView } from '../panel/entries'
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

// Chat dos bots (CB-08 a CB-10): tela cheia no molde da sala de reunião. À esquerda os bots do
// andar, no centro o fio com a caixa de mensagem, à direita (ⓘ) o perfil. Esc fecha; abre no
// último fio visto. Docs: docs/prd/chat-de-bots.md ("Experiência").

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

  const bot = (): Bot | undefined => chatStore.bot(selected)
  const botName = (id: string) => chatStore.bot(id)?.name ?? 'Bot removido'

  // ---------- frame ----------
  const center = h('div', { class: 'ch-center' })
  const main = h('main', { class: 'ch-main' })
  const box = h('div', { class: 'chat-screen' })
  const el = h('div', { class: 'backdrop chat-backdrop' }, box)
  const ctx = { root: el, state, toast }

  const sidebar = new ChatSidebar({
    ...ctx,
    host: box,
    selected: () => selected,
    floor: () => floor,
    setFloor: (f) => setFloor(f),
    select: (id, itemId) => void select(id, itemId),
    newBot: () => void showGallery(),
    removed: (id) => {
      if (id === selected) pickFirst()
    },
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
    activity: () => botAgent(state, bot())?.activity ?? '',
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

  main.append(header.el, center)
  box.append(sidebar.el, main, profile.el)
  modalA11y(el, box, sidebar.heading)
  root.append(el)

  // files dropped anywhere on the conversation go to the message box
  main.addEventListener('dragover', (e) => {
    if (mode !== 'thread' || !bot() || !e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    main.classList.add('drop-target')
  })
  main.addEventListener('dragleave', (e) => {
    if (!main.contains(e.relatedTarget as Node | null)) main.classList.remove('drop-target')
  })
  main.addEventListener('drop', (e) => {
    main.classList.remove('drop-target')
    if (mode !== 'thread' || !bot() || !e.dataTransfer?.files.length) return
    e.preventDefault()
    composer.attach([...e.dataTransfer.files])
    composer.focus()
  })

  // ---------- what the center shows ----------
  function setProfile(open: boolean): void {
    profileOpen = open
    localStorage.setItem(PROFILE_KEY, open ? '1' : '0')
    syncProfile()
    header.render()
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
    header.render()
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
    const b = bot()
    if (mode === 'thread' && b && (f === 'all' || b.floor === f)) return sidebar.render()
    if (mode === 'form' || mode === 'gallery') return sidebar.render()
    pickFirst()
  }

  async function select(id: string, itemId?: string): Promise<void> {
    if (closed) return
    if (id !== selected && profile.hasChanges && !(await discardProfile())) return
    await chatStore.start()
    const b = chatStore.bot(id)
    if (!b) {
      toast('Esse fio não existe mais.', 'err')
      return pickFirst()
    }
    if (floor !== 'all' && b.floor !== floor) floor = b.floor
    const changed = id !== selected || mode !== 'thread'
    selected = id
    localStorage.setItem(LAST_KEY, id)
    if (changed) {
      showCenter('thread', thread.el, composer.el)
      composer.setBot(b)
      await thread.load(b)
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
      chatStore.markRead(selected)
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
  const offStore = chatStore.on(() => {
    if (closed) return
    if (chatStore.error && !chatStore.bots.length) {
      if (mode !== 'error') showError()
      return
    }
    if (mode === 'error' || (mode === 'thread' && !selected)) return pickFirst()
    if (selected && !chatStore.bot(selected) && mode === 'thread') return pickFirst()
    sidebar.render()
    header.render()
    composer.sync()
    if (!profile.el.hidden) profile.show(bot())
  })
  const offItems = chatStore.onItem((threadId, item, added) => {
    if (closed || threadId !== selected || mode !== 'thread') return
    thread.add(item)
    if (added && (item.kind === 'bot' || item.kind === 'approval')) {
      const what = item.kind === 'bot' ? snippet(item.text, 160) : `pede você: ${snippet(item.request.title, 120)}`
      announce(`${botName(threadId)}: ${what}`, item.kind === 'approval' ? 'assertive' : 'polite')
    }
  })
  // agents and requests: status lines, the composer, the cards
  const offState = state.onChange(() => {
    if (closed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (closed) return
      sidebar.render()
      header.render()
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
  header.render()
  sidebar.render()
  syncProfile()
  void chatStore.start().then(() => {
    if (closed) return
    const target = threadId ?? localStorage.getItem(LAST_KEY)
    const b = chatStore.bot(target)
    if (b && (threadId || floor === 'all' || b.floor === floor)) void select(b.id)
    else if (threadId) {
      toast('Esse fio não existe mais.', 'err')
      pickFirst()
    } else pickFirst()
  })
}
