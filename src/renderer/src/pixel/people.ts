import { Aura, AURA_COLORS } from '../world/aura'
import type { Avatar } from '../world/avatar'
import { agentSheets, sprite } from './assets'
import { tinted } from './tint'
import type { Rect } from './engine'
import { artX, artY, bounds, ellipse, gather, paint } from './voxel'

// People in the 2D view: a character sheet from the catalog (4 x 3 poses of 48 x 64, see
// pixel-catalog.json) when there is one, else the 3D avatar itself drawn flat.

const CELL_W = 48
const CELL_H = 64
/** Where the soles sit in a cell. */
const FEET = 62
const QUARTER = Math.PI / 2

type Dir = 'down' | 'up' | 'side'

/** Facing (0 = +z, towards the viewer) as one of the sheet's views; left is the right view mirrored. */
function view(angle: number): { dir: Dir; mirror: boolean } {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle))
  if (Math.abs(a) <= Math.PI / 4) return { dir: 'down', mirror: false }
  if (Math.abs(a) >= (3 * Math.PI) / 4) return { dir: 'up', mirror: false }
  return { dir: 'side', mirror: a < 0 }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Recolorable sheets, one per hair style of the 3D avatar (Look.hairStyle 0-5). */
const HAIR_STYLES = 6

/**
 * The picture of this person's sheet. A recolorable template (molde-N) in the hair style of its
 * look, dressed in its colors: skin, hair, shirt (or the squad uniform), pants, shoes, like the 3D
 * avatar and the look picked in Configurações. Without templates: fixed sheets, the boss for the
 * player and an agent sheet picked by id (helpers share their parent's).
 */
function sheetOf(av: Avatar): CanvasImageSource | null {
  const style = ((av.look.hairStyle % HAIR_STYLES) + HAIR_STYLES) % HAIR_STYLES
  let key = `personagens/molde-${style}`
  let tpl = sprite(key)
  if (!tpl?.tint) {
    // a missing style borrows another template before giving up the look
    key = Array.from({ length: HAIR_STYLES }, (_, i) => `personagens/molde-${i}`).find((k) => sprite(k)?.tint) ?? ''
    tpl = key ? sprite(key) : null
  }
  if (tpl) {
    const l = av.look
    return tinted(key, tpl, { skin: l.skin, hair: l.hair, shirt: av.uniformColor ?? l.shirt, pants: l.pants, shoes: l.shoes })
  }
  if (av.id === 'player') return sprite('personagens/chefe')?.img ?? null
  const pool = agentSheets()
  return pool.length ? (sprite(pool[hash(av.id) % pool.length])?.img ?? null) : null
}

const seated = (av: Avatar) => av.pose === 'sit' || av.pose === 'type' || av.pose === 'relax'

/**
 * Draw order of a person among the furniture (bigger = later). Sitting with the back to the
 * viewer, the chair's backrest is in front; sitting towards the viewer, the person is in front
 * of the backrest.
 */
export function personKey(av: Avatar): number {
  const z = av.position.z
  if (av.isDown) return z + 0.3
  if (!seated(av) || av.stepping) return z + 0.05
  return view(av.facing).dir === 'up' ? z - 0.1 : z + 0.55
}

/** Sheet cell for what the avatar does now. */
function cell(av: Avatar, t: number): { col: number; row: number; mirror: boolean; dy: number } {
  if (av.isDown) return { col: 3, row: 2, mirror: false, dy: 0 }
  const { dir, mirror } = view(av.facing)
  const col = dir === 'down' ? 0 : dir === 'up' ? 1 : 2
  if (av.stepping) {
    // stride, pass, the other stride, pass: front and back views mirror their one stride frame
    const step = Math.floor(av.stride / QUARTER) & 3
    if (step % 2 === 1) return { col, row: 0, mirror, dy: -1 }
    if (dir === 'side') return { col: step === 0 ? 2 : 3, row: 1, mirror, dy: 0 }
    return { col, row: 1, mirror: step === 2 ? !mirror : mirror, dy: 0 }
  }
  if (seated(av)) {
    // typing hands bob the shoulders now and then
    const bob = av.pose === 'type' && Math.sin(t * 9) > 0.6 ? 1 : 0
    return { col, row: 2, mirror, dy: (dir === 'down' ? 7 : dir === 'up' ? 2 : 4) + bob }
  }
  if (av.pose === 'wave' && dir === 'down') return { col: 3, row: 0, mirror: false, dy: 0 }
  // breathing, and a little bounce while talking
  const talk = av.pose === 'talk' && Math.sin(t * 10) > 0 ? -1 : 0
  return { col, row: 0, mirror, dy: talk }
}

