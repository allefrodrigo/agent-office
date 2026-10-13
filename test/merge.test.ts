import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { disposeTree } from '../src/renderer/src/world/dispose'
import { box, mat, unitBox } from '../src/renderer/src/world/kit'
import { animated, mergeStatic } from '../src/renderer/src/world/merge'

const meshes = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh))
  return out
}

describe('mergeStatic (AO-30)', () => {
  it('funde as cores do kit numa malha por sombra e deixa de fora o que anima', () => {
    const root = new THREE.Group()
    const chair = new THREE.Group()
    chair.position.set(3, 0, 2)
    chair.rotation.y = Math.PI / 2
    root.add(chair)
    box(chair, 1, 1, 1, '#ff0000')
    box(chair, 1, 1, 1, '#00ff00', 0, 1, 0)
    box(root, 2, 0.1, 2, '#0000ff', 0, 0, 0, false)
    box(root, 2, 0.1, 2, '#0000ff', 5, 0, 0, false)
    const door = animated(box(root, 1, 2, 0.1, '#ffffff', 9, 0, 0))

    expect(mergeStatic(root)).toBe(2)
    const left = meshes(root)
    expect(left).toHaveLength(3)
    expect(left).toContain(door)
    const lit = left.find((m) => m.name === 'merged' && m.castShadow)!
    const flat = left.find((m) => m.name === 'merged' && !m.castShadow)!
    expect(lit.receiveShadow && flat.receiveShadow).toBe(true)
    // 2 boxes of 12 triangles, colors baked per vertex in linear space
    expect(lit.geometry.attributes.position.count).toBe(72)
    const color = lit.geometry.attributes.color
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual([mat('#ff0000').color.r, 0, 0])
    // positions in root space: the chair's offset is baked in
    lit.geometry.computeBoundingBox()
    expect(lit.geometry.boundingBox!.min.x).toBeCloseTo(2.5)
    expect(lit.geometry.boundingBox!.max.y).toBeCloseTo(2)
  })

  it('materiais próprios fundem entre si; um sozinho fica como está', () => {
    const root = new THREE.Group()
    const glass = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.2 })
    box(root, 1, 1, 1, glass, 0, 0, 0, false)
    box(root, 1, 1, 1, glass, 2, 0, 0, false)
    const lone = box(root, 1, 1, 1, new THREE.MeshBasicMaterial(), 4, 0, 0)
    mergeStatic(root)
    const left = meshes(root)
    expect(left).toHaveLength(2)
    expect(left).toContain(lone)
    expect(left.find((m) => m.name === 'merged')!.material).toBe(glass)
  })

  it('escala espelhada inverte a ordem dos vértices para manter a face visível', () => {
    const root = new THREE.Group()
    box(root, 1, 1, 1, '#123456')
    box(root, -1, 1, 1, '#123456', 3, 0, 0)
    mergeStatic(root)
    const pos = meshes(root)[0].geometry.attributes.position
    const normalOf = (t: number) => {
      const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, t * 3 + k))
      return b.sub(a).cross(c.sub(a)).normalize()
    }
    // first face of each box is +x: the mirrored copy faces -x, outward from its own center
    expect(normalOf(0).x).toBeCloseTo(1)
    expect(normalOf(12).x).toBeCloseTo(-1)
  })

  it('a geometria fundida é do andar: disposeTree a libera, a caixa compartilhada fica', () => {
    const root = new THREE.Group()
    box(root, 1, 1, 1, '#abcdef')
    box(root, 1, 1, 1, '#abcdef', 2, 0, 0)
    mergeStatic(root)
    const merged = meshes(root)[0]
    let freed = 0
    merged.geometry.addEventListener('dispose', () => freed++)
    let sharedFreed = 0
    unitBox.addEventListener('dispose', () => sharedFreed++)
    disposeTree(root)
    expect(freed).toBe(1)
    expect(sharedFreed).toBe(0)
  })
})
