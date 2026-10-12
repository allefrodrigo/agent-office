import { ATTACH_KIND_LABEL, ATTACH_LIMITS, formatBytes, kindFromName, limitError } from '@shared/attachments'
import type { AgentSummary, AttachmentInput, AttachmentKind, LogEntry } from '@shared/types'
import type { State } from '../state'
import { accountChip } from './accounts'
import { formatCost, h, icon } from './dom'
import { STATUS_LABEL } from './hud'
import { renderMarkdown } from './markdown'
import { cleanError, EFFORTS } from './modals'
import { helperActivity } from '@shared/describe'
import { renderHelpers } from './panel-helpers'
import { portrait } from './portrait'
import { saveAgentAsTemplate } from './templates'

const BADGE_OPEN_KEY = 'panel-badge-open'

/** Filtros do log: cada entrada tem uma ou mais categorias em data-cat. */
type LogFilter = 'all' | 'msg' | 'tool' | 'err'
const FILTERS: { value: LogFilter; label: string; title: string }[] = [
  { value: 'all', label: 'Tudo', title: 'Todo o log' },
  { value: 'msg', label: 'Mensagens', title: 'Só suas mensagens, as respostas e o resultado' },
  { value: 'tool', label: 'Ferramentas', title: 'Só ferramentas, saídas e decisões' },
  { value: 'err', label: 'Erros', title: 'Só erros (e a ferramenta que falhou)' },
]

const MOD = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl+'

export interface PanelActions {
  goTo(id: string): void
  closeTerminal(id: string): void
  openItem(agentId: string, itemId: string): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  exportConversation(agentId: string): void
  copyReport(agentId: string): void
}

/** Right-hand drawer with an agent's live log and a message box. */
export class AgentPanel {
  readonly el: HTMLDivElement
  private head: HTMLDivElement
  private banner: HTMLDivElement
  private feed: HTMLDivElement
  private composer: HTMLDivElement
  private input: HTMLTextAreaElement
  private picker: HTMLInputElement
  private chips: HTMLDivElement
  /** Files waiting to go with the next message. */
  private files: PendingFile[] = []
  private terminal = false
  private sending = false
  agentId: string | null = null
  /** Subagent whose log the feed shows instead of the agent's (AO-46); null = the agent's own. */
  helper: string | null = null
  private helpersEl: HTMLDivElement
  private stickToBottom = true
  /** Badge shows details; remembered between sessions. */
  private badgeOpen = localStorage.getItem(BADGE_OPEN_KEY) === '1'
  /** Compact/clear menu under the memory ring. */
  private memMenuOpen = false
  private tools: HTMLDivElement
  private filter: LogFilter = 'all'
  private searchBar: HTMLDivElement
  private searchInput: HTMLInputElement
  private searchCount: HTMLSpanElement
  /** Ocorrências da busca, de cima para baixo, e a atual. */
  private matches: Range[] = []
  private current = -1
  private searchTimer: ReturnType<typeof setTimeout> | null = null
  /** Última ferramenta do log: ganha a categoria "erro" quando a saída dela falha. */
  private lastTool: HTMLElement | null = null

  constructor(
    private root: HTMLElement,
    private state: State,
    private actions: PanelActions,
  ) {
    this.head = h('div', { class: 'panel-head' })
    this.banner = h('div', { class: 'panel-banner hidden' })
    this.feed = h('div', { class: 'panel-feed' })
    this.feed.addEventListener('scroll', () => {
      this.stickToBottom = this.feed.scrollTop + this.feed.clientHeight >= this.feed.scrollHeight - 30
    })
    this.input = h('textarea', { class: 'composer-input', rows: 2, placeholder: 'Mande uma nova instrução…' })
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        this.send()
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
    this.el = h('div', { class: 'panel card hidden' }, this.head, this.banner, this.helpersEl, this.tools, this.searchBar, this.feed, this.composer)
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
        e.preventDefault()
        this.openSearch()
        return
      }
      if (e.key !== 'Escape' || !this.agentId || document.activeElement === this.input) return
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

