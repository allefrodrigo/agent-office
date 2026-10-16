import { adviseAgent } from '@shared/economy'
import type { State } from '../../state'
import { h, icon } from '../dom'
import { confirmDialog } from '../modals'
import { adviceCopy, warnTokens } from '../panel/economy'
import { portrait } from '../portrait'
import { tokens, usd, type Group, type Report } from './data'

// Relatórios → Economia de tokens: where the money went, what to change, and who needs it now.

const PARTS = [
  { key: 'read', label: 'Releitura da memória', title: 'Cada chamada relê a conversa inteira do cache. Cresce com o tamanho da conversa.' },
  { key: 'write', label: 'Recarga da memória', title: 'Escrever a conversa no cache: no começo e quando um agente volta depois de 1h parado.' },
  { key: 'output', label: 'Respostas', title: 'O que o modelo escreveu: texto, código e chamadas de ferramenta.' },
  { key: 'input', label: 'Entrada nova', title: 'Tokens enviados fora do cache.' },
] as const

/** `group`: the project filter (null = all), so the agent list follows it. */
export function economy(root: HTMLElement, state: State, r: Report, group: string | null, groupOf: (cwd: string) => Group): HTMLElement {
  const s = r.split
  const total = s.read + s.write + s.output + s.input
  const share = (v: number) => (total > 0 ? v / total : 0)
  const pct = (v: number) => `${Math.round(share(v) * 100)}%`

  const bar = h('div', { class: 'eco-bar' }, ...PARTS.map((p) => h('i', { class: `eco-${p.key}`, style: `width:${share(s[p.key]) * 100}%`, title: `${p.label}: ${usd(s[p.key])}` })))
  const legend = h(
    'div',
    { class: 'eco-legend' },
    ...PARTS.filter((p) => s[p.key] > 0.005).map((p) =>
      h('div', { class: 'eco-key', title: p.title }, h('span', { class: `eco-dot eco-${p.key}` }), h('span', { class: 'eco-key-label' }, p.label), h('b', {}, pct(s[p.key])), h('small', {}, usd(s[p.key]))),
    ),
  )

  const tips: string[] = []
  const perTurn = r.total.turns > 0 ? s.readTokens / r.total.turns : 0
  if (perTurn >= 100_000) tips.push(`Cada chamada releu em média ${tokens(perTurn)} tokens de conversa. Limpar a memória entre tarefas diferentes é o que mais economiza.`)
  if (share(s.write) >= 0.2) tips.push(`${pct(s.write)} foi recarga de memória: agentes voltando depois de parados com a conversa cheia. Limpe antes de mandar tarefa nova a um agente parado.`)
  const st = state.settings
  if (!(st.dailyBudgetUsd > 0)) tips.push('Sem teto de custo por dia. Defina um em Configurações › Economia de tokens para o escritório parar sozinho.')
  if (st.freshTicketSession === false) tips.push('Tickets delegados continuam a conversa anterior do agente. Ligue "conversa nova" em Configurações › Economia de tokens.')
  if (st.freshSquadCycle === false) tips.push('Cada ciclo de squad relê todos os ciclos anteriores. Ligue "conversa nova por ciclo" em Configurações › Economia de tokens.')

  const warn = warnTokens(st)
  const now = [...state.agents.values()]
    .filter((a) => !group || groupOf(a.cwd).key === group)
    .map((a) => ({ a, advice: adviseAgent(a, warn) }))
    .filter((x) => x.advice)
    .sort((x, y) => y.advice!.usd - x.advice!.usd)

  const clear = async (id: string, name: string) => {
    const ok = await confirmDialog(root, {
      title: `Limpar a memória de ${name}?`,
      text: 'Ele continua no escritório, mas esquece esta conversa. O histórico fica salvo na Central de resume.',
      confirm: 'Limpar',
      cancel: 'Cancelar',
    })
    if (ok) await window.office.clearContext(id)
  }

  return h(
    'div',
    { class: 'rep-section eco' },
    h('div', { class: 'rep-section-head' }, 'Economia de tokens'),
    total > 0 ? h('div', { class: 'eco-split' }, h('div', { class: 'eco-split-k' }, 'Para onde foi o dinheiro'), bar, legend) : null,
    h(
      'ul',
      { class: 'eco-tips' },
      ...(tips.length ? tips : ['Nada a ajustar agora: as chaves de economia estão ligadas e a memória dos agentes está sob controle.']).map((t) => h('li', {}, icon(tips.length ? 'alert' : 'check', 13), h('span', {}, t))),
    ),
    now.length
      ? h(
          'div',
          { class: 'eco-now' },
          h('div', { class: 'eco-split-k' }, 'Agentes que pedem ação agora'),
          ...now.map(({ a, advice }) =>
            h(
              'div',
              { class: `eco-agent eco-agent-${advice!.kind}` },
              portrait(a.look, 26),
              h('div', { class: 'eco-agent-main' }, h('b', {}, a.name), h('span', {}, adviceCopy(advice!).title)),
              advice!.kind === 'big' ? h('button', { class: 'btn btn-small', title: 'Resume a conversa (/compact)', onclick: () => window.office.compact(a.id) }, icon('compact', 13), 'Compactar') : null,
              h('button', { class: 'btn btn-small btn-primary', onclick: () => void clear(a.id, a.name) }, icon('reset', 13), 'Limpar'),
            ),
          ),
        )
      : null,
  )
}
