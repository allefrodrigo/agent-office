import { Aura, AURA_COLORS } from '../world/aura'
import type { Avatar } from '../world/avatar'
import type { Rect } from './engine'
import { blinking } from './eyes'
import { figureFrame, FOOT, FRAME, type Pose } from './figure'
import { figureOfLook, type Figure } from './habbo-catalog'
import { avatarDirection, avatarImage } from './habbo'
import { bounds, ellipse, gather, isoX, isoY, paint } from './voxel'

// People in the 2D view: Habbo avatars assembled part by part (pixel/figure.ts) in each look's
// colors, turned to the nearest of 8 directions, with the client's own animations: walking,
// sitting, lying, waving, carrying, talking and blinking. While the clothing libraries load,
// the Imager's standing picture stands in; without network, the 3D avatar drawn flat.

/** Size of an Imager avatar, and where its soles sit. */
const AV_W = 64
const AV_H = 110
const FEET = 104
/** How far up a seated avatar sits: the chair's seat. */
const SEAT = 12

const seated = (av: Avatar) => av.pose === 'sit' || av.pose === 'type' || av.pose === 'relax'

/** Facing away from the viewer (Habbo directions 7, 0, 1 and 6): the chair's back covers the body. */
const away = (dir: number) => dir === 7 || dir === 0 || dir === 1 || dir === 6

/** Draw order of a person among the furniture (bigger = later), on the same scale as voxel.depthOf. */
export function personKey(av: Avatar): number {
  const d = av.position.x + av.position.z
  if (av.isDown) return d + 0.3
  if (!seated(av) || av.stepping) return d + 0.05
  return away(avatarDirection(av.facing)) ? d - 0.2 : d + 0.4
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const lookFigure = (av: Avatar): Figure => figureOfLook(av.look, av.uniformColor ?? av.look.shirt)

/**
 * Direction and pose of the avatar now. Habbo sits and lies only on the diagonals (0, 2, 4, 6),
 * so a seated avatar turns to the nearest one, and one lying down to 2 or 4.
 */
function poseOf(av: Avatar, t: number): { dir: number; pose: Pose } {
  let dir = avatarDirection(av.facing)
  const blink = blinking(t, hash(av.id))
  if (av.isDown) return { dir: dir >= 4 ? 4 : 2, pose: { posture: 'lay', frame: 0 } }
  if (av.stepping) {
    const pose: Pose = { posture: 'wlk', frame: Math.floor(av.stride / (Math.PI / 2)) & 3, blink }
    if (av.prop !== 'none') pose.arms = 'crr'
    return { dir, pose }
  }
  const pose: Pose = { posture: seated(av) ? 'sit' : 'std', frame: 0, blink }
  if (pose.posture === 'sit' && dir % 2 === 1) dir = (dir + 7) % 8
  if (av.pose === 'wave') {
    pose.arms = 'wav'
    pose.armFrame = Math.floor(t * 5) % 2
  } else if (av.prop !== 'none') pose.arms = 'crr'
  if (av.pose === 'talk') pose.talk = Math.floor(t * 7) % 2
  return { dir, pose }
}

/** The Imager's standing picture of this person ('loading' until it arrives, null if it failed). */
function standingOf(av: Avatar, direction: number): HTMLImageElement | 'loading' | null {
  return avatarImage(lookFigure(av).figure, direction)
}

/** Draws one person; returns where, for clicks. */
export function drawPerson(ctx: CanvasRenderingContext2D, av: Avatar, t: number): Rect {
  const s = av.root.scale.x
  const fx = Math.round(isoX(av.position.x, av.position.z))
  const fy = Math.round(isoY(av.position.x, 0, av.position.z))
  const { dir, pose } = poseOf(av, t)
  const frame = figureFrame(lookFigure(av), dir, pose)

  const effort = av.effort
  const glow = effort ? AURA_COLORS[effort] : undefined
  if (glow) {
    // the effort aura: a flickering flame behind the body
    const k = Aura.reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 7 + fx)
    ctx.globalAlpha = 0.28
    ellipse(ctx, glow, fx, fy - 36 * s, 22 * s * k, 42 * s * k)
    ctx.globalAlpha = 0.4
    ellipse(ctx, glow, fx, fy - 30 * s, 14 * s, 30 * s * k)
    ctx.globalAlpha = 1
  }
  // the Habbo shadow: a flat dark ellipse under the feet
  ctx.globalAlpha = 0.25
  ellipse(ctx, '#000000', fx, fy, (av.isDown ? 26 : 15) * s, 6 * s)
  ctx.globalAlpha = 1

  const shake = av.flinch > 0 ? Math.round(Math.sin(t * 60) * 2) : 0
  const lift = pose.posture === 'sit' ? SEAT : 0
  let rect: Rect
  if (frame) {
    // the assembled avatar, its feet on the floor point (on the seat when sitting)
    const x = fx - Math.round(FOOT.x * s) + shake
    const y = fy - Math.round((FOOT.y + lift) * s)
    ctx.drawImage(frame, x, y, Math.round(FRAME.w * s), Math.round(FRAME.h * s))
    rect =
      pose.posture === 'lay'
        ? { x0: fx - 45 * s, y0: fy - 40 * s, x1: fx + 45 * s, y1: fy + 4 }
        : { x0: fx - 15 * s, y0: fy - (88 + lift - (pose.posture === 'sit' ? 16 : 0)) * s, x1: fx + 15 * s, y1: fy }
  } else {
    const img = standingOf(av, dir)
    if (img === 'loading') return { x0: fx - 16 * s, y0: fy - 80 * s, x1: fx + 16 * s, y1: fy }
    if (!img) {
      // HabboAssets out of reach (offline): the 3D avatar itself
      av.root.updateMatrixWorld(true)
      const pieces = gather(av.root)
      paint(ctx, pieces)
      return bounds(pieces) ?? { x0: fx - 10, y0: fy - 60, x1: fx + 10, y1: fy }
    }
    // the libraries are still on their way: the Imager's standing picture
    const w = Math.round(AV_W * s)
    const x = fx - Math.round(w / 2) + shake
    const y = fy - Math.round((FEET + lift) * s)
    ctx.drawImage(img, x, y, w, Math.round(AV_H * s))
    rect = { x0: x + 16 * s, y0: y + 36 * s, x1: x + w - 16 * s, y1: fy }
  }
  if (!av.isDown) drawCarry(ctx, av, dir, fx, fy - lift * s, s, pose.posture === 'sit')
  const gem = av.gemColor
  if (gem)
    drawGem(
      ctx,
      gem,
      fx,
      fy -
        Math.round((pose.posture === 'sit' ? 84 + lift : pose.posture === 'lay' ? 40 : 100) * s) +
        Math.round(Math.sin(t * 2.4 + hash(av.id)) * 1.5),
    )
  return rect
}

