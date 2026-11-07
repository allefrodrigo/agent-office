import type { ProjectFloor } from './types'

/** A sanity cap, not a design limit: every floor builds its own scene. */
export const MAX_FLOORS = 60

/** Room left for another floor. */
export function canAddFloor(projects: ProjectFloor[]): boolean {
  return projects.length < MAX_FLOORS
}

/** Folder where a floor's Estúdio criativo keeps flows, references and outputs: `<projeto>/social-media` unless set. */
export function studioRoot(floor: Pick<ProjectFloor, 'cwd' | 'studioDir'>): string {
  return floor.studioDir || `${floor.cwd.replace(/[\\/]+$/, '')}/social-media`
}

/**
 * Up to 0.3.8-beta.2 the studio was a floor of its own (kind 'creative'), usually the
 * `social-media` folder of a project that had its floor too. Now every floor has its studio:
 * a creative floor inside a project's folder becomes that project's studio folder; one outside
 * every project becomes a plain floor that keeps its folder as the studio.
 */
export function mergeCreativeFloors(projects: ProjectFloor[]): ProjectFloor[] {
  const plain = projects.filter((p) => p.kind !== 'creative')
  const out = plain.map((p) => ({ ...p }))
  for (const c of projects.filter((p) => p.kind === 'creative')) {
    const parent = projectFor(plain, c.cwd)
    const into = parent && out.find((p) => p.id === parent.id)
    if (into) {
      into.studioDir ??= c.cwd
      continue
    }
    const { kind: _kind, ...rest } = c
    out.push({ ...rest, studioDir: c.cwd })
  }
  return out
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
