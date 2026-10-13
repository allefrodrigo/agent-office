import * as THREE from 'three'
import { blob, box, cylinder, mat, panel } from './kit'
import { animated } from './merge'
import { artTexture, booksTexture, canvas, pixelTexture, whiteboardTexture, type WindowSky } from './textures'

// Every factory builds its piece centered on the origin, standing on y = 0,
// with its front facing +z. Callers rotate/position the returned group.

const WOOD = '#c8925e'
const WOOD_DARK = '#8a5a3b'
const METAL = '#4b4f63'
const DARK = '#2b2d3a'

export function desk(w = 2, top = '#f3efe6', legs = METAL): THREE.Group {
  const g = new THREE.Group()
  const d = 0.82
  box(g, w - 0.04, 0.06, d, top, 0, 0.7, 0)
  box(g, w - 0.04, 0.02, d, '#d8d2c4', 0, 0.69, 0, false)
  box(g, 0.06, 0.7, d - 0.08, legs, -w / 2 + 0.08, 0, 0)
  box(g, 0.06, 0.7, d - 0.08, legs, w / 2 - 0.08, 0, 0)
  box(g, w - 0.24, 0.35, 0.04, legs, 0, 0.3, -d / 2 + 0.06)
  // drawer block
  box(g, 0.42, 0.5, d - 0.12, '#e3ddd0', w / 2 - 0.36, 0.16, 0)
  box(g, 0.34, 0.02, 0.01, '#b9b1a1', w / 2 - 0.36, 0.5, d / 2 - 0.05, false)
  box(g, 0.34, 0.02, 0.01, '#b9b1a1', w / 2 - 0.36, 0.33, d / 2 - 0.05, false)
  return g
}

export function bossDesk(w = 3): THREE.Group {
  const g = new THREE.Group()
  const d = 0.95
  box(g, w, 0.08, d, WOOD_DARK, 0, 0.7, 0)
  box(g, w - 0.1, 0.7, 0.06, '#6e452c', 0, 0, d / 2 - 0.1)
  box(g, 0.1, 0.7, d - 0.1, '#6e452c', -w / 2 + 0.08, 0, 0)
  box(g, 0.1, 0.7, d - 0.1, '#6e452c', w / 2 - 0.08, 0, 0)
  box(g, w - 0.4, 0.03, 0.02, '#c9a25a', 0, 0.45, d / 2 - 0.06, false)
  return g
}

export function monitor(screen: THREE.Texture, width = 0.9): { group: THREE.Group; screen: THREE.Mesh } {
  const g = new THREE.Group()
  const h = width * 0.58
  box(g, 0.3, 0.02, 0.18, DARK, 0, 0, 0)
  box(g, 0.05, 0.2, 0.05, DARK, 0, 0.02, -0.02)
  box(g, width, h, 0.05, DARK, 0, 0.18, 0)
  const s = panel(g, width - 0.07, h - 0.07, screen, 0, 0.18 + h / 2, 0.027)
  return { group: g, screen: s }
}

export function monitorBack(width = 0.8): THREE.Group {
  const g = new THREE.Group()
  const h = width * 0.58
  box(g, 0.3, 0.02, 0.18, DARK, 0, 0, 0)
  box(g, 0.05, 0.2, 0.05, DARK, 0, 0.02, 0.02)
  box(g, width, h, 0.05, '#3a3d4d', 0, 0.18, 0)
  box(g, 0.2, 0.14, 0.03, DARK, 0, 0.3, -0.035)
  return g
}

export function keyboard(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.46, 0.025, 0.15, '#e7eaf0', 0, 0, 0, false)
  box(g, 0.42, 0.006, 0.11, '#b8bfcc', 0, 0.025, 0, false)
  box(g, 0.07, 0.025, 0.1, '#e7eaf0', 0.34, 0, 0.01, false)
  return g
}

export function laptop(color = '#c7ccd6'): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.42, 0.02, 0.3, color, 0, 0, 0)
  const lid = box(g, 0.42, 0.28, 0.02, color, 0, 0.02, -0.15)
  lid.rotation.x = -0.25
  return g
}

export function mug(color: string): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, 0.045, 0.04, 0.1, color, 0, 0, 0, 8)
  return g
}

export function paperStack(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.22, 0.04, 0.3, '#fbfbf8', 0, 0, 0)
  box(g, 0.22, 0.01, 0.3, '#e4e4de', 0.02, 0.04, 0.01)
  return g
}