/**
 * The person standing towards the viewer, alone on a 64 x 110 canvas (CSS scales it up,
 * pixelated): the avatar of the reading screen, waving when `wave`. Drawn as soon as its
 * libraries (or the Imager's picture) arrive.
 */
export function figureOf(av: Avatar, wave = false): HTMLCanvasElement | null {
  const c = document.createElement('canvas')
  c.width = AV_W
  c.height = AV_H
  c.className = 'figure'
  const ctx = c.getContext('2d')!
  const dir = wave ? 2 : 3
  const draw = () => {
    const frame = figureFrame(lookFigure(av), dir, wave ? { posture: 'std', frame: 0, arms: 'wav' } : { posture: 'std', frame: 0 })
    if (frame) {
      ctx.clearRect(0, 0, AV_W, AV_H)
      ctx.drawImage(frame, AV_W / 2 - FOOT.x, FEET - FOOT.y)
      return true
    }
    const img = standingOf(av, dir)
    if (!img || img === 'loading') return false
    ctx.clearRect(0, 0, AV_W, AV_H)
    ctx.drawImage(img, 0, 0)
    return false
  }
  if (!draw()) {
    let tries = 0
    const timer = setInterval(() => {
      if (draw() || ++tries > 40 || !c.isConnected) clearInterval(timer)
    }, 500)
  }
  return c
}

/** Papers or a mug in hand (the client draws hand items from another library). */
function drawCarry(ctx: CanvasRenderingContext2D, av: Avatar, dir: number, fx: number, fy: number, s: number, sitting: boolean): void {
  if (av.prop === 'none' || away(dir)) return
  // in the right hand, raised to carry (the client's crr pose)
  const side = dir >= 4 ? -1 : 1
  const hand = sitting ? 40 : 52
  if (av.prop === 'mug') {
    const x = Math.round(fx + side * 12 * s)
    const y = Math.round(fy - hand * s)
    ctx.fillStyle = '#1c1830'
    ctx.fillRect(x - 3, y - 1, 7, 8)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x - 2, y, 5, 6)
    return
  }
  const x = Math.round(fx + side * 10 * s - 5)
  const y = Math.round(fy - (hand + 6) * s)
  ctx.fillStyle = '#1c1830'
  ctx.fillRect(x - 1, y - 1, 12, 14)
  ctx.fillStyle = av.prop === 'redPaper' ? '#ffecec' : '#fbfbf8'
  ctx.fillRect(x, y, 10, 12)
  ctx.fillStyle = av.prop === 'redPaper' ? '#e5484d' : '#20a464'
  ctx.fillRect(x, y, 10, 2)
  ctx.fillStyle = '#b2bec3'
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 1, y + 4 + i * 2, 7, 1)
}

/** The Sims-style diamond in the account's color, over the head. */
function drawGem(ctx: CanvasRenderingContext2D, color: string, cx: number, top: number): void {
  const rows = [1, 3, 5, 7, 7, 5, 3, 1]
  ctx.fillStyle = '#1c1830'
  rows.forEach((w, i) => ctx.fillRect(cx - (w + 2) / 2 + 0.5, top + i - 1, w + 2, 3))
  ctx.fillStyle = color
  rows.forEach((w, i) => ctx.fillRect(cx - w / 2 + 0.5, top + i, w, 1))
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillRect(cx - 1, top + 1, 1, 2)
}
