import * as THREE from 'three'
import { box, mat } from './kit'

/**
 * Airsoft pistol held in the hand: the barrel runs along the arm's local -y
 * (so it points wherever the arm points) and the grip along -z.
 */
export function heldGun(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.06, 0.22, 0.08, '#26262e', 0, -0.52, 0, false)
  box(g, 0.064, 0.035, 0.084, '#ff7a1a', 0, -0.555, 0, false)
  box(g, 0.05, 0.08, 0.1, '#3a3a44', 0, -0.37, -0.08, false)
  box(g, 0.02, 0.05, 0.03, '#26262e', 0, -0.42, -0.03, false)
  return g
}

/** Pickup version: same gun, held horizontally and a bit bigger so it reads as an item. */
export function pickupGun(): THREE.Group {
  const g = heldGun()
  g.rotation.x = -Math.PI / 2
  g.position.set(0, 0, -0.45)
  const wrap = new THREE.Group()
  wrap.add(g)
  wrap.scale.setScalar(1.7)
  wrap.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })
  return wrap
}

interface Pellet {
  mesh: THREE.Mesh
  target: () => THREE.Vector3 | null
  fallback: THREE.Vector3
  onHit?: () => void
  life: number
}

interface Particle {
  mesh: THREE.Object3D
  vel: THREE.Vector3
  life: number
  max: number
  gravity: number
  fade?: THREE.Material[]
}

const pelletGeo = new THREE.SphereGeometry(0.045, 6, 4)
const pelletMat = new THREE.MeshBasicMaterial({ color: '#fff3a8' })
const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05)
const SPEED = 16

/** BB pellets, sparks, muzzle flashes and ghosts. */
export class Effects {
  private pellets: Pellet[] = []
  private particles: Particle[] = []

  constructor(private scene: THREE.Scene) {}

  fire(from: THREE.Vector3, target: () => THREE.Vector3 | null, fallback: THREE.Vector3, onHit?: () => void): void {
    const mesh = new THREE.Mesh(pelletGeo, pelletMat)
    mesh.position.copy(from)
    this.scene.add(mesh)
    this.pellets.push({ mesh, target, fallback, onHit, life: 1.5 })
    this.flash(from)
  }

  private flash(at: THREE.Vector3): void {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: '#ffd166' }))
    m.position.copy(at)
    this.scene.add(m)
    this.particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0.06, max: 0.06, gravity: 0 })
  }

  sparks(at: THREE.Vector3, colors = ['#ffd166', '#ff7a1a', '#ffffff']): void {
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(sparkGeo, mat(colors[i % colors.length]))
      m.position.copy(at)
      this.scene.add(m)
      const a = Math.random() * Math.PI * 2
      const v = new THREE.Vector3(Math.cos(a) * 1.6, 1.2 + Math.random() * 1.4, Math.sin(a) * 1.6)
      this.particles.push({ mesh: m, vel: v, life: 0.35, max: 0.35, gravity: 9 })
    }
  }

  /** A little ghost that floats up out of a knocked-out agent. */
  ghost(at: THREE.Vector3): void {
    const g = new THREE.Group()
    const body = new THREE.MeshBasicMaterial({ color: '#f4f2ff', transparent: true, opacity: 0.85, depthWrite: false })
    const eye = new THREE.MeshBasicMaterial({ color: '#1d1b26', transparent: true, opacity: 0.85, depthWrite: false })
    const add = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      mesh.position.set(x, y, z)
      g.add(mesh)
    }
    add(0.4, 0.42, 0.36, body, 0, 0.21, 0)
    for (let i = -1; i <= 1; i++) add(0.12, 0.1, 0.36, body, i * 0.13, -0.04, 0)
    add(0.06, 0.08, 0.02, eye, -0.08, 0.28, 0.19)
    add(0.06, 0.08, 0.02, eye, 0.08, 0.28, 0.19)
    g.position.copy(at).add(new THREE.Vector3(0, 0.5, 0))
    this.scene.add(g)
    this.particles.push({ mesh: g, vel: new THREE.Vector3(0, 0.9, 0), life: 1.8, max: 1.8, gravity: -0.2, fade: [body, eye] })
  }

  update(dt: number): void {
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const p = this.pellets[i]
      p.life -= dt
      const live = p.target()
      const dest = live ?? p.fallback
      const d = dest.clone().sub(p.mesh.position)
      const dist = d.length()
      const step = SPEED * dt
      if (dist <= step || p.life <= 0) {
        p.mesh.position.copy(dest)
        if (live && p.onHit) {
          this.sparks(dest)
          p.onHit()
        } else {
          this.sparks(dest, ['#fff3a8', '#cfcfd8'])
        }
        this.scene.remove(p.mesh)
        this.pellets.splice(i, 1)
      } else {
        p.mesh.position.addScaledVector(d, step / dist)
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      p.vel.y -= p.gravity * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      if (p.fade) {
        const k = Math.max(0, p.life / p.max)
        for (const m of p.fade) m.opacity = 0.85 * k
        p.mesh.position.x += Math.sin(p.life * 6) * dt * 0.3
      }
      if (p.life <= 0) {
        this.scene.remove(p.mesh)
        this.particles.splice(i, 1)
      }
    }
  }
}

// ---------- tiny synthesized sound effects ----------

let audio: AudioContext | null = null

function tone(type: OscillatorType, from: number, to: number, dur: number, vol: number): void {
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, t)
    osc.frequency.exponentialRampToValueAtTime(to, t + dur)
    gain.gain.setValueAtTime(vol, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + dur)
  } catch {
    // audio unavailable: play silently
  }
}

export const sfx = {
  shot: () => tone('square', 1500, 260, 0.08, 0.04),
  hit: () => tone('triangle', 520, 980, 0.07, 0.07),
  ko: () => {
    tone('triangle', 620, 70, 0.55, 0.07)
    setTimeout(() => tone('sine', 300, 900, 0.5, 0.03), 500)
  },
  pickup: () => {
    tone('square', 660, 660, 0.06, 0.03)
    setTimeout(() => tone('square', 990, 990, 0.08, 0.03), 70)
  },
  drop: () => tone('triangle', 400, 200, 0.1, 0.04),
}
