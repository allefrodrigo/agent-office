import type { HabboLook, HabboPick, HabboSlot, Look } from '@shared/types'
import { HABBO_SLOTS } from '@shared/habbo-look'
import data from './habbo-avatar.json'

// The Habbo clothing catalog of the 2D view and the figure of a look: every set the client's
// editor offers, the parts each is made of, the library each part lives in, what each set hides
// and the color palettes (from the client's figuredata.xml and figuremap.xml, through
// scripts/habbo-avatar.mjs). No drawing here: pixel/figure.ts draws the figures, the look
// editor (ui/habbo-editor.ts) reads the catalog.

/** A clothing set of the catalog: its parts [type, id, color index (0 = not tinted)] and what it hides. */
export interface CatalogSet {
  id: number
  g: 'M' | 'F' | 'U'
  club: number
  /** How many palette colors it takes: 0, 1 or 2. */
  colors: number
  parts: [string, number, number][]
  hidden?: string[]
}

const SETS = data.sets as unknown as Record<HabboSlot, CatalogSet[]>
const LIBS = data.libs as Record<string, string>
/** Palette id -> [color id, hex, club] in the client's order. */
const PALETTES = data.palettes as unknown as Record<string, [number, string, number][]>
const SETTYPES = data.settypes as Record<HabboSlot, { palette: string; mandatory: { M: boolean; F: boolean } }>
const SET_BY = new Map<string, CatalogSet>()
for (const [slot, list] of Object.entries(SETS)) for (const set of list) SET_BY.set(`${slot}-${set.id}`, set)

/** Hair sets in the order of the 3D hair styles: side part, spiky, long, bun, pigtails, curly. */
const HAIR_SETS = [893, 165, 3020, 3012, 515, 110]
/** The rest of a figure derived from the 3D colors: head, T-shirt, jeans, sneakers. */
const BODY: Record<'M' | 'F', Record<'hd' | 'ch' | 'lg' | 'sh', number>> = {
  M: { hd: 180, ch: 210, lg: 270, sh: 290 },
  F: { hd: 600, ch: 660, lg: 716, sh: 725 },
}

// ---------- the catalog (the look editor reads it) ----------

/** Every clothing library of the catalog, the basics (body, face, hair, shirt, legs, shoes) first. */
export const allLibraries = (): string[] =>
  [...new Set(Object.values(LIBS))].sort((a, b) => Number(!a.startsWith('hh_human')) - Number(!b.startsWith('hh_human')))

/** The sets of a category a gender can wear, in the client's order. */
export function catalog(slot: HabboSlot, gender: 'M' | 'F'): CatalogSet[] {
  return (SETS[slot] ?? []).filter((s) => s.g === 'U' || s.g === gender)
}

export function catalogSet(slot: HabboSlot, id: number): CatalogSet | undefined {
  return SET_BY.get(`${slot}-${id}`)
}

/** True when the client makes every figure wear something there (face, shirt, pants). */
export const mandatory = (slot: HabboSlot, gender: 'M' | 'F'): boolean => SETTYPES[slot]?.mandatory[gender] ?? false

/** The colors of a category: [color id, hex, club]. */
export const paletteOf = (slot: HabboSlot): [number, string, number][] => PALETTES[SETTYPES[slot]?.palette] ?? []

const hexOf = (slot: HabboSlot, color: number | undefined): string | undefined => paletteOf(slot).find((c) => c[0] === color)?.[1]

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The palette color id nearest to a CSS color (weighted RGB distance). */
function nearest(slot: HabboSlot, hex: string): number {
  const [r, g, b] = rgb(hex)
  let best = 0
  let dist = Infinity
  for (const [id, sw] of paletteOf(slot)) {
    const [r2, g2, b2] = rgb(sw)
    const d = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2
    if (d < dist) {
      dist = d
      best = id
    }
  }
  return best
}

/** A set picked in the palette color nearest to `hex` (twice for a two-color set). */
function pick(slot: HabboSlot, set: number, hex: string): HabboPick {
  const n = catalogSet(slot, set)?.colors ?? 1
  const c = nearest(slot, hex)
  return { set, colors: n === 0 ? [] : n === 2 ? [c, c] : [c] }
}

/** The Habbo look of a 3D look: its own, or one made from its colors and hair style. */
export function habboOfLook(look: Look): HabboLook {
  if (look.habbo) return look.habbo
  const body = BODY.M
  const style = ((look.hairStyle % HAIR_SETS.length) + HAIR_SETS.length) % HAIR_SETS.length
  return {
    gender: 'M',
    parts: {
      hd: pick('hd', body.hd, look.skin),
      hr: pick('hr', HAIR_SETS[style], look.hair),
      ch: pick('ch', body.ch, look.shirt),
      lg: pick('lg', body.lg, look.pants),
      sh: pick('sh', body.sh, look.shoes),
    },
  }
}

/** What every figure wears; switching gender swaps these for the new gender's own. */
const BASICS = new Set<HabboSlot>(['hd', 'hr', 'ch', 'lg', 'sh'])

/**
 * The same figure for the other gender: what both can wear stays, colors included; a face, hair,
 * shirt, pants or shoes of the old gender becomes the new gender's first, in the same color; the
 * rest comes off.
 */
