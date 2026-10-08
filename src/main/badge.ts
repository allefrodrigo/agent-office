import { deflateSync } from 'node:zlib'

/**
 * Taskbar overlay for Windows (ADR-run-2): a red disc with the pending count,
 * drawn in code and encoded as PNG, so no image file, dependency or IPC is involved.
 * Only imports node:* so `npm test` runs it without Electron.
 */

/** '' for n <= 0 (or not a number), '1'…'9', '9+' above nine. */
export function badgeLabel(n: number): string {
  if (!Number.isFinite(n) || n < 1) return ''
  return n > 9 ? '9+' : String(Math.floor(n))
}

/** "1 pendência no Agent Office" / "{n} pendências no Agent Office" ('' for n <= 0). */
export function badgeDescription(n: number): string {
  if (!Number.isFinite(n) || n < 1) return ''
  const count = Math.floor(n)
  return count === 1 ? '1 pendência no Agent Office' : `${count} pendências no Agent Office`
}

// 3×5 pixel font, one string per row ('#' = on).
const GLYPHS: Record<string, string[]> = {
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '+': ['...', '.#.', '###', '.#.', '...'],
}

const FILL = [0xe5, 0x48, 0x4d] as const
const BORDER = [0x9b, 0x1c, 0x22] as const
const TEXT = [0xff, 0xff, 0xff] as const

/** RGBA pixels (size*size*4) of a red disc with the label in a 3×5 pixel font (×2 at 32 px). */
export function badgePixels(label: string, size: 16 | 32): Uint8Array {
  const px = new Uint8Array(size * size * 4)
  const scale = size / 16
  const c = size / 2
  const outer = size / 2
  const inner = outer - scale // 1 px border at 16 px, 2 px at 32 px
  const SS = 4 // supersampling per axis for soft edges

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inDisc = 0
      let inFill = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = x + (sx + 0.5) / SS - c
          const dy = y + (sy + 0.5) / SS - c
          const d = Math.hypot(dx, dy)
          if (d <= outer) inDisc++
          if (d <= inner) inFill++
        }
      }
      if (!inDisc) continue
      // colour: blend border and fill by how much of the pixel is inside the fill
      const t = inFill / inDisc
      const i = (y * size + x) * 4
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(BORDER[k] * (1 - t) + FILL[k] * t)
      px[i + 3] = Math.round((inDisc / (SS * SS)) * 255)
    }
  }

  const glyphs = [...label].map((ch) => GLYPHS[ch]).filter((g): g is string[] => !!g)
  if (!glyphs.length) return px
  const textW = (glyphs.length * 4 - 1) * scale
  const textH = 5 * scale
  const x0 = Math.floor((size - textW) / 2)
  const y0 = Math.floor((size - textH) / 2)
  glyphs.forEach((rows, gi) => {
    rows.forEach((row, ry) => {
      ;[...row].forEach((on, rx) => {
        if (on !== '#') return
        for (let oy = 0; oy < scale; oy++) {
          for (let ox = 0; ox < scale; ox++) {
            const x = x0 + (gi * 4 + rx) * scale + ox
            const y = y0 + ry * scale + oy
            const i = (y * size + x) * 4
            px.set([TEXT[0], TEXT[1], TEXT[2], 255], i)
          }
        }
      })
    })
  })
  return px
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** Minimal PNG encoder (IHDR/IDAT/IEND, zlib deflate, CRC32) — the one in scripts/make-icon.mjs, typed. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: buffer size does not match width × height × 4')
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
