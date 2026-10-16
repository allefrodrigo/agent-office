import * as THREE from 'three'
import type { RoutineLed, RoutinesView } from '@shared/routines'
import { animated } from './merge'
import { box, cylinder, panel } from './kit'
import { shared } from './dispose'
import { canvas, pixelTexture } from './textures'

// Live pieces of the office: the spending board, the routines board and the limit alarm.

/** "$ 8,92" */
export function money(usd: number): string {
  return `$ ${usd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export interface CostLine {
  name: string
  usd: number
}

export interface CostBoard {
  group: THREE.Group
  /** Top of the board, where its tag attaches. */
  anchor: THREE.Object3D
  /** Total for the floor and its biggest spenders. */
  set(total: number, lines: CostLine[]): void
  update(dt: number): void
}

// Low resolution on purpose: the office renders in big pixels, so the board uses
// few, chunky glyphs that survive it. The tag above it carries the exact numbers.
const BW = 160
const BH = 72

/**
 * Wall display (facing +z) with what the floor spent this session: the total rolls up
 * to each new value and the agents scroll underneath. Origin at the bottom center.
 */
export function costBoard(title: string, width = 2.4): CostBoard {
  const g = new THREE.Group()
  const c = document.createElement('canvas')
  c.width = BW
  c.height = BH
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const h = (width * BH) / BW
  box(g, width + 0.12, h + 0.12, 0.06, '#1b1d27', 0, -0.06, 0, false)
  panel(g, width, h, tex, 0, h / 2, 0.035)
  const anchor = new THREE.Object3D()
  anchor.position.set(0, h + 0.1, 0.1)
  g.add(anchor)

  let target = 0
  let shown = 0
  let ticker = ''
  let scroll = 0
  let flash = 0
  let frame = 0
  const draw = () => {
    ctx.fillStyle = '#0e1018'
    ctx.fillRect(0, 0, BW, BH)
    ctx.textBaseline = 'top'
    ctx.font = 'bold 11px -apple-system, "Segoe UI", sans-serif'
    ctx.fillStyle = '#7d8299'
    let label = title.toUpperCase()
    while (ctx.measureText(label).width > BW - 16 && label.length > 4) label = label.slice(0, -2) + '…'
    ctx.fillText(label, 8, 6)
    // the total, glowing brighter for a moment after it changes
    ctx.font = 'bold 30px ui-monospace, "SF Mono", Menlo, monospace'
    let size = 30
    while (ctx.measureText(money(shown)).width > BW - 16 && size > 16) ctx.font = `bold ${(size -= 2)}px ui-monospace, "SF Mono", Menlo, monospace`
    ctx.shadowColor = '#ffb347'
    ctx.shadowBlur = 4 + flash * 10
    ctx.fillStyle = flash > 0 ? '#ffe2a8' : '#ffb347'
    ctx.fillText(money(shown), 8, 22)
    ctx.shadowBlur = 0
    // who spent it, scrolling
    ctx.fillStyle = '#1a1d2a'
    ctx.fillRect(0, BH - 17, BW, 17)
    ctx.font = 'bold 11px -apple-system, "Segoe UI", sans-serif'
    ctx.fillStyle = '#9fe6b8'
    const text = ticker || 'Ninguém gastou nada ainda'
    const tw = ctx.measureText(text).width + 40
    if (ticker && tw > BW) {
      const x = 8 - (scroll % tw)
      ctx.fillText(text, x, BH - 14)
      ctx.fillText(text, x + tw, BH - 14)
    } else {
      ctx.fillText(text, 8, BH - 14)
    }
    tex.needsUpdate = true
  }
  draw()

  return {
    group: g,
    anchor,
    set(total, lines) {
      if (Math.abs(total - target) > 0.004) flash = 1
      target = total
      ticker = lines
        .filter((l) => l.usd >= 0.005)
        .map((l) => `${l.name} ${money(l.usd)}`)
        .join('   ·   ')
    },
    update(dt) {
      const before = shown
      shown += (target - shown) * Math.min(1, dt * 3)
      if (Math.abs(target - shown) < 0.005) shown = target
      flash = Math.max(0, flash - dt * 1.5)
      scroll += dt * 18
      // ~12 fps is plenty for a pixel-art sign
      frame += dt
      if (frame < 1 / 12 && before === shown) return
      frame = 0
      draw()
    },
  }
}

export interface RoutinesBoard {
  group: THREE.Group
  /** Above the frame, where the "Rotinas" tag attaches. */
  anchor: THREE.Object3D
  /** Redraws the board and its LED when the view changed; true if it did. */
  show(view: RoutinesView): boolean
}

const LED_COLORS: Record<RoutineLed, string> = { ok: '#2ee86b', wait: '#ffc02e', fail: '#ff3b4a', none: '#6b6a7d' }
// Smooth text turns to mush in the office's chunky pixels, so the routines board draws
// a few big pixel glyphs (3x5, tripled or doubled) and the tag's balloon carries the line in words.
const RW = 48
const RH = 28

/** 3x5 glyphs, rows top to bottom, '1' = lit. */
const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110', '4': '101101111001001',
  '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  D: '110101101101110', H: '101101111101101', M: '101111111101101', S: '011100010001110',
  '!': '010010010000010', '>': '100110111110100', '+': '000010111010000', '-': '000000111000000',
}

/** Draws `text` centered across the board, its top at `y`; glyphs step 4 cells apart. */
function drawGlyphs(ctx: CanvasRenderingContext2D, text: string, y: number, scale: number): void {
  const x = Math.floor((RW - (text.length * 4 - 1) * scale) / 2)
  ;[...text].forEach((ch, i) => {
    const g = FONT[ch] ?? FONT['-']
    for (let k = 0; k < 15; k++) if (g[k] === '1') ctx.fillRect(x + (i * 4 + (k % 3)) * scale, y + Math.floor(k / 3) * scale, scale, scale)
  })
}

/**
 * The routines board, the spending board's sibling on the wall (facing +z): the next
 * routine's countdown in big pixel glyphs, a light per routine underneath and a status
 * LED on the frame. It hangs in your office and in every Diretoria. Origin at the bottom
 * center. The canvas is drawn only when it changes, never per frame.
 */
export function routinesBoard(width = 1.3): RoutinesBoard {
  // clicked (raycast on its group) and its LED changes color: kept out of the merge
  const g = animated(new THREE.Group())
  const [c, ctx] = canvas(RW, RH)
  const tex = pixelTexture(c)
  const h = (width * RH) / RW
  box(g, width + 0.12, h + 0.12, 0.06, '#1b1d27', 0, -0.06, 0, false)
  panel(g, width, h, tex, 0, h / 2, 0.035)
  // the LED on the frame's top right corner, with a darker socket
  const lx = width / 2 - 0.12
  box(g, 0.18, 0.04, 0.12, '#14161f', lx, h + 0.06, 0.03, false)
  const ledMat = new THREE.MeshBasicMaterial({ color: LED_COLORS.none, toneMapped: false })
  box(g, 0.11, 0.11, 0.11, ledMat, lx, h + 0.1, 0.03, false)
  const anchor = new THREE.Object3D()
  anchor.position.set(0, h + 0.5, 0.1)
  g.add(anchor)

  let key = ''
  return {
    group: g,
    anchor,
    show(view) {
      const k = `${JSON.stringify(view.screen)}\n${view.led}\n${view.dots.join()}`
      if (k === key) return false
      key = k
      const led = LED_COLORS[view.led]
      ledMat.color.set(led)
      ctx.fillStyle = '#0e1018'
      ctx.fillRect(0, 0, RW, RH)
      // a strip in the LED's color along the top
      ctx.fillStyle = led
      ctx.fillRect(0, 0, RW, 2)
      // the countdown, or a symbol for what is going on, as big as it fits
      const sc = view.screen
      const text = sc.kind === 'count' ? sc.text : { wait: '!', run: '>', add: '+', idle: '-' }[sc.kind]
      const scale = [3, 2, 1].find((n) => (text.length * 4 - 1) * n <= RW - 4) ?? 1
      ctx.fillStyle = sc.kind === 'wait' ? '#ffc02e' : sc.kind === 'count' ? '#ffb347' : sc.kind === 'run' ? '#9fe6b8' : '#b3b1cb'
      drawGlyphs(ctx, text, 2 + Math.floor((20 - 5 * scale) / 2), scale)
      // a light per routine along the bottom, as many as fit
      const dots = view.dots.slice(0, Math.floor((RW - 2) / 5))
      const x0 = Math.floor((RW - (dots.length * 5 - 2)) / 2)
      dots.forEach((d, i) => {
        ctx.fillStyle = LED_COLORS[d]
        ctx.fillRect(x0 + i * 5, 23, 3, 3)
      })
      tex.needsUpdate = true
      return true
    },
  }
}

export interface Beacon {
  group: THREE.Group
  /** Spins and flashes while on. */
  setOn(on: boolean): void
  readonly on: boolean
  /** Where the alarm's tag attaches. */
  anchor: THREE.Object3D
  update(dt: number): void
}

/**
 * Red strobe on a wall bracket (facing +z), like a fire-alarm beacon: a dome on a
 * round base. On, the dome glows, two beams sweep around and a red glow pulses on
 * the wall and floor below. Origin at the wall, bottom of the bracket.
 */
export function beacon(): Beacon {
  const g = animated(new THREE.Group())
  box(g, 0.34, 0.06, 0.3, '#a8323a', 0, 0, 0.12, false)
  const base = cylinder(g, 0.14, 0.15, 0.12, '#b8323c', 0, 0.06, 0.16, 14)
  base.castShadow = false
  box(g, 0.3, 0.012, 0.012, '#3a1418', 0, 0.18, 0.16, false)
  const domeMat = new THREE.MeshLambertMaterial({ color: '#d42a3a', emissive: '#3a0008', transparent: true, opacity: 0.92 })
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.135, 0.16, 14), domeMat)
  dome.position.set(0, 0.27, 0.16)
  g.add(dome)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), domeMat)
  cap.position.set(0, 0.35, 0.16)
  g.add(cap)

  // two light beams sweeping around the dome
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ff2a3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  const beams = new THREE.Group()
  beams.position.set(0, 0.3, 0.16)
  for (const a of [0, Math.PI]) {
    const geo = new THREE.ConeGeometry(0.5, 2.2, 12, 1, true)
    geo.translate(0, -1.1, 0)
    geo.rotateZ(Math.PI / 2)
    const m = new THREE.Mesh(geo, beamMat)
    m.rotation.y = a
    beams.add(m)
  }
  beams.visible = false
  g.add(beams)

  // soft red glow on the wall behind
  const glowTex = radialTexture()
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: '#ff2a3d', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), glowMat)
  glow.position.set(0, 0.2, 0.02)
  g.add(glow)

  const anchor = new THREE.Object3D()
  anchor.position.set(0, 0.55, 0.16)
  g.add(anchor)

  let on = false
  let t = 0
  return {
    group: g,
    anchor,
    get on() {
      return on
    },
    setOn(v) {
      on = v
      beams.visible = v
      if (!v) {
        domeMat.emissive.set('#3a0008')
        beamMat.opacity = 0
        glowMat.opacity = 0
      }
    },
    update(dt) {
      if (!on) return
      t += dt
      beams.rotation.y = t * 5
      // strobe: a sharp flash twice a second over the sweep
      const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(t * 12.6))
      domeMat.emissive.setRGB(0.9 * pulse, 0.05 * pulse, 0.08 * pulse)
      beamMat.opacity = 0.16 + 0.12 * pulse
      glowMat.opacity = 0.25 + 0.35 * pulse
    },
  }
}

let radial: THREE.CanvasTexture | null = null
function radialTexture(): THREE.CanvasTexture {
  if (radial) return radial
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 64, 64)
  // one glow for every beacon on every floor
  radial = shared(new THREE.CanvasTexture(c))
  return radial
}
