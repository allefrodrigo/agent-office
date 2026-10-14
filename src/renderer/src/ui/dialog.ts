import type { AgentResult, AgentSummary, LogEntry, PermissionDecision, PermissionRequest } from '@shared/types'
import type { State } from '../state'
import { asDialog, FocusReturn, isTyping, labelDialog } from './a11y'
import { formatCost, formatDuration, h, icon } from './dom'
import { renderMarkdown } from './markdown'
import { portrait } from './portrait'

export interface DialogActions {
  reply(agentId: string): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  exportConversation(agentId: string): void
}

const MOD = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl+'

/** The card an agent hands you: a permission request, a question, a plan or a final result. */
export class Dialog {
  private el: HTMLDivElement
  itemId: string | null = null
  agentId: string | null = null
  /** Squad and step a request comes from, shown above the card body. */
  private context: string | undefined
  /** Set when a subagent of the agent made the request: what it is doing, or ''. */
  private subagent: string | undefined
  /** Atalhos do cartão aberto: Enter permite (ou dá o recebido), ⌘⌫ nega (Esc fecha). */
  private keys: { allow?: () => void; deny?: () => void } = {}
  /** Quando o cartão apareceu: um Enter logo em seguida pode ser de outra coisa. */
  private shownAt = 0
  /** Result card: where the changed files go, which diffs are open, the commit message being typed. */
  private changesEl: HTMLDivElement | null = null
  private changesFor: string | null = null
  private openDiffs = new Set<string>()
  private commitDraft: string | null = null
  /** The card shows a result from the log again: nothing pending, so sync() leaves it open. */
  private reread = false
  /** Who had the focus before the card took it (AO-38). */
  private focusBack = new FocusReturn()

