import { projectFor } from './projects'
import type { ProjectFloor, SessionEntry } from './types'

export interface SessionProject {
  /** Grouping key: the project folder, or '' when the session has no folder. */
  key: string
  name: string
  /** Full folder path, for the tooltip. */
  cwd?: string
  sessions: SessionEntry[]
  lastModified: number
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** "/repo/.agent-office/worktrees/ada-1" -> "/repo": a worktree session belongs to its repo. */
export function sessionRoot(cwd: string): string {
  const c = norm(cwd)
  const i = c.indexOf('/.agent-office/worktrees/')
  return i > 0 ? c.slice(0, i) : c
}

/**
 * Groups sessions by project, most recently used project first. A session lands on the
 * office floor that holds its folder; otherwise on its own folder (worktrees fold into
 * their repo). Folder names that repeat get the parent folder to tell them apart.
 */
export function groupSessionsByProject(sessions: SessionEntry[], floors: ProjectFloor[]): SessionProject[] {
  const groups = new Map<string, SessionProject>()
  for (const s of sessions) {
    const root = s.cwd ? sessionRoot(s.cwd) : ''
    const floor = root ? projectFor(floors, root) : undefined
    const key = floor ? norm(floor.cwd) : root
    let g = groups.get(key)
    if (!g) {
      g = { key, name: floor?.name ?? '', cwd: floor?.cwd ?? (s.cwd ? root : undefined), sessions: [], lastModified: 0 }
      groups.set(key, g)
    }
    g.sessions.push(s)
    g.lastModified = Math.max(g.lastModified, s.lastModified)
  }
  const list = [...groups.values()]
  const base = (k: string) => k.split('/').filter(Boolean).pop() ?? k
  const unnamed = list.filter((g) => !g.name && g.key)
  for (const g of unnamed) {
    const twins = unnamed.filter((o) => base(o.key) === base(g.key)).length > 1
    g.name = twins ? g.key.split('/').filter(Boolean).slice(-2).join('/') : base(g.key)
  }
  for (const g of list) {
    if (!g.key) g.name = 'Pasta desconhecida'
    g.sessions.sort((a, b) => b.lastModified - a.lastModified)
  }
  return list.sort((a, b) => b.lastModified - a.lastModified)
}
