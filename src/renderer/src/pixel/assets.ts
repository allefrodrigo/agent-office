// The catalog sprites made by `npm run pixel` (src/renderer/src/assets/pixel/<group>/<key>.png).
// Vite lists whatever is in the folder at build time; a sprite that is not there yet is simply
// missing, and the painter draws that object from its 3D pieces instead.

const urls = import.meta.glob('../assets/pixel/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const metas = import.meta.glob('../assets/pixel/**/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { screen?: [number, number, number, number]; tint?: boolean }
>

export interface Sprite {
  img: HTMLImageElement
  w: number
  h: number
  /** Where the live screen goes (the magenta area of the raw image), in sprite pixels. */
  screen?: [number, number, number, number]
  /** Painted in key hues that take each agent's or piece's colors (pixel/tint.ts). */
  tint?: boolean
}

const keyOf = (path: string) => path.replace(/^.*\/assets\/pixel\//, '').replace(/\.(png|json)$/, '')

const sprites = new Map<string, Sprite>()
const listeners = new Set<() => void>()
let pending = 0

for (const [path, url] of Object.entries(urls)) {
  const key = keyOf(path)
  const img = new Image()
  pending++
  img.onload = () => {
    const meta = metas[path.replace(/\.png$/, '.json')]
    sprites.set(key, { img, w: img.naturalWidth, h: img.naturalHeight, screen: meta?.screen, tint: meta?.tint })
    if (--pending === 0) for (const f of listeners) f()
  }
  img.onerror = () => {
    if (--pending === 0) for (const f of listeners) f()
  }
  img.src = url
}

/** The sprite for "group/key", once it has loaded. */
export function sprite(key: string): Sprite | null {
  return sprites.get(key) ?? null
}

/** Runs once every sprite has loaded (right away when there is none or all are in). */
export function whenLoaded(f: () => void): void {
  if (pending === 0) f()
  else listeners.add(f)
}

/** Character sheets that stand for the agents (agente-01, agente-02…), sorted. */
export function agentSheets(): string[] {
  return [...sprites.keys()].filter((k) => /^personagens\/agente-\d+$/.test(k)).sort()
}

/** How many catalog sprites are in, for the perf panel. */
export function spriteCount(): number {
  return sprites.size
}
