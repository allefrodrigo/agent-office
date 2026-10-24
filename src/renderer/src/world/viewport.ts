import type * as THREE from 'three'

/**
 * What the game needs from whoever draws the office: the 3D isometric Engine (default) or the
 * 2D pixel-art PixelEngine (Configurações → Vídeo → Visual). Both keep the same world units, so
 * the game logic, the HTML tags and the clicks don't care which one is on screen.
 */
export interface Viewport {
  readonly kind: 'iso' | '2d'
  /** Scene graph of the office: floors, avatars, effects. The 2D view reads it, never uploads it. */
  readonly scene: THREE.Scene
  /** Where the camera wants to look (y = 0). */
  readonly target: THREE.Vector3
  /** The WebGL renderer, for the perf panel; null in 2D. */
  readonly renderer: THREE.WebGLRenderer | null
  /** Something changed that the last drawn frame does not show. */
  dirty: boolean
  /** The camera still eases towards its target. */
  readonly moving: boolean
  jumpTo(x: number, z: number): void
  /** Eases the camera; no drawing. */
  step(dt: number): void
  render(dt: number): void
  /** CSS pixel position of a world point inside the container. */
  project(v: THREE.Vector3): { x: number; y: number }
  /** Floor point under the cursor (y = 0 plane). */
  pickFloor(clientX: number, clientY: number): THREE.Vector3 | null
  /** What of `objects` is under the cursor, nearest first. */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[]
  /** Moves the camera by a drag in CSS pixels. */
  pan(dx: number, dy: number): void
  zoomStep(delta: number): void
  setPixelSize(n: number): void
  setShadows(on: boolean, size: number): void
  /** Modo noturno: the room is lit only by windows, screens and lamps (world/night.ts). */
  readonly night: boolean
  setNight(on: boolean): void
}
