import { HABBO_SLOTS } from '@shared/habbo-look'
import type { HabboLook, HabboSlot, Look } from '@shared/types'
import { figureFrame, FOOT, type Pose } from '../pixel/figure'
import {
  catalog,
  catalogSet,
  colorsOfHabbo,
  figureOf,
  habboOfLook,
  mandatory,
  paletteOf,
  randomHabbo,
  switchGender,
} from '../pixel/habbo-catalog'
import { h, icon } from './dom'
import './habbo-editor.css'

// The look editor of the 2D view, like Habbo's wardrobe: the whole clothing catalog by category,
// one or two palette colors per piece, and the avatar live beside it (walking, waving, talking,
// blinking, turned any of the 8 ways), drawn by the same compositor as the office.

const LABELS: Record<HabboSlot, string> = {
  hd: 'Rosto',
  hr: 'Cabelo',
  ha: 'Chapéu',
  he: 'Acessório de cabeça',
  ea: 'Óculos',
  fa: 'Rosto (acessório)',
  ch: 'Camisa',
  cc: 'Casaco',
  cp: 'Estampa',
  ca: 'Peito',
  wa: 'Cinto',
  lg: 'Calça',
  sh: 'Sapatos',
}

/** HabboAssets' Imager draws each set on its own: the item's thumbnail (redirects to a cached PNG). */
const thumb = (id: number) => `https://www.habboassets.com/imaging/clothing/set/${id}.png`

/** Preview size: the part of the 128 x 128 frame the avatar uses, scaled 2x. */
const CROP = { x: 24, y: 0, w: 80, h: 128 }
const SCALE = 2

