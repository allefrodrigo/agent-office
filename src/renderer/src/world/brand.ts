import * as THREE from 'three'
import type { ProjectFloor } from '@shared/types'
import { box, panel } from './kit'

/** The office orange, for floors without a brand color. */
export const DEFAULT_BRAND = '#d97757'

/** What a floor's company looks like: everything signs and uniforms need. */
export interface Brand {
  name: string
  color: string
  logo?: string
}

export function brandOf(p: ProjectFloor): Brand {
  return { name: p.name, color: p.brandColor ?? DEFAULT_BRAND, logo: p.logo }
}

const images = new Map<string, HTMLImageElement>()

/** The decoded logo, shared by every texture drawn from it. */
function logoImage(src: string): HTMLImageElement {
  let img = images.get(src)
  if (!img) {
    img = new Image()
    img.src = src
    images.set(src, img)
  }
  return img
}

/** Calls draw now and again once the image decodes, flagging the texture each time. */
function drawWhenReady(img: HTMLImageElement, tex: THREE.Texture, draw: () => void): void {
  draw()
  if (img.complete && img.naturalWidth) return
  img.addEventListener(
    'load',
    () => {
      draw()
      tex.needsUpdate = true
    },
    { once: true },
  )
}

/** Fits the image inside the box, centered, keeping its proportions. */
function fit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  if (!img.naturalWidth) return
  const k = Math.min(w / img.naturalWidth, h / img.naturalHeight)
  const iw = img.naturalWidth * k
  const ih = img.naturalHeight * k
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
}

const patches = new Map<string, THREE.CanvasTexture>()

/** The chest patch of a uniform: the logo on a white badge, one texture per logo. */
export function patchTexture(logo: string): THREE.CanvasTexture {
  let tex = patches.get(logo)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const img = logoImage(logo)
  drawWhenReady(img, tex, () => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 64, 64)
    fit(ctx, img, 6, 6, 52, 52)
  })
  patches.set(logo, tex)
  return tex
}

/** Light text on dark brands, dark text on light ones. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.62 ? '#1d1b26' : '#ffffff'
}

/**
 * The company sign (facing +z): logo on a white tile, then the name, on the brand
 * color. Without a logo it is just the name. Origin at the bottom center.
 */
export function brandSign(b: Brand, width = 2.6): THREE.Group {
  const g = new THREE.Group()
  const c = document.createElement('canvas')
  c.width = Math.round(116 * width)
  c.height = 64
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const img = b.logo ? logoImage(b.logo) : null
  const draw = () => {
    ctx.fillStyle = b.color
    ctx.fillRect(0, 0, c.width, c.height)
    let x = 14
    if (img) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(8, 6, 52, 52)
      fit(ctx, img, 11, 9, 46, 46)
      x = 70
    }
    ctx.fillStyle = inkOn(b.color)
    ctx.font = 'bold 26px -apple-system, "Segoe UI", sans-serif'
    ctx.textBaseline = 'middle'
    const room = c.width - x - 14
    let label = b.name
    while (ctx.measureText(label).width > room && label.length > 4) label = label.slice(0, -2) + '…'
    ctx.textAlign = img ? 'left' : 'center'
    ctx.fillText(label, img ? x : c.width / 2, c.height / 2 + 1)
  }
  if (img) drawWhenReady(img, tex, draw)
  else draw()
  const h = (width * c.height) / c.width
  box(g, width + 0.08, h + 0.08, 0.04, '#2d3142', 0, -0.04, 0, false)
  panel(g, width, h, tex, 0, h / 2, 0.025)
  return g
}
