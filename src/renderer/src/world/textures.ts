import * as THREE from 'three'
import { H, W, ZONES, type FloorStyle } from './layout'

export const TILE_PX = 16

/** Small deterministic PRNG so the office looks the same on every launch. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  return [c, ctx]
}

export function pixelTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt))
  const b = Math.max(0, Math.min(255, (n & 255) + amt))
  return `rgb(${r},${g},${b})`
}

type Painter = (ctx: CanvasRenderingContext2D, x0: number, z0: number, w: number, h: number, r: () => number) => void

const planks =
  (base: string, alt: string, seam: string, alongX: boolean): Painter =>
  (ctx, x0, z0, w, h, r) => {
    const px0 = x0 * TILE_PX
    const pz0 = z0 * TILE_PX
    const pw = w * TILE_PX
    const ph = h * TILE_PX
    const plank = 4
    const rows = (alongX ? ph : pw) / plank
    for (let row = 0; row < rows; row++) {
      let pos = -Math.floor(r() * 40)
      const len = alongX ? pw : ph
      while (pos < len) {
        const l = 26 + Math.floor(r() * 30)
        const c = r() < 0.5 ? base : alt
        ctx.fillStyle = shade(c, Math.floor(r() * 10 - 5))
        const a = Math.max(pos, 0)
        const b = Math.min(pos + l, len)
        if (alongX) ctx.fillRect(px0 + a, pz0 + row * plank, b - a, plank)
        else ctx.fillRect(px0 + row * plank, pz0 + a, plank, b - a)
        ctx.fillStyle = seam
        if (alongX) {
          ctx.fillRect(px0 + a, pz0 + row * plank + plank - 1, b - a, 1)
          if (b < len) ctx.fillRect(px0 + b - 1, pz0 + row * plank, 1, plank)
        } else {
          ctx.fillRect(px0 + row * plank + plank - 1, pz0 + a, 1, b - a)
          if (b < len) ctx.fillRect(px0 + row * plank, pz0 + b - 1, plank, 1)
        }
        pos += l
      }
    }
  }

const carpet =
  (a: string, b: string, line: string): Painter =>
  (ctx, x0, z0, w, h, r) => {
    for (let x = x0; x < x0 + w; x++) {
      for (let z = z0; z < z0 + h; z++) {
        ctx.fillStyle = (x + z) % 2 ? a : b
        ctx.fillRect(x * TILE_PX, z * TILE_PX, TILE_PX, TILE_PX)
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = shade((x + z) % 2 ? a : b, r() < 0.5 ? -8 : 8)
          ctx.fillRect(x * TILE_PX + Math.floor(r() * TILE_PX), z * TILE_PX + Math.floor(r() * TILE_PX), 1, 1)
        }
        ctx.fillStyle = line
        ctx.fillRect(x * TILE_PX, z * TILE_PX, TILE_PX, 1)
        ctx.fillRect(x * TILE_PX, z * TILE_PX, 1, TILE_PX)
      }
    }
  }

const diamonds =
  (a: string, b: string): Painter =>
  (ctx, x0, z0, w, h) => {
    for (let x = x0; x < x0 + w; x++) {
      for (let z = z0; z < z0 + h; z++) {
        const px = x * TILE_PX
        const pz = z * TILE_PX
        ctx.fillStyle = a
        ctx.fillRect(px, pz, TILE_PX, TILE_PX)
        ctx.fillStyle = b
        for (let i = 0; i < 8; i++) {
          ctx.fillRect(px + 8 - i, pz + i, i * 2, 1)
          ctx.fillRect(px + 8 - i, pz + 15 - i, i * 2, 1)
        }
        ctx.fillStyle = shade(b, -14)
        ctx.fillRect(px + 7, pz + 7, 2, 2)
      }
    }
  }

const PAINTERS: Record<FloorStyle, Painter> = {
  hall: planks('#dcb98f', '#d3ad80', '#b48c62', true),
  boss: planks('#a8734d', '#9c6844', '#7a4f33', false),
  team: carpet('#8d96bd', '#868fb6', 'rgba(60,64,100,0.18)'),
  meeting: carpet('#7c83c6', '#767dbf', 'rgba(40,40,90,0.18)'),
  lounge: diamonds('#b7a5d8', '#ad9ad1'),
}

export function floorTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(W * TILE_PX, H * TILE_PX)
  const r = rng(7)
  PAINTERS.hall(ctx, 0, 0, W, H, r)
  for (const z of ZONES) {
    const [x0, z0, x1, z1] = z.rect
    PAINTERS[z.id](ctx, x0, z0, x1 - x0, z1 - z0, r)
    // soft border so zones read as separate areas
    ctx.fillStyle = 'rgba(40,30,60,0.22)'
    ctx.fillRect(x0 * TILE_PX, z0 * TILE_PX, (x1 - x0) * TILE_PX, 1)
    ctx.fillRect(x0 * TILE_PX, z0 * TILE_PX, 1, (z1 - z0) * TILE_PX)
    ctx.fillRect(x0 * TILE_PX, z1 * TILE_PX - 1, (x1 - x0) * TILE_PX, 1)
    ctx.fillRect(x1 * TILE_PX - 1, z0 * TILE_PX, 1, (z1 - z0) * TILE_PX)
  }
  return pixelTexture(c)
}

export function rugTexture(w: number, h: number, base: string, border: string, accent: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(w * TILE_PX, h * TILE_PX)
  ctx.fillStyle = border
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = base
  ctx.fillRect(3, 3, c.width - 6, c.height - 6)
  ctx.fillStyle = accent
  ctx.fillRect(6, 6, c.width - 12, 1)
  ctx.fillRect(6, c.height - 7, c.width - 12, 1)
  ctx.fillRect(6, 6, 1, c.height - 12)
  ctx.fillRect(c.width - 7, 6, 1, c.height - 12)
  for (let x = 12; x < c.width - 12; x += 10) {
    for (let y = 12; y < c.height - 12; y += 10) {
      ctx.fillRect(x, y + 2, 5, 1)
      ctx.fillRect(x + 2, y, 1, 5)
    }
  }
  return pixelTexture(c)
}

export function windowTexture(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(48, 32)
  const g = ctx.createLinearGradient(0, 0, 0, 32)
  g.addColorStop(0, '#7fc4f0')
  g.addColorStop(1, '#cdeafc')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 48, 32)
  const r = rng(seed)
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < 2; i++) {
    const cx = Math.floor(r() * 40)
    const cy = 3 + Math.floor(r() * 8)
    ctx.fillRect(cx, cy, 9, 2)
    ctx.fillRect(cx + 2, cy - 1, 5, 1)
  }
  // skyline
  let x = 0
  while (x < 48) {
    const bw = 4 + Math.floor(r() * 6)
    const bh = 6 + Math.floor(r() * 14)
    ctx.fillStyle = r() < 0.5 ? '#8aa4c4' : '#7b94b6'
    ctx.fillRect(x, 32 - bh, bw, bh)
    ctx.fillStyle = '#e8f3fb'
    for (let wy = 32 - bh + 2; wy < 31; wy += 3) for (let wx = x + 1; wx < x + bw - 1; wx += 2) if (r() < 0.4) ctx.fillRect(wx, wy, 1, 1)
    x += bw + 1
  }
  return pixelTexture(c)
}

export function booksTexture(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(32, 32)
  const r = rng(seed)
  const colors = ['#c0392b', '#2e86de', '#f6b93b', '#38ada9', '#8e44ad', '#e15f41', '#3dc1d3', '#f8efba', '#596275', '#78e08f']
  ctx.fillStyle = '#5a3d2b'
  ctx.fillRect(0, 0, 32, 32)
  for (let shelf = 0; shelf < 3; shelf++) {
    const y0 = shelf * 11 + 1
    let x = 1
    while (x < 31) {
      const bw = 2 + Math.floor(r() * 2)
      const bh = 6 + Math.floor(r() * 4)
      if (r() < 0.12) {
        x += bw
        continue
      }
      ctx.fillStyle = colors[Math.floor(r() * colors.length)]
      ctx.fillRect(x, y0 + 10 - bh, bw, bh)
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(x, y0 + 10 - bh + 2, bw, 1)
      x += bw
    }
    ctx.fillStyle = '#3e2a1d'
    ctx.fillRect(0, y0 + 10, 32, 1)
  }
  return pixelTexture(c)
}

export function artTexture(kind: 'mondrian' | 'mountains' | 'sunset' | 'plant'): THREE.CanvasTexture {
  const [c, ctx] = canvas(24, 18)
  if (kind === 'mondrian') {
    ctx.fillStyle = '#f5f1e6'
    ctx.fillRect(0, 0, 24, 18)
    ctx.fillStyle = '#d63031'
    ctx.fillRect(0, 0, 10, 9)
    ctx.fillStyle = '#0984e3'
    ctx.fillRect(16, 11, 8, 7)
    ctx.fillStyle = '#fdcb6e'
    ctx.fillRect(11, 14, 4, 4)
    ctx.fillStyle = '#1e1e24'
    ctx.fillRect(10, 0, 1, 18)
    ctx.fillRect(0, 9, 24, 1)
    ctx.fillRect(15, 9, 1, 9)
    ctx.fillRect(15, 13, 9, 1)
  } else if (kind === 'mountains') {
    const g = ctx.createLinearGradient(0, 0, 0, 18)
    g.addColorStop(0, '#9fd3f5')
    g.addColorStop(1, '#e9f6ff')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 24, 18)
    ctx.fillStyle = '#5f7f99'
    for (let x = 0; x < 24; x++) {
      const h = Math.max(0, 9 - Math.abs(x - 8)) + Math.max(0, 7 - Math.abs(x - 17))
      ctx.fillRect(x, 18 - h - 3, 1, h + 3)
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(7, 7, 3, 1)
    ctx.fillRect(16, 9, 3, 1)
    ctx.fillStyle = '#4c8c4a'
    ctx.fillRect(0, 15, 24, 3)
  } else if (kind === 'sunset') {
    const g = ctx.createLinearGradient(0, 0, 0, 18)
    g.addColorStop(0, '#6c5ce7')
    g.addColorStop(0.6, '#fd79a8')
    g.addColorStop(1, '#fdcb6e')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 24, 18)
    ctx.fillStyle = '#ffeaa7'
    ctx.fillRect(9, 9, 6, 6)
    ctx.fillStyle = '#2d3436'
    ctx.fillRect(0, 14, 24, 4)
  } else {
    ctx.fillStyle = '#f7f1e3'
    ctx.fillRect(0, 0, 24, 18)
    ctx.fillStyle = '#e17055'
    ctx.fillRect(9, 12, 6, 5)
    ctx.fillStyle = '#00b894'
    ctx.fillRect(11, 4, 2, 8)
    ctx.fillRect(7, 6, 4, 2)
    ctx.fillRect(13, 5, 4, 2)
    ctx.fillRect(8, 9, 3, 2)
  }
  return pixelTexture(c)
}

export function whiteboardTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(48, 28)
  ctx.fillStyle = '#fbfbfd'
  ctx.fillRect(0, 0, 48, 28)
  ctx.fillStyle = '#2e86de'
  ctx.fillRect(3, 3, 14, 1)
  ctx.fillRect(3, 6, 10, 1)
  ctx.fillRect(3, 9, 12, 1)
  ctx.fillStyle = '#e74c3c'
  ctx.fillRect(22, 4, 8, 6)
  ctx.fillStyle = '#fbfbfd'
  ctx.fillRect(23, 5, 6, 4)
  ctx.fillStyle = '#27ae60'
  const bars = [6, 10, 8, 14, 12]
  bars.forEach((b, i) => ctx.fillRect(34 + i * 2.5, 22 - b, 2, b))
  ctx.fillStyle = '#8e44ad'
  for (let x = 3; x < 28; x++) ctx.fillRect(x, 20 - Math.round(Math.sin(x / 3) * 3), 1, 1)
  ctx.fillStyle = '#f39c12'
  ctx.fillRect(4, 14, 6, 5)
  ctx.fillRect(12, 14, 6, 5)
  return pixelTexture(c)
}
