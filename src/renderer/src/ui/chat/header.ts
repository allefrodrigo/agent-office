import { automationCounts, botState, botStatusLine, draftFromBot } from '@shared/bots-view'
import type { Bot } from '@shared/types'
import { BOT_LIMITS } from '@shared/types'
import { h, icon } from '../dom'
import { MODELS } from '../modals'
import { modelLabel } from '../panel/helpers'
import { botAvatar } from './avatar'
import { showMenu, type MenuItem } from './menu'
import { chatStore } from './store'
import { botAgent, botPending, chatError, floorName, type ChatCtx } from './util'

// O cabeçalho do fio: avatar, nome (clique renomeia), seletor de modelo (vale a partir da próxima
// mensagem), ⓘ abre o perfil e ⋯ abre as ações do bot. Nas telas de Automações e Conexões, o
// título da tela no lugar do bot.

/** A screen of the Chat that is not a thread (Automações, Conexões). */
export interface HeaderScreen {
  title: string
  sub: string
  icon: string
}

export interface HeaderCtx extends ChatCtx {
  bot(): Bot | undefined
  /** Automações or Conexões on screen: their title instead of the bot. */
  screen(): HeaderScreen | null
  /** The menu's host (the screen, so it shows over everything in it). */
  host: HTMLElement
  profileOpen(): boolean
  toggleProfile(): void
  runNow(): void
  newConversation(): void
  showInOffice(): void
  showLog(): void
  exportMarkdown(): void
  close(): void
}

export class ChatHeader {
  readonly el: HTMLElement
  private avatarSlot: HTMLSpanElement
  private nameBtn: HTMLButtonElement
  private sub: HTMLDivElement
  private model: HTMLSelectElement
  private info: HTMLButtonElement
  private more: HTMLButtonElement
  private editing = false

  constructor(private ctx: HeaderCtx) {
    this.avatarSlot = h('span', { class: 'ch-head-avatar' })
    this.nameBtn = h('button', { type: 'button', class: 'ch-name', title: 'Renomear', onclick: () => this.editName() })
    this.sub = h('div', { class: 'ch-head-sub' })
    this.model = h('select', {
      class: 'ch-select ch-model',
      'aria-label': 'Modelo do bot (vale a partir da próxima mensagem)',
      title: 'Modelo: vale a partir da próxima mensagem',
    })
    this.model.addEventListener('change', () => void this.setModel())
    this.info = h(
      'button',
      {
        type: 'button',
        class: 'ch-icon-btn',
        title: 'Perfil do bot',
        'aria-label': 'Perfil do bot',
        'aria-controls': 'ch-profile',
        'aria-pressed': 'false',
        onclick: () => ctx.toggleProfile(),
      },
      icon('panel', 18),
    )
    this.more = h(
      'button',
      {
        type: 'button',
        class: 'ch-icon-btn',
        title: 'Mais ações',
        'aria-label': 'Mais ações do bot',
        'aria-haspopup': 'menu',
        onclick: () => this.openMenu(),
      },
      h('span', { class: 'ch-dots', 'aria-hidden': 'true' }, '⋯'),
    )
    this.el = h(
      'header',
      { class: 'ch-head' },
      this.avatarSlot,
      h('div', { class: 'ch-head-text' }, h('h2', { class: 'ch-head-name' }, this.nameBtn), this.sub),
      h(
        'div',
        { class: 'ch-head-actions' },
        this.model,
        this.info,
        this.more,
        h(
          'button',
          { type: 'button', class: 'ch-icon-btn', title: 'Fechar (Esc)', 'aria-label': 'Fechar o Chat', onclick: () => ctx.close() },
          icon('x', 18),
        ),
      ),
    )
  }