  /** `helper` opens the log of one of the agent's subagents instead of its own. */
  async open(agentId: string, helper: string | null = null): Promise<void> {
    const changed = agentId !== this.agentId || helper !== this.helper
    this.agentId = agentId
    this.helper = helper
    this.el.classList.remove('hidden')
    this.render()
    if (changed) {
      this.clearMatches()
      this.feed.replaceChildren(h('div', { class: 'feed-loading' }, 'Carregando…'))
      const log = helper ? await this.state.subLog(agentId, helper) : await this.state.log(agentId)
      if (this.agentId !== agentId || this.helper !== helper) return
      this.feed.replaceChildren()
      this.lastTool = null
      for (const e of log) this.append(e, false)
      this.feed.scrollTop = this.feed.scrollHeight
      this.stickToBottom = true
      if (this.searching) this.runSearch(true)
    }
  }

  close(): void {
    this.agentId = null
    this.helper = null
    this.memMenuOpen = false
    this.closeSearch()
    this.el.classList.add('hidden')
  }

  // ---------- filtros, busca e exportação (AO-36) ----------

  private renderTools(): void {
    const id = () => this.agentId
    this.tools.replaceChildren(
      h(
        'div',
        { class: 'panel-filters' },
        ...FILTERS.map((f) =>
          h('button', { class: `panel-filter${this.filter === f.value ? ' on' : ''}`, title: f.title, onclick: () => this.setFilter(f.value) }, f.label),
        ),
      ),
      h('div', { class: 'grow' }),
      h('button', { class: 'icon-btn', title: `Buscar no log (${MOD}F)`, onclick: () => this.openSearch() }, icon('search', 15)),
      h('button', { class: 'icon-btn', title: 'Copiar relatório (o resultado final do agente)', onclick: () => id() && this.actions.copyReport(id()!) }, icon('copy', 15)),
      h('button', { class: 'icon-btn', title: 'Exportar a conversa em Markdown (.md)', onclick: () => id() && this.actions.exportConversation(id()!) }, icon('file', 15)),
    )
  }

  private setFilter(f: LogFilter): void {
    this.filter = f
    if (f === 'all') delete this.feed.dataset.filter
    else this.feed.dataset.filter = f
    this.renderTools()
    if (this.searching) this.runSearch(true)
    else this.feed.scrollTop = this.feed.scrollHeight
  }

  private get searching(): boolean {
    return !this.searchBar.classList.contains('hidden')
  }

  openSearch(): void {
    this.searchBar.classList.remove('hidden')
    this.searchInput.focus()
    this.searchInput.select()
    if (this.searchInput.value) this.runSearch(false)
  }

  private closeSearch(): void {
    this.searchBar.classList.add('hidden')
    this.clearMatches()
    this.searchCount.textContent = ''
    if (document.activeElement === this.searchInput) this.searchInput.blur()
  }

  private clearMatches(): void {
    this.matches = []
    this.current = -1
    CSS.highlights?.delete('log-search')
    CSS.highlights?.delete('log-search-current')
  }

