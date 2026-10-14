import { helperActivity } from '@shared/describe'
import type { AccountLimit, AgentSummary, AttachmentKind } from '@shared/types'
import { h, icon } from '../dom'

export const BADGE_OPEN_KEY = 'panel-badge-open'

/** Filtros do log: cada entrada tem uma ou mais categorias em data-cat. */
export type LogFilter = 'all' | 'msg' | 'tool' | 'err'
export const FILTERS: { value: LogFilter; label: string; title: string }[] = [
  { value: 'all', label: 'Tudo', title: 'Todo o log' },
  { value: 'msg', label: 'Mensagens', title: 'Só suas mensagens, as respostas e o resultado' },
  { value: 'tool', label: 'Ferramentas', title: 'Só ferramentas, saídas e decisões' },
  { value: 'err', label: 'Erros', title: 'Só erros (e a ferramenta que falhou)' },
]

export const MOD = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl+'

export interface PanelActions {
  goTo(id: string): void
  closeTerminal(id: string): void
  openItem(agentId: string, itemId: string): void
  toast(text: string, kind?: 'info' | 'ok' | 'err'): void
  exportConversation(agentId: string): void
  copyReport(agentId: string): void
  /** Esc in the message box: focus the agent's open card. False when there is none. */
  focusCard(): boolean
  /** A plan limit stopped the agent: open the card that offers another account. */
  chooseAccount(agentId: string, limit: AccountLimit): void
}

/** Entradas que o feed mantém no DOM; a busca alcança o log inteiro (AO-36). */
export const FEED_MAX = 400

/** "3 ajudantes" chip ("+3" when compact); hover lists what each subagent is doing. */
export function helpersChip(a: AgentSummary, compact = false): HTMLElement | null {
  const subs = a.subagents ?? []
  if (!subs.length) return null
  const label = subs.length === 1 ? '1 ajudante' : `${subs.length} ajudantes`
  const title = [label, ...subs.map((x) => `${x.type ? `${x.type}: ` : ''}${x.description} · ${helperActivity(x)}`)].join('\n')
  return h('span', { class: 'chip chip-helpers', title }, compact ? `+${subs.length}` : label)
}

export function contextLevel(percent: number): 'ok' | 'warn' | 'full' {
  return percent >= 85 ? 'full' : percent >= 60 ? 'warn' : 'ok'
}

export interface PendingFile {
  id: string
  /** Same key = same file: the path, or type/size/time for pasted data. */
  key: string
  file: File
  name: string
  /** '' when the file has no place on disk (pasted). */
  path: string
  kind: AttachmentKind
}

export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(new Error(`Não consegui ler ${file.name}. Anexe de novo.`))
    r.readAsDataURL(file)
  })
}

/** The agent's own branch when it works in a worktree: "agent/ada-1234abcd" shows as "ada-1234abcd". */
export function branchChip(a: AgentSummary): HTMLElement | null {
  if (!a.worktree) return null
  return h(
    'span',
    { class: 'chip chip-branch', title: `Cópia isolada (worktree) no branch ${a.worktree.branch}\n${a.worktree.root}` },
    icon('branch', 11),
    a.worktree.branch.replace(/^agent\//, ''),
  )
}

export function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}

/** "claude-opus-5-5[1m]" → "Opus 5.5 · 1M"; aliases like "opus" → "Opus". Anything else stays as is. */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(model)
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1)
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ' · 1M' : ''}`
  return /^[a-z]+$/.test(model) ? cap(model) : model
}
