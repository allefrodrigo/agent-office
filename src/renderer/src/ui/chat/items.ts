import { ATTACH_KIND_LABEL, formatBytes } from '@shared/attachments'
import { approvalHeading, approvalOutcome, clockTime, runLive, runSummary, triggerLabel } from '@shared/bots-view'
import type { AskQuestion, Bot, PermissionDecision, RunStep, ThreadItem } from '@shared/types'
import { BOT_RUN_STATUS_LABEL, SENSITIVE_LABEL } from '@shared/types'
import { h, icon } from '../dom'
import { renderMarkdown } from '../markdown'
import { toolIcon } from '../panel/entries'

// Como cada item do fio aparece: balões, a linha da rodada, os cartões de aprovação, pergunta e
// plano, avisos e a conversa paralela entre bots. Docs: docs/prd/chat-de-bots.md ("O fio").

type Approval = Extract<ThreadItem, { kind: 'approval' }>
type Run = Extract<ThreadItem, { kind: 'run' }>

export interface ItemCtx {
  bot(): Bot | undefined
  botName(id: string): string
  /** The request is still waiting in the office (state.permissions). */
  live(requestId: string): boolean
  /** What the bot's agent is doing now, for a run in progress. */
  activity(): string
  /** Answers a request; rejects with the error to show. */
  respond(d: PermissionDecision): Promise<void>
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  /** Runs whose steps the player opened (kept across redraws). */
  expanded: Set<string>
}

const fullTime = (t: number) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })

function time(t: number): HTMLElement {
  return h('time', { class: 'ch-time', datetime: new Date(t).toISOString(), title: fullTime(t) }, clockTime(t))
}

/** `prev` is the item drawn just above: a bot speaking again within 5 min skips its name line. */
export function itemView(item: ThreadItem, ctx: ItemCtx, prev?: ThreadItem): HTMLElement {
  let el: HTMLElement
  switch (item.kind) {
    case 'user':
      el = userView(item)
      break
    case 'bot':
      el = botView(item, ctx, prev)
      break
    case 'run':
      el = runView(item, ctx)
      break
    case 'approval':
      el = approvalView(item, ctx)
      break
    case 'notice':
      el = h(
        'div',
        { class: `ch-notice tone-${item.tone ?? 'info'}`, role: item.tone === 'error' ? 'alert' : undefined },
        h('span', {}, item.text),
        time(item.t),
      )
      break
    case 'side':
      el = sideView(item, ctx)
      break
  }
  el.dataset.item = item.id
  el.classList.add('ch-item')
  return el
}

function userView(item: Extract<ThreadItem, { kind: 'user' }>): HTMLElement {
  return h(
    'div',
    { class: 'ch-msg ch-msg-you' },
    h(
      'div',
      { class: 'ch-bubble' },
      item.text ? h('div', { class: 'ch-text' }, item.text) : null,
      item.attachments?.length
        ? h(
            'div',
            { class: 'ch-files' },
            item.attachments.map((a) =>
              h(
                'span',
                { class: 'ch-file', title: `${ATTACH_KIND_LABEL[a.kind]} · ${formatBytes(a.size)}` },
                icon(a.kind === 'image' ? 'image' : 'file', 13),
                h('span', {}, a.name),
              ),
            ),
          )
        : null,
    ),
    h('div', { class: 'ch-meta' }, time(item.t)),
  )
}

function botView(item: Extract<ThreadItem, { kind: 'bot' }>, ctx: ItemCtx, prev?: ThreadItem): HTMLElement {
  const name = item.member?.name ?? ctx.botName(item.botId)
  const grouped = prev?.kind === 'bot' && prev.botId === item.botId && prev.member?.id === item.member?.id && item.t - prev.t < 5 * 60_000
  return h(
    'div',
    { class: `ch-msg ch-msg-bot${grouped ? ' grouped' : ''}` },
    grouped
      ? null
      : h('div', { class: 'ch-meta' }, h('span', { class: 'ch-author' }, item.member ? `${item.member.icon} ${name}` : name), time(item.t)),
    h('div', { class: 'ch-bubble' }, renderMarkdown(item.text)),
  )
}

