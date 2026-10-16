import type * as THREE from 'three'
import type { ProjectFloor, SquadMember, SubagentInfo, AgentSummary } from '@shared/types'
import type { Avatar } from '../world/avatar'
import * as L from '../world/layout'
import type { Tag, BubbleKind } from '../world/overlays'
import type { UpperFloor } from '../world/upper-floor'
import type { ScreenMode } from '../world/screens'

export type Goal = 'desk' | 'boss' | 'hang' | 'leave' | 'chat'

export interface Actor {
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
export interface Upper {
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
  /** "Rotinas" over the Diretoria's routines board. */
  routinesTag: Tag
}

/** A subagent shown as a small copy of its parent, standing by the parent's desk. */
export interface Helper {
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
export interface Member {
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
  /** Player clicked an agent (avatar or tag); `helperId` when it was one of its subagents, to open that one's log. */
  onAgentClick(agentId: string, helperId?: string): void
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
  /** Player clicked the routines board (your office or a Diretoria). */
  onRoutines(): void
  /** Player clicked the copa's espresso machine: the café corner (keep the screen awake). */
  onCoffee(): void
}

/** Floor spot by the boss office where the skeleton stands. */
export const SKULL_HOME = { x: 2.5, y: 0, z: 12.3 }
/** Seconds the camera gets to reach a dismissed agent before the skull drops. */
export const STRIKE_AFTER_S = 0.6
/** An idle agent waits at its desk this long before wandering off to the lounge. */
export const LOUNGE_AFTER_MS = 3 * 60_000

export const HELPER_SCALE = 0.62
/** Subagents can finish in a few seconds; keep each helper on screen at least this long. */
export const HELPER_MIN_S = 4
export const HELPER_BYE_S = 1.2

export const SPAWN_POINT = { x: L.ELEVATOR.x, z: 0.45 }
/** Seconds inside the elevator between floors. */
export const RIDE_S = 1.1
/** Squad people walk briskly between sectors, the Diretoria and the elevator. */
export const SQUAD_SPEED = 4.4
/** A member that finishes in a few seconds still gets to sit down for a moment. */
export const MEMBER_MIN_S = 5
/** Whatever happens, a member leaves the floor this long after its work ends. */
export const MEMBER_EXIT_S = 40
export const OVERFLOW_TILES: [number, number][] = [
  [29, 9], [30, 9], [29, 10], [30, 10], [28, 9], [28, 10], [31, 9], [31, 10],
]
export const center = ([x, z]: [number, number]) => ({ x: x + 0.5, z: z + 0.5 })
export const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1) + '…' : text)
export type Point = { x: number; y: number }
export const tileOf = (p: THREE.Vector3): [number, number] => [Math.floor(p.x), Math.floor(p.z)]

/** Floor and desk an agent should be at; it changes when its folder moves to another floor. */
export const seatKey = (a: AgentSummary) => `${a.project ?? ''}:${a.desk}`

export function screenMode(a: AgentSummary): ScreenMode {
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
