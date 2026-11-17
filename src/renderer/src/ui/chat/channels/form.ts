import { botsOnFloor, sortBots } from '@shared/bots-view'
import { channelSlug, isFloorChannel } from '@shared/bots-mentions'
import { BOT_LIMITS, type Channel, type ChannelDraft } from '@shared/types'
import { chatStore } from '../store'
import { h, icon } from '../../dom'
import { confirmDialog } from '../../modals'
import { botAvatar } from '../avatar'
import { chatError, floorChoices, floorName, type ChatCtx } from '../util'
import { channelStore } from './store'

// Criar e editar um canal (CB-20): nome, tema e membros (bots do andar do canal). Editando, o pé
// tem "Apagar canal", com confirmação; o canal do andar não se apaga.

export interface ChannelFormCtx extends ChatCtx {
  /** The floor a new channel starts on ('all' = the player picks). */
  floor(): string
  saved(c: Channel): void
  removed(id: string): void
  cancel(): void
}

/** Asks, then deletes the channel; true when it went. */
export async function deleteChannel(ctx: ChatCtx, c: Channel): Promise<boolean> {
  const yes = await confirmDialog(ctx.root, {
    title: `Apagar #${c.name}?`,
    text: 'O canal sai do Chat com a conversa dele. Os bots continuam, com as conversas diretas e as automações. Não dá para desfazer.',
    confirm: 'Apagar canal',
    cancel: 'Cancelar',
    danger: true,
  })
  if (!yes) return false
  try {
    await window.office.deleteChannel(c.id)
    channelStore.remove(c.id)
    ctx.toast(`#${c.name} foi apagado.`, 'ok')
    return true
  } catch (err) {
    ctx.toast(chatError(err), 'err')
    return false
  }
}

