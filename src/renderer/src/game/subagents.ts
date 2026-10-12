import type * as THREE from 'three'
import type { AgentSummary } from '@shared/types'
import { helperActivity } from '@shared/describe'
import { Avatar } from '../world/avatar'
import { Tag } from '../world/overlays'
import { GameDeliveries } from './deliveries'
import { clip, HELPER_BYE_S, HELPER_MIN_S, HELPER_SCALE, tileOf, type Actor, type Helper } from './types'

/** Subagents: small copies of their parent standing by its desk. */
export abstract class GameSubagents extends GameDeliveries {
  // ---------- helpers (subagents) ----------

  protected syncHelpers(): void {
    const live = new Set<string>()
    for (const a of this.state.agents.values()) {
      const parent = this.actors.get(a.id)
      if (!parent || parent.down || parent.goal === 'leave') continue
      for (const sub of a.subagents ?? []) {
        if (sub.member && a.role === 'orchestrator') continue
        live.add(sub.id)
        const helper = this.helpers.get(sub.id) ?? this.addHelper(a, parent, sub.id)
        // A small bubble with what it is doing now (AO-46); the mini tag keeps it short.
        if (helper.endAt === null) {
          helper.tag.setName(clip(sub.description, 26))
          helper.tag.setBubble(clip(helperActivity(sub), 34), 'work')
        }
      }
    }
    for (const h of this.helpers.values()) {
      if (!live.has(h.id) && h.endAt === null) h.endAt = Math.max(this.time, h.bornAt + HELPER_MIN_S)
    }
  }

  protected addHelper(a: AgentSummary, parent: Actor, id: string): Helper {
    // Same id as the parent so clicking the helper opens the parent's panel.
    const avatar = new Avatar(a.look, a.id)
    avatar.setUniform(this.uniformFor(a))
    avatar.speed = 2.4
    const tag = this.overlays.add(new Tag(avatar.anchor, 'Ajudante', false, () => this.hooks.onAgentClick(a.id, id)))
    tag.el.classList.add('tag-mini')
    tag.setDot('working')
    const p = parent.avatar.position
    avatar.placeAt(p.x, p.z)
    avatar.root.scale.setScalar(0.01)
    this.engine.scene.add(avatar.root)
    const helper: Helper = { id, parentId: a.id, avatar, tag, tile: null, bornAt: this.time, endAt: null, gone: false }
    this.helpers.set(id, helper)
    this.grow(helper)
    avatar.floor = parent.avatar.floor
    const tile = this.helperTile(p, avatar.floor)
    helper.tile = tile
    if (tile) {
      this.route(avatar, tile, null, () => {
        const parentNow = this.actors.get(helper.parentId)
        if (parentNow && !helper.gone) avatar.faceTowards(parentNow.avatar.position.x, parentNow.avatar.position.z)
        avatar.pose = 'play'
      })
    }
    return helper
  }

  protected grow(helper: Helper): void {
    const k = Math.min(1, (this.time - helper.bornAt) / 0.35)
    helper.avatar.root.scale.setScalar(Math.max(0.01, k * HELPER_SCALE))
    if (k < 1 && !helper.gone) requestAnimationFrame(() => this.grow(helper))
  }

  /** A free tile within two steps of the parent, nearest first. */
  protected helperTile(at: THREE.Vector3, floor: number): [number, number] | null {
    const [ax, az] = tileOf(at)
    const grid = this.floorOf(floor).grid
    const taken = new Set<string>()
    for (const h of this.helpers.values()) if (h.tile) taken.add(h.tile.join(','))
    for (const o of this.actors.values()) if (o.avatar.floor === floor) taken.add(tileOf(o.avatar.position).join(','))
    let best: [number, number] | null = null
    let bestD = Infinity
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const x = ax + dx
        const z = az + dz
        if ((!dx && !dz) || !grid.walkable(x, z) || taken.has(`${x},${z}`)) continue
        // in front of the desk (towards the camera) reads better than behind it
        const d = Math.hypot(dx, dz) + (dz > 0 ? 0 : 0.4)
        if (d < bestD) {
          bestD = d
          best = [x, z]
        }
      }
    }
    return best
  }

  protected updateHelpers(dt: number): void {
    for (const h of this.helpers.values()) {
      h.avatar.update(dt)
      if (h.endAt === null || h.gone || this.time < h.endAt) continue
      h.gone = true
      h.tag.setDot('done')
      h.tag.setName('✓ Pronto')
      h.tag.setBubble(null)
      h.avatar.stop()
      h.avatar.pose = 'wave'
      const start = this.time + HELPER_BYE_S
      const shrink = () => {
        const k = this.time < start ? 1 : 1 - (this.time - start) / 0.4
        if (k <= 0 || !this.helpers.has(h.id)) {
          h.avatar.dispose()
          this.engine.scene.remove(h.avatar.root)
          this.overlays.remove(h.tag)
          this.helpers.delete(h.id)
          return
        }
        h.avatar.root.scale.setScalar(k * HELPER_SCALE)
        requestAnimationFrame(shrink)
      }
      requestAnimationFrame(shrink)
    }
  }
}
