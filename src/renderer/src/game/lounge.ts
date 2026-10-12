import type { AgentSummary } from '@shared/types'
import * as L from '../world/layout'
import { GameActors } from './actors'
import type { Actor } from './types'

/** The lounge: idle agents wander off to a free seat, game or mug spot. */
export abstract class GameLounge extends GameActors {
  /** Nothing to do and nothing to deliver. */
  protected resting(a: AgentSummary): boolean {
    const items = this.state.itemsFor(a.id)
    if (items.permissions.length || items.results.length) return false
    return a.status === 'done' || a.status === 'error' || a.status === 'idle'
  }

  protected goHang(actor: Actor, instant: boolean): void {
    const taken = new Set([...this.actors.values()].map((x) => x.hang))
    let idx = L.LOUNGE_SEATS.findIndex((_, i) => !taken.has(i))
    if (idx < 0) idx = Math.floor(Math.random() * L.LOUNGE_SEATS.length)
    actor.hang = idx
    const spot = L.LOUNGE_SEATS[idx]
    const done = () => {
      actor.arrived = true
      const now = this.state.agents.get(actor.id)
      if (now) this.pose(actor, now)
    }
    if (instant) {
      actor.avatar.placeAt(spot.x, spot.z)
      done()
    } else this.route(actor.avatar, spot.approach, { x: spot.x, z: spot.z }, done)
  }
}
