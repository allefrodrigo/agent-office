import * as THREE from 'three'
import type { AgentSummary, SquadInfo, SquadMember, SubagentInfo } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import type { State } from './state'
import { Avatar } from './world/avatar'
import { Engine } from './world/engine'
import * as L from './world/layout'
import { buildOffice, type GroundFloor, type Office } from './world/office'
import { buildSquadFloor, type SquadFloor } from './world/squad-floor'
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
  /** Bumped on every new goal; an elevator ride that ends under an old goal starts over. */
  trip: number
  /** Inside the elevator between floors: goal changes wait for the doors to open. */
  riding: boolean
}

/** A subagent shown as a small copy of its parent, standing by the parent's desk. */
interface Helper {
  id: string
  parentId: string
  avatar: Avatar
  tag: Tag
  tile: [number, number] | null
  bornAt: number
  /** Game time when it says goodbye; null while the subagent runs. */
  endAt: number | null
  gone: boolean
}

/**
 * A squad member at work: it comes up in the elevator, sits at a free desk of its
 * sector (inline members sit beside the orchestrator), hands the delivery over in
 * the Diretoria and leaves.
 */
interface Member {
  /** Subagent task id, or inline:<orchestrator>:<member>. */
  id: string
  parentId: string
  info: SquadMember
  avatar: Avatar
  tag: Tag
  inline: boolean
  desk: L.DeskSlot | null
  tile: [number, number] | null
  phase: 'arriving' | 'working' | 'delivering' | 'leaving'
  bornAt: number
  /** Game time when the work is over and the delivery starts; null while it runs. */
  endAt: number | null
  /** What went wrong, for a subagent that failed. */
  failed: string | null
  sub: SubagentInfo | null
  /** Shows what it is doing (after a click) until this time. */
  infoUntil: number
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
  /** Player clicked the cycle board in the Diretoria. */
  onRunSquad(): void
  /** The player (and the camera) arrived on another floor. */
  onFloor(floor: number): void
  /** Player clicked the lounge TV: Claude FM on/off. */
  onTv(): void
}

const MAX_HP = 3
const HP_REGEN_S = 12
const GUN_HOME = { x: 3.4, y: 0.98, z: 16.35 }
const OUCH = ['Ai!', 'Ei! Tô trabalhando!', 'Isso dói!', 'Calma, chefe!', 'Ouch!', 'Pra que isso?']
/** An idle agent waits at its desk this long before wandering off to the lounge. */
const LOUNGE_AFTER_MS = 3 * 60_000

const HELPER_SCALE = 0.62
/** Subagents can finish in a few seconds; keep each helper on screen at least this long. */
const HELPER_MIN_S = 4
const HELPER_BYE_S = 1.2

const SPAWN_POINT = { x: L.ELEVATOR.x, z: 0.45 }
/** Seconds inside the elevator between floors. */
const RIDE_S = 1.1
/** Squad people walk briskly between sectors, the Diretoria and the elevator. */
const SQUAD_SPEED = 4.4
/** A member that finishes in a few seconds still gets to sit down for a moment. */
const MEMBER_MIN_S = 5
/** Whatever happens, a member leaves the floor this long after its work ends. */
const MEMBER_EXIT_S = 40
const OVERFLOW_TILES: [number, number][] = [
  [29, 9], [30, 9], [29, 10], [30, 10], [28, 9], [28, 10], [31, 9], [31, 10],
]
const center = ([x, z]: [number, number]) => ({ x: x + 0.5, z: z + 0.5 })
const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1) + '…' : text)
type Point = { x: number; y: number }
const tileOf = (p: THREE.Vector3): [number, number] => [Math.floor(p.x), Math.floor(p.z)]

export class Game {
  readonly engine: Engine
  /** Ground floor. */
  readonly office: GroundFloor
  /** Squad floor (1º andar); only exists while there is a squad folder. */
  private squadFloor: SquadFloor | null = null
  private squadKey = ''
  private floorName = ''
  private boardTag: Tag | null = null
  private members = new Map<string, Member>()
  /** One "Passo 3/6 · Texto" line over each Diretoria desk. */
  private stepTags: Tag[] = []
  private pcTag: Tag
  readonly overlays: Overlays
  readonly player: Avatar
  private playerTag: Tag
  private actors = new Map<string, Actor>()
  private helpers = new Map<string, Helper>()
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

