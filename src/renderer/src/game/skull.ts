import { sfx } from '../world/effects'
import { GameSquads } from './squads'
import { STRIKE_AFTER_S, type Actor } from './types'

/** The skull by the boss office: dismissing an agent. */
export abstract class GameSkull extends GameSquads {
  // ---------- the skull ----------

  /**
   * Sends the camera to an agent (on any floor, waiting out an elevator ride) and
   * strikes it with the skull. `done` runs once the animation ends, or right away when
   * the agent is not in the office to strike; the caller ends the session then.
   * False when the agent is already on its way out.
   */
  dismiss(agentId: string, done: () => void): boolean {
    const actor = this.actors.get(agentId)
    if (!actor) {
      done()
      return true
    }
    if (actor.goal === 'leave' || actor.down || this.doomed.has(agentId)) return false
    this.focusAgent(agentId)
    this.doomed.set(agentId, { at: this.time + STRIKE_AFTER_S, done })
    return true
  }

  protected updateSkull(): void {
    // the eyes smoulder, and blaze (with the skull rattling) while a strike is coming
    const busy = this.doomed.size > 0
    const k = busy ? 1 : 0.6 + 0.4 * Math.sin(this.time * 2.2)
    this.skull.eyes.color.setRGB(k, 0.23 * k, 0.36 * k)
    this.skull.root.rotation.z = busy ? Math.sin(this.time * 40) * 0.05 : 0
    for (const [id, d] of this.doomed) {
      const actor = this.actors.get(id)
      // left on its own before the strike: nothing to animate
      if (!actor || actor.goal === 'leave') {
        this.doomed.delete(id)
        d.done()
        continue
      }
      // in the elevator: the camera gets its time again once the doors open
      if (actor.riding) d.at = this.time + STRIKE_AFTER_S
      if (this.time < d.at) continue
      this.doomed.delete(id)
      // again, in case the player took the camera back meanwhile
      this.focusAgent(id)
      this.strike(actor, d.done)
    }
    for (const actor of this.actors.values()) {
      if (actor.shoutUntil && this.time >= actor.shoutUntil) {
        actor.shoutUntil = 0
        const a = this.state.agents.get(actor.id)
        if (a && !actor.down) this.bubble(actor, a)
      }
    }
  }

  /** The skull drops over the agent and knocks it out; then a ghost rises and `done` runs. */
  protected strike(actor: Actor, done: () => void): void {
    actor.down = true
    actor.spot = null
    actor.hang = null
    actor.chatUntil = 0
    actor.avatar.stop()
    actor.avatar.pose = 'stand'
    actor.avatar.seatY = 0
    actor.avatar.setProp('none')
    actor.tag.setBubble('!?', 'error')
    setTimeout(() => actor.avatar.hitReact(), 800)
    this.effects.strike(actor.avatar.position, () => {
      actor.avatar.knockDown()
      actor.tag.setBubble('x_x', 'error')
      sfx.ko()
      setTimeout(() => this.effects.ghost(actor.avatar.position), 600)
      setTimeout(done, 1700)
    })
  }

  /** A struck agent whose session did not close gets back up. */
  revive(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (!actor || !actor.down) return
    actor.avatar.getUp()
    actor.down = false
    actor.goal = null
    actor.shout = 'Ufa! Escapei.'
    actor.shoutKind = 'error'
    actor.shoutUntil = this.time + 2.5
    this.reconcile(actor)
  }

  /** Ghost rises out of an agent whose session is being closed; removal follows from state. */
  ghostOut(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (actor) this.effects.ghost(actor.avatar.position)
  }
}
