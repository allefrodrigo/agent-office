import * as THREE from 'three'
import type { AgentSummary, ProjectFloor, SquadInfo, SquadMember, SubagentInfo } from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { accountPool } from '@shared/accounts'
import { projectFor } from '@shared/projects'
import type { State } from './state'
import { Avatar, type Uniform } from './world/avatar'
import { brandOf, DEFAULT_BRAND, releaseLogos } from './world/brand'
import { disposeTree } from './world/dispose'
import { Engine } from './world/engine'
import * as L from './world/layout'
import { buildOffice, type GroundFloor, type Office } from './world/office'
import { buildUpperFloor, type UpperFloor } from './world/upper-floor'
import { Overlays, Tag, type BubbleKind } from './world/overlays'
import type { ScreenMode } from './world/screens'
import { money } from './world/props'
import { Effects, sfx } from './world/effects'
import { FACE_CAMERA, skeleton } from './world/skull'

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
  /** Struck by the skull: lies still until its session closes (gets back up if closing fails). */
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
  /** Project and desk the actor last headed to; a change (floors edited) sends it there. */
  seat: string
}

/** A project floor on screen: floor n is uppers[n - 1]. */
interface Upper {
  project: ProjectFloor
  scene: UpperFloor
  /** "Contratar squad" on the Diretoria board; null when the project has no squads. */
  boardTag: Tag | null
  /** One "Passo 3/6 · Texto" line over each Diretoria desk. */
  stepTags: Tag[]
  /** Over the alarm, while an account of this floor is at its limit. */
  alarmTag: Tag
  /** Over the spending board: the exact total. */
  moneyTag: Tag
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
  /** Player clicked the skull in the boss office: pick an agent to dismiss. */
  onSkull(): void
  /** Player clicked their own computer: open "Novo agente" on Conversar. */
  onComputer(): void
  /** Player clicked the board in the Diretoria of a project floor. */
  onRunSquad(project: ProjectFloor): void
  /** The player (and the camera) arrived on another floor. */
  onFloor(floor: number): void
  /** Player clicked the lounge TV: Claude FM on/off. */
  onTv(): void
}

