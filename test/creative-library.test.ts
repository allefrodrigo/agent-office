import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { starterFlow } from '@shared/creative'
import { MAX_FLOWS } from '@shared/creative-library'
import { createFlow, deleteFlow, listFlows, listLibrary, loadFlowTab, readLibraryText, renameFlow, saveFlow, saveFlowTab } from '../src/main/creative/flow'

const made: string[] = []
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'ao-lib-'))
  made.push(d)
  return d
}
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('flows per floor (tabs)', () => {
  it('migrates the old single flow into "Fluxo 1"', () => {
    const root = fresh()
    saveFlow(root, starterFlow())
    const tabs = listFlows(root)
    expect(tabs).toHaveLength(1)
    expect(tabs[0].name).toBe('Fluxo 1')
    expect(loadFlowTab(root, tabs[0].id)?.nodes.length).toBe(5)
    expect(existsSync(join(root, '.criativo', 'fluxo.json'))).toBe(false)
    expect(existsSync(join(root, '.criativo', 'fluxo.json.migrado'))).toBe(true)
    // a second call does not migrate again
    expect(listFlows(root).map((t) => t.id)).toEqual([tabs[0].id])
  })

  it('creates, renames, saves and deletes tabs', () => {
    const root = fresh()
    expect(listFlows(root)).toEqual([])
    const a = createFlow(root, '  Etiquetas  ', starterFlow())
    const b = createFlow(root, 'x'.repeat(80), undefined)
    expect(a.name).toBe('Etiquetas')
    expect(b.name).toHaveLength(40)
    const c = createFlow(root, 'Meio', undefined, a.id)
    expect(listFlows(root).map((t) => t.id)).toEqual([a.id, c.id, b.id])
    expect(renameFlow(root, c.id, 'Deu Check').find((t) => t.id === c.id)?.name).toBe('Deu Check')
    saveFlowTab(root, c.id, { version: 1, nodes: [{ id: 'n1', kind: 'text', x: 0, y: 0, params: { text: 'oi' } }], edges: [] })
    expect(loadFlowTab(root, c.id)?.nodes[0].params.text).toBe('oi')
    expect(deleteFlow(root, c.id).map((t) => t.id)).toEqual([a.id, b.id])
    expect(() => saveFlowTab(root, c.id, starterFlow())).toThrow(/apagado/)
    expect(existsSync(join(root, '.criativo', 'fluxos', 'lixeira'))).toBe(true)
  })

  it('refuses ids that could leave the folder, and caps the number of tabs', () => {
    const root = fresh()
    expect(() => loadFlowTab(root, '../../etc/passwd')).toThrow()
    expect(() => saveFlowTab(root, 'f-../x', starterFlow())).toThrow()
    for (let i = 0; i < MAX_FLOWS; i++) createFlow(root, `F${i}`, undefined)
    expect(() => createFlow(root, 'demais', undefined)).toThrow(/no máximo/)
  })
})

describe('gallery', () => {
  it('lists the floor outputs newest first, by kind', () => {
    const root = fresh()
    mkdirSync(join(root, 'criativos', 'imagens'), { recursive: true })
    mkdirSync(join(root, 'criativos', 'analises'), { recursive: true })
    mkdirSync(join(root, 'criativos', 'carrosseis', 'c1'), { recursive: true })
    writeFileSync(join(root, 'criativos', 'imagens', 'a.png'), 'x')
    writeFileSync(join(root, 'criativos', 'imagens', 'notas.txt'), 'x')
    writeFileSync(join(root, 'criativos', 'analises', 'v.md'), '# ok')
    writeFileSync(join(root, 'criativos', 'carrosseis', 'c1', 'slide-1.png'), 'x')
    utimesSync(join(root, 'criativos', 'imagens', 'a.png'), new Date(1000), new Date(1000))
    const items = listLibrary(root)
    expect(items.map((i) => i.kind).sort()).toEqual(['analise', 'carrossel', 'imagem'])
    expect(items.at(-1)?.name).toBe('a.png')
    expect(readLibraryText(root, join(root, 'criativos', 'analises', 'v.md'))).toBe('# ok')
  })

  it('never reads outside the floor folder', () => {
    const root = fresh()
    const outside = fresh()
    writeFileSync(join(outside, 'segredo.md'), 'nope')
    writeFileSync(join(outside, 'foto.png'), 'x')
    mkdirSync(join(root, 'criativos', 'imagens'), { recursive: true })
    mkdirSync(join(root, 'criativos', 'analises'), { recursive: true })
    symlinkSync(join(outside, 'foto.png'), join(root, 'criativos', 'imagens', 'link.png'))
    symlinkSync(join(outside, 'segredo.md'), join(root, 'criativos', 'analises', 'link.md'))
    expect(listLibrary(root)).toEqual([])
    expect(() => readLibraryText(root, join(outside, 'segredo.md'))).toThrow()
    expect(() => readLibraryText(root, join(root, 'criativos', 'analises', 'link.md'))).toThrow()
    expect(() => readLibraryText(root, 'relativo.md')).toThrow()
  })
})