export function deskLamp(color = '#f6c445'): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, 0.07, 0.08, 0.03, DARK, 0, 0, 0, 8)
  const arm = box(g, 0.03, 0.32, 0.03, DARK, 0, 0.03, 0)
  arm.rotation.x = 0.3
  cylinder(g, 0.05, 0.1, 0.1, color, 0, 0.28, 0.1, 8)
  return g
}

export function officeChair(color = '#3d4a6b'): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.5, 0.04, 0.08, DARK, 0, 0.02, 0)
  box(g, 0.08, 0.04, 0.5, DARK, 0, 0.02, 0)
  box(g, 0.05, 0.3, 0.05, '#55596b', 0, 0.06, 0)
  box(g, 0.5, 0.08, 0.48, color, 0, 0.36, 0)
  box(g, 0.48, 0.5, 0.08, color, 0, 0.44, -0.22)
  box(g, 0.4, 0.06, 0.06, '#2f3550', 0, 0.94, -0.22)
  return g
}

export function bossChair(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.56, 0.04, 0.08, DARK, 0, 0.02, 0)
  box(g, 0.08, 0.04, 0.56, DARK, 0, 0.02, 0)
  box(g, 0.06, 0.3, 0.06, '#55596b', 0, 0.06, 0)
  box(g, 0.58, 0.1, 0.54, '#5b3426', 0, 0.36, 0)
  box(g, 0.56, 0.78, 0.1, '#5b3426', 0, 0.44, -0.24)
  box(g, 0.06, 0.18, 0.4, '#4a2a1e', -0.3, 0.46, 0)
  box(g, 0.06, 0.18, 0.4, '#4a2a1e', 0.3, 0.46, 0)
  return g
}

export function simpleChair(color = WOOD): THREE.Group {
  const g = new THREE.Group()
  for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) box(g, 0.05, 0.42, 0.05, WOOD_DARK, x, 0, z)
  box(g, 0.44, 0.06, 0.44, color, 0, 0.42, 0)
  box(g, 0.44, 0.42, 0.06, color, 0, 0.48, -0.19)
  return g
}

export function plant(kind: 'bush' | 'tall' | 'fern' | 'cactus' | 'flower', pot = '#c56a45'): THREE.Group {
  const g = new THREE.Group()
  const greens = ['#3f9b4f', '#4fb35e', '#368a45', '#5cc46a']
  if (kind === 'tall') {
    box(g, 0.42, 0.4, 0.42, pot, 0, 0, 0)
    box(g, 0.36, 0.02, 0.36, '#4a3426', 0, 0.4, 0, false)
    box(g, 0.05, 0.9, 0.05, '#6b4f2e', 0, 0.4, 0)
    blob(g, 0.32, greens[0], 0.05, 1.05, 0, 1.1)
    blob(g, 0.26, greens[1], -0.12, 1.35, 0.06, 1.1)
    blob(g, 0.22, greens[3], 0.1, 1.55, -0.05, 1.1)
    blob(g, 0.24, greens[2], -0.05, 0.8, 0.12)
  } else if (kind === 'fern') {
    cylinder(g, 0.2, 0.16, 0.34, pot, 0, 0, 0, 8)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      const leaf = box(g, 0.1, 0.04, 0.42, greens[i % 4], Math.sin(a) * 0.14, 0.4, Math.cos(a) * 0.14)
      leaf.rotation.y = a
      leaf.rotation.x = -0.5
    }
    blob(g, 0.16, greens[1], 0, 0.42, 0)
  } else if (kind === 'cactus') {
    box(g, 0.26, 0.22, 0.26, pot, 0, 0, 0)
    box(g, 0.14, 0.42, 0.14, '#4a9e5c', 0, 0.22, 0)
    box(g, 0.08, 0.16, 0.08, '#4a9e5c', 0.11, 0.38, 0)
    box(g, 0.06, 0.06, 0.06, '#f78fb3', 0, 0.64, 0)
  } else if (kind === 'flower') {
    box(g, 0.2, 0.18, 0.2, pot, 0, 0, 0)
    blob(g, 0.13, greens[1], 0, 0.28, 0)
    for (const [x, z, c] of [[0.06, 0.04, '#ff7675'], [-0.06, 0.02, '#fdcb6e'], [0, -0.07, '#fd79a8']] as const) box(g, 0.06, 0.06, 0.06, c, x, 0.36, z)
  } else {
    box(g, 0.34, 0.3, 0.34, pot, 0, 0, 0)
    blob(g, 0.3, greens[0], 0, 0.55, 0, 0.9)
    blob(g, 0.2, greens[3], 0.12, 0.72, 0.05)
    blob(g, 0.18, greens[1], -0.12, 0.68, -0.06)
  }
  return g
}

