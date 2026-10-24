import * as THREE from 'three'
import type { AgentSummary } from '@shared/types'
import type { State } from '../state'
import { Avatar, type Uniform } from '../world/avatar'
import { Engine } from '../world/engine'
import * as L from '../world/layout'
import { setMerging } from '../world/merge'
import { px } from '../world/pixel-tag'
import type { Viewport } from '../world/viewport'
import { PixelEngine } from '../pixel/engine'
import { adaptGround } from '../pixel/layout2d'
import { buildOffice, type GroundFloor, type Office } from '../world/office'
import { Overlays, Tag } from '../world/overlays'
import { Effects } from '../world/effects'
import { FACE_CAMERA, skeleton } from '../world/skull'
import { center, OVERFLOW_TILES, SKULL_HOME, tileOf, type Actor, type GameHooks, type Helper, type Member, type Upper } from './types'

/**
 * State shared by every part of the office (game/*.ts), the floor lookups and the
 * walking primitives. Each part extends the previous one; Game (index.ts) is the last.
 */
export abstract class GameBase {
  readonly engine: Viewport
  /** Drawn by the 2D pixel-art view (Configurações → Vídeo → Visual) instead of the 3D one. */
  protected readonly flat: boolean
  /** Ground floor. */
  readonly office: GroundFloor
  /** Project floors, 1º andar first. */
  protected uppers: Upper[] = []
  protected uppersKey = ''
  protected members = new Map<string, Member>()
  protected pcTag: Tag
  /** Over the ground floor alarm. */
  protected alarmTag: Tag
  /** Over the ground floor spending board. */
  protected moneyTag: Tag
  /** "Rotinas" over the routines board in your office. */
  protected routinesTag: Tag
  /** Over the copa's espresso machine: the café corner. */
  protected coffeeTag: Tag
  /** Seconds until the boards and alarms are checked again (limits expire on their own). */
  protected boardsIn = 0
  readonly overlays: Overlays
  readonly player: Avatar
  protected playerTag: Tag
  protected actors = new Map<string, Actor>()
  protected helpers = new Map<string, Helper>()
  protected keys = new Set<string>()
  protected follow = true
  /** Agent the camera tracks until it settles (sits or stops); `until` drops it if it never shows up. */
  protected watch: { id: string; until: number } | null = null
  protected hover: THREE.LineSegments
  protected time = 0
  protected nearId: string | null = null
  protected recheck = 0
  protected dragging: { x: number; y: number; moved: boolean; button: number } | null = null
  protected wheelAcc = 0
  protected effects: Effects
  protected skull: { root: THREE.Group; tag: Tag; eyes: THREE.MeshBasicMaterial }
  /** Seconds until the routines boards are worked out again (at most once a second). */
  protected routinesIn = 0
  /** Agents picked at the skull, waiting for the camera (or the elevator) before the strike. */
  protected doomed = new Map<string, { at: number; done: () => void }>()
  /** performance.now() until which the scene draws at full rate even if nothing walks (input, events). */
  protected wakeUntil = 0
  protected reducedEffects = false

  constructor(
    container: HTMLElement,
    overlayRoot: HTMLElement,
    protected state: State,
    protected hooks: GameHooks,
  ) {
    this.flat = state.settings.video?.view === '2d'
    // in 2D nothing reaches the GPU: no merging, and the painter reads each piece on its own
    setMerging(!this.flat)
    this.engine = this.flat ? new PixelEngine(container) : new Engine(container, state.settings.pixelSize)
    this.office = buildOffice()
    if (this.flat) adaptGround(this.office)
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
    px(sk.group, 'skeleton')
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
    this.routinesTag = this.routinesTagFor(this.office.routines)
    this.coffeeTag = this.overlays.add(new Tag(this.office.coffee.anchor, 'Café', false, () => hooks.onCoffee()))
    this.coffeeTag.el.classList.add('tag-coffee')
    this.coffeeTag.setDot('coffee-off')
  }

  /** Orchestrators of a floor by Diretoria desk. */
  protected directorsOn(floor: number): Map<number, AgentSummary> {
    const out = new Map<number, AgentSummary>()
    for (const a of this.state.agents.values()) if (a.role === 'orchestrator' && this.homeFloor(a) === floor) out.set(a.desk, a)
    return out
  }

  protected screenFor(a: AgentSummary) {
    return this.deskOf(a) ? this.floorOf(this.homeFloor(a)).deskScreens[a.desk] : undefined
  }

