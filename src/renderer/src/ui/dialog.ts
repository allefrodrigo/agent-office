import type { AgentResult, AgentSummary, PermissionDecision, PermissionRequest } from '@shared/types'
import type { State } from '../state'
import { formatCost, formatDuration, h, icon } from './dom'
import { renderMarkdown } from './markdown'
import { portrait } from './portrait'

export interface DialogActions {
  reply(agentId: string): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
}

/** The card an agent hands you: a permission request, a question, a plan or a final result. */
export class Dialog {
  private el: HTMLDivElement
  itemId: string | null = null
  agentId: string | null = null
  /** Squad and step a request comes from, shown above the card body. */
  private context: string | undefined
  /** Set when a subagent of the agent made the request: what it is doing, or ''. */
  private subagent: string | undefined

  constructor(
    root: HTMLElement,
    private state: State,
    private actions: DialogActions,
  ) {
    this.el = h('div', { class: 'dialog card hidden' })
    root.append(this.el)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.itemId) this.close()
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
    this.context = perm?.context
    this.subagent = perm?.subagent
    if (perm) this.showPermission(agent, perm)
    else if (result && (!itemId || result.id === itemId)) this.showResult(agent, result)
    else return false
    return true
  }

  close(): void {
    this.itemId = null
    this.agentId = null
    this.el.classList.add('hidden')
  }

  /** Closes the card if its item was resolved elsewhere (terminal, other window). */
  sync(): void {
    if (!this.itemId) return
    if (!this.state.permissions.has(this.itemId) && !this.state.results.has(this.itemId)) this.close()
  }

  private frame(agent: AgentSummary, subtitle: string, body: HTMLElement[], buttons: HTMLElement[], tone: string): void {
    this.el.className = `dialog card tone-${tone}`
    this.el.replaceChildren(
      h(
        'div',
        { class: 'dialog-head' },
        portrait(agent.look, 40),
        h('div', { class: 'dialog-who' }, h('div', { class: 'dialog-name' }, agent.name), h('div', { class: 'dialog-sub' }, subtitle)),
        h('button', { class: 'icon-btn', title: 'Depois (Esc)', onclick: () => this.close() }, icon('x', 18)),
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

    const buttons = [
      h('button', {
        class: 'btn btn-danger-soft',
        onclick: () => {
          if (reason.classList.contains('hidden')) {
            reason.classList.remove('hidden')
            reason.focus()
          } else this.decide({ requestId: p.id, behavior: 'deny', message: reason.value })
        },
      }, 'Negar'),
      h('div', { class: 'grow' }),
      p.canAlwaysAllow ? h('button', { class: 'btn', onclick: () => this.decide({ requestId: p.id, behavior: 'allow_always' }) }, 'Sempre permitir') : null,
      h('button', { class: 'btn btn-primary', onclick: () => this.decide({ requestId: p.id, behavior: 'allow' }) }, icon('check', 16), 'Permitir'),
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
    this.frame(
      agent,
      'trouxe um plano',
      [h('div', { class: 'dialog-scroll' }, renderMarkdown(p.plan || '(plano vazio)')), feedback],
      [
        h('button', {
          class: 'btn btn-danger-soft',
          onclick: () => this.decide({ requestId: p.id, behavior: 'deny', message: feedback.value.trim() || 'Revise o plano.' }),
        }, 'Pedir mudanças'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn btn-primary', onclick: () => this.decide({ requestId: p.id, behavior: 'allow' }) }, icon('check', 16), 'Aprovar plano'),
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
    this.frame(
      agent,
      r.isError ? 'teve um problema' : 'veio entregar o resultado',
      [h('div', { class: 'dialog-scroll' }, renderMarkdown(r.text || '(sem texto)')), meta ? h('div', { class: 'dialog-meta' }, meta) : h('span')],
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
        h('div', { class: 'grow' }),
        h('button', { class: 'btn btn-primary', onclick: ack }, icon('check', 16), 'Recebido'),
      ].filter(Boolean) as HTMLElement[],
      r.isError ? 'err' : 'done',
    )
  }
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
