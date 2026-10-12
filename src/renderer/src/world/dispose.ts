import * as THREE from 'three'

/**
 * Freeing GPU memory. Taking an object out of the scene does not release its
 * geometry, material or textures: three.js keeps them uploaded until dispose().
 *
 * Some resources are shared on purpose (the color materials of kit.ts, the unit box,
 * avatar shadows, the logo patches): those carry `userData.shared` and are never
 * disposed here, so the furniture and avatars still using them keep drawing.
 */

type Resource = THREE.BufferGeometry | THREE.Material | THREE.Texture

/** Marks a cached resource as shared: disposeTree leaves it alone. Returns it. */
export function shared<T extends Resource>(r: T): T {
  r.userData.shared = true
  return r
}

const isShared = (r: Resource) => r.userData.shared === true

function disposeMaterial(m: THREE.Material, seen: Set<object>): void {
  if (seen.has(m) || isShared(m)) return
  seen.add(m)
  // map, emissiveMap, alphaMap…: every texture slot the material has
  for (const value of Object.values(m)) {
    if (value instanceof THREE.Texture && !seen.has(value) && !isShared(value)) {
      seen.add(value)
      value.dispose()
    }
  }
  m.dispose()
}

/**
 * Disposes the geometries, materials and textures under `root` that are not shared.
 * Does not detach anything: call it right before (or after) scene.remove(root).
 * Calling it twice on the same tree is harmless.
 */
export function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<object>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry && !seen.has(mesh.geometry) && !isShared(mesh.geometry)) {
      seen.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) for (const m of material) disposeMaterial(m, seen)
    else if (material) disposeMaterial(material, seen)
  })
}
