import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { shared } from './dispose'

/**
 * Fewer draw calls (AO-30). A floor is built from hundreds of small boxes, one draw
 * call each (more with shadows). Once it is built, mergeStatic bakes every mesh that
 * never moves into one geometry per material, so the GPU draws the floor in a few
 * dozen calls instead of thousands.
 *
 * The flat colors of kit.ts (mat()) go further: they all fold into one mesh whose
 * vertices carry the color, drawn with PALETTE. Lambert multiplies the material color
 * by the vertex color, so white x color gives the same pixel as before.
 *
 * Whatever moves, toggles or gets picked stays apart: mark it with animated()
 * (elevator doors and buttons, the alarm, the Claude FM monitor). Textured materials
 * are kept as they are, so screens and windows that redraw still animate.
 *
 * The merged geometries belong to their floor (not shared): disposeTree frees them
 * when the floor goes.
 */

/** Stands in for every mat() color once merged. Shared: never disposed. */
const PALETTE = shared(new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true }))

let merging = true

/**
 * Off in the 2D view: nothing reaches the GPU there, and the pixel painter reads each piece of
 * furniture on its own. Set before the floors are built.
 */
export function setMerging(on: boolean): void {
  merging = on
}

/** Keeps `obj` and everything under it out of mergeStatic. Returns it. */
export function animated<T extends THREE.Object3D>(obj: T): T {
  obj.userData.animated = true
  return obj
}

/** A mat() color: opaque, untextured, marked by kit.ts. */
const isPalette = (m: THREE.Material): m is THREE.MeshLambertMaterial => m.userData.palette === true

/** The bucket a mesh merges into: same material (or the palette), same shadow flags, same draw order. */
function keyOf(mesh: THREE.Mesh, material: THREE.Material): string {
  const attrs = Object.keys(mesh.geometry.attributes).sort().join(',')
  const id = isPalette(material) ? 'palette' : material.uuid
  return `${id}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}|${attrs}`
}

/** A copy of the mesh's geometry in `root` space, as a plain triangle list. */
function baked(mesh: THREE.Mesh, toRoot: THREE.Matrix4): THREE.BufferGeometry {
  const src = mesh.geometry
  const g = src.index ? src.toNonIndexed() : src.clone()
  const m = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld)
  g.applyMatrix4(m)
  // a mirrored transform turns the triangles inside out: three.js flips the face
  // culling for such a mesh, a merged one needs its winding swapped instead
  if (m.determinant() < 0) {
    for (const attr of Object.values(g.attributes) as THREE.BufferAttribute[]) {
      for (let i = 0; i < attr.count; i += 3) {
        for (let c = 0; c < attr.itemSize; c++) {
          const b = attr.getComponent(i + 1, c)
          attr.setComponent(i + 1, c, attr.getComponent(i + 2, c))
          attr.setComponent(i + 2, c, b)
        }
      }
    }
  }
  const material = mesh.material as THREE.Material
  if (isPalette(material)) {
    // the color in linear space, as the material uniform held it
    const { r, g: green, b } = material.color
    const colors = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = r
      colors[i + 1] = green
      colors[i + 2] = b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  }
  g.clearGroups()
  return g
}

/**
 * Merges the static meshes under `root`. Call it once the floor is built, before its
 * first frame and before anything that moves on its own is added under it.
 * Returns how many meshes were folded away.
 */
export function mergeStatic(root: THREE.Object3D): number {
  if (!merging) return 0
  root.updateMatrixWorld(true)
  const toRoot = root.matrixWorld.clone().invert()
  const buckets = new Map<string, { material: THREE.Material; sample: THREE.Mesh; meshes: THREE.Mesh[] }>()

  const visit = (o: THREE.Object3D) => {
    if (o.userData.animated || !o.visible) return
    const mesh = o as THREE.Mesh
    // plain meshes with one material only: instanced, skinned and multi-material ones stay as they are
    if (mesh.isMesh && o.constructor === THREE.Mesh && !Array.isArray(mesh.material) && !mesh.geometry.morphAttributes.position) {
      const material = mesh.material as THREE.Material
      const key = keyOf(mesh, material)
      let b = buckets.get(key)
      if (!b) buckets.set(key, (b = { material: isPalette(material) ? PALETTE : material, sample: mesh, meshes: [] }))
      b.meshes.push(mesh)
    }
    for (const child of o.children) visit(child)
  }
  visit(root)

  let folded = 0
  for (const { material, sample, meshes } of buckets.values()) {
    if (meshes.length < 2) continue
    const parts = meshes.map((m) => baked(m, toRoot))
    const geometry = mergeGeometries(parts, false)
    for (const p of parts) p.dispose()
    if (!geometry) continue
    const merged = new THREE.Mesh(geometry, material)
    merged.castShadow = sample.castShadow
    merged.receiveShadow = sample.receiveShadow
    merged.renderOrder = sample.renderOrder
    merged.name = 'merged'
    root.add(merged)
    // the originals were never drawn (this runs before the floor's first frame), so
    // their geometries hold no GPU memory and can simply be dropped
    for (const m of meshes) m.removeFromParent()
    folded += meshes.length - 1
  }
  return folded
}