export function habboEditor(initial: Look): { el: HTMLElement; value(): Look } {
  const base: Look = { ...initial }
  let habbo: HabboLook = structuredClone(habboOfLook(initial))
  let slot: HabboSlot = 'hr'
  let dir = 2
  let walking = false
  let waving = false
  let talking = false

  // ---------- live preview ----------
  const canvas = h('canvas', { class: 'hb-stage' }) as HTMLCanvasElement
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
  canvas.width = CROP.w * SCALE * dpr
  canvas.height = CROP.h * SCALE * dpr
  canvas.style.width = `${CROP.w * SCALE}px`
  canvas.style.height = `${CROP.h * SCALE}px`
  const ctx = canvas.getContext('2d')!
  const loading = h('div', { class: 'hb-loading' }, 'Carregando roupas…')
  const t0 = performance.now()

  const draw = () => {
    const t = (performance.now() - t0) / 1000
    const pose: Pose = { posture: walking ? 'wlk' : 'std', frame: walking ? Math.floor(t * 8) % 4 : 0 }
    if (waving) Object.assign(pose, { arms: 'wav', armFrame: Math.floor(t * 5) % 2 })
    if (talking) pose.talk = Math.floor(t * 7) % 2
    // a blink of 0.15 s every 4 s
    pose.blink = t % 4 > 3.85
    const frame = figureFrame(figureOf(habbo), dir, pose)
    const k = SCALE * dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(k, 0, 0, k, -CROP.x * k, -CROP.y * k)
    // the floor tile under the feet, 64 x 32 like Habbo's
    ctx.beginPath()
    ctx.moveTo(FOOT.x - 32, FOOT.y - 8)
    ctx.lineTo(FOOT.x, FOOT.y - 24)
    ctx.lineTo(FOOT.x + 32, FOOT.y - 8)
    ctx.lineTo(FOOT.x, FOOT.y + 8)
    ctx.closePath()
    ctx.fillStyle = '#989865'
    ctx.fill()
    ctx.strokeStyle = '#6e6e45'
    ctx.lineWidth = 1
    ctx.stroke()
    loading.hidden = !!frame
    if (frame) {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(frame, 0, 0)
    }
  }
  // runs while the editor is on screen; a closed dialog ends it
  let started = false
  const loop = () => {
    if (started && !canvas.isConnected) return
    if (canvas.isConnected) started = true
    draw()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  const toggle = (label: string, iconName: string, on: () => boolean, flip: () => void) => {
    const b = h('button', { class: 'btn btn-small hb-toggle', type: 'button' }, icon(iconName, 13), label)
    b.addEventListener('click', () => {
      flip()
      b.classList.toggle('on', on())
    })
    return b
  }
  const turn = (step: number, label: string, title: string) => {
    const b = h('button', { class: 'btn btn-small hb-turn', type: 'button', title }, label)
    b.addEventListener('click', () => (dir = (dir + step + 8) % 8))
    return b
  }

  // ---------- gender ----------
  const genders = h('div', { class: 'hb-genders' })
  for (const [g, label] of [
    ['M', 'Masculino'],
    ['F', 'Feminino'],
  ] as const) {
    const b = h('button', { class: 'btn btn-small', type: 'button' }, label)
    b.dataset.g = g
    b.addEventListener('click', () => {
      if (habbo.gender === g) return
      habbo = switchGender(habbo, g)
      render()
    })
    genders.append(b)
  }

  const dice = h('button', { class: 'btn btn-small', type: 'button', title: 'Sortear um visual novo' }, icon('reset', 13), 'Sortear')
  dice.addEventListener('click', () => {
    habbo = randomHabbo(habbo.gender)
    render()
  })

  // ---------- catalog ----------
  const tabs = h('div', { class: 'hb-tabs', role: 'tablist' })
  for (const s of HABBO_SLOTS) {
    const b = h('button', { class: 'hb-tab', type: 'button', role: 'tab', title: LABELS[s] }, LABELS[s])
    b.dataset.slot = s
    b.addEventListener('click', () => {
      slot = s
      render()
    })
    tabs.append(b)
  }
  const grid = h('div', { class: 'hb-grid' })
  const colors = h('div', { class: 'hb-colors' })

  const choose = (id: number | null) => {
    if (id === null) delete habbo.parts[slot]
    else {
      const set = catalogSet(slot, id)!
      const old = habbo.parts[slot]?.colors ?? []
      const first = old[0] ?? paletteOf(slot)[0]?.[0] ?? 1
      habbo.parts[slot] = { set: id, colors: Array.from({ length: set.colors }, (_, i) => old[i] ?? first) }
    }
    render()
  }

  const renderGrid = () => {
    const current = habbo.parts[slot]?.set ?? null
    const items: HTMLElement[] = []
    if (!mandatory(slot, habbo.gender)) {
      const none = h('button', { class: 'hb-item hb-none', type: 'button', title: 'Nenhum' }, icon('x', 20))
      none.classList.toggle('on', current === null)
      none.addEventListener('click', () => choose(null))
      items.push(none)
    }
    for (const set of catalog(slot, habbo.gender)) {
      const img = h('img', { src: thumb(set.id), alt: '', loading: 'lazy', draggable: 'false' })
      // a set the Imager cannot draw still gets a cell: its number
      img.addEventListener('error', () => img.replaceWith(h('span', { class: 'hb-num' }, `#${set.id}`)), { once: true })
      const b = h(
        'button',
        { class: 'hb-item', type: 'button', title: `${LABELS[slot]} #${set.id}${set.club ? ' (Habbo Club)' : ''}` },
        img,
      )
      if (set.club) b.append(h('span', { class: 'hb-club' }, 'HC'))
      b.classList.toggle('on', set.id === current)
      b.addEventListener('click', () => choose(set.id))
      items.push(b)
    }
    grid.replaceChildren(...items)
  }

  const renderColors = () => {
    const p = habbo.parts[slot]
    const set = p && catalogSet(slot, p.set)
    colors.replaceChildren()
    if (!p || !set || !set.colors) {
      colors.append(h('div', { class: 'field-hint' }, p ? 'Essa peça não tem cor.' : ''))
      return
    }
    for (let i = 0; i < set.colors; i++) {
      const row = h('div', { class: 'swatches hb-palette' })
      for (const [id, hex, club] of paletteOf(slot)) {
        const b = h('button', {
          class: 'swatch hb-swatch',
          type: 'button',
          style: `background:${hex}`,
          title: club ? `${hex} (Habbo Club)` : hex,
        })
        b.classList.toggle('on', p.colors[i] === id)
        b.addEventListener('click', () => {
          p.colors[i] = id
          renderColors()
        })
        row.append(b)
      }
      colors.append(set.colors > 1 ? h('div', { class: 'hb-color-label' }, i === 0 ? 'Cor principal' : 'Segunda cor') : '', row)
    }
  }

  const render = () => {
    genders.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.g === habbo.gender))
    tabs.querySelectorAll<HTMLElement>('.hb-tab').forEach((b) => {
      b.classList.toggle('on', b.dataset.slot === slot)
      b.classList.toggle('worn', !!habbo.parts[b.dataset.slot as HabboSlot])
    })
    renderGrid()
    renderColors()
  }
  render()

  const el = h(
    'div',
    { class: 'hb-editor' },
    h(
      'div',
      { class: 'hb-side' },
      h('div', { class: 'hb-stage-box' }, canvas, loading),
      h('div', { class: 'hb-row' }, turn(1, '⟲', 'Girar para a esquerda'), turn(-1, '⟳', 'Girar para a direita')),
      h(
        'div',
        { class: 'hb-row' },
        toggle(
          'Andar',
          'walk',
          () => walking,
          () => (walking = !walking),
        ),
        toggle(
          'Acenar',
          'spark',
          () => waving,
          () => (waving = !waving),
        ),
        toggle(
          'Falar',
          'message',
          () => talking,
          () => (talking = !talking),
        ),
      ),
      genders,
      dice,
    ),
    h('div', { class: 'hb-main' }, tabs, grid, colors),
  )
  return { el, value: () => colorsOfHabbo(structuredClone(habbo), base) }
}
