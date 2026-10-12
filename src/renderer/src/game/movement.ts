import type * as THREE from 'three'
import * as L from '../world/layout'
import { GameSkull } from './skull'
import { tileOf } from './types'

/** Walking: the player by click or keys, agents chatting, and the camera following someone. */
export abstract class GameMovement extends GameSkull {
  // ---------- movement ----------

  walkPlayerTo(tile: [number, number]): void {
    const grid = this.floorOf(this.player.floor).grid
    const target = grid.walkable(tile[0], tile[1]) ? tile : grid.nearestWalkable(tile[0], tile[1])
    if (!target) return
    this.follow = true
    const chair = this.player.floor === 0 && target[0] === 4 && target[1] === 2
    this.route(this.player, target, chair ? L.BOSS_SEAT : null, () => {
      if (chair) this.sitPlayer()
    })
  }

  /**
   * One session messaged another: the sender walks to the recipient's spot and
   * says the first line of the message. Without a recipient in the office it
   * just says it where it is.
   */
  chat(fromId: string, toId: string | null, text: string): void {
    const from = this.actors.get(fromId)
    if (!from || from.down || from.goal === 'leave') return
    const to = toId ? this.actors.get(toId) : undefined
    const line = `✉ ${text.length > 70 ? text.slice(0, 69) + '…' : text}`
    from.shout = line
    from.shoutKind = 'talk'
    from.shoutUntil = this.time + 8
    from.tag.setBubble(from.shout, 'talk')
    if (!to || to.down || to.goal === 'leave' || to.avatar.floor !== from.avatar.floor || from.riding) return

    const spot = this.besideTile(to.avatar.position, from.avatar.position, from.avatar.floor)
    if (!spot) return
    from.goal = 'chat'
    from.arrived = false
    from.spot = null
    from.hang = null
    from.avatar.setProp('none')
    from.chatUntil = this.time + 30 // walking; trimmed on arrival
    this.route(from.avatar, spot, null, () => {
      if (from.goal !== 'chat') return
      from.arrived = true
      from.chatUntil = this.time + 6
      from.shoutUntil = Math.max(from.shoutUntil, from.chatUntil)
      from.tag.setBubble(from.shout, 'talk')
      from.avatar.faceTowards(to.avatar.position.x, to.avatar.position.z)
      from.avatar.pose = 'talk'
    })
  }

  /** A free tile next to a position, the closest one to where you come from. */
  protected besideTile(target: THREE.Vector3, from: THREE.Vector3, floor = 0): [number, number] | null {
    const [ax, az] = tileOf(target)
    const grid = this.floorOf(floor).grid
    const [px, pz] = tileOf(from)
    let best: [number, number] | null = null
    let bestD = Infinity
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue
        const x = ax + dx
        const z = az + dz
        if (!grid.walkable(x, z)) continue
        const d = Math.hypot(x - px, z - pz) + (dz > 0 ? 0 : 0.5)
        if (d < bestD) {
          bestD = d
          best = [x, z]
        }
      }
    }
    return best ?? grid.nearestWalkable(ax, az)
  }

  /** Walks the player next to an agent. */
  goToAgent(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (!actor || actor.riding) return
    this.goFloor(actor.avatar.floor)
    const [ax, az] = tileOf(actor.avatar.position)
    const grid = this.floorOf(actor.avatar.floor).grid
    const [px, pz] = tileOf(this.player.position)
    let best: [number, number] | null = null
    let bestD = Infinity
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue
        const x = ax + dx
        const z = az + dz
        if (!grid.walkable(x, z)) continue
        const d = Math.hypot(x - px, z - pz) + (dz > 0 ? 0 : 0.5)
        if (d < bestD) {
          bestD = d
          best = [x, z]
        }
      }
    }
    if (!best) best = grid.nearestWalkable(ax, az)
    if (best) {
      this.route(this.player, best, null, () => this.player.faceTowards(actor.avatar.position.x, actor.avatar.position.z))
      this.follow = true
    }
  }

  goHome(): void {
    this.goFloor(0)
    this.walkPlayerTo([4, 2])
  }

  /** Points the camera at an agent and keeps it there until the agent settles, even one still on its way in. */
  focusAgent(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (actor && !actor.riding) this.goFloor(actor.avatar.floor)
    // after goFloor, which hands the camera back to the player
    this.follow = false
    this.watch = { id: agentId, until: this.time + 5 }
  }

  /** Follows the watched agent; done once it sits or stands still, and as soon as the player takes the camera back. */
  protected updateWatch(): void {
    const w = this.watch
    if (!w) return
    if (this.follow) return void (this.watch = null)
    const actor = this.actors.get(w.id)
    // a just-summoned agent appears with the next state update
    if (!actor) {
      if (this.time > w.until) this.watch = null
      return
    }
    if (actor.goal === 'leave') return void (this.watch = null)
    if (actor.riding) return
    const av = actor.avatar
    if (av.floor !== this.player.floor) this.goFloor(av.floor)
    this.follow = false
    this.engine.target.set(av.position.x, 0, av.position.z)
    if (!av.isWalking && (actor.arrived || this.time > w.until)) this.watch = null
  }

  protected moveWithKeys(dt: number): void {
    let sx = 0
    let sy = 0
    if (this.keys.has('w') || this.keys.has('arrowup')) sy -= 1
    if (this.keys.has('s') || this.keys.has('arrowdown')) sy += 1
    if (this.keys.has('a') || this.keys.has('arrowleft')) sx -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) sx += 1
    if (!sx && !sy) return
    // screen directions -> world: right = (+x, -z), down = (+x, +z)
    let dx = sx + sy
    let dz = -sx + sy
    const len = Math.hypot(dx, dz)
    dx /= len
    dz /= len
    const p = this.player
    p.stop()
    p.pose = 'stand'
    p.seatY = 0
    this.follow = true
    const step = p.speed * dt
    const grid = this.floorOf(p.floor).grid
    const tryMove = (mx: number, mz: number): boolean => {
      const nx = p.position.x + mx * step
      const nz = p.position.z + mz * step
      const [ax, az] = tileOf(p.position)
      // keep a small radius away from blocked tiles and walls
      const r = 0.22
      for (const [ox, oz] of [[0, 0], [r, r], [r, -r], [-r, r], [-r, -r]]) {
        const tx = Math.floor(nx + ox)
        const tz = Math.floor(nz + oz)
        if ((tx !== ax || tz !== az) && !grid.canStep(ax, az, tx, tz)) return false
      }
      p.position.x = nx
      p.position.z = nz
      return true
    }
    if (!tryMove(dx, dz)) {
      if (Math.abs(dx) > 0.1) tryMove(Math.sign(dx), 0)
      if (Math.abs(dz) > 0.1) tryMove(0, Math.sign(dz))
    }
    p.face(Math.atan2(dx, dz))
    p.phaseStep(dt)
  }
}
