import * as THREE from 'three'

// Modo noturno: the ceiling lights go off and the room is lit only by what glows in it,
// the windows, the monitors and the lamps. Each of those carries a point light that
// stays hidden by day, so the day scene costs nothing extra.

/** Adds a hidden point light under `parent` (local position), switched on by setNight. */
export function glow(parent: THREE.Object3D, color: string, intensity: number, distance: number, x: number, y: number, z: number): THREE.PointLight {
  const light = new THREE.PointLight(color, intensity, distance, 1.6)
  light.position.set(x, y, z)
  light.visible = false
  light.userData.night = true
  parent.add(light)
  return light
}

/** Turns every glow under `root` on or off. */
export function setNightLights(root: THREE.Object3D, on: boolean): void {
  root.traverse((o) => {
    if (o.userData.night) o.visible = on
  })
}
