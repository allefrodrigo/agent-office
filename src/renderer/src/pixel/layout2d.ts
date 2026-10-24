import * as THREE from 'three'
import { box } from '../world/kit'
import type { GroundFloor, Office } from '../world/office'
import { pxTag } from '../world/pixel-tag'

// The 2D view sees only the tops and the fronts (+z) of things, so a board or a TV hung on
// the side wall (x = 0) would show edge-on. In 2D they move to where the camera sees them:
// the back wall, or a stand facing the viewer. Their tags and clicks move along.

function put(obj: THREE.Object3D, x: number, y: number, z: number): void {
  obj.position.set(x, y, z)
  obj.rotation.set(0, 0, 0)
  obj.updateMatrixWorld(true)
}

/**
 * Whoever sits behind a big desk faces the viewer here, so the monitor in the middle of the
 * desk would cover their face: it goes to the right corner, and what stood there to the left.
 */
function clearDesks(group: THREE.Object3D): void {
  const items = group.children.filter((o) => pxTag(o))
  for (const desk of items.filter((o) => pxTag(o)!.key === 'bossDesk')) {
    const half = (Number(pxTag(desk)!.w) || 3) / 2
    const { x, z } = desk.position
    const onDesk = (o: THREE.Object3D) => Math.abs(o.position.z - z) < 0.6 && Math.abs(o.position.x - x) < half
    const right = x + half - 0.55
    for (const o of items.filter(onDesk)) {
      const key = pxTag(o)!.key
      if ((key === 'monitorBack' || key === 'laptop') && Math.abs(o.position.x - x) < 0.4) o.position.x = right
      else if ((key === 'mug' || key === 'deskLamp') && o.position.x > x + 0.2) o.position.x = x - half + (key === 'mug' ? 1.2 : 0.95)
    }
  }
}

/** Ground floor: routines board on the back wall of your office, Claude FM and the spending board facing the room. */
export function adaptGround(office: GroundFloor): void {
  clearDesks(office.group)
  put(office.routines.group, 3.15, 1.22, 0.06)
  put(office.tv.group, 12.3, 0, 21.6)
  office.grid.block(12, 21)
  office.grid.block(13, 21)
  // the café's spending board on two posts, the alarm on its corner
  const money = office.money.group
  put(money, 1.5, 1.0, 20.7)
  for (const x of [-0.8, 0.8]) box(money, 0.08, 1.0, 0.08, '#2d3142', x, -1.0, -0.02, false)
  put(office.alarm.group, 2.45, 1.92, 20.72)
  for (let x = 0; x <= 2; x++) office.grid.block(x, 20)
}

/** Project floors: the spending board and the alarm go from the side wall to the back wall of the first room. */
export function adaptUpper(floor: Office, rooftop: boolean): void {
  clearDesks(floor.group)
  if (rooftop) return
  put(floor.money.group, 2.6, 1.0, 0.06)
  put(floor.alarm.group, 3.95, 1.85, 0.04)
}
