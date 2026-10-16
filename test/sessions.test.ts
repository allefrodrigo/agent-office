import { describe, expect, it } from 'vitest'
import { groupSessionsByProject, sessionRoot } from '@shared/sessions'
import type { ProjectFloor, SessionEntry } from '@shared/types'

const s = (id: string, cwd: string | undefined, lastModified: number): SessionEntry => ({ sessionId: id, title: id, cwd, lastModified })

describe('central de resume por projeto', () => {
  it('junta worktrees ao repositório', () => {
    expect(sessionRoot('/a/repo/.agent-office/worktrees/ada-1')).toBe('/a/repo')
    expect(sessionRoot('C:\\a\\repo\\')).toBe('C:/a/repo')
  })

  it('agrupa por andar ou pasta, projeto mais recente primeiro', () => {
    const floors: ProjectFloor[] = [{ id: 'p', name: 'Plataforma', cwd: '/w/plataforma' }]
    const groups = groupSessionsByProject(
      [
        s('a', '/w/plataforma/web', 10),
        s('b', '/w/balanca', 30),
        s('c', '/w/plataforma/.agent-office/worktrees/ada-1', 20),
        s('d', '/x/balanca', 5),
        s('e', undefined, 1),
      ],
      floors,
    )
    expect(groups.map((g) => [g.name, g.sessions.map((x) => x.sessionId)])).toEqual([
      ['w/balanca', ['b']],
      ['Plataforma', ['c', 'a']],
      ['x/balanca', ['d']],
      ['Pasta desconhecida', ['e']],
    ])
  })
})
