import {
  automationEntries,
  botsOnFloor,
  scopeAutomations,
  shiftWeek,
  sortBots,
  weekGrid,
  weekStartOf,
  weekTitle,
  type AutomationEntry,
  type WeekChip,
} from '@shared/bots-view'
import { countdown, formatWhen } from '@shared/schedule'
import { RUN_STATUS_LABEL } from '@shared/types'
import { arrowList, keepFocus } from '../../a11y'
import { h, icon } from '../../dom'
import { confirmDialog } from '../../modals'
import { botAvatar } from '../avatar'
import { chatStore } from '../store'
import { chatError, floorChoices, floorName, type ChatCtx } from '../util'
import { weekView } from './calendar'
import { automationForm, type AutomationTarget, type SavedAutomation } from './form'
import { sentencePanel } from './sentence'

export type { AutomationTarget } from './form'

// "⚡ Automações" (CB-14): todas as automações dos bots do andar (ou de todos), em Lista ou na
// Semana, com filtro por andar e por bot. "＋ Nova" lê uma frase (CB-15) ou abre o formulário.
// Agenda = rotina com executor bot; evento = gatilho do Chat. Docs: chat-de-bots.md ("Automações").

export interface AutomationsCtx extends ChatCtx {
  /** The floor on screen ('all' = every floor); the sidebar's picker. */
  floor(): string
  setFloor(floor: string): void
  /** A real floor (never 'all'): where a sentence is read and a new bot lands. */
  homeFloor(): string
  /** Opens a bot's thread. */
  openBot(botId: string): void
}

type View = 'list' | 'week'

/** localStorage: Lista or Semana, as left. */
const VIEW_KEY = 'agent-office:chat-autos-view'
/** The countdowns ("em 2h14") move along without redrawing the rows. */
const TICK_MS = 30_000

export class AutomationsView {
  readonly el: HTMLElement
  private bar: HTMLElement
  private panelSlot: HTMLElement
  private body: HTMLElement
  private view: View = localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'list'
  private botFilter = ''
  private weekStart = weekStartOf(Date.now())
  private sentenceOpen = false
  private form: { el: HTMLElement; dirty(): boolean } | null = null
  /** What the open form goes back to. */
  private back: (() => void) | null = null
  /** What the last drawing was made from: redraw only when one of them changes. */
  private seen: unknown[] = []
  private ticker = 0

  constructor(private ctx: AutomationsCtx) {
    this.bar = h('div', { class: 'ch-autos-bar' })
    this.panelSlot = h('div', { class: 'ch-autos-panel' })
    this.body = h('div', { class: 'ch-autos-body' })
    this.el = h('div', { class: 'ch-autos-screen' }, this.bar, this.panelSlot, this.body)
  }

  /** A form with changes is open: the screen asks before leaving it. */
  get hasChanges(): boolean {
    return !!this.form?.dirty()
  }

  /** The list or the week (closes the form). */
  show(): void {
    this.form = null
    this.back = null
    this.el.classList.remove('with-form')
    this.renderBar()
    this.renderPanel()
    this.draw(true)
    this.startTicker()
  }

  /** Opens the form; `back` runs after saving or leaving it (default: the list or week). */
  edit(target: AutomationTarget, back?: () => void): void {
    this.back = back ?? null
    const form = automationForm(
      {
        ...this.ctx,
        done: (saved) => this.saved(saved),
        cancel: () => this.leaveForm(),
      },
      target,
    )
    this.form = form
    this.el.classList.add('with-form')
    this.bar.replaceChildren()
    this.panelSlot.replaceChildren()
    this.body.replaceChildren(form.el)
    this.body.scrollTop = 0
    form.focus()
  }

  /** The data changed (routines, triggers, bots, the floor): redraw unless a form is open. */
  refresh(): void {
    if (this.form) return
    this.renderBar()
    this.draw()
  }

  focus(): void {
    ;(this.el.querySelector<HTMLElement>('.ch-sentence-input') ?? this.bar.querySelector<HTMLElement>('input:checked'))?.focus()
  }

  dispose(): void {
    clearInterval(this.ticker)
    this.ticker = 0
  }

  // ---------- the form's way back ----------

  private leaveForm(): void {
    const back = this.back
    if (back) {
      this.form = null
      this.back = null
      return back()
    }
    this.show()
  }

