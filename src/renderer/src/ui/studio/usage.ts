import type { CodexUsage } from '@shared/creative'
import type { ProjectFloor } from '@shared/types'
import type { State } from '../../state'
import { h } from '../dom'
import { lastStatus } from './integrations'

// The plan limits the studio spends: ChatGPT (Codex) for images, Claude for analysis and writing.
// Codex is read from `codex app-server`; Claude comes from the office's own usage monitor.

let codex: CodexUsage | null = null
const listeners = new Set<() => void>()

/** creative:usage from the main process. */
export function setCodexUsage(u: CodexUsage): void {
  codex = u
  for (const fn of listeners) fn()
}

const left = (t?: number) => {
  if (!t) return ''
  const m = Math.max(0, Math.round((t - Date.now()) / 60000))
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}min` : `${m}min`
}

const meter = (label: string, percent: number, resetsAt?: number) =>
  h(
    'span',
    { class: `st-meter${percent >= 90 ? ' hot' : percent >= 70 ? ' warm' : ''}`, title: resetsAt ? `${label}: ${percent}% usado, renova em ${left(resetsAt)}` : `${label}: ${percent}% usado` },
    h('small', {}, label),
    h('i', { style: `--p:${Math.min(100, percent)}%` }),
    h('b', {}, `${percent}%`),
  )

/** Two chips (ChatGPT, Claude) for the studio header. Unsubscribes when it leaves the page. */
export function usageStrip(state: State, floor: ProjectFloor): HTMLElement {
  const el = h('div', { class: 'st-usage' })
  const render = () => {
    if (!el.isConnected && el.childElementCount) return void listeners.delete(render)
    const accountId = floor.accounts?.[0] ?? state.settings.defaultAccounts?.[0] ?? 'main'
    const claude = state.usage.find((u) => u.accountId === accountId) ?? state.usage[0]
    const cx = codex
    const eleven = lastStatus()?.elevenlabs
    el.replaceChildren(
      h(
        'div',
        { class: 'st-usage-group', title: cx?.error ? `ChatGPT: ${cx.error}` : `ChatGPT${cx?.plan ? ` ${cx.plan}` : ''} via Codex — só o nó Gerar imagem (ou nós com motor ChatGPT) gasta aqui` },
        h('span', { class: 'st-usage-name' }, `ChatGPT${cx?.plan ? ` ${cx.plan[0].toUpperCase()}${cx.plan.slice(1)}` : ''}`),
        ...(cx?.windows.length ? cx.windows.map((w) => meter(w.label, w.percent, w.resetsAt)) : [h('small', { class: 'st-usage-off' }, cx?.error ? 'sem leitura' : 'lendo…')]),
        cx?.limited ? h('small', { class: 'st-usage-off hot' }, 'no limite') : null,
      ),
      ...(eleven?.configured && eleven.limit
        ? [
            h(
              'div',
              { class: 'st-usage-group', title: `ElevenLabs${eleven.tier ? ` ${eleven.tier}` : ''}: ${(eleven.used ?? 0).toLocaleString('pt-BR')} de ${eleven.limit.toLocaleString('pt-BR')} caracteres` },
              h('span', { class: 'st-usage-name' }, 'ElevenLabs'),
              meter('Mês', Math.round(((eleven.used ?? 0) / eleven.limit) * 100), eleven.resetsAt),
            ),
          ]
        : []),
      h(
        'div',
        { class: 'st-usage-group', title: 'Claude — análise de vídeo e legendas (motor padrão)' },
        h('span', { class: 'st-usage-name' }, 'Claude'),
        ...(claude?.windows.length ? claude.windows.slice(0, 2).map((w) => meter(w.label, Math.round(w.percent), w.resetsAt)) : [h('small', { class: 'st-usage-off' }, 'sem leitura')]),
      ),
    )
  }
  listeners.add(render)
  render()
  void window.office.codexUsage().then(setCodexUsage).catch(() => undefined)
  // Claude numbers move with the office; a slow tick keeps the countdowns honest.
  const tick = setInterval(() => (el.isConnected ? render() : (clearInterval(tick), listeners.delete(render))), 30_000)
  return el
}
