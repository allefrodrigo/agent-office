// Modelos de ata e receitas próprios: checados aqui antes de entrar em office.json, no padrão
// dos modelos de agente (src/main/templates.ts). O IPC (RN-06) chama estas funções.

import { randomUUID } from 'node:crypto'
import { GROUND_FLOOR, MEETING_ID_RE, MEETING_RECIPE_LIMITS, MEETING_TEMPLATE_LIMITS, RECIPE_COMMAND_RE } from '@shared/meeting-templates'
import type { MeetingRecipe, MeetingTemplate, ProjectFloor } from '@shared/types'

export type Floors = readonly Pick<ProjectFloor, 'id'>[]

const TEMPLATE_KEYS = new Set(['id', 'name', 'floor', 'sections', 'instruction'])
const SECTION_KEYS = new Set(['title', 'hint'])
const RECIPE_KEYS = new Set(['id', 'command', 'name', 'prompt', 'floor'])

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function noExtra(r: Record<string, unknown>, keys: Set<string>, what: string): void {
  const extra = Object.keys(r).find((k) => !keys.has(k))
  if (extra) throw new Error(`Campo desconhecido ${what}: ${extra.slice(0, 40)}.`)
}

/** Texto aparado dentro do limite, ou o erro com a mensagem do formulário. */
function text(v: unknown, max: number, error: string, opts: { required?: boolean } = {}): string {
  const s = v === undefined ? '' : v
  if (typeof s !== 'string' || s.length > max) throw new Error(error)
  const t = s.trim()
  if (opts.required && !t) throw new Error(error)
  return t
}

const cleanId = (v: unknown): string => (typeof v === 'string' && MEETING_ID_RE.test(v) ? v : randomUUID())

/** Andar existente ou o térreo; vazio ou ausente = todos os andares. */
function cleanFloor(v: unknown, projects: Floors): string | undefined {
  if (v === undefined || v === '') return undefined
  if (typeof v !== 'string' || (v !== GROUND_FLOOR && !projects.some((p) => p.id === v))) throw new Error('Esse andar não existe mais.')
  return v
}

/**
 * Um modelo de ata vindo do renderer (ou de office.json): só os campos conhecidos, tipos certos,
 * textos dentro do limite, de 1 a 12 seções e um andar que existe. Lança com a mensagem do formulário.
 */
export function cleanMeetingTemplate(raw: unknown, projects: Floors): MeetingTemplate {
  const L = MEETING_TEMPLATE_LIMITS
  if (!isRecord(raw)) throw new Error('Modelo de ata inválido.')
  noExtra(raw, TEMPLATE_KEYS, 'no modelo de ata')
  const name = text(raw.name, L.name, `Dê um nome ao modelo (até ${L.name} letras).`, { required: true })
  if (!Array.isArray(raw.sections) || raw.sections.length === 0 || raw.sections.length > L.sections) {
    throw new Error(`O modelo precisa de 1 a ${L.sections} seções.`)
  }
  const sections = raw.sections.map((sec) => {
    if (!isRecord(sec)) throw new Error('Seção inválida no modelo.')
    noExtra(sec, SECTION_KEYS, 'na seção')
    return {
      title: text(sec.title, L.sectionTitle, `Dê um título a cada seção (até ${L.sectionTitle} letras).`, { required: true }),
      hint: text(sec.hint, L.sectionHint, `A dica de uma seção passa de ${L.sectionHint} caracteres.`),
    }
  })
  const t: MeetingTemplate = {
    id: cleanId(raw.id),
    name,
    sections,
    instruction: text(raw.instruction, L.instruction, `A orientação passa de ${L.instruction} caracteres.`),
  }
  const floor = cleanFloor(raw.floor, projects)
  if (floor) t.floor = floor
  return t
}

/** Uma receita vinda do renderer (ou de office.json), com as mesmas regras do modelo de ata. */
export function cleanMeetingRecipe(raw: unknown, projects: Floors): MeetingRecipe {
  const L = MEETING_RECIPE_LIMITS
  if (!isRecord(raw)) throw new Error('Receita inválida.')
  noExtra(raw, RECIPE_KEYS, 'na receita')
  const command = typeof raw.command === 'string' ? raw.command.trim().toLowerCase() : ''
  if (command.length > L.command || !RECIPE_COMMAND_RE.test(command)) {
    throw new Error('O comando começa com / e leva só letras minúsculas, números e hífens (ex.: /pauta).')
  }
  const r: MeetingRecipe = {
    id: cleanId(raw.id),
    command,
    name: text(raw.name, L.name, `Dê um nome à receita (até ${L.name} letras).`, { required: true }),
    prompt: text(raw.prompt, L.prompt, `Escreva o pedido da receita (até ${L.prompt} caracteres).`, { required: true }),
  }
  const floor = cleanFloor(raw.floor, projects)
  if (floor) r.floor = floor
  return r
}

/**
 * Lista lida de office.json (ou de um patch de configurações): item quebrado sai em vez de
 * derrubar as configurações, andar que sumiu vira global, id repetido fica com o primeiro.
 */
function loadList<T extends { id: string }>(raw: unknown, projects: Floors, max: number, clean: (raw: unknown, projects: Floors) => T): T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  const ids = new Set<string>()
  for (const item of raw.slice(0, max)) {
    let t: T
    try {
      const floor = isRecord(item) && typeof item.floor === 'string' && (item.floor === GROUND_FLOOR || projects.some((p) => p.id === item.floor)) ? item.floor : undefined
      t = clean(isRecord(item) ? { ...item, floor } : item, projects)
    } catch {
      continue
    }
    if (ids.has(t.id)) continue
    ids.add(t.id)
    out.push(t)
  }
  return out
}

export function loadMeetingTemplates(raw: unknown, projects: Floors): MeetingTemplate[] {
  return loadList(raw, projects, MEETING_TEMPLATE_LIMITS.count, cleanMeetingTemplate)
}

export function loadMeetingRecipes(raw: unknown, projects: Floors): MeetingRecipe[] {
  return loadList(raw, projects, MEETING_RECIPE_LIMITS.count, cleanMeetingRecipe)
}

/** A lista depois de salvar um item: trocado no lugar se o id existe, no fim se não. */
function upsert<T extends { id: string }>(list: readonly T[], t: T, max: number, what: string): T[] {
  const i = list.findIndex((x) => x.id === t.id)
  if (i >= 0) return list.map((x, j) => (j === i ? t : x))
  if (list.length >= max) throw new Error(`Limite de ${max} ${what} atingido. Apague algum antes.`)
  return [...list, t]
}

export function upsertMeetingTemplate(list: readonly MeetingTemplate[], t: MeetingTemplate): MeetingTemplate[] {
  return upsert(list, t, MEETING_TEMPLATE_LIMITS.count, 'modelos de ata')
}

export function upsertMeetingRecipe(list: readonly MeetingRecipe[], r: MeetingRecipe): MeetingRecipe[] {
  return upsert(list, r, MEETING_RECIPE_LIMITS.count, 'receitas')
}

/** A lista sem o item do id (sem erro se ele já não existe). */
export function removeById<T extends { id: string }>(list: readonly T[], id: string): T[] {
  return list.filter((x) => x.id !== id)
}
