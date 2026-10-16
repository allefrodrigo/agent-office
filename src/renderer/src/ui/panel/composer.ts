import { ATTACH_LIMITS, formatBytes, kindFromName, limitError } from '@shared/attachments'
import { adviseAgent } from '@shared/economy'
import type { AttachmentInput, LogEntry } from '@shared/types'
import { h, icon } from '../dom'
import { cleanError } from '../modals'
import { askCold, warnTokens } from './economy'
import { entryCategory, entryView } from './entries'
import { toBase64 } from './helpers'
import { PanelHead } from './head'

/** The message box: attachments, sending, and new log entries in the feed. */
export abstract class PanelComposer extends PanelHead {
  protected attach(list: File[]): void {
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

  protected renderChips(): void {
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

  protected async send(): Promise<void> {
    const text = this.input.value.trim()
    if ((!text && !this.files.length) || !this.agentId || this.sending) return
    const files = this.files
    const agentId = this.agentId
    this.sending = true
    try {
      // A cold agent with a big conversation: the cheap way is to clear before sending.
      const a = this.state.agents.get(agentId)
      const advice = a && this.state.settings.coldConfirm !== false ? adviseAgent(a, warnTokens(this.state.settings)) : null
      if (a && advice?.kind === 'cold') {
        const choice = await askCold(this.root, a, advice)
        if (choice === 'cancel') return
        if (choice === 'clear') await window.office.clearContext(agentId)
      }
      const attachments: AttachmentInput[] = await Promise.all(
        files.map(async (f) => (f.path ? { name: f.name, mime: f.file.type, path: f.path } : { name: f.name, mime: f.file.type, dataBase64: await toBase64(f.file) })),
      )
      await window.office.send(agentId, text, attachments)
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

  protected append(e: LogEntry, scroll = true): void {
    this.feed.querySelector('.feed-loading')?.remove()
    const view = entryView(e)
    view.dataset.cat = entryCategory(e)
    if (e.kind === 'tool') this.lastTool = view
    else if (e.kind === 'tool_result' && e.isError && this.lastTool) this.lastTool.dataset.cat += ' err'
    this.feed.append(view)
    // Durante a busca o feed não encolhe: as ocorrências carregadas continuam no DOM.
    if (!this.searching) this.trim()
    if (scroll && this.stickToBottom) this.feed.scrollTop = this.feed.scrollHeight
    if (scroll) this.scheduleSearch()
  }
}
