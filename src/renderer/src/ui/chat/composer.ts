import { ATTACH_LIMITS, formatBytes, kindFromName, limitError } from '@shared/attachments'
import { replyIntent, snippet } from '@shared/bots-view'
import { adviseAgent } from '@shared/economy'
import type { AttachmentInput, Bot, Channel, PermissionDecision, PermissionRequest } from '@shared/types'
import { h, icon } from '../dom'
import { askCold, warnTokens } from '../panel/economy'
import { toBase64, type PendingFile } from '../panel/helpers'
import { MicButton } from '../voice'
import { MentionMenu } from './channels/mentions'
import { agentBusy, botAgent, botPending, chatError, type ChatCtx } from './util'

// A caixa de mensagem do fio, em pílula: 📎 (os anexos do painel), 🎙 (o microfone do app) e
// Enviar, que vira Parar enquanto o bot trabalha. Com um pedido pendente, a frase responde ao
// pedido (replyIntent); na dúvida, o app pergunta se é um sim ou um não. Segurança: a frase só
// responde ao pedido que já estava na tela antes de você começar a digitar, e um sim digitado nunca
// libera sozinho um plano ou um pedido sensível (sem "Sempre permitir"): esses pedem um clique.
// Num canal, a caixa posta no canal (@ abre a lista dos membros) e nunca responde a pedidos: os
// pedidos dos bots do canal se respondem só pelos cartões.

export interface ComposerCtx extends ChatCtx {
  bot(): Bot | undefined
  /** The channel on screen, when it is a channel's thread. */
  channel?(): Channel | undefined
  /** The channel's members, for the @ list. */
  members?(): Bot[]
  /** A message went (or a request was answered): the thread goes to the bottom. */
  onSent(): void
  /** Brings the pending request's card into view. */
  showRequest(requestId: string): void
}

export class Composer {
  readonly el: HTMLElement
  readonly input: HTMLTextAreaElement
  private files: PendingFile[] = []
  private chips: HTMLDivElement
  private picker: HTMLInputElement
  private main: HTMLButtonElement
  private replyChip: HTMLDivElement
  private askBar: HTMLDivElement
  private hint: HTMLDivElement
  private sending = false
  /** What was typed in each thread, kept when you switch bots. */
  private drafts = new Map<string, string>()
  private botId: string | null = null
  /** The request the "Responder ao pedido" chip shows now. */
  private chipFor: string | null = null
  /** The text in the box was started before that request showed up: it was not written as an answer. */
  private typedBeforeChip = false
  private mentions: MentionMenu

