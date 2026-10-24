import type * as THREE from 'three'

/**
 * Names a built object for the 2D pixel-art view (pixel/): which catalog sprite stands in for
 * it (src/shared/pixel-catalog.json) and the few facts that pick the variant. The 3D view
 * ignores the tag. Returns the object.
 */
export function px<T extends THREE.Object3D>(obj: T, key: string, data: Record<string, unknown> = {}): T {
  obj.userData.px = { key, ...data }
  return obj
}

/** A texture the 2D view must redraw every frame (screens, skies, boards). Returns it. */
export function live<T extends THREE.Texture>(tex: T): T {
  tex.userData.live = true
  return tex
}

/** The tag set by px(), if any. */
export function pxTag(obj: THREE.Object3D): ({ key: string } & Record<string, unknown>) | undefined {
  return obj.userData.px
}
