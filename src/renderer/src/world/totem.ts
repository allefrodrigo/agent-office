import * as THREE from 'three'
import type { RoutineLed, TotemView } from '@shared/routines'
import { box, panel } from './kit'
import { animated } from './merge'
import { canvas, pixelTexture } from './textures'

const LED_COLORS: Record<RoutineLed, string> = { ok: '#2ee86b', wait: '#ffc02e', fail: '#ff3b4a', none: '#6b6a7d' }
// Text does not survive the office's chunky pixels, so the screen draws a few big glyphs
// (3x5, doubled or tripled) and the tag's balloon carries the line in words.
const SW = 44
const SH = 33

/** 3x5 glyphs, rows top to bottom, '1' = lit. */
const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110', '4': '101101111001001',
  '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001110',
  D: '110101101101110', H: '101101111101101', M: '101111111101101', S: '011100010001110',
  '!': '010010010000010', '>': '100110111110100', '+': '000010111010000', '-': '000000111000000',
}

/** Draws `text` centered at `scale`; glyphs step 4 cells apart. */
function drawCentered(ctx: CanvasRenderingContext2D, text: string, scale: number): void {
  const w = text.length * 4 * scale - scale
  const x0 = Math.floor((SW - w) / 2)
  const y0 = Math.floor((SH - 5 * scale) / 2) + 1
  ;[...text].forEach((ch, i) => {
    const g = FONT[ch] ?? FONT['-']
    for (let k = 0; k < 15; k++) if (g[k] === '1') ctx.fillRect(x0 + (i * 4 + (k % 3)) * scale, y0 + Math.floor(k / 3) * scale, scale, scale)
  })
}

export interface Totem {
  group: THREE.Group
  /** Above the cap, where the "Rotinas" tag attaches. */
  anchor: THREE.Object3D
  /** Redraws the screen and the LED when something changed; true if it did. */
  show(view: TotemView): boolean
}

/**
 * The routines totem: a voxel column with a screen (next routine and its countdown) and a
 * status LED on top. Faces +z, origin at the bottom center, about 1.75 tall. The screen is
 * a canvas drawn only when its text changes, never per frame.
 */
export function totem(): Totem {
  // its screen and LED change: kept out of the merge
  const g = animated(new THREE.Group())
  box(g, 0.9, 0.08, 0.7, '#2d2733', 0, 0, 0)
  box(g, 0.5, 0.9, 0.4, '#3b3f5c', 0, 0.08, 0)
  // the head: a wide screen leaning on the column
  box(g, 0.92, 0.74, 0.44, '#3b3f5c', 0, 0.96, 0)
  box(g, 0.94, 0.05, 0.46, '#d97757', 0, 0.94, 0, false)
  box(g, 0.96, 0.06, 0.48, '#2d2733', 0, 1.7, 0)
  box(g, 0.84, 0.64, 0.02, '#14161f', 0, 1.01, 0.22, false)
  const [c, ctx] = canvas(SW, SH)
  const tex = pixelTexture(c)
  panel(g, 0.78, 0.585, tex, 0, 1.33, 0.232)
  // the LED, with a darker socket
  box(g, 0.2, 0.04, 0.2, '#14161f', 0, 1.76, 0.06, false)
  const ledMat = new THREE.MeshBasicMaterial({ color: LED_COLORS.none, toneMapped: false })
  box(g, 0.13, 0.13, 0.13, ledMat, 0, 1.8, 0.06, false)
  const anchor = new THREE.Object3D()
  anchor.position.set(0, 2.15, 0)
  g.add(anchor)

  let key = ''
  return {
    group: g,
    anchor,
    show(view) {
      const k = `${JSON.stringify(view.screen)}\n${view.led}`
      if (k === key) return false
      key = k
      ledMat.color.set(LED_COLORS[view.led])
      ctx.fillStyle = '#0e1018'
      ctx.fillRect(0, 0, SW, SH)
      // a strip in the LED's color along the top
      ctx.fillStyle = LED_COLORS[view.led]
      ctx.fillRect(0, 0, SW, 2)
      const sc = view.screen
      const text = sc.kind === 'count' ? sc.text : { wait: '!', run: '>', add: '+', idle: '-' }[sc.kind]
      ctx.fillStyle = sc.kind === 'wait' ? '#ffc02e' : sc.kind === 'count' ? '#ffb347' : '#b3b1cb'
      drawCentered(ctx, text, text.length === 1 ? 3 : text.length * 8 - 2 <= SW - 2 ? 2 : 1)
      tex.needsUpdate = true
      return true
    },
  }
}
