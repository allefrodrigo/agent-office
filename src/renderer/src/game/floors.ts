import * as THREE from 'three'
import type { ProjectFloor, SquadInfo } from '@shared/types'
import { brandOf, releaseLogos } from '../world/brand'
import { disposeTree } from '../world/dispose'
import * as L from '../world/layout'
import { buildUpperFloor } from '../world/upper-floor'
import { Tag } from '../world/overlays'
import { GameBase } from './base'
import { RIDE_S, SPAWN_POINT, type Actor } from './types'

/** Elevator and floors: rides between floors, the project floors and which one is drawn. */
export abstract class GameFloors extends GameBase {
  /**
   * Takes an avatar to another floor: it walks into the elevator, rides, and steps
   * out upstairs (or downstairs). `then` runs on arrival if the goal is still the same.
   */
  protected travel(actor: Actor, floor: number, instant: boolean, then: () => void): void {
    const av = actor.avatar
    if (av.floor === floor) return then()
    if (instant) {
      av.floor = floor
      av.placeAt(SPAWN_POINT.x, SPAWN_POINT.z + 1)
      return then()
    }
    const trip = actor.trip
    this.route(av, L.SPAWN_TILE, SPAWN_POINT, () => {
      if (actor.trip !== trip || actor.goal === 'leave') return
      this.ding(av.floor)
      actor.riding = true
      setTimeout(() => {
        av.floor = floor
        av.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
        av.face(0)
        this.ding(floor)
        actor.riding = false
        if (!this.actors.has(actor.id) || actor.goal === 'leave') return
        if (actor.trip === trip) then()
        else {
          actor.goal = null
          this.reconcile(actor)
        }
      }, RIDE_S * 1000 + 600)
    })
  }

  // ---------- floors ----------

  /** Builds the project floors again when the floors or their squads change. */
  setProjects(projects: ProjectFloor[], squads: SquadInfo[], notify = true): void {
    const squadsOf = (p: ProjectFloor) => squads.filter((q) => q.cwd === p.cwd)
    const plans = projects.map((p) => L.projectPlan(squadsOf(p)))
    const logoKey = (p: ProjectFloor) => (p.logo ? `${p.logo.length}:${p.logo.slice(-48)}` : '')
    const key = JSON.stringify(projects.map((p, i) => [p.id, p.name, squadsOf(p).length, plans[i].sectors.map((r) => [r.name, r.desks.length]), logoKey(p), p.brandColor, !!p.uniform]))
    if (key === this.uppersKey) return
    this.uppersKey = key
    const playerOn = this.upperOf(this.player.floor)?.project.id

    for (const m of this.members.values()) this.memberGone(m)
    this.uppers.forEach((u, i) => {
      // the whole floor leaves the GPU: walls, furniture, screens, signs and their textures
      disposeTree(u.scene.group)
      this.engine.scene.remove(u.scene.group)
      this.overlays.clearLabels(i + 1)
      if (u.boardTag) this.overlays.remove(u.boardTag)
      this.overlays.remove(u.alarmTag)
      this.overlays.remove(u.moneyTag)
      this.overlays.remove(u.routinesTag)
      for (const t of u.stepTags) this.overlays.remove(t)
    })
    this.uppers = projects.map((project, i) => {
      const n = i + 1
      const plan = plans[i]
      const scene = buildUpperFloor(plan, brandOf(project))
      scene.reducedMotion = this.reducedEffects
      this.engine.scene.add(scene.group)
      this.overlays.label('Diretoria', (L.DIRECTOR_RECT[0] + L.DIRECTOR_RECT[2]) / 2, 9.4, n)
      for (const r of [...plan.team, ...plan.sectors]) this.overlays.label(r.name, (r.rect[0] + r.rect[2]) / 2, r.top ? 9.4 : r.rect[3] - 0.6, n)
      let boardTag: Tag | null = null
      if (squadsOf(project).length) {
        boardTag = this.overlays.add(new Tag(scene.board, '▶ Contratar squad', false, () => this.hooks.onRunSquad(project)))
        boardTag.setDot('term')
      }
      const stepTags = plan.directors.map((d) => {
        const anchor = new THREE.Object3D()
        anchor.position.set(d.x + d.w / 2, 0.95, d.z + 1.2)
        scene.group.add(anchor)
        const tag = this.overlays.add(new Tag(anchor, ''))
        tag.el.classList.add('tag-step')
        return tag
      })
      return { project, scene, boardTag, stepTags, alarmTag: this.alarmTagFor(scene.alarm), moneyTag: this.moneyTagFor(scene.money), routinesTag: this.routinesTagFor(scene.routines) }
    })
    this.office.setFloors(projects.length + 1)
    for (const u of this.uppers) u.scene.setFloors(projects.length + 1)

    // The player stays with the same project, wherever its floor is now; a floor that is gone sends them down.
    const at = playerOn ? this.uppers.findIndex((u) => u.project.id === playerOn) + 1 : 0
    if (this.player.floor > 0 && at === 0) this.goFloor(0)
    else this.player.floor = at
    // Everyone upstairs starts over on the new plans, on their project's floor (or downstairs if it is gone).
    for (const actor of this.actors.values()) {
      const a = this.state.agents.get(actor.id)
      if (!a || actor.goal === 'leave' || (actor.avatar.floor === 0 && this.homeFloor(a) === 0)) continue
      actor.goal = null
      actor.avatar.floor = this.homeFloor(a)
      this.reconcile(actor, true)
    }
    for (const h of this.helpers.values()) h.avatar.floor = this.actors.get(h.parentId)?.avatar.floor ?? 0
    // Uniforms follow the floor settings, even for agents that did not move.
    for (const actor of this.actors.values()) {
      const a = this.state.agents.get(actor.id)
      if (a) this.dress(actor.avatar, a)
    }
    for (const h of this.helpers.values()) {
      const a = this.state.agents.get(h.parentId)
      if (a) h.avatar.setUniform(this.uniformFor(a))
    }
    // everyone wears the current logos now: patches of replaced or removed ones go
    releaseLogos(new Set(projects.flatMap((p) => (p.logo ? [p.logo] : []))))
    this.syncBoards()
    // the new floors' routines boards are blank until drawn
    this.routinesIn = 0
    if (notify) this.hooks.onFloor(this.player.floor)
  }

