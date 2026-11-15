import { automationPreview, eventLabel } from '@shared/bots-view'
import { BOT_LIMITS, type AutomationDraft } from '@shared/types'
import { h, icon } from '../../dom'
import { botAvatar } from '../avatar'
import { chatStore } from '../store'
import { chatError, floorName, type ChatCtx } from '../util'
import { AutomationSaveError, saveAutomation, type SavedAutomation } from './form'

// "＋ Nova": a automação a partir de uma frase. Você escreve "toda sexta às 17h, resuma a semana";
// o Claude propõe o bot, a agenda (ou o evento) e a tarefa; a prévia mostra a frase da agenda e as
// próximas 3 execuções antes de salvar. Nada é salvo sem o seu clique. Docs: chat-de-bots.md.

export interface SentenceCtx extends ChatCtx {
  /** The floor the sentence is read for (never 'all'). */
  floor(): string
  /** "Ajustar no formulário": the form, filled with the proposal. */
  adjust(draft: AutomationDraft): void
  /** "ou monte no formulário": an empty form. */
  manual(): void
  saved(s: SavedAutomation): void
  close(): void
}

const EXAMPLES = [
  'toda sexta às 17h, resuma a semana do andar',
  'quando nascer um ticket com a tag bug, reproduza e proponha a correção',
  'dias úteis às 9h, revise os PRs abertos',
]

