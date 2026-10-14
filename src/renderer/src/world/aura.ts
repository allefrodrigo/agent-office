import * as THREE from 'three'
import type { EffortLevel } from '@shared/types'
import { disposeTree, shared } from './dispose'
import { shadeHex } from './furniture'

/** Only the hard-thinking levels burn, in the hot end of the effort meter's scale (styles/effort.css). */
export const AURA_COLORS: Partial<Record<EffortLevel, string>> = {
  high: '#f5a524',
  xhigh: '#f07a3e',
  max: '#ef5b5b',
}

const LEVELS: EffortLevel[] = ['high', 'xhigh', 'max']

/** A four-sided flame tongue, base at the origin, one unit tall. */
let tongueGeo: THREE.ConeGeometry | null = null
let emberGeo: THREE.BoxGeometry | null = null

interface Flame {
  mesh: THREE.Mesh
  height: number
  phase: number
}

/**
 * The Dragon Ball aura around an agent on high effort or above: faint flame tongues in
 * the color of its effort, taller, faster and denser the harder it thinks, with embers
 * on "Modo lenda". Flares while the agent works; burns low while it rests.
 */
export class Aura {
  /** Configurações → Vídeo or prefers-reduced-motion: the flames hold still. */
  static reduced = false

  readonly group = new THREE.Group()
  private flames: Flame[] = []
  private embers: Flame[] = []
  private outer: THREE.MeshBasicMaterial | null = null
  private inner: THREE.MeshBasicMaterial | null = null
  private level = 0
  private charged = false

  constructor(private readonly avatarId: string) {
    this.group.visible = false
  }

  /** Effort level (below high or missing: no aura) and whether the agent is working now. */
  set(effort: EffortLevel | undefined, charged: boolean): void {
    const level = effort ? LEVELS.indexOf(effort) + 1 : 0
    this.charged = charged
    if (level === this.level) return
    this.level = level
    this.build(effort)
  }

  private build(effort: EffortLevel | undefined): void {
    disposeTree(this.group)
    this.group.clear()
    this.flames = []
    this.embers = []
    const color = effort && AURA_COLORS[effort]
    if (!color) return
    const lvl = this.level
    tongueGeo ??= shared(new THREE.ConeGeometry(0.07, 1, 4).translate(0, 0.5, 0))
    emberGeo ??= shared(new THREE.BoxGeometry(0.045, 0.045, 0.045))
    const material = (c: string) => new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, toneMapped: false })
    this.outer = material(color)
    this.inner = material(shadeHex(color, 50))

    const add = (geo: THREE.BufferGeometry, m: THREE.Material) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.userData.avatarId = this.avatarId
      mesh.renderOrder = 2
      this.group.add(mesh)
      return mesh
    }

    // outer ring of tongues, then a tighter, paler core
    const ring = (n: number, rx: number, rz: number, height: number, m: THREE.Material, spin: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + spin
        const mesh = add(tongueGeo!, m)
        mesh.position.set(Math.cos(a) * rx, 0.04, Math.sin(a) * rz)
        // lean outwards a little, like flames licking off the body
        mesh.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18)
        this.flames.push({ mesh, height: height * (0.8 + ((i * 7) % 5) * 0.08), phase: i * 1.7 })
      }
    }
    ring(5 + lvl * 2, 0.33, 0.27, 0.7 + lvl * 0.15, this.outer, 0)
    ring(3 + lvl, 0.2, 0.16, 0.5 + lvl * 0.1, this.inner, 0.4)

    if (lvl === LEVELS.length) {
      for (let i = 0; i < 3; i++) {
        const mesh = add(emberGeo, this.inner)
        this.embers.push({ mesh, height: 1.4, phase: i / 3 + 0.13 })
      }
    }
  }

  /** Flicker, sway and rising embers; `t` in seconds, `bodyY` follows the seat and the bob. */
  update(t: number, bodyY: number, visible: boolean): void {
    this.group.visible = visible && this.level > 0
    if (!this.group.visible || !this.outer || !this.inner) return
    this.group.position.y = bodyY
    const lvl = this.level
    const power = this.charged ? 1 : 0.5
    const speed = Aura.reduced ? 0 : (this.charged ? 6 : 3) + lvl * 1.5
    const pulse = Aura.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * (2 + lvl))
    this.outer.opacity = (0.26 + lvl * 0.06) * power + pulse * 0.05
    this.inner.opacity = (0.18 + lvl * 0.05) * power
    for (const f of this.flames) {
      const flicker = 0.72 + 0.38 * Math.abs(Math.sin(t * speed + f.phase)) + 0.1 * Math.sin(t * speed * 2.3 + f.phase * 3)
      f.mesh.scale.set(1, f.height * power * flicker, 1)
    }
    for (const e of this.embers) {
      const k = Aura.reduced ? e.phase % 1 : (t * (0.6 + lvl * 0.12) + e.phase) % 1
      const a = e.phase * 9.1
      e.mesh.visible = this.charged
      e.mesh.position.set(Math.cos(a) * (0.34 - k * 0.12), 0.1 + k * e.height, Math.sin(a) * (0.28 - k * 0.1))
      e.mesh.scale.setScalar(1 - k * 0.6)
    }
  }
}
