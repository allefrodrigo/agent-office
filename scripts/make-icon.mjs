// Generates resources/icon.png (1024x1024) from a 32x32 pixel-art drawing.
// Run: node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const N = 32
const SCALE = 32
const px = Array.from({ length: N * N }, () => null)
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]
const set = (x, y, c) => {
  if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] = hex(c)
}
const rect = (x, y, w, h, c) => {
  for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) set(i, j, c)
}

// rounded background, macOS-style margin
for (let y = 2; y < 30; y++) {
  for (let x = 2; x < 30; x++) {
    const cx = Math.min(x - 2, 29 - x)
    const cy = Math.min(y - 2, 29 - y)
    if (cx < 4 && cy < 4 && (4 - cx) ** 2 + (4 - cy) ** 2 > 18) continue
    set(x, y, y < 16 ? '#34365a' : '#2a2b45')
  }
}

// plant
rect(24, 20, 4, 4, '#c56a45')
rect(23, 16, 6, 4, '#4fb35e')
rect(24, 15, 4, 1, '#3f9b4f')
rect(25, 14, 2, 1, '#5cc46a')

// desk
rect(9, 17, 15, 2, '#f3efe6')
rect(9, 19, 15, 1, '#c9c2b3')
rect(10, 20, 1, 4, '#4b4f63')
rect(22, 20, 1, 4, '#4b4f63')

// monitor with a glowing orange screen and the sparkle
rect(10, 6, 13, 10, '#1d1b26')
rect(11, 7, 11, 8, '#d97757')
rect(15, 16, 3, 1, '#1d1b26')
const star = '#fff4ec'
rect(16, 8, 1, 7, star)
rect(13, 11, 7, 1, star)
rect(15, 10, 3, 3, star)

// little agent peeking in front of the desk
rect(4, 18, 6, 6, '#f6d3b3')
rect(3, 17, 8, 2, '#2b1d16')
rect(3, 19, 1, 2, '#2b1d16')
set(6, 21, '#1d1b26')
set(8, 21, '#1d1b26')
rect(3, 24, 8, 4, '#4a8fe0')
set(5, 22, '#f4a6a6')

// encode PNG
const W = N * SCALE
const raw = Buffer.alloc((W * 4 + 1) * W)
for (let y = 0; y < W; y++) {
  raw[y * (W * 4 + 1)] = 0
  for (let x = 0; x < W; x++) {
    const c = px[Math.floor(y / SCALE) * N + Math.floor(x / SCALE)] ?? [0, 0, 0, 0]
    raw.set(c, y * (W * 4 + 1) + 1 + x * 4)
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(W, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
mkdirSync('resources', { recursive: true })
writeFileSync('resources/icon.png', png)
console.log('resources/icon.png written')