function triggerIcon(item: Run): string {
  switch (item.trigger.kind) {
    case 'schedule':
      return 'history'
    case 'event':
      return 'spark'
    case 'manual':
      return 'play'
    case 'ask':
    case 'channel':
      return 'users'
    default:
      return 'message'
  }
}

function stepView(s: RunStep): HTMLElement {
  if (s.kind === 'tool')
    return h(
      'li',
      { class: 'ch-step k-tool' },
      icon(toolIcon(s.tool), 13),
      h('span', { class: 'ch-step-tool' }, s.tool ?? 'ferramenta'),
      h('span', { class: 'ch-step-text' }, s.text),
    )
  if (s.kind === 'error') return h('li', { class: 'ch-step k-error' }, icon('alert', 13), h('span', { class: 'ch-step-text' }, s.text))
  return h(
    'li',
    { class: `ch-step k-${s.kind}` },
    icon(s.kind === 'thinking' ? 'spark' : 'message', 13),
    h('span', { class: 'ch-step-text' }, s.text),
  )
}

function runView(item: Run, ctx: ItemCtx): HTMLElement {
  const label = item.label || triggerLabel(item.trigger)
  const active = item.status === 'running' || item.status === 'waiting'
  const steps = item.log ?? []
  const open = ctx.expanded.has(item.id)
  const text = active
    ? runLive(item, ctx.activity())
    : item.status === 'skipped' || item.status === 'failed'
      ? `${BOT_RUN_STATUS_LABEL[item.status][0].toUpperCase()}${BOT_RUN_STATUS_LABEL[item.status].slice(1)}${item.error ? `: ${item.error}` : ''}`
      : runSummary(item)
  const list = h('ol', { class: 'ch-steps', hidden: !open, id: `steps-${item.id}` }, steps.map(stepView))
  const toggle = steps.length
    ? h(
        'button',
        {
          type: 'button',
          class: 'ch-run-toggle',
          'aria-expanded': String(open),
          'aria-controls': `steps-${item.id}`,
          title: open ? 'Esconder os passos' : 'Ver os passos',
          onclick: () => {
            const now = !ctx.expanded.has(item.id)
            if (now) ctx.expanded.add(item.id)
            else ctx.expanded.delete(item.id)
            list.hidden = !now
            toggle!.setAttribute('aria-expanded', String(now))
            toggle!.title = now ? 'Esconder os passos' : 'Ver os passos'
          },
        },
        h('span', { class: 'ch-run-text' }, text),
        icon('chevron', 14),
      )
    : null
  return h(
    'div',
    { class: `ch-run s-${item.status}`, role: active ? 'status' : undefined },
    h(
      'div',
      { class: 'ch-run-line' },
      active ? h('span', { class: 'ch-pulse', 'aria-hidden': 'true' }) : icon(triggerIcon(item), 14),
      h('span', { class: 'ch-run-label' }, label),
      h('span', { class: 'ch-run-sep', 'aria-hidden': 'true' }, '·'),
      toggle ?? h('span', { class: 'ch-run-text' }, text),
      time(item.t),
    ),
    list,
  )
}

// ---------- approvals, questions and plans ----------

