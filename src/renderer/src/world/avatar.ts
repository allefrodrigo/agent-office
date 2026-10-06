import * as THREE from 'three'
import type { Look } from '@shared/types'
import { blob, box, mat } from './kit'
import { shadeHex } from './furniture'
import { heldGun } from './weapons'

export type Pose = 'stand' | 'sit' | 'type' | 'wave' | 'talk' | 'relax' | 'play'
export type Prop = 'none' | 'paper' | 'redPaper' | 'mug' | 'gun'

const HIP = 0.46
const SHOULDER = 0.8
const HEAD_Y = 1.04
const SNAP = Math.PI / 4

let shadowGeo: THREE.CircleGeometry | null = null
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.2, depthWrite: false })

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

/** A blocky, Habbo-proportioned character with procedural animation. */
export class Avatar {
  readonly root = new THREE.Group()
  /** World-space point above the head where name tags and bubbles attach. */
  readonly anchor = new THREE.Object3D()
  private body = new THREE.Group()
  private headGroup = new THREE.Group()
  private hairGroup = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private thighL = new THREE.Group()
  private thighR = new THREE.Group()
  private shinL = new THREE.Group()
  private shinR = new THREE.Group()
  private propGroup = new THREE.Group()
  /** Lives on the right arm so the gun points wherever the arm points. */
  private gunGroup = new THREE.Group()
  private recoil = 0
  private hurt = 0
  /** Seconds since being knocked down, or -1 when standing. */
  private downT = -1
  private shirtMeshes: THREE.Mesh[] = []

  pose: Pose = 'stand'
  prop: Prop = 'none'
  private path: THREE.Vector3[] = []
  private onArrive: (() => void) | null = null
  private walking = false
  /** Seconds of walk animation left from keyboard steering. */
  private steer = 0
  private phase = Math.random() * 10
  private t = Math.random() * 10
  private angle = 0
  private targetAngle = 0
  speed = 3
  /** Extra height while sitting, so seats of different heights line up. */
  seatY = 0

  constructor(
    public look: Look,
    readonly id: string,
  ) {
    this.root.add(this.body)
    this.anchor.position.y = 1.55
    this.root.add(this.anchor)
    if (!shadowGeo) shadowGeo = new THREE.CircleGeometry(0.26, 12).rotateX(-Math.PI / 2)
    const shadow = new THREE.Mesh(shadowGeo, shadowMat)
    shadow.position.y = 0.025
    shadow.renderOrder = 1
    this.root.add(shadow)
    this.build()
  }

  private build(): void {
    const L = this.look
    this.body.clear()
    this.shirtMeshes = []
    const shirtDark = shadeHex(L.shirt, -30)

    // legs: thigh pivots at the hip, shin pivots at the knee
    for (const [thigh, shin, x] of [
      [this.thighL, this.shinL, 0.09],
      [this.thighR, this.shinR, -0.09],
    ] as const) {
      thigh.clear()
      shin.clear()
      thigh.position.set(x, HIP, 0)
      box(thigh, 0.14, 0.22, 0.15, L.pants, 0, -0.22, 0)
      shin.position.set(0, -0.2, 0)
      box(shin, 0.13, 0.2, 0.14, L.pants, 0, -0.2, 0)
      box(shin, 0.14, 0.06, 0.2, L.shoes, 0, -0.26, 0.025)
      thigh.add(shin)
      this.body.add(thigh)
    }

    // torso
    const torso = box(this.body, 0.36, 0.36, 0.21, L.shirt, 0, HIP - 0.02, 0)
    this.shirtMeshes.push(torso)
    box(this.body, 0.37, 0.05, 0.22, L.pants, 0, HIP - 0.04, 0)
    box(this.body, 0.2, 0.03, 0.01, shirtDark, 0, HIP + 0.26, 0.106, false)

    // arms pivot at the shoulders
    for (const [arm, x] of [
      [this.armL, 0.235],
      [this.armR, -0.235],
    ] as const) {
      arm.clear()
      arm.position.set(x, SHOULDER, 0)
      this.shirtMeshes.push(box(arm, 0.11, 0.2, 0.13, L.shirt, 0, -0.2, 0))
      box(arm, 0.1, 0.13, 0.12, L.skin, 0, -0.33, 0)
      this.body.add(arm)
    }
    this.armR.add(this.gunGroup)

    // head
    this.headGroup.clear()
    this.headGroup.position.set(0, HEAD_Y, 0)
    box(this.headGroup, 0.06, 0.06, 0.06, L.skin, 0, -0.24, 0)
    box(this.headGroup, 0.42, 0.4, 0.38, L.skin, 0, -0.2, 0)
    const eye = mat('#1d1b26')
    box(this.headGroup, 0.06, 0.08, 0.012, eye, -0.09, -0.08, 0.19, false)
    box(this.headGroup, 0.06, 0.08, 0.012, eye, 0.09, -0.08, 0.19, false)
    box(this.headGroup, 0.022, 0.025, 0.014, '#ffffff', -0.075, -0.035, 0.192, false)
    box(this.headGroup, 0.022, 0.025, 0.014, '#ffffff', 0.105, -0.035, 0.192, false)
    box(this.headGroup, 0.07, 0.02, 0.012, shadeHex(L.skin, -60), 0, -0.15, 0.19, false)
    box(this.headGroup, 0.05, 0.025, 0.01, '#f4a6a6', -0.15, -0.12, 0.19, false)
    box(this.headGroup, 0.05, 0.025, 0.01, '#f4a6a6', 0.15, -0.12, 0.19, false)
    box(this.headGroup, 0.03, 0.08, 0.06, L.skin, -0.225, -0.09, 0)
    box(this.headGroup, 0.03, 0.08, 0.06, L.skin, 0.225, -0.09, 0)
    this.hairGroup.clear()
    this.buildHair(L)
    this.headGroup.add(this.hairGroup)
    this.body.add(this.headGroup)

    this.propGroup.clear()
    this.body.add(this.propGroup)
    this.setProp(this.prop, true)

    this.body.traverse((o) => {
      o.userData.avatarId = this.id
    })
  }

