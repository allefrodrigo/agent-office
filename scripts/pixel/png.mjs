// Minimal PNG codec for npm run pixel: decodes any non-interlaced PNG into 8-bit RGBA and
// encodes 8-bit RGBA. Only node:zlib, so the script needs no dependency.
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function isPng(bytes) {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b)
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Undoes the per-row filters; returns the bare scanlines (stride bytes per row). */
function unfilter(raw, stride, height, bpp) {
  const out = new Uint8Array(stride * height)
  let src = 0
  for (let y = 0; y < height; y++) {
    const type = raw[src++]
    if (type > 4) throw new Error(`PNG corrompido (filtro ${type} na linha ${y}): baixe ou exporte a imagem de novo`)
    const row = y * stride
    const prev = row - stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0
      const b = y > 0 ? out[prev + x] : 0
      let pred = 0
      if (type === 1) pred = a
      else if (type === 2) pred = b
      else if (type === 3) pred = (a + b) >> 1
      else if (type === 4) pred = paeth(a, b, x >= bpp && y > 0 ? out[prev + x - bpp] : 0)
      out[row + x] = (raw[src++] + pred) & 0xff
    }
  }
  return out
}

/** Decodes a PNG file into { data: Uint8ClampedArray (RGBA 8-bit), width, height }. */
export function decodePng(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (!isPng(buf)) throw new Error('o arquivo não é um PNG: exporte a imagem como PNG')
  let header = null
  let palette = null
  let trns = null
  const idat = []
  let pos = 8
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const end = pos + 8 + length
    if (end + 4 > buf.length) throw new Error('PNG cortado no meio: baixe a imagem de novo')
    if (crc32(buf, pos + 4, end) !== buf.readUInt32BE(end)) throw new Error(`PNG corrompido (bloco ${type}): baixe a imagem de novo`)
    const chunk = buf.subarray(pos + 8, end)
    if (type === 'IHDR') {
      header = {
        width: chunk.readUInt32BE(0),
        height: chunk.readUInt32BE(4),
        depth: chunk[8],
        colorType: chunk[9],
        interlace: chunk[12],
      }
    } else if (type === 'PLTE') palette = chunk
    else if (type === 'tRNS') trns = chunk
    else if (type === 'IDAT') idat.push(chunk)
    else if (type === 'IEND') break
    pos = end + 4
  }
  if (!header) throw new Error('PNG sem cabeçalho (IHDR): baixe a imagem de novo')
  const { width, height, depth, colorType, interlace } = header
  const channels = CHANNELS[colorType]
  if (!channels || !DEPTHS[colorType].includes(depth)) throw new Error(`PNG com formato inválido (cor ${colorType}, ${depth} bits)`)
  if (interlace) {
    const err = new Error('PNG entrelaçado (Adam7) não é suportado: exporte de novo sem entrelaçamento')
    err.code = 'PNG_INTERLACED'
    throw err
  }
  if (colorType === 3 && !palette) throw new Error('PNG com paleta mas sem o bloco PLTE: exporte a imagem de novo')
  if (!width || !height || idat.length === 0) throw new Error('PNG vazio: exporte a imagem de novo')

  const bitsPerPixel = channels * depth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const stride = (width * bitsPerPixel + 7) >> 3
  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length < (stride + 1) * height) throw new Error('PNG cortado no meio: baixe a imagem de novo')
  const px = unfilter(raw, stride, height, bpp)

  const max = depth === 16 ? 0xffff : (1 << depth) - 1
  const sample =
    depth === 8
      ? (row, i) => px[row + i]
      : depth === 16
        ? (row, i) => (px[row + 2 * i] << 8) | px[row + 2 * i + 1]
        : (row, i) => (px[row + ((i * depth) >> 3)] >> (8 - depth - ((i * depth) & 7))) & max
  const to8 = depth === 8 ? (v) => v : depth === 16 ? (v) => v >> 8 : (v) => Math.round((v * 255) / max)
  // tRNS for gray / RGB: the 16-bit sample value(s) that mean "fully transparent"
  const key = trns && (colorType === 0 || colorType === 2) ? [0, 2, 4].slice(0, channels).map((o) => trns.readUInt16BE(o)) : null

  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const i = x * channels
      if (colorType === 3) {
        const idx = sample(row, i)
        if (idx * 3 + 2 >= palette.length) throw new Error('PNG corrompido (cor fora da paleta): exporte a imagem de novo')
        data[o] = palette[idx * 3]
        data[o + 1] = palette[idx * 3 + 1]
        data[o + 2] = palette[idx * 3 + 2]
        data[o + 3] = trns && idx < trns.length ? trns[idx] : 255
      } else if (colorType === 0 || colorType === 4) {
        const g = sample(row, i)
        data[o] = data[o + 1] = data[o + 2] = to8(g)
        data[o + 3] = colorType === 4 ? to8(sample(row, i + 1)) : key && g === key[0] ? 0 : 255
      } else {
        const r = sample(row, i)
        const g = sample(row, i + 1)
        const b = sample(row, i + 2)
        data[o] = to8(r)
        data[o + 1] = to8(g)
        data[o + 2] = to8(b)
        data[o + 3] = colorType === 6 ? to8(sample(row, i + 3)) : key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255
      }
    }
  }
  return { data, width, height }
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length)
  out.writeUInt32BE(body.length, 0)
  out.write(type, 4, 'latin1')
  body.copy(out, 8)
  out.writeUInt32BE(crc32(out, 4, 8 + body.length), 8 + body.length)
  return out
}

/** Writes row y of RGBA data filtered with `type` into `out`. */
function filterRow(data, y, stride, type, out) {
  const row = y * stride
  for (let x = 0; x < stride; x++) {
    const a = x >= 4 ? data[row + x - 4] : 0
    const b = y > 0 ? data[row - stride + x] : 0
    let pred = 0
    if (type === 1) pred = a
    else if (type === 2) pred = b
    else if (type === 3) pred = (a + b) >> 1
    else if (type === 4) pred = paeth(a, b, x >= 4 && y > 0 ? data[row - stride + x - 4] : 0)
    out[x] = (data[row + x] - pred) & 0xff
  }
}

/** Encodes RGBA 8-bit as PNG. Each row takes the filter with the smallest output ("best of 5"), unless `filter` forces one. */
export function encodePng(image, { filter } = {}) {
  const { data, width, height } = image
  if (data.length !== width * height * 4) throw new Error(`imagem inválida: esperava ${width * height * 4} bytes, veio ${data.length}`)
  const stride = width * 4
  const types = filter === undefined ? [0, 1, 2, 3, 4] : [filter]
  const rows = Buffer.alloc((stride + 1) * height)
  const scratch = Buffer.alloc(stride)
  const best = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    let bestType = types[0]
    let bestScore = Infinity
    for (const type of types) {
      filterRow(data, y, stride, type, scratch)
      let score = 0
      for (let x = 0; x < stride; x++) score += scratch[x] < 128 ? scratch[x] : 256 - scratch[x]
      if (score < bestScore) {
        bestScore = score
        bestType = type
        scratch.copy(best)
      }
    }
    rows[y * (stride + 1)] = bestType
    best.copy(rows, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
