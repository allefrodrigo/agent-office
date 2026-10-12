import type { AgentSummary } from '@shared/types'
import * as L from '../world/layout'
import type { BubbleKind } from '../world/overlays'
import { GameLounge } from './lounge'
import { tileOf, type Actor } from './types'

/** Deliveries: agents with a permission request or a result visit the player and talk when close. */
export abstract class GameDeliveries extends GameLounge {
  /** Visits: project agents take the elevator to wherever the player is; the ground floor's go to the boss office. */
  protected goBoss(actor: Actor, instant: boolean): void {
    const a = this.state.agents.get(actor.id)
    const floor = a && this.homeFloor(a) > 0 ? this.player.floor : 0
    this.travel(actor, floor, instant, () => {
      const spot = this.pickVisitSpot(actor)
      actor.spot = spot
      const done = () => {
        actor.arrived = true
        actor.waveUntil = this.time + 1.6
        const now = this.state.agents.get(actor.id)
        if (now) this.pose(actor, now)
      }
      if (instant) {
        actor.avatar.placeAt(spot[0] + 0.5, spot[1] + 0.5)
        done()
      } else this.route(actor.avatar, spot, null, done)
    })
  }

  protected bubble(actor: Actor, a: AgentSummary): void {
    if (this.time < actor.shoutUntil) {
      actor.tag.setBubble(actor.shout, actor.shoutKind)
      return
    }
    const items = this.state.itemsFor(a.id)
    let text: string | null = null
    let kind: BubbleKind = 'work'
    if (items.permissions.length) {
      const p = items.permissions[0]
      text = p.kind === 'question' ? '? Tenho uma pergunta' : p.kind === 'plan' ? '! Tenho um plano' : '! Preciso da sua permissão'
      kind = 'wait'
    } else if (items.results.length) {
      text = items.results[0].isError ? '✗ Deu problema' : '✓ Terminei!'
      kind = items.results[0].isError ? 'error' : 'done'
    } else if (a.status === 'working' || a.status === 'starting') {
      text = a.activity
    } else if (a.status === 'waiting') {
      text = '! Indo até você'
      kind = 'wait'
    }
    actor.tag.setBubble(text, kind)
  }

  protected pickVisitSpot(actor: Actor): [number, number] {
    const taken = new Set<string>()
    for (const o of this.actors.values()) if (o !== actor && o.spot && o.avatar.floor === actor.avatar.floor) taken.add(o.spot.join(','))
    const [px, pz] = tileOf(this.player.position)
    // Upstairs there is no boss office: stand next to the player, wherever they are.
    if (actor.avatar.floor > 0) {
      const grid = this.floorOf(actor.avatar.floor).grid
      let best: [number, number] | null = null
      let bestD = Infinity
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const x = px + dx
          const z = pz + dz
          if ((!dx && !dz) || !grid.walkable(x, z) || taken.has(`${x},${z}`)) continue
          const d = Math.abs(Math.hypot(dx, dz) - 1.2) + (dz < 0 ? 0.6 : 0)
          if (d < bestD) {
            bestD = d
            best = [x, z]
          }
        }
      }
      return best ?? grid.nearestWalkable(px, pz) ?? L.SPAWN_TILE
    }
    if (this.playerInBossRoom() && !this.playerSeated()) {
      const options: [number, number, number][] = []
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const x = px + dx
          const z = pz + dz
          if ((!dx && !dz) || !L.inBossRoom(x + 0.5, z + 0.5) || !this.office.grid.walkable(x, z) || taken.has(`${x},${z}`)) continue
          if (L.behindBossDesk(x, z)) continue
          // prefer spots in front of the player (towards the camera), about one tile away
          const d = Math.hypot(dx, dz)
          options.push([x, z, Math.abs(d - 1.2) + (dz < 0 ? 0.6 : 0)])
        }
      }
      options.sort((a, b) => a[2] - b[2])
      if (options.length) return [options[0][0], options[0][1]]
    }
    return L.VISIT_SPOTS.find((s) => !taken.has(s.join(','))) ?? L.VISIT_SPOTS[0]
  }

  /** Visitors follow the player around the boss office and start talking when close. */
  protected checkVisitors(): void {
    const pp = this.player.position
    const seated = this.playerSeated()
    const inRoom = this.playerInBossRoom() && !seated
    const reach = seated ? 3.6 : 2.2
    let near: Actor | null = null
    let nearD = Infinity
    for (const actor of this.actors.values()) {
      if (actor.goal !== 'boss' || !actor.arrived || actor.avatar.isWalking || actor.down || actor.riding) continue
      if (actor.avatar.floor !== this.player.floor) {
        // Project agents follow the player to the other floor; agents of the ground floor wait in the boss office.
        const a = this.state.agents.get(actor.id)
        if (a && this.homeFloor(a) > 0 && !this.player.isWalking) {
          actor.arrived = false
          actor.trip++
          this.goBoss(actor, false)
        }
        continue
      }
      const d = Math.hypot(actor.avatar.position.x - pp.x, actor.avatar.position.z - pp.z)
      const follows = actor.avatar.floor > 0 || inRoom
      if (follows && d > 2.8 && !this.player.isWalking) {
        actor.arrived = false
        actor.spot = null
        const spot = this.pickVisitSpot(actor)
        actor.spot = spot
        this.route(actor.avatar, spot, null, () => {
          actor.arrived = true
          const a = this.state.agents.get(actor.id)
          if (a) this.pose(actor, a)
        })
        continue
      }
      if (d < reach && d < nearD) {
        near = actor
        nearD = d
      }
    }
    const id = near?.id ?? null
    if (id !== this.nearId) {
      const prev = this.nearId ? this.actors.get(this.nearId) : null
      this.nearId = id
      if (prev) {
        const a = this.state.agents.get(prev.id)
        if (a) this.pose(prev, a)
      }
      if (near) {
        const a = this.state.agents.get(near.id)
        if (a) this.pose(near, a)
        if (!this.player.isWalking) this.player.faceTowards(near.avatar.position.x, near.avatar.position.z)
      }
      this.hooks.onNear(id)
    }
  }
}
