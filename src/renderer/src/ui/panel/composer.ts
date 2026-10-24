import { ATTACH_LIMITS, formatBytes, kindFromName, limitError } from '@shared/attachments'
import type { AttachmentInput, LogEntry } from '@shared/types'
import { h, icon } from '../dom'
import { cleanError, modal } from '../modals'
import { sendChecked } from './economy'
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
          ...(f.kind === 'image'
            ? [
                h(
                  'button',
                  { class: 'file-chip-open', type: 'button', title: `Ver ${f.name}`, onclick: () => this.previewImage(f.id) },
                  icon('image', 13),
                  h('span', { class: 'file-chip-name' }, f.name),
                  h('span', { class: 'file-chip-size' }, formatBytes(f.file.size)),
                ),
              ]
            : [icon('file', 13), h('span', { class: 'file-chip-name' }, f.name), h('span', { class: 'file-chip-size' }, formatBytes(f.file.size))]),
          h('button', { class: 'file-chip-x', title: 'Remover anexo', onclick: () => this.removeFile(f.id) }, icon('x', 12)),
        ),
      ),
    )
  }

  private removeFile(id: string): void {
    this.files = this.files.filter((x) => x.id !== id)
    this.renderChips()
  }

  /** An attached image at full size, before it goes. */
  private previewImage(id: string): void {
    const f = this.files.find((x) => x.id === id)
    if (!f) return
    const url = URL.createObjectURL(f.file)
    const close = () => {
      URL.revokeObjectURL(url)
      el.remove()
      this.input.focus()
    }
    const size = h('span', { class: 'image-preview-size' }, formatBytes(f.file.size))
    const img = h('img', { class: 'image-preview-img', src: url, alt: f.name }) as HTMLImageElement
    img.addEventListener('load', () => (size.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${formatBytes(f.file.size)}`))
    const remove = h('button', { class: 'btn', onclick: () => (this.removeFile(id), close()) }, icon('x', 14), 'Remover anexo')
    const ok = h('button', { class: 'btn btn-primary', onclick: close }, 'Fechar')
    const el = modal(f.name, [img], [size, h('div', { class: 'grow' }), remove, ok], close)
    el.classList.add('backdrop-image')
    this.root.append(el)
    ok.focus()
  }

  protected async send(): Promise<void> {
    const text = this.input.value.trim()
    if ((!text && !this.files.length) || !this.agentId || this.sending) return
    const files = this.files
    const agentId = this.agentId
    this.sending = true
    try {
      const attachments = (): Promise<AttachmentInput[]> =>
        Promise.all(files.map(async (f) => (f.path ? { name: f.name, mime: f.file.type, path: f.path } : { name: f.name, mime: f.file.type, dataBase64: await toBase64(f.file) })))
      if (!(await sendChecked(this.root, this.state, agentId, text, attachments))) return
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
    const agentId = this.agentId
    if (e.limit && agentId && !this.helper && this.state.agents.get(agentId)?.source === 'office') {
      const limit = e.limit
      view.append(h('button', { class: 'btn btn-small limit-open', onclick: () => this.actions.chooseAccount(agentId, limit) }, 'Continuar em outra conta'))
    }
    if (e.kind === 'tool') this.lastTool = view
    else if (e.kind === 'tool_result' && e.isError && this.lastTool) this.lastTool.dataset.cat += ' err'
    this.feed.append(view)
    // Durante a busca o feed não encolhe: as ocorrências carregadas continuam no DOM.
    if (!this.searching) this.trim()
    if (scroll && this.stickToBottom) this.feed.scrollTop = this.feed.scrollHeight
    if (scroll) this.scheduleSearch()
  }
}
