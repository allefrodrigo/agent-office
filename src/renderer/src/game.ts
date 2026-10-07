import * as THREE from 'three'
import type { AgentSummary } from '@shared/types'
import type { State } from './state'
import { Avatar } from './world/avatar'
import { Engine } from './world/engine'
import * as L from './world/layout'
import { buildOffice, type Office } from './world/office'
import { Overlays, Tag, type BubbleKind } from './world/overlays'
import type { ScreenMode } from './world/screens'
import { Effects, pickupGun, sfx } from './world/weapons'

type Goal = 'desk' | 'boss' | 'hang' | 'leave' | 'chat'

interface Actor {
  id: string
  avatar: Avatar
  tag: Tag
  goal: Goal | null
  arrived: boolean
  /** Reserved standing tile in the boss office. */
  spot: [number, number] | null
  /** Reserved lounge spot index. */
  hang: number | null
  waveUntil: number
  /** Knocked out by the airsoft: office agents leave for good, terminal ones get back up. */
  down: boolean
  /** A short reaction bubble ("Ai!") that overrides the status bubble until this time. */
  shoutUntil: number
  shout: string
  shoutKind: BubbleKind
  /** Walking over to talk to another agent (SendMessage); status changes wait until this time. */
  chatUntil: number
  /** Wall-clock ms since the agent has had nothing to do; null while busy. */
  restSince: number | null
}

export interface GameHooks {
  /** Player clicked an agent (avatar or tag). */
  onAgentClick(agentId: string): void
  /** Player is standing next to an agent that came to deliver something. */
  onNear(agentId: string | null): void
  /** Player picked up (true) or dropped (false) the airsoft. */
  onGun(armed: boolean): void
  /** An office agent was knocked out: fire it. */
  onKill(agentId: string): void
  /** A terminal agent was knocked out (it cannot be fired from here). */
  onKnockout(agentId: string): void
  /** Player clicked their own computer: call an agent. */
  onComputer(): void
}

const MAX_HP = 3
const HP_REGEN_S = 12
const GUN_HOME = { x: 3.4, y: 0.98, z: 16.35 }
const OUCH = ['Ai!', 'Ei! Tô trabalhando!', 'Isso dói!', 'Calma, chefe!', 'Ouch!', 'Pra que isso?']
/** An idle agent waits at its desk this long before wandering off to the lounge. */
const LOUNGE_AFTER_MS = 3 * 60_000

const SPAWN_POINT = { x: L.ELEVATOR.x, z: 0.45 }
const OVERFLOW_TILES: [number, number][] = [
  [29, 9], [30, 9], [29, 10], [30, 10], [28, 9], [28, 10], [31, 9], [31, 10],
]
const center = ([x, z]: [number, number]) => ({ x: x + 0.5, z: z + 0.5 })
const tileOf = (p: THREE.Vector3): [number, number] => [Math.floor(p.x), Math.floor(p.z)]

export class Game {
  readonly engine: Engine
  readonly office: Office
  readonly overlays: Overlays
  readonly player: Avatar
  private playerTag: Tag
  private actors = new Map<string, Actor>()
  private keys = new Set<string>()
  private follow = true
  private hover: THREE.LineSegments
  private time = 0
  private nearId: string | null = null
  private recheck = 0
  private dragging: { x: number; y: number; moved: boolean; button: number } | null = null
  private wheelAcc = 0
  private effects: Effects
  private gun: { root: THREE.Group; spin: THREE.Group; tag: Tag; baseY: number }
  private armed = false
  private aim: THREE.Vector3 | null = null
  private hp = new Map<string, { hp: number; last: number }>()

