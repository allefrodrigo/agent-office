import * as THREE from 'three'
import { canvas, pixelTexture } from './textures'

export type ScreenMode = 'off' | 'boot' | 'working' | 'waiting' | 'done' | 'error' | 'idle'

const CODE_COLORS = ['#82aaff', '#c792ea', '#c3e88d', '#ffcb6b', '#89ddff', '#f78c6c', '#d0d6f0']
/** Desk status light: green free, red busy, amber waiting on you. */
const LED: Record<ScreenMode, string> = {
  off: '#3a3d4d',
  boot: '#ef5b5b',
  working: '#ef5b5b',
  waiting: '#f5a524',
  done: '#3ecf8e',
  idle: '#3ecf8e',
  error: '#ef5b5b',
}

const SW = 40
const SH = 24

/** A tiny pixel-art computer screen that reflects what its agent is doing. */
export class Screen {
  readonly texture: THREE.CanvasTexture
  /** The desk totem's light, colored by mode. */
  readonly led = new THREE.MeshBasicMaterial({ color: LED.off })
  private ctx: CanvasRenderingContext2D
  private mode: ScreenMode = 'off'
  private lines: { indent: number; len: number; color: string }[] = []
  private t = 0
  private tick = 0
  private dirty = true

  constructor() {
    const [c, ctx] = canvas(SW, SH)
    this.ctx = ctx
    this.texture = pixelTexture(c)
    for (let i = 0; i < 8; i++) this.lines.push(randomLine())
    this.draw()
  }

  setMode(mode: ScreenMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.led.color.set(LED[mode])
    this.dirty = true
  }

  update(dt: number): void {
    this.t += dt
    const interval = this.mode === 'working' ? 0.18 : this.mode === 'off' ? 999 : 0.5
    if (this.t - this.tick < interval && !this.dirty) return
    this.tick = this.t
    if (this.mode === 'working') {
      this.lines.push(randomLine())
      if (this.lines.length > 8) this.lines.shift()
    }
    this.draw()
    this.dirty = false
  }

  private draw(): void {
    const c = this.ctx
    const blink = Math.floor(this.t * 2) % 2 === 0
    switch (this.mode) {
      case 'off':
        c.fillStyle = '#14161f'
        c.fillRect(0, 0, SW, SH)
        c.fillStyle = '#23263a'
        c.fillRect(2, 2, 8, 1)
        break
      case 'boot':
        c.fillStyle = '#1b1e2c'
        c.fillRect(0, 0, SW, SH)
        c.fillStyle = '#d97757'
        drawStar(c, SW / 2, SH / 2 - 1, blink)
        c.fillStyle = '#5b6078'
        c.fillRect(12, SH - 5, 16, 1)
        c.fillStyle = '#d97757'
        c.fillRect(12, SH - 5, Math.floor((this.t * 6) % 16), 1)
        break
      case 'working': {
        c.fillStyle = '#1e2233'
        c.fillRect(0, 0, SW, SH)
        c.fillStyle = '#2b3048'
        c.fillRect(0, 0, SW, 3)
        c.fillStyle = '#ff5f57'
        c.fillRect(1, 1, 1, 1)
        c.fillStyle = '#febc2e'
        c.fillRect(3, 1, 1, 1)
        c.fillStyle = '#28c840'
        c.fillRect(5, 1, 1, 1)
        this.lines.forEach((l, i) => {
          c.fillStyle = '#3a4060'
          c.fillRect(1, 4 + i * 2 + 1, 2, 1)
          c.fillStyle = l.color
          c.fillRect(4 + l.indent * 2, 4 + i * 2 + 1, l.len, 1)
        })
        if (blink) {
          c.fillStyle = '#ffffff'
          const last = this.lines[this.lines.length - 1]
          c.fillRect(Math.min(SW - 2, 5 + last.indent * 2 + last.len), 4 + 7 * 2 + 1, 1, 1)
        }
        break
      }
      case 'waiting':
        c.fillStyle = blink ? '#f5a524' : '#d48806'
        c.fillRect(0, 0, SW, SH)
        c.fillStyle = '#2b1d00'
        c.fillRect(SW / 2 - 1, 5, 3, 9)
        c.fillRect(SW / 2 - 1, 16, 3, 3)
        break
      case 'done':
        c.fillStyle = '#20a464'
        c.fillRect(0, 0, SW, SH)
        c.fillStyle = '#ffffff'
        for (let i = 0; i < 4; i++) c.fillRect(13 + i, 11 + i, 2, 2)
        for (let i = 0; i < 9; i++) c.fillRect(17 + i, 14 - i, 2, 2)
        break
      case 'error':
        c.fillStyle = blink ? '#e5484d' : '#c43a3f'
        c.fillRect(0, 0, SW, SH)
        c.fillStyle = '#ffffff'
        for (let i = 0; i < 10; i++) {
          c.fillRect(15 + i, 7 + i, 2, 2)
          c.fillRect(24 - i, 7 + i, 2, 2)
        }
        break
      case 'idle': {
        c.fillStyle = '#151827'
        c.fillRect(0, 0, SW, SH)
        const x = Math.floor((Math.sin(this.t * 0.7) * 0.5 + 0.5) * (SW - 8))
        const y = Math.floor((Math.cos(this.t * 0.53) * 0.5 + 0.5) * (SH - 8))
        c.fillStyle = '#d97757'
        drawStar(c, x + 4, y + 4, true)
        break
      }
    }
    this.texture.needsUpdate = true
  }
}

