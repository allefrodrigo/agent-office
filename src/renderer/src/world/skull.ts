import * as THREE from 'three'
import { box } from './kit'

const BONE = '#efe6d2'
const BONE_DARK = '#d6c9ad'
const HOLLOW = '#1d1722'

/** Turns a model that faces +z toward the isometric camera. */
export const FACE_CAMERA = Math.PI / 4

export interface Skull {
  group: THREE.Group
  /** Glowing pupils; brighten them while the skull is at work. */
  eyes: THREE.MeshBasicMaterial
}

/**
 * Blocky skull facing +z, origin at the bottom center, about 0.44 tall.
 * `stand` adds a small dark plinth under it (the one on the cabinet).
 */
export function skull(stand = false): Skull {
  const g = new THREE.Group()
  const y0 = stand ? 0.05 : 0
  if (stand) {
    box(g, 0.34, 0.05, 0.34, '#2d2733', 0, 0, 0)
    box(g, 0.3, 0.01, 0.3, '#7a5cc4', 0, 0.045, 0, false)
  }
  // jaw, cheekbones, cranium and the rounded top
  box(g, 0.24, 0.07, 0.24, BONE_DARK, 0, y0, 0.03)
  box(g, 0.32, 0.1, 0.3, BONE, 0, y0 + 0.06, 0.01)
  box(g, 0.34, 0.2, 0.34, BONE, 0, y0 + 0.15, 0)
  box(g, 0.28, 0.06, 0.28, BONE, 0, y0 + 0.35, 0)
  // teeth across the front of the jaw
  for (let i = -2; i <= 2; i++) box(g, 0.035, 0.05, 0.02, '#fffbef', i * 0.046, y0 + 0.035, 0.155, false)
  // sockets and nose
  for (const x of [-0.075, 0.075]) box(g, 0.09, 0.085, 0.02, HOLLOW, x, y0 + 0.16, 0.166, false)
  box(g, 0.04, 0.05, 0.02, HOLLOW, 0, y0 + 0.095, 0.166, false)
  const eyes = new THREE.MeshBasicMaterial({ color: '#ff3b5c', toneMapped: false })
  for (const x of [-0.075, 0.075]) box(g, 0.035, 0.035, 0.012, eyes, x, y0 + 0.185, 0.178, false)
  return { group: g, eyes }
}

/**
 * Full blocky skeleton hung on an anatomy-class stand, facing +z, origin at the
 * bottom center, about 1.4 tall. Its skull is `skull()`, so the eyes glow the same.
 */
export function skeleton(): Skull {
  const g = new THREE.Group()
  // the stand: a dark base and a pole up the back to the neck
  box(g, 0.44, 0.04, 0.32, '#2d2733', 0, 0, -0.02)
  box(g, 0.4, 0.01, 0.28, '#7a5cc4', 0, 0.035, -0.02, false)
  box(g, 0.035, 1.12, 0.035, '#4a4352', 0, 0.04, -0.13)
  box(g, 0.1, 0.03, 0.06, '#4a4352', 0, 1.1, -0.11)
  // legs: feet, shins, knees, thighs
  for (const x of [-0.07, 0.07]) {
    box(g, 0.08, 0.03, 0.14, BONE_DARK, x, 0.045, 0.03)
    box(g, 0.045, 0.3, 0.045, BONE, x, 0.075, 0)
    box(g, 0.065, 0.05, 0.06, BONE_DARK, x, 0.37, 0)
    box(g, 0.05, 0.29, 0.05, BONE, x, 0.42, 0)
  }
  // pelvis, spine and ribcage
  box(g, 0.24, 0.09, 0.1, BONE, 0, 0.7, 0)
  box(g, 0.08, 0.04, 0.06, HOLLOW, 0, 0.72, 0.03, false)
  box(g, 0.04, 0.44, 0.04, BONE_DARK, 0, 0.79, -0.04)
  for (let i = 0; i < 4; i++) {
    const w = 0.2 + i * 0.025
    box(g, w, 0.028, 0.14, BONE, 0, 0.9 + i * 0.058, -0.01)
  }
  box(g, 0.03, 0.2, 0.02, BONE, 0, 0.9, 0.065, false)
  // collarbones, arms hanging at the sides, hands
  box(g, 0.36, 0.035, 0.06, BONE, 0, 1.12, -0.01)
  for (const x of [-0.17, 0.17]) {
    box(g, 0.06, 0.05, 0.07, BONE_DARK, x, 1.08, -0.01)
    box(g, 0.04, 0.24, 0.04, BONE, x * 1.04, 0.84, 0)
    box(g, 0.05, 0.04, 0.05, BONE_DARK, x * 1.06, 0.8, 0)
    box(g, 0.035, 0.2, 0.035, BONE, x * 1.08, 0.6, 0.01)
    box(g, 0.05, 0.08, 0.03, BONE_DARK, x * 1.08, 0.52, 0.01)
  }
  // neck and the skull on top
  box(g, 0.045, 0.06, 0.045, BONE_DARK, 0, 1.15, -0.02)
  const head = skull()
  head.group.scale.setScalar(0.62)
  head.group.position.set(0, 1.2, 0)
  g.add(head.group)
  return { group: g, eyes: head.eyes }
}