  /**
   * Acha o termo no texto das entradas visíveis (sem diferenciar maiúsculas) e destaca
   * com a CSS Highlight API, que não mexe no DOM do log. `jump` vai para a ocorrência
   * mais recente; sem ele, a atual fica onde estava (log ao vivo chegando).
   */
  private runSearch(jump: boolean): void {
    const term = this.searchInput.value.trim().toLowerCase()
    const keep = this.current
    this.clearMatches()
    if (!term) {
      this.searchCount.textContent = ''
      return
    }
    for (const entry of this.feed.children) {
      if (!(entry instanceof HTMLElement) || !entry.classList.contains('entry') || entry.offsetParent === null) continue
      const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.nodeValue ?? '').toLowerCase()
        for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + term.length)) {
          const r = new Range()
          r.setStart(node, at)
          r.setEnd(node, at + term.length)
          this.matches.push(r)
        }
      }
    }
    if (!this.matches.length) {
      this.searchCount.textContent = 'nada'
      return
    }
    CSS.highlights?.set('log-search', new Highlight(...this.matches))
    this.goTo(jump || keep < 0 ? this.matches.length - 1 : Math.min(keep, this.matches.length - 1), jump)
  }

  private step(d: 1 | -1): void {
    if (!this.matches.length) return this.runSearch(true)
    this.goTo((this.current + d + this.matches.length) % this.matches.length, true)
  }

  private goTo(i: number, scroll: boolean): void {
    this.current = i
    const r = this.matches[i]
    CSS.highlights?.set('log-search-current', new Highlight(r))
    this.searchCount.textContent = `${i + 1}/${this.matches.length}`
    if (!scroll) return
    const el = r.startContainer.parentElement
    // Saída de ferramenta recolhida abre para mostrar o termo.
    el?.closest('.entry-result.collapsed')?.classList.remove('collapsed')
    el?.scrollIntoView({ block: 'center' })
    this.stickToBottom = false
  }

  private scheduleSearch(): void {
    if (!this.searching || this.searchTimer) return
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null
      if (this.searching) this.runSearch(false)
    }, 250)
  }

  get isOpen(): boolean {
    return this.agentId !== null
  }

  focusInput(): void {
    this.input.focus()
  }

  render(): void {
    if (!this.agentId) return
    const a = this.state.agents.get(this.agentId)
    if (!a) {
      this.close()
      return
    }
    renderHelpers(this.helpersEl, a, this.helper, (id) => void this.open(a.id, id))
    const items = this.state.itemsFor(a.id)
    // A pending permission shows as "Responder" on the badge itself.
    this.renderHead(a, items.permissions[0]?.id)
    const result = items.results[0]
    if (result) {
      this.banner.className = 'panel-banner banner-done'
      this.banner.replaceChildren(
        h('span', {}, `${a.name} trouxe o resultado`),
        h('button', { class: 'btn btn-small', onclick: () => this.actions.openItem(a.id, result.id) }, 'Ver resultado'),
      )
    } else this.banner.className = 'panel-banner hidden'

    const terminal = a.source === 'terminal'
    this.terminal = terminal
    this.composer.classList.toggle('disabled', terminal)
    this.input.disabled = terminal
    this.input.placeholder = terminal
      ? 'Sessão do terminal: responda por lá. Permissões chegam aqui.'
      : a.status === 'working' || a.status === 'starting'
        ? 'Mande uma instrução (entra na fila do agente)…'
        : 'Mande uma nova tarefa…'
  }

  /** The agent's badge: photo ringed by memory use, name, and an LED with what it is doing. Opens for details. */
  private renderHead(a: AgentSummary, permissionId?: string): void {
    const busy = a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
    const office = a.source === 'office'
    const open = this.badgeOpen
    const ctx = office ? a.context : undefined
    const level = ctx ? contextLevel(ctx.percent) : 'ok'
    // A pending permission rides on the LED, so the name keeps its room.
    const led = (withLabel: boolean) =>
      h(
        'div',
        { class: 'ab-led-line' },
        h(
          'div',
          { class: `ab-led ab-led-${a.status}`, title: a.activity },
          h('span', { class: `dot dot-${a.status}` }),
          h('span', { class: 'ab-led-text' }, withLabel ? `${STATUS_LABEL[a.status]} · ${a.activity}` : a.activity),
        ),
        permissionId
          ? h('button', { class: 'btn btn-small btn-warn', onclick: () => this.actions.openItem(a.id, permissionId) }, icon('reply', 13), 'Responder')
          : null,
      )
    const name = h('span', { class: 'ab-name' }, a.name)
    this.head.replaceChildren(
      h(
        'div',
        { class: `ab ab-${level}${open ? ' ab-open' : ''}` },
        h(
          'div',
          { class: 'ab-row' },
          this.photo(a, open ? 62 : 44, busy),
          h(
            'div',
            { class: 'ab-id' },
            h('div', { class: 'ab-name-row' }, name, a.source === 'terminal' ? h('span', { class: 'chip chip-term' }, 'terminal') : null, branchChip(a), open ? null : accountChip(this.state, a), helpersChip(a, !open)),
            open ? h('div', { class: 'ab-role' }, a.role === 'orchestrator' ? 'Orquestrador' : 'Agente', accountChip(this.state, a)) : led(false),
          ),
          office && busy ? h('button', { class: 'icon-btn', title: 'Interromper', onclick: () => window.office.interrupt(a.id) }, icon('stop', 15)) : null,
          h('button', { class: 'icon-btn ab-toggle', title: open ? 'Menos detalhes' : 'Mais detalhes', onclick: () => this.toggleBadge() }, icon('chevron', 16)),
          h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => this.close() }, icon('x', 16)),
        ),
        open ? this.badgeDetails(a, led(true), busy) : null,
      ),
      ...(this.memMenuOpen && ctx ? [this.memMenu(a, busy)] : []),
    )
  }

  /** Portrait inside a ring that fills as the conversation fills; click it to compact or clear. */
  private photo(a: AgentSummary, size: number, _busy: boolean): HTMLElement {
    const c = a.source === 'office' ? a.context : undefined
    if (!c) return h('div', { class: 'ab-photo' }, portrait(a.look, size - 8))
    const stroke = size > 50 ? 4 : 3
    const r = size / 2 - stroke / 2 - 1
    const len = 2 * Math.PI * r
    const pct = Math.min(100, c.percent)
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    ring.setAttribute('class', 'ab-ring-svg')
    ring.setAttribute('width', String(size))
    ring.setAttribute('height', String(size))
    ring.innerHTML =
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ab-ring-track"/>` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" class="ab-ring-fill" stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - pct / 100)}"/>`
    const pic = portrait(a.look, size - (stroke + 3) * 2)
    pic.classList.add('ab-ring-pic')
    return h(
      'button',
      {
        class: 'ab-ring',
        style: `width:${size}px;height:${size}px`,
        title: `Memória: ${c.percent}% (${c.used.toLocaleString('pt-BR')} de ${c.max.toLocaleString('pt-BR')} tokens). Clique para compactar ou limpar.`,
        onclick: (e: Event) => {
          e.stopPropagation()
          this.memMenuOpen = !this.memMenuOpen
          this.renderHead(a, this.state.itemsFor(a.id).permissions[0]?.id)
        },
      },
      ring,
      pic,
      h('span', { class: 'ab-ring-pct' }, `${c.percent}%`),
    )
  }

  private memMenu(a: AgentSummary, busy: boolean): HTMLElement {
    const done = () => {
      this.memMenuOpen = false
      this.render()
    }
    return h(
      'div',
      { class: 'ab-menu', onclick: (e: Event) => e.stopPropagation() },
      h('div', { class: 'ab-menu-head' }, `Memória ${a.context!.percent}% usada`),
      h(
        'button',
        {
          disabled: busy,
          title: busy ? 'Espere o agente terminar para compactar.' : 'Resume a conversa até aqui. O agente continua sabendo o essencial.',
          onclick: () => {
            window.office.compact(a.id)
            done()
          },
        },
        icon('compact', 14),
        'Compactar',
        h('small', {}, '/compact'),
      ),
      h(
        'button',
        {
          onclick: () => {
            done()
            this.clear(a)
          },
        },
        icon('reset', 14),
        'Limpar e começar do zero',
        h('small', {}, '/clear'),
      ),
    )
  }

  /** The open half of the badge: status, stamps, memory blocks and the rarer actions. */
  private badgeDetails(a: AgentSummary, led: HTMLElement, busy: boolean): HTMLElement {
    const office = a.source === 'office'
    const effort = a.effort ? (EFFORTS.find((e) => e.value === a.effort)?.label.toLowerCase() ?? a.effort) : null
    return h(
      'div',
      { class: 'ab-more' },
      led,
      h(
        'div',
        { class: 'ab-stamps' },
        h('button', { class: 'ab-stamp', title: `${a.cwd}\nMostrar no Finder`, onclick: () => window.office.revealPath(a.cwd) }, icon('folder', 12), shortPath(a.cwd)),
        a.worktree ? h('button', { class: 'ab-stamp', title: `Cópia isolada (worktree)\n${a.worktree.root}\nMostrar no Finder`, onclick: () => window.office.revealPath(a.worktree!.root) }, icon('branch', 12), a.worktree.branch) : null,
        a.model ? h('span', { class: 'ab-stamp', title: a.model }, icon('cpu', 12), modelLabel(a.model)) : null,
        effort ? h('span', { class: 'ab-stamp', title: 'Esforço' }, icon('gauge', 12), effort) : null,
        a.costUsd ? h('span', { class: 'ab-stamp', title: 'Gasto nesta sessão' }, icon('coin', 12), formatCost(a.costUsd)) : null,
      ),
      office && a.context ? this.memoryBlocks(a, busy) : null,
      h(
        'div',
        { class: 'ab-foot' },
        h('button', { class: 'btn btn-small', onclick: () => this.actions.goTo(a.id) }, icon('walk', 14), 'Ir até'),
        office
          ? h('button', { class: 'btn btn-small', title: 'Guarda nome, aparência, modelo, permissões e a primeira tarefa para contratar de novo', onclick: () => void saveAgentAsTemplate(this.root, this.state, a, this.actions.toast) }, icon('copy', 14), 'Salvar como modelo')
          : null,
        office
          ? h('button', { class: 'ab-fire', onclick: () => this.fire(a) }, 'Dispensar agente')
          : h('button', { class: 'ab-fire', onclick: () => this.actions.closeTerminal(a.id) }, 'Fechar sessão'),
      ),
    )
  }

  /** How full the agent's memory is, in ten blocks, with ways to free it. */
  private memoryBlocks(a: AgentSummary, busy: boolean): HTMLElement {
    const c = a.context!
    const level = contextLevel(c.percent)
    const lit = Math.min(10, Math.round(c.percent / 10))
    const hint =
      level === 'full'
        ? 'Quase cheia. Ao encher, o Claude compacta sozinho e pode esquecer detalhes. Compacte agora ou limpe se a próxima tarefa for outra.'
        : level === 'warn'
          ? 'Enchendo. Se a próxima tarefa não tem a ver com esta, limpe.'
          : null
    return h(
      'div',
      { class: `ab-mem ctx-${level}` },
      h(
        'div',
        { class: 'ab-mem-row' },
        h('span', { class: 'ab-mem-label' }, 'Memória'),
        h('div', { class: 'ab-blocks' }, ...Array.from({ length: 10 }, (_, i) => h('i', { class: i < lit ? 'on' : '' }))),
        h('span', { class: 'ctx-num', title: `${c.used.toLocaleString('pt-BR')} de ${c.max.toLocaleString('pt-BR')} tokens` }, `${c.percent}%`),
        h('button', {
          class: 'btn btn-small',
          title: 'Resume a conversa até aqui (/compact). O agente continua sabendo o essencial.',
          disabled: busy,
          onclick: () => window.office.compact(a.id),
        }, 'Compactar'),
        h('button', {
          class: 'btn btn-small',
          title: 'Começa uma conversa nova com o mesmo agente (/clear).',
          onclick: () => this.clear(a),
        }, 'Limpar'),
      ),
      hint ? h('div', { class: 'ctx-hint' }, hint) : null,
    )
  }

  private toggleBadge(): void {
    this.badgeOpen = !this.badgeOpen
    localStorage.setItem(BADGE_OPEN_KEY, this.badgeOpen ? '1' : '0')
    this.render()
  }

  private async clear(a: AgentSummary): Promise<void> {
    if (!confirm(`Limpar a memória de ${a.name}? Ele continua no escritório, mas esquece esta conversa. O histórico fica salvo na Central de resume.`)) return
    await window.office.clearContext(a.id)
  }

  private async fire(a: AgentSummary): Promise<void> {
    // With a worktree the native dialog (keep or remove the copy) is the confirmation.
    const asked = await window.office.prepareFire(a.id)
    if (asked === 'cancelled') return
    if (asked === 'plain' && !confirm(`Dispensar ${a.name}? A sessão para e o agente vai embora pelo elevador.`)) return
    const note = await window.office.fire(a.id)
    if (note) this.actions.toast(note, 'info')
    this.close()
  }

  private attach(list: File[]): void {
    if (this.terminal) return
    for (const file of list) {
      if (this.files.length >= ATTACH_LIMITS.count) {
        this.actions.toast(`Dá para mandar até ${ATTACH_LIMITS.count} anexos por vez. Envie estes e anexe o resto na próxima mensagem.`, 'err')
        break
      }
      const path = window.office.pathForFile(file)
      // Pasted screenshots all arrive as "image.png".
      const name = path || file.name !== 'image.png' ? file.name || 'anexo' : `imagem-colada-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`
      // One paste can list the same screenshot twice; a file can also be dropped again by mistake.
      const key = path || `${file.type}:${file.size}:${file.lastModified}`
      if (this.files.some((f) => f.key === key)) continue
      const kind = kindFromName(name, file.type)
      // A big text file from disk is fine: it goes as a path. The main process re-checks everything by content.
      const err = kind === 'image' || kind === 'pdf' || (kind === 'text' && !path) ? limitError(name, kind, file.size) : null
      if (err) {
        this.actions.toast(err, 'err')
        continue
      }
      this.files.push({ id: crypto.randomUUID(), key, file, name, path, kind })
    }
    this.renderChips()
  }

  private renderChips(): void {
    this.chips.classList.toggle('hidden', !this.files.length)
    this.chips.replaceChildren(
      ...this.files.map((f) =>
        h(
          'span',
          { class: 'file-chip', title: f.path || f.name },
          icon(f.kind === 'image' ? 'image' : 'file', 13),
          h('span', { class: 'file-chip-name' }, f.name),
          h('span', { class: 'file-chip-size' }, formatBytes(f.file.size)),
          h(
            'button',
            {
              class: 'file-chip-x',
              title: 'Remover anexo',
              onclick: () => {
                this.files = this.files.filter((x) => x.id !== f.id)
                this.renderChips()
              },
            },
            icon('x', 12),
          ),
        ),
      ),
    )
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim()
    if ((!text && !this.files.length) || !this.agentId || this.sending) return
    const files = this.files
    this.sending = true
    try {
      const attachments: AttachmentInput[] = await Promise.all(
        files.map(async (f) => (f.path ? { name: f.name, mime: f.file.type, path: f.path } : { name: f.name, mime: f.file.type, dataBase64: await toBase64(f.file) })),
      )
      await window.office.send(this.agentId, text, attachments)
      // Cleared only once it went, so a rejected file can be removed and the rest sent again.
      if (this.input.value.trim() === text) this.input.value = ''
      this.files = this.files.filter((f) => !files.includes(f))
      this.renderChips()
    } catch (err) {
      this.actions.toast(cleanError(err), 'err')
    } finally {
      this.sending = false
    }
  }

  private append(e: LogEntry, scroll = true): void {
    this.feed.querySelector('.feed-loading')?.remove()
    const view = entryView(e)
    view.dataset.cat = entryCategory(e)
    if (e.kind === 'tool') this.lastTool = view
    else if (e.kind === 'tool_result' && e.isError && this.lastTool) this.lastTool.dataset.cat += ' err'
    this.feed.append(view)
    while (this.feed.childElementCount > 400) this.feed.firstElementChild?.remove()
    if (scroll && this.stickToBottom) this.feed.scrollTop = this.feed.scrollHeight
    if (scroll) this.scheduleSearch()
  }
}

