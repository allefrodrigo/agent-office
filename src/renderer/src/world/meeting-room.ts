import * as THREE from 'three'
import { meetingClock } from '@shared/meeting-map'
import * as F from './furniture'
import { box, panel } from './kit'
import type { MeetingRoom } from './layout'
import { animated } from './merge'
import type { Grid } from './pathfinding'
import { live, px } from './pixel-tag'
import { dashboardPainter, LoopScreen } from './screens'
import { rugTexture } from './textures'

/** What the room shows while a meeting records (RN-17): the elapsed time, frozen while paused. */
export interface MeetingRoomLive {
  /** Elapsed ms, read every TV frame. */
  elapsed(): number
  paused: boolean
}

/** A built meeting room: the tag's anchor, and the sign and TV that light up during a meeting. */
export interface MeetingRoomView {
  anchor: THREE.Object3D
  /** null: the sign goes back to "Sala de reunião" and the TV to its dashboard. */
  setLive(live: MeetingRoomLive | null): void
  readonly live: MeetingRoomLive | null
}

const SIGN_OFF = { bg: '#2f5d62', fg: '#ffffff' }
const SIGN_ON = { bg: '#c62835', fg: '#ffffff' }
const LAMP_OFF = '#4b5164'
const LAMP_ON = '#ff4d5e'

/** 3 x 5 pixel glyphs for the TV: digits, the colon and REC. */
const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001111',
  ':': '000010000010000',
  R: '110101110101101',
  E: '111100110100111',
  C: '111100100100111',
}

/** Width of a text in TV pixels at scale `s`: 3 per glyph (1 for the colon) plus 1 between. */
function textWidth(text: string, s: number): number {
  return [...text].reduce((w, ch, i) => w + (ch === ':' ? 1 : 3) * s + (i ? s : 0), 0)
}

function drawText(c: CanvasRenderingContext2D, text: string, x: number, y: number, s: number): void {
  let at = x
  for (const ch of text) {
    const g = GLYPHS[ch]
    if (!g) continue
    const narrow = ch === ':'
    for (let r = 0; r < 5; r++)
      for (let col = 0; col < 3; col++) {
        if (g[r * 3 + col] !== '1' || (narrow && col !== 1)) continue
        c.fillRect(at + (narrow ? 0 : col * s), y + r * s, s, s)
      }
    at += (narrow ? 1 : 3) * s + s
  }
}

/**
 * The TV during a meeting: the timer on top (in 2D the corridor glass covers the TV's lower
 * half) and REC with a blinking dot below it (two bars while paused).
 */
function timerPainter(state: () => MeetingRoomLive | null) {
  return (c: CanvasRenderingContext2D, t: number, w: number, h: number): void => {
    const now = state()
    if (!now) return dashboardPainter(c, t, w, h)
    c.fillStyle = '#1a1220'
    c.fillRect(0, 0, w, h)
    const top = 17
    const head = textWidth('REC', 1) + 6
    const hx = Math.floor((w - head) / 2)
    if (now.paused) {
      c.fillStyle = '#ffcb6b'
      c.fillRect(hx, top, 1, 5)
      c.fillRect(hx + 2, top, 1, 5)
    } else if (Math.floor(t * 2) % 2 === 0) {
      c.fillStyle = '#ff4d5e'
      c.fillRect(hx, top + 1, 3, 3)
    }
    c.fillStyle = now.paused ? '#ffcb6b' : '#ff8a94'
    drawText(c, 'REC', hx + 6, top, 1)
    const clock = meetingClock(now.elapsed())
    const s = textWidth(clock, 2) <= w - 4 ? 2 : 1
    c.fillStyle = '#ffffff'
    drawText(c, clock, Math.floor((w - textWidth(clock, s)) / 2), s === 2 ? 3 : 5, s)
  }
}

