// Pure image processing for npm run pixel (2D pixel art sprites). Images are
// { data: Uint8ClampedArray (RGBA), width, height }; nothing here touches the disk.

/** RGB distance under which a pixel still counts as background (handles slightly uneven backgrounds). */
export const DEFAULT_TOLERANCE = 40
/** Loose blobs smaller than this share of the image are noise, not art. */
export const SPECK_SHARE = 0.0005
/** Gaps between bands narrower than this share of the side are merged (keeps a pose in one piece). */
export const GAP_SHARE = 0.015
/** The magenta screen of the raw art becomes a hole: the app paints the live picture under the sprite. */
export const SCREEN_HOLE = [0, 0, 0, 0]
/** Free rows under the feet in a character cell. */
const FOOT_GAP = 2

export const isMagenta = (r, g, b) => r > 190 && g < 90 && b > 190

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const speckSize = (img) => Math.max(1, Math.round(img.width * img.height * SPECK_SHARE))
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`

export function createImage(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height }
}

export function cloneImage(img) {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }
}

export function crop(img, rect) {
  const out = createImage(rect.w, rect.h)
  for (let y = 0; y < rect.h; y++) {
    const start = ((rect.y + y) * img.width + rect.x) * 4
    out.data.set(img.data.subarray(start, start + rect.w * 4), y * rect.w * 4)
  }
  return out
}

/** Copies the opaque pixels of `src` onto `dst`, with src's top-left corner at (x, y). Returns dst. */
export function paste(dst, src, x, y) {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = y + sy
    if (dy < 0 || dy >= dst.height) continue
    for (let sx = 0; sx < src.width; sx++) {
      const dx = x + sx
      const s = (sy * src.width + sx) * 4
      if (dx < 0 || dx >= dst.width || src.data[s + 3] < 128) continue
      dst.data.set(src.data.subarray(s, s + 4), (dy * dst.width + dx) * 4)
    }
  }
  return dst
}

export function countOpaque(img) {
  let n = 0
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] >= 128) n++
  return n
}

// ---- background ----

function borderPixels(w, h) {
  const out = range(w, (x) => x)
  if (h > 1) for (let x = 0; x < w; x++) out.push((h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) {
    out.push(y * w)
    if (w > 1) out.push(y * w + w - 1)
  }
  return out
}

function distance2(data, i, [r, g, b]) {
  const dr = data[i] - r
  const dg = data[i + 1] - g
  const db = data[i + 2] - b
  return dr * dr + dg * dg + db * db
}

/** Most frequent color among `pixels` (4-bit buckets), as the average of its bucket. */
function dominantColor(data, pixels) {
  const counts = new Uint32Array(4096)
  const sums = new Float64Array(4096 * 3)
  let best = -1
  for (const p of pixels) {
    const i = p * 4
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    counts[key]++
    sums[key * 3] += data[i]
    sums[key * 3 + 1] += data[i + 1]
    sums[key * 3 + 2] += data[i + 2]
    if (best < 0 || counts[key] > counts[best]) best = key
  }
  const n = counts[best]
  return [0, 1, 2].map((c) => Math.round(sums[best * 3 + c] / n))
}

/** True when a good part of the border is already transparent: the image brings its own alpha. */
export function hasRealAlpha(img) {
  const border = borderPixels(img.width, img.height)
  return border.filter((p) => img.data[p * 4 + 3] < 250).length >= border.length * 0.4
}

/**
 * The 1-2 background colors seen on the border: the dominant one, plus a second one when it shows
 * up all around (gray/white checkerboard). An object touching one edge does not count as background.
 */
export function backgroundColors(img, tolerance = DEFAULT_TOLERANCE) {
  const { data, width: w, height: h } = img
  const border = borderPixels(w, h)
  const tol2 = tolerance * tolerance
  const first = dominantColor(data, border)
  const rest = border.filter((p) => distance2(data, p * 4, first) > tol2)
  if (rest.length < border.length * 0.2) return [first]
  const second = dominantColor(data, rest)
  const sides = [range(w, (x) => x), range(w, (x) => (h - 1) * w + x), range(h, (y) => y * w), range(h, (y) => y * w + w - 1)]
  const near = (p) => distance2(data, p * 4, second) <= tol2
  const spread = sides.filter((side) => side.filter(near).length >= side.length * 0.1).length
  return spread >= 3 ? [first, second] : [first]
}

/** Background mask: pixels close to `colors` that connect to the border (4-neighbors). */
function floodBackground(img, colors, tolerance) {
  const { data, width: w, height: h } = img
  const n = w * h
  const tol2 = tolerance * tolerance
  const bg = new Uint8Array(n)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  const visit = (p) => {
    if (bg[p]) return
    const i = p * 4
    for (const color of colors) {
      if (distance2(data, i, color) <= tol2) {
        bg[p] = 1
        queue[tail++] = p
        return
      }
    }
  }
  for (const p of borderPixels(w, h)) visit(p)
  while (head < tail) {
    const p = queue[head++]
    const x = p % w
    if (x > 0) visit(p - 1)
    if (x < w - 1) visit(p + 1)
    if (p >= w) visit(p - w)
    if (p < n - w) visit(p + w)
  }
  return bg
}

/** Saturated key colors (green screen, blue screen) that never belong to the art; magenta is the screen. */
const isChroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) >= 150 && !isMagenta(r, g, b)

/** Soft edges blend the key into the art: peels up to 2 px of key-tinted pixels (3x tolerance) off the art's edge. */
function peelFringe(d, w, h, keys, tolerance) {
  const n = w * h
  const limit = (3 * tolerance) ** 2
  const clear = (p) => d[p * 4 + 3] === 0
  for (let pass = 0; pass < 2; pass++) {
    const peel = []
    for (let p = 0; p < n; p++) {
      if (clear(p)) continue
      const x = p % w
      const edge = (x > 0 && clear(p - 1)) || (x < w - 1 && clear(p + 1)) || (p >= w && clear(p - w)) || (p < n - w && clear(p + w))
      if (edge && keys.some((c) => distance2(d, p * 4, c) <= limit)) peel.push(p)
    }
    for (const p of peel) d[p * 4 + 3] = 0
  }
}

/**
 * Makes the background transparent and the alpha binary (< 128 -> 0, else 255). Uses the image's own
 * alpha when it has one; otherwise flood-fills from the border. Enclosed areas stay (white inside a
 * white fridge), except on a chroma key background, whose enclosed holes (between a raised arm and
 * the head) and key-tinted soft edges go too. `colors` = removed colors, null when the image's alpha was used.
 */
export function removeBackground(img, { tolerance = DEFAULT_TOLERANCE, magentaKey = false } = {}) {
  const out = cloneImage(img)
  const d = out.data
  let colors = null
  if (!hasRealAlpha(img)) {
    colors = backgroundColors(img, tolerance)
    const bg = floodBackground(img, colors, tolerance)
    // a magenta background is a key too when nothing in the image is a screen (recolorable templates)
    const keys = colors.filter((c) => isChroma(c) || (magentaKey && isMagenta(...c)))
    const tol2 = tolerance * tolerance
    for (let p = 0; p < bg.length; p++) {
      if (bg[p] || keys.some((c) => distance2(d, p * 4, c) <= tol2)) d[p * 4 + 3] = 0
    }
    if (keys.length) peelFringe(d, img.width, img.height, keys, tolerance)
  }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0
    else d[i + 3] = 255
  }
  return { image: out, colors }
}

// ---- blobs and bounds ----

function opaqueMask(img) {
  const mask = new Uint8Array(img.width * img.height)
  for (let p = 0; p < mask.length; p++) mask[p] = img.data[p * 4 + 3] >= 128 ? 1 : 0
  return mask
}

/** 8-connected components of `mask`: labels (component index + 1, 0 = off) and each one's size and box. */
function components(mask, w, h) {
  const labels = new Int32Array(w * h)
  const queue = new Int32Array(w * h)
  const list = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue
    const id = list.length + 1
    let head = 0
    let tail = 0
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    labels[start] = id
    queue[tail++] = start
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      const y = (p - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const q = ny * w + nx
          if (mask[q] && !labels[q]) {
            labels[q] = id
            queue[tail++] = q
          }
        }
      }
    }
    list.push({ id, size: tail, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })
  }
  return { labels, list }
}

/** Clears opaque blobs smaller than `minPixels` (stray dots left by the background removal). */
export function removeSpecks(img, minPixels) {
  const { labels, list } = components(opaqueMask(img), img.width, img.height)
  const out = cloneImage(img)
  for (let p = 0; p < labels.length; p++) {
    const id = labels[p]
    if (id && list[id - 1].size < minPixels) out.data.fill(0, p * 4, p * 4 + 4)
  }
  return out
}

/** Box of the opaque pixels inside `area` (whole image by default), or null when there are none. */
export function opaqueBounds(img, area = { x: 0, y: 0, w: img.width, h: img.height }) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] < 128) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

// ---- screen ----

/**
 * Finds the magenta screen: its box (all magenta blobs, so a window split by a cross counts whole;
 * stray dots under 2% of the magenta are ignored) and the image with those pixels cut out (SCREEN_HOLE).
 */
export function findScreen(img) {
  const { data, width: w, height: h } = img
  const mask = new Uint8Array(w * h)
  let total = 0
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4
    if (data[i + 3] >= 128 && isMagenta(data[i], data[i + 1], data[i + 2])) {
      mask[p] = 1
      total++
    }
  }
  if (!total) return { image: img, rect: null }
  const parts = components(mask, w, h).list.filter((c) => c.size >= total * 0.02)
  const x0 = Math.min(...parts.map((c) => c.x))
  const y0 = Math.min(...parts.map((c) => c.y))
  const x1 = Math.max(...parts.map((c) => c.x + c.w))
  const y1 = Math.max(...parts.map((c) => c.y + c.h))
  const out = cloneImage(img)
  for (let p = 0; p < mask.length; p++) if (mask[p]) out.data.set(SCREEN_HOLE, p * 4)
  return { image: out, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }
}

// ---- resampling ----

/**
 * Resizes to ow x oh by "mode": each output pixel looks at its source block; under half opaque it
 * stays transparent, otherwise it takes the most frequent color (5-bit buckets), averaged within
 * that bucket. Keeps the palette crisp instead of blurring neighbors together.
 */
const luma = (key) => 2 * (key >> 10) + 4 * ((key >> 5) & 31) + (key & 31)

export function downscaleMode(img, ow, oh) {
  const { data, width: w, height: h } = img
  const out = createImage(ow, oh)
  const counts = new Uint32Array(32768)
  const sums = new Float64Array(32768 * 3)
  const touched = []
  for (let oy = 0; oy < oh; oy++) {
    const y0 = Math.floor((oy * h) / oh)
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * h) / oh))
    for (let ox = 0; ox < ow; ox++) {
      const x0 = Math.floor((ox * w) / ow)
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * w) / ow))
      let opaque = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4
          if (data[i + 3] < 128) continue
          opaque++
          const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
          if (counts[key]++ === 0) touched.push(key)
          sums[key * 3] += data[i]
          sums[key * 3 + 1] += data[i + 1]
          sums[key * 3 + 2] += data[i + 2]
        }
      }
      if (opaque * 2 >= (x1 - x0) * (y1 - y0)) {
        let best = touched[0]
        // ties go to the darker bucket, so thin outlines do not depend on scan order
        for (const key of touched) if (counts[key] > counts[best] || (counts[key] === counts[best] && luma(key) < luma(best))) best = key
        const n = counts[best]
        const o = (oy * ow + ox) * 4
        out.data[o] = Math.round(sums[best * 3] / n)
        out.data[o + 1] = Math.round(sums[best * 3 + 1] / n)
        out.data[o + 2] = Math.round(sums[best * 3 + 2] / n)
        out.data[o + 3] = 255
      }
      for (const key of touched) {
        counts[key] = 0
        sums[key * 3] = sums[key * 3 + 1] = sums[key * 3 + 2] = 0
      }
      touched.length = 0
    }
  }
  return out
}

// ---- single sprites ----

function mapRect(r, art, ow, oh, x, y) {
  const sx = ow / art.width
  const sy = oh / art.height
  const x0 = Math.round(r.x * sx)
  const y0 = Math.round(r.y * sy)
  const x1 = Math.round((r.x + r.w) * sx)
  const y1 = Math.round((r.y + r.h) * sy)
  return [x + x0, y + y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)]
}

/** With fit "h" the height rules and the width may reach this many times the catalog width. */
export const FIT_H_MAX_WIDTH = 1.6

/**
 * Sprite steps after the background is gone: drop specks, crop, take the magenta screen out (when
 * spec.screen), reduce by mode (never enlarging) and anchor at bottom center. By default the art fits
 * inside spec.w x spec.h; with spec.fit "h" it fills spec.h and may grow up to 1.6 w wide, and the
 * output gets that width.
 */
export function finishSprite(clean, spec, warnings = []) {
  const solid = removeSpecks(clean, speckSize(clean))
  const box = opaqueBounds(solid)
  if (!box) {
    throw new Error(
      'a imagem ficou vazia depois de tirar o fundo: gere de novo com o objeto sobre um fundo liso, de cor bem diferente da dele',
    )
  }
  let art = crop(solid, box)
  let screen = null
  if (spec.screen) {
    const found = findScreen(art)
    if (!found.rect) throw new Error('não achei a tela em magenta (#FF00FF): gere de novo com a tela inteira pintada de magenta puro')
    art = found.image
    screen = found.rect
  }
  const byHeight = spec.fit === 'h'
  const maxW = byHeight ? Math.floor(spec.w * FIT_H_MAX_WIDTH) : spec.w
  const s = Math.min(maxW / art.width, spec.h / art.height, 1)
  const ow = clamp(Math.round(art.width * s), 1, maxW)
  const oh = clamp(Math.round(art.height * s), 1, spec.h)
  const outW = Math.max(spec.w, ow)
  const x = Math.floor((outW - ow) / 2)
  const y = spec.h - oh
  const image = paste(createImage(outW, spec.h), downscaleMode(art, ow, oh), x, y)
  if (s === 1 && ow < spec.w && oh < spec.h) {
    warnings.push(`a imagem é menor que o sprite (${ow}x${oh} para ${spec.w}x${spec.h}) e não foi aumentada: gere de novo em tamanho maior`)
  } else if (byHeight) {
    if (oh < spec.h * 0.75) {
      warnings.push(
        `o objeto é largo demais para a altura ${spec.h}: ficou ${ow}x${oh} (largura máxima ${maxW}); gere com proporção perto de ${spec.w}:${spec.h}`,
      )
    }
  } else if (ow < spec.w * 0.75 || oh < spec.h * 0.75) {
    warnings.push(
      `o objeto ocupa ${ow}x${oh} da caixa ${spec.w}x${spec.h}: para preencher, gere com proporção perto de ${spec.w}:${spec.h}`,
    )
  }
  const result = { image, size: [ow, oh], warnings }
  if (screen) result.screen = mapRect(screen, art, ow, oh, x, y)
  if (spec.tint) result.tint = true
  return result
}

/** A regular sprite from a raw image: background removal, then finishSprite. */
export function processSprite(img, spec, { tolerance } = {}) {
  const { image: clean, colors } = removeBackground(img, { tolerance, magentaKey: !spec.screen })
  const warnings = []
  if (colors && countOpaque(clean) > clean.width * clean.height * 0.9) {
    warnings.push('quase nada do fundo saiu: gere de novo com o objeto sobre um fundo liso, de cor bem diferente da dele')
  }
  return finishSprite(clean, spec, warnings)
}

/**
 * A floor texture: no background removal, no crop; the image is reduced whole. A square target takes
 * the center square; other targets (the wall strip) only lose the sides, so the baseboard stays.
 */
export function processFloor(img, spec) {
  const { w, h } = spec
  const target = w / h
  let area = { x: 0, y: 0, w: img.width, h: img.height }
  if (img.width / img.height > target) {
    const cw = clamp(Math.round(img.height * target), 1, img.width)
    area = { x: Math.floor((img.width - cw) / 2), y: 0, w: cw, h: img.height }
  } else if (w === h && img.height > img.width) {
    area = { x: 0, y: Math.floor((img.height - img.width) / 2), w: img.width, h: img.width }
  }
  const image = downscaleMode(crop(img, area), w, h)
  const warnings = []
  if (countOpaque(image) < w * h) warnings.push('o piso ficou com partes transparentes: gere de novo como textura opaca, sem fundo')
  return { image, size: [w, h], warnings }
}

// ---- sheets ----

/** Runs of non-zero counts as [start, end) pairs; runs separated by less than `minGap` merge. */
export function findBands(counts, minGap) {
  const bands = []
  let start = -1
  for (let i = 0; i <= counts.length; i++) {
    const on = i < counts.length && counts[i] > 0
    if (on && start < 0) start = i
    else if (!on && start >= 0) {
      const last = bands.at(-1)
      if (last && start - last[1] < minGap) last[1] = i
      else bands.push([start, i])
      start = -1
    }
  }
  return bands
}

function projection(img, area, axis) {
  const counts = new Uint32Array(axis === 'y' ? area.h : area.w)
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] >= 128) counts[axis === 'y' ? y - area.y : x - area.x]++
    }
  }
  return counts
}

/** Cell spans reaching halfway into the gaps between bands, so each cell keeps a margin of background. */
function spans(bands, size) {
  return bands.map(([s, e], i) => [
    i === 0 ? 0 : Math.floor((bands[i - 1][1] + s) / 2),
    i === bands.length - 1 ? size : Math.floor((e + bands[i + 1][0]) / 2),
  ])
}

const identity = (n) => range(n, (i) => i)
const slotOf = ([s, e], size, slots) => Math.min(slots - 1, Math.floor((((s + e) / 2) * slots) / size))
const inOwnSlots = (items, size) => items.every((item, i) => slotOf(item, size, items.length) === i)

/**
 * Places `items` ([start, end) spans) when there are fewer than `slots` because some wanted[] = false
 * cells came out empty: each item goes to the equal slot holding its center. Returns slot -> item
 * index (-1 = empty), or null when the count or the positions do not fit.
 */
function placeInSlots(items, size, slots, wanted) {
  if (items.length !== wanted.filter(Boolean).length) return null
  const bySlot = new Array(slots).fill(-1)
  for (const [i, item] of items.entries()) {
    const slot = slotOf(item, size, slots)
    if (bySlot[slot] >= 0 || !wanted[slot]) return null
    bySlot[slot] = i
  }
  return bySlot
}

/** Blobs centered inside `area`, grouped when their boxes come closer than `gap`; left to right. */
function groupBlobs(blobs, area, gap) {
  const inside = blobs.list.filter((c) => {
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2
    return cx >= area.x && cx < area.x + area.w && cy >= area.y && cy < area.y + area.h
  })
  if (inside.length > 2000) return null
  const parent = inside.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < inside.length; i++) {
    for (let j = i + 1; j < inside.length; j++) {
      const a = inside[i]
      const b = inside[j]
      const dx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)
      const dy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)
      if (dx < gap && dy < gap) parent[find(i)] = find(j)
    }
  }
  const groups = new Map()
  inside.forEach((c, i) => {
    const root = find(i)
    const g = groups.get(root) ?? { x0: Infinity, y0: Infinity, x1: -1, y1: -1, members: new Set() }
    g.x0 = Math.min(g.x0, c.x)
    g.y0 = Math.min(g.y0, c.y)
    g.x1 = Math.max(g.x1, c.x + c.w)
    g.y1 = Math.max(g.y1, c.y + c.h)
    g.members.add(c.id)
    groups.set(root, g)
  })
  return [...groups.values()]
    .map((g) => ({ box: { x: g.x0, y: g.y0, w: g.x1 - g.x0, h: g.y1 - g.y0 }, members: g.members }))
    .sort((a, b) => a.box.x + a.box.w / 2 - (b.box.x + b.box.w / 2))
}

/**
 * Splits a sheet (background already transparent) into cols x rows cells, in reading order. Rows come
 * from empty lines, then each row splits on empty columns; when that miscounts, blobs grouped by
 * proximity; when that fails too, equal parts (with a warning). `expected[i]` false = the cell may be
 * empty (null key). Each cell: { rect, box (art bounds or null), members? (blob ids, grouped cells) }.
 */
export function sliceSheet(img, cols, rows, { expected, noun = ['objeto', 'objetos'] } = {}) {
  const { width: w, height: h } = img
  const want = expected ?? new Array(cols * rows).fill(true)
  const wantInRow = range(rows, (r) => range(cols, (c) => want[r * cols + c] !== false))
  const gapY = Math.max(1, Math.ceil(h * GAP_SHARE))
  const gapX = Math.max(1, Math.ceil(w * GAP_SHARE))
  const warnings = []
  const cells = []
  let blobs = null
  const getBlobs = () => (blobs ??= components(opaqueMask(img), w, h))
  const uniform = (c, y0, y1) => {
    const x0 = Math.round((c * w) / cols)
    const rect = { x: x0, y: y0, w: Math.round(((c + 1) * w) / cols) - x0, h: y1 - y0 }
    return { rect, box: opaqueBounds(img, rect) }
  }
  const bandsY = findBands(projection(img, { x: 0, y: 0, w, h }, 'y'), gapY)
  const bandsX = bandsY.map(([y0, y1]) => findBands(projection(img, { x: 0, y: y0, w, h: y1 - y0 }, 'x'), gapX))
  const found = bandsX.reduce((n, b) => n + b.length, 0)
  const rowSlots =
    bandsY.length === rows
      ? identity(rows)
      : placeInSlots(
          bandsY,
          h,
          rows,
          wantInRow.map((row) => row.some(Boolean)),
        )
  if (!rowSlots) {
    warnings.push(
      `achei ${plural(found, noun)} em ${plural(bandsY.length, ['linha', 'linhas'])}, esperava ${rows} linhas de ${cols}: dividi a imagem numa grade ${cols}x${rows} igual`,
    )
    for (let r = 0; r < rows; r++) {
      const y0 = Math.round((r * h) / rows)
      for (let c = 0; c < cols; c++) cells.push(uniform(c, y0, Math.round(((r + 1) * h) / rows)))
    }
    return { cells, warnings, labels: null, found }
  }
  const rowSpans = spans(bandsY, h)
  for (let r = 0; r < rows; r++) {
    const band = rowSlots[r]
    if (band < 0) {
      const y0 = Math.round((r * h) / rows)
      for (let c = 0; c < cols; c++) cells.push({ ...uniform(c, y0, Math.round(((r + 1) * h) / rows)), box: null })
      continue
    }
    const [y0, y1] = rowSpans[band]
    const rowBands = bandsX[band]
    // Empty columns first; then blobs grouped by proximity that sit in their own slots; then the
    // reading where null cells came out empty; then any grouping with the right count.
    let slots = rowBands.length === cols ? identity(cols) : null
    let groups = null
    if (!slots) {
      const blobGroups = groupBlobs(getBlobs(), { x: 0, y: y0, w, h: y1 - y0 }, gapX) ?? []
      const items = blobGroups.map((g) => [g.box.x, g.box.x + g.box.w])
      const exact = blobGroups.length === cols
      const byBands = placeInSlots(rowBands, w, cols, wantInRow[r])
      const byGroups = placeInSlots(items, w, cols, wantInRow[r])
      if (exact && inOwnSlots(items, w)) [slots, groups] = [identity(cols), blobGroups]
      else if (byBands) slots = byBands
      else if (byGroups || exact) [slots, groups] = [byGroups ?? identity(cols), blobGroups]
      if (groups) warnings.push(`linha ${r + 1}: os ${noun[1]} não estão separados por colunas vazias; separei cada um pelos seus blocos`)
    }
    if (!slots) {
      warnings.push(`linha ${r + 1}: achei ${plural(rowBands.length, noun)}, esperava ${cols}: dividi a linha em ${cols} partes iguais`)
      for (let c = 0; c < cols; c++) cells.push(uniform(c, y0, y1))
      continue
    }
    const colSpans = spans(rowBands, w)
    for (let c = 0; c < cols; c++) {
      const k = slots[c]
      if (k < 0) cells.push({ ...uniform(c, y0, y1), box: null })
      else if (groups) cells.push({ rect: groups[k].box, box: groups[k].box, members: groups[k].members })
      else {
        const rect = { x: colSpans[k][0], y: y0, w: colSpans[k][1] - colSpans[k][0], h: y1 - y0 }
        cells.push({ rect, box: opaqueBounds(img, rect) })
      }
    }
  }
  return { cells, warnings, labels: blobs?.labels ?? null, found }
}

/** The art of one cell: its box cut from the clean sheet, keeping only its own blobs when grouped. */
export function cellArt(img, cell, labels) {
  const art = crop(img, cell.box)
  if (!cell.members || !labels) return art
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const id = labels[(cell.box.y + y) * img.width + cell.box.x + x]
      if (!cell.members.has(id)) art.data.fill(0, (y * art.width + x) * 4, (y * art.width + x + 1) * 4)
    }
  }
  return art
}

/**
 * Character sheet: finds the cols x rows poses, scales all by one factor (front pose = standHeight),
 * shrinks alone any pose that would not fit its cell, and draws each one centered with the feet
 * FOOT_GAP px above the cell bottom.
 */
export function processSheet(img, characters, { tolerance } = {}) {
  const [cellW, cellH] = characters.cell
  const [cols, rows] = characters.grid
  const names = characters.poses.flat()
  const footY = cellH - FOOT_GAP
  const { image: clean } = removeBackground(img, { tolerance, magentaKey: true })
  const solid = removeSpecks(clean, speckSize(img))
  const { cells, warnings, labels, found } = sliceSheet(solid, cols, rows, { noun: ['pose', 'poses'] })
  if (warnings.length)
    warnings.push('confira a folha gerada; se alguma pose saiu cortada ou misturada, gere de novo com espaço vazio entre as poses')
  cells.forEach((cell, i) => {
    if (cell.box) return
    const where = `linha ${Math.floor(i / cols) + 1}, coluna ${(i % cols) + 1}`
    throw new Error(
      `a pose "${names[i]}" (${where}) está vazia; achei ${plural(found, ['pose', 'poses'])}, esperava ${cols * rows}: gere de novo com as poses separadas por espaço vazio`,
    )
  })
  const s = characters.standHeight / cells[0].box.h
  const sheet = createImage(cellW * cols, cellH * rows)
  cells.forEach((cell, i) => {
    const art = cellArt(solid, cell, labels)
    let ow = Math.max(1, Math.round(art.width * s))
    let oh = Math.max(1, Math.round(art.height * s))
    if (ow > cellW || oh > footY) {
      const fit = Math.min(cellW / (art.width * s), footY / (art.height * s))
      const before = `${ow}x${oh}`
      ow = clamp(Math.round(art.width * s * fit), 1, cellW)
      oh = clamp(Math.round(art.height * s * fit), 1, footY)
      warnings.push(
        `a pose "${names[i]}" ficaria com ${before} e não cabe na célula ${cellW}x${cellH}: reduzi só ela para ${ow}x${oh}; se destoar, gere de novo com essa pose mais compacta`,
      )
    }
    const x = (i % cols) * cellW + Math.floor((cellW - ow) / 2)
    const y = Math.floor(i / cols) * cellH + footY - oh
    paste(sheet, downscaleMode(art, ow, oh), x, y)
  })
  outlineMagentaFringe(sheet)
  return { image: sheet, scale: s, warnings }
}

/** Outline color for leftovers of the magenta background (the prompts keep magenta out of people). */
const FRINGE_OUTLINE = [20, 20, 20]
/** Brightest channel of a blend of outline and magenta; brighter pinks are left alone. */
const FRINGE_MAX = 170

/**
 * A dark outline blended with the magenta background ((123, 1, 125)) is too far from magenta for
 * peelFringe and survives the cut as a pink dot on the edge. Character sheets never use magenta, so
 * any dark pixel left in its hue becomes outline (bright pinks are art, or peelFringe's job).
 */
function outlineMagentaFringe(img) {
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
    const max = Math.max(r, g, b)
    const chroma = max - Math.min(r, g, b)
    // magenta has no green at all; a purple blazer has plenty
    if (chroma < 40 || max > FRINGE_MAX || g > max * 0.12) continue
    const hue = (max === r ? ((g - b) / chroma + 6) % 6 : (r - g) / chroma + 4) * 60
    if (hue >= 275 && hue <= 335) d.set(FRINGE_OUTLINE, i)
  }
}

/** Validates a scene sheet's JSON ({ grid: [cols, rows], keys }); throws a message saying what to fix. */
export function parseSheetLayout(layout) {
  const grid = layout?.grid
  if (!Array.isArray(grid) || grid.length !== 2 || !grid.every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error('o JSON precisa de "grid": [colunas, linhas], ex.: { "grid": [3, 2], "keys": ["moveis/sofa", null, ...] }')
  }
  const [cols, rows] = grid
  const keys = layout.keys
  if (!Array.isArray(keys) || keys.length !== cols * rows) {
    throw new Error(
      `o JSON diz grade ${cols}x${rows} (${cols * rows} células) mas tem ${Array.isArray(keys) ? keys.length : 0} keys: liste uma por célula, linha por linha, com null nas vazias`,
    )
  }
  const bad = keys.find((k) => k !== null && (typeof k !== 'string' || !/^[^/]+\/[^/]+$/.test(k)))
  if (bad !== undefined) throw new Error(`key inválida no JSON: ${JSON.stringify(bad)}; use "grupo/chave" (ex.: "moveis/sofa") ou null`)
  return { grid: [cols, rows], keys }
}

/**
 * Scene sheet: many catalog sprites drawn in one grid image. Each cell with a key becomes a regular
 * sprite (its own background removal, crop, screen, mode, anchor); chao/* cells are cut and reduced
 * whole. `only` limits which keys run. Per-cell failures come back as { key, error }.
 */
export function processSceneSheet(img, layout, sprites, { tolerance, only } = {}) {
  const { grid, keys } = parseSheetLayout(layout)
  const [cols, rows] = grid
  const magentaKey = !keys.some((k) => k && sprites[k]?.screen)
  const { image: clean } = removeBackground(img, { tolerance, magentaKey })
  const solid = removeSpecks(clean, speckSize(img))
  const { cells, warnings, labels } = sliceSheet(solid, cols, rows, { expected: keys.map((k) => k !== null) })
  const results = []
  cells.forEach((cell, i) => {
    const key = keys[i]
    if (!key || (only && !only.has(key))) return
    const where = `célula ${i + 1} (linha ${Math.floor(i / cols) + 1}, coluna ${(i % cols) + 1})`
    try {
      const spec = sprites[key]
      if (!spec) throw new Error(`${key} não está no catálogo`)
      let result
      if (key.startsWith('chao/')) {
        result = processFloor(crop(img, cell.box ?? cell.rect), spec)
        if (!cell.box) result.warnings.push('não achei a textura separada do fundo: usei a célula inteira')
      } else if (!cell.box) {
        throw new Error('a célula está vazia: confira a ordem das keys no JSON (linha por linha, null nas vazias) ou gere a folha de novo')
      } else if (cell.members) result = finishSprite(cellArt(solid, cell, labels), spec)
      else result = processSprite(crop(img, cell.rect), spec, { tolerance })
      if (spec.tint) result.tint = true
      results.push({ key, cell: i, where, ...result })
    } catch (err) {
      results.push({ key, cell: i, where, error: err instanceof Error ? err.message : String(err) })
    }
  })
  return { results, warnings }
}

// ---------- eyes of the recolorable people: taken out of the art, drawn live by the app ----------

/** Cells with a face, and the annotated cell whose head each one repeats (front 0, side 2). */
export const EYE_POSES = { 0: 0, 3: 0, 4: 0, 8: 0, 2: 2, 6: 2, 7: 2, 10: 2 }
/** Least chroma for a pixel to count as a tinted part rather than outline, gray or white. */
const SNAP_MIN_CHROMA = 12
/** Hue ranges [from, to) snapped to each key, and the key's lit channels: shirt, skin, hair, shoes, pants. */
const SNAP_KEYS = [
  [345, 15, [1, 0, 0]],
  [15, 80, [1, 1, 0]],
  [95, 145, [0, 1, 0]],
  [165, 195, [0, 1, 1]],
  [225, 255, [0, 0, 1]],
]

/**
 * Templates come back from the generator a little off their keys: orange skin (hue 15-45) between
 * the skin and shirt keys, olive shades, mint shines and dull buttons too gray for the recoloring.
 * Each becomes its key at full saturation and the same lightness.
 */
export function snapKeyHues(img) {
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    if (chroma < SNAP_MIN_CHROMA) continue
    const hue = (max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60
    const key = SNAP_KEYS.find(([from, to]) => (from < to ? hue >= from && hue < to : hue >= from || hue < to))
    if (!key) continue
    // same lightness (max + min) / 2, all of it in the key's channels
    const light = max + min
    const hi = Math.min(255, light)
    const lo = light - hi
    d.set(key[2].map((on) => (on ? hi : lo)), i)
  }
}

/** Skin key in a shade: blush and lips painted in the shirt key take it, so they follow the skin. */
const SKIN_SHADE = [192, 192, 0, 255]
/** An eye as the app draws it: 2 wide, 3 tall (pixel/eyes.ts). */
const EYE_W = 2
const EYE_H = 3

/** A pixel's part, roughly: transparent, dark, white, gray, or the key hue it carries. */
function partOf(d, i) {
  if (d[i + 3] < 128) return '.'
  const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
  const max = Math.max(r, g, b)
  const chroma = max - Math.min(r, g, b)
  if (max < 90) return 'K'
  if (chroma < 50) return max > 170 ? 'W' : 'g'
  const hue = (max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60
  const near = (k) => Math.min(Math.abs(hue - k), 360 - Math.abs(hue - k)) <= 30
  return near(60) ? 'S' : near(120) ? 'H' : near(0) || near(360) ? 'R' : '?'
}

/**
 * Takes the drawn eyes out of a template sheet and says where the app should draw its own. `spec`
 * holds, for the front (cell 0) and side (cell 2) poses, the eye boxes [x, y, w, h] in cell pixels,
 * and optionally `erase`, the parts that count as eye (default dark, white and gray). The other
 * faces find their head by matching it against the annotated one, unless they have boxes of their
 * own (a pose whose head is redrawn too differently to match). Inside each box those parts
 * become the nearest skin. Blush, lips and face shading in the shirt's red key (a red pixel on the
 * skin, not part of a red patch like the collar) become a skin shade, or they would take the shirt
 * color. Returns { cell: [[x, y], ...] }, the
 * top-left of each 2 x 3 eye.
 */
export function extractEyes(img, characters, spec) {
  const [cellW, cellH] = characters.cell
  const cols = characters.grid[0]
  const d = img.data
  const at = (cell, x, y) => {
    if (x < 0 || y < 0 || x >= cellW || y >= cellH) return -1
    return (((Math.floor(cell / cols) * cellH + y) * img.width) + (cell % cols) * cellW + x) * 4
  }
  const part = (cell, x, y) => {
    const i = at(cell, x, y)
    return i < 0 ? '.' : partOf(d, i)
  }
  const kinds = spec.erase ?? 'KWg'
  const eyes = {}
  for (const [key, ref] of Object.entries(EYE_POSES)) {
    const cell = Number(key)
    if (!spec[ref]?.length) continue
    // a pose annotated on its own takes its boxes as they are
    const own = cell !== ref && spec[cell]
    const boxes = own || spec[ref]
    let dx = 0
    let dy = 0
    if (cell !== ref && !own) {
      // the head: from 14 px over the eyes to their bottom, matched against the annotated pose
      const top = Math.max(16, Math.min(...boxes.map((b) => b[1])) - 14)
      const bottom = Math.max(...boxes.map((b) => b[1] + b[3]))
      let best = Infinity
      for (let sy = -3; sy < 10; sy++)
        for (let sx = -4; sx <= 4; sx++) {
          let miss = 0
          for (let y = top; y < bottom; y++)
            for (let x = 4; x < cellW - 4; x++) {
              const a = part(ref, x, y)
              if (a !== '.' && a !== part(cell, x + sx, y + sy)) miss++
            }
          if (miss < best) [best, dx, dy] = [miss, sx, sy]
        }
      // the head may be redrawn a pixel off: keep the nudge whose boxes hold the most eye pixels
      const held = (ex, ey) =>
        boxes.reduce((n, [x, y, w, h]) => {
          for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) n += 'KW'.includes(part(cell, i + ex, j + ey)) ? 1 : 0
          return n
        }, 0)
      let nudge = [0, 0]
      let most = held(dx, dy)
      for (const ny of [-1, 0, 1])
        for (const nx of [-1, 0, 1]) {
          const n = held(dx + nx, dy + ny)
          if (n > most) [most, nudge] = [n, [nx, ny]]
        }
      dx += nudge[0]
      dy += nudge[1]
    }
    const faceTop = Math.min(...boxes.map((b) => b[1])) + dy - 7
    const faceBottom = Math.max(...boxes.map((b) => b[1] + b[3])) + dy + 5
    for (let y = faceTop; y < faceBottom; y++)
      for (let x = 1; x < cellW - 1; x++) {
        const here = part(cell, x, y)
        if (here !== 'R' && here !== 'W') continue
        const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([sx, sy]) => part(cell, x + sx, y + sy))
        const skin = around.filter((p) => p === 'S').length
        // a shine of an old eye left on the cheek
        if (here === 'W' && skin >= 2) {
          const fill = skinNear(cell, x, y)
          if (fill) d.set(fill, at(cell, x, y))
        } else if (here === 'R' && skin && around.filter((p) => p === 'R').length <= 2) d.set(SKIN_SHADE, at(cell, x, y))
      }
    eyes[cell] = boxes.map(([bx, by, w, h]) => {
      const [x, y] = [bx + dx, by + dy]
      const spots = []
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (kinds.includes(part(cell, i, j))) spots.push([i, j])
      // the tail of an eye drawn a pixel taller than its box: dark, on the skin, right under it
      for (let i = x; i < x + w; i++) {
        const around = [[1, 0], [-1, 0], [0, 1]].map(([sx, sy]) => part(cell, i + sx, y + h + sy))
        if (part(cell, i, y + h) === 'K' && around.filter((p) => p === 'S').length >= 3) spots.push([i, y + h])
      }
      const fills = spots.map(([i, j]) => skinNear(cell, i, j))
      spots.forEach(([i, j], n) => fills[n] && d.set(fills[n], at(cell, i, j)))
      return [x + Math.floor((w - EYE_W) / 2), y + Math.floor((h - EYE_H) / 2)]
    })
  }
  return eyes

  /** The color of the closest skin on the row or column, up to 5 px away. */
  function skinNear(cell, x, y) {
    for (let r = 1; r <= 5; r++)
      for (const [sx, sy] of [[-r, 0], [r, 0], [0, r], [0, -r]]) {
        if (part(cell, x + sx, y + sy) === 'S') {
          const i = at(cell, x + sx, y + sy)
          return d.slice(i, i + 4)
        }
      }
    return null
  }
}
