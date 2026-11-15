import { z } from 'zod'
import { clampPerHour } from '@shared/bots-automation'
import { BOT_GROUND_FLOOR, ROUTINE_LIMITS, type Bot, type BotEventKind, type BotEventTrigger, type BotTriggerDraft, type ProjectFloor } from '@shared/types'
import { parse, ticketStatusSchema } from '../validate'

// Chat dos bots, fase 2: every argument the automations' IPC gets passes through here first
// (validate.ts style: shape with zod, then what the form needs to hear, in pt-BR).

const EVENT_KINDS = ['ticket-created', 'ticket-moved', 'meeting-ata', 'bot-done'] as const satisfies readonly BotEventKind[]
const BOT_ID = /^[A-Za-z0-9_-]{1,64}$/
const TAG_MAX = 40
const TAGS_MAX = 20

export const botIdSchema = z.string().regex(BOT_ID)
export const triggerIdSchema = z.string().regex(/^[\w-]{1,64}$/)

const triggerDraftSchema = z.object({
  id: triggerIdSchema.optional(),
  botId: botIdSchema,
  name: z.string().max(2000),
  kind: z.enum(EVENT_KINDS),
  filter: z
    .object({
      floor: z.string().min(1).max(40).optional(),
      tags: z.array(z.string().max(200)).max(100).optional(),
      column: ticketStatusSchema.optional(),
      botId: botIdSchema.optional(),
      onlyOk: z.boolean().optional(),
    })
    .default({}),
  prompt: z.string().max(ROUTINE_LIMITS.prompt),
  enabled: z.boolean().optional(),
  maxPerHour: z.number().finite().optional(),
})

/** A trigger draft that passed every check: the filter has only what its kind uses, defaults filled. */
export type CleanBotTriggerDraft = Required<Pick<BotTriggerDraft, 'botId' | 'name' | 'kind' | 'filter' | 'prompt' | 'enabled' | 'maxPerHour'>> & Pick<BotTriggerDraft, 'id'>

/** A floor the office knows: the ground floor or one of the projects. */
export function isFloor(floor: string, projects: Pick<ProjectFloor, 'id'>[]): boolean {
  return floor === BOT_GROUND_FLOOR || projects.some((p) => p.id === floor)
}

/**
 * An event trigger from the form. Throws a message the form can show: a name, a task, a bot
 * that exists, a floor that exists, and never a bot that waits on itself. The cap per hour
 * defaults to the Chat setting and stays within 1 and BOT_LIMITS.perHourMax.
 */
export function cleanBotTriggerDraft(
  raw: unknown,
  ctx: { bots: Pick<Bot, 'id' | 'name'>[]; projects: Pick<ProjectFloor, 'id'>[]; perHourDefault?: number },
): CleanBotTriggerDraft {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!name || name.length > ROUTINE_LIMITS.name) throw new Error(`Dê um nome à automação (até ${ROUTINE_LIMITS.name} letras).`)
  const d = parse(triggerDraftSchema, raw, 'Automação inválida. Feche e abra o formulário de novo.')
  if (!ctx.bots.some((b) => b.id === d.botId)) throw new Error('Esse bot não existe mais. Escolha outro.')
  const prompt = d.prompt.trim()
  if (!prompt) throw new Error('Descreva o que o bot faz quando o evento acontece.')

  const f = d.filter
  const filter: BotEventTrigger['filter'] = {}
  if (d.kind === 'bot-done') {
    if (f.botId) {
      if (f.botId === d.botId) throw new Error('Um bot não pode disparar a si mesmo. Escolha outro bot em "Quando".')
      if (!ctx.bots.some((b) => b.id === f.botId)) throw new Error('O bot de "Quando" não existe mais. Escolha outro.')
      filter.botId = f.botId
    }
    if (f.onlyOk) filter.onlyOk = true
  } else {
    if (f.floor) {
      if (!isFloor(f.floor, ctx.projects)) throw new Error('Esse andar não existe mais. Escolha outro.')
      filter.floor = f.floor
    }
    if (d.kind !== 'meeting-ata') {
      const tags = [...new Set((f.tags ?? []).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))]
      if (tags.some((t) => t.length > TAG_MAX)) throw new Error(`Cada tag tem até ${TAG_MAX} letras.`)
      if (tags.length > TAGS_MAX) throw new Error(`Use até ${TAGS_MAX} tags.`)
      if (tags.length) filter.tags = tags
    }
    if (d.kind === 'ticket-moved' && f.column) filter.column = f.column
  }

  return {
    ...(d.id ? { id: d.id } : {}),
    botId: d.botId,
    name,
    kind: d.kind,
    filter,
    prompt,
    enabled: d.enabled ?? true,
    maxPerHour: clampPerHour(d.maxPerHour, clampPerHour(ctx.perHourDefault)),
  }
}

/** The sentence of "automação a partir de uma frase". */
export function cleanAutomationText(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  if (text.length < 5) throw new Error('Escreva a automação numa frase, com quando e o quê: "toda sexta às 17h, resuma a semana".')
  if (text.length > 1000) throw new Error('Frase longa demais: até 1.000 letras. Deixe os detalhes para o formulário.')
  return text
}

/** A floor id from the renderer: the ground floor or a project that exists. */
export function cleanFloorId(raw: unknown, projects: Pick<ProjectFloor, 'id'>[]): string {
  const floor = typeof raw === 'string' ? raw : ''
  if (!floor || floor.length > 40 || !isFloor(floor, projects)) throw new Error('Esse andar não existe mais. Escolha outro.')
  return floor
}

/** A bot id from the renderer, of a bot that exists. */
export function cleanBotId(raw: unknown, bots: Pick<Bot, 'id'>[]): string {
  const id = parse(botIdSchema, raw, 'Bot inválido.')
  if (!bots.some((b) => b.id === id)) throw new Error('Esse bot não existe mais. Ele pode ter sido apagado em outra janela.')
  return id
}
