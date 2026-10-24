/** RGBA image, 4 bytes per pixel, row by row. */
export interface RgbaImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export function crc32(bytes: Uint8Array, start?: number, end?: number): number
export function isPng(bytes: Uint8Array): boolean
export function decodePng(bytes: Uint8Array): RgbaImage
export function encodePng(image: RgbaImage, options?: { filter?: 0 | 1 | 2 | 3 | 4 }): Buffer
