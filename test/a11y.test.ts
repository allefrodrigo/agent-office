import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { neighborStatus } from '@shared/tickets'

describe('⌥←/⌥→ no quadro (AO-38)', () => {
  it('vai para a coluna ao lado e para nas pontas', () => {
    expect(neighborStatus('todo', 1)).toBe('doing')
    expect(neighborStatus('todo', -1)).toBe('backlog')
    expect(neighborStatus('review', 1)).toBe('done')
    expect(neighborStatus('backlog', -1)).toBeNull()
    expect(neighborStatus('done', 1)).toBeNull()
  })
})

describe('contraste dos textos do HUD (AO-38)', () => {
  it('todos os pares de scripts/contrast.mjs passam AA (4,5:1)', () => {
    // Sai com erro e lista os pares que falham.
    expect(() => execFileSync(process.execPath, ['scripts/contrast.mjs', '--check'], { stdio: 'pipe' })).not.toThrow()
  })
})
