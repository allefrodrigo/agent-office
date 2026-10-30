import type { Look } from '@shared/types'
import { sprite } from './assets'
import type { Eyes } from './eyes'
import { tinted } from './tint'

/** Recolorable sheets, one per hair style of the 3D avatar (Look.hairStyle 0-5). */
const HAIR_STYLES = 6

/**
 * A recolorable template (molde-N) in the look's hair style, dressed in its colors: skin, hair,
 * shirt (or `shirt`, the squad uniform), pants, shoes, with where its eyes go. A missing style
 * borrows another template; null without any template, or before the sprites load.
 */
export function lookSheet(look: Look, shirt = look.shirt): { image: CanvasImageSource; eyes?: Eyes } | null {
  const style = ((look.hairStyle % HAIR_STYLES) + HAIR_STYLES) % HAIR_STYLES
  let key = `personagens/molde-${style}`
  let tpl = sprite(key)
  if (!tpl?.tint) {
    key = Array.from({ length: HAIR_STYLES }, (_, i) => `personagens/molde-${i}`).find((k) => sprite(k)?.tint) ?? ''
    tpl = key ? sprite(key) : null
  }
  if (!tpl) return null
  const image = tinted(key, tpl, { skin: look.skin, hair: look.hair, shirt, pants: look.pants, shoes: look.shoes })
  return { image, eyes: tpl.eyes }
}

/** Head and shoulders in the front pose of a 48 x 64 cell: the top of the head sits at y = 16. */
export const BUST = { x: 6, y: 13, size: 36 }