/** The sign over the door, with a lamp on top: "Sala de reunião", or red "EM REUNIÃO" while live. */
function liveSign(name: string, width = 2.2): { group: THREE.Group; set(on: boolean): void } {
  const g = animated(new THREE.Group())
  const c = document.createElement('canvas')
  c.width = Math.round(116 * width)
  c.height = 48
  const ctx = c.getContext('2d')!
  const tex = live(new THREE.CanvasTexture(c))
  tex.colorSpace = THREE.SRGBColorSpace
  const draw = (on: boolean) => {
    const { bg, fg } = on ? SIGN_ON : SIGN_OFF
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = fg
    ctx.font = 'bold 26px -apple-system, "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(on ? 'EM REUNIÃO' : name, c.width / 2, c.height / 2 + 1)
    tex.needsUpdate = true
  }
  draw(false)
  const h = (width * c.height) / c.width
  box(g, width + 0.08, h + 0.08, 0.04, '#5f5a8c', 0, -0.04, 0, false)
  panel(g, width, h, tex, 0, h / 2, 0.025)
  const lampMat = new THREE.MeshBasicMaterial({ color: LAMP_OFF, toneMapped: false })
  const lamp = box(g, 0.34, 0.1, 0.08, lampMat, 0, h + 0.1, 0.02, false)
  lamp.userData.live = true
  return {
    group: px(g, 'roomSign'),
    set(on) {
      draw(on)
      lampMat.color.set(on ? LAMP_ON : LAMP_OFF)
    },
  }
}

/**
 * The Sala de reunião (RN-14), upstairs in a front room and downstairs at the lounge's end:
 * rug, sign over the door, a long table with six chairs, the wall TV (LoopScreen) left of
 * the door and the whiteboard right of it. During a meeting (RN-17) the sign lights up
 * "EM REUNIÃO" and the TV shows the timer.
 */
export function meetingRoom(
  room: MeetingRoom,
  place: (o: THREE.Object3D, x: number, z: number, rot?: number, y?: number) => THREE.Object3D,
  grid: Grid,
  loops: LoopScreen[],
  accent: string,
  group: THREE.Group,
): MeetingRoomView {
  const [x0, z0, x1, z1] = room.rect
  const cx = (x0 + x1) / 2
  const { table } = room
  place(F.rug(x1 - x0 - 1, z1 - z0 - 1, rugTexture(x1 - x0 - 1, z1 - z0 - 1, '#e9eef0', '#8aa1ab', accent)), cx, (z0 + z1) / 2)
  // the table runs along z: built along x, turned a quarter
  place(F.meetingTable(table.d, table.w), table.x, table.z, Math.PI / 2)
  for (const s of room.seats) {
    const west = s.x < table.x
    place(F.simpleChair(west ? '#4f6d7a' : accent), s.x, s.z, west ? Math.PI / 2 : -Math.PI / 2)
  }
  // corridor wall: TV left of the door, sign over it, whiteboard to the right
  const sign = liveSign(room.name)
  place(sign.group, cx, z0 + 0.06, 0, 1.62)
  let state: MeetingRoomLive | null = null
  const tv = new LoopScreen(48, 26, timerPainter(() => state), 11)
  loops.push(tv)
  place(F.tv(tv.texture), x0 + 1.5, z0 + 0.06, 0, 1.55)
  place(F.whiteboard(1.6, 0.95), x1 - 1.5, z0 + 0.06, 0, 1.7)
  place(F.plant('tall'), x1 - 0.5, z1 - 0.5)
  place(F.plant('fern'), x0 + 0.5, z1 - 0.5)
  // the table and the plants take the tiles the plan says (tested in test/layout.test.ts)
  for (const [x, z] of room.blocked) grid.block(x, z)
  const anchor = new THREE.Object3D()
  anchor.position.set(...room.anchor)
  group.add(anchor)
  return {
    anchor,
    get live() {
      return state
    },
    setLive(next) {
      if (!!next !== !!state) sign.set(!!next)
      state = next
      // repaint now: the TV's next frame may be a while off
      tv.update(1)
    },
  }
}
