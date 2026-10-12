import { randomUUID } from 'node:crypto'
import { HAIR_STYLES } from '@shared/describe'
import { TEMPLATE_LIMITS } from '@shared/templates'
import { EFFORT_LEVELS } from '@shared/types'
import type { AgentTemplate, Look, OfficePermissionMode, ProjectFloor } from '@shared/types'

// TODO(integração): migrar para o schema zod de src/main/validate.ts quando ele existir neste branch.

export const PERMISSION_MODES: readonly OfficePermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions']

const KEYS = new Set(['id', 'name', 'look', 'model', 'effort', 'permissionMode', 'instruction', 'floor'])
const LOOK_COLORS = ['skin', 'hair', 'shirt', 'pants', 'shoes'] as const
const HEX = /^#[0-9a-f]{6}$/i

/** A Look from outside, or undefined when any part of it is off. */
export function cleanLook(raw: unknown): Look | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (Object.keys(r).some((k) => k !== 'hairStyle' && !LOOK_COLORS.includes(k as never))) return undefined
  if (!LOOK_COLORS.every((k) => typeof r[k] === 'string' && HEX.test(r[k] as string))) return undefined
  if (!Number.isInteger(r.hairStyle) || (r.hairStyle as number) < 0 || (r.hairStyle as number) >= HAIR_STYLES) return undefined
  return { skin: r.skin, hair: r.hair, hairStyle: r.hairStyle, shirt: r.shirt, pants: r.pants, shoes: r.shoes } as Look
}

/**
 * A template from the renderer (or from office.json): known keys only, right types,
 * capped strings, a permission mode from the list and a floor that exists.
 * Throws with a message the form can show.
 */
export function cleanTemplate(raw: unknown, projects: ProjectFloor[]): AgentTemplate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Modelo inválido.')
  const r = raw as Record<string, unknown>
  const extra = Object.keys(r).find((k) => !KEYS.has(k))
  if (extra) throw new Error(`Campo desconhecido no modelo: ${extra.slice(0, 40)}.`)
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!name || name.length > TEMPLATE_LIMITS.name) throw new Error(`Dê um nome ao modelo (até ${TEMPLATE_LIMITS.name} letras).`)
  const instruction = r.instruction === undefined ? '' : r.instruction
  if (typeof instruction !== 'string' || instruction.length > TEMPLATE_LIMITS.instruction) {
    throw new Error(`A instrução base passa de ${TEMPLATE_LIMITS.instruction} caracteres.`)
  }
  if (!PERMISSION_MODES.includes(r.permissionMode as never)) throw new Error('Escolha um modo de permissão da lista.')
  const t: AgentTemplate = {
    id: typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id) ? r.id : randomUUID(),
    name,
    permissionMode: r.permissionMode as OfficePermissionMode,
    instruction: instruction.trim(),
  }
  if (r.look !== undefined) {
    const look = cleanLook(r.look)
    if (!look) throw new Error('Aparência inválida no modelo.')
    t.look = look
  }
  if (r.model !== undefined && r.model !== '') {
    if (typeof r.model !== 'string' || !/^[\w.\-[\]]{1,64}$/.test(r.model)) throw new Error('Modelo de IA inválido.')
    t.model = r.model
  }
  if (r.effort !== undefined && r.effort !== '') {
    if (!EFFORT_LEVELS.includes(r.effort as never)) throw new Error('Esforço inválido.')
    t.effort = r.effort as AgentTemplate['effort']
  }
  if (r.floor !== undefined && r.floor !== '') {
    if (typeof r.floor !== 'string' || !projects.some((p) => p.id === r.floor)) throw new Error('Esse andar não existe mais.')
    t.floor = r.floor
  }
  return t
}

/**
 * Templates read from office.json. Files from before v0.3.4 have none; a broken entry
 * is dropped instead of taking the settings down, and one whose floor is gone turns global.
 */
export function loadTemplates(raw: unknown, projects: ProjectFloor[]): AgentTemplate[] {
  if (!Array.isArray(raw)) return []
  const out: AgentTemplate[] = []
  const ids = new Set<string>()
  for (const item of raw.slice(0, TEMPLATE_LIMITS.count)) {
    let t: AgentTemplate
    try {
      const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
      const floor = r && typeof r.floor === 'string' && projects.some((p) => p.id === r.floor) ? r.floor : undefined
      t = cleanTemplate(r ? { ...r, floor } : item, projects)
    } catch {
      continue
    }
    if (ids.has(t.id)) continue
    ids.add(t.id)
    out.push(t)
  }
  return out
}

/** The list after saving one template: replaced in place if its id exists, appended otherwise. */
export function upsertTemplate(list: AgentTemplate[], t: AgentTemplate): AgentTemplate[] {
  const i = list.findIndex((x) => x.id === t.id)
  if (i >= 0) return list.map((x, j) => (j === i ? t : x))
  if (list.length >= TEMPLATE_LIMITS.count) throw new Error(`Limite de ${TEMPLATE_LIMITS.count} modelos atingido. Apague algum antes.`)
  return [...list, t]
}