export function sofa(len: number, color: string): THREE.Group {
  const g = new THREE.Group()
  const d = 0.85
  const dark = shadeHex(color, -28)
  box(g, len, 0.22, d, dark, 0, 0.05, 0)
  for (let i = 0; i < len; i++) box(g, 0.94, 0.14, d - 0.24, color, -len / 2 + i + 0.5, 0.27, 0.08)
  box(g, len, 0.5, 0.22, color, 0, 0.27, -d / 2 + 0.11)
  box(g, 0.18, 0.3, d, dark, -len / 2 + 0.09, 0.27, 0)
  box(g, 0.18, 0.3, d, dark, len / 2 - 0.09, 0.27, 0)
  for (const x of [-len / 2 + 0.1, len / 2 - 0.1]) for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) box(g, 0.06, 0.05, 0.06, '#3a2b20', x, 0, z)
  return g
}

export function armchair(color: string): THREE.Group {
  return sofa(1, color)
}

export function coffeeTable(w: number, d = 0.7): THREE.Group {
  const g = new THREE.Group()
  box(g, w - 0.2, 0.06, d, WOOD, 0, 0.34, 0)
  for (const x of [-w / 2 + 0.16, w / 2 - 0.16]) for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) box(g, 0.05, 0.34, 0.05, WOOD_DARK, x, 0, z)
  box(g, 0.3, 0.03, 0.22, '#e17055', -0.3, 0.4, 0.05)
  box(g, 0.24, 0.025, 0.2, '#74b9ff', -0.28, 0.43, 0.04)
  cylinder(g, 0.05, 0.04, 0.09, '#ffffff', 0.35, 0.4, -0.05, 8)
  return g
}

export function meetingTable(w: number, d: number): THREE.Group {
  const g = new THREE.Group()
  box(g, w - 0.1, 0.08, d - 0.1, '#e9e3d6', 0, 0.68, 0)
  box(g, w - 0.4, 0.68, 0.3, '#6c6f80', 0, 0, 0)
  box(g, w - 0.6, 0.02, 0.2, '#2d3436', 0, 0.76, 0, false)
  return g
}

export function bookshelf(w: number, h = 1.9, seed = 1): THREE.Group {
  const g = new THREE.Group()
  const d = 0.42
  const tex = booksTexture(seed)
  tex.wrapS = THREE.RepeatWrapping
  tex.repeat.set(w, 1)
  const front = new THREE.MeshLambertMaterial({ map: tex })
  const side = mat('#6e4a33')
  box(g, w, h, d, [side, side, side, side, front, side], 0, 0, 0)
  box(g, w + 0.06, 0.06, d + 0.04, '#5a3b28', 0, h, 0)
  return g
}

export function cabinet(w = 1): THREE.Group {
  const g = new THREE.Group()
  box(g, w - 0.06, 0.8, 0.5, '#b8bdc9', 0, 0, 0)
  for (let i = 0; i < 3; i++) {
    box(g, w - 0.16, 0.02, 0.01, '#8d93a3', 0, 0.22 + i * 0.24, 0.255, false)
    box(g, 0.14, 0.03, 0.02, '#6c7280', 0, 0.16 + i * 0.24, 0.255, false)
  }
  return g
}

export function waterCooler(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.4, 0.95, 0.4, '#e9edf2', 0, 0, 0)
  box(g, 0.06, 0.05, 0.03, '#3d7ef0', -0.08, 0.7, 0.2, false)
  box(g, 0.06, 0.05, 0.03, '#e84a5f', 0.08, 0.7, 0.2, false)
  const glass = new THREE.MeshLambertMaterial({ color: '#7cc6f2', transparent: true, opacity: 0.75 })
  cylinder(g, 0.17, 0.17, 0.45, glass, 0, 0.95, 0, 10)
  return g
}