  private buildHair(L: Look): void {
    const g = this.hairGroup
    const c = L.hair
    const dark = shadeHex(c, -25)
    const cap = () => {
      box(g, 0.45, 0.1, 0.41, c, 0, 0.18, -0.005)
      box(g, 0.45, 0.24, 0.07, c, 0, -0.04, -0.17)
      box(g, 0.04, 0.16, 0.34, c, -0.215, 0.04, -0.02)
      box(g, 0.04, 0.16, 0.34, c, 0.215, 0.04, -0.02)
      box(g, 0.44, 0.06, 0.05, c, 0, 0.13, 0.18)
    }
    switch (L.hairStyle % 6) {
      case 0: // short side part
        cap()
        box(g, 0.16, 0.05, 0.05, dark, 0.1, 0.1, 0.19, false)
        break
      case 1: // spiky
        cap()
        for (const [x, z, r] of [[-0.12, 0.05, 0.3], [0.02, 0.1, -0.2], [0.14, -0.02, 0.25], [-0.04, -0.12, -0.3]]) {
          const s = box(g, 0.12, 0.12, 0.12, c, x, 0.24, z)
          s.rotation.set(r, r * 2, r)
        }
        break
      case 2: // long
        cap()
        box(g, 0.46, 0.5, 0.08, c, 0, -0.32, -0.17)
        box(g, 0.05, 0.42, 0.3, c, -0.22, -0.28, -0.04)
        box(g, 0.05, 0.42, 0.3, c, 0.22, -0.28, -0.04)
        break
      case 3: // bun
        cap()
        box(g, 0.18, 0.16, 0.18, c, 0, 0.26, -0.1)
        box(g, 0.2, 0.03, 0.2, dark, 0, 0.26, -0.1, false)
        break
      case 4: // pigtails
        cap()
        box(g, 0.12, 0.2, 0.12, c, -0.27, -0.12, -0.08)
        box(g, 0.12, 0.2, 0.12, c, 0.27, -0.12, -0.08)
        box(g, 0.05, 0.05, 0.05, '#e84393', -0.25, 0.02, -0.08, false)
        box(g, 0.05, 0.05, 0.05, '#e84393', 0.25, 0.02, -0.08, false)
        break
      default: // curly / afro
        blob(g, 0.3, c, 0, 0.12, -0.06, 0.85, 1)
        blob(g, 0.14, dark, -0.18, 0.04, -0.1, 1, 0)
        blob(g, 0.14, dark, 0.18, 0.04, -0.1, 1, 0)
        box(g, 0.44, 0.06, 0.06, c, 0, 0.12, 0.17)
    }
  }

  setLook(look: Look): void {
    this.look = look
    this.build()
  }

