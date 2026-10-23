import { DEFAULT_CONTEXT_WARN_TOKENS, type Advice } from '@shared/economy'
import type { AgentSummary, Settings } from '@shared/types'
import { formatCost, h, icon } from '../dom'
import { modal } from '../modals'

// Token economy in the agent panel: the advice banner and the question before waking a cold agent.

export function warnTokens(s: Settings): number {
  return s.contextWarnTokens ?? DEFAULT_CONTEXT_WARN_TOKENS
}

/** 330 mil tokens · 1,2 mi tokens */
export function tokensLabel(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} mi tokens` : `${Math.round(n / 1000)} mil tokens`
}

/** 45 min · 3h · 2 dias */
function idleLabel(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 120) return `${min} min`
  const hours = Math.round(min / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} dias`
}

const cost = (usd: number) => formatCost(usd) || '$0,00'

export function adviceCopy(a: Advice): { title: string; detail: string } {
  if (a.kind === 'cold') {
    return {
      title: `Memória fria · retomar custa ~${cost(a.usd)}`,
      detail: `Parado há ${idleLabel(a.idleMs)}. A próxima mensagem recarrega ${tokensLabel(a.tokens)} de conversa. Tarefa nova? Limpe antes e comece quase de graça.`,
    }
  }
  return {
    title: `Memória grande · ${tokensLabel(a.tokens)}`,
    detail: `Cada chamada relê a conversa toda (~${cost(a.usd)} por chamada). Tarefa nova? Limpe. Mesma tarefa? Compacte.`,
  }
}

/** The banner under the badge, with the recommended action first. */
export function adviceBanner(a: AgentSummary, advice: Advice, act: { clear(): void; compact(): void }): HTMLElement[] {
  const copy = adviceCopy(advice)
  return [
    h('div', { class: 'advice-main' }, icon(advice.kind === 'cold' ? 'alert' : 'coin', 15), h('div', { class: 'advice-text' }, h('b', {}, copy.title), h('span', {}, copy.detail))),
    h(
      'div',
      { class: 'advice-actions' },
      h('button', { class: 'btn btn-small btn-primary', title: `${a.name} esquece esta conversa e a próxima mensagem começa do zero (/clear).`, onclick: act.clear }, icon('reset', 13), 'Limpar'),
      // Compacting a cold agent reads the whole conversation too: only worth it while warm.
      advice.kind === 'big'
        ? h('button', { class: 'btn btn-small', title: 'Resume a conversa até aqui (/compact). Custa uma chamada, depois cada chamada fica mais barata.', onclick: act.compact }, icon('compact', 13), 'Compactar')
        : null,
    ),
  ]
}

/** Before a message wakes a cold agent: clear first (cheap), send anyway, or cancel. */
export function askCold(root: HTMLElement, a: AgentSummary, advice: Extract<Advice, { kind: 'cold' }>): Promise<'clear' | 'send' | 'cancel'> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: 'clear' | 'send' | 'cancel') => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }
    const copy = adviceCopy(advice)
    const clear = h('button', { class: 'btn btn-primary', onclick: () => finish('clear') }, icon('reset', 15), 'Limpar e enviar')
    const el = modal(
      `${a.name} está com a memória fria`,
      [
        h('div', { class: 'confirm-warn' }, icon('coin', 16), h('span', {}, copy.title)),
        h(
          'div',
          { class: 'confirm-text' },
          `${copy.detail}\n\nSe a mensagem continua a mesma tarefa, envie assim mesmo. O histórico limpo continua na Central de resume.`,
        ),
        h('div', { class: 'field-hint' }, 'Desligue esta pergunta em Configurações › Economia de tokens.'),
      ],
      [h('button', { class: 'btn', onclick: () => finish('cancel') }, 'Cancelar'), h('button', { class: 'btn', onclick: () => finish('send') }, `Enviar (~${cost(advice.usd)})`), clear],
      () => finish('cancel'),
    )
    el.classList.add('backdrop-confirm')
    root.append(el)
    clear.focus()
  })
}
