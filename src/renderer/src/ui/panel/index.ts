import { h } from '../dom'
import { FEED_MAX } from './helpers'
import { PanelComposer } from './composer'

export type { PanelActions } from './helpers'
export { contextLevel, helpersChip, modelLabel } from './helpers'
export { entryCategory } from './entries'

/** Right-hand drawer with an agent's live log and a message box. */
export class AgentPanel extends PanelComposer {
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
      this.log = log
      this.from = Math.max(0, log.length - FEED_MAX)
      for (const e of log.slice(this.from)) this.append(e, false)
      this.feed.scrollTop = this.feed.scrollHeight
      this.stickToBottom = true
      if (this.searching) this.runSearch(true)
    }
  }

  close(): void {
    this.interruptAsk?.abort()
    this.agentId = null
    this.helper = null
    this.memMenuOpen = false
    this.closeSearch()
    this.log = []
    this.from = 0
    this.el.classList.add('hidden')
  }

  get isOpen(): boolean {
    return this.agentId !== null
  }

  focusInput(): void {
    this.input.focus()
  }
}