export function printer(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.8, 0.6, 0.6, '#9ba3b4', 0, 0, 0)
  box(g, 0.72, 0.3, 0.52, '#dfe3ea', 0, 0.6, 0)
  box(g, 0.4, 0.02, 0.3, '#fbfbf8', 0, 0.9, 0.05, false)
  box(g, 0.1, 0.04, 0.02, '#27ae60', 0.25, 0.75, 0.26, false)
  return g
}

export function wallFrame(w: number, h: number, art: THREE.Texture, frame = '#3d2b1f'): THREE.Group {
  const g = new THREE.Group()
  box(g, w, h, 0.05, frame, 0, -h / 2, 0, false)
  panel(g, w - 0.1, h - 0.1, art, 0, 0, 0.03, true)
  return g
}

export function art(kind: 'mondrian' | 'mountains' | 'sunset' | 'plant', w = 0.9, h = 0.68): THREE.Group {
  return wallFrame(w, h, artTexture(kind))
}

export function whiteboard(w = 2.2, h = 1.2): THREE.Group {
  const g = wallFrame(w, h, whiteboardTexture(), '#c8ccd4')
  box(g, w * 0.8, 0.04, 0.1, '#c8ccd4', 0, -h / 2 - 0.04, 0.04, false)
  box(g, 0.12, 0.03, 0.03, '#e74c3c', -0.3, -h / 2, 0.06, false)
  box(g, 0.12, 0.03, 0.03, '#2e86de', -0.1, -h / 2, 0.06, false)
  return g
}

export function wallWindow(w: number, h: number, sky: WindowSky): THREE.Group {
  const g = new THREE.Group()
  box(g, w + 0.1, h + 0.1, 0.06, '#f5f3ee', 0, -(h + 0.1) / 2, 0, false)
  panel(g, w - 0.06, h - 0.06, sky.texture, 0, 0, 0.035)
  box(g, 0.05, h, 0.03, '#f5f3ee', 0, -h / 2, 0.04, false)
  box(g, w, 0.05, 0.03, '#f5f3ee', 0, -0.025, 0.04, false)
  box(g, w + 0.2, 0.06, 0.16, '#f5f3ee', 0, -h / 2 - 0.08, 0.06, false)
  return g
}

export function clock(): THREE.Group {
  const g = new THREE.Group()
  const [c, ctx] = canvas(12, 12)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(6, 6, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2d3436'
  ctx.fillRect(6, 2, 1, 4)
  ctx.fillRect(6, 6, 3, 1)
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), new THREE.MeshLambertMaterial({ map: pixelTexture(c) }))
  m.position.z = 0.03
  g.add(m)
  cylinder(g, 0.25, 0.25, 0.04, '#2d3436', 0, 0, 0, 12).rotation.x = Math.PI / 2
  return g
}

export function elevator(): { group: THREE.Group; doors: [THREE.Mesh, THREE.Mesh]; light: THREE.Mesh; buttons: THREE.Mesh[] } {
  const g = new THREE.Group()
  box(g, 1.7, 2.3, 0.08, '#8e96a8', 0, 0, 0, false)
  box(g, 1.5, 2.1, 0.02, '#2d3142', 0, 0, 0.04, false)
  const doorMat = new THREE.MeshLambertMaterial({ color: '#c9d1de' })
  const left = animated(box(g, 0.7, 2.06, 0.04, doorMat, -0.36, 0.01, 0.06, false))
  const right = animated(box(g, 0.7, 2.06, 0.04, doorMat, 0.36, 0.01, 0.06, false))
  box(g, 0.02, 2.06, 0.05, '#9aa3b5', 0, 0.01, 0.07, false)
  box(g, 0.5, 0.16, 0.04, '#2d3142', 0, 2.36, 0.02, false)
  const light = box(g, 0.08, 0.08, 0.02, new THREE.MeshBasicMaterial({ color: '#55efc4' }), 0, 2.4, 0.05, false)
  box(g, 0.12, 0.22, 0.04, '#2d3142', 1.0, 1.0, 0.04, false)
  // call buttons: T on top, then one per floor above it
  const buttons = [box(g, 0.05, 0.05, 0.02, '#fdcb6e', 1.0, 1.12, 0.07, false), box(g, 0.05, 0.05, 0.02, '#55efc4', 1.0, 1.04, 0.07, false)].map(animated)
  return { group: g, doors: [left, right], light, buttons }
}

