import { h } from './dom'
import { modal } from './modals'

/** Tecla ? (AO-38): todos os atalhos do app numa janela, e o tour guiado de novo. Pressionar ? de novo fecha. */
export function openShortcuts(root: HTMLElement, platform: string, opts: { tour?: () => void } = {}): void {
  const open = root.querySelector('.backdrop-shortcuts')
  if (open) return void open.remove()
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl+'
  const alt = platform === 'darwin' ? '⌥' : 'Alt+'
  const groups: [string, [string, string][]][] = [
    [
      'No escritório',
      [
        ['N', 'Novo agente: conversar, dar uma tarefa ou subir um squad'],
        ['T', 'Quadro de tickets'],
        ['R', 'Relatórios'],
        ['I', 'Caixa de entrada: pedidos e resultados esperando você'],
        ['W A S D ou ← ↑ → ↓', 'Andar pelo escritório'],
        ['F3', 'Painel de desempenho (fps, draw calls, memória)'],
        ['?', 'Esta lista e o botão Rever o tour'],
      ],
    ],
    [
      'Cartão de permissão, plano ou resultado',
      [
        ['Enter', 'Permitir, aprovar o plano ou dar o recebido (não vale com foco num campo ou botão, nem logo que o cartão aparece)'],
        [`${mod}⌫`, 'Negar ou pedir mudanças no plano'],
        ['Esc', 'Fechar o cartão para decidir depois'],
      ],
    ],
    [
      'Painel do agente',
      [
        ['Enter', 'Enviar a mensagem (⇧Enter quebra a linha)'],
        ['Esc', 'No campo de mensagem: ir para o cartão aberto; fora dele: fechar o painel'],
        [`${mod}F`, 'Buscar no log (Enter e ↓ próxima, ↑ anterior)'],
      ],
    ],
    [
      'Listas e quadro',
      [
        ['↑ ↓', 'Andar pela lista de agentes e pela caixa de entrada'],
        ['Enter', 'Abrir o agente ou o item escolhido'],
        ['↑ ↓ ← →', 'No quadro: andar entre os cartões'],
        [`${alt}← ${alt}→`, 'No quadro: mover o ticket para a coluna ao lado'],
        [`${mod}↩`, 'Novo agente com tarefa: contratar'],
        ['Tab ⇧Tab', 'Andar pelos botões de uma janela; o foco não sai dela até fechar'],
      ],
    ],
  ]
  const body = groups.map(([title, rows]) =>
    h(
      'section',
      { class: 'keys-group' },
      h('h3', { class: 'keys-title' }, title),
      h('dl', { class: 'keys-list' }, ...rows.flatMap(([keys, what]) => [h('dt', {}, ...keys.split(' ').map((k) => (/^[a-z]+$/.test(k) ? ` ${k} ` : h('kbd', {}, k)))), h('dd', {}, what)])),
    ),
  )
  const close = () => el.remove()
  const tour = opts.tour
    ? h('button', {
        class: 'btn',
        onclick: () => {
          close()
          opts.tour?.()
        },
      }, 'Rever o tour')
    : null
  const el = modal('Atalhos do teclado', body, [tour, h('button', { class: 'btn btn-primary', onclick: close }, 'Fechar')].filter((b) => b !== null), close)
  el.classList.add('backdrop-shortcuts')
  root.append(el)
}
