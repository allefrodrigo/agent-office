import { draftFromTemplate } from '@shared/bot-templates'
import {
  botRoutineDraft,
  clampPerHour,
  draftError,
  eventLabel,
  parseTags,
  routineBotId,
  scheduleDraftError,
  sortBots,
  TICKET_COLUMN_LABEL,
  triggerDraftError,
} from '@shared/bots-view'
import { lookFromSeed } from '@shared/describe'
import {
  BOT_COLORS,
  BOT_EVENT_LABEL,
  BOT_GROUND_FLOOR,
  BOT_LIMITS,
  ROUTINE_LIMITS,
  SENSITIVE_KINDS,
  type AutomationDraft,
  type Bot,
  type BotDraft,
  type BotEventKind,
  type BotEventTrigger,
  type BotTriggerDraft,
  type MissedPolicy,
  type Schedule,
  type TicketStatus,
} from '@shared/types'
import { h, icon } from '../../dom'
import { confirmDialog, LAST_CWD } from '../../modals'
import { scheduleFields } from '../../routines/editor'
import { chatStore } from '../store'
import { chatError, floorChoices, floorName, type ChatCtx } from '../util'

// O formulário de uma automação do Chat: o bot, o nome, a tarefa e o quando, que é uma agenda
// (uma rotina com executor bot, o mesmo formulário da rotina, com a frase e as próximas 3
// execuções) ou um evento do escritório (gatilho com filtro e limite por hora). Também salva a
// proposta de "＋ Nova" (automação a partir de uma frase). Docs: chat-de-bots.md ("Automações").

/** What the form edits: a saved schedule or event, or a new one (for a bot, or from a sentence's proposal). */
export type AutomationTarget =
  { kind: 'schedule'; id: string } | { kind: 'event'; id: string } | { kind: 'new'; botId?: string; draft?: AutomationDraft }

/** An automation ready to save; a new bot (from a proposal) is created first. */
export interface AutomationInput {
  bot: AutomationDraft['bot']
  name: string
  prompt: string
  enabled: boolean
  when:
    | { kind: 'schedule'; id?: string; schedule: Schedule; missed: MissedPolicy }
    | { kind: 'event'; id?: string; event: BotEventKind; filter: BotEventTrigger['filter']; maxPerHour: number }
}

export interface SavedAutomation {
  kind: 'schedule' | 'event'
  id: string
  botId: string
  name: string
  /** The next run of a schedule. */
  nextAt?: number | null
}

/** Saving failed. `botId` is set when the new bot was created before the failure: retry with it. */
export class AutomationSaveError extends Error {
  constructor(
    message: string,
    readonly botId?: string,
  ) {
    super(message)
  }
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * The bot a sentence proposed, with the form's defaults: the floor on screen, the app's model,
 * a portrait and a color. The guard stays fully on ("Pedir permissão", every sensitive kind
 * checked) whatever the proposal says: only the player loosens it, in the profile. The
 * schedule is left out: the automation becomes its routine here, once.
 */
export function completeNewBot(ctx: ChatCtx, draft: BotDraft, floor: string): BotDraft {
  const s = ctx.state.settings
  const f = draft.floor || floor
  const base = draftFromTemplate(undefined, {
    floor: f,
    cwd: f === BOT_GROUND_FLOOR ? draft.cwd || localStorage.getItem(LAST_CWD) || undefined : undefined,
    model: s.defaultModel,
    effort: s.defaultEffort,
    look: lookFromSeed(`${draft.name}-${Date.now()}`),
    color: BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)],
  })
  return {
    ...base,
    name: draft.name,
    tagline: draft.tagline ?? '',
    role: draft.role,
    color: draft.color && (BOT_COLORS as readonly string[]).includes(draft.color) ? draft.color : base.color,
    look: draft.look ?? base.look,
    model: draft.model || base.model,
    effort: draft.effort || base.effort,
    apps: draft.apps ?? 'all',
    worktree: !!draft.worktree,
    permissionMode: 'default',
    askBefore: [...SENSITIVE_KINDS],
    schedule: undefined,
  }
}

/** The automation's own checks, before anything (a new bot included) is saved. */
function inputError(input: AutomationInput, botId: string): string | null {
  if (input.when.kind === 'schedule') return scheduleDraftError({ name: input.name, prompt: input.prompt, schedule: input.when.schedule })
  return triggerDraftError({
    botId,
    name: input.name,
    kind: input.when.event,
    filter: input.when.filter,
    prompt: input.prompt,
    maxPerHour: input.when.maxPerHour,
  })
}