export function sentencePanel(ctx: SentenceCtx): { el: HTMLElement; focus(): void } {
  let token = 0
  const input = h('input', {
    class: 'input ch-sentence-input',
    maxlength: 500,
    placeholder: `Ex.: ${EXAMPLES[0]}`,
    'aria-label': 'A automação numa frase',
    spellcheck: true,
  }) as HTMLInputElement
  const read = h('button', { type: 'submit', class: 'btn ch-btn-accent' }, icon('spark', 15), 'Ler a frase')
  const slot = h('div', { class: 'ch-proposal-slot', 'aria-live': 'polite' })

  const reading = (on: boolean) => {
    read.disabled = on
    read.setAttribute('aria-busy', String(on))
    read.lastChild!.textContent = on ? 'Lendo…' : 'Ler a frase'
  }

  async function readSentence(): Promise<void> {
    const text = input.value.trim()
    if (!text) {
      slot.replaceChildren(h('p', { class: 'ch-field-hint' }, 'Escreva o que o bot faz e quando. Ex.: ', h('i', {}, EXAMPLES[1]), '.'))
      return input.focus()
    }
    const mine = ++token
    reading(true)
    slot.replaceChildren(h('p', { class: 'ch-field-hint' }, 'Lendo a frase…'))
    try {
      const draft = await window.office.draftAutomation(text, ctx.floor())
      if (mine === token) show(draft)
    } catch (err) {
      if (mine !== token) return
      slot.replaceChildren(
        h('p', { class: 'ch-form-error', role: 'alert' }, chatError(err)),
        h('button', { type: 'button', class: 'ch-link', onclick: () => ctx.manual() }, 'Montar no formulário'),
      )
    } finally {
      if (mine === token) reading(false)
    }
  }

  function show(draft: AutomationDraft): void {
    const p = automationPreview(draft)
    const existing = draft.bot.kind === 'existing' ? chatStore.bot(draft.bot.botId) : undefined
    const gone = draft.bot.kind === 'existing' && !existing ? 'O bot proposto não existe mais. Escolha outro no formulário.' : null
    const error = gone ?? p.error
    const bot =
      draft.bot.kind === 'new'
        ? h(
            'span',
            { class: 'ch-proposal-bot' },
            h('b', {}, `Bot novo: ${draft.bot.draft.name || 'sem nome'}`),
            h('small', {}, 'criado ao salvar, com "Pedir permissão" e todas as ações sensíveis pedindo o seu sim'),
          )
        : existing
          ? h('span', { class: 'ch-proposal-bot' }, botAvatar(existing, 'idle', 22), h('b', {}, existing.name))
          : h('span', { class: 'ch-proposal-bot' }, 'Bot removido')
    const where =
      draft.when.kind === 'event' && draft.when.event !== 'bot-done'
        ? ` · andar ${draft.when.filter.floor ? floorName(ctx.state, draft.when.filter.floor) : 'do bot'}`
        : ''
    const fromBot = draft.when.kind === 'event' && draft.when.filter.botId ? chatStore.bot(draft.when.filter.botId)?.name : undefined
    const line = draft.when.kind === 'event' ? eventLabel(draft.when.event, draft.when.filter, fromBot) : p.line
    const row = (k: string, v: HTMLElement | string) => h('div', { class: 'ch-proposal-row' }, h('dt', {}, k), h('dd', {}, v))
    const save = h('button', { type: 'button', class: 'btn ch-btn-accent', disabled: !!error }, icon('check', 15), 'Salvar')
    const problem = h('p', { class: 'ch-form-error', role: 'alert', hidden: !error }, error ?? '')
    save.addEventListener('click', async () => {
      save.disabled = true
      try {
        const saved = await saveAutomation(
          ctx,
          {
            bot: draft.bot,
            name: draft.name,
            prompt: draft.prompt,
            enabled: true,
            when:
              draft.when.kind === 'schedule'
                ? { kind: 'schedule', schedule: draft.when.schedule, missed: 'run' }
                : {
                    kind: 'event',
                    event: draft.when.event,
                    filter: draft.when.filter,
                    maxPerHour: ctx.state.settings.chat?.maxEventRunsPerHour ?? BOT_LIMITS.perHourDefault,
                  },
          },
          ctx.floor(),
        )
        input.value = ''
        ctx.saved(saved)
      } catch (err) {
        // the new bot exists now: the proposal points at it, so a retry does not create another
        if (err instanceof AutomationSaveError && err.botId) draft = { ...draft, bot: { kind: 'existing', botId: err.botId } }
        show(draft)
        const box = slot.querySelector<HTMLElement>('.ch-form-error')
        if (box) {
          box.hidden = false
          box.textContent = err instanceof Error ? err.message : chatError(err)
        }
      } finally {
        if (save.isConnected) save.disabled = false
      }
    })
    slot.replaceChildren(
      h(
        'div',
        { class: 'ch-proposal', role: 'group', 'aria-label': 'Proposta da automação' },
        h('div', { class: 'ch-proposal-head' }, h('b', {}, 'Proposta'), h('span', { class: 'ch-field-hint' }, 'nada foi salvo ainda')),
        h(
          'dl',
          { class: 'ch-proposal-list' },
          row('Bot', bot),
          row('Nome', draft.name || '(sem nome)'),
          row('Quando', `${line}${where}`),
          row('Tarefa', h('span', { class: 'ch-proposal-task' }, draft.prompt || '(sem tarefa)')),
        ),
        draft.why ? h('p', { class: 'ch-field-hint' }, `Como li a frase: ${draft.why}`) : null,
        problem,
        h(
          'div',
          { class: 'ch-proposal-actions' },
          save,
          h('button', { type: 'button', class: 'btn', onclick: () => ctx.adjust(draft) }, icon('edit', 14), 'Ajustar no formulário'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn ch-btn-quiet',
              onclick: () => {
                token++
                slot.replaceChildren()
                input.focus()
              },
            },
            'Descartar',
          ),
        ),
      ),
    )
    ;(error ? slot.querySelector<HTMLElement>('.ch-proposal-actions .btn:not(:disabled)') : save)?.focus()
  }

  const form = h('form', { class: 'ch-sentence-row' }, input, read)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    void readSentence()
  })
  const el = h(
    'section',
    { class: 'ch-sentence', 'aria-label': 'Nova automação' },
    h(
      'div',
      { class: 'ch-sentence-head' },
      h('h3', { class: 'ch-sentence-title' }, 'Nova automação'),
      h(
        'button',
        { type: 'button', class: 'ch-icon-btn', title: 'Fechar', 'aria-label': 'Fechar a nova automação', onclick: () => ctx.close() },
        icon('x', 16),
      ),
    ),
    h(
      'p',
      { class: 'ch-field-hint' },
      'Diga numa frase o que fazer e quando. O Claude propõe o bot, a agenda (ou o evento) e a tarefa; você confere antes de salvar.',
    ),
    form,
    h(
      'p',
      { class: 'ch-sentence-alt' },
      h('button', { type: 'button', class: 'ch-link', onclick: () => ctx.manual() }, 'ou monte no formulário'),
    ),
    slot,
  )
  return { el, focus: () => input.focus() }
}
