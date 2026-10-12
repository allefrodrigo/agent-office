import type { LogEntry } from './types'

// Exportar a conversa de um agente em Markdown (AO-36). Puro, para testar com `npm test`.

export interface ExportHeader {
  agent: string
  cwd: string
  model?: string
  costUsd?: number
  /** Quando o agente chegou (ms). */
  startedAt?: number
  sessionId?: string
  /** Quando exportou (ms); padrão: agora. */
  exportedAt?: number
}

/** Saídas de ferramenta longas viram as primeiras linhas e um aviso. */
const TOOL_RESULT_LINES = 40

/** Cabeçalho (agente, pasta, modelo, custo, datas) e a conversa, na ordem do log. */
export function conversationMarkdown(head: ExportHeader, log: LogEntry[]): string {
  // sem nome, o título e as falas usam "Agente" em vez de ficar vazios
  head = { ...head, agent: oneLine(head.agent) || 'Agente' }
  const out: string[] = [`# ${head.agent}`, '', ...headerLines(head, log), '', '## Conversa', '']
  for (const e of log) {
    const block = entryMarkdown(e, head.agent)
    if (block) out.push(block, '')
  }
  if (!log.length) out.push('_(conversa vazia)_', '')
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function headerLines(head: ExportHeader, log: LogEntry[]): string[] {
  const first = head.startedAt ?? log[0]?.t
  const last = log.at(-1)?.t
  const rows: [string, string | undefined][] = [
    ['Pasta', head.cwd ? `\`${head.cwd}\`` : undefined],
    ['Modelo', head.model],
    ['Custo', head.costUsd ? usd(head.costUsd) : undefined],
    ['Início', first ? dateTime(first) : undefined],
    ['Última entrada', last ? dateTime(last) : undefined],
    ['Exportado em', dateTime(head.exportedAt ?? Date.now())],
    ['Sessão', head.sessionId ? `\`${head.sessionId}\`` : undefined],
  ]
  return rows.filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`)
}

function entryMarkdown(e: LogEntry, agent: string): string {
  const at = time(e.t)
  switch (e.kind) {
    case 'user': {
      const files = e.attachments?.length ? `\n\n${e.attachments.map((a) => `- anexo: ${a.name}`).join('\n')}` : ''
      return `### Você · ${at}\n\n${quote(e.text)}${files}`
    }
    case 'assistant':
      return `### ${oneLine(agent)} · ${at}\n\n${e.text.trim()}`
    case 'thinking':
      return `<details><summary>Pensando · ${at}</summary>\n\n${e.text.trim()}\n\n</details>`
    case 'tool':
      return `- **${oneLine(e.tool ?? 'ferramenta')}** · ${at}: ${inlineCode(oneLine(e.text))}`
    case 'tool_result': {
      const lines = e.text.split('\n')
      const cut = lines.length > TOOL_RESULT_LINES ? `${lines.slice(0, TOOL_RESULT_LINES).join('\n')}\n… (${lines.length - TOOL_RESULT_LINES} linhas a mais)` : e.text
      return `${e.isError ? '**Erro da ferramenta:**\n\n' : ''}${fence(cut)}`
    }
    case 'decision':
      return `> **Decisão · ${at}:** ${oneLine(e.text)}`
    case 'result':
      return `## ${e.isError ? 'Erro' : 'Resultado'} · ${at}\n\n${e.text.trim()}`
    case 'error':
      return `> **Erro · ${at}:** ${e.text.trim().replace(/\n/g, '\n> ')}`
    default:
      return `_${oneLine(e.text)}_`
  }
}

/** O texto do último resultado do agente ('' quando ainda não tem). */
export function finalReport(log: LogEntry[]): string {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].kind === 'result' && log[i].text.trim()) return log[i].text.trim()
  return ''
}

/** "joana-agents-2d-2026-10-12.md": sem barras, acentos ou espaços. */
export function exportFileName(agent: string, cwd: string, t = Date.now()): string {
  const d = new Date(t)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const folder = cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return `${slug(agent)}${folder ? `-${slug(folder)}` : ''}-${day}.md`
}

export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'agente'
  )
}

/** Bloco de código com cerca maior que qualquer sequência de crases do texto. */
export function fence(text: string, lang = ''): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length))
  const f = '`'.repeat(Math.max(3, longest + 1))
  return `${f}${lang}\n${text.replace(/\n+$/, '')}\n${f}`
}

function inlineCode(text: string): string {
  if (!text) return '(sem detalhes)'
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length))
  const f = '`'.repeat(longest + 1)
  return longest ? `${f} ${text} ${f}` : `${f}${text}${f}`
}

function quote(text: string): string {
  return text.trim().split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

const pad = (n: number) => String(n).padStart(2, '0')

function dateTime(t: number): string {
  const d = new Date(t)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function time(t: number): string {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function usd(n: number): string {
  return n < 0.01 ? '< $0,01' : `$${n.toFixed(2).replace('.', ',')}`
}
