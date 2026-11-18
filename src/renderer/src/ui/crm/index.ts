import './crm.css'
import { searchCrm } from '@shared/crm'
import { CRM_TAB_LABEL, type CrmHit, type CrmTab } from '@shared/types'
import type { State } from '../../state'
import { modalA11y } from '../a11y'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import { connectionDot } from './connect'
import { ConversationsView } from './conversations'
import { closeCustomerCard, openCustomerCard, refreshCustomerCard } from './customer-card'
import { CustomersView } from './customers'
import { DealsView } from './deals'
import { OPEN_CRM_EVENT, type OpenCrmDetail } from './open'
import { PaymentsView } from './payments'
import { serverChip } from './server'
import { crmStore } from './store'
import { crmError, todayIso, type CrmCtx, type Toast } from './util'

export { openCrm, OPEN_CRM_EVENT } from './open'
export { crmStore } from './store'
export { crmChatStore } from './chat-store'

// Sala de CRM (CR-04 a CR-06, CR-14): tela cheia no molde do Chat. Abas no topo (Conversas,
// Clientes, Negócios e Pagamentos; Sugestões chega na fase 4), à direita o servidor local, "Parar
// tudo", a busca e "＋ Novo" (cria o que a aba mostra). Esc fecha; abre na última aba vista.
// Spec: docs/prd/sala-de-crm.md ("Experiência").

/** The tabs so far. Sugestões (phase 4) joins when it exists: no empty tab. */
const TABS: readonly CrmTab[] = ['conversations', 'customers', 'deals', 'payments']
/** localStorage: the last tab seen, where the CRM opens. */
const TAB_KEY = 'agent-office:crm-aba'
const NEW_LABEL: Partial<Record<CrmTab, string>> = {
  conversations: 'Nova conversa',
  customers: 'Novo cliente',
  deals: 'Novo negócio',
  payments: 'Novo pagamento',
}
const HIT_KIND: Record<CrmHit['kind'], string> = { customer: 'Cliente', deal: 'Negócio', payment: 'Pagamento' }
/** Hits the search shows under the field. */
const HITS = 8

interface View {
  el: HTMLElement
  render(): void
  focus(): void
  create(): void
  reveal(id: string): boolean
  readonly menuOpen?: boolean
  closeMenu?(): void
  dispose?(): void
}

let screen: { close(): void; open(detail: OpenCrmDetail): void } | null = null

/** The CRM is on screen (for who decides whether a key is its own). */
export function crmScreenOpen(): boolean {
  return screen !== null
}

/** Closes the screen ("CRM (prévia)" turned off). */
export function closeCrm(): void {
  screen?.close()
}

export interface CrmOptions {
  toast: Toast
  /**
   * The office's toasts go into the CRM's top bar while it is open (they used to cover the
   * screen's lower left corner, over the tables); null gives them back.
   */
  toastHost?(el: HTMLElement | null): void
  /** Opens the board on a ticket (the CRM closes first: the board sits under it). */
  openTicket(id: string): void
}

/** Wires the CRM to the app, once at boot: OPEN_CRM_EVENT opens the screen (key V, the button). */
export function mountCrm(root: HTMLElement, state: State, opts: CrmOptions): void {
  window.addEventListener(OPEN_CRM_EVENT, (e) => {
    const detail = (e as CustomEvent<OpenCrmDetail>).detail ?? {}
    if (screen) screen.open(detail)
    else openCrmScreen(root, state, opts, detail)
  })
}

function isTab(v: unknown): v is CrmTab {
  return TABS.includes(v as CrmTab)
}