export function channelForm(ctx: ChannelFormCtx, existing?: Channel): { el: HTMLElement; focus(): void } {
  const floors = floorChoices(ctx.state)
  const start =
    existing?.floor ??
    (ctx.floor() === 'all' ? (floors.find((f) => botsOnFloor(chatStore.bots, f.id, true).length) ?? floors[0]).id : ctx.floor())
  let floor = start
  const name = h('input', {
    class: 'input ch-input-line',
    value: existing?.name ?? '',
    maxlength: BOT_LIMITS.channelName + 10,
    placeholder: 'lançamento',
    'aria-describedby': 'ch-channel-name-hint',
    spellcheck: false,
  }) as HTMLInputElement
  const nameHint = h('span', { class: 'ch-field-hint', id: 'ch-channel-name-hint' })
  const syncName = () => {
    const slug = channelSlug(name.value)
    nameHint.textContent = slug ? `Fica #${slug}` : 'Letras, números e hífen. Ex.: lançamento, suporte, time-de-vendas.'
  }
  name.addEventListener('input', syncName)
  syncName()
  const topic = h('textarea', {
    class: 'input ch-topic',
    rows: 2,
    maxlength: BOT_LIMITS.topic,
    placeholder: 'Do que o canal trata. Ex.: o lançamento da versão 0.5, prazos e riscos.',
  }) as HTMLTextAreaElement
  topic.value = existing?.topic ?? ''

  const chosen = new Set(existing?.members ?? [])
  const membersEl = h('div', { class: 'ch-members-pick', role: 'group', 'aria-label': 'Membros do canal' })
  const drawMembers = () => {
    const bots = sortBots(botsOnFloor(chatStore.bots, floor, true))
    if (!existing) for (const id of [...chosen]) if (!bots.some((b) => b.id === id)) chosen.delete(id)
    membersEl.replaceChildren(
      ...(bots.length
        ? bots.map((b) => {
            const box = h('input', { type: 'checkbox', checked: chosen.has(b.id) }) as HTMLInputElement
            box.addEventListener('change', () => (box.checked ? chosen.add(b.id) : chosen.delete(b.id)))
            return h(
              'label',
              { class: 'ch-check ch-member' },
              box,
              botAvatar(b, 'idle', 28),
              h('span', {}, b.name, b.tagline ? h('small', {}, b.tagline) : null),
            )
          })
        : [
            h(
              'p',
              { class: 'ch-field-hint' },
              `Nenhum bot no andar ${floorName(ctx.state, floor)}. Crie um bot aqui antes de criar o canal.`,
            ),
          ]),
    )
  }
  drawMembers()

  const floorField = existing
    ? h(
        'div',
        { class: 'ch-field' },
        h('span', { class: 'ch-field-label' }, 'Andar'),
        h('span', { class: 'ch-field-static' }, floorName(ctx.state, existing.floor)),
      )
    : (() => {
        const sel = h(
          'select',
          { class: 'ch-select', 'aria-label': 'Andar do canal' },
          ...floors.map((f) => h('option', { value: f.id }, f.name)),
        ) as HTMLSelectElement
        sel.value = floor
        sel.addEventListener('change', () => {
          floor = sel.value
          chosen.clear()
          drawMembers()
        })
        return h('label', { class: 'ch-field' }, h('span', { class: 'ch-field-label' }, 'Andar'), sel)
      })()

  const error = h('p', { class: 'ch-form-error', role: 'alert', hidden: true })
  const save = h('button', { type: 'submit', class: 'btn ch-btn-accent' }, icon('check', 15), existing ? 'Salvar' : 'Criar canal')
  const field = (label: string, control: HTMLElement, hint?: HTMLElement | string) =>
    h(
      'label',
      { class: 'ch-field' },
      h('span', { class: 'ch-field-label' }, label),
      control,
      typeof hint === 'string' ? h('span', { class: 'ch-field-hint' }, hint) : (hint ?? null),
    )
  const removable = existing && !isFloorChannel(existing)

  const form = h(
    'form',
    { class: 'ch-form', 'aria-label': existing ? `Editar #${existing.name}` : 'Novo canal' },
    h(
      'div',
      { class: 'ch-form-head' },
      h('h2', { class: 'ch-gallery-title' }, existing ? `Editar #${existing.name}` : 'Novo canal'),
      h('button', { type: 'button', class: 'btn ch-btn-quiet', onclick: () => ctx.cancel() }, 'Voltar'),
    ),
    h(
      'p',
      { class: 'ch-gallery-pitch' },
      'Num canal você conversa com vários bots do andar. Escreva @ e o nome para chamar um; sem @, o app escolhe quem responde pelo tema e pela função de cada um.',
    ),
    h(
      'div',
      { class: 'ch-form-grid' },
      field('Nome', h('span', { class: 'ch-hash-input' }, h('span', { 'aria-hidden': 'true' }, '#'), name), nameHint),
      floorField,
    ),
    field('Tema', topic, 'Uma frase. O roteador lê o tema para escolher quem responde.'),
    h(
      'div',
      { class: 'ch-sec' },
      h('h3', { class: 'ch-sec-title' }, 'Membros'),
      existing && isFloorChannel(existing) ? h('p', { class: 'ch-field-hint' }, 'Bots novos do andar entram sozinhos neste canal.') : null,
      membersEl,
    ),
    error,
    h(
      'div',
      { class: 'ch-form-foot' },
      removable
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn-danger-soft ch-foot-left',
              onclick: () =>
                void deleteChannel(ctx, existing).then((gone) => {
                  if (gone) ctx.removed(existing.id)
                }),
            },
            icon('trash', 14),
            'Apagar canal',
          )
        : null,
      h('button', { type: 'button', class: 'btn ch-btn-quiet', onclick: () => ctx.cancel() }, 'Cancelar'),
      save,
    ),
  )

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const draft: ChannelDraft = {
      ...(existing ? { id: existing.id } : {}),
      name: name.value,
      floor,
      topic: topic.value,
      members: [...chosen],
    }
    const problem = !channelSlug(draft.name)
      ? 'Dê um nome ao canal, como "lançamento" ou "suporte".'
      : !draft.members.length
        ? 'Escolha pelo menos um bot do andar para o canal.'
        : null
    error.hidden = !problem
    error.textContent = problem ?? ''
    if (problem) return
    save.disabled = true
    try {
      const c = await window.office.saveChannel(draft)
      channelStore.upsert(c)
      ctx.toast(existing ? `#${c.name} foi salvo.` : `#${c.name} está pronto. Escreva @ para chamar um bot.`, 'ok')
      ctx.saved(c)
    } catch (err) {
      error.hidden = false
      error.textContent = chatError(err)
    } finally {
      save.disabled = false
    }
  })
  return { el: h('div', { class: 'ch-form-wrap' }, form), focus: () => name.focus() }
}
