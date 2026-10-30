import type { Look } from '@shared/types'
import { whenLoaded } from '../pixel/assets'
import { drawEyes } from '../pixel/eyes'
import { BUST, lookSheet } from '../pixel/look'

/**
 * Pixel-art bust of an avatar, scaled up with nearest-neighbour. In the 2D view it is cut from the
 * character's own sheet (head and shoulders of the front pose); before the sheets load, and in 3D,
 * it is the hand-drawn 16x16 one.
 */
export function portrait(look: Look, size = 32): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.className = 'portrait'
  c.style.width = `${size}px`
  c.style.height = `${size}px`
  c.style.background = look.shirt + '55'
  if (!document.body.classList.contains('view-2d') || !drawBust(c, look)) {
    drawSimple(c, look)
    if (document.body.classList.contains('view-2d')) whenLoaded(() => drawBust(c, look))
  }
  return c
}

/** The bust from the look's sheet; false when there is no sheet (yet). */
function drawBust(c: HTMLCanvasElement, look: Look): boolean {
  const sheet = lookSheet(look)
  if (!sheet) return false
  c.width = BUST.size
  c.height = BUST.size
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sheet.image, BUST.x, BUST.y, BUST.size, BUST.size, 0, 0, BUST.size, BUST.size)
  drawEyes(ctx, sheet.eyes, 0, -BUST.x, -BUST.y, 1)
  return true
}

function drawSimple(c: HTMLCanvasElement, look: Look): void {
  c.width = 16
  c.height = 16
  const ctx = c.getContext('2d')!
  const px = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(x, y, w, h)
  }
  // shoulders
  px(2, 13, 12, 3, look.shirt)
  px(6, 12, 4, 1, look.skin)
  // head
  px(4, 3, 8, 9, look.skin)
  px(3, 6, 1, 2, look.skin)
  px(12, 6, 1, 2, look.skin)
  // hair
  const hc = look.hair
  switch (look.hairStyle % 6) {
    case 2: // long
      px(3, 2, 10, 3, hc)
      px(3, 5, 1, 8, hc)
      px(12, 5, 1, 8, hc)
      break
    case 3: // bun
      px(3, 2, 10, 3, hc)
      px(6, 0, 4, 2, hc)
      break
    case 4: // pigtails
      px(3, 2, 10, 3, hc)
      px(1, 6, 2, 4, hc)
      px(13, 6, 2, 4, hc)
      break
    case 5: // afro
      px(2, 0, 12, 5, hc)
      px(2, 5, 2, 3, hc)
      px(12, 5, 2, 3, hc)
      break
    case 1: // spiky
      px(3, 2, 10, 3, hc)
      px(4, 1, 1, 1, hc)
      px(7, 0, 2, 2, hc)
      px(11, 1, 1, 1, hc)
      break
    default:
      px(3, 2, 10, 3, hc)
      px(3, 5, 1, 2, hc)
      px(12, 5, 1, 2, hc)
  }
  // face
  px(6, 7, 1, 2, '#1d1b26')
  px(9, 7, 1, 2, '#1d1b26')
  px(7, 10, 2, 1, 'rgba(0,0,0,0.35)')
  px(5, 9, 1, 1, '#f4a6a6')
  px(10, 9, 1, 1, '#f4a6a6')
}