  render(): void {
    const screen = this.ctx.screen()
    const bot = screen ? undefined : this.ctx.bot()
    this.el.classList.toggle('empty', !bot)
    for (const el of [this.model, this.info, this.more]) el.hidden = !bot
    if (screen) {
      this.avatarSlot.replaceChildren(h('span', { class: 'ch-head-icon', 'aria-hidden': 'true' }, icon(screen.icon, 20)))
      if (!this.editing) this.nameBtn.textContent = screen.title
      this.nameBtn.disabled = true
      this.sub.textContent = screen.sub
      this.sub.className = 'ch-head-sub'
      return
    }
    if (!bot) {
      this.avatarSlot.replaceChildren()
      if (!this.editing) this.nameBtn.textContent = 'Chat dos bots'
      this.nameBtn.disabled = true
      this.sub.textContent = 'Um time que trabalha sozinho e só para quando precisa do seu sim.'
      this.sub.className = 'ch-head-sub'
      return
    }
    const agent = botAgent(this.ctx.state, bot)
    const pending = botPending(this.ctx.state, bot)
    this.avatarSlot.replaceChildren(botAvatar(bot, botState(bot, agent, pending), 40))
    this.nameBtn.disabled = false
    if (!this.editing) this.nameBtn.textContent = bot.name
    const line = botStatusLine(bot, agent, pending, null)
    const where = floorName(this.ctx.state, bot.floor)
    this.sub.className = `ch-head-sub tone-${line.tone}`
    this.sub.textContent =
      line.tone === 'wait' || line.tone === 'work' || line.tone === 'fail'
        ? `${line.text} · ${where}`
        : `${bot.tagline ? `${bot.tagline} · ` : ''}${where}`
    // the model picker: the app's list, plus the bot's own when it is not in it
    const current = bot.model ?? ''
    const options = MODELS.map((m) => ({ value: m.value, label: m.value ? m.label : 'Modelo padrão' }))
    if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: modelLabel(current) })
    this.model.replaceChildren(...options.map((o) => h('option', { value: o.value }, o.label)))
    this.model.value = current
    const open = this.ctx.profileOpen()
    this.info.setAttribute('aria-pressed', String(open))
    this.info.classList.toggle('on', open)
  }

  private async setModel(): Promise<void> {
    const bot = this.ctx.bot()
    if (!bot) return
    const model = this.model.value
    try {
      await window.office.configureBot(bot.id, { model })
      const label = MODELS.find((m) => m.value === model)?.label ?? modelLabel(model)
      this.ctx.toast(
        model ? `${bot.name} usa ${label} a partir da próxima mensagem.` : `${bot.name} volta ao modelo padrão na próxima mensagem.`,
        'ok',
      )
    } catch (err) {
      this.model.value = bot.model ?? ''
      this.ctx.toast(chatError(err), 'err')
    }
  }

  /** "Pausar automações" / "Retomar automações": every routine and event trigger of the bot. */
  private async setAutomations(bot: Bot, enabled: boolean): Promise<void> {
    try {
      await window.office.setBotAutomationsEnabled(bot.id, enabled)
      this.ctx.toast(
        enabled
          ? `As automações de ${bot.name} voltaram a rodar.`
          : `As automações de ${bot.name} estão pausadas. Mensagens e Rodar agora continuam.`,
        'ok',
      )
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
    }
  }

  private editName(): void {
    const bot = this.ctx.bot()
    if (!bot || this.editing) return
    this.editing = true
    const input = h('input', { class: 'ch-name-input', value: bot.name, maxlength: BOT_LIMITS.name, 'aria-label': 'Nome do bot' })
    let done = false
    const finish = async (save: boolean) => {
      if (done) return
      done = true
      const name = input.value.trim()
      this.editing = false
      input.replaceWith(this.nameBtn)
      const now = this.ctx.bot()
      if (save && now && name && name !== now.name) {
        this.nameBtn.textContent = name
        try {
          await window.office.saveBot({ ...draftFromBot(now), name })
        } catch (err) {
          this.ctx.toast(chatError(err), 'err')
        }
      }
      this.render()
      this.nameBtn.focus()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        void finish(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        void finish(false)
      }
    })
    input.addEventListener('blur', () => void finish(true))
    this.nameBtn.replaceWith(input)
    input.focus()
    input.select()
  }

  private openMenu(): void {
    const bot = this.ctx.bot()
    if (!bot) return
    const inOffice = !!botAgent(this.ctx.state, bot)
    const autos = automationCounts(bot.id, this.ctx.state.routines, chatStore.triggers)
    const automations: MenuItem = autos.active
      ? {
          label: 'Pausar automações',
          icon: 'pause',
          hint: autos.active === 1 ? '1 ativa' : `${autos.active} ativas`,
          run: () => void this.setAutomations(bot, false),
        }
      : autos.paused
        ? {
            label: 'Retomar automações',
            icon: 'reset',
            hint: autos.paused === 1 ? '1 pausada' : `${autos.paused} pausadas`,
            run: () => void this.setAutomations(bot, true),
          }
        : { label: 'Pausar automações', icon: 'pause', hint: 'nenhuma', disabled: true }
    const items: (MenuItem | 'sep')[] = [
      { label: 'Rodar agora', icon: 'play', run: () => this.ctx.runNow() },
      automations,
      { label: 'Nova conversa', icon: 'reset', run: () => this.ctx.newConversation() },
      'sep',
      { label: 'Ver no escritório', icon: 'walk', hint: inOffice ? undefined : 'fora agora', run: () => this.ctx.showInOffice() },
      { label: 'Ver o log completo', icon: 'list', run: () => this.ctx.showLog() },
      { label: 'Exportar em Markdown', icon: 'download', run: () => this.ctx.exportMarkdown() },
    ]
    showMenu(this.ctx.host, this.more, items, `Ações de ${bot.name}`)
  }
}
