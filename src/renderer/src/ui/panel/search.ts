import { h, icon } from '../dom'
import { entryCategory, entryText, entryView, passesFilter } from './entries'
import { FEED_MAX, FILTERS, MOD, type LogFilter } from './helpers'
import { PanelBase } from './base'

/** Log filters, search (CSS Highlight API) and the export buttons. */
export abstract class PanelSearch extends PanelBase {
  // ---------- filtros, busca e exportação (AO-36) ----------

  protected renderTools(): void {
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

  protected setFilter(f: LogFilter): void {
    this.filter = f
    if (f === 'all') delete this.feed.dataset.filter
    else this.feed.dataset.filter = f
    this.renderTools()
    if (this.searching) this.runSearch(true)
    else this.feed.scrollTop = this.feed.scrollHeight
  }

  protected get searching(): boolean {
    return !this.searchBar.classList.contains('hidden')
  }

  openSearch(): void {
    this.searchBar.classList.remove('hidden')
    this.searchInput.focus()
    this.searchInput.select()
    if (this.searchInput.value) this.runSearch(false)
  }

  protected closeSearch(): void {
    this.searchBar.classList.add('hidden')
    this.clearMatches()
    this.searchCount.textContent = ''
    this.searchCount.title = ''
    if (document.activeElement === this.searchInput) this.searchInput.blur()
    this.trim()
  }

  /** Volta o feed às últimas FEED_MAX entradas (a busca pode ter carregado mais antigas). */
  protected trim(): void {
    while (this.feed.childElementCount > FEED_MAX) {
      this.feed.firstElementChild?.remove()
      this.from++
    }
  }

  /** Entrada antes do feed mais próxima dele que tem o termo e passa no filtro; -1 se nenhuma. */
  protected olderMatch(term: string): number {
    for (let i = this.from - 1; i >= 0; i--) {
      const e = this.log[i]
      if (passesFilter(entryCategory(e), this.filter) && entryText(e).includes(term)) return i
    }
    return -1
  }

  /** Põe no topo do feed as entradas de `log[index]` até a primeira que já estava lá. */
  protected loadOlder(index: number): void {
    if (index < 0 || index >= this.from) return
    const views: HTMLElement[] = []
    // a saída com erro marca a ferramenta que veio antes dela, como em append()
    let tool: HTMLElement | null = null
    for (const e of this.log.slice(index, this.from)) {
      const view = entryView(e)
      view.dataset.cat = entryCategory(e)
      if (e.kind === 'tool') tool = view
      else if (e.kind === 'tool_result' && e.isError && tool) tool.dataset.cat += ' err'
      views.push(view)
    }
    this.feed.prepend(...views)
    this.from = index
  }

  protected clearMatches(): void {
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
  protected runSearch(jump: boolean): void {
    const term = this.searchInput.value.trim().toLowerCase()
    const keep = this.current
    this.clearMatches()
    this.searchCount.title = ''
    if (!term) {
      this.searchCount.textContent = ''
      return
    }
    this.collect(term)
    const older = this.olderMatch(term)
    if (!this.matches.length && older >= 0) {
      // nada no que está no feed: carrega até a ocorrência mais recente das antigas
      this.loadOlder(older)
      this.collect(term)
      jump = true
    }
    if (!this.matches.length) {
      this.searchCount.textContent = 'nada'
      return
    }
    CSS.highlights?.set('log-search', new Highlight(...this.matches))
    this.goTo(jump || keep < 0 ? this.matches.length - 1 : Math.min(keep, this.matches.length - 1), jump)
  }

  /** Junta em `matches` as ocorrências do termo nas entradas visíveis do feed. */
  protected collect(term: string): void {
    this.matches = []
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
  }

  protected step(d: 1 | -1): void {
    if (!this.matches.length) return this.runSearch(true)
    const term = this.searchInput.value.trim().toLowerCase()
    if (d === -1 && this.current === 0 && term) {
      // antes da primeira do feed: carrega até a anterior no log completo, se houver
      const older = this.olderMatch(term)
      if (older >= 0) {
        const before = this.matches.length
        this.loadOlder(older)
        this.collect(term)
        CSS.highlights?.set('log-search', new Highlight(...this.matches))
        return this.goTo(Math.max(0, this.matches.length - before - 1), true)
      }
    }
    this.goTo((this.current + d + this.matches.length) % this.matches.length, true)
  }

  protected goTo(i: number, scroll: boolean): void {
    this.current = i
    const r = this.matches[i]
    CSS.highlights?.set('log-search-current', new Highlight(r))
    const term = this.searchInput.value.trim().toLowerCase()
    const more = term !== '' && this.olderMatch(term) >= 0
    this.searchCount.textContent = `${i + 1}/${this.matches.length}${more ? '+' : ''}`
    this.searchCount.title = more ? 'Há ocorrências mais antigas no log: volte da primeira (↑) para carregá-las' : ''
    if (!scroll) return
    const el = r.startContainer.parentElement
    // Saída de ferramenta recolhida abre para mostrar o termo.
    el?.closest('.entry-result.collapsed')?.classList.remove('collapsed')
    el?.scrollIntoView({ block: 'center' })
    this.stickToBottom = false
  }

  protected scheduleSearch(): void {
    if (!this.searching || this.searchTimer) return
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null
      if (this.searching) this.runSearch(false)
    }, 250)
  }
}
