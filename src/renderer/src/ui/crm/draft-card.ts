import { draftNote, draftOpen } from '@shared/crm-chat-view'
import { CRM_LIMITS, MESSAGE_CATEGORY_LABEL, type Draft, type DraftAction } from '@shared/types'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import { crmChatStore } from './chat-store'
import { crmError, type Toast } from './util'

// O cartão do rascunho no fio (CR-14): a categoria, quem escreveu, o texto e o motivo do portão.
// Enviar aprova; Editar troca o texto antes de enviar; Descartar tira do fio. "Enviar mesmo
// assim" só aparece quando o portão diz que você pode passar por cima (nunca na oferta a quem
// saiu), e pede confirmação com o motivo à vista. O texto é do modelo ou do cliente: textContent.

export interface DraftCardOpts {
  /** Where the confirmation opens (the CRM's backdrop). */
  root: HTMLElement
  customerId: string
  draft: Draft
  /** "Atendente", "você", "o app". */
  author: string
  toast: Toast
}

/** Tone of the card: blocked = red, waits for you = amber, scheduled = quiet. */
function tone(d: Draft): string {
  if (d.status === 'blocked') return 'blocked'
  if (d.status === 'scheduled') return 'scheduled'
  return 'held'
}

export function draftCard(o: DraftCardOpts): HTMLElement {
  const d = o.draft
  const who = d.by.kind === 'player' ? 'Sua mensagem' : `Rascunho de ${o.author}`
  const head = h(
    'div',
    { class: 'crm-draft-head' },
    h('span', { class: 'crm-draft-kind' }, `${who} · ${MESSAGE_CATEGORY_LABEL[d.category]}`),
    d.edited ? h('span', { class: 'crm-draft-tag' }, 'editado') : null,
  )
  const text = h('div', { class: 'crm-draft-text' })
  text.textContent = d.text
  const note = h('div', { class: 'crm-draft-note' }, icon(d.status === 'blocked' ? 'alert' : 'history', 14), h('span', {}, draftNote(d)))
  const actions = h('div', { class: 'crm-draft-actions' })
  const card = h(
    'article',
    { class: `crm-draft t-${tone(d)}`, 'aria-label': `${who}, ${MESSAGE_CATEGORY_LABEL[d.category]}` },
    head,
    text,
    note,
    actions,
  )
  if (!draftOpen(d)) return card

  let busy = false
  const buttons: HTMLButtonElement[] = []
  const button = (label: string, cls: string, fn: () => void, iconName?: string): HTMLButtonElement => {
    const b = h(
      'button',
      { class: `btn btn-small ${cls}`, type: 'button' },
      iconName ? icon(iconName, 14) : null,
      label,
    ) as HTMLButtonElement
    b.addEventListener('click', fn)
    buttons.push(b)
    return b
  }

  async function act(action: DraftAction, edited?: string): Promise<void> {
    if (busy) return
    busy = true
    for (const b of buttons) b.disabled = true
    try {
      const saved = await window.office.crmDraft(o.customerId, d.id, action, edited)
      crmChatStore.put(o.customerId, { id: saved.id, t: saved.createdAt, kind: 'draft', draft: saved })
      if (action === 'discard') o.toast('Rascunho descartado.', 'ok')
      else if (saved.status === 'blocked' || saved.status === 'held') o.toast(saved.decision?.reason ?? 'A mensagem não saiu.', 'err')
      else o.toast(saved.status === 'scheduled' && saved.decision?.at ? draftNote(saved) : 'Mensagem na fila de envio.', 'ok')
    } catch (err) {
      o.toast(crmError(err), 'err')
    } finally {
      busy = false
      for (const b of buttons) b.disabled = false
    }
  }

  async function override(): Promise<void> {
    const ok = await confirmDialog(o.root, {
      title: 'Enviar mesmo assim?',
      text: `${d.decision?.reason ?? ''} Você confirma que quer enviar esta mensagem agora?`,
      confirm: 'Enviar mesmo assim',
      cancel: 'Voltar',
      warn: 'O portão segurou esta mensagem. Passar por cima fica registrado na auditoria.',
    })
    if (ok) await act('override')
  }

  function edit(): void {
    const area = h('textarea', {
      class: 'crm-input crm-draft-edit',
      rows: 4,
      maxlength: CRM_LIMITS.messageText,
      'aria-label': 'Texto do rascunho',
    }) as HTMLTextAreaElement
    area.value = d.text
    text.replaceWith(area)
    const send = h('button', { class: 'btn btn-small crm-btn-accent', type: 'button' }, icon('send', 14), 'Enviar') as HTMLButtonElement
    const cancel = h('button', { class: 'btn btn-small crm-btn-quiet', type: 'button' }, 'Cancelar') as HTMLButtonElement
    buttons.push(send, cancel)
    send.addEventListener('click', () => {
      const value = area.value.trim()
      if (!value) return o.toast('Escreva o texto antes de enviar, ou descarte o rascunho.', 'err')
      void act('send', value)
    })
    cancel.addEventListener('click', () => {
      area.replaceWith(text)
      fill()
    })
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel.click()
      }
    })
    actions.replaceChildren(send, cancel)
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }

  function fill(): void {
    buttons.length = 0
    actions.replaceChildren(
      button('Enviar', 'crm-btn-accent', () => void act('send'), 'send'),
      button('Editar', '', edit),
      ...(d.decision?.overridable ? [button('Enviar mesmo assim', 'crm-btn-danger', () => void override())] : []),
      button('Descartar', 'crm-btn-quiet', () => void act('discard')),
    )
  }
  fill()
  return card
}
