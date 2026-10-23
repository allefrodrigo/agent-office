import type { ProjectFloor } from './types'

/** Project floors are capped so the elevator panel stays short. */
export const MAX_PROJECT_FLOORS = 6
/** Creative floors (Estúdio criativo) count apart: a full building still gets its studio. */
export const MAX_CREATIVE_FLOORS = 2

/** Room left for another floor of this kind. */
export function canAddFloor(projects: ProjectFloor[], kind: 'project' | 'creative'): boolean {
  const n = projects.filter((p) => (p.kind === 'creative') === (kind === 'creative')).length
  return n < (kind === 'creative' ? MAX_CREATIVE_FLOORS : MAX_PROJECT_FLOORS)
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** The floor whose folder holds `cwd` (the deepest one when floors nest), if any. */
export function projectFor(projects: ProjectFloor[], cwd: string | undefined): ProjectFloor | undefined {
  if (!cwd) return undefined
  const c = norm(cwd)
  let best: ProjectFloor | undefined
  for (const p of projects) {
    const root = norm(p.cwd)
    if (!root || (c !== root && !c.startsWith(root + '/'))) continue
    if (!best || root.length > norm(best.cwd).length) best = p
  }
  return best
}

/** "apetit-studios" -> "Apetit Studios". */
export function floorNameFor(cwd: string): string {
  const base = cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return base.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase()).trim().slice(0, 32) || 'Projeto'
}
