import { z } from 'zod'
import { BOT_LIMITS, type AttachmentInput, type Bot, type Channel } from '@shared/types'
import { channelSlug } from '@shared/bots-mentions'
import { attachmentsSchema, idSchema, messageSchema, parse } from '../validate'

// Chat dos bots, canais (CB-17): o que chega do renderer para os canais passa por aqui antes de
// tocar no ChannelService. Mensagens de erro em pt-BR, dizendo o que fazer.

/** What saveChannel keeps from the form, checked against the bots and the other channels. */
export interface CleanChannelDraft {
  id?: string
  name: string
  floor: string
  topic: string
  members: string[]
}

const draftSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().max(200),
  floor: z.string().min(1).max(64),
  topic: z.string().max(5000).optional(),
  members: z.array(z.string().max(200)).max(500),
})

/** The form shows the same name the main process keeps (shared/bots-mentions.ts). */
export const channelName = channelSlug

/** One line, no runs of spaces, at most BOT_LIMITS.topic characters. */
export function cleanTopic(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, BOT_LIMITS.topic)
}

export interface DraftContext {
  bots: readonly Pick<Bot, 'id' | 'floor'>[]
  channels: readonly Pick<Channel, 'id' | 'name' | 'floor'>[]
  /** Every floor id a channel may live on ('terreo' and the project floors). */
  floors: readonly string[]
}

/** saveChannel's argument, or an error the form shows as is. */
export function cleanChannelDraft(raw: unknown, ctx: DraftContext): CleanChannelDraft {
  const d = parse(draftSchema, raw, 'O formulário do canal chegou incompleto. Feche e abra de novo.')
  const editing = d.id !== undefined ? ctx.channels.find((c) => c.id === d.id) : undefined
  if (d.id !== undefined && !editing) throw new Error('Esse canal não existe mais. Ele pode ter sido apagado em outra janela.')
  if (!editing && ctx.channels.length >= BOT_LIMITS.channels) {
    throw new Error(`Chegou ao limite de ${BOT_LIMITS.channels} canais. Apague um canal que não usa mais para criar outro.`)
  }
  const floor = editing ? editing.floor : d.floor
  if (!ctx.floors.includes(floor)) throw new Error('Esse andar não existe mais. Escolha outro andar para o canal.')
  const name = channelName(d.name)
  if (!name) throw new Error('Dê um nome ao canal, como "lançamento" ou "suporte".')
  if (ctx.channels.some((c) => c.id !== editing?.id && c.floor === floor && c.name === name)) {
    throw new Error(`Já existe um #${name} neste andar. Escolha outro nome.`)
  }
  const members: string[] = []
  for (const id of d.members) {
    const bot = ctx.bots.find((b) => b.id === id)
    if (!bot) throw new Error('Um dos bots escolhidos não existe mais. Abra o formulário de novo e escolha os membros.')
    if (bot.floor !== floor) throw new Error('Só bots do andar do canal podem ser membros. Tire os bots de outros andares.')
    if (!members.includes(id)) members.push(id)
  }
  if (!members.length) throw new Error('Escolha pelo menos um bot do andar para o canal.')
  return { ...(editing ? { id: editing.id } : {}), name, floor, topic: cleanTopic(d.topic), members }
}

/** postToChannel's text and files: something to send, within the IPC's limits. */
export function cleanPost(rawText: unknown, rawAttachments: unknown): { text: string; attachments: AttachmentInput[] } {
  const text = parse(messageSchema, rawText ?? '', 'Essa mensagem é grande demais. Mande em partes ou anexe como arquivo.').trim()
  const attachments = parse(attachmentsSchema, rawAttachments ?? [], 'Algum anexo chegou estragado. Tire os anexos e anexe de novo.')
  if (!text && !attachments.length) throw new Error('Escreva uma mensagem ou anexe um arquivo antes de enviar.')
  return { text, attachments }
}

/** A channel, item or bot id from the renderer. */
export function cleanRef(raw: unknown, message: string): string {
  return parse(idSchema, raw, message)
}
