import { draftError } from '@shared/bots-view'
import { BLANK_TEMPLATE_ID, BOT_TEMPLATES, draftFromTemplate, templateAutomation, type BotTemplate } from '@shared/bot-templates'
import { lookFromSeed } from '@shared/describe'
import { BOT_COLORS, BOT_GROUND_FLOOR, BOT_LIMITS, type Bot } from '@shared/types'
import { h, icon } from '../dom'
import { LAST_CWD } from '../modals'
import { brainFields, meterField } from '../modals/brain'
import { botAvatar } from './avatar'
import { colorField, floorField, permissionsField } from './fields'
import { chatError, type ChatCtx } from './util'

// "＋ Novo bot": a galeria dos modelos prontos e o formulário que pede só o necessário, com os
// padrões da spec. Sem bots, a galeria aparece no lugar do fio. Docs: chat-de-bots.md ("Novo bot").

export interface NewBotCtx extends ChatCtx {
  /** The floor the player is on (the form's default). */
  floor(): string
  saved(bot: Bot): void
  cancel(): void
}

const PITCH =
  'Bots são agentes com emprego fixo: rodam sozinhos no horário, escrevem aqui o que fizeram e só param quando precisam do seu sim.'

/** The gallery: a card per template and "Em branco". `pitch` adds the one-line pitch of the empty Chat. */
export function botGallery(opts: { pitch: boolean; onPick(t: BotTemplate | undefined): void; onCancel?: () => void }): HTMLElement {
  const cards = BOT_TEMPLATES.map((t) =>
    h(
      'button',
      { type: 'button', class: 'ch-tpl', style: `--av: ${t.color}`, onclick: () => opts.onPick(t) },
      botAvatar({ look: lookFromSeed(t.id), color: t.color, name: t.name }, 'idle', 44),
      h('span', { class: 'ch-tpl-name' }, t.name),
      h('span', { class: 'ch-tpl-line' }, t.tagline),
      h('span', { class: 'ch-tpl-auto' }, icon(t.schedule ? 'history' : 'spark', 13), templateAutomation(t)),
    ),
  )
  const blank = h(
    'button',
    { type: 'button', class: 'ch-tpl ch-tpl-blank', onclick: () => opts.onPick(undefined), 'data-id': BLANK_TEMPLATE_ID },
    h('span', { class: 'ch-tpl-plus', 'aria-hidden': 'true' }, icon('plus', 22)),
    h('span', { class: 'ch-tpl-name' }, 'Em branco'),
    h('span', { class: 'ch-tpl-line' }, 'Você escreve a função do zero.'),
  )
  return h(
    'div',
    { class: 'ch-gallery' },
    h(
      'div',
      { class: 'ch-gallery-head' },
      h('h2', { class: 'ch-gallery-title' }, opts.pitch ? 'Monte o seu time' : 'Novo bot'),
      opts.onCancel ? h('button', { type: 'button', class: 'btn ch-btn-quiet', onclick: opts.onCancel }, 'Voltar') : null,
    ),
    h('p', { class: 'ch-gallery-pitch' }, opts.pitch ? PITCH : 'Escolha um modelo pronto para começar. Tudo dá para mudar depois.'),
    h('div', { class: 'ch-tpls' }, ...cards, blank),
  )
}