  setProp(prop: Prop, force = false): void {
    if (prop === this.prop && !force) return
    this.prop = prop
    this.propGroup.clear()
    this.gunGroup.clear()
    if (prop === 'gun') {
      this.gunGroup.add(heldGun())
      this.gunGroup.traverse((o) => (o.userData.avatarId = this.id))
    } else if (prop === 'paper' || prop === 'redPaper') {
      const p = new THREE.Group()
      box(p, 0.26, 0.32, 0.03, prop === 'paper' ? '#fbfbf8' : '#ffecec', 0, 0, 0)
      box(p, 0.27, 0.06, 0.035, prop === 'paper' ? '#20a464' : '#e5484d', 0, 0.26, 0)
      for (let i = 0; i < 3; i++) box(p, 0.16, 0.012, 0.034, '#b2bec3', -0.02, 0.08 + i * 0.05, 0, false)
      p.position.set(0, 0.5, 0.28)
      p.rotation.x = -0.35
      this.propGroup.add(p)
    } else if (prop === 'mug') {
      const p = new THREE.Group()
      box(p, 0.08, 0.1, 0.08, '#ffffff', 0, 0, 0)
      box(p, 0.06, 0.01, 0.06, '#6f4e37', 0, 0.1, 0, false)
      p.position.set(-0.24, 0.46, 0.14)
      this.propGroup.add(p)
    }
  }

  get position(): THREE.Vector3 {
    return this.root.position
  }

  get isWalking(): boolean {
    return this.walking
  }

  get isDown(): boolean {
    return this.downT >= 0
  }

  /** World position of the gun's muzzle. */
  muzzle(): THREE.Vector3 {
    this.root.updateMatrixWorld(true)
    return this.gunGroup.localToWorld(new THREE.Vector3(0, -0.57, 0))
  }

  kick(): void {
    this.recoil = 0.12
  }

  /** Flinch after being hit. */
  hitReact(): void {
    this.hurt = 0.3
  }

  /** Falls flat on the back. */
  knockDown(): void {
    this.stop()
    this.seatY = 0
    this.downT = 0
  }

  getUp(): void {
    this.downT = -1
    this.pose = 'stand'
  }

  /** Animates walking while something else (keyboard) moves the avatar. */
  phaseStep(dt: number): void {
    this.steer = 0.08
    this.phase += dt * this.speed * 3.2
  }

  placeAt(x: number, z: number): void {
    this.root.position.set(x, 0, z)
    this.path = []
    this.walking = false
  }

  /** Points in world coordinates; the avatar walks through them in order. */
  walk(points: { x: number; z: number }[], onArrive?: () => void): void {
    this.path = points.map((p) => new THREE.Vector3(p.x, 0, p.z))
    this.onArrive = onArrive ?? null
    this.walking = this.path.length > 0
    if (this.pose !== 'stand' && this.pose !== 'wave' && this.pose !== 'talk') this.pose = 'stand'
    this.seatY = 0
    if (!this.walking) {
      const cb = this.onArrive
      this.onArrive = null
      cb?.()
    }
  }

  stop(): void {
    this.path = []
    this.walking = false
    this.onArrive = null
  }

  /** Face a direction given as angle (0 = +z), snapped to 8 directions like Habbo. */
  face(angle: number, snap = true, immediate = false): void {
    this.targetAngle = snap ? Math.round(angle / SNAP) * SNAP : angle
    if (immediate) {
      this.angle = this.targetAngle
      this.root.rotation.y = this.angle
    }
  }

  faceTowards(x: number, z: number, snap = true, immediate = false): void {
    const dx = x - this.root.position.x
    const dz = z - this.root.position.z
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return
    this.face(Math.atan2(dx, dz), snap, immediate)
  }

  update(dt: number): void {
    this.t += dt
    // movement
    if (this.walking && this.path.length) {
      const target = this.path[0]
      const pos = this.root.position
      const dx = target.x - pos.x
      const dz = target.z - pos.z
      const dist = Math.hypot(dx, dz)
      const step = this.speed * dt
      if (dist > 1e-3) this.face(Math.atan2(dx, dz))
      if (dist <= step) {
        pos.set(target.x, 0, target.z)
        this.path.shift()
        if (!this.path.length) {
          this.walking = false
          const cb = this.onArrive
          this.onArrive = null
          cb?.()
        }
      } else {
        pos.x += (dx / dist) * step
        pos.z += (dz / dist) * step
      }
      this.phase += dt * this.speed * 3.2
    }

    this.steer = Math.max(0, this.steer - dt)
    this.recoil = Math.max(0, this.recoil - dt)
    this.hurt = Math.max(0, this.hurt - dt)
    if (this.downT >= 0) this.downT += dt

    // turning
    const diff = wrapAngle(this.targetAngle - this.angle)
    this.angle = Math.abs(diff) < 0.01 ? this.targetAngle : this.angle + diff * Math.min(1, dt * 16)
    this.root.rotation.y = this.angle

    this.animate()
  }