  constructor(
    root: HTMLElement,
    private state: State,
    private actions: DialogActions,
  ) {
    this.el = h('div', { class: 'dialog card hidden' })
    asDialog(this.el)
    root.append(this.el)
    window.addEventListener('keydown', (e) => {
      if (!this.itemId) return
      if (e.key === 'Escape') return this.close()
      // Digitando ou com um botão em foco, a tecla é de lá.
      const a = document.activeElement
      if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || a instanceof HTMLButtonElement) return
      if (e.repeat || e.isComposing || performance.now() - this.shownAt < 400) return
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && this.keys.allow) {
        e.preventDefault()
        this.keys.allow()
      } else if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey) && this.keys.deny) {
        e.preventDefault()
        this.keys.deny()
      }
    })
  }

  get isOpen(): boolean {
    return this.itemId !== null
  }

  /** Opens the first pending item of an agent, or a specific one. */
  open(agentId: string, itemId?: string): boolean {
    const agent = this.state.agents.get(agentId)
    if (!agent) return false
    const items = this.state.itemsFor(agentId)
    const perm = itemId ? items.permissions.find((p) => p.id === itemId) : items.permissions[0]
    const result = itemId ? items.results.find((r) => r.id === itemId) : items.results[0]
    this.keys = {}
    this.reread = false
    this.context = perm?.context
    this.subagent = perm?.subagent
    if (perm) this.showPermission(agent, perm)
    else if (result && (!itemId || result.id === itemId)) this.showResult(agent, result)
    else return false
    return true
  }

  /**
   * A "Resultado entregue" from the feed as a card. Still waiting for the "Recebido": the
   * real card, with its files. Already received: the text only, to read and copy.
   */
  showEntry(agentId: string, e: LogEntry): void {
    const agent = this.state.agents.get(agentId)
    if (!agent) return
    const pending = this.state.itemsFor(agentId).results.find((r) => r.text === e.text)
    if (pending && this.open(agentId, pending.id)) return
    this.keys = { allow: () => this.close() }
    this.reread = true
    this.context = undefined
    this.subagent = undefined
    this.itemId = e.id
    this.agentId = agentId
    this.changesEl = null
    this.frame(
      agent,
      e.isError ? 'teve um problema' : 'entregou este resultado',
      [h('div', { class: 'dialog-scroll' }, renderMarkdown(e.text || '(sem texto)')), h('div', { class: 'dialog-meta' }, new Date(e.t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))],
      [
        h('button', { class: 'btn', title: 'Copiar o resultado em Markdown', onclick: () => void navigator.clipboard.writeText(e.text).then(() => this.actions.toast('Resultado copiado.', 'ok')) }, icon('copy', 15), 'Copiar'),
        agent.source === 'office'
          ? h('button', {
              class: 'btn',
              onclick: () => {
                this.close()
                this.actions.reply(agent.id)
              },
            }, 'Responder')
          : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'btn btn-primary', title: 'Fechar (Enter)', onclick: () => this.close() }, 'Fechar'),
      ].filter(Boolean) as HTMLElement[],
      e.isError ? 'err' : 'done',
    )
  }

  close(): void {
    this.keys = {}
    this.reread = false
    this.itemId = null
    this.agentId = null
    this.el.classList.add('hidden')
    this.focusBack.restore(this.el)
  }

  /** Brings the focus to the open card (Esc in the message box does it). False when there is none. */
  focus(): boolean {
    if (!this.itemId) return false
    this.focusBack.save(this.el)
    this.el.setAttribute('aria-modal', 'true')
    this.el.focus({ preventScroll: true })
    return true
  }

  /**
   * The card takes the focus so Tab, Enter and the screen reader land on it. Not while the
   * player types or works in another window: the card shows, the live region speaks, and
   * Esc in the message box comes here.
   */
  private takeFocus(hadFocus: boolean): void {
    const a = document.activeElement
    if (hadFocus) return void this.el.focus({ preventScroll: true })
    const busy = isTyping(a) || !!a?.closest('[aria-modal="true"]')
    this.el.setAttribute('aria-modal', String(!busy))
    if (busy) return
    this.focusBack.save(this.el)
    this.el.focus({ preventScroll: true })
  }

  /** Closes the card if its item was resolved elsewhere (terminal, other window). */
  sync(): void {
    if (!this.itemId || this.reread) return
    if (!this.state.permissions.has(this.itemId) && !this.state.results.has(this.itemId)) this.close()
  }

  private frame(agent: AgentSummary, subtitle: string, body: HTMLElement[], buttons: HTMLElement[], tone: string): void {
    const hadFocus = !this.el.classList.contains('hidden') && this.el.contains(document.activeElement)
    this.el.className = `dialog card tone-${tone}`
    this.shownAt = performance.now()
    const name = h('div', { class: 'dialog-name' }, agent.name)
    const sub = h('div', { class: 'dialog-sub' }, subtitle)
    this.el.replaceChildren(
      h(
        'div',
        { class: 'dialog-head' },
        portrait(agent.look, 40),
        h('div', { class: 'dialog-who' }, name, sub),
        h('button', { class: 'icon-btn', title: 'Depois (Esc)', 'aria-label': 'Depois', onclick: () => this.close() }, icon('x', 18)),
      ),
      h('div', { class: this.context ? 'dialog-context' : 'hidden' }, this.context ?? ''),
      h(
        'div',
        { class: this.subagent !== undefined ? 'dialog-context dialog-subagent' : 'hidden', title: 'Quem pediu foi um ajudante (Agent tool) que este agente chamou' },
        this.subagent ? `Pedido de um subagente · ${this.subagent}` : 'Pedido de um subagente',
      ),
      h('div', { class: 'dialog-body' }, ...body),
      h('div', { class: 'dialog-actions' }, ...buttons),
    )
    // "Ada veio pedir sua permissão", then what for.
    labelDialog(this.el, { title: [name, sub], description: body.find((b) => b.classList.contains('dialog-title')) })
    this.takeFocus(hadFocus)
  }

  private async decide(d: PermissionDecision): Promise<void> {
    this.close()
    try {
      await window.office.respond(d)
    } catch (err) {
      this.actions.toast(String(err), 'err')
    }
  }

  private showPermission(agent: AgentSummary, p: PermissionRequest): void {
    this.itemId = p.id
    this.agentId = agent.id
    if (p.kind === 'question') return this.showQuestion(agent, p)
    if (p.kind === 'plan') return this.showPlan(agent, p)

    const body: HTMLElement[] = [h('div', { class: 'dialog-title' }, p.title)]
    const preview = toolPreview(p)
    if (preview) body.push(preview)
    else if (p.detail) body.push(h('pre', { class: 'code' }, p.detail))
    if (p.reason) body.push(h('div', { class: 'dialog-note' }, p.reason))

    const reason = h('input', { class: 'input deny-reason hidden', placeholder: 'Diga o que ele deve fazer em vez disso (opcional)' })
    reason.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') this.decide({ requestId: p.id, behavior: 'deny', message: reason.value })
    })
    body.push(reason)
    const deny = () => this.decide({ requestId: p.id, behavior: 'deny', message: reason.value })
    this.keys = { allow: () => this.decide({ requestId: p.id, behavior: 'allow' }), deny }

    const buttons = [
      h('button', {
        class: 'btn btn-danger-soft',
        title: `Negar (${MOD}⌫)`,
        onclick: () => {
          if (reason.classList.contains('hidden')) {
            reason.classList.remove('hidden')
            reason.focus()
          } else deny()
        },
      }, 'Negar'),
      h('div', { class: 'grow' }),
      p.canAlwaysAllow ? h('button', { class: 'btn', onclick: () => this.decide({ requestId: p.id, behavior: 'allow_always' }) }, 'Sempre permitir') : null,
      h('button', { class: 'btn btn-primary', title: 'Permitir (Enter)', onclick: () => this.decide({ requestId: p.id, behavior: 'allow' }) }, icon('check', 16), 'Permitir'),
    ].filter(Boolean) as HTMLElement[]
    this.frame(agent, 'veio pedir sua permissão', body, buttons, 'wait')
  }

  private showQuestion(agent: AgentSummary, p: PermissionRequest): void {
    const answers = new Map<string, Set<string>>()
    const others = new Map<string, HTMLInputElement>()
    const body: HTMLElement[] = []
    for (const q of p.questions ?? []) {
      const chosen = new Set<string>()
      answers.set(q.question, chosen)
      const opts = h('div', { class: 'q-options' })
      const buttons: HTMLButtonElement[] = []
      for (const o of q.options) {
        const b = h(
          'button',
          {
            class: 'q-option',
            onclick: () => {
              if (q.multiSelect) {
                if (chosen.has(o.label)) chosen.delete(o.label)
                else chosen.add(o.label)
              } else {
                chosen.clear()
                chosen.add(o.label)
                other.value = ''
              }
              buttons.forEach((x) => x.classList.toggle('on', chosen.has(x.dataset.label ?? '')))
            },
          },
          h('div', { class: 'q-label' }, o.label),
          o.description ? h('div', { class: 'q-desc' }, o.description) : null,
        )
        b.dataset.label = o.label
        buttons.push(b)
        opts.append(b)
      }
      const other = h('input', { class: 'input', placeholder: 'Outra resposta…' })
      other.addEventListener('keydown', (e) => e.stopPropagation())
      other.addEventListener('input', () => {
        if (other.value && !q.multiSelect) {
          chosen.clear()
          buttons.forEach((x) => x.classList.remove('on'))
        }
      })
      others.set(q.question, other)
      body.push(h('div', { class: 'q' }, h('span', { class: 'chip' }, q.header), h('div', { class: 'dialog-title' }, q.question), opts, other))
    }
    const submit = () => {
      const result: Record<string, string> = {}
      for (const [question, chosen] of answers) {
        const extra = others.get(question)?.value.trim()
        const all = [...chosen, ...(extra ? [extra] : [])]
        if (!all.length) {
          this.actions.toast('Responda todas as perguntas.', 'err')
          return
        }
        result[question] = all.join(', ')
      }
      this.decide({ requestId: p.id, behavior: 'allow', answers: result })
    }
    this.frame(
      agent,
      'veio te fazer uma pergunta',
      body,
      [
        h('button', { class: 'btn btn-danger-soft', onclick: () => this.decide({ requestId: p.id, behavior: 'deny', message: 'O usuário preferiu não responder.' }) }, 'Não responder'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn btn-primary', onclick: submit }, icon('send', 15), 'Responder'),
      ],
      'wait',
    )
  }

  private showPlan(agent: AgentSummary, p: PermissionRequest): void {
    const feedback = h('textarea', { class: 'input', rows: 2, placeholder: 'O que mudar no plano? (para pedir mudanças)' })
    feedback.addEventListener('keydown', (e) => e.stopPropagation())
    const changes = () => this.decide({ requestId: p.id, behavior: 'deny', message: feedback.value.trim() || 'Revise o plano.' })
    this.keys = { allow: () => this.decide({ requestId: p.id, behavior: 'allow' }), deny: changes }
    this.frame(
      agent,
      'trouxe um plano',
      [h('div', { class: 'dialog-scroll' }, renderMarkdown(p.plan || '(plano vazio)')), feedback],
      [
        h('button', { class: 'btn btn-danger-soft', title: `Pedir mudanças (${MOD}⌫)`, onclick: changes }, 'Pedir mudanças'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn btn-primary', title: 'Aprovar plano (Enter)', onclick: () => this.decide({ requestId: p.id, behavior: 'allow' }) }, icon('check', 16), 'Aprovar plano'),
      ],
      'wait',
    )
  }

  private showResult(agent: AgentSummary, r: AgentResult): void {
    this.itemId = r.id
    this.agentId = agent.id
    const meta = [formatDuration(r.durationMs), r.turns ? `${r.turns} turnos` : '', formatCost(r.costUsd)].filter(Boolean).join(' · ')
    const ack = async () => {
      this.close()
      await window.office.ackResult(r.id)
    }
    // Enter dá o recebido, com as mesmas travas do Enter que permite.
    this.keys = { allow: () => void ack() }
    if (this.changesFor !== r.id) {
      this.changesFor = r.id
      this.openDiffs.clear()
      this.commitDraft = null
    }
    this.changesEl = h('div', { class: 'chg' })
    this.renderChanges(agent, r)
    this.frame(
      agent,
      r.isError ? 'teve um problema' : 'veio entregar o resultado',
      [h('div', { class: 'dialog-scroll' }, renderMarkdown(r.text || '(sem texto)')), this.changesEl, meta ? h('div', { class: 'dialog-meta' }, meta) : h('span')],
      [
        agent.source === 'office'
          ? h('button', {
              class: 'btn',
              onclick: () => {
                this.close()
                this.actions.reply(agent.id)
              },
            }, 'Responder')
          : null,
        h('button', { class: 'btn', title: 'Exportar a conversa em Markdown (.md)', onclick: () => this.actions.exportConversation(agent.id) }, icon('file', 15), 'Exportar'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn btn-primary', title: 'Recebido (Enter)', onclick: ack }, icon('check', 16), 'Recebido'),
      ].filter(Boolean) as HTMLElement[],
      r.isError ? 'err' : 'done',
    )
  }

  /** The files of the open result card arrived or changed (committed, discarded). */
  syncChanges(resultId: string): void {
    if (this.itemId !== resultId || !this.agentId) return
    const agent = this.state.agents.get(this.agentId)
    const r = this.state.results.get(resultId)
    if (agent && r) this.renderChanges(agent, r)
  }

  /** "Arquivos alterados": list with +/−, a diff per file on click, and what to do with them. */
  private renderChanges(agent: AgentSummary, r: AgentResult): void {
    const el = this.changesEl
    if (!el) return
    const c = r.changes
    if (!c) {
      // Office agents send the list a moment after the result; terminal sessions never do.
      const waiting = agent.source === 'office' && Date.now() - r.createdAt < 15_000
      el.className = waiting ? 'chg chg-wait' : 'hidden'
      el.replaceChildren(waiting ? 'Conferindo os arquivos alterados…' : '')
      return
    }
    el.className = 'chg'
    const plus = c.files.reduce((n, f) => n + (f.added ?? 0), 0)
    const minus = c.files.reduce((n, f) => n + (f.removed ?? 0), 0)
    const count = c.total ?? c.files.length
    const head = h(
      'div',
      { class: 'chg-head' },
      h('span', { class: 'chg-title' }, count ? `${count} arquivo${count === 1 ? '' : 's'} alterado${count === 1 ? '' : 's'}` : 'Nenhum arquivo alterado'),
      c.git && count ? h('span', { class: 'chg-stat' }, h('span', { class: 'chg-plus' }, `+${plus}`), h('span', { class: 'chg-minus' }, `−${minus}`)) : null,
      c.branch ? h('span', { class: 'chip chip-branch', title: `Cópia isolada (worktree) no branch ${c.branch}` }, icon('branch', 11), c.branch) : null,
      c.committed ? h('span', { class: 'chip chg-done' }, icon('check', 11), `commit ${c.committed}`) : null,
      c.discarded ? h('span', { class: 'chip chg-undone' }, icon('undo', 11), 'descartado') : null,
    )
    const parts: HTMLElement[] = [head]
    if (!c.git && count) parts.push(h('div', { class: 'chg-note' }, 'Pasta sem git: estes são os arquivos que as ferramentas Edit/Write escreveram, segundo o log. Não há diff nem como desfazer daqui.'))
    if (count) {
      const list = h('div', { class: 'chg-list' })
      for (const f of c.files) list.append(...this.fileRow(r, f.path))
      if (c.truncated) list.append(h('div', { class: 'chg-note' }, `…e mais ${count - c.files.length} arquivo(s). Veja tudo no editor ou no terminal.`))
      parts.push(list)
    }
    parts.push(this.changeActions(r))
    el.replaceChildren(...parts)
  }

  private fileRow(r: AgentResult, path: string): HTMLElement[] {
    const f = r.changes!.files.find((x) => x.path === path)!
    const git = r.changes!.git
    const letter = git ? ({ added: 'A', modified: 'M', deleted: 'D' } as const)[f.status] : 'W'
    const label = git ? ({ added: 'Novo', modified: 'Alterado', deleted: 'Apagado' } as const)[f.status] : (f.tool ?? 'Escrito')
    const open = this.openDiffs.has(path)
    const row = h(
      'button',
      {
        class: `chg-file${open ? ' on' : ''}`,
        type: 'button',
        title: git ? `${label}${f.preexisting ? ' (já tinha mudanças antes da tarefa; o diff é contra aquela versão)' : ''}. Clique para ver o diff.` : `${label}. Clique para abrir no editor.`,
        onclick: () => {
          if (!git) return void this.openEditor(r, path)
          if (open) this.openDiffs.delete(path)
          else this.openDiffs.add(path)
          this.syncChanges(r.id)
        },
      },
      h('span', { class: `chg-letter chg-${f.status}` }, letter),
      h('span', { class: 'chg-path' }, path),
      f.preexisting ? h('span', { class: 'chg-pre', title: 'Já tinha mudanças antes da tarefa' }, '•') : null,
      git ? h('span', { class: 'chg-nums' }, f.binary ? 'bin' : [h('span', { class: 'chg-plus' }, `+${f.added ?? 0}`), h('span', { class: 'chg-minus' }, `−${f.removed ?? 0}`)]) : null,
    )
    if (!open) return [row]
    const pre = h('pre', { class: 'code diff chg-diff' }, 'Carregando o diff…')
    window.office
      .resultDiff(r.id, path)
      .then((text) => pre.replaceChildren(...diffLines(text)))
      .catch((err) => pre.replaceChildren(cleanErr(err)))
    return [row, pre]
  }

  private changeActions(r: AgentResult): HTMLElement {
    const c = r.changes!
    const busy = (b: HTMLButtonElement, p: Promise<unknown>) => {
      b.setAttribute('disabled', '')
      return p.finally(() => b.removeAttribute('disabled'))
    }
    const editor = h('button', { class: 'btn btn-small', type: 'button', onclick: () => this.openEditor(r) }, icon('edit', 13), 'Abrir no editor')
    if (!c.git || !c.files.length) return h('div', { class: 'chg-actions' }, c.files.length ? editor : null)
    const live = !c.committed && !c.discarded
    const discard = h('button', { class: 'btn btn-small btn-danger-soft', type: 'button', disabled: !live, title: 'Volta os arquivos para como estavam antes da tarefa (pede confirmação)' }, icon('undo', 13), 'Descartar')
    discard.addEventListener('click', () =>
      busy(
        discard,
        window.office.discardResult(r.id).then((next) => {
          if (next) this.actions.toast('Mudanças descartadas: os arquivos voltaram para como estavam antes da tarefa.', 'ok')
        }),
      ).catch((err) => this.actions.toast(cleanErr(err), 'err')),
    )
    if (this.commitDraft === null) this.commitDraft = commitHint(r.text)
    const message = h('input', { class: 'input chg-msg', value: this.commitDraft, maxlength: 2000, placeholder: 'Mensagem do commit', disabled: !live, title: 'Sugerida a partir do relatório do agente. Edite à vontade.' }) as HTMLInputElement
    message.addEventListener('keydown', (e) => e.stopPropagation())
    message.addEventListener('input', () => (this.commitDraft = message.value))
    const commit = h('button', { class: 'btn btn-small btn-primary', type: 'button', disabled: !live }, icon('check', 13), 'Commitar')
    commit.addEventListener('click', () => {
      if (!message.value.trim()) return message.focus()
      busy(
        commit,
        window.office.commitResult(r.id, message.value.trim()).then((next) => this.actions.toast(`Commit ${next.committed} feito${c.branch ? ` no branch ${c.branch}` : ''}.`, 'ok')),
      ).catch((err) => this.actions.toast(cleanErr(err), 'err'))
    })
    const pr = c.branch
      ? h('button', { class: 'btn btn-small', type: 'button', disabled: !!c.discarded, title: 'git push do branch e gh pr create (pede confirmação)' }, icon('pr', 13), 'Abrir PR')
      : null
    pr?.addEventListener('click', () =>
      busy(
        pr,
        window.office.openResultPR(r.id, message.value.trim() || commitHint(r.text)).then((url) => {
          if (!url) return
          this.actions.toast('PR aberto. Abrindo no navegador.', 'ok')
          void window.office.openExternal(url)
        }),
      ).catch((err) => this.actions.toast(cleanErr(err), 'err')),
    )
    return h(
      'div',
      { class: 'chg-actions' },
      h('div', { class: 'chg-row' }, editor, discard, h('div', { class: 'grow' }), pr),
      h('div', { class: 'chg-row' }, message, commit),
    )
  }

  private openEditor(r: AgentResult, path?: string): void {
    window.office
      .openResultInEditor(r.id, path)
      .then((opened) => {
        if (!opened) this.actions.toast('Não achei o Cursor nem o VS Code (comando cursor/code). Mostrei no Finder.', 'info')
      })
      .catch((err) => this.actions.toast(cleanErr(err), 'err'))
  }
}

/** A unified diff as colored lines. Every line goes in as text, never as HTML. */
function diffLines(text: string): HTMLElement[] {
  return text.split('\n').map((l) => {
    const cls = /^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(l)
      ? 'diff-file'
      : l.startsWith('@@')
        ? 'diff-hunk'
        : l.startsWith('+')
          ? 'diff-add'
          : l.startsWith('-')
            ? 'diff-del'
            : 'diff-ctx'
    return h('div', { class: cls }, l || ' ')
  })
}

/** First line of the report, without markdown, as a commit subject. */
function commitHint(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/[*_`]/g, '').trim())
    .find(Boolean)
  const s = (line ?? 'Mudanças do agente').replace(/\s+/g, ' ')
  return s.length > 72 ? `${s.slice(0, 71).replace(/\s+\S*$/, '')}…` : s
}

function cleanErr(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Richer previews for edits and writes. */
function toolPreview(p: PermissionRequest): HTMLElement | null {
  const input = p.input as Record<string, unknown>
  const lines = (s: unknown, max = 14) => String(s ?? '').split('\n').slice(0, max)
  if (p.toolName === 'Edit' && typeof input.old_string === 'string') {
    const pre = h('pre', { class: 'code diff' })
    pre.append(h('div', { class: 'diff-file' }, String(input.file_path ?? '')))
    for (const l of lines(input.old_string)) pre.append(h('div', { class: 'diff-del' }, '- ' + l))
    for (const l of lines(input.new_string)) pre.append(h('div', { class: 'diff-add' }, '+ ' + l))
    return pre
  }
  if (p.toolName === 'Write' && typeof input.content === 'string') {
    const pre = h('pre', { class: 'code diff' })
    pre.append(h('div', { class: 'diff-file' }, String(input.file_path ?? '')))
    for (const l of lines(input.content, 16)) pre.append(h('div', { class: 'diff-add' }, '+ ' + l))
    return pre
  }
  if (p.toolName === 'Bash') {
    const wrap = h('div', {})
    wrap.append(h('pre', { class: 'code code-cmd' }, '$ ' + String(input.command ?? '')))
    if (input.description) wrap.append(h('div', { class: 'dialog-note' }, String(input.description)))
    return wrap
  }
  return null
}
