import * as THREE from 'three'
import { mat } from './kit'
import { disposeTree, shared } from './dispose'
import { FACE_CAMERA, skull } from './skull'

interface Particle {
  mesh: THREE.Object3D
  vel: THREE.Vector3
  life: number
  max: number
  gravity: number
  fade?: THREE.Material[]
  /** Scale growth per second (smoke puffs swell as they rise). */
  grow?: number
}

/** A skull that drops over an agent, cackles and dives at it. */
interface Strike {
  obj: THREE.Group
  /** Live position of the target: the skull follows it. */
  at: THREE.Vector3
  t: number
  onHit: () => void
}

const sparkGeo = shared(new THREE.BoxGeometry(0.05, 0.05, 0.05))
const puffGeo = shared(new THREE.BoxGeometry(0.22, 0.22, 0.22))

/** Strike timing, in seconds: drop in, cackle in the air, dive. */
const DROP_S = 0.8
const CACKLE_S = 0.45
const DIVE_S = 0.15
const HOVER_Y = 1.35

/** Sparks, smoke, ghosts and the skull strike. */
export class Effects {
  private particles: Particle[] = []
  private strikes: Strike[] = []
  /** Fewer sparks and puffs, the skull holds still (Configurações → Vídeo or prefers-reduced-motion). */
  reduced = false

  constructor(private scene: THREE.Scene) {}

  /** Anything still playing: the loop keeps drawing at full rate meanwhile. */
  get active(): boolean {
    return this.particles.length > 0 || this.strikes.length > 0
  }

  sparks(at: THREE.Vector3, colors = ['#ffd166', '#ff7a1a', '#ffffff']): void {
    for (let i = 0; i < (this.reduced ? 3 : 7); i++) {
      const m = new THREE.Mesh(sparkGeo, mat(colors[i % colors.length]))
      m.userData.fx = 'spark'
      m.position.copy(at)
      this.scene.add(m)
      const a = Math.random() * Math.PI * 2
      const v = new THREE.Vector3(Math.cos(a) * 1.6, 1.2 + Math.random() * 1.4, Math.sin(a) * 1.6)
      this.particles.push({ mesh: m, vel: v, life: 0.35, max: 0.35, gravity: 9 })
    }
  }

  /** A burst of dark purple puffs that swell and drift up. */
  smoke(at: THREE.Vector3): void {
    const n = this.reduced ? 3 : 9
    for (let i = 0; i < n; i++) {
      const m = new THREE.MeshBasicMaterial({ color: i % 3 ? '#4b3a66' : '#7a5cc4', transparent: true, opacity: 0.85, depthWrite: false })
      const mesh = new THREE.Mesh(puffGeo, m)
      mesh.userData.fx = 'smoke'
      const a = (i / n) * Math.PI * 2
      mesh.position.copy(at).add(new THREE.Vector3(Math.cos(a) * 0.15, 0.2 + Math.random() * 0.4, Math.sin(a) * 0.15))
      mesh.rotation.set(Math.random(), Math.random(), Math.random())
      this.scene.add(mesh)
      const v = new THREE.Vector3(Math.cos(a) * 0.7, 0.5 + Math.random() * 0.5, Math.sin(a) * 0.7)
      this.particles.push({ mesh, vel: v, life: 0.9, max: 0.9, gravity: -0.4, fade: [m], grow: 1.2 })
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
    g.userData.fx = 'ghost'
    this.scene.add(g)
    this.particles.push({ mesh: g, vel: new THREE.Vector3(0, 0.9, 0), life: 1.8, max: 1.8, gravity: -0.2, fade: [body, eye] })
  }

  /**
   * A skull drops from above the target, cackles and dives into it. `onHit` runs on
   * impact, about 1.4 s later. `at` is read every frame, so pass the live position.
   */
  strike(at: THREE.Vector3, onHit: () => void): void {
    const obj = skull().group
    obj.userData.fx = 'skull'
    obj.scale.setScalar(1.4)
    obj.position.set(at.x, HOVER_Y + 1.6, at.z)
    this.scene.add(obj)
    this.strikes.push({ obj, at, t: 0, onHit })
    sfx.whoosh()
    setTimeout(() => sfx.cackle(), DROP_S * 1000)
  }

  update(dt: number): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i]
      s.t += dt
      const o = s.obj
      o.rotation.set(0, FACE_CAMERA, 0)
      let y: number
      if (s.t < DROP_S) {
        // falls in, spinning down to a stop facing the camera
        const e = 1 - (1 - s.t / DROP_S) ** 3
        y = HOVER_Y + 1.6 * (1 - e)
        o.rotation.y = FACE_CAMERA + (1 - e) * Math.PI * 4
      } else if (s.t < DROP_S + CACKLE_S) {
        // rattles in the air (holds still with reduced effects)
        const k = this.reduced ? 0 : 1
        y = HOVER_Y + Math.sin(s.t * 34) * 0.025 * k
        o.rotation.z = Math.sin(s.t * 46) * 0.14 * k
      } else {
        const k = Math.min(1, (s.t - DROP_S - CACKLE_S) / DIVE_S)
        y = HOVER_Y - 0.8 * k
        o.rotation.x = 0.7 * k
      }
      o.position.set(s.at.x, y, s.at.z)
      if (s.t >= DROP_S + CACKLE_S + DIVE_S) {
        const hit = new THREE.Vector3(s.at.x, 0.55, s.at.z)
        disposeTree(o)
        this.scene.remove(o)
        this.strikes.splice(i, 1)
        this.smoke(hit)
        this.sparks(hit, ['#b28cff', '#ff3b5c', '#efe6d2'])
        s.onHit()
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      p.vel.y -= p.gravity * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt)
      if (p.fade) {
        const k = Math.max(0, p.life / p.max)
        for (const m of p.fade) m.opacity = 0.85 * k
        p.mesh.position.x += Math.sin(p.life * 6) * dt * 0.3
      }
      if (p.life <= 0) {
        disposeTree(p.mesh)
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
  whoosh: () => tone('sine', 180, 720, 0.6, 0.03),
  /** "Ha-ha-ha", falling. */
  cackle: () => {
    for (let i = 0; i < 3; i++) setTimeout(() => tone('square', 560 - i * 70, 380 - i * 60, 0.09, 0.03), i * 130)
  },
  ko: () => {
    tone('triangle', 620, 70, 0.55, 0.07)
    setTimeout(() => tone('sine', 300, 900, 0.5, 0.03), 500)
  },
}