  constructor(private ctx: ComposerCtx) {
    this.input = h('textarea', { class: 'ch-input', rows: 1, 'aria-label': 'Mensagem', spellcheck: true })
    this.mentions = new MentionMenu(this.input, {
      members: () => (this.channel() ? (ctx.members?.() ?? []) : []),
      changed: () => {
        this.grow()
        this.sync()
      },
    })
    this.input.addEventListener('keydown', (e) => {
      if (this.mentions.onKey(e)) return
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        void this.send()
      } else if (e.key === 'Escape' && !this.askBar.hidden) {
        e.preventDefault()
        e.stopPropagation()
        this.hideAsk()
      }
    })
    this.input.addEventListener('input', () => {
      this.grow()
      this.sync()
      this.mentions.update()
    })
    this.input.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') this.mentions.update()
    })
    this.input.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      this.attach(files)
    })
    this.picker = h('input', { type: 'file', multiple: true, hidden: true, tabindex: -1, 'aria-hidden': 'true' })
    this.picker.addEventListener('change', () => {
      this.attach([...(this.picker.files ?? [])])
      this.picker.value = ''
    })
    this.chips = h('div', { class: 'ch-chips', hidden: true })
    this.main = h('button', { type: 'button', class: 'ch-send', onclick: () => void this.mainAction() })
    this.replyChip = h('div', { class: 'ch-reply', hidden: true, role: 'status' })
    this.askBar = h('div', { class: 'ch-ask', hidden: true, role: 'group', 'aria-label': 'Sim ou não?' })
    this.hint = h('div', { class: 'ch-hint', 'aria-hidden': 'true' })
    const mic = new MicButton(this.input, { size: 18 })
    mic.el.classList.add('ch-mic')
    this.el = h(
      'div',
      { class: 'ch-composer' },
      this.mentions.el,
      this.replyChip,
      this.askBar,
      this.chips,
      h(
        'div',
        { class: 'ch-pill' },
        h(
          'button',
          {
            type: 'button',
            class: 'ch-icon-btn',
            title: 'Anexar arquivos (ou arraste, ou cole uma imagem)',
            'aria-label': 'Anexar arquivos',
            onclick: () => this.picker.click(),
          },
          icon('clip', 18),
        ),
        this.input,
        mic.el,
        this.main,
      ),
      this.hint,
      this.picker,
    )
    this.sync()
  }

  /** The thread changed: keep what was typed in the old one, bring back the new one's. */
  setBot(bot: Bot | undefined): void {
    this.setThread(bot?.id ?? null)
  }

  /** A channel's thread: the box posts in the channel and @ lists its members. */
  setChannel(channel: Channel | undefined): void {
    this.setThread(channel?.id ?? null)
  }

  private setThread(id: string | null): void {
    if (this.botId) this.drafts.set(this.botId, this.input.value)
    this.botId = id
    this.input.value = (id && this.drafts.get(id)) || ''
    this.files = []
    this.mentions.close()
    if (this.channel()) this.input.setAttribute('aria-autocomplete', 'list')
    else for (const a of ['aria-autocomplete', 'aria-controls', 'aria-expanded', 'aria-activedescendant']) this.input.removeAttribute(a)
    this.renderChips()
    this.hideAsk()
    this.grow()
    this.sync()
  }

  /** The channel on screen, when the box is in one. */
  private channel(): Channel | undefined {
    return this.ctx.channel?.()
  }

  focus(): void {
    this.input.focus()
  }

  /** Writes and sends a suggested first message. */
  sendText(text: string): void {
    this.input.value = text
    this.grow()
    void this.send()
  }

  /** Files dropped on the thread. */
  attach(list: File[]): void {
    for (const file of list) {
      if (this.files.length >= ATTACH_LIMITS.count) {
        this.ctx.toast(`Dá para mandar até ${ATTACH_LIMITS.count} anexos por vez. Envie estes e anexe o resto na próxima mensagem.`, 'err')
        break
      }
      const path = window.office.pathForFile(file)
      const name =
        path || file.name !== 'image.png'
          ? file.name || 'anexo'
          : `imagem-colada-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`
      const key = path || `${file.type}:${file.size}:${file.lastModified}`
      if (this.files.some((f) => f.key === key)) continue
      const kind = kindFromName(name, file.type)
      const err = kind === 'image' || kind === 'pdf' || (kind === 'text' && !path) ? limitError(name, kind, file.size) : null
      if (err) {
        this.ctx.toast(err, 'err')
        continue
      }
      this.files.push({ id: crypto.randomUUID(), key, file, name, path, kind })
    }
    this.renderChips()
    this.sync()
  }

  private renderChips(): void {
    this.chips.hidden = !this.files.length
    this.chips.replaceChildren(
      ...this.files.map((f) =>
        h(
          'span',
          { class: 'ch-file', title: f.path || f.name },
          icon(f.kind === 'image' ? 'image' : 'file', 13),
          h('span', {}, f.name),
          h('small', {}, formatBytes(f.file.size)),
          h(
            'button',
            {
              type: 'button',
              class: 'ch-file-x',
              title: 'Remover anexo',
              'aria-label': `Remover ${f.name}`,
              onclick: () => {
                this.files = this.files.filter((x) => x.id !== f.id)
                this.renderChips()
                this.sync()
              },
            },
            icon('x', 12),
          ),
        ),
      ),
    )
  }

  private grow(): void {
    this.input.style.height = 'auto'
    this.input.style.height = `${Math.min(this.input.scrollHeight, 220)}px`
  }

  private pending(): PermissionRequest | undefined {
    // in a channel a sentence never answers a request: its bots' cards take a click
    if (this.channel()) return undefined
    return botPending(this.ctx.state, this.ctx.bot())[0]
  }

  /** Send ↔ Parar, the placeholder and the "Responder ao pedido" chip, from the bot's state now. */
  sync(): void {
    const channel = this.channel()
    if (channel) return this.syncChannel(channel)
    const bot = this.ctx.bot()
    const agent = botAgent(this.ctx.state, bot)
    const pending = this.pending()
    const typed = !!this.input.value.trim() || this.files.length > 0
    if (!pending) {
      this.chipFor = null
      this.typedBeforeChip = false
    } else if (pending.id !== this.chipFor) {
      this.chipFor = pending.id
      this.typedBeforeChip = !!this.input.value.trim()
    } else if (!this.input.value.trim()) this.typedBeforeChip = false
    const stop = agentBusy(agent) && !typed && !pending
    this.main.replaceChildren(icon(stop ? 'stop' : 'send', 18))
    this.main.classList.toggle('stop', stop)
    this.main.title = stop ? 'Parar o bot (a conversa fica)' : pending ? 'Responder ao pedido (Enter)' : 'Enviar (Enter)'
    this.main.setAttribute('aria-label', stop ? 'Parar o bot' : pending ? 'Responder ao pedido' : 'Enviar')
    this.main.disabled = !bot || (!stop && !typed)
    this.input.disabled = !bot
    this.input.placeholder = !bot
      ? 'Escolha um bot à esquerda'
      : pending
        ? pending.kind === 'question'
          ? 'Responda com uma frase, ou escolha uma opção no cartão'
          : 'Responda: "pode" permite; outra frase nega e vira a instrução'
        : agentBusy(agent)
          ? `${bot.name} está trabalhando: a mensagem entra na fila`
          : `Mensagem para ${bot.name}`
    this.replyChip.hidden = !pending
    if (pending) {
      this.replyChip.replaceChildren(
        icon('reply', 14),
        h('b', {}, 'Responder ao pedido'),
        h('span', {}, snippet(pending.title, 70)),
        h('button', { type: 'button', class: 'ch-link', onclick: () => this.ctx.showRequest(pending.id) }, 'Ver no fio'),
      )
    } else this.hideAsk()
    const v = this.input.value
    this.hint.textContent = v.startsWith('!')
      ? 'Comando: roda no shell da pasta do bot, como no painel.'
      : 'Enter envia · ⇧Enter quebra a linha'
  }

  /** In a channel: always Enviar, no request chip, the @ hint. */
  private syncChannel(channel: Channel): void {
    const typed = !!this.input.value.trim() || this.files.length > 0
    this.chipFor = null
    this.typedBeforeChip = false
    this.replyChip.hidden = true
    this.hideAsk()
    this.main.replaceChildren(icon('send', 18))
    this.main.classList.remove('stop')
    this.main.title = 'Enviar (Enter)'
    this.main.setAttribute('aria-label', 'Enviar')
    this.main.disabled = !typed
    this.input.disabled = false
    this.input.placeholder = `Mensagem em #${channel.name} · @ chama um bot`
    this.hint.textContent = this.input.value.startsWith('!')
      ? 'Comandos com ! rodam só na conversa direta com um bot.'
      : '@ e o nome chamam um bot · sem @, o app escolhe quem responde · Enter envia'
  }

  private async mainAction(): Promise<void> {
    if (this.channel()) return this.send()
    const bot = this.ctx.bot()
    if (!bot) return
    if (this.main.classList.contains('stop')) {
      try {
        await window.office.stopBot(bot.id)
        this.ctx.toast(`${bot.name} parou. A conversa continua de onde estava.`)
      } catch (err) {
        this.ctx.toast(chatError(err), 'err')
      }
      return
    }
    await this.send()
  }

  /** Files as the IPC takes them: a path when there is one, the bytes otherwise. */
  private inputs(files: PendingFile[]): Promise<AttachmentInput[]> {
    return Promise.all(
      files.map(async (f) =>
        f.path
          ? { name: f.name, mime: f.file.type, path: f.path }
          : { name: f.name, mime: f.file.type, dataBase64: await toBase64(f.file) },
      ),
    )
  }

  /** Posts in the channel: the @mentioned members answer, or the ones the router picks. */
  private async post(channel: Channel): Promise<void> {
    const text = this.input.value.trim()
    if (this.sending || (!text && !this.files.length)) return
    if (text.startsWith('!')) {
      this.ctx.toast('Comandos com ! rodam só na conversa direta com um bot. Abra o bot à esquerda e mande lá.')
      return
    }
    this.sending = true
    const files = this.files
    try {
      await window.office.postToChannel(channel.id, text, await this.inputs(files))
      if (this.input.value.trim() === text) this.input.value = ''
      this.drafts.delete(channel.id)
      this.files = this.files.filter((f) => !files.includes(f))
      this.mentions.close()
      this.renderChips()
      this.grow()
      this.ctx.onSent()
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
    } finally {
      this.sending = false
      this.sync()
    }
  }

  /** `asMessage`: send as a plain message even with a request pending. */
  private async send(asMessage = false): Promise<void> {
    const channel = this.channel()
    if (channel) return this.post(channel)
    const bot = this.ctx.bot()
    const text = this.input.value.trim()
    if (!bot || this.sending || (!text && !this.files.length)) return
    const pending = this.pending()
    if (!asMessage && pending && text && !this.files.length) {
      // A request that arrived while you typed (or one the chip never showed) is not what you answered.
      if (pending.id !== this.chipFor || this.typedBeforeChip) return this.showArrived(pending)
      return this.reply(pending, text)
    }
    this.sending = true
    const files = this.files
    try {
      // A cold, big conversation: the cheap way is a fresh one (the panel asks the same).
      const agent = botAgent(this.ctx.state, bot)
      const advice = agent && this.ctx.state.settings.coldConfirm !== false ? adviseAgent(agent, warnTokens(this.ctx.state.settings)) : null
      if (agent && advice?.kind === 'cold') {
        const choice = await askCold(this.ctx.root, agent, advice)
        if (choice === 'cancel') return
        if (choice === 'clear') await window.office.newBotConversation(bot.id)
      }
      const attachments: AttachmentInput[] = await Promise.all(
        files.map(async (f) =>
          f.path
            ? { name: f.name, mime: f.file.type, path: f.path }
            : { name: f.name, mime: f.file.type, dataBase64: await toBase64(f.file) },
        ),
      )
      await window.office.sendToBot(bot.id, text, attachments)
      // cleared only once it went, so a rejected file can be removed and the rest sent again
      if (this.input.value.trim() === text) this.input.value = ''
      this.drafts.delete(bot.id)
      this.files = this.files.filter((f) => !files.includes(f))
      this.renderChips()
      this.grow()
      this.ctx.onSent()
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
    } finally {
      this.sending = false
      this.sync()
    }
  }

  // ---------- answering a request with a sentence ----------

  private async decide(d: PermissionDecision): Promise<boolean> {
    try {
      await window.office.respond(d)
      this.input.value = ''
      this.grow()
      this.hideAsk()
      this.ctx.onSent()
      return true
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
      return false
    } finally {
      this.sync()
    }
  }

  private async reply(p: PermissionRequest, text: string): Promise<void> {
    if (p.kind === 'question') {
      const qs = p.questions ?? []
      if (qs.length !== 1) {
        this.ctx.toast(`São ${qs.length} perguntas: responda pelos botões do cartão no fio.`)
        return this.ctx.showRequest(p.id)
      }
      await this.decide({ requestId: p.id, behavior: 'allow', answers: { [qs[0].question]: text } })
      return
    }
    const intent = replyIntent(text)
    // A typed yes frees only an ordinary tool request; a plan or a sensitive one (no "Sempre permitir")
    // waits for a click. The sentence goes along with a yes: it lands in the agent's log beside the decision.
    const textCanAllow = p.kind === 'tool' && p.canAlwaysAllow
    if (intent === 'allow' && textCanAllow) await this.decide({ requestId: p.id, behavior: 'allow', message: text })
    else if (intent === 'deny') await this.decide({ requestId: p.id, behavior: 'deny', message: text })
    else this.showAsk(p, text)
  }

  /** A request came in while you were typing: send the text as a message, or go answer the request. */
  private showArrived(p: PermissionRequest): void {
    const look = h(
      'button',
      { type: 'button', class: 'btn btn-small ch-btn-accent', onclick: () => this.ctx.showRequest(p.id) },
      'Ver o pedido',
    )
    this.askBar.replaceChildren(
      h('span', { class: 'ch-ask-text' }, 'Chegou um pedido enquanto você escrevia. Responda pelo cartão ou envie o texto como mensagem.'),
      look,
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small ch-btn-quiet',
          onclick: () => {
            this.hideAsk()
            void this.send(true)
          },
        },
        'Enviar como mensagem',
      ),
      h('button', { type: 'button', class: 'btn btn-small ch-btn-quiet', onclick: () => this.hideAsk(true) }, 'Voltar a editar'),
    )
    this.askBar.hidden = false
    look.focus()
  }

  private showAsk(p: PermissionRequest, text: string): void {
    const plan = p.kind === 'plan'
    const yes = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small ch-btn-accent',
        onclick: () => void this.decide({ requestId: p.id, behavior: 'allow', message: text }),
      },
      icon('check', 13),
      plan ? 'Aprovar o plano' : 'Permitir',
    )
    this.askBar.replaceChildren(
      h(
        'span',
        { class: 'ch-ask-text' },
        p.kind === 'tool' && p.canAlwaysAllow ? 'Isso é um sim ou um não?' : 'Este pedido só sai com um clique seu.',
      ),
      yes,
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small btn-danger-soft',
          onclick: () => void this.decide({ requestId: p.id, behavior: 'deny', message: text }),
        },
        plan ? 'Pedir estas mudanças' : 'Negar com esta instrução',
      ),
      h('button', { type: 'button', class: 'btn btn-small ch-btn-quiet', onclick: () => this.hideAsk(true) }, 'Voltar a editar'),
    )
    this.askBar.hidden = false
    yes.focus()
  }

  private hideAsk(focus = false): void {
    if (this.askBar.hidden) return
    this.askBar.hidden = true
    this.askBar.replaceChildren()
    if (focus) this.input.focus()
  }
}
