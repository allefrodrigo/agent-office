import type { State } from '../state'
import { Aura } from '../world/aura'
import type { Avatar } from '../world/avatar'
import { PixelEngine } from '../pixel/engine'
import { PixelPainter } from '../pixel/painter'
import type * as THREE from 'three'
import { WindowSky } from '../world/textures'
import { GameInput } from './input'
import { LOUNGE_AFTER_MS, type GameHooks } from './types'

export type { GameHooks } from './types'

/**
 * The office world: the floors, the player, the agents and their helpers. Split by
 * responsibility in game/*.ts, each part extending the previous one (base.ts first).
 */
export class Game extends GameInput {
  constructor(container: HTMLElement, overlayRoot: HTMLElement, state: State, hooks: GameHooks) {
    super(container, overlayRoot, state, hooks)
    if (this.engine instanceof PixelEngine) this.paintFlat(this.engine)
    this.setProjects(state.settings.projects, state.squads, false)
    for (const a of state.agents.values()) this.addActor(a, false)
    state.onChange(() => {
      this.sync()
      this.wake()
    })
    this.bindInput(container)
  }

  /** The 2D view reads the floor on screen and who stands on it. */
  private paintFlat(engine: PixelEngine): void {
    new PixelPainter(engine, {
      floor: () => this.floorOf(this.player.floor),
      people: () => {
        const view = this.player.floor
        const here = (av: Avatar) => av.floor === view && av.root.visible
        const out = here(this.player) ? [this.player] : []
        for (const a of this.actors.values()) if (here(a.avatar)) out.push(a.avatar)
        for (const h of this.helpers.values()) if (here(h.avatar)) out.push(h.avatar)
        for (const m of this.members.values()) if (here(m.avatar)) out.push(m.avatar)
        return out
      },
      skeleton: () => (this.player.floor === 0 ? this.skull.root : null),
      hover: () => (this.hover.visible ? { x: this.hover.position.x, z: this.hover.position.z, ok: (this.hover.material as THREE.LineBasicMaterial).color.getHex() === 0xffffff } : null),
      time: () => this.time,
    })
  }

  // ---------- loop ----------

  /**
   * True while something on screen moves: an avatar on this floor walks or turns, the
   * camera eases, an effect plays, the player steers or just touched the mouse. Otherwise
   * the loop drops to a slow tick (typing hands and monitors still move, only less often).
   */
  get busy(): boolean {
    if (performance.now() < this.wakeUntil || this.keys.size || this.dragging || this.doomed.size) return true
    if (this.engine.moving || this.engine.dirty || this.effects.active) return true
    const view = this.player.floor
    const moving = (av: Avatar) => av.floor === view && av.isMoving
    if (moving(this.player)) return true
    for (const a of this.actors.values()) if (moving(a.avatar)) return true
    for (const h of this.helpers.values()) if (moving(h.avatar)) return true
    for (const m of this.members.values()) if (moving(m.avatar)) return true
    return false
  }

  /** Sparks, smoke and the alarm toned down (Configurações → Vídeo, or prefers-reduced-motion). */
  setReducedEffects(on: boolean): void {
    this.effects.reduced = on
    Aura.reduced = on
    this.office.reducedMotion = on
    for (const u of this.uppers) u.scene.reducedMotion = on
    this.reducedEffects = on
  }

  /** Modo noturno: main lights off; windows, screens and lamps light the floors. */
  setNight(on: boolean): void {
    WindowSky.forceNight = on
    this.engine.setNight(on)
    this.office.setNight(on)
    for (const u of this.uppers) u.scene.setNight(on)
  }

  /** Moves everything by dt seconds; draws nothing (see draw). */
  update(dt: number): void {
    this.time += dt
    this.moveWithKeys(dt)
    this.player.update(dt)
    for (const actor of this.actors.values()) {
      actor.avatar.update(dt)
      if (actor.arrived && actor.goal === 'boss' && actor.avatar.pose === 'wave' && this.time > actor.waveUntil) {
        const a = this.state.agents.get(actor.id)
        if (a) this.pose(actor, a)
      }
    }
    this.updateHelpers(dt)
    this.updateMembers(dt)
    this.office.update(dt)
    for (const u of this.uppers) u.scene.update(dt)
    this.boardsIn -= dt
    if (this.boardsIn <= 0) this.syncBoards()
    this.showFloor()
    this.updateSkull()
    this.updateRoutines(dt)
    this.effects.update(dt)

    this.recheck -= dt
    if (this.recheck <= 0) {
      this.recheck = 0.4
      this.checkVisitors()
      for (const actor of this.actors.values()) {
        if (actor.chatUntil && this.time >= actor.chatUntil) {
          actor.chatUntil = 0
          actor.goal = null
          this.reconcile(actor)
          continue
        }
        if (actor.goal === 'desk' && actor.restSince !== null && Date.now() - actor.restSince >= LOUNGE_AFTER_MS) this.reconcile(actor)
      }
    }

    this.updateWatch()
    if (this.follow) this.engine.target.set(this.player.position.x, 0, this.player.position.z)
    this.engine.step(dt)
  }

  /** Draws the scene and moves the HTML tags along. Skipped while the window is hidden. */
  draw(dt: number): void {
    this.engine.render(dt)
    this.overlays.update()
  }

  /** People in the scene besides the player, for the dev leak test (dev/leak-test.ts). */
  get population(): { actors: number; helpers: number; members: number } {
    return { actors: this.actors.size, helpers: this.helpers.size, members: this.members.size }
  }
}