  protected deskOf(a: AgentSummary): L.DeskSlot | undefined {
    if (a.role === 'orchestrator') return undefined
    const up = this.upperOf(this.homeFloor(a))
    return up ? up.scene.plan.teamDesks[a.desk] : L.DESKS[a.desk]
  }

  /** Floor an agent works on: its project's floor, or the ground floor. */
  protected homeFloor(a: AgentSummary): number {
    return a.project ? this.uppers.findIndex((u) => u.project.id === a.project) + 1 : 0
  }

  protected upperOf(n: number): Upper | undefined {
    return n > 0 ? this.uppers[n - 1] : undefined
  }

  protected directorDesk(a: AgentSummary): L.DirectorDesk | undefined {
    return a.role === 'orchestrator' ? this.upperOf(this.homeFloor(a))?.scene.plan.directors[a.desk] : undefined
  }

  floorOf(n: number): Office {
    return this.upperOf(n)?.scene ?? this.office
  }

  /** Where an agent stands when every desk of its floor is taken. */
  protected overflowTile(a: AgentSummary, floor: number): [number, number] {
    const plan = this.upperOf(floor)?.scene.plan
    if (!plan || a.role === 'orchestrator') return OVERFLOW_TILES[a.desk % OVERFLOW_TILES.length]
    return plan.teamStand[(a.desk - plan.teamDesks.length) % plan.teamStand.length] ?? L.SPAWN_TILE
  }

  protected playerInBossRoom(): boolean {
    return this.player.floor === 0 && L.inBossRoom(this.player.position.x, this.player.position.z)
  }

  protected route(av: Avatar, tile: [number, number], final: { x: number; z: number } | null, onArrive: () => void): void {
    const [sx, sz] = tileOf(av.position)
    const path = this.floorOf(av.floor).grid.findPath(sx, sz, tile[0], tile[1])
    const points = (path ?? []).map(center)
    if (!path) points.push(center(tile)) // unreachable: walk straight there rather than freeze
    if (final) points.push(final)
    av.walk(points, onArrive)
  }

  /** Player is sitting in the boss chair; visitors line up in front of the desk. */
  protected playerSeated(): boolean {
    const p = this.player.position
    return this.player.floor === 0 && this.player.pose === 'sit' && Math.hypot(p.x - L.BOSS_SEAT.x, p.z - L.BOSS_SEAT.z) < 0.3
  }

  protected sitPlayer(): void {
    this.player.placeAt(L.BOSS_SEAT.x, L.BOSS_SEAT.z)
    this.player.face(0)
    this.player.pose = 'sit'
  }

  /** Draw at full rate for the next `ms` (AO-29): input, a state change, a ding. */
  wake(ms = 400): void {
    this.wakeUntil = Math.max(this.wakeUntil, performance.now() + ms)
  }

  /** The elevator rings on a floor; its doors animate, so the scene wakes up. */
  protected ding(floor: number): void {
    this.floorOf(floor).ding()
    if (floor === this.player.floor) this.wake(1500)
  }

  protected alarmTagFor(alarm: { anchor: THREE.Object3D }): Tag {
    const tag = this.overlays.add(new Tag(alarm.anchor, ''))
    tag.el.classList.add('tag-alarm')
    tag.setDot('error')
    tag.hidden = true
    return tag
  }

  protected moneyTagFor(board: { anchor: THREE.Object3D }): Tag {
    const tag = this.overlays.add(new Tag(board.anchor, ''))
    tag.el.classList.add('tag-money')
    tag.setDot('money')
    tag.hidden = true
    return tag
  }

  /** Its dot is the board's LED, its balloon the next routine in words. */
  protected routinesTagFor(board: { anchor: THREE.Object3D }): Tag {
    const tag = this.overlays.add(new Tag(board.anchor, 'Rotinas', false, () => this.hooks.onRoutines()))
    tag.el.classList.add('tag-routines')
    tag.setDot('routine-none')
    return tag
  }

  // ---------- implemented by the later parts ----------
  protected abstract syncHelpers(): void
  protected abstract syncMembers(): void
  protected abstract syncBoards(): void
  protected abstract reconcile(actor: Actor, instant?: boolean): void
  protected abstract resting(a: AgentSummary): boolean
  protected abstract uniformFor(a: AgentSummary): Uniform | null
  protected abstract dress(avatar: Avatar, a: AgentSummary): void
  protected abstract goBoss(actor: Actor, instant: boolean): void
  protected abstract goHang(actor: Actor, instant: boolean): void
  protected abstract bubble(actor: Actor, a: AgentSummary): void
  protected abstract memberGone(m: Member): void
  abstract focusAgent(agentId: string): void
}
