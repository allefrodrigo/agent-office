import * as THREE from 'three'
import * as L from '../world/layout'
import { GameMovement } from './movement'
import { SKULL_HOME, type Point } from './types'

/** Camera and input: keys, drag to pan, wheel to zoom, clicks and the hover outline. */
export abstract class GameInput extends GameMovement {
  // ---------- input ----------

  protected bindInput(el: HTMLElement): void {
    const isTyping = () => {
      const a = document.activeElement
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement
    }
    window.addEventListener('keydown', (e) => {
      if (isTyping() || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k)
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => this.keys.clear())

    // any touch on the scene draws at full rate for a moment (hover outline, drag, zoom)
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'wheel'] as const) el.addEventListener(type, () => this.wake(), { passive: true })
    window.addEventListener('keydown', () => this.wake())

    el.addEventListener('contextmenu', (e) => e.preventDefault())
    el.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY, moved: false, button: e.button }
      el.setPointerCapture(e.pointerId)
    })
    el.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const dx = e.clientX - this.dragging.x
        const dy = e.clientY - this.dragging.y
        if (this.dragging.moved || Math.hypot(dx, dy) > 5) {
          this.dragging.moved = true
          this.follow = false
          this.watch = null
          this.engine.pan(dx, dy)
          this.dragging.x = e.clientX
          this.dragging.y = e.clientY
        }
      }
      this.updateHover(e.clientX, e.clientY)
    })
    el.addEventListener('pointerup', (e) => {
      const d = this.dragging
      this.dragging = null
      if (!d || d.moved || d.button !== 0) return
      this.click(e.clientX, e.clientY)
    })
    el.addEventListener('pointerleave', () => (this.hover.visible = false))
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.wheelAcc += e.deltaY
        if (Math.abs(this.wheelAcc) > 40) {
          this.engine.zoomStep(this.wheelAcc > 0 ? -1 : 1)
          this.wheelAcc = 0
        }
      },
      { passive: false },
    )
  }

  /** Helpers answer with their parent's id, plus their own in `helper`. */
  protected agentAt(x: number, y: number): { id: string; helper?: string } | null {
    const view = this.player.floor
    const roots = [...this.actors.values()].filter((a) => a.goal !== 'leave' && !a.down && a.avatar.floor === view).map((a) => a.avatar.root)
    const helpers = [...this.helpers.values()].filter((h) => !h.gone && h.avatar.floor === view)
    for (const h of helpers) roots.push(h.avatar.root)
    for (const hit of this.engine.pick(x, y, roots)) {
      const id = hit.object.userData.avatarId as string | undefined
      if (!id) continue
      let o: THREE.Object3D | null = hit.object
      while (o && !helpers.some((h) => h.avatar.root === o)) o = o.parent
      const helper = o ? helpers.find((h) => h.avatar.root === o) : undefined
      return helper ? { id, helper: helper.id } : { id }
    }
    return null
  }

  protected click(x: number, y: number): void {
    if (this.onSkull(x, y)) {
      this.hooks.onSkull()
      return
    }
    if (this.onTv(x, y)) {
      this.hooks.onTv()
      return
    }
    if (this.onRoutinesBoard(x, y)) {
      this.hooks.onRoutines()
      return
    }
    if (this.onCoffee(x, y)) {
      this.hooks.onCoffee()
      return
    }
    if (this.player.floor > 0) {
      const roots = [...this.members.values()].filter((m) => m.phase !== 'leaving' && m.avatar.floor === this.player.floor).map((m) => m.avatar.root)
      const hit = this.engine.pick(x, y, roots).find((h) => String(h.object.userData.avatarId ?? '').startsWith('member:'))
      if (hit) return this.memberClick(String(hit.object.userData.avatarId).slice('member:'.length))
    }
    const hit = this.agentAt(x, y)
    if (hit) {
      this.hooks.onAgentClick(hit.id, hit.helper)
      return
    }
    const p = this.engine.pickFloor(x, y)
    if (!p) return
    const tile: [number, number] = [Math.floor(p.x), Math.floor(p.z)]
    if (!this.floorOf(this.player.floor).grid.inside(tile[0], tile[1])) return
    this.walkPlayerTo(tile)
  }

  protected onTv(x: number, y: number): boolean {
    return this.player.floor === 0 && this.engine.pick(x, y, [this.office.tv.group]).length > 0
  }

  /** Every floor has one, in your office or the Diretoria. */
  protected onRoutinesBoard(x: number, y: number): boolean {
    return this.engine.pick(x, y, [this.floorOf(this.player.floor).routines.group]).length > 0
  }

  protected onCoffee(x: number, y: number): boolean {
    return this.player.floor === 0 && this.engine.pick(x, y, [this.office.coffee.group]).length > 0
  }

  protected onSkull(x: number, y: number): boolean {
    return this.player.floor === 0 && this.engine.pick(x, y, [this.skull.root]).length > 0
  }

  setTvOn(on: boolean): void {
    this.office.tv.setOn(on)
  }

  /**
   * Where the TV screen is on the page (top-left, top-right, bottom-left), or null
   * when its floor is not on screen. Valid after the frame rendered.
   */
  tvCorners(): [Point, Point, Point] | null {
    if (this.player.floor !== 0) return null
    const { screen, size } = this.office.tv
    const at = (x: number, y: number) => this.engine.project(screen.localToWorld(new THREE.Vector3(x, y, 0)))
    return [at(-size.w / 2, size.h / 2), at(size.w / 2, size.h / 2), at(-size.w / 2, -size.h / 2)]
  }

  protected updateHover(x: number, y: number): void {
    const p = this.engine.pickFloor(x, y)
    const grid = this.floorOf(this.player.floor).grid
    if (!p || !grid.inside(Math.floor(p.x), Math.floor(p.z)) || this.agentAt(x, y)) {
      this.hover.visible = false
      document.body.style.cursor = this.agentAt(x, y) ? 'pointer' : ''
      return
    }
    if (this.onTv(x, y) || this.onSkull(x, y) || this.onRoutinesBoard(x, y) || this.onCoffee(x, y)) {
      this.hover.visible = false
      document.body.style.cursor = 'pointer'
      return
    }
    document.body.style.cursor = ''
    const tx = Math.floor(p.x)
    const tz = Math.floor(p.z)
    this.hover.visible = true
    this.hover.position.set(tx, 0, tz)
    ;(this.hover.material as THREE.LineBasicMaterial).color.set(grid.walkable(tx, tz) ? '#ffffff' : '#ff8a80')
  }

  // ---------- guided tour ----------

  /** Spots of the ground floor the tour shows; null for one that does not exist (yet). */
  tourSpot(id: string): THREE.Vector3 | null {
    switch (id) {
      case 'desk':
        return new THREE.Vector3(3.3, 1.35, L.BOSS_DESK.z + 0.5)
      case 'team':
        return new THREE.Vector3(21, 1, 5.5)
      case 'skull':
        return new THREE.Vector3(SKULL_HOME.x, 1, SKULL_HOME.z)
      case 'tv':
        return this.office.tv.screen.getWorldPosition(new THREE.Vector3())
      case 'routines':
        return this.office.routines.anchor.getWorldPosition(new THREE.Vector3()).setY(1.6)
      default:
        return null
    }
  }

  /** The tour points the camera at a spot of the ground floor; `instant` jumps there (reduced motion). */
  lookAtSpot(id: string, instant: boolean): void {
    const p = this.tourSpot(id)
    if (!p) return
    this.goFloor(0)
    // after goFloor, which hands the camera back to the player
    this.follow = false
    this.watch = null
    if (instant) this.engine.jumpTo(p.x, p.z)
    else this.engine.target.set(p.x, 0, p.z)
    this.wake(1500)
  }

  /** Where a tour spot is on the page, or null when the ground floor is not on screen. */
  spotOnPage(id: string): Point | null {
    const p = this.player.floor === 0 ? this.tourSpot(id) : null
    return p ? this.engine.project(p) : null
  }

  /** The camera follows the player again (the tour ended). */
  followPlayer(): void {
    this.follow = true
    this.wake(1500)
  }

  setPixelSize(n: number): void {
    this.engine.setPixelSize(n)
  }

  zoom(delta: number): void {
    this.engine.zoomStep(delta)
  }
}
