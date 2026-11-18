import { authorLabel, dayLabel, DELIVERY_LABEL, linkParts, threadItems } from '@shared/crm-chat-view'
import { MESSAGE_CATEGORY_LABEL, type ConversationItem } from '@shared/types'
import { chatStore } from '../chat/store'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import type { Thread } from './chat-store'
import { draftCard } from './draft-card'
import type { Toast } from './util'

// O fio de uma conversa (CR-14): recebidas à esquerda, enviadas à direita, com quem enviou e o
// estado; os rascunhos como cartão; os avisos no meio. Texto de cliente com textContent; um link
// vira um botão com o domínio à vista, que pergunta antes de abrir.

const MEDIA_LABEL: Record<string, string> = {
  image: 'Imagem',
  audio: 'Áudio',
  video: 'Vídeo',
  document: 'Documento',
  other: 'Anexo',
}

export interface ThreadOpts {
  root: HTMLElement
  customerId: string
  toast: Toast
}

const time = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const botName = (id: string) => chatStore.bot(id)?.name

/** Customer or model text as nodes: plain text, and links as buttons that confirm first. */
export function messageText(text: string, root: HTMLElement): HTMLElement {
  const el = h('div', { class: 'crm-msg-text' })
  for (const part of linkParts(text)) {
    if (part.kind === 'text') {
      el.append(document.createTextNode(part.text))
      continue
    }
    const link = h(
      'button',
      { class: 'crm-msg-link', type: 'button', title: `Abrir ${part.host}` },
      h('span', {}, part.text),
      // the real domain beside the link, when the text shows more (or something else) than it
      part.text === part.host ? null : h('span', { class: 'crm-msg-host' }, part.host),
    )
    link.addEventListener('click', () => void openLink(part.url, part.host, root))
    el.append(link)
  }
  return el
}

async function openLink(url: string, host: string, root: HTMLElement): Promise<void> {
  const ok = await confirmDialog(root, {
    title: 'Abrir este link?',
    text: `O link leva para ${host}. Abra só se você confia neste endereço.`,
    confirm: `Abrir ${host}`,
    cancel: 'Cancelar',
    warn: 'Links em mensagens de WhatsApp são um caminho comum de golpe.',
  })
  if (ok) void window.office.openExternal(url)
}

function itemEl(item: ConversationItem, o: ThreadOpts): HTMLElement {
  switch (item.kind) {
    case 'in': {
      const body = h('div', { class: 'crm-msg-bubble' })
      if (item.media)
        body.append(
          h(
            'div',
            { class: 'crm-msg-media' },
            icon('clip', 14),
            MEDIA_LABEL[item.media.type] ?? 'Anexo',
            item.media.name ? ` · ${item.media.name}` : '',
          ),
        )
      if (item.text) body.append(messageText(item.text, o.root))
      return h('div', { class: 'crm-msg in' }, body, h('div', { class: 'crm-msg-meta' }, time(item.t)))
    }
    case 'out': {
      const body = h('div', { class: 'crm-msg-bubble' }, messageText(item.text, o.root))
      const meta = [
        authorLabel(item.by, botName),
        item.category ? MESSAGE_CATEGORY_LABEL[item.category] : '',
        time(item.t),
        DELIVERY_LABEL[item.status],
      ].filter(Boolean)
      return h(
        'div',
        { class: `crm-msg out${item.status === 'failed' ? ' failed' : ''}` },
        body,
        h('div', { class: 'crm-msg-meta' }, meta.join(' · ')),
      )
    }
    case 'draft':
      return h(
        'div',
        { class: 'crm-msg out draft' },
        draftCard({
          root: o.root,
          customerId: o.customerId,
          draft: item.draft,
          author: authorLabel(item.draft.by, botName),
          toast: o.toast,
        }),
      )
    case 'notice':
      return h('div', { class: `crm-notice t-${item.tone ?? 'info'}`, role: 'note' }, h('span', {}, item.text))
  }
}

/**
 * The thread's scrolling list. Items are kept by id and redrawn only when they change, so an
 * open draft editor and the scroll survive the events; at the bottom it follows new messages.
 */
export class ThreadView {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private readonly olderBtn: HTMLButtonElement
  private drawn = new Map<string, { el: HTMLElement; sig: string }>()

  constructor(
    private readonly o: ThreadOpts,
    onOlder: () => void,
  ) {
    this.olderBtn = h(
      'button',
      { class: 'btn btn-small crm-btn-quiet crm-thread-older', type: 'button' },
      'Mensagens anteriores',
    ) as HTMLButtonElement
    this.olderBtn.addEventListener('click', onOlder)
    this.list = h('div', { class: 'crm-thread-list' })
    this.el = h(
      'div',
      { class: 'crm-thread', role: 'log', 'aria-label': 'Mensagens da conversa', 'aria-live': 'polite', tabindex: 0 },
      this.olderBtn,
      this.list,
    )
  }

  render(t: Thread | undefined, now = Date.now()): void {
    const atBottom = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 40
    const items = threadItems(t?.items ?? [])
    this.olderBtn.hidden = !t?.more
    this.olderBtn.disabled = !!t?.loading
    const nodes: HTMLElement[] = []
    const keep = new Set<string>()
    let lastDay = ''
    for (const item of items) {
      const day = dayLabel(item.t, now)
      if (day !== lastDay) {
        nodes.push(h('div', { class: 'crm-thread-day' }, day))
        lastDay = day
      }
      const sig = JSON.stringify(item)
      let d = this.drawn.get(item.id)
      if (!d || d.sig !== sig) {
        d = { el: itemEl(item, this.o), sig }
        this.drawn.set(item.id, d)
      }
      keep.add(item.id)
      nodes.push(d.el)
    }
    for (const id of [...this.drawn.keys()]) if (!keep.has(id)) this.drawn.delete(id)
    if (!items.length) {
      nodes.push(
        h(
          'div',
          { class: 'crm-empty crm-thread-empty' },
          h(
            'p',
            {},
            t?.loading ? 'Carregando a conversa…' : t?.error ? t.error : 'Nenhuma mensagem ainda. Escreva a primeira aqui embaixo.',
          ),
        ),
      )
    }
    this.list.replaceChildren(...nodes)
    if (atBottom || !this.el.dataset.seen) {
      this.el.scrollTop = this.el.scrollHeight
      if (items.length) this.el.dataset.seen = '1'
    }
  }
}