function openCrmScreen(root: HTMLElement, state: State, opts: CrmOptions, detail: OpenCrmDetail): void {
  const saved = localStorage.getItem(TAB_KEY)
  let tab: CrmTab = isTab(detail.tab) ? detail.tab : isTab(saved) ? saved : 'customers'
  let closed = false

  // ---------- frame ----------
  const title = h('h1', { class: 'crm-title' }, 'CRM')
  const tabs = h('div', { class: 'crm-tabs', role: 'tablist', 'aria-label': 'Seções do CRM' })
  const searchInput = h('input', {
    class: 'crm-search-input',
    type: 'search',
    placeholder: 'Buscar cliente, negócio ou fatura',
    'aria-label': 'Buscar no CRM',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': 'crm-search-hits',
    'aria-keyshortcuts': 'Meta+K Control+K',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement
  const hitsBox = h('ul', { class: 'crm-hits', id: 'crm-search-hits', role: 'listbox', 'aria-label': 'Resultados da busca', hidden: true })
  const search = h('div', { class: 'crm-search' }, icon('search', 15), searchInput, hitsBox)
  const newBtn = h('button', { class: 'btn crm-btn-accent crm-new', type: 'button' }, icon('plus', 15), h('span', {}, ''))
  const closeBtn = h(
    'button',
    { class: 'crm-icon-btn', type: 'button', title: 'Fechar (Esc)', 'aria-label': 'Fechar o CRM' },
    icon('x', 18),
  )
  const panel = h('main', { class: 'crm-panel', role: 'tabpanel', id: 'crm-panel', tabindex: -1 })
  // The office's toasts land here, in the free space of the bar, instead of over the tables.
  const toastSlot = h('div', { class: 'crm-toasts', role: 'status', 'aria-live': 'polite' })
  const server = serverChip({ toast: opts.toast })
  const whatsapp = connectionDot()
  const stopBtn = h('button', { class: 'btn crm-stop', type: 'button' }) as HTMLButtonElement
  const box = h(
    'div',
    { class: 'crm-screen' },
    h('header', { class: 'crm-top' }, title, tabs, toastSlot, whatsapp.el, server.el, stopBtn, search, newBtn, closeBtn),
    panel,
  )
  const el = h('div', { class: 'backdrop crm-backdrop' }, box)

  const ctx: CrmCtx = {
    root: el,
    state,
    toast: opts.toast,
    openTicket: (id) => {
      close()
      opts.openTicket(id)
    },
    openCustomer: (id) => openCustomerCard(box, ctx, id),
  }
  const views: Record<string, View> = {
    conversations: new ConversationsView(ctx),
    customers: new CustomersView(ctx),
    deals: new DealsView(ctx),
    payments: new PaymentsView(ctx),
  }
  const view = (): View => views[tab]

  modalA11y(el, box, title)
  root.append(el)
  opts.toastHost?.(toastSlot)

  // ---------- tabs ----------
  function renderTabs(): void {
    tabs.replaceChildren(
      ...TABS.map((t) =>
        h(
          'button',
          {
            type: 'button',
            class: `crm-tab${t === tab ? ' on' : ''}`,
            role: 'tab',
            id: `crm-tab-${t}`,
            'aria-selected': String(t === tab),
            'aria-controls': 'crm-panel',
            tabindex: t === tab ? 0 : -1,
            onclick: () => setTab(t, true),
          },
          CRM_TAB_LABEL[t],
        ),
      ),
    )
    panel.setAttribute('aria-labelledby', `crm-tab-${tab}`)
    newBtn.lastElementChild!.textContent = NEW_LABEL[tab] ?? 'Novo'
  }

  tabs.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const i = TABS.indexOf(tab)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length
    setTab(TABS[next], false)
    tabs.querySelector<HTMLElement>(`#crm-tab-${TABS[next]}`)?.focus()
  })

  function setTab(next: CrmTab, focusView: boolean): void {
    if (next !== tab) {
      tab = next
      localStorage.setItem(TAB_KEY, tab)
      renderTabs()
      showView()
    }
    if (focusView) view().focus()
  }

  function showView(): void {
    if (!crmStore.data) return renderState()
    panel.replaceChildren(view().el)
    view().render()
  }

  /** Loading, or why the CRM did not load, with "Tentar de novo". */
  function renderState(): void {
    if (crmStore.error && !crmStore.data) {
      const retry = h('button', { class: 'btn', type: 'button', onclick: () => void crmStore.ensure() }, 'Tentar de novo')
      panel.replaceChildren(
        h(
          'div',
          { class: 'crm-empty', role: 'alert' },
          h('p', { class: 'crm-empty-title' }, 'Não consegui abrir o CRM.'),
          h('p', {}, crmStore.error),
          retry,
        ),
      )
      return
    }
    panel.replaceChildren(h('div', { class: 'crm-empty' }, h('p', {}, 'Carregando o CRM…')))
  }

  newBtn.addEventListener('click', () => {
    if (!crmStore.data) return opts.toast('Os dados do CRM ainda não chegaram. Espere um instante e tente de novo.', 'err')
    view().create()
  })
  closeBtn.addEventListener('click', () => close())

  // ---------- search ----------
  let hits: CrmHit[] = []
  let hitAt = -1

  function renderHits(): void {
    const q = searchInput.value.trim()
    hits = q && crmStore.data ? searchCrm(crmStore.data, q, todayIso(), HITS) : []
    hitAt = hits.length ? Math.min(Math.max(hitAt, 0), hits.length - 1) : -1
    const open = q.length > 0
    hitsBox.hidden = !open
    searchInput.setAttribute('aria-expanded', String(open))
    if (!open) return void searchInput.removeAttribute('aria-activedescendant')
    hitsBox.replaceChildren(
      ...(hits.length
        ? hits.map((hit, i) =>
            h(
              'li',
              {
                class: `crm-hit${i === hitAt ? ' on' : ''}`,
                role: 'option',
                id: `crm-hit-${i}`,
                'aria-selected': String(i === hitAt),
                onpointerdown: (e: Event) => {
                  e.preventDefault()
                  openHit(hit)
                },
              },
              h('span', { class: 'crm-hit-kind' }, HIT_KIND[hit.kind]),
              h('span', { class: 'crm-hit-title' }, hit.title),
              h('span', { class: 'crm-hit-detail' }, hit.detail),
            ),
          )
        : [
            h(
              'li',
              { class: 'crm-hit-none', role: 'option', 'aria-disabled': 'true' },
              'Nada encontrado. Busque por nome, empresa, telefone, etiqueta ou fatura.',
            ),
          ]),
    )
    if (hitAt >= 0) searchInput.setAttribute('aria-activedescendant', `crm-hit-${hitAt}`)
    else searchInput.removeAttribute('aria-activedescendant')
  }

  function closeHits(clear: boolean): void {
    if (clear) searchInput.value = ''
    hitsBox.hidden = true
    hitAt = -1
    searchInput.setAttribute('aria-expanded', 'false')
    searchInput.removeAttribute('aria-activedescendant')
  }

  function openHit(hit: CrmHit): void {
    closeHits(true)
    if (hit.kind === 'customer') return openCustomerCard(box, ctx, hit.id)
    const target: CrmTab = hit.kind === 'deal' ? 'deals' : 'payments'
    setTab(target, false)
    if (!views[target].reveal(hit.id)) opts.toast('Esse item não existe mais.', 'err')
  }

  searchInput.addEventListener('input', () => {
    hitAt = 0
    renderHits()
  })
  searchInput.addEventListener('blur', () => setTimeout(() => closeHits(false), 120))
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) renderHits()
  })
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!hits.length) return
      hitAt = (hitAt + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length
      renderHits()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[hitAt] ?? hits[0]
      if (hit) openHit(hit)
    } else if (e.key === 'Escape' && searchInput.value) {
      // the first Esc clears the search; the next closes the screen
      e.preventDefault()
      e.stopPropagation()
      closeHits(true)
    }
  })

  // ---------- Parar tudo ----------
  // Red and immediate: cancels the queue and blocks every send. Turning it back on asks first.
  function renderStop(): void {
    const on = !!crmStore.data?.settings.stopAll
    stopBtn.classList.toggle('on', on)
    stopBtn.replaceChildren(icon(on ? 'play' : 'stop', 14), on ? 'Envios parados · Religar' : 'Parar tudo')
    stopBtn.title = on ? 'Nada sai pelo WhatsApp até você religar' : 'Cancela a fila e bloqueia todo envio até você religar'
    stopBtn.setAttribute('aria-pressed', String(on))
    stopBtn.disabled = !crmStore.data
  }
  stopBtn.addEventListener('click', async () => {
    const on = !!crmStore.data?.settings.stopAll
    if (on) {
      const ok = await confirmDialog(el, {
        title: 'Religar os envios?',
        text: 'As mensagens voltam a sair pela fila, com o portão de sempre. O que "Parar tudo" cancelou não volta sozinho: reenvie pelo fio, se ainda fizer sentido.',
        confirm: 'Religar os envios',
        cancel: 'Continuar parado',
      })
      if (!ok) return
    }
    stopBtn.disabled = true
    try {
      const settings = await window.office.crmStopAll(!on)
      crmStore.put({ settings })
      opts.toast(on ? 'Envios religados.' : 'Parar tudo ligado: a fila foi cancelada e nada sai até você religar.', on ? 'ok' : 'info')
    } catch (err) {
      opts.toast(crmError(err), 'err')
    } finally {
      renderStop()
    }
  })

  // ---------- data ----------
  const offStore = crmStore.on(() => {
    if (closed) return
    renderStop()
    if (!crmStore.data) return renderState()
    if (!panel.contains(view().el)) showView()
    else view().render()
    refreshCustomerCard()
    if (!hitsBox.hidden) renderHits()
  })

  // ---------- keys and close ----------
  function close(): void {
    if (closed) return
    closed = true
    screen = null
    opts.toastHost?.(null)
    server.dispose()
    whatsapp.dispose()
    offStore()
    closeCustomerCard()
    for (const v of Object.values(views)) v.dispose?.()
    el.remove()
  }

  el.addEventListener('keydown', (e) => {
    // a window over the CRM (form, confirm, the customer card) handles its own keys
    if (el.querySelector('.backdrop')) return e.stopPropagation()
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault()
      const v = view()
      if (v.menuOpen) v.closeMenu?.()
      else close()
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      searchInput.focus()
      searchInput.select()
    }
    // WASD, the arrows and the office's letters stay out while the CRM is open
    e.stopPropagation()
  })

  /** A customer from outside (a notification, the map): the conversation on Conversas, the card elsewhere. */
  function showCustomer(customerId: string): void {
    if (tab === 'conversations') {
      if (!views.conversations.reveal(customerId)) opts.toast('Esse cliente não existe mais.', 'err')
    } else openCustomerCard(box, ctx, customerId)
  }

  screen = {
    close,
    open: (d) => {
      if (isTab(d.tab)) setTab(d.tab, true)
      if (d.customerId) showCustomer(d.customerId)
    },
  }

  // ---------- first paint ----------
  renderStop()
  renderTabs()
  showView()
  void crmStore.ensure().then(() => {
    if (closed) return
    showView()
    if (detail.customerId) showCustomer(detail.customerId)
    else view().focus()
  })
}
