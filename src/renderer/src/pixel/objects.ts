import * as THREE from 'three'
import { pxTag } from '../world/pixel-tag'
import { sprite, type Sprite } from './assets'
import type { Palette } from './tint'

// Which catalog sprite stands in for a built object, from its px() tag and the way it faces.

export type Facing = 'frente' | 'costas' | 'lado'

const FWD = new THREE.Vector3()

/** The way an object faces the viewer: front (+z), back, or a side (mirrored when it faces left). */
export function facingOf(obj: THREE.Object3D): { facing: Facing; mirror: boolean } {
  FWD.set(0, 0, 1).transformDirection(obj.matrixWorld)
  if (FWD.z > 0.7) return { facing: 'frente', mirror: false }
  if (FWD.z < -0.7) return { facing: 'costas', mirror: false }
  if (Math.abs(FWD.x) > 0.7) return { facing: 'lado', mirror: FWD.x < 0 }
  return { facing: 'frente', mirror: false }
}

const PLANTS: Record<string, string> = {
  tall: 'planta-alta',
  bush: 'planta-arbusto',
  fern: 'planta-samambaia',
  flower: 'planta-flor',
  cactus: 'cacto',
}
const ART: Record<string, string> = {
  mondrian: 'quadro-mondrian',
  mountains: 'quadro-montanhas',
  sunset: 'quadro-por-do-sol',
  plant: 'quadro-planta',
}

/** Catalog key per facing; one string = any facing. */
const BY_TAG: Record<string, string | Partial<Record<Facing, string>>> = {
  desk: { frente: 'moveis/mesa-trabalho' },
  bossDesk: { frente: 'moveis/mesa-chefe' },
  monitor: { frente: 'moveis/monitor' },
  monitorBack: 'moveis/monitor-costas',
  laptop: 'moveis/notebook',
  deskLamp: 'moveis/luminaria-mesa',
  officeChair: { costas: 'moveis/cadeira-escritorio-costas' },
  bossChair: { frente: 'moveis/cadeira-chefe' },
  simpleChair: { frente: 'moveis/cadeira-simples', lado: 'moveis/cadeira-simples-lado', costas: 'moveis/cadeira-simples-costas' },
  armchair: { frente: 'moveis/poltrona', lado: 'moveis/poltrona-lado' },
  coffeeTable: 'moveis/mesa-centro',
  bookshelf: { frente: 'moveis/estante' },
  cabinet: 'moveis/arquivo',
  waterCooler: 'moveis/bebedouro',
  printer: 'moveis/impressora',
  floorLamp: 'moveis/luminaria-chao',
  trash: 'moveis/lixeira',
  foosball: 'moveis/pebolim',
  pingPong: 'moveis/pingue-pongue',
  arcade: { frente: 'moveis/fliperama', costas: 'moveis/fliperama-costas' },
  beanBag: 'moveis/puff',
  lowTable: 'moveis/mesa-baixa',
  roundTable: 'moveis/mesa-redonda',
  stool: 'moveis/banqueta',
  barTable: 'moveis/mesa-bar',
  kitchenCounter: { frente: 'moveis/bancada', lado: 'moveis/bancada-lado', costas: 'moveis/bancada-costas' },
  fridge: { frente: 'moveis/geladeira', lado: 'moveis/geladeira-lado', costas: 'moveis/geladeira-costas' },
  microwave: 'moveis/micro-ondas',
  coffeeMachine: 'moveis/cafeteira',
  coffeeCorner: 'moveis/cafeteira',
  monitorTv: { frente: 'moveis/tv-lounge' },
  tank: 'moveis/tanque-agua',
  acUnit: 'moveis/ar-condicionado',
  wallWindow: { frente: 'parede/janela' },
  clock: { frente: 'parede/relogio' },
  tv: { frente: 'parede/tv-parede' },
  beacon: { frente: 'parede/sirene' },
}

export interface SpriteUse {
  key: string
  sprite: Sprite
  /** The piece's own colors for a recolorable sprite (the 3D colors: fabric, desk top and legs). */
  palette: Palette
  mirror: boolean
  /** Copies side by side (kitchen counter modules), along x or z. */
  repeat: { n: number; axis: 'x' | 'z' } | null
}

/** The catalog sprite for an object, or null when it has none (yet) and is drawn from its 3D pieces. */
export function spriteFor(obj: THREE.Object3D, open = 0): SpriteUse | null {
  const tag = pxTag(obj)
  if (!tag) return null
  const { facing, mirror } = facingOf(obj)
  let key: string | undefined
  switch (tag.key) {
    case 'plant':
      key = `moveis/${PLANTS[String(tag.kind)]}`
      break
    case 'art':
      key = facing === 'frente' ? `parede/${ART[String(tag.kind)]}` : undefined
      break
    case 'sofa':
      key = tag.len === 3 && facing === 'frente' ? 'moveis/sofa' : tag.len === 2 && facing === 'lado' ? 'moveis/sofa-lado' : undefined
      break
    case 'elevator':
      key = facing === 'frente' ? (open > 0.3 ? 'parede/elevador-aberto' : 'parede/elevador') : undefined
      break
    default: {
      const by = BY_TAG[tag.key]
      key = typeof by === 'string' ? by : by?.[facing]
    }
  }
  const s = key ? sprite(key) : null
  if (!s) return null
  const len = Number(tag.len) || 1
  const repeat = tag.key === 'kitchenCounter' && len > 1 ? { n: len, axis: facing === 'lado' ? ('z' as const) : ('x' as const) } : null
  // color A (red key) is the fabric or the desk top, color B (blue key) the desk's legs and frame
  const palette: Palette = {}
  if (typeof tag.color === 'string') palette.shirt = tag.color
  if (typeof tag.top === 'string') palette.shirt = tag.top
  if (typeof tag.legs === 'string') palette.pants = tag.legs
  return { key: key!, sprite: s, palette, mirror: facing === 'lado' && mirror, repeat }
}

/** How open an elevator's doors are (0 shut, 1 open), from the door meshes. */
export function doorsOpen(obj: THREE.Object3D): number {
  const doors = pxTag(obj)?.doors as THREE.Object3D[] | undefined
  if (!doors?.length) return 0
  return Math.max(0, Math.min(1, (1 - doors[0].scale.x / 0.72) / 0.9))
}
