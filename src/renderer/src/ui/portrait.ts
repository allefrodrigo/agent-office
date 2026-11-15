import { hairShape } from '@shared/describe'
import type { Look } from '@shared/types'
import { CELL, dressLook, onPeopleArt } from '../pixel/people'

/** The bust: a square of the front pose, from just above the head down to the chest. */
const BUST = 44

/**
 * Pixel-art bust of an avatar, scaled up with nearest-neighbour: head and shoulders cut from the
 * look's own 2D sheet (pixel/people.ts). Until the sheets load it is the hand-drawn 16x16 one.
 */
export function portrait(look: Look, size = 32): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.className = 'portrait'
  c.style.width = `${size}px`
  c.style.height = `${size}px`
  c.style.background = look.shirt + '55'
  if (!drawBust(c, look)) {
    drawSimple(c, look)
    const off = onPeopleArt(() => {
      if (drawBust(c, look)) off()
    })
  }
  return c
}

/** The bust from the look's sheet; false when the sheets are not in (yet). */
function drawBust(c: HTMLCanvasElement, look: Look): boolean {
  const sheet = dressLook(look)
  if (!sheet) return false
  const top = sheet.tops[CELL.front]
  c.width = BUST
  c.height = BUST
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  // the front cell is the first one: x 0-63, y 0-99
  ctx.drawImage(sheet.image, 32 - BUST / 2, Math.max(0, top - 2), BUST, BUST, 0, 0, BUST, BUST)
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
  switch (hairShape(look.hairStyle)) {
    case null: // bald
      break
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
