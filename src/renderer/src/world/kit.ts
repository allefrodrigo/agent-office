import * as THREE from 'three'
import { shared } from './dispose'

const mats = new Map<string, THREE.MeshLambertMaterial>()

/** Shared flat-shaded material per color (marked shared: disposeTree never frees it). */
export function mat(color: string): THREE.MeshLambertMaterial {
  let m = mats.get(color)
  if (!m) {
    m = shared(new THREE.MeshLambertMaterial({ color, flatShading: true }))
    // world/merge.ts folds these into one vertex-colored mesh: never change one at runtime
    m.userData.palette = true
    mats.set(color, m)
  }
  return m
}

export const unitBox = shared(new THREE.BoxGeometry(1, 1, 1))
unitBox.translate(0, 0.5, 0) // origin at the bottom face

/** Adds a box whose bottom-center sits at (x, y, z). */
export function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  material: string | THREE.Material | THREE.Material[],
  x = 0,
  y = 0,
  z = 0,
  shadows = true,
): THREE.Mesh {
  const m = new THREE.Mesh(unitBox, typeof material === 'string' ? mat(material) : material)
  m.scale.set(w, h, d)
  m.position.set(x, y, z)
  m.castShadow = shadows
  m.receiveShadow = true
  parent.add(m)
  return m
}

/** Flat-shaded low-poly blob (foliage, bean bags). */
export function blob(parent: THREE.Object3D, r: number, color: string, x: number, y: number, z: number, sy = 1, detail = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat(color))
  m.position.set(x, y, z)
  m.scale.y = sy
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

export function cylinder(parent: THREE.Object3D, rTop: number, rBottom: number, h: number, color: string | THREE.Material, x: number, y: number, z: number, seg = 10): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg)
  g.translate(0, h / 2, 0)
  const m = new THREE.Mesh(g, typeof color === 'string' ? mat(color) : color)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

/** Unlit textured plane (screens, windows, art) facing +z. */
export function panel(parent: THREE.Object3D, w: number, h: number, map: THREE.Texture, x: number, y: number, z: number, lit = false): THREE.Mesh {
  const material = lit ? new THREE.MeshLambertMaterial({ map }) : new THREE.MeshBasicMaterial({ map, toneMapped: false })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}