export function tv(screen: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  box(g, 1.6, 0.92, 0.06, DARK, 0, -0.46, 0, false)
  panel(g, 1.5, 0.82, screen, 0, 0, 0.035)
  return g
}

export interface MonitorTv {
  group: THREE.Group
  /** Screen plane; the radio lays the live video over it. */
  screen: THREE.Mesh
  /** Screen size in local units (the plane faces +z). */
  size: { w: number; h: number }
  setOn(on: boolean): void
}

/** Big pixel-art monitor on a low console: chunky bezel, neck, foot and a power LED. Claude FM plays on it. */
export function monitorTv(): MonitorTv {
  // clicked (raycast on its group) and its LED swaps material: kept out of the merge
  const g = animated(new THREE.Group())
  const w = 2.0
  const h = w * (9 / 16)
  const cy = 1.48 // screen center height: the bezel clears the neck
  // console
  box(g, 2.3, 0.5, 0.6, WOOD_DARK, 0, 0, 0)
  box(g, 2.34, 0.05, 0.64, WOOD, 0, 0.5, 0)
  box(g, 1.0, 0.18, 0.01, '#6e452c', -0.55, 0.18, 0.3, false)
  box(g, 1.0, 0.18, 0.01, '#6e452c', 0.55, 0.18, 0.3, false)
  // foot and neck
  box(g, 0.8, 0.05, 0.4, DARK, 0, 0.55, 0)
  box(g, 0.16, 0.3, 0.1, METAL, 0, 0.6, -0.06)
  // bezel, a lighter lip around the glass, chin with the LED
  const bezel = 0.1
  box(g, w + bezel * 2, h + bezel * 2 + 0.06, 0.12, DARK, 0, cy - h / 2 - bezel - 0.06, -0.04)
  box(g, w + 0.04, h + 0.04, 0.02, '#3a3d4d', 0, cy - h / 2 - 0.02, 0.02, false)
  box(g, 0.3, 0.03, 0.01, '#3a3d4d', 0, cy - h / 2 - bezel - 0.02, 0.025, false)
  const ledOff = new THREE.MeshBasicMaterial({ color: '#3b2b2b' })
  const ledOn = new THREE.MeshBasicMaterial({ color: '#2ee86b' })
  const led = box(g, 0.09, 0.05, 0.02, ledOff, w / 2 - 0.08, cy - h / 2 - bezel - 0.04, 0.025, false)
  const off = tvScreenTexture(false)
  const on = tvScreenTexture(true)
  const screen = panel(g, w, h, off, 0, cy, 0.035)
  const material = screen.material as THREE.MeshBasicMaterial
  return {
    group: g,
    screen,
    size: { w, h },
    setOn(isOn) {
      led.material = isOn ? ledOn : ledOff
      material.map = isOn ? on : off
    },
  }
}

/** Off: dark glass with a diagonal glare. On: black, the video covers it. */
function tvScreenTexture(on: boolean): THREE.Texture {
  const [cv, c] = canvas(32, 18)
  c.fillStyle = on ? '#05060a' : '#161826'
  c.fillRect(0, 0, 32, 18)
  if (!on) {
    c.fillStyle = '#262a3d'
    for (let y = 0; y < 18; y++) c.fillRect(14 - y, y, 4, 1)
    c.fillStyle = '#20233a'
    for (let y = 0; y < 18; y++) c.fillRect(21 - y, y, 1, 1)
  }
  return pixelTexture(cv)
}

export function pingPong(): THREE.Group {
  const g = new THREE.Group()
  box(g, 1.1, 0.05, 1.9, '#1e8f5a', 0, 0.7, 0)
  box(g, 0.02, 0.006, 1.9, '#ffffff', 0, 0.75, 0, false)
  box(g, 1.1, 0.006, 0.02, '#ffffff', 0, 0.75, 0, false)
  box(g, 1.2, 0.14, 0.02, '#ecf0f1', 0, 0.75, 0)
  for (const x of [-0.45, 0.45]) for (const z of [-0.8, 0.8]) box(g, 0.05, 0.7, 0.05, DARK, x, 0, z)
  box(g, 0.12, 0.02, 0.16, '#e74c3c', 0.3, 0.75, 0.6, false)
  return g
}