/** Draws one person; returns where, for clicks. */
export function drawPerson(ctx: CanvasRenderingContext2D, av: Avatar, t: number): Rect {
  const s = av.root.scale.x
  const fx = Math.round(artX(av.position.x))
  const fy = Math.round(artY(0, av.position.z))
  const sheet = sheetOf(av)

  const effort = av.effort
  const glow = effort ? AURA_COLORS[effort] : undefined
  if (glow) {
    // the effort aura: a flickering flame behind the body
    const k = Aura.reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 7 + fx)
    ctx.globalAlpha = 0.28
    ellipse(ctx, glow, fx, fy - 20 * s, 15 * s * k, 25 * s * k)
    ctx.globalAlpha = 0.4
    ellipse(ctx, glow, fx, fy - 16 * s, 10 * s, 18 * s * k)
    ctx.globalAlpha = 1
  }
  // soft shadow on the floor
  ctx.globalAlpha = 0.22
  ellipse(ctx, '#140f28', fx, fy - 1, (av.isDown ? 18 : 10) * s, 4 * s)
  ctx.globalAlpha = 1

  let rect: Rect
  if (sheet) {
    const c = cell(av, t)
    const w = Math.round(CELL_W * s)
    const h = Math.round(CELL_H * s)
    const shake = av.flinch > 0 ? Math.round(Math.sin(t * 60)) : 0
    const x = fx - Math.round(w / 2) + shake
    const y = fy - Math.round(FEET * s) + Math.round(c.dy * s)
    if (c.mirror) {
      ctx.save()
      ctx.translate(x + w, y)
      ctx.scale(-1, 1)
      ctx.drawImage(sheet, c.col * CELL_W, c.row * CELL_H, CELL_W, CELL_H, 0, 0, w, h)
      ctx.restore()
    } else ctx.drawImage(sheet, c.col * CELL_W, c.row * CELL_H, CELL_W, CELL_H, x, y, w, h)
    rect = { x0: x + 8 * s, y0: y + 10 * s, x1: x + w - 8 * s, y1: fy }
    drawCarry(ctx, av, fx, fy, s)
  } else {
    // no sheet yet: the 3D avatar itself, turned to the nearest of the four views
    const r = av.root.rotation.y
    av.root.rotation.y = Math.round(av.facing / QUARTER) * QUARTER
    av.root.updateMatrixWorld(true)
    const pieces = gather(av.root)
    paint(ctx, pieces)
    av.root.rotation.y = r
    const b = bounds(pieces)
    rect = b ?? { x0: fx - 8, y0: fy - 44, x1: fx + 8, y1: fy }
  }
  const gem = av.gemColor
  if (gem && sheet) drawGem(ctx, gem, fx, fy - Math.round(54 * s) + Math.round(Math.sin(t * 2.4) * 1.5))
  return rect
}

/** Papers or a mug in hand (the sheets have no hands free for them). */
function drawCarry(ctx: CanvasRenderingContext2D, av: Avatar, fx: number, fy: number, s: number): void {
  if (av.prop === 'none' || av.isDown) return
  const { dir, mirror } = view(av.facing)
  if (dir === 'up') return
  if (av.prop === 'mug') {
    const x = fx + (dir === 'side' ? (mirror ? -8 : 6) : 7) * s
    ctx.fillStyle = '#1c1830'
    ctx.fillRect(Math.round(x - 1), Math.round(fy - 23 * s), 5, 6)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(Math.round(x), Math.round(fy - 22 * s), 3, 4)
    return
  }
  const x = Math.round(fx + (dir === 'side' ? (mirror ? -12 : 4) : -5) * s)
  const y = Math.round(fy - 28 * s)
  ctx.fillStyle = '#1c1830'
  ctx.fillRect(x - 1, y - 1, 10, 12)
  ctx.fillStyle = av.prop === 'redPaper' ? '#ffecec' : '#fbfbf8'
  ctx.fillRect(x, y, 8, 10)
  ctx.fillStyle = av.prop === 'redPaper' ? '#e5484d' : '#20a464'
  ctx.fillRect(x, y, 8, 2)
  ctx.fillStyle = '#b2bec3'
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 1, y + 4 + i * 2, 5, 1)
}

/** The Sims-style diamond in the account's color, over the head. */
function drawGem(ctx: CanvasRenderingContext2D, color: string, cx: number, top: number): void {
  const rows = [1, 3, 5, 5, 3, 1]
  ctx.fillStyle = '#1c1830'
  rows.forEach((w, i) => ctx.fillRect(cx - (w + 2) / 2 + 0.5, top + i - 1, w + 2, 3))
  ctx.fillStyle = color
  rows.forEach((w, i) => ctx.fillRect(cx - w / 2 + 0.5, top + i, w, 1))
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.fillRect(cx - 1, top + 1, 1, 2)
}
