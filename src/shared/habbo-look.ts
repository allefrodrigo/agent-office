import type { HabboLook, HabboPick, HabboSlot } from './types'

/** The look editor's categories, in its tab order. */
export const HABBO_SLOTS: readonly HabboSlot[] = ['hd', 'hr', 'ha', 'he', 'ea', 'fa', 'ch', 'cc', 'cp', 'ca', 'wa', 'lg', 'sh']

/** Set and color ids are figuredata.xml ids: positive integers, five digits at most. */
const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) < 100_000

/**
 * A Habbo look from outside (settings, templates, a hire request), or undefined when any part of
 * it is off. Checks the shape only: an id the catalog does not know is simply not drawn.
 */
export function cleanHabboLook(raw: unknown): HabboLook | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (Object.keys(r).some((k) => k !== 'gender' && k !== 'parts')) return undefined
  if (r.gender !== 'M' && r.gender !== 'F') return undefined
  if (!r.parts || typeof r.parts !== 'object' || Array.isArray(r.parts)) return undefined
  const parts: Partial<Record<HabboSlot, HabboPick>> = {}
  for (const [slot, pick] of Object.entries(r.parts as Record<string, unknown>)) {
    if (!HABBO_SLOTS.includes(slot as HabboSlot)) return undefined
    if (!pick || typeof pick !== 'object' || Array.isArray(pick)) return undefined
    const p = pick as Record<string, unknown>
    if (Object.keys(p).some((k) => k !== 'set' && k !== 'colors')) return undefined
    if (!isId(p.set) || !Array.isArray(p.colors) || p.colors.length > 2 || !p.colors.every(isId)) return undefined
    parts[slot as HabboSlot] = { set: p.set, colors: [...(p.colors as number[])] }
  }
  return { gender: r.gender, parts }
}
