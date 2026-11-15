import { HAIR_COLORS, HAIR_STYLE_INFO, HAIR_STYLES, lookFromSeed, PANTS_COLORS, SHIRT_COLORS, SHOE_COLORS, SKIN_TONES } from '@shared/describe'
import type { Look } from '@shared/types'
import { blinking } from '../pixel/eyes'
import { CELL, drawCell, dressLook, onPeopleArt } from '../pixel/people'
import { h, icon } from './dom'
import './wardrobe.css'

// Look editor of the 2D view: the agent's own sprite on a small floor tile, live, with the hair
// cuts as head thumbnails and the color swatches. The 3D view keeps the plain look fields.

/** The cut groups, in order (HAIR_STYLE_INFO kinds). */
const CUT_GROUPS = [
  { kind: 'U', label: 'Para todos' },
  { kind: 'M', label: 'Masculinos' },
  { kind: 'F', label: 'Femininos' },
] as const

/** Ways the figure can face, turning clockwise as seen from above. */
const FACINGS = [
  { back: false, flip: false, label: 'de frente, para a direita' },
  { back: false, flip: true, label: 'de frente, para a esquerda' },
  { back: true, flip: true, label: 'de costas, para a esquerda' },
  { back: true, flip: false, label: 'de costas, para a direita' },
]

/** Preview canvas in art pixels (CSS scales it 3x, pixelated). */
const STAGE_W = 72
const STAGE_H = 112
const FEET_X = 36
const FEET_Y = 100
/** Floor tile under the feet: a 2:1 diamond, half-width in art pixels. */
const TILE = 28
/** Head thumbnail crop, in art pixels of cell 0. */
const HEAD_W = 32
const HEAD_H = 28
const WAVE_SECONDS = 1.4

type ColorKey = 'skin' | 'hair' | 'shirt' | 'pants' | 'shoes'

const SECTIONS: { key: ColorKey; label: string; colors: string[] }[] = [
  { key: 'skin', label: 'Pele', colors: SKIN_TONES },
  { key: 'hair', label: 'Cabelo', colors: HAIR_COLORS },
  { key: 'shirt', label: 'Camiseta', colors: SHIRT_COLORS },
  { key: 'pants', label: 'Calça', colors: PANTS_COLORS },
  { key: 'shoes', label: 'Sapatos', colors: SHOE_COLORS },
]

/** Draws a crisp 2:1 floor diamond, row by row (no anti-aliased edges). */
function floorTile(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const half = TILE / 2
  for (let dy = -half; dy <= half; dy++) {
    const w = Math.round((half - Math.abs(dy)) * 2)
    if (w <= 0) continue
    const edge = Math.abs(dy) >= half - 1
    ctx.fillStyle = edge ? '#2c2e4a' : dy < 0 ? '#3b3e63' : '#34375a'
    ctx.fillRect(cx - w, cy + dy, w * 2, 1)
  }
  ctx.globalAlpha = 0.3
  ctx.fillStyle = '#000'
  for (let dy = -2; dy <= 2; dy++) {
    const w = Math.round(13 * Math.sqrt(1 - (dy / 3) ** 2))
    ctx.fillRect(cx - w, cy + dy, w * 2, 1)
  }
  ctx.globalAlpha = 1
}