export function arcade(screen: THREE.Texture): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.7, 1.75, 0.7, '#6c5ce7', 0, 0, 0)
  box(g, 0.72, 0.28, 0.2, '#341f97', 0, 1.75, 0.15)
  box(g, 0.6, 0.06, 0.32, '#2d3436', 0, 0.95, 0.4)
  box(g, 0.05, 0.08, 0.05, '#e74c3c', -0.12, 1.01, 0.42)
  box(g, 0.05, 0.03, 0.05, '#fdcb6e', 0.08, 1.01, 0.44)
  box(g, 0.05, 0.03, 0.05, '#00cec9', 0.18, 1.01, 0.4)
  const s = panel(g, 0.5, 0.4, screen, 0, 1.3, 0.355)
  s.rotation.x = -0.2
  return g
}

export function foosball(): THREE.Group {
  const g = new THREE.Group()
  const len = 1.3
  const d = 0.75
  for (const x of [-len / 2 + 0.1, len / 2 - 0.1]) for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) box(g, 0.08, 0.62, 0.08, '#3a2b20', x, 0, z)
  box(g, len, 0.22, d, '#c0392b', 0, 0.62, 0)
  box(g, len - 0.12, 0.02, d - 0.12, '#1e8f5a', 0, 0.84, 0, false)
  box(g, 0.02, 0.006, d - 0.14, '#ffffff', 0, 0.86, 0, false)
  box(g, 0.06, 0.12, 0.2, '#ecf0f1', -len / 2 + 0.03, 0.72, 0, false)
  box(g, 0.06, 0.12, 0.2, '#ecf0f1', len / 2 - 0.03, 0.72, 0, false)
  // rods cross the table and stick out of both long sides, little players hang from them
  for (let i = 0; i < 4; i++) {
    const x = -0.45 + i * 0.3
    box(g, 0.025, 0.025, d + 0.34, '#b2bec3', x, 0.92, 0, false)
    box(g, 0.05, 0.05, 0.1, '#2d3436', x, 0.905, d / 2 + 0.2, false)
    box(g, 0.05, 0.05, 0.1, '#2d3436', x, 0.905, -d / 2 - 0.2, false)
    for (let k = -1; k <= 1; k++) box(g, 0.05, 0.12, 0.04, i % 2 ? '#f1c40f' : '#2e86de', x, 0.84, k * 0.2, false)
  }
  box(g, 0.04, 0.04, 0.04, '#ffffff', 0.1, 0.86, 0.08, false)
  return g
}

export function lowTable(r = 0.32): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, r, r * 0.9, 0.3, WOOD, 0, 0, 0, 12)
  cylinder(g, 0.05, 0.04, 0.09, '#ffffff', 0.08, 0.3, 0.04, 8)
  box(g, 0.16, 0.03, 0.12, '#74b9ff', -0.08, 0.3, -0.04, false)
  return g
}

export function beanBag(color: string): THREE.Group {
  const g = new THREE.Group()
  blob(g, 0.36, color, 0, 0.2, 0, 0.6, 1)
  blob(g, 0.24, shadeHex(color, -18), 0, 0.28, -0.18, 1.1, 1)
  return g
}

export function floorLamp(): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, 0.14, 0.16, 0.04, DARK, 0, 0, 0, 8)
  box(g, 0.04, 1.4, 0.04, DARK, 0, 0.04, 0)
  cylinder(g, 0.12, 0.22, 0.28, new THREE.MeshBasicMaterial({ color: '#ffeaa7' }), 0, 1.36, 0, 10)
  return g
}

export function trash(): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, 0.13, 0.11, 0.32, '#636e72', 0, 0, 0, 8)
  return g
}

export function rug(w: number, d: number, texture: THREE.Texture): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.02, d),
    [mat('#7a3b3b'), mat('#7a3b3b'), new THREE.MeshLambertMaterial({ map: texture }), mat('#7a3b3b'), mat('#7a3b3b'), mat('#7a3b3b')],
  )
  m.position.y = 0.01
  m.receiveShadow = true
  return m
}