/**
 * Saves the automation: a routine run by the bot, or an event trigger. A new bot from a
 * proposal is created first; when the automation then fails, the error carries its id.
 */
export async function saveAutomation(ctx: ChatCtx, input: AutomationInput, floor: string): Promise<SavedAutomation> {
  const pre = inputError(input, input.bot.kind === 'existing' ? input.bot.botId : 'novo')
  if (pre) throw new AutomationSaveError(pre)
  let bot: Bot | undefined
  let created: string | undefined
  if (input.bot.kind === 'new') {
    const draft = completeNewBot(ctx, input.bot.draft, floor)
    const problem = draftError(draft)
    if (problem) throw new AutomationSaveError(`O bot novo não fecha: ${lower(problem)} Ou escolha um bot que já existe.`)
    try {
      bot = await window.office.saveBot(draft)
    } catch (err) {
      throw new AutomationSaveError(`Não consegui criar o bot ${draft.name}: ${chatError(err)}`)
    }
    chatStore.upsertBot(bot)
    created = bot.id
  } else {
    bot = chatStore.bot(input.bot.botId)
    if (!bot) throw new AutomationSaveError('Esse bot não existe mais. Escolha outro.')
  }
  try {
    if (input.when.kind === 'schedule') {
      const d = botRoutineDraft(bot, {
        id: input.when.id,
        name: input.name,
        prompt: input.prompt,
        schedule: input.when.schedule,
        enabled: input.enabled,
        missed: input.when.missed,
      })
      const r = await window.office.saveRoutine(d)
      // the routines event may come a moment later: show the saved copy right away
      const st = ctx.state
      st.routines = st.routines.some((x) => x.id === r.id) ? st.routines.map((x) => (x.id === r.id ? r : x)) : [...st.routines, r]
      return { kind: 'schedule', id: r.id, botId: bot.id, name: r.name, nextAt: r.nextAt }
    }
    const d: BotTriggerDraft = {
      ...(input.when.id ? { id: input.when.id } : {}),
      botId: bot.id,
      name: input.name.trim(),
      kind: input.when.event,
      filter: input.when.filter,
      prompt: input.prompt.trim(),
      enabled: input.enabled,
      maxPerHour: clampPerHour(input.when.maxPerHour),
    }
    const t = await window.office.saveBotTrigger(d)
    chatStore.upsertTrigger(t)
    return { kind: 'event', id: t.id, botId: bot.id, name: t.name }
  } catch (err) {
    const text = chatError(err)
    throw new AutomationSaveError(created ? `${bot.name} foi criado, mas a automação não: ${text}` : text, created)
  }
}

export interface FormCtx extends ChatCtx {
  /** The floor on screen ('all' = every floor): the bot picked first lives on it. */
  floor(): string
  /** A real floor (never 'all'): where a new bot from a proposal lands when it names none. */
  homeFloor(): string
  done(saved: SavedAutomation): void
  /** Back without saving (and after deleting). */
  cancel(): void
}

const NEW_BOT = '__novo__'

/** "{ticket}", "{ata}", "{saida}": what each event puts into the task. */
const EVENT_HINT: Record<BotEventKind, string> = {
  'ticket-created': 'Use {ticket} para colocar o ticket completo na tarefa.',
  'ticket-moved': 'Use {ticket} para colocar o ticket e a coluna de onde ele veio.',
  'meeting-ata': 'Use {ata} para colocar a ata e os itens de ação.',
  'bot-done': 'Use {saida} para colocar o texto final da rodada do outro bot.',
}

const field = (label: string, control: HTMLElement, hint?: HTMLElement | string | null) =>
  h(
    'label',
    { class: 'ch-field' },
    h('span', { class: 'ch-field-label' }, label),
    control,
    hint ? (typeof hint === 'string' ? h('span', { class: 'ch-field-hint' }, hint) : hint) : null,
  )

let formSeq = 0