  private saved(s: SavedAutomation): void {
    const bot = chatStore.bot(s.botId)?.name ?? 'O bot'
    const next = s.kind === 'schedule' && s.nextAt ? ` Próxima: ${formatWhen(s.nextAt)}.` : ''
    this.ctx.toast(
      `${s.name} salva. ${s.kind === 'event' ? `${bot} roda quando o evento acontecer.` : `${bot} roda na agenda.`}${next}`,
      'ok',
    )
    this.sentenceOpen = false
    this.leaveForm()
  }

  // ---------- toolbar ----------

  private renderBar(): void {
    const floor = this.ctx.floor()
    const floorBots = sortBots(botsOnFloor(chatStore.bots, floor, true))
    if (this.botFilter && !floorBots.some((b) => b.id === this.botFilter)) this.botFilter = ''
    const radio = (value: View, label: string, ic: string) => {
      const input = h('input', { type: 'radio', name: 'ch-autos-view', value, checked: this.view === value }) as HTMLInputElement
      input.addEventListener('change', () => {
        this.view = value
        localStorage.setItem(VIEW_KEY, value)
        this.draw(true)
      })
      return h('label', { class: 'ch-seg-opt' }, input, h('span', {}, icon(ic, 14), label))
    }
    const floorSel = h(
      'select',
      { class: 'ch-select', 'aria-label': 'Andar' },
      ...floorChoices(this.ctx.state).map((f) => h('option', { value: f.id }, f.name)),
      h('option', { value: 'all' }, 'Todos os andares'),
    ) as HTMLSelectElement
    floorSel.value = floor
    floorSel.addEventListener('change', () => this.ctx.setFloor(floorSel.value))
    const botSel = h(
      'select',
      { class: 'ch-select', 'aria-label': 'Bot' },
      h('option', { value: '' }, 'Todos os bots'),
      ...floorBots.map((b) => h('option', { value: b.id }, b.name)),
    ) as HTMLSelectElement
    botSel.value = this.botFilter
    botSel.addEventListener('change', () => {
      this.botFilter = botSel.value
      this.draw(true)
    })
    const add = h(
      'button',
      {
        type: 'button',
        class: 'btn ch-btn-accent',
        'aria-expanded': String(this.sentenceOpen),
        onclick: () => {
          this.sentenceOpen = !this.sentenceOpen
          this.renderBar()
          this.renderPanel()
          if (this.sentenceOpen) this.focus()
        },
      },
      icon('plus', 15),
      'Nova',
    )
    keepFocus(this.bar, () =>
      this.bar.replaceChildren(
        h(
          'div',
          { class: 'ch-seg', role: 'radiogroup', 'aria-label': 'Como ver', 'data-focus-key': 'view' },
          radio('list', 'Lista', 'list'),
          radio('week', 'Semana', 'history'),
        ),
        h('div', { class: 'ch-autos-filters', 'data-focus-key': 'filters' }, floorSel, botSel),
        h('span', { class: 'ch-autos-gap' }),
        add,
      ),
    )
  }

  private renderPanel(): void {
    if (!this.sentenceOpen) return this.panelSlot.replaceChildren()
    const panel = sentencePanel({
      ...this.ctx,
      floor: () => this.ctx.homeFloor(),
      adjust: (draft) => this.edit({ kind: 'new', draft }),
      manual: () => this.edit({ kind: 'new', botId: this.botFilter || undefined }),
      saved: (s) => this.saved(s),
      close: () => {
        this.sentenceOpen = false
        this.renderBar()
        this.renderPanel()
        this.bar.querySelector<HTMLElement>('[aria-expanded]')?.focus()
      },
    })
    this.panelSlot.replaceChildren(panel.el)
  }

  // ---------- list and week ----------

  private scoped() {
    return scopeAutomations(this.ctx.state.routines, chatStore.triggers, chatStore.bots, {
      floor: this.ctx.floor(),
      botId: this.botFilter || null,
    })
  }

