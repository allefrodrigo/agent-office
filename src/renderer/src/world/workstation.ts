import * as THREE from 'three'
import * as F from './furniture'
import { box, cylinder, panel } from './kit'
import { animated } from './merge'
import { glow } from './night'
import { LoopScreen } from './screens'
import { px } from './pixel-tag'

// A desk with someone's setup on it. Each desk number gets its own: one monitor,
// two, an ultrawide, a laptop beside a monitor, or a monitor turned on its side,
// on white, wood or dark desks. Centered on the desk, front (+z) toward the chair.

const DARK = '#2b2d3a'
const TOP = 0.76

type Setup = 'single' | 'dual' | 'ultrawide' | 'laptop' | 'portrait'
const SETUPS: Setup[] = ['dual', 'single', 'ultrawide', 'laptop', 'portrait', 'dual', 'single', 'laptop', 'ultrawide', 'portrait']
const DESK_TOPS: [string, string][] = [
  ['#f3efe6', '#4b4f63'],
  ['#c8925e', '#5c3d28'],
  ['#3a3d4d', '#24262f'],
]
const MATS = ['#3d4a6b', '#2f8f83', '#6c5ce7', '#d35454', '#2d3436']
const CHAIRS = ['#3d4a6b', '#d35454', '#2f8f83', '#6c5ce7', '#e1873b']
const CODE = ['#82aaff', '#c792ea', '#c3e88d', '#ffcb6b', '#89ddff', '#f78c6c']

/** Scrolling code for the second screens, a different speed per desk. */
function codePainter(seed: number) {
  return (c: CanvasRenderingContext2D, t: number, w: number, h: number): void => {
    c.fillStyle = '#161925'
    c.fillRect(0, 0, w, h)
    const shift = Math.floor(t * 3)
    for (let y = 1; y < h - 1; y += 2) {
      const n = (y + shift) * 7 + seed * 13
      const indent = (n % 4) * 2
      const len = 4 + ((n * 31) % (w - 8 - indent))
      c.fillStyle = CODE[(n >> 2) % CODE.length]
      c.fillRect(2 + indent, y, len, 1)
    }
  }
}

/** Monitor with a screen of any shape, on a stand. Front faces +z. */
function screenOn(g: THREE.Group, tex: THREE.Texture, w: number, h: number, x: number, z: number, yaw = 0): void {
  const m = new THREE.Group()
  box(m, 0.26, 0.02, 0.16, DARK, 0, 0, 0)
  box(m, 0.04, 0.16, 0.04, DARK, 0, 0.02, -0.02)
  box(m, w, h, 0.045, DARK, 0, 0.16, 0)
  panel(m, w - 0.06, h - 0.06, tex, 0, 0.16 + h / 2, 0.025)
  m.position.set(x, TOP, z)
  m.rotation.y = yaw
  g.add(px(m, 'monitor', { w, h }))
}

export interface Workstation {
  group: THREE.Group
  /** Animated second screens; update them with the office. */
  loops: LoopScreen[]
}

/**
 * Desk number `index` with its setup. `screen` is the agent's own screen (what it is
 * doing) and `led` the totem's light; the extra screens only scroll code.
 */
export function workstation(index: number, screen: THREE.Texture, led: THREE.Material): Workstation {
  const g = new THREE.Group()
  const loops: LoopScreen[] = []
  const second = () => {
    const l = new LoopScreen(24, 32, codePainter(index), 2 + (index % 3))
    loops.push(l)
    return l.texture
  }
  const [top, legs] = DESK_TOPS[index % DESK_TOPS.length]
  g.add(F.desk(2, top, legs))
  const setup = SETUPS[index % SETUPS.length]

  // mouse mat and keyboard in front of whatever screen is there
  box(g, 0.78, 0.008, 0.3, MATS[index % MATS.length], 0.05, TOP, 0.18, false)
  const kb = F.keyboard()
  kb.position.set(-0.05, TOP + 0.01, 0.18)
  g.add(kb)
  box(g, 0.06, 0.025, 0.09, '#e7eaf0', 0.36, TOP + 0.01, 0.2, false)

  switch (setup) {
    case 'single':
      screenOn(g, screen, 0.95, 0.55, 0, -0.22)
      break
    case 'dual':
      screenOn(g, screen, 0.82, 0.48, -0.38, -0.2, 0.18)
      screenOn(g, second(), 0.82, 0.48, 0.44, -0.2, -0.22)
      break
    case 'ultrawide':
      screenOn(g, screen, 1.45, 0.48, 0, -0.24)
      break
    case 'laptop': {
      screenOn(g, screen, 0.82, 0.48, -0.25, -0.22, 0.08)
      // laptop on a stand, angled toward the chair
      const stand = new THREE.Group()
      box(stand, 0.34, 0.1, 0.26, '#b2bec3', 0, 0, 0)
      const lap = F.laptop('#d0d4dc')
      lap.position.y = 0.1
      stand.add(lap)
      stand.position.set(0.68, TOP, -0.12)
      stand.rotation.y = -0.45
      g.add(stand)
      break
    }
    case 'portrait':
      screenOn(g, screen, 0.82, 0.48, -0.3, -0.22, 0.1)
      screenOn(g, second(), 0.36, 0.62, 0.55, -0.18, -0.3)
      break
  }

  // a personal touch on the free corner
  const ex = setup === 'single' || setup === 'ultrawide' ? -0.78 : -0.82
  switch (index % 5) {
    case 0:
      place(g, F.mug('#e17055'), ex, 0.3)
      break
    case 1:
      place(g, F.plant('cactus'), ex, -0.25)
      break
    case 2:
      place(g, F.deskLamp('#74b9ff'), ex, -0.2, 0.5)
      break
    case 3:
      place(g, F.paperStack(), ex, 0.15, 0.3)
      break
    default:
      // headphones resting on the desk
      cylinder(g, 0.09, 0.09, 0.03, '#2d3436', ex, TOP, 0.1, 10)
      box(g, 0.2, 0.02, 0.04, '#2d3436', ex, TOP + 0.03, 0.1, false)
  }
  if (setup !== 'laptop') place(g, F.mug(['#ffffff', '#fdcb6e', '#81ecec'][index % 3]), 0.8, 0.3)

  // the monitors light the desk and whoever sits at it
  glow(g, '#8fb4ff', 1.9, 3, 0, TOP + 0.45, 0.35)

  // status totem on the back corner: a post with a light on top
  box(g, 0.05, 0.42, 0.05, DARK, 0.92, TOP, -0.4)
  animated(box(g, 0.11, 0.11, 0.11, led, 0.92, TOP + 0.42, -0.4, false))

  const chair = F.officeChair(CHAIRS[index % CHAIRS.length])
  chair.position.set(0, 0, 0.9)
  chair.rotation.y = Math.PI
  g.add(chair)
  return { group: g, loops }
}

function place(g: THREE.Group, obj: THREE.Object3D, x: number, z: number, yaw = 0): void {
  obj.position.set(x, TOP, z)
  obj.rotation.y = yaw
  g.add(obj)
}