/** The wardrobe: `value()` is the edited look, keeping any extra fields of `initial`. */
export function wardrobe(initial: Look): { el: HTMLElement; value(): Look } {
  const look: Look = { ...initial }
  const seed = Math.floor(Math.random() * 997)
  let facing = 0
  let walking = false
  let waveUntil = 0

  // ---------- stage ----------
  const canvas = h('canvas', { class: 'wr-canvas', width: STAGE_W, height: STAGE_H, 'aria-hidden': 'true' })
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const stage = h('button', { class: 'wr-stage', type: 'button', 'aria-label': 'Prévia do visual: clique para acenar' }, canvas)
  stage.addEventListener('click', () => (waveUntil = performance.now() / 1000 + WAVE_SECONDS))

  const facingText = h('span', { class: 'sr-only', 'aria-live': 'polite' })
  const turn = (by: number) => {
    facing = (facing + by + FACINGS.length) % FACINGS.length
    facingText.textContent = `Virado ${FACINGS[facing].label}`
  }
  const left = h('button', { class: 'btn btn-small wr-icon', type: 'button', 'aria-label': 'Girar para a esquerda', title: 'Girar para a esquerda' }, icon('chevron', 14))
  left.classList.add('wr-flip')
  left.addEventListener('click', () => turn(-1))
  const right = h('button', { class: 'btn btn-small wr-icon', type: 'button', 'aria-label': 'Girar para a direita', title: 'Girar para a direita' }, icon('chevron', 14))
  right.addEventListener('click', () => turn(1))
  const walk = h('button', { class: 'btn btn-small', type: 'button', 'aria-pressed': 'false', title: 'Andar sem sair do lugar' }, icon('walk', 14), 'Andar')
  walk.addEventListener('click', () => {
    walking = !walking
    walk.setAttribute('aria-pressed', String(walking))
    walk.classList.toggle('on', walking)
  })
  const dice = h('button', { class: 'btn btn-small', type: 'button', title: 'Sortear outro visual' }, icon('reset', 14), 'Aleatório')
  dice.addEventListener('click', () => {
    Object.assign(look, lookFromSeed(String(Math.random())))
    refresh()
  })

  const draw = (t: number) => {
    ctx.clearRect(0, 0, STAGE_W, STAGE_H)
    floorTile(ctx, FEET_X, FEET_Y)
    const sheet = dressLook(look)
    if (!sheet) return
    const f = FACINGS[facing]
    let cell: number
    let flip = f.flip
    if (t < waveUntil) {
      // waving shows the face, whichever way they stood
      cell = Math.floor(t * 5) % 2 ? CELL.wave : CELL.front
      if (f.back) flip = !f.flip
    } else if (walking) cell = (f.back ? CELL.backWalk : CELL.frontWalk)[Math.floor(t * 6) % 4]
    else cell = f.back ? CELL.back : CELL.front
    const face = cell <= CELL.wave
    const shut = face && sheet.shut && blinking(t, seed)
    drawCell(ctx, shut ? sheet.shut! : sheet.image, cell, flip, FEET_X, FEET_Y, 1)
  }

  // ---------- hair cuts ----------
  const cuts = h('div', { class: 'wr-cut-groups' })
  const thumbs: HTMLCanvasElement[] = []
  const cutButtons: HTMLButtonElement[] = []
  for (let i = 0; i < HAIR_STYLES; i++) {
    const name = HAIR_STYLE_INFO[i].name
    const c = h('canvas', { class: 'wr-head', width: HEAD_W, height: HEAD_H, 'aria-hidden': 'true' })
    thumbs.push(c)
    const b = h('button', { class: 'wr-cut', type: 'button', 'aria-label': name, title: name, 'aria-pressed': 'false' }, c)
    b.addEventListener('click', () => {
      look.hairStyle = i
      refresh()
    })
    cutButtons.push(b)
  }
  for (const g of CUT_GROUPS) {
    const row = h('div', { class: 'wr-cuts', role: 'group', 'aria-label': `Cortes ${g.label.toLowerCase()}` })
    row.append(...cutButtons.filter((_, i) => HAIR_STYLE_INFO[i].kind === g.kind))
    cuts.append(h('span', { class: 'wr-cut-label' }, g.label), row)
  }
  const paintThumbs = () =>
    thumbs.forEach((c, i) => {
      const g = c.getContext('2d')!
      g.imageSmoothingEnabled = false
      g.clearRect(0, 0, HEAD_W, HEAD_H)
      const sheet = dressLook({ ...look, hairStyle: i })
      if (!sheet) return
      // cell 0 is the sheet's top-left; center the crop on the feet column
      const top = Math.max(0, sheet.tops[0] - 1)
      g.drawImage(sheet.image, 32 - HEAD_W / 2, top, HEAD_W, HEAD_H, 0, 0, HEAD_W, HEAD_H)
    })

  // ---------- colors ----------
  const marks: (() => void)[] = []
  const section = (key: ColorKey, label: string, colors: string[]) => {
    const row = h('div', { class: 'swatches', role: 'group', 'aria-label': label })
    const buttons = colors.map((c) => {
      const b = h('button', { class: 'swatch', style: `background:${c}`, type: 'button', title: c, 'aria-label': `${label} ${c}` })
      b.addEventListener('click', () => {
        look[key] = c
        refresh()
      })
      return b
    })
    row.append(...buttons)
    marks.push(() =>
      buttons.forEach((b, i) => {
        const on = colors[i].toLowerCase() === look[key].toLowerCase()
        b.classList.toggle('on', on)
        b.setAttribute('aria-pressed', String(on))
      }),
    )
    return h('div', { class: 'wr-section' }, h('span', { class: 'field-label' }, label), row)
  }
  marks.push(() =>
    cutButtons.forEach((b, i) => {
      const on = i === look.hairStyle
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    }),
  )

  function refresh(): void {
    marks.forEach((m) => m())
    paintThumbs()
    draw(performance.now() / 1000)
  }

  const el = h(
    'div',
    { class: 'wardrobe' },
    h('div', { class: 'wr-side' }, stage, h('div', { class: 'wr-controls' }, left, walk, right), dice, facingText),
    h(
      'div',
      { class: 'wr-fields' },
      h('div', { class: 'wr-section' }, h('span', { class: 'field-label' }, 'Corte'), cuts),
      ...SECTIONS.map((s) => section(s.key, s.label, s.colors)),
    ),
  )

  // repaint when the sheets arrive; animate while on screen
  const stopArt = onPeopleArt(refresh)
  let seen = false
  const born = performance.now()
  const frame = () => {
    if (el.isConnected) seen = true
    else if (seen || performance.now() - born > 10_000) {
      stopArt()
      return
    }
    draw(performance.now() / 1000)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  refresh()

  return { el, value: () => ({ ...initial, ...look }) }
}

/** Whether the 2D view is on (the wardrobe replaces the plain look fields there). */
export const in2d = (): boolean => document.body.classList.contains('view-2d')