/** The form: a schedule or an office event for one bot. */
export function automationForm(ctx: FormCtx, target: AutomationTarget): { el: HTMLElement; focus(): void; dirty(): boolean } {
  const seq = ++formSeq
  const routine = target.kind === 'schedule' ? ctx.state.routines.find((r) => r.id === target.id) : undefined
  const trigger = target.kind === 'event' ? chatStore.trigger(target.id) : undefined
  const proposal = target.kind === 'new' ? target.draft : undefined
  const editing = !!(routine || trigger)
  let newBot: BotDraft | undefined = proposal?.bot.kind === 'new' ? proposal.bot.draft : undefined
  let dirty = false
  const touch = () => (dirty = true)

  // ---------- the bot ----------
  const bots = sortBots(chatStore.bots)
  const initBot =
    (routine && routineBotId(routine)) ||
    trigger?.botId ||
    (proposal?.bot.kind === 'existing' ? proposal.bot.botId : undefined) ||
    (target.kind === 'new' ? target.botId : undefined) ||
    (newBot ? NEW_BOT : undefined) ||
    bots.find((b) => !b.hidden && (ctx.floor() === 'all' || b.floor === ctx.floor()))?.id ||
    ''
  const manyFloors = new Set(bots.map((b) => b.floor)).size > 1
  const botSel = h('select', { class: 'ch-select', 'aria-label': 'Bot que roda a automação' }) as HTMLSelectElement
  const fillBots = (keep: string) => {
    const opts = bots.map((b) =>
      h('option', { value: b.id }, `${b.name}${manyFloors ? ` · ${floorName(ctx.state, b.floor)}` : ''}${b.hidden ? ' (escondido)' : ''}`),
    )
    if (newBot) opts.unshift(h('option', { value: NEW_BOT }, `Bot novo: ${newBot.name || 'sem nome'} (criado ao salvar)`))
    if (!opts.length) opts.push(h('option', { value: '' }, 'Nenhum bot ainda: crie um em Novo bot'))
    else if (!keep) opts.unshift(h('option', { value: '' }, 'Escolha um bot'))
    if (keep && keep !== NEW_BOT && !bots.some((b) => b.id === keep)) opts.push(h('option', { value: keep }, 'Bot apagado'))
    botSel.replaceChildren(...opts)
    botSel.value = keep
  }
  fillBots(initBot)
  const botHint = h('span', { class: 'ch-field-hint' })

  // ---------- name and task ----------
  const name = h('input', {
    class: 'input',
    value: routine?.name ?? trigger?.name ?? proposal?.name ?? '',
    maxlength: ROUTINE_LIMITS.name,
    placeholder: 'Ex.: Resumo da semana',
    'aria-label': 'Nome',
  }) as HTMLInputElement
  const prompt = h(
    'textarea',
    {
      class: 'input ch-auto-prompt',
      rows: 5,
      maxlength: ROUTINE_LIMITS.prompt,
      'aria-label': 'Tarefa',
      placeholder: 'O que o bot faz em cada rodada.',
    },
    routine?.prompt ?? trigger?.prompt ?? proposal?.prompt ?? '',
  ) as HTMLTextAreaElement
  const promptHint = h('span', { class: 'ch-field-hint' })

  // ---------- when: schedule or event ----------
  const initMode: 'schedule' | 'event' = trigger ? 'event' : routine ? 'schedule' : proposal?.when.kind === 'event' ? 'event' : 'schedule'
  const group = `ch-when-${seq}`
  const modeRadio = (value: 'schedule' | 'event', label: string) => {
    const input = h('input', { type: 'radio', name: group, value, checked: initMode === value, disabled: editing }) as HTMLInputElement
    return { input, el: h('label', { class: 'ch-seg-opt' }, input, h('span', {}, label)) }
  }
  const modeSchedule = modeRadio('schedule', 'Agenda')
  const modeEvent = modeRadio('event', 'Evento do escritório')
  const mode = () => (modeEvent.input.checked ? 'event' : 'schedule')

  const sched = scheduleFields(routine?.schedule ?? (proposal?.when.kind === 'schedule' ? proposal.when.schedule : undefined))
  const missedRun = h('input', { type: 'radio', name: `ch-missed-${seq}`, value: 'run' }) as HTMLInputElement
  const missedSkip = h('input', { type: 'radio', name: `ch-missed-${seq}`, value: 'skip' }) as HTMLInputElement
  ;(routine?.missed === 'skip' ? missedSkip : missedRun).checked = true
  const schedulePart = h(
    'div',
    { class: 'ch-auto-part ch-sched' },
    sched.el,
    h(
      'fieldset',
      { class: 'ch-field' },
      h('legend', { class: 'ch-field-label' }, 'Se o app estiver fechado no horário'),
      h('label', { class: 'ch-check' }, missedRun, h('span', {}, 'Rodar uma vez ao abrir')),
      h('label', { class: 'ch-check' }, missedSkip, h('span', {}, 'Pular e registrar como perdida')),
    ),
  )

  const ev = trigger
    ? { kind: trigger.kind, filter: trigger.filter }
    : proposal?.when.kind === 'event'
      ? { kind: proposal.when.event, filter: proposal.when.filter }
      : { kind: 'ticket-created' as BotEventKind, filter: {} as BotEventTrigger['filter'] }
  const kindSel = h(
    'select',
    { class: 'ch-select', 'aria-label': 'Evento' },
    ...(Object.keys(BOT_EVENT_LABEL) as BotEventKind[]).map((k) => h('option', { value: k }, BOT_EVENT_LABEL[k])),
  ) as HTMLSelectElement
  kindSel.value = ev.kind
  const floorSel = h(
    'select',
    { class: 'ch-select', 'aria-label': 'Andar do evento' },
    h('option', { value: '' }, 'O andar do bot'),
    ...floorChoices(ctx.state).map((f) => h('option', { value: f.id }, f.name)),
  ) as HTMLSelectElement
  if (ev.filter.floor && !floorChoices(ctx.state).some((f) => f.id === ev.filter.floor))
    floorSel.append(h('option', { value: ev.filter.floor }, 'Andar removido'))
  floorSel.value = ev.filter.floor ?? ''
  const tags = h('input', {
    class: 'input',
    value: (ev.filter.tags ?? []).join(', '),
    placeholder: 'bug, urgente (vazio = qualquer ticket)',
    'aria-label': 'Tags do ticket',
    spellcheck: false,
  }) as HTMLInputElement
  const column = h(
    'select',
    { class: 'ch-select', 'aria-label': 'Coluna de destino' },
    h('option', { value: '' }, 'Qualquer coluna'),
    ...(Object.keys(TICKET_COLUMN_LABEL) as TicketStatus[]).map((c) => h('option', { value: c }, TICKET_COLUMN_LABEL[c])),
  ) as HTMLSelectElement
  column.value = ev.filter.column ?? ''
  const fromBot = h('select', { class: 'ch-select', 'aria-label': 'Bot que termina' }) as HTMLSelectElement
  const fillFromBots = () => {
    const keep = fromBot.value || ev.filter.botId || ''
    const others = bots.filter((b) => b.id !== botSel.value)
    fromBot.replaceChildren(h('option', { value: '' }, 'Qualquer outro bot'), ...others.map((b) => h('option', { value: b.id }, b.name)))
    fromBot.value = others.some((b) => b.id === keep) ? keep : ''
  }
  fillFromBots()
  const onlyOk = h('input', { type: 'checkbox', checked: !!ev.filter.onlyOk }) as HTMLInputElement
  const cap = h('input', {
    class: 'input ch-input-num',
    type: 'number',
    min: 1,
    max: BOT_LIMITS.perHourMax,
    step: 1,
    value: clampPerHour(trigger?.maxPerHour ?? ctx.state.settings.chat?.maxEventRunsPerHour ?? BOT_LIMITS.perHourDefault),
    'aria-label': 'Rodadas por hora, no máximo',
    'aria-describedby': `ch-cap-hint-${seq}`,
  }) as HTMLInputElement
  // never above the cap, not even while typing: the loop guard is not optional
  cap.addEventListener('input', () => {
    const n = Number(cap.value)
    if (cap.value !== '' && n > BOT_LIMITS.perHourMax) cap.value = String(BOT_LIMITS.perHourMax)
  })
  cap.addEventListener('change', () => (cap.value = String(clampPerHour(Number(cap.value || NaN)))))
  const capHint = h(
    'span',
    { class: 'ch-field-hint', id: `ch-cap-hint-${seq}` },
    `Proteção contra laço: até ${BOT_LIMITS.perHourMax} por hora; um bot nunca dispara a si mesmo e a corrente entre bots para no ${BOT_LIMITS.chainDepth}º elo.`,
  )
  const rowFloor = field('Andar', floorSel)
  const rowTags = field('Tags', tags, 'Qualquer uma delas basta.')
  const rowColumn = field('Para a coluna', column)
  const rowFrom = field('Quando este bot terminar', fromBot)
  const rowOk = h('label', { class: 'ch-check' }, onlyOk, h('span', {}, 'Só quando a rodada dele terminar bem'))
  const eventSentence = h('p', { class: 'ch-auto-sentence', 'aria-live': 'polite' })
  const eventPart = h(
    'div',
    { class: 'ch-auto-part' },
    field('Evento', kindSel),
    h('div', { class: 'ch-form-grid' }, rowFloor, rowColumn),
    rowTags,
    rowFrom,
    rowOk,
    eventSentence,
    h(
      'div',
      { class: 'ch-field' },
      h('label', { class: 'ch-field-label', for: `ch-cap-${seq}` }, 'Rodadas por hora, no máximo'),
      cap,
      capHint,
    ),
  )
  cap.id = `ch-cap-${seq}`

  const filter = (): BotEventTrigger['filter'] => {
    const k = kindSel.value as BotEventKind
    const f: BotEventTrigger['filter'] = {}
    if (k !== 'bot-done' && floorSel.value) f.floor = floorSel.value
    if (k === 'ticket-created' || k === 'ticket-moved') {
      const t = parseTags(tags.value)
      if (t.length) f.tags = t
    }
    if (k === 'ticket-moved' && column.value) f.column = column.value as TicketStatus
    if (k === 'bot-done') {
      if (fromBot.value) f.botId = fromBot.value
      if (onlyOk.checked) f.onlyOk = true
    }
    return f
  }

  const enabled = h('input', { type: 'checkbox', checked: routine?.enabled ?? trigger?.enabled ?? true }) as HTMLInputElement
  const error = h('p', { class: 'ch-form-error', role: 'alert', hidden: true })

  const sync = () => {
    const isEvent = mode() === 'event'
    schedulePart.hidden = isEvent
    eventPart.hidden = !isEvent
    const k = kindSel.value as BotEventKind
    rowFloor.hidden = k === 'bot-done'
    rowTags.hidden = !(k === 'ticket-created' || k === 'ticket-moved')
    rowColumn.hidden = k !== 'ticket-moved'
    rowFrom.hidden = k !== 'bot-done'
    rowOk.hidden = k !== 'bot-done'
    promptHint.textContent = isEvent
      ? `${EVENT_HINT[k]} O bot recebe a tarefa com a memória e as últimas mensagens do fio.`
      : 'O bot recebe isto em cada rodada, com a memória e as últimas mensagens do fio. O resultado fica no fio dele.'
    const b = chatStore.bot(botSel.value)
    const who = botSel.value === NEW_BOT ? (newBot?.name ?? 'o bot novo') : (b?.name ?? 'o bot')
    const f = filter()
    const where =
      k === 'bot-done' ? '' : ` · andar ${f.floor ? floorName(ctx.state, f.floor) : b ? floorName(ctx.state, b.floor) : 'do bot'}`
    eventSentence.textContent = `${eventLabel(k, f, f.botId ? chatStore.bot(f.botId)?.name : undefined)}${where} → ${who}`
    botHint.textContent =
      botSel.value === NEW_BOT
        ? 'Nasce com "Pedir permissão" e todas as ações sensíveis pedindo o seu sim. Ajuste depois no perfil.'
        : b
          ? `Roda ${b.floor === BOT_GROUND_FLOOR ? 'no térreo' : `no andar ${floorName(ctx.state, b.floor)}`}, com as permissões do bot.`
          : ''
  }
  botSel.addEventListener('change', () => {
    fillFromBots()
    sync()
  })
  for (const el of [modeSchedule.input, modeEvent.input, kindSel, floorSel, tags, column, fromBot, onlyOk]) {
    el.addEventListener('change', sync)
    el.addEventListener('input', sync)
  }
  sync()

  // ---------- save and delete ----------
  const save = h('button', { type: 'submit', class: 'btn ch-btn-accent' }, icon('check', 15), editing ? 'Salvar' : 'Criar automação')
  const input = (): AutomationInput => ({
    bot: botSel.value === NEW_BOT && newBot ? { kind: 'new', draft: newBot } : { kind: 'existing', botId: botSel.value },
    name: name.value,
    prompt: prompt.value,
    enabled: enabled.checked,
    when:
      mode() === 'schedule'
        ? { kind: 'schedule', id: routine?.id, schedule: sched.value(), missed: missedSkip.checked ? 'skip' : 'run' }
        : {
            kind: 'event',
            id: trigger?.id,
            event: kindSel.value as BotEventKind,
            filter: filter(),
            maxPerHour: clampPerHour(Number(cap.value || NaN)),
          },
  })
  const showError = (text: string | null) => {
    error.hidden = !text
    error.textContent = text ?? ''
  }

  const remove = async () => {
    const what = routine ?? trigger
    if (!what) return
    const yes = await confirmDialog(ctx.root, {
      title: `Apagar ${what.name}?`,
      text: routine
        ? 'A agenda e o histórico dela somem. O bot e a conversa dele continuam.'
        : 'O gatilho e o histórico dele somem. O bot e a conversa dele continuam.',
      confirm: 'Apagar',
      cancel: 'Cancelar',
      danger: true,
    })
    if (!yes) return
    try {
      if (routine) {
        await window.office.deleteRoutine(routine.id)
        ctx.state.routines = ctx.state.routines.filter((r) => r.id !== routine.id)
      } else if (trigger) {
        await window.office.deleteBotTrigger(trigger.id)
        chatStore.removeTrigger(trigger.id)
      }
      ctx.toast(`${what.name} apagada.`, 'ok')
      ctx.cancel()
    } catch (err) {
      showError(chatError(err))
    }
  }

  const title = editing ? `Editar ${routine?.name ?? trigger?.name}` : proposal ? 'Ajustar a proposta' : 'Nova automação'
  const form = h(
    'form',
    { class: 'ch-form ch-auto-form', 'aria-label': title },
    h(
      'div',
      { class: 'ch-form-head' },
      h('h2', { class: 'ch-gallery-title' }, title),
      h('button', { type: 'button', class: 'btn ch-btn-quiet', onclick: () => ctx.cancel() }, 'Voltar'),
    ),
    h('div', { class: 'ch-form-grid' }, field('Bot', botSel, botHint), field('Nome', name)),
    h(
      'fieldset',
      { class: 'ch-field' },
      h('legend', { class: 'ch-field-label' }, 'Quando'),
      h('div', { class: 'ch-seg', role: 'radiogroup', 'aria-label': 'Agenda ou evento' }, modeSchedule.el, modeEvent.el),
      editing ? h('span', { class: 'ch-field-hint' }, 'Para trocar agenda por evento, crie outra automação e apague esta.') : null,
    ),
    schedulePart,
    eventPart,
    field('Tarefa', prompt, promptHint),
    h('label', { class: 'ch-check' }, enabled, h('span', {}, 'Ativa', h('small', {}, 'desmarque para salvar pausada'))),
    error,
    h(
      'div',
      { class: 'ch-form-foot' },
      editing
        ? h(
            'button',
            { type: 'button', class: 'btn btn-danger-soft ch-foot-left', onclick: () => void remove() },
            icon('trash', 14),
            'Apagar',
          )
        : null,
      h('button', { type: 'button', class: 'btn ch-btn-quiet', onclick: () => ctx.cancel() }, 'Cancelar'),
      save,
    ),
  )
  form.addEventListener('input', touch)
  form.addEventListener('change', touch)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (mode() === 'schedule') {
      const problem = sched.error()
      if (problem) return showError(problem)
    }
    if (!botSel.value) return showError('Escolha o bot que roda esta automação.')
    showError(null)
    save.disabled = true
    try {
      const saved = await saveAutomation(ctx, input(), ctx.floor() === 'all' ? ctx.homeFloor() : ctx.floor())
      dirty = false
      ctx.done(saved)
    } catch (err) {
      if (err instanceof AutomationSaveError && err.botId) {
        // the new bot exists now: a retry uses it instead of creating another
        newBot = undefined
        bots.splice(0, bots.length, ...sortBots(chatStore.bots))
        fillBots(err.botId)
        sync()
      }
      showError(err instanceof Error ? err.message : chatError(err))
    } finally {
      save.disabled = false
    }
  })

  return {
    el: h('div', { class: 'ch-form-wrap' }, form),
    focus: () => (botSel.value ? name : botSel).focus(),
    dirty: () => dirty,
  }
}
