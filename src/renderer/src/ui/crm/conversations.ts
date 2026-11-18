import { formatCents, formatPhone } from '@shared/crm'
import { conversationRows, GROUP_LABEL, rowTime, WAITING_LABEL, type ConversationGroup, type ConversationRow } from '@shared/crm-chat-view'
import { brDate, customerTitle, paymentStateText } from '@shared/crm-view'
import type { Customer } from '@shared/types'
import { h, icon } from '../dom'
import { crmChatStore } from './chat-store'
import { Composer } from './composer'
import { busy, crmModal, customerSelect, field, formError } from './fields'
import { crmStore } from './store'
import { ThreadView } from './thread'
import { crmError, todayIso, type CrmCtx } from './util'

// A aba Conversas (CR-14): a lista à esquerda ("Esperando você", abertas, outras), o fio no meio
// com a caixa de escrever, e a ficha curta à direita (contato, permissões, pagamentos, bot).
// Texto de cliente sempre com textContent. Spec: docs/prd/sala-de-crm.md, "Conversas".

/** The nodes that exist (replaceChildren takes no null). */
const present = (...xs: (Node | null)[]): Node[] => xs.filter((x): x is Node => x !== null)

/** localStorage: the conversation open last time. */
const OPEN_KEY = 'agent-office:crm-conversa'

export class ConversationsView {
  readonly el: HTMLElement
  private readonly list: HTMLElement
  private readonly main: HTMLElement
  private readonly side: HTMLElement
  private readonly head: HTMLElement
  private readonly composer: Composer
  private thread: ThreadView | null = null
  private current: string | null = localStorage.getItem(OPEN_KEY)
  private readonly offChat: () => void

  constructor(private readonly ctx: CrmCtx) {
    this.list = h('nav', { class: 'crm-conv-list', 'aria-label': 'Conversas' })
    this.head = h('header', { class: 'crm-conv-head' })
    this.composer = new Composer({ root: ctx.root, toast: ctx.toast })
    this.main = h('section', { class: 'crm-conv-main', 'aria-label': 'Conversa' })
    this.side = h('aside', { class: 'crm-conv-side', 'aria-label': 'Ficha do cliente' })
    this.el = h('div', { class: 'crm-view crm-conv' }, this.list, this.main, this.side)
    this.offChat = crmChatStore.on(() => this.render())
    void crmChatStore.start()
  }

  // ---------- View ----------

  render(): void {
    const data = crmStore.data
    if (!data) return
    const rows = conversationRows(crmChatStore.summaries, data.customers, Date.now())
    if (this.current && !data.customers.some((c) => c.id === this.current)) this.current = null
    this.renderList(rows)
    this.renderMain()
    this.renderSide()
  }

  focus(): void {
    const target = this.list.querySelector<HTMLElement>('.crm-conv-row.on') ?? this.list.querySelector<HTMLElement>('.crm-conv-row')
    if (target) target.focus()
    else this.list.focus()
  }

  /** "＋ Nova conversa": pick a customer. */
  create(): void {
    const data = crmStore.data
    if (!data) return
    const withPhone = data.customers.filter((c) => c.phones.length)
    if (!withPhone.length) return this.ctx.toast('Nenhum cliente com telefone. Cadastre um na aba Clientes.', 'err')
    const select = customerSelect(withPhone, '')
    const f = field('Cliente', select, 'Só aparecem os clientes com telefone.')
    const err = formError()
    const ok = h('button', { class: 'btn btn-primary', type: 'button' }, 'Abrir conversa') as HTMLButtonElement
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancelar')
    const close = () => el.remove()
    const el = crmModal(this.ctx.root, 'Nova conversa', [f.el, err.el], [cancel, ok], close)
    cancel.addEventListener('click', close)
    ok.addEventListener('click', () => {
      if (!select.value) return f.error('Escolha o cliente.')
      close()
      this.open(select.value)
    })
    select.focus()
  }

  reveal(customerId: string): boolean {
    if (!crmStore.data?.customers.some((c) => c.id === customerId)) return false
    this.open(customerId)
    return true
  }

  dispose(): void {
    this.offChat()
  }

