import type { BgKind, BgProcess } from '@shared/types'
import { h } from '../dom'
import { cleanError, confirmDialog } from '../modals'

// What the HUD card and the Bastidores window say about a background process.

export type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

export const KIND_LABEL: Record<BgKind, string> = { server: 'servidor', monitor: 'vigia', shell: 'shell', helper: 'ajudante' }

/** Running for: "40s", "12min", "3h", "2d". */
export function ageText(startedAt: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}min`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** On for more than an hour: worth a look (amber). */
export const isOld = (p: BgProcess, now = Date.now()) => now - p.startedAt >= 3_600_000

export const isOrphan = (p: BgProcess) => p.owner.kind === 'gone'

/** ":8787" for a server, else what kind of thing it is. */
export function kindTag(p: BgProcess): HTMLElement {
  return h('span', { class: `bg-tag bg-tag-${p.kind}`, title: KIND_LABEL[p.kind] }, p.ports.length ? `:${p.ports[0]}` : KIND_LABEL[p.kind])
}

/** "Grace", "site · terminal", "sem dono · era de Turing". */
export function ownerText(p: BgProcess): string {
  if (p.owner.kind === 'gone') return `sem dono · era de ${p.owner.name}`
  return p.owner.kind === 'terminal' ? `${p.owner.name} · terminal` : p.owner.name
}

/** Groups by owner, the orphans first, keeping the order inside each group. */
export function byOwner(list: BgProcess[]): [string, BgProcess[]][] {
  const groups = new Map<string, BgProcess[]>()
  for (const p of list) {
    const key = `${p.owner.kind}:${p.owner.agentId ?? p.owner.name}`
    const g = groups.get(key)
    if (g) g.push(p)
    else groups.set(key, [p])
  }
  return [...groups.entries()].sort((a, b) => Number(isOrphan(b[1][0])) - Number(isOrphan(a[1][0])))
}

const stopping = new Set<string>()
export const isStopping = (id: string) => stopping.has(id)

/** Stops one process. A server asks first: closing it can cut off whoever is using it. */
export async function stopProcess(root: HTMLElement, p: BgProcess, toast: Toast, redraw: () => void): Promise<void> {
  if (p.kind === 'server') {
    const ok = await confirmDialog(root, {
      title: `Parar localhost:${p.ports[0]}?`,
      text: `${p.label}\n\nQuem estiver usando esse servidor perde a conexão. ${p.owner.kind === 'gone' ? 'O agente que o abriu já saiu.' : `${p.owner.name} pode abrir de novo se precisar.`}`,
      confirm: 'Parar',
      cancel: 'Deixar rodando',
      danger: true,
    })
    if (!ok) return
  }
  stopping.add(p.id)
  redraw()
  try {
    await window.office.stopProcess(p.id)
    toast(`Parei ${p.ports.length ? `localhost:${p.ports[0]}` : p.label.slice(0, 60)}.`, 'ok')
  } catch (err) {
    toast(cleanError(err), 'err')
  } finally {
    stopping.delete(p.id)
    redraw()
  }
}
