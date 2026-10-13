import type { LogEntry } from '@shared/types'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { BADGE_OPEN_KEY, type LogFilter, type PanelActions, type PendingFile } from './helpers'

/**
 * State shared by every part of the agent panel (panel/*.ts) and the DOM it builds.
 * Each part extends the previous one; AgentPanel (index.ts) is the last.
 */
export abstract class PanelBase {
  readonly el: HTMLDivElement
  protected head: HTMLDivElement
  protected banner: HTMLDivElement
  protected feed: HTMLDivElement
  protected composer: HTMLDivElement
  protected input: HTMLTextAreaElement
  protected picker: HTMLInputElement
  protected chips: HTMLDivElement
  /** Files waiting to go with the next message. */
  protected files: PendingFile[] = []
  protected terminal = false
  protected sending = false
  agentId: string | null = null
  /** Subagent whose log the feed shows instead of the agent's (AO-46); null = the agent's own. */
  helper: string | null = null
  protected helpersEl: HTMLDivElement
  protected stickToBottom = true
  /** Badge shows details; remembered between sessions. */
  protected badgeOpen = localStorage.getItem(BADGE_OPEN_KEY) === '1'
  /** Compact/clear menu under the memory ring. */
  protected memMenuOpen = false
  protected tools: HTMLDivElement
  protected filter: LogFilter = 'all'
  protected searchBar: HTMLDivElement
  protected searchInput: HTMLInputElement
  protected searchCount: HTMLSpanElement
  /** Ocorrências da busca, de cima para baixo, e a atual. */
  protected matches: Range[] = []
  protected current = -1
  protected searchTimer: ReturnType<typeof setTimeout> | null = null
  /** Última ferramenta do log: ganha a categoria "erro" quando a saída dela falha. */
  protected lastTool: HTMLElement | null = null
  /** O log inteiro do agente aberto (o mesmo array do State, que cresce ao vivo). */
  protected log: LogEntry[] = []
  /** Índice em `log` da primeira entrada no feed: as anteriores não estão no DOM. */
  protected from = 0

  constructor(
    protected root: HTMLElement,
    protected state: State,
    protected actions: PanelActions,
  ) {
    this.head = h('div', { class: 'panel-head' })
    this.banner = h('div', { class: 'panel-banner hidden' })
    this.feed = h('div', { class: 'panel-feed' })
    this.feed.addEventListener('scroll', () => {
      this.stickToBottom = this.feed.scrollTop + this.feed.clientHeight >= this.feed.scrollHeight - 30
    })
    this.input = h('textarea', { class: 'composer-input', rows: 2, placeholder: 'Mande uma nova instrução…', 'aria-label': 'Mensagem para o agente (Enter envia, Esc vai ao cartão aberto)' })
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        this.send()
      } else if (e.key === 'Escape' && !e.isComposing) {
        // Leaves the box: to the card waiting for a decision, or out, so shortcuts work again.
        e.preventDefault()
        if (!this.actions.focusCard()) this.input.blur()
      }
      e.stopPropagation()
    })
    this.input.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      this.attach(files)
    })
    this.picker = h('input', { type: 'file', multiple: true, class: 'hidden' })
    this.picker.addEventListener('change', () => {
      this.attach([...(this.picker.files ?? [])])
      this.picker.value = ''
    })
    this.chips = h('div', { class: 'composer-files hidden' })
    this.composer = h(
      'div',
      { class: 'composer' },
      this.chips,
      h(
        'div',
        { class: 'composer-row' },
        h('button', { class: 'btn btn-icon', title: 'Anexar arquivos (ou arraste, ou cole uma imagem)', onclick: () => this.picker.click() }, icon('clip', 16)),
        this.input,
        h('button', { class: 'btn btn-primary btn-icon', title: 'Enviar (Enter)', onclick: () => this.send() }, icon('send', 16)),
      ),
      this.picker,
    )
    this.tools = h('div', { class: 'panel-tools' })
    this.searchInput = h('input', { class: 'input panel-search-input', placeholder: 'Buscar no log…', spellcheck: false })
    this.searchCount = h('span', { class: 'panel-search-count' })
    this.searchInput.addEventListener('input', () => this.runSearch(true))
    this.searchInput.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Escape') this.closeSearch()
      else if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        this.step(1)
      } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
        e.preventDefault()
        this.step(-1)
      }
    })
    this.searchBar = h(
      'div',
      { class: 'panel-search hidden' },
      icon('search', 14),
      this.searchInput,
      this.searchCount,
      h('button', { class: 'icon-btn', title: 'Anterior (↑)', onclick: () => this.step(-1) }, h('span', { class: 'arrow-up' }, icon('chevron', 15))),
      h('button', { class: 'icon-btn', title: 'Próxima (↓)', onclick: () => this.step(1) }, h('span', { class: 'arrow-down' }, icon('chevron', 15))),
      h('button', { class: 'icon-btn', title: 'Fechar busca (Esc)', onclick: () => this.closeSearch() }, icon('x', 15)),
    )
    this.renderTools()
    this.helpersEl = h('div', { class: 'panel-helpers-slot' })
    this.el = h('div', { class: 'panel card hidden', role: 'region', 'aria-label': 'Painel do agente' }, this.head, this.banner, this.helpersEl, this.tools, this.searchBar, this.feed, this.composer)
    this.el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files') || this.terminal) return
      e.preventDefault()
      this.el.classList.add('drop-target')
    })
    this.el.addEventListener('dragleave', (e) => {
      if (!this.el.contains(e.relatedTarget as Node | null)) this.el.classList.remove('drop-target')
    })
    this.el.addEventListener('drop', (e) => {
      this.el.classList.remove('drop-target')
      if (!e.dataTransfer?.files.length || this.terminal) return
      e.preventDefault()
      this.attach([...e.dataTransfer.files])
      this.input.focus()
    })
    root.append(this.el)

    state.onLog((agentId, entry) => {
      if (agentId === this.agentId && !this.helper) this.append(entry)
    })
    state.onSubLog((agentId, subId, entries) => {
      if (agentId === this.agentId && subId === this.helper) for (const e of entries) this.append(e)
    })
    window.addEventListener('keydown', (e) => {
      // ⌘F (Ctrl+F fora do Mac) busca no log do agente aberto.
      if (this.agentId && e.key.toLowerCase() === 'f' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        // Um modal ou o quadro por cima: a busca do painel ficaria escondida atrás dele.
        if (document.querySelector('.backdrop, .board:not(.hidden)')) return
        e.preventDefault()
        this.openSearch()
        return
      }
      if (e.key !== 'Escape' || !this.agentId || document.activeElement === this.input) return
      // Esc on the card closes the card only.
      if (document.activeElement?.closest('.dialog')) return
      if (this.memMenuOpen) {
        this.memMenuOpen = false
        this.render()
      } else this.close()
    })
    window.addEventListener('click', () => {
      if (!this.memMenuOpen) return
      this.memMenuOpen = false
      this.render()
    })
  }

  abstract open(agentId: string, helper?: string | null): Promise<void>
  abstract close(): void
  abstract render(): void
  abstract openSearch(): void
  protected abstract renderTools(): void
  protected abstract closeSearch(): void
  protected abstract runSearch(jump: boolean): void
  protected abstract step(d: 1 | -1): void
  protected abstract attach(list: File[]): void
  protected abstract send(): Promise<void>
  protected abstract append(e: LogEntry, scroll?: boolean): void
}
