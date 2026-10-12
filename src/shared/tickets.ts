import type { Ticket, TicketPriority, TicketStatus, TicketType } from './types'

export const STATUSES: { value: TicketStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'A fazer' },
  { value: 'doing', label: 'Fazendo' },
  { value: 'review', label: 'Revisão' },
  { value: 'done', label: 'Feito' },
]

export const TYPES: { value: TicketType; label: string }[] = [
  { value: 'task', label: 'Tarefa' },
  { value: 'feature', label: 'Feature' },
  { value: 'improvement', label: 'Melhoria' },
  { value: 'bug', label: 'Bug' },
]

export const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
  { value: 'critical', label: 'Crítica' },
]

export const labelOf = <T extends string>(list: { value: T; label: string }[], v: T): string => list.find((x) => x.value === v)?.label ?? v

/** The column to the left (-1) or right (1) of `status` on the board; null at the edges. ⌥←/⌥→ move a ticket there. */
export function neighborStatus(status: TicketStatus, dir: -1 | 1): TicketStatus | null {
  const i = STATUSES.findIndex((s) => s.value === status)
  return i < 0 ? null : (STATUSES[i + dir]?.value ?? null)
}

/**
 * The ticket as the agent reads it. Self-contained on purpose: an agent that
 * never saw the board can do the work from this text alone.
 */
export function ticketBrief(t: Ticket): string {
  const lines = [
    `# ${t.key} · ${t.title}`,
    '',
    `**Tipo:** ${labelOf(TYPES, t.type)} · **Prioridade:** ${labelOf(PRIORITIES, t.priority)}` +
      (t.estimate ? ` · **Estimativa:** ${t.estimate} pts` : '') +
      (t.dueDate ? ` · **Prazo:** ${t.dueDate}` : ''),
  ]
  if (t.tags.length) lines.push(`**Tags:** ${t.tags.join(', ')}`)
  lines.push(`**Aberto por:** ${t.reporter.name}`)
  lines.push('', '## Contexto', '', t.description.trim() || '_Sem descrição. Leia o projeto e confirme o escopo antes de mudar algo grande._')
  if (t.acceptance.length) {
    lines.push('', '## Critérios de aceite', '')
    t.acceptance.forEach((c, i) => lines.push(`${i + 1}. [${c.done ? 'x' : ' '}] ${c.text}`))
  }
  const notes = t.comments.slice(-5)
  if (notes.length) {
    lines.push('', '## Comentários recentes', '')
    for (const c of notes) lines.push(`- **${c.author.name}:** ${c.text.replace(/\n+/g, ' ').slice(0, 400)}`)
  }
  lines.push(
    '',
    '## Como trabalhar neste ticket',
    '',
    `- Este ticket está no quadro do escritório. Use as ferramentas \`mcp__office__*\` com a chave \`${t.key}\`.`,
    '- Marque cada critério de aceite cumprido com `ticket_check`.',
    '- Registre decisões e bloqueios com `ticket_comment`.',
    '- Ao terminar, mova o ticket para `review` com `ticket_update` e entregue um relatório: o que mudou, arquivos tocados e como testar.',
    '- Se faltar informação para seguir, pergunte em vez de adivinhar.',
  )
  return lines.join('\n')
}
