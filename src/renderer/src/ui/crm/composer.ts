import { draftNote } from '@shared/crm-chat-view'
import { CRM_LIMITS, MESSAGE_CATEGORIES, MESSAGE_CATEGORY_LABEL, type Draft, type MessageCategory } from '@shared/types'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import { crmChatStore } from './chat-store'
import { crmError, type Toast } from './util'

// Escrever para o cliente (CR-14). O portão vale para você também: a mensagem vai para a fila, e
// o que ele segurar volta como cartão no fio. Quando ele deixa você passar por cima (horário,
// limites, texto repetido), a tela pergunta com o motivo à vista; oferta a quem saiu, nunca.

export interface ComposerOpts {
  root: HTMLElement
  toast: Toast
}

export class Composer {
  readonly el: HTMLElement
  private readonly area: HTMLTextAreaElement
  private readonly category: HTMLSelectElement
  private readonly sendBtn: HTMLButtonElement
  private readonly note: HTMLElement
  private readonly count: HTMLElement
  private customerId = ''
  private blocked: string | null = null
  private busy = false
  /** Unsent text per customer: switching conversations keeps what you were writing. */
  private drafts = new Map<string, string>()

  constructor(private readonly o: ComposerOpts) {
    this.area = h('textarea', {
      class: 'crm-input crm-composer-text',
      rows: 2,
      maxlength: CRM_LIMITS.messageText,
      placeholder: 'Mensagem',
      'aria-label': 'Mensagem para o cliente',
      'aria-keyshortcuts': 'Enter',
    }) as HTMLTextAreaElement
    this.category = h(
      'select',
      { class: 'crm-input crm-composer-cat', 'aria-label': 'Categoria da mensagem' },
      ...MESSAGE_CATEGORIES.map((c) => h('option', { value: c }, MESSAGE_CATEGORY_LABEL[c])),
    ) as HTMLSelectElement
    this.sendBtn = h(
      'button',
      { class: 'btn crm-btn-accent crm-composer-send', type: 'button', title: 'Enviar (Enter)', 'aria-label': 'Enviar mensagem' },
      icon('send', 16),
    ) as HTMLButtonElement
    this.note = h('div', { class: 'crm-composer-note', role: 'status' })
    this.count = h('span', { class: 'crm-composer-count', 'aria-hidden': 'true' })
    this.el = h(
      'div',
      { class: 'crm-composer' },
      this.note,
      h('div', { class: 'crm-composer-row' }, this.category, this.area, this.sendBtn),
      this.count,
    )
    this.area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        void this.send()
      }
    })
    this.area.addEventListener('input', () => {
      this.drafts.set(this.customerId, this.area.value)
      this.sync()
    })
    this.sendBtn.addEventListener('click', () => void this.send())
  }

  /** The conversation on screen, and why sending is off (no phone, Parar tudo), if it is. */
  set(customerId: string, name: string, blocked: string | null): void {
    if (customerId !== this.customerId) {
      this.customerId = customerId
      this.area.value = this.drafts.get(customerId) ?? ''
      this.category.value = 'service'
    }
    this.area.placeholder = `Mensagem para ${name}`
    this.blocked = blocked
    this.sync()
  }

  focus(): void {
    this.area.focus()
  }

  private sync(): void {
    this.note.hidden = !this.blocked
    this.note.textContent = this.blocked ?? ''
    const len = this.area.value.length
    this.count.textContent =
      len > CRM_LIMITS.messageText * 0.8 ? `${len.toLocaleString('pt-BR')} / ${CRM_LIMITS.messageText.toLocaleString('pt-BR')}` : ''
    this.sendBtn.disabled = this.busy || !this.area.value.trim() || !!this.blocked
    this.area.disabled = this.busy
  }

  private async send(): Promise<void> {
    const text = this.area.value.trim()
    if (this.busy || !text || this.blocked) return
    const customerId = this.customerId
    this.busy = true
    this.sync()
    try {
      const d = await window.office.crmSend({ customerId, category: this.category.value as MessageCategory, text })
      this.drafts.delete(customerId)
      if (this.customerId === customerId) this.area.value = ''
      crmChatStore.put(customerId, { id: d.id, t: d.createdAt, kind: 'draft', draft: d })
      await this.after(customerId, d)
    } catch (err) {
      this.o.toast(crmError(err), 'err')
    } finally {
      this.busy = false
      this.sync()
      if (this.customerId === customerId) this.area.focus()
    }
  }

  /** The gate's answer: on its way, scheduled, or held, with "Enviar mesmo assim" when allowed. */
  private async after(customerId: string, d: Draft): Promise<void> {
    if (d.status === 'scheduled') {
      if (d.decision?.at) this.o.toast(draftNote(d), 'info')
      return
    }
    if (d.status !== 'blocked' && d.status !== 'held') return
    if (!d.decision?.overridable) {
      this.o.toast(d.decision?.reason ?? 'A mensagem não saiu. O motivo está no fio.', 'err')
      return
    }
    const ok = await confirmDialog(this.o.root, {
      title: 'Enviar mesmo assim?',
      text: `${d.decision.reason} Você confirma que quer enviar esta mensagem agora?`,
      confirm: 'Enviar mesmo assim',
      cancel: 'Deixar no fio',
      warn: 'O portão segurou esta mensagem. Passar por cima fica registrado na auditoria.',
    })
    if (!ok) return
    try {
      const saved = await window.office.crmDraft(customerId, d.id, 'override')
      crmChatStore.put(customerId, { id: saved.id, t: saved.createdAt, kind: 'draft', draft: saved })
      if (saved.status === 'blocked' || saved.status === 'held') this.o.toast(saved.decision?.reason ?? 'A mensagem não saiu.', 'err')
    } catch (err) {
      this.o.toast(crmError(err), 'err')
    }
  }
}