    this.office.setFloors(1)
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
    // on the ground floor's group, so it hides with it
    this.office.group.add(gunRoot)
    const gunTag = this.overlays.add(new Tag(gunAnchor, 'Airsoft', false, () => this.fetchGun()))
    gunTag.setDot('gun')
    this.gun = { root: gunRoot, spin, tag: gunTag, baseY: GUN_HOME.y }

    // the player's own computer calls a new agent
    const pc = new THREE.Object3D()
    pc.position.set(3.3, 1.35, L.BOSS_DESK.z + 0.5)
    this.engine.scene.add(pc)
    this.pcTag = this.overlays.add(new Tag(pc, 'Chamar agente', false, () => hooks.onComputer()))
    this.pcTag.setDot('term')

    this.setSquads(state.squads, state.squadFloorName, false)
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
    this.syncHelpers()
    this.syncMembers()
    this.playerTag.setName(this.state.settings.playerName)
    if (this.player.look !== this.state.settings.playerLook) this.player.setLook(this.state.settings.playerLook)
  }

  private addActor(a: AgentSummary, animate: boolean): void {
    const avatar = new Avatar(a.look, a.id)
    const tag = this.overlays.add(new Tag(avatar.anchor, a.name, false, () => (this.armed ? this.shootAt(a.id, null) : this.hooks.onAgentClick(a.id))))
    const actor: Actor = { id: a.id, avatar, tag, goal: null, arrived: false, spot: null, hang: null, waveUntil: 0, down: false, shoutUntil: 0, shout: '', shoutKind: 'error', chatUntil: 0, restSince: null, trip: 0, riding: false }
    // agents already idle when the office opens (restored sessions) start in the lounge
    if (!animate && this.resting(a)) actor.restSince = 0
    // orchestrators live upstairs
    if (this.upstairs(a)) avatar.floor = 1
    if (a.role === 'orchestrator') avatar.speed = SQUAD_SPEED
    this.actors.set(a.id, actor)
    this.engine.scene.add(avatar.root)
    if (animate) {
      avatar.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
      avatar.face(0)
      this.floorOf(avatar.floor).ding()
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
    if (actor.riding) return this.vanish(actor, 0)
    this.route(actor.avatar, L.SPAWN_TILE, SPAWN_POINT, () => {
      this.floorOf(actor.avatar.floor).ding()
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

  // ---------- helpers (subagents) ----------

  private syncHelpers(): void {
    const live = new Set<string>()
    for (const a of this.state.agents.values()) {
      const parent = this.actors.get(a.id)
      if (!parent || parent.down || parent.goal === 'leave') continue
      for (const sub of a.subagents ?? []) {
        if (sub.member && a.role === 'orchestrator') continue
        live.add(sub.id)
        const helper = this.helpers.get(sub.id) ?? this.addHelper(a, parent, sub.id)
        // Name only, no bubble: several helpers around one desk would bury the parent's tag.
        if (helper.endAt === null) helper.tag.setName(clip(sub.description, 26))
      }
    }
    for (const h of this.helpers.values()) {
      if (!live.has(h.id) && h.endAt === null) h.endAt = Math.max(this.time, h.bornAt + HELPER_MIN_S)
    }
  }

  private addHelper(a: AgentSummary, parent: Actor, id: string): Helper {
    // Same id as the parent so clicking the helper opens the parent's panel.
    const avatar = new Avatar(a.look, a.id)
    avatar.speed = 2.4
    const tag = this.overlays.add(new Tag(avatar.anchor, 'Ajudante', false, () => this.hooks.onAgentClick(a.id)))
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

  private grow(helper: Helper): void {
    const k = Math.min(1, (this.time - helper.bornAt) / 0.35)
    helper.avatar.root.scale.setScalar(Math.max(0.01, k * HELPER_SCALE))
    if (k < 1 && !helper.gone) requestAnimationFrame(() => this.grow(helper))
  }

  /** A free tile within two steps of the parent, nearest first. */
  private helperTile(at: THREE.Vector3, floor: number): [number, number] | null {
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

  private updateHelpers(dt: number): void {
    for (const h of this.helpers.values()) {
      h.avatar.update(dt)
      if (h.endAt === null || h.gone || this.time < h.endAt) continue
      h.gone = true
      h.tag.setDot('done')
      h.tag.setName('✓ Pronto')
      h.avatar.stop()
      h.avatar.pose = 'wave'
      const start = this.time + HELPER_BYE_S
      const shrink = () => {
        const k = this.time < start ? 1 : 1 - (this.time - start) / 0.4
        if (k <= 0 || !this.helpers.has(h.id)) {
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

  // ---------- squad members ----------

  private squadOf(a: AgentSummary): SquadInfo | undefined {
    return this.state.squads.find((q) => q.code === a.squad && q.cwd === a.cwd) ?? this.state.squads.find((q) => q.code === a.squad)
  }

  private syncMembers(): void {
    const live = new Set<string>()
    const plan = this.squadFloor?.plan
    for (const a of this.state.agents.values()) {
      if (a.role !== 'orchestrator' || !plan) continue
      const parent = this.actors.get(a.id)
      if (!parent || parent.down || parent.goal === 'leave') continue
      const squad = this.squadOf(a)
      const find = (id: string): SquadMember =>
        squad?.members.find((m) => m.id === id) ?? { id, name: id, icon: '•', title: '', execution: 'subagent', sector: L.DEFAULT_SECTOR }
      for (const sub of a.subagents ?? []) {
        if (!sub.member) continue
        live.add(sub.id)
        const m = this.members.get(sub.id) ?? this.addMember(a, find(sub.member), sub.id, false)
        m.sub = sub
        this.memberBubble(m)
      }
      // Inline members have no subagent: the current step in state.json says who is on.
      const step = a.squadStep
      const busy = a.status === 'working' || a.status === 'starting' || a.status === 'waiting'
      const inline = step?.agent && step.status === 'running' && busy ? find(step.agent) : null
      if (inline && inline.execution === 'inline') {
        const id = `inline:${a.id}:${inline.id}`
        live.add(id)
        if (!this.members.has(id)) this.addMember(a, inline, id, true)
      }
    }
    for (const m of this.members.values()) {
      if (live.has(m.id) || m.endAt !== null) continue
      // Inline members just go; subagents show their delivery after a minimum stay.
      m.endAt = m.inline || !this.actors.has(m.parentId) ? this.time : Math.max(this.time, m.bornAt + MEMBER_MIN_S)
    }
    this.syncStepTags()
  }

  private addMember(a: AgentSummary, info: SquadMember, id: string, inline: boolean): Member {
    // The same person every cycle: the look comes from the squad and the member id.
    const avatar = new Avatar(lookFromSeed(L.memberKey(a.squad ?? '', info.id)), `member:${id}`)
    avatar.floor = 1
    avatar.speed = SQUAD_SPEED
    avatar.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
    avatar.face(0)
    this.engine.scene.add(avatar.root)
    const tag = this.overlays.add(new Tag(avatar.anchor, `${info.icon} ${info.name}`, false, () => this.memberClick(id)))
    tag.setDot('starting')
    const m: Member = { id, parentId: a.id, info, avatar, tag, inline, desk: null, tile: null, phase: 'arriving', bornAt: this.time, endAt: null, failed: null, sub: null, infoUntil: 0 }
    this.members.set(id, m)
    this.floorOf(1).ding()
    const arrive = () => {
      if (m.phase !== 'arriving') return
      m.phase = 'working'
      m.tag.setDot('working')
      this.memberPose(m)
      if (m.desk) this.squadFloor?.deskScreens[m.desk.index]?.setMode('working')
    }
    if (inline) {
      const desk = this.directorDesk(a)
      if (desk) this.route(avatar, desk.sideApproach, desk.side, arrive)
      else arrive()
      return m
    }
    const spot = this.memberSpot(a, info)
    m.desk = spot.desk
    m.tile = spot.tile
    if (spot.desk) this.route(avatar, spot.desk.approach, spot.desk.seat, arrive)
    else if (spot.tile) this.route(avatar, spot.tile, null, arrive)
    else arrive()
    return m
  }

  /** A free desk in the member's sector; when all are taken, a free spot standing in the room. */
  private memberSpot(a: AgentSummary, info: SquadMember): { desk: L.DeskSlot | null; tile: [number, number] | null } {
    const plan = this.squadFloor!.plan
    const name = plan.sectorOf.get(L.memberKey(a.squad ?? '', info.id)) ?? info.sector
    const room = plan.sectors.find((r) => r.name === name) ?? plan.sectors.find((r) => r.name === L.DEFAULT_SECTOR) ?? plan.sectors[0]
    if (!room) return { desk: null, tile: null }
    const taken = new Set<number>()
    const tiles = new Set<string>()
    for (const o of this.members.values()) {
      if (o.phase === 'leaving') continue
      if (o.desk) taken.add(o.desk.index)
      if (o.tile) tiles.add(o.tile.join(','))
    }
    const desk = room.desks.find((d) => !taken.has(d.index))
    if (desk) return { desk, tile: null }
    const grid = this.floorOf(1).grid
    return { desk: null, tile: room.stand.find((t) => grid.walkable(t[0], t[1]) && !tiles.has(t.join(','))) ?? null }
  }

  private memberPose(m: Member): void {
    const av = m.avatar
    if (av.isWalking || m.phase !== 'working') return
    if (m.inline) {
      const parent = this.actors.get(m.parentId)
      const a = this.state.agents.get(m.parentId)
      const desk = a && this.directorDesk(a)
      if (parent?.avatar.floor === 1) av.faceTowards(parent.avatar.position.x, parent.avatar.position.z)
      else if (desk) av.faceTowards(desk.seat.x, desk.seat.z)
      av.pose = 'sit'
    } else if (m.desk) {
      av.face(Math.PI)
      av.pose = 'type'
    } else {
      av.face(Math.PI)
      av.pose = 'stand'
    }
  }

  private memberBubble(m: Member): void {
    if (m.failed) return m.tag.setBubble(`✗ ${clip(m.failed, 70)}`, 'error')
    if (this.time < m.infoUntil && m.sub) {
      const tokens = m.sub.tokens ? `${Math.round(m.sub.tokens / 1000)}k tokens` : ''
      return m.tag.setBubble([clip(m.sub.description, 50), tokens, m.sub.lastTool ?? ''].filter(Boolean).join(' · '), 'talk')
    }
    if (m.phase === 'delivering') return m.tag.setBubble('✓ Entregando', 'done')
    if (m.phase === 'leaving') return m.tag.setBubble(null)
    m.tag.setBubble(m.inline ? 'Neste passo com a Diretoria' : m.sub ? clip(m.sub.description, 40) : null, 'work')
  }

  /** Click: what the member is doing (task, tokens, last tool) for a few seconds, and the orchestrator's panel. */
  private memberClick(id: string): void {
    const m = this.members.get(id)
    if (!m) return
    m.infoUntil = this.time + 6
    this.memberBubble(m)
    this.hooks.onAgentClick(m.parentId)
  }

  /** The orchestrator reported a member failing: the bubble says why, then it leaves without delivering. */
  memberEnded(taskId: string, status: 'completed' | 'failed' | 'stopped', summary?: string): void {
    const m = this.members.get(taskId)
    if (!m || status === 'completed') return
    m.failed = status === 'failed' ? summary || 'Falhou.' : 'Interrompido.'
    m.tag.setDot('error')
    this.memberBubble(m)
    m.endAt = Math.min(m.endAt ?? Infinity, this.time + 4)
  }

  private updateMembers(dt: number): void {
    for (const m of this.members.values()) {
      m.avatar.update(dt)
      if (m.infoUntil && this.time >= m.infoUntil) {
        m.infoUntil = 0
        this.memberBubble(m)
      }
      if (m.endAt === null || this.time < m.endAt) continue
      if (m.phase === 'arriving' || m.phase === 'working') this.memberDeliver(m)
      // safety net: nobody stays stuck on the floor
      else if (this.time > m.endAt + MEMBER_EXIT_S) this.memberGone(m)
    }
  }

  private memberDeliver(m: Member): void {
    if (m.desk) this.squadFloor?.deskScreens[m.desk.index]?.setMode(m.failed ? 'error' : 'done')
    m.avatar.pose = 'stand'
    m.avatar.seatY = 0
    const a = this.state.agents.get(m.parentId)
    const desk = a && this.directorDesk(a)
    if (m.failed || m.inline || !desk) return this.memberLeave(m)
    m.phase = 'delivering'
    m.tag.setDot('done')
    m.avatar.setProp('paper')
    this.memberBubble(m)
    const taken = new Set([...this.members.values()].filter((o) => o !== m && o.phase === 'delivering' && o.tile).map((o) => o.tile!.join(',')))
    const tile = desk.deliver.find((t) => !taken.has(t.join(','))) ?? desk.deliver[0]
    m.tile = tile
    this.route(m.avatar, tile, null, () => {
      m.avatar.faceTowards(desk.seat.x, desk.seat.z)
      m.avatar.pose = 'talk'
      setTimeout(() => {
        m.avatar.setProp('none')
        this.memberLeave(m)
      }, 1600)
    })
  }

  private memberLeave(m: Member): void {
    if (m.phase === 'leaving') return
    m.phase = 'leaving'
    if (m.desk) {
      const screen = this.squadFloor?.deskScreens[m.desk.index]
      setTimeout(() => screen?.setMode('off'), 2500)
    }
    m.desk = null
    m.tile = null
    if (!m.failed) this.memberBubble(m)
    this.route(m.avatar, L.SPAWN_TILE, SPAWN_POINT, () => {
      this.floorOf(1).ding()
      setTimeout(() => this.memberGone(m), 500)
    })
  }

  private memberGone(m: Member): void {
    if (!this.members.has(m.id)) return
    this.members.delete(m.id)
    this.engine.scene.remove(m.avatar.root)
    this.overlays.remove(m.tag)
  }

  /** "Passo 3/6 · Texto" over the desk of each orchestrator, from squads/<code>/state.json. */
  private syncStepTags(): void {
    const byDesk = new Map<number, AgentSummary>()
    for (const a of this.state.agents.values()) if (a.role === 'orchestrator') byDesk.set(a.desk, a)
    this.stepTags.forEach((tag, i) => {
      const st = byDesk.get(i)?.squadStep
      const text =
        st?.status === 'completed' ? '✓ Ciclo concluído' : st?.current ? `${st.type === 'checkpoint' ? '⏸' : '▸'} Passo ${st.current}/${st.total} · ${clip(st.label, 32)}` : 'Aguardando o próximo ciclo'
      tag.setName(text)
      tag.setDot(st?.type === 'checkpoint' && st.status !== 'completed' ? 'waiting' : st?.current && st.status !== 'completed' ? 'working' : 'idle')
    })
  }

  /** Nothing to do and nothing to deliver. */
  private resting(a: AgentSummary): boolean {
    const items = this.state.itemsFor(a.id)
    if (items.permissions.length || items.results.length) return false
    return a.status === 'done' || a.status === 'error' || a.status === 'idle'
  }

  private desired(actor: Actor, a: AgentSummary): Goal {
    if (a.role === 'orchestrator') {
      // The Diretoria is home: no lounge between cycles.
      const items = this.state.itemsFor(a.id)
      return items.permissions.length || items.results.length || a.status === 'waiting' ? 'boss' : 'desk'
    }
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
    if (!a || actor.goal === 'leave' || actor.down || actor.riding) return
    // mid-conversation: keep talking; the update loop hands the agent back when it ends
    if (this.time < actor.chatUntil) return
    actor.tag.setName(a.name)
    actor.tag.setDot(a.status)
    actor.tag.setHelpers(a.subagents?.length ?? 0)
    if (actor.avatar.look !== a.look && JSON.stringify(actor.avatar.look) !== JSON.stringify(a.look)) actor.avatar.setLook(a.look)
    this.screenFor(a)?.setMode(screenMode(a))

    const goal = this.desired(actor, a)
    if (goal !== actor.goal) {
      actor.goal = goal
      actor.trip++
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
    return a.role === 'orchestrator' ? undefined : this.office.deskScreens[a.desk]
  }

  private deskOf(a: AgentSummary) {
    return a.role === 'orchestrator' ? undefined : L.DESKS[a.desk]
  }

  /** Orchestrators work upstairs while the squad floor exists. */
  private upstairs(a: AgentSummary): boolean {
    return a.role === 'orchestrator' && !!this.squadFloor
  }

  private directorDesk(a: AgentSummary): L.DirectorDesk | undefined {
    return this.squadFloor?.plan.directors[a.desk]
  }

  floorOf(n: number): Office {
    return n === 1 && this.squadFloor ? this.squadFloor : this.office
  }

  /**
   * Takes an avatar to another floor: it walks into the elevator, rides, and steps
   * out upstairs (or downstairs). `then` runs on arrival if the goal is still the same.
   */
  private travel(actor: Actor, floor: number, instant: boolean, then: () => void): void {
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
      this.floorOf(av.floor).ding()
      actor.riding = true
      setTimeout(() => {
        av.floor = floor
        av.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
        av.face(0)
        this.floorOf(floor).ding()
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

  private goDesk(actor: Actor, a: AgentSummary, instant: boolean): void {
    if (a.role === 'orchestrator') return this.goDirector(actor, a, instant)
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

  /** The orchestrator's chair in the Diretoria. */
  private goDirector(actor: Actor, a: AgentSummary, instant: boolean): void {
    const desk = this.directorDesk(a)
    const done = () => {
      actor.arrived = true
      const now = this.state.agents.get(actor.id)
      if (now) this.pose(actor, now)
    }
    if (!desk) {
      // no squad floor (folder removed): wait by the elevator downstairs
      const tile = OVERFLOW_TILES[a.desk % OVERFLOW_TILES.length]
      return this.travel(actor, 0, instant, () => {
        if (instant) {
          actor.avatar.placeAt(tile[0] + 0.5, tile[1] + 0.5)
          done()
        } else this.route(actor.avatar, tile, null, done)
      })
    }
    this.travel(actor, 1, instant, () => {
      if (instant) {
        actor.avatar.placeAt(desk.seat.x, desk.seat.z)
        done()
      } else this.route(actor.avatar, desk.approach, desk.seat, done)
    })
  }

  /** Visits happen wherever the player is: orchestrators take the elevator, everyone else stays downstairs. */
  private goBoss(actor: Actor, instant: boolean): void {
    const a = this.state.agents.get(actor.id)
    const floor = a?.role === 'orchestrator' ? this.player.floor : actor.avatar.floor
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
    if (actor.goal === 'desk' && a.role === 'orchestrator') {
      if (!this.directorDesk(a)) {
        av.pose = 'stand'
        av.face(Math.PI)
        return
      }
      av.face(0)
      av.pose = a.status === 'working' || a.status === 'starting' ? 'type' : 'sit'
      av.seatY = 0
    } else if (actor.goal === 'desk') {
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
      if (av.floor === this.player.floor && (av.floor === 1 || this.playerInBossRoom())) av.faceTowards(this.player.position.x, this.player.position.z)
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

  private playerInBossRoom(): boolean {
    return this.player.floor === 0 && L.inBossRoom(this.player.position.x, this.player.position.z)
  }

  private pickVisitSpot(actor: Actor): [number, number] {
    const taken = new Set<string>()
    for (const o of this.actors.values()) if (o !== actor && o.spot && o.avatar.floor === actor.avatar.floor) taken.add(o.spot.join(','))
    const [px, pz] = tileOf(this.player.position)
    // Upstairs there is no boss office: stand next to the player, wherever they are.
    if (actor.avatar.floor === 1) {
      const grid = this.floorOf(1).grid
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

  // ---------- movement ----------

  private route(av: Avatar, tile: [number, number], final: { x: number; z: number } | null, onArrive: () => void): void {
    const [sx, sz] = tileOf(av.position)
    const path = this.floorOf(av.floor).grid.findPath(sx, sz, tile[0], tile[1])
    const points = (path ?? []).map(center)
    if (!path) points.push(center(tile)) // unreachable: walk straight there rather than freeze
    if (final) points.push(final)
    av.walk(points, onArrive)
  }

  /** Player is sitting in the boss chair; visitors line up in front of the desk. */
  private playerSeated(): boolean {
    const p = this.player.position
    return this.player.floor === 0 && this.player.pose === 'sit' && Math.hypot(p.x - L.BOSS_SEAT.x, p.z - L.BOSS_SEAT.z) < 0.3
  }

  private sitPlayer(): void {
    this.player.placeAt(L.BOSS_SEAT.x, L.BOSS_SEAT.z)
    this.player.face(0)
    this.player.pose = 'sit'
  }

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
  private besideTile(target: THREE.Vector3, from: THREE.Vector3, floor = 0): [number, number] | null {
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

  focusAgent(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (!actor || actor.riding) return
    this.goFloor(actor.avatar.floor)
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
      if (k === 'e' && !this.armed && this.player.floor === 0 && this.gun.root.visible && this.distToGun() < 1.8) this.pickUpGun()
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

  /** Helpers answer with their parent's id; they are not targets for the airsoft. */
  private agentAt(x: number, y: number, withHelpers = true): string | null {
    const view = this.player.floor
    const roots = [...this.actors.values()].filter((a) => a.goal !== 'leave' && !a.down && a.avatar.floor === view).map((a) => a.avatar.root)
    if (withHelpers) for (const h of this.helpers.values()) if (!h.gone && h.avatar.floor === view) roots.push(h.avatar.root)
    for (const hit of this.engine.pick(x, y, roots)) {
      const id = hit.object.userData.avatarId as string | undefined
      if (id) return id
    }
    return null
  }

  private click(x: number, y: number): void {
    if (this.armed) {
      this.shootAt(this.agentAt(x, y, false), this.engine.pickFloor(x, y))
      return
    }
    if (this.player.floor === 0 && this.gun.root.visible && this.engine.pick(x, y, [this.gun.root]).length) {
      this.fetchGun()
      return
    }
    if (this.onTv(x, y)) {
      this.hooks.onTv()
      return
    }
    if (this.player.floor === 1) {
      const roots = [...this.members.values()].filter((m) => m.phase !== 'leaving').map((m) => m.avatar.root)
      const hit = this.engine.pick(x, y, roots).find((h) => String(h.object.userData.avatarId ?? '').startsWith('member:'))
      if (hit) return this.memberClick(String(hit.object.userData.avatarId).slice('member:'.length))
    }
    const id = this.agentAt(x, y)
    if (id) {
      this.hooks.onAgentClick(id)
      return
    }
    const p = this.engine.pickFloor(x, y)
    if (!p) return
    const tile: [number, number] = [Math.floor(p.x), Math.floor(p.z)]
    if (!this.floorOf(this.player.floor).grid.inside(tile[0], tile[1])) return
    this.walkPlayerTo(tile)
  }

  private onTv(x: number, y: number): boolean {
    return this.player.floor === 0 && this.engine.pick(x, y, [this.office.tv.group]).length > 0
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

  private updateHover(x: number, y: number): void {
    const p = this.engine.pickFloor(x, y)
    const grid = this.floorOf(this.player.floor).grid
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
    if (this.onTv(x, y)) {
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
    this.updateHelpers(dt)
    this.updateMembers(dt)
    this.office.update(dt)
    this.squadFloor?.update(dt)
    this.showFloor()
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
    const inRoom = this.playerInBossRoom() && !seated
    const reach = seated ? 3.6 : 2.2
    let near: Actor | null = null
    let nearD = Infinity
    for (const actor of this.actors.values()) {
      if (actor.goal !== 'boss' || !actor.arrived || actor.avatar.isWalking || actor.down || actor.riding) continue
      if (actor.avatar.floor !== this.player.floor) {
        // An orchestrator follows the player to the other floor; agents downstairs wait in the boss office.
        if (this.state.agents.get(actor.id)?.role === 'orchestrator' && !this.player.isWalking) {
          actor.arrived = false
          actor.trip++
          this.goBoss(actor, false)
        }
        continue
      }
      const d = Math.hypot(actor.avatar.position.x - pp.x, actor.avatar.position.z - pp.z)
      const follows = actor.avatar.floor === 1 || inRoom
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
    // The gun lives on the ground floor; dropped upstairs, it goes back to the meeting table.
    if (this.player.floor === 0) {
      this.gun.root.position.set(p.x, 0, p.z)
      this.gun.baseY = 0.3
    } else {
      this.gun.root.position.set(GUN_HOME.x, 0, GUN_HOME.z)
      this.gun.baseY = GUN_HOME.y
    }
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
      this.gun.tag.setName(this.player.floor === 0 && this.distToGun() < 1.8 ? 'Airsoft · E para pegar' : 'Airsoft')
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

  // ---------- floors ----------

  /** Builds, rebuilds or removes the squad floor when the squads change. */
  setSquads(squads: SquadInfo[], name: string, notify = true): void {
    const plan = L.squadPlan(squads)
    const key = JSON.stringify([name, plan.sectors.map((r) => [r.name, r.desks.length])])
    if (squads.length && key === this.squadKey && this.squadFloor) return
    if (!squads.length && !this.squadFloor) return
    this.squadKey = key
    this.floorName = name
    if (this.squadFloor) {
      this.engine.scene.remove(this.squadFloor.group)
      this.overlays.clearLabels(1)
      if (this.boardTag) this.overlays.remove(this.boardTag)
      this.boardTag = null
      for (const t of this.stepTags) this.overlays.remove(t)
      this.stepTags = []
      for (const m of this.members.values()) this.memberGone(m)
      this.squadFloor = null
    }
    if (squads.length) {
      const floor = buildSquadFloor(plan, name)
      this.squadFloor = floor
      this.engine.scene.add(floor.group)
      this.overlays.label('Diretoria', (L.DIRECTOR_RECT[0] + L.DIRECTOR_RECT[2]) / 2, 9.4, 1)
      for (const r of plan.sectors) this.overlays.label(r.name, (r.rect[0] + r.rect[2]) / 2, r.top ? 9.4 : r.rect[3] - 0.6, 1)
      this.boardTag = this.overlays.add(new Tag(floor.board, '▶ Rodar ciclo', false, () => this.hooks.onRunSquad()))
      this.boardTag.setDot('term')
      for (const d of plan.directors) {
        const anchor = new THREE.Object3D()
        anchor.position.set(d.x + d.w / 2, 0.95, d.z + 1.2)
        floor.group.add(anchor)
        const tag = this.overlays.add(new Tag(anchor, ''))
        tag.el.classList.add('tag-step')
        this.stepTags.push(tag)
      }
    }
    this.office.setFloors(squads.length ? 2 : 1)
    this.squadFloor?.setFloors(2)
    // Everyone upstairs starts over on the new plan (or comes down if the floor is gone).
    if (!this.squadFloor && this.player.floor === 1) this.goFloor(0)
    for (const actor of this.actors.values()) {
      const a = this.state.agents.get(actor.id)
      if (a?.role !== 'orchestrator' || actor.goal === 'leave') continue
      actor.goal = null
      if (!this.squadFloor && actor.avatar.floor === 1) actor.avatar.floor = 0
      this.reconcile(actor, true)
    }
    if (notify) this.hooks.onFloor(this.player.floor)
  }

  get floors(): string[] {
    return this.squadFloor ? ['Térreo', this.floorName] : ['Térreo']
  }

  get currentFloor(): number {
    return this.player.floor
  }

  /** The player takes the elevator: out on the other floor, with the camera. */
  goFloor(n: number): void {
    if (n === this.player.floor || (n === 1 && !this.squadFloor) || n < 0 || n > 1) return
    const p = this.player
    p.stop()
    p.pose = 'stand'
    p.seatY = 0
    this.floorOf(p.floor).ding()
    p.floor = n
    p.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
    p.face(0)
    this.floorOf(n).ding()
    this.engine.jumpTo(p.position.x, p.position.z)
    this.follow = true
    this.route(p, [L.SPAWN_TILE[0], L.SPAWN_TILE[1] + 1], null, () => undefined)
    this.hooks.onFloor(n)
  }

  /** Only the floor the player is on is drawn. */
  private showFloor(): void {
    const view = this.player.floor
    this.office.group.visible = view === 0
    if (this.squadFloor) this.squadFloor.group.visible = view === 1
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
      m.avatar.root.visible = view === 1
      m.tag.hidden = view !== 1
    }
    const orchestrators = new Set([...this.state.agents.values()].filter((a) => a.role === 'orchestrator').map((a) => a.desk))
    this.stepTags.forEach((t, i) => (t.hidden = view !== 1 || !orchestrators.has(i)))
    this.gun.tag.hidden = !this.gun.root.visible || view !== 0
    this.pcTag.hidden = view !== 0
    if (this.boardTag) this.boardTag.hidden = view !== 1
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