/** msg = conversa; tool = ferramentas e decisões; err = erros; other = sistema e raciocínio (só em "Tudo"). */
export function entryCategory(e: LogEntry): string {
  switch (e.kind) {
    case 'user':
    case 'assistant':
      return 'msg'
    case 'result':
      return e.isError ? 'err' : 'msg'
    case 'tool':
    case 'decision':
      return 'tool'
    case 'tool_result':
      return e.isError ? 'tool err' : 'tool'
    case 'error':
      return 'err'
    default:
      return 'other'
  }
}

function entryView(e: LogEntry): HTMLElement {
  switch (e.kind) {
    case 'user':
      return h(
        'div',
        { class: 'entry entry-user' },
        h(
          'div',
          { class: 'entry-bubble' },
          e.text,
          e.attachments?.length
            ? h(
                'div',
                { class: 'entry-files' },
                e.attachments.map((a) =>
                  h('span', { class: 'file-chip', title: `${ATTACH_KIND_LABEL[a.kind]} · ${formatBytes(a.size)}` }, icon(a.kind === 'image' ? 'image' : 'file', 12), h('span', { class: 'file-chip-name' }, a.name)),
                ),
              )
            : null,
        ),
      )
    case 'assistant':
      return h('div', { class: 'entry entry-assistant' }, renderMarkdown(e.text))
    case 'tool':
      return h('div', { class: 'entry entry-tool' }, h('span', { class: 'tool-name' }, e.tool ?? 'tool'), h('span', { class: 'tool-text' }, e.text))
    case 'tool_result': {
      const pre = h('pre', { class: 'entry-pre' + (e.isError ? ' err' : '') }, e.text)
      const wrap = h('div', { class: 'entry entry-result collapsed' }, pre)
      wrap.addEventListener('click', () => wrap.classList.toggle('collapsed'))
      return wrap
    }
    case 'decision':
      return h('div', { class: 'entry entry-decision' }, icon('check', 13), e.text)
    case 'result':
      return h('div', { class: 'entry entry-final' + (e.isError ? ' err' : '') }, h('div', { class: 'final-label' }, e.isError ? 'Erro' : 'Resultado entregue'), renderMarkdown(e.text))
    case 'error':
      return h('div', { class: 'entry entry-error' }, e.text)
    default:
      return h('div', { class: 'entry entry-system' }, e.text)
  }
}

