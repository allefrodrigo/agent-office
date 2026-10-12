import type { LedgerAgent } from '@shared/types'
import { dayLong, usd, int, workTime, modelName, type Report, sum, variation, tokens } from './data'

/** Resumo, por projeto, por agente, por modelo e por dia, em tabelas Markdown. */
export function reportMarkdown(
  r: Report,
  label: string,
  scope: string,
  prevLabel: string,
  who: Record<string, LedgerAgent>,
  groupName: (key: string) => string,
  folderName: (cwd: string) => string,
): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
  const table = (head: string[], rows: string[][]) =>
    rows.length ? [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i ? ' ---: ' : ' --- ')).join('|')}|`, ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n') : '_Nada no período._'
  const delta = variation(r.total.cost, r.prevCost)
  const spenders = [...r.agents.values()].filter((a) => a.cost > 0).length
  const out = [
    `# Relatório de gastos · ${scope}`,
    '',
    `- **Período:** ${label} (${dayLong(r.days[0])} a ${dayLong(r.days[r.days.length - 1])})`,
    `- **Exportado em:** ${new Date().toLocaleString('pt-BR')}`,
    '',
    '## Resumo',
    '',
    table(
      ['Item', 'Valor'],
      [
        ['Gasto', usd(r.total.cost)],
        [`Contra ${prevLabel}`, delta ? `${delta.text} (antes: ${usd(r.prevCost)})` : 'sem base'],
        ['Turnos', int(r.total.turns)],
        ['Tempo', workTime(r.total.durationMs)],
        ['Respostas', int(r.total.results)],
        ['Agentes', int(spenders)],
      ],
    ),
    '',
    '## Por projeto',
    '',
    table(
      ['Projeto', 'Gasto', 'Turnos', 'Tempo'],
      [...r.groups].filter(([, t]) => t.cost > 0 || t.results > 0).sort((a, b) => b[1].cost - a[1].cost).map(([key, t]) => [groupName(key), usd(t.cost), int(t.turns), workTime(t.durationMs)]),
    ),
    '',
    '## Por agente',
    '',
    table(
      ['Agente', 'Projeto', 'Gasto', 'Turnos'],
      [...r.agents].filter(([, a]) => a.cost > 0).sort((a, b) => b[1].cost - a[1].cost).map(([id, a]) => {
        const ag = who[id]
        return [`${ag?.name ?? 'Agente'}${ag?.dismissedAt ? ' (dispensado)' : ''}`, ag ? folderName(ag.cwd) : '', usd(a.cost), int(a.turns)]
      }),
    ),
    '',
    '## Por modelo',
    '',
    table(
      ['Modelo', 'Gasto', 'Tokens de saída'],
      [...r.models].filter(([, m]) => m.cost > 0).sort((a, b) => b[1].cost - a[1].cost).map(([name, m]) => [modelName(name), usd(m.cost), tokens(m.output)]),
    ),
  ]
  if (r.days.length > 1) out.push('', '## Por dia', '', table(['Dia', 'Gasto'], r.days.map((d) => [dayLong(d), usd(sum(r.byDay.get(d)?.values() ?? []))])))
  return out.join('\n') + '\n'
}