function drawStar(c: CanvasRenderingContext2D, x: number, y: number, big: boolean): void {
  const r = big ? 3 : 2
  c.fillRect(x - r, y, r * 2 + 1, 1)
  c.fillRect(x, y - r, 1, r * 2 + 1)
  c.fillRect(x - 1, y - 1, 3, 3)
}

function randomLine(): { indent: number; len: number; color: string } {
  return {
    indent: Math.floor(Math.random() * 4),
    len: 4 + Math.floor(Math.random() * 20),
    color: CODE_COLORS[Math.floor(Math.random() * CODE_COLORS.length)],
  }
}

/** Looping animated canvas for decorative screens (arcade, TV). */
export class LoopScreen {
  readonly texture: THREE.CanvasTexture
  /** The desk totem's light, colored by mode. */
  readonly led = new THREE.MeshBasicMaterial({ color: LED.off })
  private ctx: CanvasRenderingContext2D
  private t = 0
  private last = -1

  constructor(
    private w: number,
    private h: number,
    private paint: (c: CanvasRenderingContext2D, t: number, w: number, h: number) => void,
    private fps = 6,
  ) {
    const [cv, ctx] = canvas(w, h)
    this.ctx = ctx
    this.texture = pixelTexture(cv)
    this.paint(ctx, 0, w, h)
  }

  update(dt: number): void {
    this.t += dt
    const frame = Math.floor(this.t * this.fps)
    if (frame === this.last) return
    this.last = frame
    this.paint(this.ctx, this.t, this.w, this.h)
    this.texture.needsUpdate = true
  }
}

export const arcadePainter = (c: CanvasRenderingContext2D, t: number, w: number, h: number): void => {
  c.fillStyle = '#0b0b1a'
  c.fillRect(0, 0, w, h)
  c.fillStyle = '#ffffff'
  for (let i = 0; i < 12; i++) c.fillRect((i * 7 + Math.floor(t * 8)) % w, (i * 5) % h, 1, 1)
  const ox = Math.floor(Math.sin(t * 1.5) * 4)
  c.fillStyle = '#55efc4'
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) c.fillRect(4 + col * 5 + ox, 3 + row * 4, 3, 2)
  c.fillStyle = '#fdcb6e'
  const px = Math.floor(w / 2 + Math.sin(t * 2.3) * 6)
  c.fillRect(px - 1, h - 3, 3, 2)
  c.fillStyle = '#ff7675'
  c.fillRect(px, h - 4 - (Math.floor(t * 20) % (h - 4)), 1, 2)
}

export const dashboardPainter = (c: CanvasRenderingContext2D, t: number, w: number, h: number): void => {
  c.fillStyle = '#1e2233'
  c.fillRect(0, 0, w, h)
  c.fillStyle = '#d97757'
  c.fillRect(2, 2, 10, 2)
  c.fillStyle = '#5b6078'
  c.fillRect(14, 2, 8, 2)
  const bars = 8
  for (let i = 0; i < bars; i++) {
    const v = 0.5 + 0.5 * Math.sin(t * 0.8 + i * 0.9)
    const bh = Math.floor(4 + v * (h - 12))
    c.fillStyle = i % 2 ? '#82aaff' : '#c3e88d'
    c.fillRect(3 + i * 4, h - 3 - bh, 3, bh)
  }
  c.fillStyle = '#ffcb6b'
  for (let x = 0; x < w - 4; x++) c.fillRect(2 + x, Math.floor(h / 2 - Math.sin(t + x / 4) * 4), 1, 1)
}