/** Floor spot by the boss office where the skeleton stands. */
const SKULL_HOME = { x: 2.5, y: 0, z: 12.3 }
/** Seconds the camera gets to reach a dismissed agent before the skull drops. */
const STRIKE_AFTER_S = 0.6
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
  /** Project floors, 1º andar first. */
  private uppers: Upper[] = []
  private uppersKey = ''
  private members = new Map<string, Member>()
  private pcTag: Tag
  /** Over the ground floor alarm. */
  private alarmTag: Tag
  /** Over the ground floor spending board. */
  private moneyTag: Tag
  /** Seconds until the boards and alarms are checked again (limits expire on their own). */
  private boardsIn = 0
  readonly overlays: Overlays
  readonly player: Avatar
  private playerTag: Tag
  private actors = new Map<string, Actor>()
  private helpers = new Map<string, Helper>()
  private keys = new Set<string>()
  private follow = true
  /** Agent the camera tracks until it settles (sits or stops); `until` drops it if it never shows up. */
  private watch: { id: string; until: number } | null = null
  private hover: THREE.LineSegments
  private time = 0
  private nearId: string | null = null
  private recheck = 0
  private dragging: { x: number; y: number; moved: boolean; button: number } | null = null
  private wheelAcc = 0
  private effects: Effects
  private skull: { root: THREE.Group; tag: Tag; eyes: THREE.MeshBasicMaterial }
  /** Agents picked at the skull, waiting for the camera (or the elevator) before the strike. */
  private doomed = new Map<string, { at: number; done: () => void }>()
  /** performance.now() until which the scene draws at full rate even if nothing walks (input, events). */
  private wakeUntil = 0
  private reducedEffects = false

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
        cafe: [4.5, 23.4],
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

    // the skeleton by the boss office: click it to dismiss an agent
    this.effects = new Effects(this.engine.scene)
    const sk = skeleton()
    sk.group.position.set(SKULL_HOME.x, SKULL_HOME.y, SKULL_HOME.z)
    sk.group.rotation.y = FACE_CAMERA
    sk.group.scale.setScalar(1.05)
    const skullAnchor = new THREE.Object3D()
    skullAnchor.position.set(SKULL_HOME.x, SKULL_HOME.y + 1.85, SKULL_HOME.z)
    // on the ground floor's group, so they hide with it
    this.office.group.add(sk.group, skullAnchor)
    const skullTag = this.overlays.add(new Tag(skullAnchor, 'Caveira', false, () => hooks.onSkull()))
    skullTag.setDot('skull')
    this.skull = { root: sk.group, tag: skullTag, eyes: sk.eyes }

    // the player's own computer calls a new agent
    const pc = new THREE.Object3D()
    pc.position.set(3.3, 1.35, L.BOSS_DESK.z + 0.5)
    this.engine.scene.add(pc)
    this.pcTag = this.overlays.add(new Tag(pc, 'Novo agente', false, () => hooks.onComputer()))
    this.pcTag.setDot('term')

    this.alarmTag = this.alarmTagFor(this.office.alarm)
    this.moneyTag = this.moneyTagFor(this.office.money)
    this.setProjects(state.settings.projects, state.squads, false)
    for (const a of state.agents.values()) this.addActor(a, false)
    state.onChange(() => {
      this.sync()
      this.wake()
    })
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
    this.syncBoards()
    this.playerTag.setName(this.state.settings.playerName)
    if (this.player.look !== this.state.settings.playerLook) this.player.setLook(this.state.settings.playerLook)
  }

  private addActor(a: AgentSummary, animate: boolean): void {
    const avatar = new Avatar(a.look, a.id)
    const tag = this.overlays.add(new Tag(avatar.anchor, a.name, false, () => this.hooks.onAgentClick(a.id)))
    const actor: Actor = { id: a.id, avatar, tag, goal: null, arrived: false, spot: null, hang: null, waveUntil: 0, down: false, shoutUntil: 0, shout: '', shoutKind: 'error', chatUntil: 0, restSince: null, trip: 0, riding: false, seat: seatKey(a) }
    // agents already idle when the office opens (restored sessions) start in the lounge
    if (!animate && this.resting(a)) actor.restSince = 0
    // project agents and orchestrators arrive on their project's floor
    avatar.floor = this.homeFloor(a)
    if (a.role === 'orchestrator') avatar.speed = SQUAD_SPEED
    this.actors.set(a.id, actor)
    this.engine.scene.add(avatar.root)
    if (animate) {
      avatar.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
      avatar.face(0)
      this.ding(avatar.floor)
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
      this.ding(actor.avatar.floor)
      this.vanish(actor, 500)
    })
  }

  /** Shrinks the avatar away and forgets the actor. */
  private vanish(actor: Actor, delayMs: number): void {
    const shrink = (start: number) => {
      const k = 1 - (this.time - start) / 0.6
      if (k <= 0) {
        actor.avatar.dispose()
        this.engine.scene.remove(actor.avatar.root)
        this.overlays.remove(actor.tag)
        this.actors.delete(actor.id)
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
    avatar.setUniform(this.uniformFor(a))
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

  // ---------- squad members ----------

  private squadOf(a: AgentSummary): SquadInfo | undefined {
    return this.state.squads.find((q) => q.code === a.squad && q.cwd === a.cwd) ?? this.state.squads.find((q) => q.code === a.squad)
  }

  private syncMembers(): void {
    const live = new Set<string>()
    for (const a of this.state.agents.values()) {
      if (a.role !== 'orchestrator' || !this.upperOf(this.homeFloor(a))) continue
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
    avatar.floor = this.homeFloor(a)
    this.dress(avatar, a)
    avatar.speed = SQUAD_SPEED
    avatar.placeAt(SPAWN_POINT.x, SPAWN_POINT.z)
    avatar.face(0)
    this.engine.scene.add(avatar.root)
    const tag = this.overlays.add(new Tag(avatar.anchor, `${info.icon} ${info.name}`, false, () => this.memberClick(id)))
    tag.setDot('starting')
    const m: Member = { id, parentId: a.id, info, avatar, tag, inline, desk: null, tile: null, phase: 'arriving', bornAt: this.time, endAt: null, failed: null, sub: null, infoUntil: 0 }
    this.members.set(id, m)
    this.ding(avatar.floor)
    const arrive = () => {
      if (m.phase !== 'arriving') return
      m.phase = 'working'
      m.tag.setDot('working')
      this.memberPose(m)
      if (m.desk) this.floorOf(avatar.floor).deskScreens[m.desk.index]?.setMode('working')
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
    const floor = this.homeFloor(a)
    const plan = this.upperOf(floor)!.scene.plan
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
    const grid = this.floorOf(floor).grid
    return { desk: null, tile: room.stand.find((t) => grid.walkable(t[0], t[1]) && !tiles.has(t.join(','))) ?? null }
  }

  private memberPose(m: Member): void {
    const av = m.avatar
    if (av.isWalking || m.phase !== 'working') return
    if (m.inline) {
      const parent = this.actors.get(m.parentId)
      const a = this.state.agents.get(m.parentId)
      const desk = a && this.directorDesk(a)
      if (parent?.avatar.floor === av.floor) av.faceTowards(parent.avatar.position.x, parent.avatar.position.z)
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
    if (m.desk) this.floorOf(m.avatar.floor).deskScreens[m.desk.index]?.setMode(m.failed ? 'error' : 'done')
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
      const screen = this.floorOf(m.avatar.floor).deskScreens[m.desk.index]
      setTimeout(() => screen?.setMode('off'), 2500)
    }
    m.desk = null
    m.tile = null
    if (!m.failed) this.memberBubble(m)
    this.route(m.avatar, L.SPAWN_TILE, SPAWN_POINT, () => {
      this.ding(m.avatar.floor)
      setTimeout(() => this.memberGone(m), 500)
    })
  }

  private memberGone(m: Member): void {
    if (!this.members.has(m.id)) return
    this.members.delete(m.id)
    m.avatar.dispose()
    this.engine.scene.remove(m.avatar.root)
    this.overlays.remove(m.tag)
  }

  /** "Passo 3/6 · Texto" over the desk of each orchestrator, from squads/<code>/state.json. */
  private syncStepTags(): void {
    this.uppers.forEach((u, i) => {
      const byDesk = this.directorsOn(i + 1)
      u.stepTags.forEach((tag, d) => {
        const st = byDesk.get(d)?.squadStep
        const text =
          st?.status === 'completed' ? '✓ Ciclo concluído' : st?.current ? `${st.type === 'checkpoint' ? '⏸' : '▸'} Passo ${st.current}/${st.total} · ${clip(st.label, 32)}` : 'Aguardando o próximo ciclo'
        tag.setName(text)
        tag.setDot(st?.type === 'checkpoint' && st.status !== 'completed' ? 'waiting' : st?.current && st.status !== 'completed' ? 'working' : 'idle')
      })
    })
  }

  /** Orchestrators of a floor by Diretoria desk. */
  private directorsOn(floor: number): Map<number, AgentSummary> {
    const out = new Map<number, AgentSummary>()
    for (const a of this.state.agents.values()) if (a.role === 'orchestrator' && this.homeFloor(a) === floor) out.set(a.desk, a)
    return out
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
      // The lounge is on the ground floor: project agents rest at their desks.
      return this.homeFloor(a) === 0 && Date.now() - actor.restSince >= LOUNGE_AFTER_MS ? 'hang' : 'desk'
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
    this.dress(actor.avatar, a)
    this.showAccount(actor, a)
    this.screenFor(a)?.setMode(screenMode(a))

    // Moved to another floor or desk: head there even if the goal stays the same.
    if (seatKey(a) !== actor.seat) {
      actor.seat = seatKey(a)
      actor.goal = null
    }
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

  /** The uniform of the agent's company: its project floor, when that floor asks for one. */
  private uniformFor(a: AgentSummary): Uniform | null {
    const p = this.upperOf(this.homeFloor(a))?.project
    return p?.uniform ? { color: p.brandColor ?? DEFAULT_BRAND, logo: p.logo } : null
  }

  /** Uniform on (or off) and the account diamond over the head. */
  private dress(avatar: Avatar, a: AgentSummary): void {
    avatar.setUniform(this.uniformFor(a))
    const acc = a.source === 'office' && a.account ? this.state.account(a.account) : undefined
    avatar.setGem(acc?.color ?? null)
  }

  /** The account chip on the name tag, only while there is more than one account. */
  private showAccount(actor: Actor, a: AgentSummary): void {
    const acc = this.state.settings.accounts.length > 1 && a.source === 'office' && a.account ? this.state.account(a.account) : undefined
    actor.tag.setAccount(acc?.name ?? null, acc?.color)
  }

  private screenFor(a: AgentSummary) {
    return this.deskOf(a) ? this.floorOf(this.homeFloor(a)).deskScreens[a.desk] : undefined
  }

  private deskOf(a: AgentSummary): L.DeskSlot | undefined {
    if (a.role === 'orchestrator') return undefined
    const up = this.upperOf(this.homeFloor(a))
    return up ? up.scene.plan.teamDesks[a.desk] : L.DESKS[a.desk]
  }

  /** Floor an agent works on: its project's floor, or the ground floor. */
  private homeFloor(a: AgentSummary): number {
    return a.project ? this.uppers.findIndex((u) => u.project.id === a.project) + 1 : 0
  }

  private upperOf(n: number): Upper | undefined {
    return n > 0 ? this.uppers[n - 1] : undefined
  }

  private directorDesk(a: AgentSummary): L.DirectorDesk | undefined {
    return a.role === 'orchestrator' ? this.upperOf(this.homeFloor(a))?.scene.plan.directors[a.desk] : undefined
  }

  floorOf(n: number): Office {
    return this.upperOf(n)?.scene ?? this.office
  }

  /** Where an agent stands when every desk of its floor is taken. */
  private overflowTile(a: AgentSummary, floor: number): [number, number] {
    const plan = this.upperOf(floor)?.scene.plan
    if (!plan || a.role === 'orchestrator') return OVERFLOW_TILES[a.desk % OVERFLOW_TILES.length]
    return plan.teamStand[(a.desk - plan.teamDesks.length) % plan.teamStand.length] ?? L.SPAWN_TILE
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

  private goDesk(actor: Actor, a: AgentSummary, instant: boolean): void {
    if (a.role === 'orchestrator') return this.goDirector(actor, a, instant)
    const floor = this.homeFloor(a)
    const desk = this.deskOf(a)
    const done = () => {
      actor.arrived = true
      const now = this.state.agents.get(actor.id)
      if (now) this.pose(actor, now)
    }
    this.travel(actor, floor, instant, () => {
      if (!desk) {
        const tile = this.overflowTile(a, floor)
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
    })
  }

  /** The orchestrator's chair in the Diretoria. */
  private goDirector(actor: Actor, a: AgentSummary, instant: boolean): void {
    const desk = this.directorDesk(a)
    const done = () => {
      actor.arrived = true
      const now = this.state.agents.get(actor.id)
      if (now) this.pose(actor, now)
    }
    const floor = this.homeFloor(a)
    if (!desk) {
      // floor gone (downstairs) or both Diretoria desks taken: wait by the elevator
      const tile = this.overflowTile(a, floor)
      return this.travel(actor, floor, instant, () => {
        if (instant) {
          actor.avatar.placeAt(tile[0] + 0.5, tile[1] + 0.5)
          done()
        } else this.route(actor.avatar, tile, null, done)
      })
    }
    this.travel(actor, floor, instant, () => {
      if (instant) {
        actor.avatar.placeAt(desk.seat.x, desk.seat.z)
        done()
      } else this.route(actor.avatar, desk.approach, desk.seat, done)
    })
  }

  /** Visits: project agents take the elevator to wherever the player is; the ground floor's go to the boss office. */
  private goBoss(actor: Actor, instant: boolean): void {
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
      if (av.floor === this.player.floor && (av.floor > 0 || this.playerInBossRoom())) av.faceTowards(this.player.position.x, this.player.position.z)
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

  /** Points the camera at an agent and keeps it there until the agent settles, even one still on its way in. */
  focusAgent(agentId: string): void {
    const actor = this.actors.get(agentId)
    if (actor && !actor.riding) this.goFloor(actor.avatar.floor)
    // after goFloor, which hands the camera back to the player
    this.follow = false
    this.watch = { id: agentId, until: this.time + 5 }
  }

  /** Follows the watched agent; done once it sits or stands still, and as soon as the player takes the camera back. */
  private updateWatch(): void {
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
    p.face(Math.atan2(dx, dz))
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
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k)
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => this.keys.clear())

    // any touch on the scene draws at full rate for a moment (hover outline, drag, zoom)
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'wheel'] as const) el.addEventListener(type, () => this.wake(), { passive: true })
    window.addEventListener('keydown', () => this.wake())

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
          this.watch = null
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

  /** Helpers answer with their parent's id. */
  private agentAt(x: number, y: number): string | null {
    const view = this.player.floor
    const roots = [...this.actors.values()].filter((a) => a.goal !== 'leave' && !a.down && a.avatar.floor === view).map((a) => a.avatar.root)
    for (const h of this.helpers.values()) if (!h.gone && h.avatar.floor === view) roots.push(h.avatar.root)
    for (const hit of this.engine.pick(x, y, roots)) {
      const id = hit.object.userData.avatarId as string | undefined
      if (id) return id
    }
    return null
  }

  private click(x: number, y: number): void {
    if (this.onSkull(x, y)) {
      this.hooks.onSkull()
      return
    }
    if (this.onTv(x, y)) {
      this.hooks.onTv()
      return
    }
    if (this.player.floor > 0) {
      const roots = [...this.members.values()].filter((m) => m.phase !== 'leaving' && m.avatar.floor === this.player.floor).map((m) => m.avatar.root)
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

  private onSkull(x: number, y: number): boolean {
    return this.player.floor === 0 && this.engine.pick(x, y, [this.skull.root]).length > 0
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
    if (!p || !grid.inside(Math.floor(p.x), Math.floor(p.z)) || this.agentAt(x, y)) {
      this.hover.visible = false
      document.body.style.cursor = this.agentAt(x, y) ? 'pointer' : ''
      return
    }
    if (this.onTv(x, y) || this.onSkull(x, y)) {
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

  /** Draw at full rate for the next `ms` (AO-29): input, a state change, a ding. */
  wake(ms = 400): void {
    this.wakeUntil = Math.max(this.wakeUntil, performance.now() + ms)
  }

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
    this.office.reducedMotion = on
    for (const u of this.uppers) u.scene.reducedMotion = on
    this.reducedEffects = on
  }

  /** The elevator rings on a floor; its doors animate, so the scene wakes up. */
  private ding(floor: number): void {
    this.floorOf(floor).ding()
    if (floor === this.player.floor) this.wake(1500)
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

  private updateSkull(): void {
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
  private strike(actor: Actor, done: () => void): void {
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
      return { project, scene, boardTag, stepTags, alarmTag: this.alarmTagFor(scene.alarm), moneyTag: this.moneyTagFor(scene.money) }
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
    if (notify) this.hooks.onFloor(this.player.floor)
  }

  /** People in the scene besides the player, for the dev leak test (dev/leak-test.ts). */
  get population(): { actors: number; helpers: number; members: number } {
    return { actors: this.actors.size, helpers: this.helpers.size, members: this.members.size }
  }

  get floors(): string[] {
    return ['Térreo', ...this.uppers.map((u) => u.project.name)]
  }

  get currentFloor(): number {
    return this.player.floor
  }

  // ---------- spending boards and limit alarms ----------

  private alarmTagFor(alarm: { anchor: THREE.Object3D }): Tag {
    const tag = this.overlays.add(new Tag(alarm.anchor, ''))
    tag.el.classList.add('tag-alarm')
    tag.setDot('error')
    tag.hidden = true
    return tag
  }

  private moneyTagFor(board: { anchor: THREE.Object3D }): Tag {
    const tag = this.overlays.add(new Tag(board.anchor, ''))
    tag.el.classList.add('tag-money')
    tag.setDot('money')
    tag.hidden = true
    return tag
  }

  /** Accounts at a plan limit, with when they come back (if known). */
  private limitedAccounts(): Map<string, number | undefined> {
    const now = Date.now()
    const out = new Map<string, number | undefined>()
    for (const st of this.state.accounts) if (st.limitedUntil && st.limitedUntil > now) out.set(st.id, st.limitedUntil)
    for (const u of this.state.usage) {
      const full = u.windows.find((w) => w.percent >= 100 && (!w.resetsAt || w.resetsAt > now))
      if (full && !out.has(u.accountId)) out.set(u.accountId, full.resetsAt)
    }
    return out
  }

  /**
   * Each floor's board adds up what was spent today in its folder (the ground floor: every folder);
   * its alarm goes off while an account it runs on is at its limit (the ground floor: any).
   */
  private syncBoards(): void {
    this.boardsIn = 5
    const limited = this.limitedAccounts()
    const floors: [Office, Tag, Tag, ProjectFloor | null][] = [
      [this.office, this.alarmTag, this.moneyTag, null],
      ...this.uppers.map((u): [UpperFloor, Tag, Tag, ProjectFloor] => [u.scene, u.alarmTag, u.moneyTag, u.project]),
    ]
    // Today's spend from the cost book: dismissing an agent keeps it, midnight zeroes it.
    const today = this.state.ledgerToday
    const floorOfCwd = (cwd: string) => {
      const id = projectFor(this.state.settings.projects, cwd)?.id
      return id ? this.uppers.findIndex((u) => u.project.id === id) + 1 : 0
    }
    const spenders = Object.values(today.agents)
    floors.forEach(([scene, tag, moneyTag, project], n) => {
      const total = Object.entries(today.costByCwd).reduce((sum, [cwd, usd]) => (n === 0 || floorOfCwd(cwd) === n ? sum + usd : sum), 0)
      const top = spenders.filter((a) => n === 0 || floorOfCwd(a.cwd) === n).sort((a, b) => b.usd - a.usd).slice(0, 8)
      scene.money.set(total, top.map((a) => ({ name: a.name, usd: a.usd })))
      moneyTag.setName(`${money(total)} hoje`)
      moneyTag.el.title = top.filter((a) => a.usd >= 0.005).map((a) => `${a.name}: ${money(a.usd)}`).join('\n') || 'Ninguém gastou nada hoje'
      const pool = project ? accountPool(this.state.settings, project.cwd) : [...limited.keys()]
      const hit = pool.filter((id) => limited.has(id))
      scene.alarm.setOn(hit.length > 0)
      if (!hit.length) return
      const names = hit.map((id) => this.state.account(id)?.name ?? id).join(', ')
      const back = hit.map((id) => limited.get(id)).filter((t): t is number => !!t).sort((a, b) => a - b)[0]
      const clock = back ? ` · volta ${new Date(back).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''
      tag.setName(`${hit.length > 1 ? 'Contas' : 'Conta'} ${names} no limite${clock}`)
    })
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
  private showFloor(): void {
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
    this.uppers.forEach((u, i) => {
      u.alarmTag.hidden = view !== i + 1 || !u.scene.alarm.on
      u.moneyTag.hidden = view !== i + 1
    })
  }

  setPixelSize(n: number): void {
    this.engine.setPixelSize(n)
  }

  zoom(delta: number): void {
    this.engine.zoomStep(delta)
  }
}

/** Floor and desk an agent should be at; it changes when its folder moves to another floor. */
const seatKey = (a: AgentSummary) => `${a.project ?? ''}:${a.desk}`

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