function approvalView(item: Approval, ctx: ItemCtx): HTMLElement {
  if (item.status !== 'pending') {
    return h(
      'div',
      { class: `ch-decided s-${item.status}` },
      icon(item.status === 'allowed' || item.status === 'answered' ? 'check' : item.status === 'denied' ? 'x' : 'history', 14),
      h('span', { class: 'ch-decided-text' }, approvalOutcome(item)),
      h('span', { class: 'ch-decided-what' }, item.request.title),
    )
  }
  if (!ctx.live(item.requestId)) {
    return h(
      'div',
      { class: 'ch-decided s-expired' },
      icon('history', 14),
      h('span', { class: 'ch-decided-text' }, 'Esse pedido não está mais esperando: o bot parou ou o app reiniciou.'),
      h('span', { class: 'ch-decided-what' }, item.request.title),
    )
  }
  const r = item.request
  const body: (HTMLElement | null)[] = []
  const actions = h('div', { class: 'ch-card-actions' })
  const card = h(
    'section',
    { class: `ch-card k-${r.kind}${r.sensitive ? ' sensitive' : ''}`, 'aria-label': `${approvalHeading(r)}: ${r.title}` },
    h(
      'div',
      { class: 'ch-card-head' },
      icon(r.kind === 'question' ? 'message' : r.kind === 'plan' ? 'report' : r.sensitive ? 'alert' : 'check', 15),
      h('span', {}, approvalHeading(r)),
      r.subagent !== undefined
        ? h(
            'span',
            { class: 'ch-card-sub', title: 'Quem pediu foi um ajudante que o bot chamou' },
            r.subagent ? `ajudante · ${r.subagent}` : 'ajudante',
          )
        : null,
      time(item.t),
    ),
  )
  let busy = false
  const decide = async (d: Omit<PermissionDecision, 'requestId'>) => {
    if (busy) return
    busy = true
    card.classList.add('sending')
    for (const b of card.querySelectorAll('button')) b.disabled = true
    try {
      await ctx.respond({ requestId: item.requestId, ...d })
    } catch (err) {
      busy = false
      card.classList.remove('sending')
      for (const b of card.querySelectorAll('button')) b.disabled = false
      ctx.toast(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  if (r.kind === 'question') {
    body.push(...questionBody(r.questions ?? [], actions, (answers) => void decide({ behavior: 'allow', answers }), ctx))
    actions.prepend(
      h(
        'button',
        {
          type: 'button',
          class: 'btn ch-btn-quiet',
          onclick: () => void decide({ behavior: 'deny', message: 'O usuário preferiu não responder.' }),
        },
        'Não responder',
      ),
    )
  } else if (r.kind === 'plan') {
    body.push(h('div', { class: 'ch-card-plan' }, renderMarkdown(r.plan || '(plano vazio)')))
    const feedback = h('textarea', {
      class: 'input ch-card-input',
      rows: 2,
      placeholder: 'O que mudar no plano?',
      'aria-label': 'O que mudar no plano',
      hidden: true,
    })
    body.push(feedback)
    const changes = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-danger-soft',
        onclick: () => {
          if (feedback.hidden) {
            feedback.hidden = false
            feedback.focus()
            changes.textContent = 'Enviar mudanças'
          } else void decide({ behavior: 'deny', message: feedback.value.trim() || 'Revise o plano.' })
        },
      },
      'Pedir mudanças',
    )
    actions.append(
      changes,
      h('div', { class: 'grow' }),
      h(
        'button',
        { type: 'button', class: 'btn ch-btn-accent', onclick: () => void decide({ behavior: 'allow' }) },
        icon('check', 15),
        'Aprovar',
      ),
    )
  } else {
    body.push(h('div', { class: 'ch-card-title' }, r.title))
    if (r.detail) body.push(h('pre', { class: 'ch-card-detail' }, r.detail))
    if (r.reason) body.push(h('div', { class: 'ch-card-note' }, r.reason))
    if (r.sensitive)
      body.push(
        h(
          'div',
          { class: 'ch-card-warn' },
          icon('alert', 14),
          `${SENSITIVE_LABEL[r.sensitive]} sempre pede o seu sim, em qualquer modo de permissão.`,
        ),
      )
    const reason = h('input', {
      class: 'input ch-card-input',
      placeholder: 'Diga o que ele deve fazer em vez disso (opcional)',
      'aria-label': 'Motivo para negar',
      hidden: true,
    })
    reason.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        void decide({ behavior: 'deny', message: reason.value.trim() })
      }
    })
    body.push(reason)
    const deny = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-danger-soft',
        onclick: () => {
          if (reason.hidden) {
            reason.hidden = false
            reason.focus()
            deny.textContent = 'Negar agora'
          } else void decide({ behavior: 'deny', message: reason.value.trim() })
        },
      },
      'Negar',
    )
    actions.append(deny, h('div', { class: 'grow' }))
    // "Sempre permitir" never shows for a sensitive call (bots-guard)
    if (r.canAlwaysAllow && !r.sensitive)
      actions.append(
        h('button', { type: 'button', class: 'btn', onclick: () => void decide({ behavior: 'allow_always' }) }, 'Sempre permitir'),
      )
    actions.append(
      h(
        'button',
        { type: 'button', class: 'btn ch-btn-accent', onclick: () => void decide({ behavior: 'allow' }) },
        icon('check', 15),
        'Permitir',
      ),
    )
  }
  card.append(...body.filter((b): b is HTMLElement => !!b), actions)
  return card
}