export function switchGender(habbo: HabboLook, gender: 'M' | 'F'): HabboLook {
  const parts: HabboLook['parts'] = {}
  for (const slot of HABBO_SLOTS) {
    const p = habbo.parts[slot]
    const set = p && catalogSet(slot, p.set)
    if (p && set && (set.g === 'U' || set.g === gender)) parts[slot] = { set: p.set, colors: [...p.colors] }
    else if (p ? BASICS.has(slot) : mandatory(slot, gender)) {
      const next = slot in BODY[gender] ? catalogSet(slot, BODY[gender][slot as keyof (typeof BODY)['M']]) : catalog(slot, gender)[0]
      if (!next) continue
      const c = p?.colors[0] ?? paletteOf(slot)[0]?.[0] ?? 1
      parts[slot] = { set: next.id, colors: Array.from({ length: next.colors }, () => c) }
    }
  }
  return { gender, parts }
}

/**
 * A random figure: face, hair, shirt, pants and shoes always; a coat, hat, glasses or belt
 * now and then. `club` sets (Habbo Club) are fine: the app has no club to join.
 */
export function randomHabbo(gender: 'M' | 'F', rand: () => number = Math.random): HabboLook {
  const any = <T>(list: T[]): T | undefined => list[Math.floor(rand() * list.length)]
  const parts: HabboLook['parts'] = {}
  const chance: Partial<Record<HabboSlot, number>> = {
    hd: 1,
    hr: 0.95,
    ch: 1,
    lg: 1,
    sh: 0.9,
    cc: 0.25,
    ha: 0.15,
    ea: 0.15,
    wa: 0.1,
    ca: 0.1,
  }
  const skin = any(paletteOf('hd').filter((c) => !c[2]))?.[0] ?? 1
  for (const [slot, odds] of Object.entries(chance) as [HabboSlot, number][]) {
    if (rand() >= odds) continue
    const set = any(catalog(slot, gender))
    if (!set) continue
    const colors = slot === 'hd' ? [skin] : Array.from({ length: set.colors }, () => any(paletteOf(slot))?.[0] ?? 1)
    parts[slot] = { set: set.id, colors }
  }
  return { gender, parts }
}

/** The 3D colors of a Habbo look, so the 3D view and the portraits follow the 2D editor. */
export function colorsOfHabbo(habbo: HabboLook, look: Look): Look {
  const c = (slot: HabboSlot, fallback: string) => hexOf(slot, habbo.parts[slot]?.colors[0]) ?? fallback
  return {
    ...look,
    skin: c('hd', look.skin),
    hair: c('hr', look.hair),
    shirt: c('cc', c('ch', look.shirt)),
    pants: c('lg', look.pants),
    shoes: c('sh', look.shoes),
    habbo,
  }
}

/** The Habbo figure string of a look ("hd-180-1.hr-893-45..."), as the Imager and the client write it. */
export const figureString = (habbo: HabboLook): string =>
  Object.entries(habbo.parts)
    .flatMap(([slot, p]) => (p ? [[slot, p.set, ...p.colors].join('-')] : []))
    .join('.')

// ---------- the figure of a look ----------

export interface Figure {
  key: string
  /** For the Imager (the standing picture while the libraries load). */
  figure: string
  parts: { type: string; id: number; color: string | null; lib: string }[]
}

const figures = new Map<string, Figure>()

/** The Habbo figure of a look; `shirt` (a squad uniform) recolors the shirt. */
export function figureOfLook(look: Look, shirt = look.shirt): Figure {
  let habbo = habboOfLook(look)
  if (shirt !== look.shirt && habbo.parts.ch) {
    const ch = habbo.parts.ch
    const c = nearest('ch', shirt)
    habbo = { ...habbo, parts: { ...habbo.parts, ch: { set: ch.set, colors: ch.colors.map(() => c) } } }
  }
  return figureOf(habbo)
}

/** The parts of a Habbo look, ready to draw: what the sets are made of, minus what they hide. */
export function figureOf(habbo: HabboLook): Figure {
  const key = figureString(habbo)
  let fig = figures.get(key)
  if (fig) return fig
  const chosen = (Object.entries(habbo.parts) as [HabboSlot, HabboPick | undefined][]).flatMap(([slot, p]) => {
    const set = p && catalogSet(slot, p.set)
    return set ? [{ slot, set, colors: p.colors }] : []
  })
  // what a set covers is not drawn: most hats hide the hair (hrb), helmets more
  const hidden = new Set(chosen.flatMap((c) => c.set.hidden ?? []))
  // a hair with a full version (hrb) never draws its short twin (hr, same id): bare it shows the
  // full one, under a hat nothing but its extra pieces, as the Imager draws it
  const twins = new Set(chosen.flatMap((c) => c.set.parts.filter((p) => p[0] === 'hrb').map((p) => p[1])))
  const parts: Figure['parts'] = []
  for (const { slot, set, colors } of chosen)
    for (const [type, id, index] of set.parts) {
      if (hidden.has(type) || (type === 'hr' && twins.has(id))) continue
      const lib = LIBS[`${type}:${id}`]
      if (!lib) continue
      const color = index > 0 ? (hexOf(slot, colors[index - 1] ?? colors[0]) ?? null) : null
      parts.push({ type, id, color, lib })
    }
  fig = { key, figure: key, parts }
  if (figures.size > 500) figures.clear()
  figures.set(key, fig)
  return fig
}