/** The form, filled by the template (or empty). Saving creates the bot. */
export function botForm(ctx: NewBotCtx, t: BotTemplate | undefined): { el: HTMLElement; focus(): void } {
  const s = ctx.state.settings
  const floor = ctx.floor()
  const base = draftFromTemplate(t, {
    floor,
    cwd: floor === BOT_GROUND_FLOOR ? localStorage.getItem(LAST_CWD) || undefined : undefined,
    model: s.defaultModel,
    effort: s.defaultEffort,
    look: lookFromSeed(`${t?.id ?? 'bot'}-${Date.now()}`),
    color: BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)],
  })
  const noop = () => undefined
  const name = h('input', {
    class: 'input',
    value: base.name,
    maxlength: BOT_LIMITS.name,
    placeholder: 'Ex.: Chefe de gabinete',
    'aria-label': 'Nome',
  }) as HTMLInputElement
  const tagline = h('input', {
    class: 'input',
    value: base.tagline ?? '',
    maxlength: BOT_LIMITS.tagline,
    placeholder: 'Uma frase: o que ele faz',
    'aria-label': 'Frase',
  }) as HTMLInputElement
  const role = h(
    'textarea',
    {
      class: 'input ch-role',
      rows: 10,
      maxlength: BOT_LIMITS.role,
      placeholder: 'Você é… Em cada rodada… Nunca… Como reportar…',
      'aria-label': 'Função',
    },
    base.role,
  ) as HTMLTextAreaElement
  const color = colorField(base.color ?? BOT_COLORS[0], noop)
  const where = floorField(ctx, { floor: base.floor, cwd: base.cwd }, noop)
  const brain = brainFields({ model: base.model ?? '', effort: base.effort ?? '' }, true)
  brain.model.classList.add('ch-select')
  const perms = permissionsField(ctx, { mode: base.permissionMode ?? 'default', askBefore: base.askBefore ?? [] }, noop)
  const worktree = h('input', { type: 'checkbox', checked: !!base.worktree }) as HTMLInputElement
  const scheduleOn = h('input', { type: 'checkbox', checked: !!base.schedule }) as HTMLInputElement
  const automation = t?.schedule
    ? h(
        'label',
        { class: 'ch-check' },
        scheduleOn,
        h(
          'span',
          {},
          `Ligada: ${templateAutomation(t)}`,
          h('small', {}, 'a agenda começa a rodar quando as automações chegarem (próxima fase)'),
        ),
      )
    : t?.event
      ? h(
          'p',
          { class: 'ch-soon' },
          h('b', {}, 'Em breve. '),
          `Este modelo roda "${templateAutomation(t)}". Eventos do escritório chegam na próxima fase; até lá, use Rodar agora.`,
        )
      : h('p', { class: 'ch-field-hint' }, 'Sem automação: ele roda quando você escrever ou usar Rodar agora.')
  const error = h('p', { class: 'ch-form-error', role: 'alert', hidden: true })
  const create = h('button', { type: 'submit', class: 'btn ch-btn-accent' }, icon('check', 15), 'Criar bot')

  const field = (label: string, control: HTMLElement, hint?: HTMLElement | string) =>
    h(
      'label',
      { class: 'ch-field' },
      h('span', { class: 'ch-field-label' }, label),
      control,
      hint ? h('span', { class: 'ch-field-hint' }, hint) : null,
    )

  const form = h(
    'form',
    { class: 'ch-form', 'aria-label': t ? `Novo bot: ${t.name}` : 'Novo bot em branco' },
    h(
      'div',
      { class: 'ch-form-head' },
      h('h2', { class: 'ch-gallery-title' }, t ? t.name : 'Novo bot'),
      h('button', { type: 'button', class: 'btn ch-btn-quiet', onclick: () => ctx.cancel() }, 'Voltar à galeria'),
    ),
    h('div', { class: 'ch-form-grid' }, field('Nome', name), field('Frase', tagline)),
    field('Função', role, 'Quem ele é, o que faz em cada rodada, o que nunca faz e como reporta. Vai para o prompt do bot.'),
    h('div', { class: 'ch-field' }, h('span', { class: 'ch-field-label' }, 'Cor'), color.el),
    h(
      'div',
      { class: 'ch-form-grid' },
      where.el,
      h('div', { class: 'ch-field' }, field('Modelo', brain.model, brain.hint), meterField('Esforço', brain.meter)),
    ),
    h('div', { class: 'ch-sec' }, h('h3', { class: 'ch-sec-title' }, 'Permissões'), perms.el),
    h('div', { class: 'ch-sec' }, h('h3', { class: 'ch-sec-title' }, 'Automação'), automation),
    h(
      'label',
      { class: 'ch-check' },
      worktree,
      h('span', {}, 'Cópia isolada (worktree)', h('small', {}, 'ligue para quem edita código: ele trabalha num branch próprio')),
    ),
    error,
    h(
      'div',
      { class: 'ch-form-foot' },
      h('button', { type: 'button', class: 'btn ch-btn-quiet', onclick: () => ctx.cancel() }, 'Cancelar'),
      create,
    ),
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const b = brain.value()
    const w = where.value()
    const p = perms.value()
    const draft = {
      ...base,
      name: name.value.trim(),
      tagline: tagline.value.trim(),
      role: role.value,
      color: color.value(),
      floor: w.floor,
      cwd: w.cwd,
      model: b.model,
      effort: b.effort,
      permissionMode: p.mode,
      askBefore: p.askBefore,
      worktree: worktree.checked,
      schedule: t?.schedule && scheduleOn.checked ? base.schedule : undefined,
    }
    const problem = draftError(draft)
    error.hidden = !problem
    error.textContent = problem ?? ''
    if (problem) return
    create.disabled = true
    try {
      const bot = await window.office.saveBot(draft)
      ctx.toast(`${bot.name} chegou. Diga o que fazer, ou use Rodar agora.`, 'ok')
      ctx.saved(bot)
    } catch (err) {
      error.hidden = false
      error.textContent = chatError(err)
    } finally {
      create.disabled = false
    }
  })
  return { el: h('div', { class: 'ch-form-wrap' }, form), focus: () => name.focus() }
}