  private animate(): void {
    const t = this.t
    const reset = (g: THREE.Object3D) => g.rotation.set(0, 0, 0)
    ;[this.armL, this.armR, this.thighL, this.thighR, this.shinL, this.shinR, this.headGroup, this.body].forEach(reset)
    this.body.position.set(0, 0, 0)

    if (this.downT >= 0) {
      // fall backwards, then lie still with arms out
      const k = Math.min(1, this.downT / 0.3)
      this.body.rotation.x = (-Math.PI / 2) * k
      this.body.position.y = 0.11 * k
      this.armL.rotation.z = 0.9 * k
      this.armR.rotation.z = -0.9 * k
      this.headGroup.rotation.z = Math.sin(t * 3) * 0.08 * k
      return
    }
    this.animatePose()
    if (this.prop === 'gun') this.armR.rotation.set(-Math.PI / 2 - this.recoil * 3, 0, 0)
    if (this.hurt > 0) {
      const k = this.hurt / 0.3
      this.body.rotation.x = -0.35 * k
      this.headGroup.rotation.z = Math.sin(t * 40) * 0.2 * k
    }
  }

  private animatePose(): void {
    const t = this.t

    const carrying = this.prop === 'paper' || this.prop === 'redPaper'
    if (this.walking || this.steer > 0) {
      const s = Math.sin(this.phase)
      this.thighL.rotation.x = s * 0.55
      this.thighR.rotation.x = -s * 0.55
      this.shinL.rotation.x = Math.max(0, -s) * 0.7
      this.shinR.rotation.x = Math.max(0, s) * 0.7
      if (carrying) {
        this.armL.rotation.x = -1.25
        this.armR.rotation.x = -1.25
      } else {
        this.armL.rotation.x = -s * 0.5
        this.armR.rotation.x = s * 0.5
      }
      this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.035
      return
    }

    const breathe = Math.sin(t * 2.2) * 0.008
    switch (this.pose) {
      case 'sit':
      case 'type':
      case 'relax': {
        this.body.position.y = this.seatY
        this.thighL.rotation.x = this.thighR.rotation.x = -Math.PI / 2
        this.shinL.rotation.x = this.shinR.rotation.x = Math.PI / 2
        if (this.pose === 'type') {
          this.armL.rotation.x = -1.05 + Math.max(0, Math.sin(t * 14)) * 0.12
          this.armR.rotation.x = -1.05 + Math.max(0, Math.sin(t * 14 + 2)) * 0.12
          this.headGroup.rotation.x = 0.06 + Math.sin(t * 0.7) * 0.03
        } else if (this.pose === 'relax') {
          this.armL.rotation.x = -0.4
          this.armR.rotation.z = -0.25
          this.headGroup.rotation.z = Math.sin(t * 0.5) * 0.06
          this.body.position.y += breathe
        } else {
          this.armL.rotation.x = this.armR.rotation.x = -0.7
          this.headGroup.rotation.y = Math.sin(t * 0.6) * 0.25
        }
        break
      }
      case 'play':
        // hands on the controls, wiggling, leaning in now and then
        this.armL.rotation.x = -1.15 + Math.sin(t * 9) * 0.18
        this.armR.rotation.x = -1.15 + Math.sin(t * 11 + 1) * 0.18
        this.body.rotation.x = Math.max(0, Math.sin(t * 1.3)) * 0.08
        this.headGroup.rotation.y = Math.sin(t * 2.1) * 0.15
        this.body.position.y = breathe
        break
      case 'wave':
        this.armR.rotation.z = -2.6 + Math.sin(t * 12) * 0.35
        this.body.position.y = breathe
        break
      case 'talk':
        this.armR.rotation.x = -0.5 + Math.sin(t * 5) * 0.2
        this.armL.rotation.x = -0.2 + Math.sin(t * 4 + 1) * 0.12
        this.headGroup.rotation.x = Math.sin(t * 6) * 0.05
        this.body.position.y = breathe
        break
      default:
        this.body.position.y = breathe
        this.headGroup.rotation.y = Math.sin(t * 0.4) * 0.12
    }
    if (carrying) {
      this.armL.rotation.x = -1.25
      this.armR.rotation.x = -1.25
    } else if (this.prop === 'mug' && this.pose !== 'type') {
      this.armL.rotation.x = -1.2 + Math.max(0, Math.sin(t * 0.8) - 0.85) * 4
    }
  }
}