export function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, v + amt)).toString(16).padStart(2, '0')
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`
}

// ---------- café ----------

/** Kitchen counter `len` tiles long, front facing +z, with a sink near one end. */
export function kitchenCounter(len: number): THREE.Group {
  const g = new THREE.Group()
  const d = 0.62
  box(g, len - 0.04, 0.86, d, '#f2efe8', 0, 0, 0)
  box(g, len, 0.05, d + 0.04, '#5b6074', 0, 0.86, 0.01)
  for (let i = 0; i < len; i++) {
    const x = -len / 2 + i + 0.5
    box(g, 0.9, 0.7, 0.01, '#e4dfd4', x, 0.08, d / 2 + 0.005, false)
    box(g, 0.18, 0.025, 0.02, '#8d93a3', x, 0.68, d / 2 + 0.015, false)
  }
  box(g, 0.5, 0.02, 0.36, '#9aa3b5', len / 2 - 0.7, 0.9, 0, false)
  box(g, 0.03, 0.22, 0.03, '#c9ced8', len / 2 - 0.7, 0.9, -0.18, false)
  box(g, 0.03, 0.03, 0.14, '#c9ced8', len / 2 - 0.7, 1.1, -0.12, false)
  return g
}

/** Upper cabinets for a wall, `len` tiles long, hung at the given height. */
export function wallCabinets(len: number, y = 1.55): THREE.Group {
  const g = new THREE.Group()
  box(g, len - 0.04, 0.6, 0.34, '#f2efe8', 0, y, 0)
  for (let i = 0; i < len; i++) box(g, 0.16, 0.02, 0.02, '#8d93a3', -len / 2 + i + 0.5, y + 0.08, 0.18, false)
  return g
}

export function coffeeMachine(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.32, 0.42, 0.3, '#2d3436', 0, 0, 0)
  box(g, 0.26, 0.08, 0.04, '#636e72', 0, 0.3, 0.15, false)
  box(g, 0.06, 0.03, 0.03, '#55efc4', 0.09, 0.36, 0.16, false)
  box(g, 0.12, 0.02, 0.12, '#636e72', 0, 0.04, 0.1, false)
  cylinder(g, 0.04, 0.035, 0.08, '#ffffff', 0, 0.06, 0.1, 8)
  return g
}

export function microwave(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.46, 0.28, 0.32, '#dfe6e9', 0, 0, 0)
  box(g, 0.3, 0.2, 0.01, '#2d3436', -0.06, 0.04, 0.16, false)
  box(g, 0.08, 0.2, 0.01, '#b2bec3', 0.17, 0.04, 0.16, false)
  return g
}

export function fridge(): THREE.Group {
  const g = new THREE.Group()
  box(g, 0.72, 1.85, 0.66, '#e9edf2', 0, 0, 0)
  box(g, 0.7, 0.02, 0.01, '#b2bec3', 0, 1.2, 0.335, false)
  box(g, 0.04, 0.4, 0.04, '#b2bec3', -0.26, 1.35, 0.34, false)
  box(g, 0.04, 0.5, 0.04, '#b2bec3', -0.26, 0.55, 0.34, false)
  // a couple of magnets and a note
  box(g, 0.12, 0.14, 0.01, '#fdcb6e', 0.12, 1.5, 0.335, false)
  box(g, 0.05, 0.05, 0.012, '#e17055', 0.2, 0.9, 0.336, false)
  return g
}

/** Tall round table for standing or the bar stools. */
export function barTable(): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, 0.22, 0.26, 0.04, DARK, 0, 0, 0, 12)
  cylinder(g, 0.04, 0.04, 1.0, '#55596b', 0, 0.04, 0, 8)
  cylinder(g, 0.42, 0.42, 0.05, WOOD, 0, 1.04, 0, 16)
  cylinder(g, 0.05, 0.04, 0.09, '#ffffff', 0.12, 1.09, 0.08, 8)
  return g
}

export function stool(color: string): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, 0.15, 0.17, 0.03, DARK, 0, 0, 0, 10)
  cylinder(g, 0.03, 0.03, 0.66, '#55596b', 0, 0.03, 0, 8)
  cylinder(g, 0.12, 0.12, 0.02, '#55596b', 0, 0.32, 0, 10)
  cylinder(g, 0.18, 0.17, 0.07, color, 0, 0.69, 0, 12)
  return g
}

/** Low round table for the café, `r` its radius. */
export function roundTable(r = 0.5): THREE.Group {
  const g = new THREE.Group()
  cylinder(g, 0.24, 0.28, 0.04, DARK, 0, 0, 0, 12)
  cylinder(g, 0.05, 0.05, 0.68, '#55596b', 0, 0.04, 0, 8)
  cylinder(g, r, r, 0.05, '#f2efe8', 0, 0.72, 0, 18)
  return g
}
