import { GROUND_FLOOR_ID, meetingClock, pickSeat } from '@shared/meeting-map'
import type { Avatar } from '../world/avatar'
import * as L from '../world/layout'
import type { MeetingRoomView } from '../world/meeting-room'
import { meetingElapsed, type MeetingLive } from '../meetings/live'
import { GameMovement } from './movement'
import { tileOf } from './types'

/**
 * The meeting on the map (RN-17): while a meeting records, the player walks to a free seat
 * of that floor's meeting room and sits; the room's sign lights up and its TV shows the timer.
 * When it ends the player goes back to where they were.
 */
export abstract class GameMeetings extends GameMovement {
  /** Floor number of a meeting floor id ('terreo' or ProjectFloor.id); -1 when that floor is gone. */
  protected meetingFloorIndex(floor: string): number {
    if (floor === GROUND_FLOOR_ID) return 0
    const i = this.uppers.findIndex((u) => u.project.id === floor)
    return i < 0 ? -1 : i + 1
  }

  /** Floor id ('terreo' or ProjectFloor.id) of the floor on screen. */
  get currentFloorId(): string {
    return this.currentProject?.id ?? GROUND_FLOOR_ID
  }

  private meetingPlan(n: number): L.MeetingRoom | undefined {
    return n === 0 ? L.GROUND_MEETING : this.upperOf(n)?.scene.plan.meeting
  }

  private meetingView(n: number): MeetingRoomView | undefined {
    return n === 0 ? this.office.meeting : this.upperOf(n)?.scene.meeting
  }

  /** The meeting started, paused, resumed or ended (meetings/live.ts). */
  setMeeting(live: MeetingLive | null): void {
    const was = this.meeting
    this.meeting = live
    this.syncMeetingRooms()
    const moved = !was || !live || was.floor !== live.floor || was.startedAt !== live.startedAt
    if (moved) {
      if (was && this.playerMeeting) this.leaveMeeting()
      if (live) this.joinMeeting(live.floor)
    }
    // agents that need you stop (or start) walking over
    for (const actor of this.actors.values()) this.reconcile(actor)
    this.wake(1500)
  }

  /** Signs, TVs and tags of every floor follow the meeting going on. */
  protected syncMeetingRooms(): void {
    const live = this.meeting
    const at = live ? this.meetingFloorIndex(live.floor) : -1
    const view = live ? { elapsed: () => meetingElapsed(live), paused: !!live.paused } : null
    for (let n = 0; n <= this.uppers.length; n++) {
      const room = this.meetingView(n)
      const on = n === at
      if (room && (on || room.live)) room.setLive(on ? view : null)
      const tag = n === 0 ? this.meetingTag : this.upperOf(n)?.meetingTag
      if (!on) tag?.setName('🎙 Sala de reunião')
      tag?.setDot(on ? 'meeting-live' : 'term')
    }
    this.tickMeeting()
  }

  /** The room's tag carries the timer too: the TV is only a few pixels wide when zoomed out. */
  protected tickMeeting(): void {
    const live = this.meeting
    if (!live) return
    const n = this.meetingFloorIndex(live.floor)
    const tag = n === 0 ? this.meetingTag : this.upperOf(n)?.meetingTag
    tag?.setName(`🎙 ${live.paused ? 'Reunião em pausa' : 'Em reunião'} · ${meetingClock(meetingElapsed(live))}`)
  }

  /** The player rides to the meeting's floor if needed and sits at the first free chair. */
  private joinMeeting(floor: string): void {
    const n = this.meetingFloorIndex(floor)
    const plan = n < 0 ? undefined : this.meetingPlan(n)
    if (!plan) return
    const p = this.player
    const back = { floor: p.floor, x: p.position.x, z: p.position.z, seated: this.playerSeated() }
    if (p.floor !== n) this.goFloor(n)
    const others: Avatar[] = [...this.actors.values()].map((a) => a.avatar)
    for (const h of this.helpers.values()) others.push(h.avatar)
    for (const m of this.members.values()) others.push(m.avatar)
    const occupied = others.filter((av) => av.floor === n).map((av) => ({ x: av.position.x, z: av.position.z }))
    const i = pickSeat(plan.seats, occupied)
    const seat = plan.seats[Math.max(0, i)]
    const trip = { floor, seat: { x: seat.x, z: seat.z }, back }
    this.playerMeeting = trip
    this.follow = true
    // every chair taken: stand by the first one
    this.route(p, seat.approach, i < 0 ? null : { x: seat.x, z: seat.z }, () => {
      if (this.playerMeeting !== trip) return
      p.faceTowards(seat.look[0], seat.look[1])
      if (i >= 0) {
        p.pose = 'sit'
        p.seatY = 0
      }
    })
  }

  /** The meeting ended: back to where the player was, unless they already walked off on their own. */
  private leaveMeeting(): void {
    const trip = this.playerMeeting
    this.playerMeeting = null
    if (!trip) return
    const n = this.meetingFloorIndex(trip.floor)
    const p = this.player
    const plan = n < 0 ? undefined : this.meetingPlan(n)
    if (!plan || p.floor !== n) return
    const [x0, z0, x1, z1] = plan.rect
    if (p.position.x < x0 || p.position.x > x1 || p.position.z < z0 || p.position.z > z1) return
    p.pose = 'stand'
    p.seatY = 0
    const { back } = trip
    if (back.floor !== p.floor) {
      if (back.floor > this.uppers.length) return
      this.goFloor(back.floor)
    }
    if (back.seated && back.floor === 0) return this.walkPlayerTo([4, 2])
    const tile = tileOf(p.position.clone().set(back.x, 0, back.z))
    this.follow = true
    this.route(p, tile, { x: back.x, z: back.z }, () => undefined)
  }
}
