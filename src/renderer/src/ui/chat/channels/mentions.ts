import { insertMention, mentionQuery, mentionSuggestions } from '@shared/bots-mentions'
import type { Bot } from '@shared/types'
import { h } from '../../dom'
import { botAvatar } from '../avatar'

// O autocompletar do @ na caixa de mensagem de um canal (CB-20): ao digitar @, a lista dos membros
// abre acima da caixa; ↑↓ escolhem, Enter ou Tab põem o nome, Esc fecha. Só os membros do canal.

let seq = 0

export interface MentionMenuOpts {
  /** The channel's members; empty when the box is not in a channel (the menu stays shut). */
  members(): Bot[]
  /** The text changed (the name went in): the box grows and syncs. */
  changed(): void
}

export class MentionMenu {
  readonly el: HTMLDivElement
  private items: Bot[] = []
  private active = 0
  private start = -1
  private readonly id = `ch-mentions-${++seq}`

  constructor(
    private input: HTMLTextAreaElement,
    private opts: MentionMenuOpts,
  ) {
    this.el = h('div', { class: 'ch-mentions', id: this.id, role: 'listbox', 'aria-label': 'Membros do canal', hidden: true })
    // a click on an option must not blur the box first
    this.el.addEventListener('mousedown', (e) => e.preventDefault())
    input.addEventListener('blur', () => this.close())
    input.addEventListener('click', () => this.update())
  }

  get open(): boolean {
    return !this.el.hidden
  }

  /** Reads the @ being typed at the caret and shows the members that fit. */
  update(): void {
    const members = this.opts.members()
    const caret = this.input.selectionStart ?? 0
    const q = members.length && this.input.selectionEnd === caret ? mentionQuery(this.input.value, caret) : null
    const found = q ? mentionSuggestions(q.query, members) : []
    if (!q || !found.length) return this.close()
    const same = this.start === q.start && found.length === this.items.length && found.every((b, i) => b.id === this.items[i].id)
    this.start = q.start
    if (!same) {
      this.items = found
      this.active = 0
    }
    this.draw()
  }

  /** A key in the box: true when the menu used it. */
  onKey(e: KeyboardEvent): boolean {
    if (!this.open || e.isComposing) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = this.items.length
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      this.draw()
      return true
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault()
      this.pick(this.items[this.active])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close()
      return true
    }
    return false
  }

  close(): void {
    if (!this.open && this.start < 0) return
    this.el.hidden = true
    this.el.replaceChildren()
    this.items = []
    this.start = -1
    this.input.removeAttribute('aria-activedescendant')
    this.input.setAttribute('aria-expanded', 'false')
  }

  private pick(bot: Bot | undefined): void {
    if (!bot || this.start < 0) return
    const caret = this.input.selectionStart ?? this.input.value.length
    const next = insertMention(this.input.value, this.start, caret, bot.name)
    this.input.value = next.text
    this.input.setSelectionRange(next.caret, next.caret)
    this.close()
    this.opts.changed()
    this.input.focus()
  }

  private draw(): void {
    this.el.replaceChildren(
      ...this.items.map((b, i) =>
        h(
          'div',
          {
            id: `${this.id}-${i}`,
            class: `ch-mention-opt${i === this.active ? ' on' : ''}`,
            role: 'option',
            'aria-selected': String(i === this.active),
            onclick: () => this.pick(b),
          },
          botAvatar(b, 'idle', 24),
          h('span', { class: 'ch-mention-name' }, b.name),
          b.tagline ? h('span', { class: 'ch-mention-line' }, b.tagline) : null,
        ),
      ),
    )
    this.el.hidden = false
    this.input.setAttribute('aria-controls', this.id)
    this.input.setAttribute('aria-expanded', 'true')
    this.input.setAttribute('aria-activedescendant', `${this.id}-${this.active}`)
  }
}