  get floors(): string[] {
    return ['Térreo', ...this.uppers.map((u) => u.project.name)]
  }

  get currentFloor(): number {
    return this.player.floor
  }

  /** The project of the floor the player is on; null on the ground floor. */
  get currentProject(): ProjectFloor | null {
    return this.upperOf(this.player.floor)?.project ?? null
  }

  /** The player takes the elevator: out on the other floor, with the camera. */
  goFloor(n: number): void {
    if (n === this.player.floor || n < 0 || n > this.uppers.length) return
    const p = this.player
    p.stop()
    p.pose = 'stand'
    p.seatY = 0
    this.ding(p.floor)
    p.floor = n
    p.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
    p.face(0)
    this.ding(n)
    this.engine.jumpTo(p.position.x, p.position.z)
    this.follow = true
    this.route(p, [L.SPAWN_TILE[0], L.SPAWN_TILE[1] + 1], null, () => undefined)
    this.hooks.onFloor(n)
  }

  /** Only the floor the player is on is drawn. */
  protected showFloor(): void {
    const view = this.player.floor
    this.office.group.visible = view === 0
    this.overlays.floor = view
    for (const a of this.actors.values()) {
      const here = a.avatar.floor === view
      a.avatar.root.visible = here
      a.tag.hidden = !here
    }
    for (const h of this.helpers.values()) {
      h.avatar.root.visible = h.avatar.floor === view
      h.tag.hidden = h.avatar.floor !== view
    }
    for (const m of this.members.values()) {
      m.avatar.root.visible = m.avatar.floor === view
      m.tag.hidden = m.avatar.floor !== view
    }
    this.uppers.forEach((u, i) => {
      const here = view === i + 1
      u.scene.group.visible = here
      if (u.boardTag) u.boardTag.hidden = !here
      const seated = here ? this.directorsOn(i + 1) : null
      u.stepTags.forEach((t, d) => (t.hidden = !seated?.has(d)))
    })
    this.skull.tag.hidden = view !== 0
    this.pcTag.hidden = view !== 0
    this.alarmTag.hidden = view !== 0 || !this.office.alarm.on
    this.moneyTag.hidden = view !== 0
    this.routinesTag.hidden = view !== 0
    this.uppers.forEach((u, i) => {
      u.alarmTag.hidden = view !== i + 1 || !u.scene.alarm.on
      u.moneyTag.hidden = view !== i + 1
      u.routinesTag.hidden = view !== i + 1
    })
  }
}
