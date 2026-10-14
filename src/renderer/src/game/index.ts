import { totemView } from '@shared/routines'
import type { State } from '../state'
import { Aura } from '../world/aura'
import type { Avatar } from '../world/avatar'
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
    this.setProjects(state.settings.projects, state.squads, false)
    for (const a of state.agents.values()) this.addActor(a, false)
    state.onChange(() => {
      this.sync()
      this.wake()
    })
    this.bindInput(container)
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
    this.updateTotem(dt)
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

  /**
   * The totem's screen and LED. The text is worked out once a second and the canvas is
   * drawn only when it changed (the countdown moves once a minute above one minute).
   */
  private updateTotem(dt: number): void {
    this.totemIn -= dt
    if (this.totemIn > 0) return
    this.totemIn = 1
    const view = totemView(this.state.routines)
    // the tag is HTML: it only touches the DOM when its text changes
    this.totem.tag.setDot(`routine-${view.led}`)
    // the screen is pixel art: the balloon carries the line in letters people can read
    this.totem.tag.setBubble(view.line, view.led === 'wait' ? 'wait' : 'idle')
    if (this.totem.tag.el.title !== view.line) this.totem.tag.el.title = view.line
    if (this.totem.view.show(view) && this.player.floor === 0) this.wake(100)
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