  // ---------- abrir ----------

  open(customerId: string): void {
    this.current = customerId
    localStorage.setItem(OPEN_KEY, customerId)
    this.thread = null
    void crmChatStore.open(customerId)
    this.render()
    this.composer.focus()
  }

  // ---------- lista ----------

  private renderList(rows: ConversationRow[]): void {
    if (crmChatStore.error && !crmChatStore.loaded) {
      this.list.replaceChildren(
        h(
          'div',
          { class: 'crm-empty crm-conv-list-empty', role: 'alert' },
          h('p', {}, crmChatStore.error),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => void crmChatStore.reload() }, 'Tentar de novo'),
        ),
      )
      return
    }
    if (!rows.length) {
      this.list.replaceChildren(
        h(
          'div',
          { class: 'crm-empty crm-conv-list-empty' },
          h('p', { class: 'crm-empty-title' }, crmChatStore.loaded ? 'Nenhuma conversa ainda' : 'Carregando…'),
          crmChatStore.loaded
            ? h('p', {}, 'As mensagens do WhatsApp aparecem aqui. Conecte o número em Configurações → CRM → WhatsApp.')
            : null,
        ),
      )
      return
    }
    const now = Date.now()
    const nodes: HTMLElement[] = []
    let group: ConversationGroup | null = null
    for (const r of rows) {
      if (r.group !== group) {
        group = r.group
        const n = rows.filter((x) => x.group === group).length
        nodes.push(h('h2', { class: 'crm-conv-group' }, GROUP_LABEL[group], h('span', {}, String(n))))
      }
      const s = r.summary
      const on = s.customerId === this.current
      const sub = s.waiting ? WAITING_LABEL[s.waiting] : s.preview
      nodes.push(
        h(
          'button',
          {
            type: 'button',
            class: `crm-conv-row${on ? ' on' : ''}${s.unread ? ' unread' : ''}`,
            'aria-current': on ? 'true' : 'false',
            onclick: () => this.open(s.customerId),
          },
          h('span', { class: `dot ${s.waiting ? 'dot-waiting' : s.unread ? 'dot-working' : 'dot-idle'}`, 'aria-hidden': 'true' }),
          h('span', { class: 'crm-conv-name' }, r.company ? `${r.name} · ${r.company}` : r.name),
          h('span', { class: 'crm-conv-time' }, rowTime(s.t, now)),
          h('span', { class: `crm-conv-sub${s.waiting ? ' waiting' : ''}` }, sub),
          s.unread ? h('span', { class: 'crm-conv-unread', 'aria-label': `${s.unread} não lida(s)` }, String(s.unread)) : null,
        ),
      )
    }
    this.list.replaceChildren(...nodes)
  }

  // ---------- fio ----------

  private renderMain(): void {
    const c = this.customer()
    if (!c) {
      this.thread = null
      this.main.replaceChildren(
        h(
          'div',
          { class: 'crm-empty' },
          h('p', { class: 'crm-empty-title' }, 'Escolha uma conversa'),
          h('p', {}, 'Ou comece uma nova com "＋ Nova conversa".'),
        ),
      )
      return
    }
    if (!this.thread) {
      const id = c.id
      this.thread = new ThreadView({ root: this.ctx.root, customerId: id, toast: this.ctx.toast }, () => void crmChatStore.older(id))
      if (!crmChatStore.thread(id)) void crmChatStore.open(id)
      this.main.replaceChildren(this.head, this.thread.el, this.composer.el)
    }
    this.renderHead(c)
    this.thread.render(crmChatStore.thread(c.id))
    this.composer.set(c.id, c.name, this.blocked(c))
  }

  private renderHead(c: Customer): void {
    const handed = !!c.handedToPlayer
    const hand = h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        title: handed ? 'O bot volta a responder esta conversa' : 'O bot fica calado nesta conversa',
      },
      icon(handed ? 'bot' : 'users', 14),
      handed ? 'Devolver ao bot' : 'Passar para mim',
    ) as HTMLButtonElement
    hand.addEventListener(
      'click',
      () =>
        void busy(hand, async () => {
          try {
            await window.office.crmHandOff(c.id, !handed)
          } catch (err) {
            this.ctx.toast(crmError(err), 'err')
          }
        }),
    )
    this.head.replaceChildren(
      h('h2', { class: 'crm-conv-title' }, customerTitle(c)),
      h('span', { class: `crm-conv-bot${handed ? ' handed' : ''}` }, handed ? 'Com você' : 'Bot pode responder'),
      hand,
    )
  }

  /** Why the composer is off for this customer, or null. */
  private blocked(c: Customer): string | null {
    if (crmStore.data?.settings.stopAll) return '"Parar tudo" está ligado: nada sai até você religar no topo da tela.'
    if (!c.phones.length) return 'Este cliente não tem telefone. Ponha um número na ficha.'
    if (!c.phoneChecked) return 'O número ainda não foi conferido. Clique em "Conferir número" na ficha ao lado.'
    return null
  }

  // ---------- ficha ----------

  private renderSide(): void {
    const c = this.customer()
    const data = crmStore.data
    if (!c || !data) {
      this.side.replaceChildren()
      return
    }
    const today = todayIso()
    const pays = data.payments
      .filter((p) => p.customerId === c.id && p.state === 'open')
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 4)
    const deals = data.deals.filter((d) => d.customerId === c.id && !d.closedAt).slice(0, 3)
    const phone = c.phones[0]
    const check = h('button', { class: 'btn btn-small', type: 'button' }, 'Conferir número') as HTMLButtonElement
    check.addEventListener(
      'click',
      () =>
        void busy(check, async () => {
          try {
            await window.office.crmCheckPhone(c.id)
            this.ctx.toast('Número conferido: tem WhatsApp.', 'ok')
          } catch (err) {
            this.ctx.toast(crmError(err), 'err')
          }
        }),
    )
    const consent = c.consent
    const perm = (ok: boolean, label: string, why?: string) =>
      h(
        'li',
        { class: ok ? 'ok' : 'no' },
        h('span', { 'aria-hidden': 'true' }, ok ? '✓' : '✗'),
        h('span', {}, why ? `${label} (${why})` : label),
      )
    this.side.replaceChildren(
      ...present(
        h('h3', { class: 'crm-side-title' }, c.name),
        c.company ? h('p', { class: 'crm-side-sub' }, c.company) : null,
        h(
          'section',
          { class: 'crm-side-block' },
          h('h4', {}, 'Contato'),
          phone ? h('p', {}, formatPhone(phone)) : h('p', {}, 'Sem telefone'),
        ),
        phone ? (c.phoneChecked ? h('p', { class: 'crm-side-ok' }, 'Número conferido no WhatsApp') : check) : null,
        h(
          'section',
          { class: 'crm-side-block' },
          h('h4', {}, 'Permissões'),
          h(
            'ul',
            { class: 'crm-side-perms' },
            perm(consent.service, 'Atendimento'),
            perm(consent.billing, 'Cobrança'),
            perm(
              consent.offers && !consent.optOutAt,
              'Ofertas',
              consent.optOutAt
                ? `saiu em ${new Date(consent.optOutAt).toLocaleDateString('pt-BR')}`
                : consent.offers
                  ? undefined
                  : 'não aceitou',
            ),
          ),
        ),
        deals.length
          ? h(
              'section',
              { class: 'crm-side-block' },
              h('h4', {}, 'Negócios'),
              ...deals.map((d) => h('p', {}, `${d.title} · ${formatCents(d.valueCents)}`)),
            )
          : null,
        pays.length
          ? h(
              'section',
              { class: 'crm-side-block' },
              h('h4', {}, 'Pagamentos'),
              ...pays.map((p) => h('p', {}, `${formatCents(p.amountCents)} · vence ${brDate(p.due)} · ${paymentStateText(p, today)}`)),
            )
          : null,
        h(
          'button',
          { class: 'btn btn-small crm-btn-quiet', type: 'button', onclick: () => this.ctx.openCustomer(c.id) },
          'Abrir a ficha completa',
        ),
      ),
    )
  }

  private customer(): Customer | undefined {
    return this.current ? crmStore.data?.customers.find((c) => c.id === this.current) : undefined
  }
}
