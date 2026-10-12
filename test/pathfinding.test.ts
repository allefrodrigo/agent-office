import { describe, expect, it } from 'vitest'
import { Grid } from '../src/renderer/src/world/pathfinding'

describe('Grid.findPath (A* com paredes finas)', () => {
  it('mesmo tile: caminho vazio; destino fora: null', () => {
    const g = new Grid(5, 5)
    expect(g.findPath(2, 2, 2, 2)).toEqual([])
    expect(g.findPath(0, 0, 9, 9)).toBeNull()
  })

  it('caminho livre vai na diagonal e termina no destino', () => {
    const p = new Grid(5, 5).findPath(0, 0, 3, 3)!
    expect(p).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ])
  })

  it('contorna tiles bloqueados', () => {
    const g = new Grid(5, 3)
    g.blockRect(2, 0, 1, 2)
    const p = g.findPath(0, 0, 4, 0)!
    expect(p.at(-1)).toEqual([4, 0])
    expect(p.some(([x, z]) => x === 2 && z < 2)).toBe(false)
    expect(p.some(([x, z]) => x === 2 && z === 2)).toBe(true)
  })

  it('parede fina entre dois tiles impede o passo direto', () => {
    const g = new Grid(3, 1)
    g.blockEdgeX(1, 0)
    expect(g.canStep(0, 0, 1, 0)).toBe(false)
    expect(g.findPath(0, 0, 2, 0)).toBeNull()
    const open = new Grid(3, 2)
    open.blockEdgeX(1, 0)
    const p = open.findPath(0, 0, 1, 0)!
    expect(p.at(-1)).toEqual([1, 0])
    expect(p.length).toBeGreaterThan(1)
  })

  it('parede fina no eixo z e diagonal sem cortar quina', () => {
    const g = new Grid(2, 2)
    g.blockEdgeZ(1, 0)
    expect(g.canStep(0, 0, 0, 1)).toBe(false)
    expect(g.canStep(0, 0, 1, 1)).toBe(false)
    expect(g.canStep(1, 0, 1, 1)).toBe(true)
    const corner = new Grid(2, 2)
    corner.block(1, 0)
    expect(corner.canStep(0, 0, 1, 1)).toBe(false)
  })

  it('sai de um tile bloqueado (cadeira), mas não entra num', () => {
    const g = new Grid(3, 1)
    g.block(0, 0)
    expect(g.findPath(0, 0, 2, 0)).toEqual([
      [1, 0],
      [2, 0],
    ])
    expect(g.findPath(2, 0, 0, 0)).toBeNull()
    g.unblock(0, 0)
    expect(g.walkable(0, 0)).toBe(true)
  })

  it('sem caminho: null', () => {
    const g = new Grid(3, 3)
    g.blockRect(1, 0, 1, 3)
    expect(g.findPath(0, 0, 2, 2)).toBeNull()
  })

  it('block fora da grade é ignorado', () => {
    const g = new Grid(2, 2)
    g.block(-1, 0)
    g.unblock(5, 5)
    expect(g.inside(-1, 0)).toBe(false)
    expect(g.walkable(0, 0)).toBe(true)
  })
})

describe('Grid.nearestWalkable', () => {
  it('o próprio tile, o vizinho mais perto, ou null', () => {
    const g = new Grid(5, 5)
    expect(g.nearestWalkable(2, 2)).toEqual([2, 2])
    g.blockRect(1, 1, 3, 3)
    // Four tiles at the same distance: the first one found wins.
    expect(g.nearestWalkable(2, 2)).toEqual([0, 2])
    expect(g.nearestWalkable(0, 0, (x, z) => x === 0 && z === 0)).toEqual([0, 1])
    const full = new Grid(2, 2)
    full.blockRect(0, 0, 2, 2)
    expect(full.nearestWalkable(0, 0)).toBeNull()
  })
})