/** The AskUserQuestion options as buttons; one single-choice question answers on the click. */
function questionBody(
  questions: AskQuestion[],
  actions: HTMLElement,
  submit: (answers: Record<string, string>) => void,
  ctx: ItemCtx,
): HTMLElement[] {
  const quick = questions.length === 1 && !questions[0].multiSelect
  const chosen = new Map<string, Set<string>>()
  const others = new Map<string, HTMLInputElement>()
  const collect = (): Record<string, string> | null => {
    const out: Record<string, string> = {}
    for (const q of questions) {
      const extra = others.get(q.question)?.value.trim()
      const all = [...(chosen.get(q.question) ?? []), ...(extra ? [extra] : [])]
      if (!all.length) return null
      out[q.question] = all.join(', ')
    }
    return out
  }
  const send = () => {
    const a = collect()
    if (a) submit(a)
    else ctx.toast('Responda todas as perguntas.', 'err')
  }
  // one quick question answers on the click: "Responder" shows only with the "Outra…" field
  const reply = h('button', { type: 'button', class: 'btn ch-btn-accent', onclick: send, hidden: quick }, icon('send', 14), 'Responder')
  const blocks = questions.map((q) => {
    const set = new Set<string>()
    chosen.set(q.question, set)
    const other = h('input', {
      class: 'input ch-card-input',
      placeholder: 'Sua resposta',
      'aria-label': `Outra resposta: ${q.question}`,
      hidden: true,
    })
    other.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        send()
      }
    })
    others.set(q.question, other)
    const buttons: HTMLButtonElement[] = []
    const opts = q.options.map((o) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'ch-option',
          'aria-pressed': 'false',
          title: o.description || undefined,
          onclick: () => {
            if (quick) return submit({ [q.question]: o.label })
            if (q.multiSelect) {
              if (set.has(o.label)) set.delete(o.label)
              else set.add(o.label)
            } else {
              set.clear()
              set.add(o.label)
            }
            for (const x of buttons) x.setAttribute('aria-pressed', String(set.has(x.dataset.label ?? '')))
          },
        },
        h('span', { class: 'ch-option-label' }, o.label),
        o.description ? h('span', { class: 'ch-option-desc' }, o.description) : null,
      )
      b.dataset.label = o.label
      buttons.push(b)
      return b
    })
    const otherBtn = h(
      'button',
      {
        type: 'button',
        class: 'ch-option ch-option-other',
        onclick: () => {
          other.hidden = false
          otherBtn.hidden = true
          reply.hidden = false
          other.focus()
        },
      },
      'Outra…',
    )
    return h(
      'div',
      { class: 'ch-question' },
      q.header ? h('span', { class: 'ch-chip' }, q.header) : null,
      h('div', { class: 'ch-card-title' }, q.question),
      h('div', { class: 'ch-options' }, ...opts, otherBtn),
      other,
    )
  })
  actions.append(h('div', { class: 'grow' }), reply)
  return blocks
}

function sideView(item: Extract<ThreadItem, { kind: 'side' }>, ctx: ItemCtx): HTMLElement {
  const from = ctx.botName(item.fromBotId)
  const to = ctx.botName(item.toBotId)
  return h(
    'details',
    { class: `ch-aside s-${item.status}` },
    h(
      'summary',
      {},
      icon('users', 14),
      `${from} perguntou a ${to}`,
      item.status === 'asked' ? ' · esperando' : item.status === 'failed' ? ' · sem resposta' : '',
      time(item.t),
    ),
    h(
      'div',
      { class: 'ch-aside-body' },
      h('p', {}, h('b', {}, `${from}: `), item.question),
      item.answer ? h('div', {}, h('b', {}, `${to}: `), renderMarkdown(item.answer)) : null,
    ),
  )
}

/** The divider between two days. */
export function dayDivider(label: string, key: string): HTMLElement {
  return h('div', { class: 'ch-day', 'data-day': key, role: 'separator', 'aria-label': label }, h('span', {}, label))
}
