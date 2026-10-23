import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { pathsIn, readable } from '../src/main/creative/claude'

const root = mkdtempSync(join(tmpdir(), 'ao-read-'))
const floor = join(root, 'andar')
const project = join(root, 'projeto', 'app')
mkdirSync(floor, { recursive: true })
mkdirSync(project, { recursive: true })
writeFileSync(join(project, '.env'), 'X=1')
symlinkSync('/etc', join(floor, 'fora'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('o que o Claude do estúdio pode ler', () => {
  it('only inside the roots', () => {
    expect(readable(join(floor, 'a.md'), floor, [floor])).toBe(true)
    expect(readable('criativos/imagens', floor, [floor])).toBe(true)
    expect(readable('/etc/passwd', floor, [floor])).toBe(false)
    expect(readable('../projeto/app/x.ts', floor, [floor])).toBe(false)
    expect(readable(join(project, 'src'), floor, [floor, project])).toBe(true)
  })

  it('never secrets, symlinks out or globs out', () => {
    expect(readable(join(project, '.env'), floor, [floor, project])).toBe(false)
    expect(readable(join(homedir(), '.ssh', 'id_ed25519'), floor, [homedir()])).toBe(false)
    expect(readable(join(floor, 'fora', 'passwd'), floor, [floor])).toBe(false)
    expect(readable('/**/*.ts', floor, [floor])).toBe(false)
  })

  it('takes folders named in the brief, not the home or secrets', () => {
    const got = pathsIn([`veja a pasta ${project} para entender. Também ~ e ${join(project, '.env')}.`])
    expect(got).toEqual([project])
  })
})