  constructor(
    container: HTMLElement,
    overlayRoot: HTMLElement,
    private state: State,
    private hooks: GameHooks,
  ) {
    this.engine = new Engine(container, state.settings.pixelSize)
    this.office = buildOffice()
    this.engine.scene.add(this.office.group)
    this.overlays = new Overlays(overlayRoot, this.engine)

    for (const z of L.ZONES) {
      const pos: Record<string, [number, number]> = {
        boss: [4.5, 8.35],
        team: [21, 5.5],
        meeting: [4.5, 21],
        lounge: [17.5, 23.4],
      }
      const [x, zz] = pos[z.id] ?? [(z.rect[0] + z.rect[2]) / 2, (z.rect[1] + z.rect[3]) / 2]
      this.overlays.label(z.label, x, zz)
    }

    // player
    this.player = new Avatar(state.settings.playerLook, 'player')
    this.player.speed = 3.6
    this.engine.scene.add(this.player.root)
    this.player.placeAt(L.BOSS_SEAT.x, L.BOSS_SEAT.z)
    this.sitPlayer()
    this.playerTag = this.overlays.add(new Tag(this.player.anchor, state.settings.playerName, true))
    this.playerTag.setDot('you')
    this.engine.jumpTo(this.player.position.x, this.player.position.z)

    // hovered tile outline, Habbo style
    const g = new THREE.BufferGeometry().setFromPoints(
      [[0, 0], [1, 0], [1, 0], [1, 1], [1, 1], [0, 1], [0, 1], [0, 0]].map(([x, z]) => new THREE.Vector3(x, 0.03, z)),
    )
    this.hover = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }))
    this.hover.visible = false
    this.engine.scene.add(this.hover)

    // airsoft pistol waiting on the meeting room table
    this.effects = new Effects(this.engine.scene)
    const gunRoot = new THREE.Group()
    const spin = new THREE.Group()
    spin.add(pickupGun())
    gunRoot.add(spin)
    gunRoot.position.set(GUN_HOME.x, 0, GUN_HOME.z)
    const gunAnchor = new THREE.Object3D()
    gunAnchor.position.y = GUN_HOME.y + 0.45
    gunRoot.add(gunAnchor)
    this.engine.scene.add(gunRoot)
    const gunTag = this.overlays.add(new Tag(gunAnchor, 'Airsoft', false, () => this.fetchGun()))
    gunTag.setDot('gun')
    this.gun = { root: gunRoot, spin, tag: gunTag, baseY: GUN_HOME.y }

    // the player's own computer calls a new agent
    const pc = new THREE.Object3D()
    pc.position.set(3.3, 1.35, L.BOSS_DESK.z + 0.5)
    this.engine.scene.add(pc)
    this.overlays.add(new Tag(pc, 'Chamar agente', false, () => hooks.onComputer())).setDot('term')

    for (const a of state.agents.values()) this.addActor(a, false)
    state.onChange(() => this.sync())
    this.bindInput(container)
  }

  // ---------- agents ----------

  private sync(): void {
    for (const a of this.state.agents.values()) {
      if (!this.actors.has(a.id)) this.addActor(a, true)
    }
    for (const actor of this.actors.values()) {
      if (!this.state.agents.has(actor.id) && actor.goal !== 'leave') this.leave(actor)
      else if (this.state.agents.has(actor.id)) this.reconcile(actor)
    }
    this.playerTag.setName(this.state.settings.playerName)
    if (this.player.look !== this.state.settings.playerLook) this.player.setLook(this.state.settings.playerLook)
  }

  private addActor(a: AgentSummary, animate: boolean): void {
    const avatar = new Avatar(a.look, a.id)
    const tag = this.overlays.add(new Tag(avatar.anchor, a.name, false, () => (this.armed ? this.shootAt(a.id, null) : this.hooks.onAgentClick(a.id))))
    const actor: Actor = { id: a.id, avatar, tag, goal: null, arrived: false, spot: null, hang: null, waveUntil: 0, down: false, shoutUntil: 0, shout: '', shoutKind: 'error', chatUntil: 0, restSince: null }
    // agents already idle when the office opens (restored sessions) start in the lounge
    if (!animate && this.resting(a)) actor.restSince = 0
    this.actors.set(a.id, actor)
    this.engine.scene.add(avatar.root)
    if (animate) {
      avatar.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
      avatar.face(0)
      this.office.ding()
    }
    this.reconcile(actor, !animate)
  }

  private leave(actor: Actor): void {
    actor.goal = 'leave'
    actor.spot = null
    actor.hang = null
    if (actor.down) {
      actor.tag.setBubble(null)
      this.vanish(actor, 0)
      return
    }
    actor.tag.setBubble('Tchau!', 'idle')
    this.route(actor.avatar, L.SPAWN_TILE, SPAWN_POINT, () => {
      this.office.ding()
      this.vanish(actor, 500)
    })
  }

  /** Shrinks the avatar away and forgets the actor. */
  private vanish(actor: Actor, delayMs: number): void {
    const shrink = (start: number) => {
      const k = 1 - (this.time - start) / 0.6
      if (k <= 0) {
        this.engine.scene.remove(actor.avatar.root)
        this.overlays.remove(actor.tag)
        this.actors.delete(actor.id)
        this.hp.delete(actor.id)
        return
      }
      actor.avatar.root.scale.setScalar(Math.min(1, k))
      requestAnimationFrame(() => shrink(start))
    }
    setTimeout(() => shrink(this.time), delayMs)
  }

  /** Nothing to do and nothing to deliver. */
  private resting(a: AgentSummary): boolean {
    const items = this.state.itemsFor(a.id)
    if (items.permissions.length || items.results.length) return false
    return a.status === 'done' || a.status === 'error' || a.status === 'idle'
  }

  private desired(actor: Actor, a: AgentSummary): Goal {
    if (this.resting(a)) {
      actor.restSince ??= Date.now()
      return Date.now() - actor.restSince >= LOUNGE_AFTER_MS ? 'hang' : 'desk'
    }
    actor.restSince = null
    const items = this.state.itemsFor(a.id)
    if (items.permissions.length || items.results.length || a.status === 'waiting') return 'boss'
    return 'desk'
  }

  private reconcile(actor: Actor, instant = false): void {
    const a = this.state.agents.get(actor.id)
    if (!a || actor.goal === 'leave' || actor.down) return
    // mid-conversation: keep talking; the update loop hands the agent back when it ends
    if (this.time < actor.chatUntil) return
    actor.tag.setName(a.name)
    actor.tag.setDot(a.status)
    if (actor.avatar.look !== a.look && JSON.stringify(actor.avatar.look) !== JSON.stringify(a.look)) actor.avatar.setLook(a.look)
    this.screenFor(a)?.setMode(screenMode(a))

    const goal = this.desired(actor, a)
    if (goal !== actor.goal) {
      actor.goal = goal
      actor.arrived = false
      actor.spot = null
      actor.hang = null
      actor.avatar.setProp('none')
      if (goal === 'desk') this.goDesk(actor, a, instant)
      else if (goal === 'boss') this.goBoss(actor, instant)
      else this.goHang(actor, instant)
    } else if (actor.arrived) {
      this.pose(actor, a)
    }
    this.bubble(actor, a)
  }

  private screenFor(a: AgentSummary) {
    return this.office.deskScreens[a.desk]
  }

  private deskOf(a: AgentSummary) {
    return L.DESKS[a.desk]
  }

  private goDesk(actor: Actor, a: AgentSummary, instant: boolean): void {
    const desk = this.deskOf(a)
    const done = () => {
      actor.arrived = true
      const now = this.state.agents.get(actor.id)
      if (now) this.pose(actor, now)
    }
    if (!desk) {
      const tile = OVERFLOW_TILES[a.desk % OVERFLOW_TILES.length]
      if (instant) {
        actor.avatar.placeAt(tile[0] + 0.5, tile[1] + 0.5)
        done()
      } else this.route(actor.avatar, tile, null, done)
      return
    }
    if (instant) {
      actor.avatar.placeAt(desk.seat.x, desk.seat.z)
      done()
    } else this.route(actor.avatar, desk.approach, desk.seat, done)
  }

  private goBoss(actor: Actor, instant: boolean): void {
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
  }

  private goHang(actor: Actor, instant: boolean): void {
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

  /** Applies the resting pose for the actor's current goal and status. */
  private pose(actor: Actor, a: AgentSummary): void {
    const av = actor.avatar
    if (av.isWalking) return
    if (actor.goal === 'desk') {
      if (!this.deskOf(a)) {
        av.pose = 'stand'
        av.face(Math.PI)
        return
      }
      av.face(Math.PI)
      av.pose = a.status === 'working' ? 'type' : 'sit'
      av.seatY = 0
    } else if (actor.goal === 'boss') {
      const items = this.state.itemsFor(a.id)
      const result = items.results[0]
      av.setProp(items.permissions.length ? 'none' : result ? (result.isError ? 'redPaper' : 'paper') : 'none')
      if (L.inBossRoom(this.player.position.x, this.player.position.z)) av.faceTowards(this.player.position.x, this.player.position.z)
      else av.faceTowards(L.BOSS_SEAT.x, L.BOSS_SEAT.z)
      av.pose = this.time < actor.waveUntil ? 'wave' : actor.id === this.nearId ? 'talk' : 'stand'
    } else if (actor.goal === 'hang' && actor.hang !== null) {
      const spot = L.LOUNGE_SEATS[actor.hang]
      av.faceTowards(spot.look[0], spot.look[1])
      av.pose = spot.kind === 'sit' ? 'relax' : spot.kind === 'play' ? 'play' : 'stand'
      av.setProp(spot.kind === 'stand' ? 'mug' : 'none')
    }
  }

  private bubble(actor: Actor, a: AgentSummary): void {
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

  private pickVisitSpot(actor: Actor): [number, number] {
    const taken = new Set<string>()
    for (const o of this.actors.values()) if (o !== actor && o.spot) taken.add(o.spot.join(','))
    const [px, pz] = tileOf(this.player.position)
    if (L.inBossRoom(this.player.position.x, this.player.position.z) && !this.playerSeated()) {
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

  // ---------- movement ----------

  private route(av: Avatar, tile: [number, number], final: { x: number; z: number } | null, onArrive: () => void): void {
    const [sx, sz] = tileOf(av.position)
    const path = this.office.grid.findPath(sx, sz, tile[0], tile[1])
    const points = (path ?? []).map(center)
    if (!path) points.push(center(tile)) // unreachable: walk straight there rather than freeze
    if (final) points.push(final)
    av.walk(points, onArrive)
  }

  /** Player is sitting in the boss chair; visitors line up in front of the desk. */
  private playerSeated(): boolean {
    const p = this.player.position
    return this.player.pose === 'sit' && Math.hypot(p.x - L.BOSS_SEAT.x, p.z - L.BOSS_SEAT.z) < 0.3
  }

  private sitPlayer(): void {
    this.player.placeAt(L.BOSS_SEAT.x, L.BOSS_SEAT.z)
    this.player.face(0)
    this.player.pose = 'sit'
  }

  walkPlayerTo(tile: [number, number]): void {
    const grid = this.office.grid
    const target = grid.walkable(tile[0], tile[1]) ? tile : grid.nearestWalkable(tile[0], tile[1])
    if (!target) return
    this.follow = true
    const chair = target[0] === 4 && target[1] === 2
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
    if (!to || to.down || to.goal === 'leave') return

    const spot = this.besideTile(to.avatar.position, from.avatar.position)
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
  private besideTile(target: THREE.Vector3, from: THREE.Vector3): [number, number] | null {
    const [ax, az] = tileOf(target)
    const grid = this.office.grid
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
    if (!actor) return
    const [ax, az] = tileOf(actor.avatar.position)
    const grid = this.office.grid
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
    this.walkPlayerTo([4, 2])
  }

  focusAgent(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (!actor) return
    this.follow = false
    this.engine.target.set(actor.avatar.position.x, 0, actor.avatar.position.z)
  }

  private moveWithKeys(dt: number): void {
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
    const grid = this.office.grid
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
    if (!this.armed) p.face(Math.atan2(dx, dz))
    p.phaseStep(dt)
  }

  // ---------- input ----------

  private bindInput(el: HTMLElement): void {
    const isTyping = () => {
      const a = document.activeElement
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement
    }
    window.addEventListener('keydown', (e) => {
      if (isTyping() || e.metaKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 'e' && !this.armed && this.gun.root.visible && this.distToGun() < 1.8) this.pickUpGun()
      if (k === 'q' && this.armed) this.dropGun()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k)
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => this.keys.clear())

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

  private agentAt(x: number, y: number): string | null {
    const roots = [...this.actors.values()].filter((a) => a.goal !== 'leave' && !a.down).map((a) => a.avatar.root)
    for (const hit of this.engine.pick(x, y, roots)) {
      const id = hit.object.userData.avatarId as string | undefined
      if (id) return id
    }
    return null
  }

  private click(x: number, y: number): void {
    if (this.armed) {
      this.shootAt(this.agentAt(x, y), this.engine.pickFloor(x, y))
      return
    }
    if (this.gun.root.visible && this.engine.pick(x, y, [this.gun.root]).length) {
      this.fetchGun()
      return
    }
    const id = this.agentAt(x, y)
    if (id) {
      this.hooks.onAgentClick(id)
      return
    }
    const p = this.engine.pickFloor(x, y)
    if (!p) return
    const tile: [number, number] = [Math.floor(p.x), Math.floor(p.z)]
    if (!this.office.grid.inside(tile[0], tile[1])) return
    this.walkPlayerTo(tile)
  }

  private updateHover(x: number, y: number): void {
    const p = this.engine.pickFloor(x, y)
    const grid = this.office.grid
    if (this.armed) {
      this.aim = p
      this.hover.visible = false
      document.body.style.cursor = 'crosshair'
      return
    }
    if (!p || !grid.inside(Math.floor(p.x), Math.floor(p.z)) || this.agentAt(x, y)) {
      this.hover.visible = false
      document.body.style.cursor = this.agentAt(x, y) ? 'pointer' : ''
      return
    }
    document.body.style.cursor = ''
    const tx = Math.floor(p.x)
    const tz = Math.floor(p.z)
    this.hover.visible = true
    this.hover.position.set(tx, 0, tz)
    ;(this.hover.material as THREE.LineBasicMaterial).color.set(grid.walkable(tx, tz) ? '#ffffff' : '#ff8a80')
  }

  // ---------- loop ----------

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
    this.office.update(dt)
    this.updateGun(dt)
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

    if (this.follow) this.engine.target.set(this.player.position.x, 0, this.player.position.z)
    this.engine.render(dt)
    this.overlays.update()
  }

  /** Visitors follow the player around the boss office and start talking when close. */
  private checkVisitors(): void {
    const pp = this.player.position
    const seated = this.playerSeated()
    const inRoom = L.inBossRoom(pp.x, pp.z) && !seated
    const reach = seated ? 3.6 : 2.2
    let near: Actor | null = null
    let nearD = Infinity
    for (const actor of this.actors.values()) {
      if (actor.goal !== 'boss' || !actor.arrived || actor.avatar.isWalking || actor.down) continue
      const d = Math.hypot(actor.avatar.position.x - pp.x, actor.avatar.position.z - pp.z)
      if (inRoom && d > 2.8 && !this.player.isWalking) {
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

  // ---------- airsoft ----------

  private distToGun(): number {
    const g = this.gun.root.position
    return Math.hypot(g.x - this.player.position.x, g.z - this.player.position.z)
  }

  /** Walks to the gun and picks it up on arrival. */
  private fetchGun(): void {
    if (this.armed || !this.gun.root.visible) return
    if (this.distToGun() < 1.8) return this.pickUpGun()
    const g = this.gun.root.position
    const tile = this.office.grid.nearestWalkable(Math.floor(g.x), Math.floor(g.z))
    if (!tile) return
    this.follow = true
    this.route(this.player, tile, null, () => {
      if (this.distToGun() < 1.8) this.pickUpGun()
    })
  }

  private pickUpGun(): void {
    this.armed = true
    this.gun.root.visible = false
    this.gun.tag.hidden = true
    this.player.pose = 'stand'
    this.player.seatY = 0
    this.player.setProp('gun')
    sfx.pickup()
    this.hooks.onGun(true)
  }

  dropGun(): void {
    if (!this.armed) return
    this.armed = false
    this.aim = null
    this.player.setProp('none')
    const p = this.player.position
    this.gun.root.position.set(p.x, 0, p.z)
    this.gun.baseY = 0.3
    this.gun.root.visible = true
    this.gun.tag.hidden = false
    document.body.style.cursor = ''
    sfx.drop()
    this.hooks.onGun(false)
  }

  get isArmed(): boolean {
    return this.armed
  }

  private updateGun(dt: number): void {
    if (this.gun.root.visible) {
      this.gun.spin.rotation.y += dt * 1.6
      this.gun.spin.position.y = this.gun.baseY + Math.sin(this.time * 2.4) * 0.04
      this.gun.tag.setName(this.distToGun() < 1.8 ? 'Airsoft · E para pegar' : 'Airsoft')
    }
    if (this.armed && this.aim && !this.player.isWalking) this.player.faceTowards(this.aim.x, this.aim.z, false)
    for (const actor of this.actors.values()) {
      if (actor.shoutUntil && this.time >= actor.shoutUntil) {
        actor.shoutUntil = 0
        const a = this.state.agents.get(actor.id)
        if (a && !actor.down) this.bubble(actor, a)
      }
    }
    for (const [id, rec] of this.hp) {
      if (this.time - rec.last > HP_REGEN_S) {
        this.hp.delete(id)
        this.actors.get(id)?.tag.setHearts(null)
      }
    }
  }

  /** Fires a BB at an agent (homing on its chest) or at a floor point. */
  private shootAt(agentId: string | null, floor: THREE.Vector3 | null): void {
    if (!this.armed) return
    const actor = agentId ? this.actors.get(agentId) : undefined
    const aimAt = actor ? actor.avatar.position : floor
    if (!aimAt) return
    this.player.stop()
    this.player.faceTowards(aimAt.x, aimAt.z, false, true)
    this.player.kick()
    sfx.shot()
    const muzzle = this.player.muzzle()
    if (actor && !actor.down) {
      const chest = () =>
        this.actors.has(actor.id) && !actor.down ? actor.avatar.position.clone().add(new THREE.Vector3(0, 0.65, 0)) : null
      this.effects.fire(muzzle, chest, chest() ?? muzzle, () => this.hit(actor))
    } else if (floor) {
      this.effects.fire(muzzle, () => null, floor.clone().setY(0.05))
    }
  }

  private hit(actor: Actor): void {
    const a = this.state.agents.get(actor.id)
    if (!a || actor.down) return
    sfx.hit()
    actor.avatar.hitReact()
    const rec = this.hp.get(actor.id) ?? { hp: MAX_HP, last: 0 }
    rec.hp -= 1
    rec.last = this.time
    this.hp.set(actor.id, rec)
    actor.tag.setHearts(rec.hp, MAX_HP)
    if (rec.hp > 0) {
      actor.shout = OUCH[Math.floor(Math.random() * OUCH.length)]
      actor.shoutKind = 'error'
      actor.shoutUntil = this.time + 1.4
      this.bubble(actor, a)
      return
    }

    // knocked out
    actor.down = true
    actor.spot = null
    actor.hang = null
    actor.avatar.setProp('none')
    actor.avatar.knockDown()
    actor.tag.setBubble('x_x', 'error')
    sfx.ko()
    if (a.source === 'office') {
      setTimeout(() => this.effects.ghost(actor.avatar.position), 600)
      setTimeout(() => this.hooks.onKill(actor.id), 1700)
    } else {
      // Terminal sessions stay down until the player decides whether to close them.
      setTimeout(() => this.hooks.onKnockout(actor.id), 700)
    }
  }

  /** A knocked-out terminal agent was spared: it gets back up. */
  revive(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (!actor || !actor.down) return
    actor.avatar.getUp()
    actor.down = false
    actor.goal = null
    this.hp.delete(actor.id)
    actor.tag.setHearts(null)
    actor.shout = 'Ufa! Valeu, chefe!'
    actor.shoutKind = 'error'
    actor.shoutUntil = this.time + 2.5
    this.reconcile(actor)
  }

  /** Ghost rises out of an agent whose session is being closed; removal follows from state. */
  ghostOut(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (actor) this.effects.ghost(actor.avatar.position)
  }

  setPixelSize(n: number): void {
    this.engine.setPixelSize(n)
  }

  zoom(delta: number): void {
    this.engine.zoomStep(delta)
  }
}

function screenMode(a: AgentSummary): ScreenMode {
  switch (a.status) {
    case 'starting':
      return 'boot'
    case 'working':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'done':
      return 'done'
    case 'error':
      return 'error'
    case 'idle':
      return 'idle'
    default:
      return 'off'
  }
}
