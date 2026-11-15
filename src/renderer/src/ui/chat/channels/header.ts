import { botState } from '@shared/bots-view'
import { isFloorChannel } from '@shared/bots-mentions'
import type { Bot, Channel } from '@shared/types'
import { h, icon } from '../../dom'
import { botAvatar } from '../avatar'
import { showMenu, type MenuItem } from '../menu'
import { botAgent, botPending, floorName, type ChatCtx } from '../util'

// O cabeçalho do fio de um canal (CB-20): #nome, o tema, os membros (clique abre a conversa direta),
// Editar canal e ⋯ (Marcar como não lido, Apagar canal). No lugar do cabeçalho do bot.

export interface ChannelHeaderCtx extends ChatCtx {
  channel(): Channel | undefined
  members(): Bot[]
  /** The menu's host (the screen). */
  host: HTMLElement
  edit(): void
  remove(): void
  markUnread(): void
  openBot(botId: string): void
  close(): void
}

/** Member faces shown before "+N". */
const FACES = 5

export class ChannelHeader {
  readonly el: HTMLElement
  private nameEl: HTMLHeadingElement
  private sub: HTMLDivElement
  private faces: HTMLDivElement
  private more: HTMLButtonElement

  constructor(private ctx: ChannelHeaderCtx) {
    this.nameEl = h('h2', { class: 'ch-head-name' })
    this.sub = h('div', { class: 'ch-head-sub' })
    this.faces = h('div', { class: 'ch-faces', role: 'group', 'aria-label': 'Membros' })
    this.more = h(
      'button',
      {
        type: 'button',
        class: 'ch-icon-btn',
        title: 'Mais ações',
        'aria-label': 'Mais ações do canal',
        'aria-haspopup': 'menu',
        onclick: () => this.openMenu(),
      },
      h('span', { class: 'ch-dots', 'aria-hidden': 'true' }, '⋯'),
    )
    this.el = h(
      'header',
      { class: 'ch-head ch-head-channel', hidden: true },
      h('span', { class: 'ch-head-hash', 'aria-hidden': 'true' }, '#'),
      h('div', { class: 'ch-head-text' }, this.nameEl, this.sub),
      this.faces,
      h(
        'div',
        { class: 'ch-head-actions' },
        h(
          'button',
          { type: 'button', class: 'ch-icon-btn', title: 'Editar canal', 'aria-label': 'Editar canal', onclick: () => ctx.edit() },
          icon('edit', 17),
        ),
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
    const c = this.ctx.channel()
    if (!c) return
    const members = this.ctx.members()
    this.nameEl.textContent = c.name
    const count = members.length === 1 ? '1 bot' : `${members.length} bots`
    this.sub.textContent = `${c.topic ? `${c.topic} · ` : ''}${count} · ${floorName(this.ctx.state, c.floor)}`
    this.sub.title = c.topic
    const shown = members.slice(0, FACES)
    const faces: HTMLElement[] = shown.map((b) => {
      const agent = botAgent(this.ctx.state, b)
      return h(
        'button',
        {
          type: 'button',
          class: 'ch-face',
          title: `${b.name}: abrir a conversa direta`,
          'aria-label': `${b.name}: abrir a conversa direta`,
          onclick: () => this.ctx.openBot(b.id),
        },
        botAvatar(b, botState(b, agent, botPending(this.ctx.state, b)), 28),
      )
    })
    if (members.length > FACES) {
      const rest = members.length - FACES
      faces.push(h('span', { class: 'ch-face-more', title: `Mais ${rest} no canal` }, `+${rest}`))
    }
    this.faces.replaceChildren(...faces)
  }

  private openMenu(): void {
    const c = this.ctx.channel()
    if (!c) return
    const items: (MenuItem | 'sep')[] = [
      { label: 'Editar canal', icon: 'edit', run: () => this.ctx.edit() },
      { label: 'Marcar como não lido', icon: 'inbox', run: () => this.ctx.markUnread() },
    ]
    if (!isFloorChannel(c)) items.push('sep', { label: 'Apagar canal…', icon: 'trash', danger: true, run: () => this.ctx.remove() })
    else items.push('sep', { label: 'Apagar canal', icon: 'trash', hint: 'canal do andar', disabled: true })
    showMenu(this.ctx.host, this.more, items, `Ações de #${c.name}`)
  }
}
