import type { RgbaImage } from './png.mjs'

export type { RgbaImage }
export type Rgb = [number, number, number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** One entry of pixel-catalog.json `sprites`. */
export interface SpriteSpec {
  w: number
  h: number
  tiles?: number[]
  screen?: boolean
  wall?: boolean
  /** "h": the height rules, the width may grow up to FIT_H_MAX_WIDTH x w. */
  fit?: 'h'
  /** Painted in key hues the app recolors (pixel/tint.ts); the output gets a { tint: true } sidecar. */
  tint?: boolean
  prio?: number
  label?: string
}

/** pixel-catalog.json `characters`. */
export interface CharacterSpec {
  cell: number[]
  grid: number[]
  standHeight: number
  poses: string[][]
  names?: string[]
}

export interface SheetLayout {
  grid: [number, number]
  keys: (string | null)[]
}

export interface SheetCell {
  rect: Rect
  box: Rect | null
  members?: Set<number>
}

export interface SpriteResult {
  image: RgbaImage
  size: [number, number]
  warnings: string[]
  /** [x, y, w, h] of the screen in output pixels (screen sprites only). */
  screen?: [number, number, number, number]
  tint?: boolean
}

export type SceneCellResult = { key: string; cell: number; where: string } & (SpriteResult | { error: string })

export interface Options {
  tolerance?: number
  /** A magenta background is a chroma key too (recolorable templates, which have no screen). */
  magentaKey?: boolean
}

export const DEFAULT_TOLERANCE: number
export const SPECK_SHARE: number
export const GAP_SHARE: number
export const FIT_H_MAX_WIDTH: number
export const SCREEN_HOLE: readonly [number, number, number, number]

export function createImage(width: number, height: number): RgbaImage
export function cloneImage(img: RgbaImage): RgbaImage
export function crop(img: RgbaImage, rect: Rect): RgbaImage
export function paste(dst: RgbaImage, src: RgbaImage, x: number, y: number): RgbaImage
export function countOpaque(img: RgbaImage): number
export function hasRealAlpha(img: RgbaImage): boolean
export function backgroundColors(img: RgbaImage, tolerance?: number): Rgb[]
export function removeBackground(img: RgbaImage, options?: Options): { image: RgbaImage; colors: Rgb[] | null }
export function removeSpecks(img: RgbaImage, minPixels: number): RgbaImage
export function opaqueBounds(img: RgbaImage, area?: Rect): Rect | null
export function isMagenta(r: number, g: number, b: number): boolean
export function findScreen(img: RgbaImage): { image: RgbaImage; rect: Rect | null }
export function downscaleMode(img: RgbaImage, ow: number, oh: number): RgbaImage
export function finishSprite(clean: RgbaImage, spec: SpriteSpec, warnings?: string[]): SpriteResult
export function processSprite(img: RgbaImage, spec: SpriteSpec, options?: Options): SpriteResult
export function processFloor(img: RgbaImage, spec: SpriteSpec): SpriteResult
export function findBands(counts: ArrayLike<number>, minGap: number): [number, number][]
export function sliceSheet(
  img: RgbaImage,
  cols: number,
  rows: number,
  options?: { expected?: boolean[]; noun?: [string, string] },
): { cells: SheetCell[]; warnings: string[]; labels: Int32Array | null; found: number }
export function cellArt(img: RgbaImage, cell: SheetCell, labels: Int32Array | null): RgbaImage
export function processSheet(
  img: RgbaImage,
  characters: CharacterSpec,
  options?: Options,
): { image: RgbaImage; scale: number; warnings: string[] }
export function parseSheetLayout(layout: unknown): SheetLayout
export function processSceneSheet(
  img: RgbaImage,
  layout: unknown,
  sprites: Record<string, SpriteSpec>,
  options?: Options & { only?: Set<string> },
): { results: SceneCellResult[]; warnings: string[] }
