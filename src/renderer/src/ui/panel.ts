import { ATTACH_KIND_LABEL, ATTACH_LIMITS, formatBytes, kindFromName, limitError } from '@shared/attachments'
import type { AgentSummary, AttachmentInput, AttachmentKind, LogEntry } from '@shared/types'
import type { State } from '../state'
import { formatCost, h, icon } from './dom'
import { STATUS_LABEL } from './hud'
import { renderMarkdown } from './markdown'
import { cleanError } from './modals'
import { osText } from './os-text'
import { portrait } from './portrait'

export interface PanelActions {
  goTo(id: string): void
  closeTerminal(id: string): void
  openItem(agentId: string, itemId: string): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
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
  private stickToBottom = true

  constructor(
    root: HTMLElement,
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
    this.el = h('div', { class: 'panel card hidden' }, this.head, this.banner, this.feed, this.composer)
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
      if (agentId === this.agentId) this.append(entry)
    })
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.agentId && document.activeElement !== this.input) this.close()
    })
  }

  async open(agentId: string): Promise<void> {
    const changed = agentId !== this.agentId
    this.agentId = agentId
    this.el.classList.remove('hidden')
    this.render()
    if (changed) {
      this.feed.replaceChildren(h('div', { class: 'feed-loading' }, 'Carregando…'))
      const log = await this.state.log(agentId)
      if (this.agentId !== agentId) return
      this.feed.replaceChildren()
      for (const e of log) this.append(e, false)
      this.feed.scrollTop = this.feed.scrollHeight
      this.stickToBottom = true
    }
  }

  close(): void {
    this.agentId = null
    this.el.classList.add('hidden')
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
    this.renderHead(a)
    const items = this.state.itemsFor(a.id)
    const first = items.permissions[0] ?? items.results[0]
    if (first) {
      const isPerm = 'kind' in first
      this.banner.className = `panel-banner ${isPerm ? 'banner-wait' : 'banner-done'}`
      this.banner.replaceChildren(
        h('span', {}, isPerm ? `${a.name} está esperando sua decisão` : `${a.name} trouxe o resultado`),
        h('button', { class: 'btn btn-small', onclick: () => this.actions.openItem(a.id, first.id) }, isPerm ? 'Responder' : 'Ver resultado'),
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

  private renderHead(a: AgentSummary): void {
    const busy = a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
    this.head.replaceChildren(
      h(
        'div',
        { class: 'panel-title' },
        portrait(a.look, 44),
        h(
          'div',
          { class: 'panel-id' },
          h('div', { class: 'panel-name' }, a.name, a.source === 'terminal' ? h('span', { class: 'chip chip-term' }, 'terminal') : null),
          h('div', { class: 'panel-status' }, h('span', { class: `dot dot-${a.status}` }), STATUS_LABEL[a.status], h('span', { class: 'sep' }, '·'), a.activity),
        ),
        h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onclick: () => this.close() }, icon('x', 18)),
      ),
      h(
        'div',
        { class: 'panel-meta' },
        h('button', { class: 'meta-path', title: osText(this.state.platform).revealTitle, onclick: () => window.office.revealPath(a.cwd) }, icon('folder', 13), shortPath(a.cwd)),
        a.model ? h('span', { class: 'meta-item' }, a.model) : null,
        a.costUsd ? h('span', { class: 'meta-item' }, formatCost(a.costUsd)) : null,
      ),
      ...(a.source === 'office' && a.context ? [this.contextMeter(a, busy)] : []),
      h(
        'div',
        { class: 'panel-actions' },
        h('button', { class: 'btn btn-small', onclick: () => this.actions.goTo(a.id) }, icon('walk', 14), 'Ir até'),
        a.source === 'office' && busy
          ? h('button', { class: 'btn btn-small', onclick: () => window.office.interrupt(a.id) }, icon('stop', 14), 'Interromper')
          : null,
        a.source === 'office'
          ? h('button', { class: 'btn btn-small btn-danger', onclick: () => this.fire(a) }, icon('fire', 14), 'Demitir')
          : h('button', { class: 'btn btn-small btn-danger', onclick: () => this.actions.closeTerminal(a.id) }, icon('x', 14), 'Fechar sessão'),
      ),
    )
  }

  /** How full the agent's memory is, with ways to free it. */
  private contextMeter(a: AgentSummary, busy: boolean): HTMLElement {
    const c = a.context!
    const level = contextLevel(c.percent)
    const hint =
      level === 'full'
        ? 'Quase cheio. Ao encher, o Claude compacta sozinho e pode esquecer detalhes. Compacte agora ou limpe se a próxima tarefa for outra.'
        : level === 'warn'
          ? 'Enchendo. Se a próxima tarefa não tem a ver com esta, limpe.'
          : null
    return h(
      'div',
      { class: `ctx ctx-${level}` },
      h(
        'div',
        { class: 'ctx-row' },
        h('span', { class: 'ctx-label' }, 'Contexto'),
        h('div', { class: 'ctx-bar' }, h('div', { class: 'ctx-fill', style: `width:${Math.min(100, c.percent)}%` })),
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

  private async clear(a: AgentSummary): Promise<void> {
    if (!confirm(`Limpar a memória de ${a.name}? Ele continua no escritório, mas esquece esta conversa. O histórico fica salvo na Central de resume.`)) return
    await window.office.clearContext(a.id)
  }

  private async fire(a: AgentSummary): Promise<void> {
    if (!confirm(`Demitir ${a.name}? A sessão para e o agente vai embora pelo elevador.`)) return
    await window.office.fire(a.id)
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
    this.feed.append(entryView(e))
    while (this.feed.childElementCount > 400) this.feed.firstElementChild?.remove()
    if (scroll && this.stickToBottom) this.feed.scrollTop = this.feed.scrollHeight
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

function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}