/** "3 ajudantes" chip ("+3" when compact); hover lists what each subagent is doing. */
export function helpersChip(a: AgentSummary, compact = false): HTMLElement | null {
  const subs = a.subagents ?? []
  if (!subs.length) return null
  const label = subs.length === 1 ? '1 ajudante' : `${subs.length} ajudantes`
  const title = [label, ...subs.map((x) => `${x.type ? `${x.type}: ` : ''}${x.description} · ${helperActivity(x)}`)].join('\n')
  return h('span', { class: 'chip chip-helpers', title }, compact ? `+${subs.length}` : label)
}

export function contextLevel(percent: number): 'ok' | 'warn' | 'full' {
  return percent >= 85 ? 'full' : percent >= 60 ? 'warn' : 'ok'
}

interface PendingFile {
  id: string
  /** Same key = same file: the path, or type/size/time for pasted data. */
  key: string
  file: File
  name: string
  /** '' when the file has no place on disk (pasted). */
  path: string
  kind: AttachmentKind
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error(`Não consegui ler ${file.name}. Anexe de novo.`))
    r.readAsDataURL(file)
  })
}

/** The agent's own branch when it works in a worktree: "agent/ada-1234abcd" shows as "ada-1234abcd". */
function branchChip(a: AgentSummary): HTMLElement | null {
  if (!a.worktree) return null
  return h(
    'span',
    { class: 'chip chip-branch', title: `Cópia isolada (worktree) no branch ${a.worktree.branch}\n${a.worktree.root}` },
    icon('branch', 11),
    a.worktree.branch.replace(/^agent\//, ''),
  )
}

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}

/** "claude-opus-5-5[1m]" → "Opus 5.5 · 1M"; aliases like "opus" → "Opus". Anything else stays as is. */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(model)
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1)
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ' · 1M' : ''}`
  return /^[a-z]+$/.test(model) ? cap(model) : model
}
