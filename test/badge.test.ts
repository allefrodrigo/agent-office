import { test } from 'vitest'
import assert from 'node:assert/strict'
import { crc32, inflateSync } from 'node:zlib'
import { badgeDescription, badgeLabel, badgePixels, encodePng } from '../src/main/badge'

test('badgeLabel: empty at zero or invalid, digit up to nine, 9+ above', () => {
  assert.equal(badgeLabel(0), '')
  assert.equal(badgeLabel(-3), '')
  assert.equal(badgeLabel(NaN), '')
  assert.equal(badgeLabel(1), '1')
  assert.equal(badgeLabel(9), '9')
  assert.equal(badgeLabel(10), '9+')
  assert.equal(badgeLabel(250), '9+')
})

test('badgeDescription: singular, plural and empty (Narrator text, count only)', () => {
  assert.equal(badgeDescription(0), '')
  assert.equal(badgeDescription(-1), '')
  assert.equal(badgeDescription(NaN), '')
  assert.equal(badgeDescription(1), '1 pendência no Agent Office')
  assert.equal(badgeDescription(2), '2 pendências no Agent Office')
  assert.equal(badgeDescription(10), '10 pendências no Agent Office')
})

const at = (px: Uint8Array, size: number, x: number, y: number) => [...px.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)]

test('badgePixels: buffer size, transparent corners, red disc and white label', () => {
  for (const size of [16, 32] as const) {
    const px = badgePixels('1', size)
    assert.equal(px.length, size * size * 4)
    assert.deepEqual(at(px, size, 0, 0), [0, 0, 0, 0])
    assert.deepEqual(at(px, size, size - 1, size - 1), [0, 0, 0, 0])
    // just inside the left edge, at mid height: disc fill colour, opaque
    assert.deepEqual(at(px, size, 3 * (size / 16), size / 2), [0xe5, 0x48, 0x4d, 255])
  }
  // '1' at 16 px: glyph is 3 px wide → starts at x=6; middle column (x=7) is lit on every row (y=5…9)
  const one = badgePixels('1', 16)
  for (let y = 5; y <= 9; y++) assert.deepEqual(at(one, 16, 7, y), [255, 255, 255, 255])
  // empty label: just the disc
  const blank = badgePixels('', 16)
  assert.deepEqual(at(blank, 16, 8, 8), [0xe5, 0x48, 0x4d, 255])
  // 9+ has more white pixels than 9
  const white = (p: Uint8Array) => p.reduce((n, v, i) => (i % 4 === 0 && v === 255 && p[i + 1] === 255 && p[i + 2] === 255 ? n + 1 : n), 0)
  assert.ok(white(badgePixels('9+', 16)) > white(badgePixels('9', 16)))
})

test('encodePng: signature, IHDR with a valid CRC and pixels that round-trip', () => {
  const rgba = badgePixels('9+', 16)
  const png = encodePng(16, 16, rgba)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(png.readUInt32BE(8), 13)
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR')
  assert.equal(png.readUInt32BE(16), 16)
  assert.equal(png.readUInt32BE(20), 16)
  assert.equal(png.readUInt32BE(29), crc32(png.subarray(12, 29)))
  assert.equal(png.subarray(-8, -4).toString('ascii'), 'IEND')

  const idatLen = png.readUInt32BE(33)
  assert.equal(png.subarray(37, 41).toString('ascii'), 'IDAT')
  const idat = png.subarray(41, 41 + idatLen)
  assert.equal(png.readUInt32BE(41 + idatLen), crc32(png.subarray(37, 41 + idatLen)))
  const raw = inflateSync(idat)
  assert.equal(raw.length, (16 * 4 + 1) * 16)
  for (let y = 0; y < 16; y++) {
    assert.equal(raw[y * 65], 0)
    assert.deepEqual([...raw.subarray(y * 65 + 1, (y + 1) * 65)], [...rgba.subarray(y * 64, (y + 1) * 64)])
  }
  assert.throws(() => encodePng(16, 16, new Uint8Array(10)))
})