  private draw(force = false): void {
    const key = [
      this.ctx.state.routines,
      chatStore.triggers,
      chatStore.bots,
      this.ctx.floor(),
      this.botFilter,
      this.view,
      this.weekStart,
      chatStore.triggersError,
    ]
    if (!force && key.every((k, i) => k === this.seen[i])) return
    this.seen = key
    const { routines, triggers } = this.scoped()
    const warn = chatStore.triggersError
      ? h(
          'div',
          { class: 'ch-banner', role: 'status' },
          icon('alert', 15),
          h('span', {}, `Os gatilhos de evento não carregaram: ${chatStore.triggersError}`),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => void chatStore.reloadTriggers() }, 'Tentar de novo'),
        )
      : null
    if (this.view === 'week') {
      const now = Date.now()
      const grid = weekGrid(routines, triggers, this.weekStart, now)
      keepFocus(this.body, () =>
        this.body.replaceChildren(
          ...[
            warn,
            weekView(grid, {
              bot: (id) => chatStore.bot(id),
              open: (c) => this.openChip(c),
              shift: (n) => {
                this.weekStart = shiftWeek(this.weekStart, n)
                this.draw(true)
              },
              today: () => {
                this.weekStart = weekStartOf(Date.now())
                this.draw(true)
              },
              title: weekTitle(this.weekStart, now),
              isThisWeek: this.weekStart === weekStartOf(now),
            }),
          ].filter((x): x is HTMLElement => !!x),
        ),
      )
      return
    }
    const entries = automationEntries(routines, triggers)
    keepFocus(this.body, () =>
      this.body.replaceChildren(...[warn, entries.length ? this.list(entries) : this.empty()].filter((x): x is HTMLElement => !!x)),
    )
  }

  private openChip(c: WeekChip): void {
    if (c.kind === 'event') this.edit({ kind: 'event', id: c.id })
    else this.edit({ kind: 'schedule', id: c.id })
  }

  private empty(): HTMLElement {
    const floor = this.ctx.floor()
    const where = floor === 'all' ? 'em nenhum andar' : `no andar ${floorName(this.ctx.state, floor)}`
    const who = this.botFilter ? chatStore.bot(this.botFilter)?.name : null
    return h(
      'div',
      { class: 'ch-empty ch-autos-empty' },
      h('p', { class: 'ch-empty-title' }, who ? `${who} ainda não tem automação.` : `Nenhuma automação ${where}.`),
      h(
        'p',
        {},
        'Uma automação faz o bot rodar sozinho: numa agenda ("dias úteis às 07:30") ou num evento do escritório ("quando nasce um ticket com a tag bug").',
      ),
      h(
        'div',
        { class: 'ch-suggestions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn ch-btn-accent',
            onclick: () => {
              this.sentenceOpen = true
              this.renderBar()
              this.renderPanel()
              this.focus()
            },
          },
          icon('spark', 15),
          'Escrever numa frase',
        ),
        h(
          'button',
          { type: 'button', class: 'btn', onclick: () => this.edit({ kind: 'new', botId: this.botFilter || undefined }) },
          'Montar no formulário',
        ),
      ),
    )
  }

  private nextText(e: AutomationEntry, now = Date.now()): string {
    if (!e.enabled) return 'Pausada'
    if (e.kind === 'event') return 'Quando o evento acontecer'
    return e.nextAt === null ? 'Sem próxima execução' : `Próxima: ${formatWhen(e.nextAt, now)} (${countdown(e.nextAt, now)})`
  }

  private list(entries: AutomationEntry[]): HTMLElement {
    const rows = entries.map((e) => {
      const bot = chatStore.bot(e.botId)
      const key = `${e.kind}:${e.id}`
      const act = (label: string, ic: string, fn: () => void, extra = '') =>
        h(
          'button',
          {
            type: 'button',
            class: `ch-icon-btn ch-auto-act${extra}`,
            title: label,
            'aria-label': `${label}: ${e.name}`,
            'data-focus-key': `${key}:${ic}`,
            onclick: fn,
          },
          icon(ic, 15),
        )
      return h(
        'div',
        { class: `ch-auto-row${e.enabled ? '' : ' paused'}`, role: 'listitem' },
        h(
          'button',
          {
            type: 'button',
            class: 'ch-auto-main',
            'data-focus-key': key,
            onclick: () => this.edit({ kind: e.kind, id: e.id }),
            'aria-label': `${e.name}, ${bot?.name ?? 'bot removido'}. ${e.label}. ${this.nextText(e)}. Abrir para editar.`,
          },
          h('span', { class: `ch-auto-icon k-${e.kind}`, 'aria-hidden': 'true' }, icon(e.kind === 'event' ? 'spark' : 'history', 16)),
          h(
            'span',
            { class: 'ch-auto-text' },
            h('span', { class: 'ch-auto-name' }, e.name),
            h('span', { class: 'ch-auto-when' }, e.label),
            h('span', { class: 'ch-auto-next', 'data-next': key }, this.nextText(e)),
          ),
          bot
            ? h('span', { class: 'ch-auto-bot' }, botAvatar(bot, 'idle', 22), h('span', {}, bot.name))
            : h('span', { class: 'ch-auto-bot' }, 'Bot removido'),
        ),
        h(
          'div',
          { class: 'ch-auto-acts' },
          e.kind === 'schedule' ? act('Rodar agora', 'play', () => void this.runNow(e)) : null,
          act(e.enabled ? 'Pausar' : 'Retomar', e.enabled ? 'pause' : 'reset', () => void this.toggle(e)),
          bot ? act('Abrir o fio do bot', 'message', () => this.ctx.openBot(bot.id)) : null,
          act('Apagar', 'trash', () => void this.remove(e), ' danger'),
        ),
      )
    })
    const list = h('div', { class: 'ch-auto-list', role: 'list', 'aria-label': 'Automações' }, ...rows)
    arrowList(list, '.ch-auto-main')
    const mains = [...list.querySelectorAll<HTMLElement>('.ch-auto-main')]
    mains.forEach((m, i) => (m.tabIndex = i === 0 ? 0 : -1))
    return list
  }

  private startTicker(): void {
    if (this.ticker) return
    this.ticker = window.setInterval(() => {
      if (!this.el.isConnected || this.form || this.view !== 'list') return
      const now = Date.now()
      const { routines, triggers } = this.scoped()
      const byKey = new Map(automationEntries(routines, triggers).map((e) => [`${e.kind}:${e.id}`, e]))
      for (const span of this.body.querySelectorAll<HTMLElement>('[data-next]')) {
        const e = byKey.get(span.dataset.next ?? '')
        if (e) span.textContent = this.nextText(e, now)
      }
    }, TICK_MS)
  }

  // ---------- row actions ----------

  private async runNow(e: AutomationEntry): Promise<void> {
    try {
      const r = await window.office.runRoutineNow(e.id)
      const run = r.history[0]
      if (run?.status === 'failed' || run?.status === 'skipped')
        this.ctx.toast(`${e.name}: ${run.error ?? RUN_STATUS_LABEL[run.status]}`, 'err')
      else this.ctx.toast(`${e.name} começou. O resultado chega no fio de ${chatStore.bot(e.botId)?.name ?? 'o bot'}.`, 'ok')
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
    }
  }

  private async toggle(e: AutomationEntry): Promise<void> {
    try {
      if (e.kind === 'schedule') {
        const r = await window.office.setRoutineEnabled(e.id, !e.enabled)
        this.ctx.state.routines = this.ctx.state.routines.map((x) => (x.id === r.id ? r : x))
      } else {
        chatStore.upsertTrigger(await window.office.setBotTriggerEnabled(e.id, !e.enabled))
      }
      this.ctx.toast(e.enabled ? `${e.name} pausada.` : `${e.name} retomada.`, 'ok')
      this.draw()
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
    }
  }

  private async remove(e: AutomationEntry): Promise<void> {
    const yes = await confirmDialog(this.ctx.root, {
      title: `Apagar ${e.name}?`,
      text: `${e.kind === 'schedule' ? 'A agenda' : 'O gatilho'} e o histórico somem. O bot e a conversa dele continuam.`,
      confirm: 'Apagar',
      cancel: 'Cancelar',
      danger: true,
    })
    if (!yes) return
    try {
      if (e.kind === 'schedule') {
        await window.office.deleteRoutine(e.id)
        this.ctx.state.routines = this.ctx.state.routines.filter((x) => x.id !== e.id)
      } else {
        await window.office.deleteBotTrigger(e.id)
        chatStore.removeTrigger(e.id)
      }
      this.ctx.toast(`${e.name} apagada.`, 'ok')
      this.draw()
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
    }
  }
}
