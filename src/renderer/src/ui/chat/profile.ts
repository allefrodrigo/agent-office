import {
  automationEntries,
  botSpending,
  cleanApps,
  draftError,
  draftFromBot,
  isOfficeServer,
  listTime,
  mcpStatus,
  memorySizeLabel,
  OFFICE_MCP,
  scopeAutomations,
  triggerLabel,
  usd,
  utf8Bytes,
} from '@shared/bots-view'
import { templateAutomation, templateById } from '@shared/bot-templates'
import { formatWhen } from '@shared/schedule'
import {
  BOT_LIMITS,
  BOT_RUN_STATUS_LABEL,
  type AutomationDraft,
  type Bot,
  type BotDraft,
  type BotSpend,
  type McpServerView,
  type ToolsView,
} from '@shared/types'
import { h, icon } from '../dom'
import { brainFields, meterField } from '../modals/brain'
import type { AutomationTarget } from './automations/form'
import { botAvatar } from './avatar'
import { colorField, floorField, permissionsField } from './fields'
import { chatStore } from './store'
import { chatError, type ChatCtx } from './util'

// O perfil do bot, à direita: função, cérebro, onde trabalha, permissões, automações, conexões,
// memória, gastos e histórico. Um "Salvar alterações" aparece quando algo mudou; a memória salva
// à parte (é o memoria.md do bot). Docs: docs/prd/chat-de-bots.md ("Perfil do bot").

export interface ProfileCtx extends ChatCtx {
  /** Scrolls the thread to a run (the history's link). */
  reveal(itemId: string): void
  close(): void
  /** Opens the automation form (a saved one, or a new one for this bot); it comes back to the thread. */
  editAutomation(target: AutomationTarget): void
}

/** The MCP servers of Claude Code, read at most once a minute for every profile. */
let servers: { at: number; view: Promise<ToolsView> } | null = null
const SERVERS_MS = 60_000

function loadServers(): Promise<ToolsView> {
  if (!servers || Date.now() - servers.at > SERVERS_MS) {
    const view = window.office.toolsView()
    servers = { at: Date.now(), view }
    view.catch(() => {
      if (servers?.view === view) servers = null
    })
  }
  return servers.view
}

let appsSeq = 0

/** "Quando Relator termina" instead of "Quando outro bot termina". */
const botName = (id: string) => chatStore.bot(id)?.name

/**
 * Conexões: the bot sees every MCP server of Claude Code, or only the ones checked. The office's
 * server (board, minutes, the Chat's tools) is always on and cannot be unchecked.
 */
function appsField(initial: Bot['apps'], onChange: () => void): { el: HTMLElement; value(): Bot['apps'] } {
  const group = `ch-apps-${++appsSeq}`
  const all = h('input', { type: 'radio', name: group, value: 'all', checked: initial === 'all' }) as HTMLInputElement
  const some = h('input', { type: 'radio', name: group, value: 'list', checked: initial !== 'all' }) as HTMLInputElement
  const picked = new Set(initial === 'all' ? [] : initial.filter((a) => a !== OFFICE_MCP))
  const list = h('div', { class: 'ch-apps', role: 'group', 'aria-label': 'Servidores que o bot enxerga' })
  const note = h('p', { class: 'ch-field-hint' })
  let known: McpServerView[] | null = null
  const draw = () => {
    list.hidden = all.checked
    const names = [...new Set([...(known ?? []).map((m) => m.name), ...picked])].sort((a, b) => a.localeCompare(b))
    const office = h(
      'label',
      { class: 'ch-check' },
      h('input', { type: 'checkbox', checked: true, disabled: true }),
      h('span', {}, OFFICE_MCP, h('small', {}, 'sempre ligado: quadro, atas e as ferramentas do Chat')),
    )
    list.replaceChildren(
      office,
      ...names.map((n) => {
        const m = known?.find((x) => x.name === n)
        const box = h('input', { type: 'checkbox', checked: picked.has(n) }) as HTMLInputElement
        box.addEventListener('change', () => {
          if (box.checked) picked.add(n)
          else picked.delete(n)
          onChange()
        })
        const why = m ? mcpStatus(m).text : known ? 'não existe mais no Claude Code' : ''
        return h('label', { class: 'ch-check' }, box, h('span', {}, n, why ? h('small', {}, why) : null))
      }),
    )
  }
  for (const r of [all, some])
    r.addEventListener('change', () => {
      draw()
      onChange()
    })
  void loadServers().then(
    (v) => {
      known = v.mcp.filter((m) => !isOfficeServer(m))
      note.textContent = known.length ? '' : 'O Claude Code não tem outros servidores MCP. Veja em Conexões como adicionar um.'
      draw()
    },
    (err: unknown) => {
      note.textContent = `Não consegui ler os servidores do Claude Code: ${chatError(err)} A lista mostra só os que o bot já tem.`
      note.classList.add('err')
      draw()
    },
  )
  draw()
  const el = h(
    'div',
    { class: 'ch-field' },
    h(
      'div',
      { class: 'ch-apps-mode', role: 'radiogroup', 'aria-label': 'Servidores MCP que o bot enxerga' },
      h(
        'label',
        { class: 'ch-check' },
        all,
        h('span', {}, 'Todos', h('small', {}, 'os servidores MCP do seu Claude Code, os de hoje e os novos')),
      ),
      h(
        'label',
        { class: 'ch-check' },
        some,
        h('span', {}, 'Só os marcados', h('small', {}, 'menos ferramentas no contexto, menos risco')),
      ),
    ),
    list,
    note,
  )
  return { el, value: () => cleanApps(all.checked ? 'all' : 'list', [...picked]) }
}

const RUN_ICON: Record<Bot['runs'][number]['status'], string> = {
  running: 'spark',
  waiting: 'alert',
  ok: 'check',
  failed: 'x',
  skipped: 'history',
}

function section(title: string, ...children: (HTMLElement | string | null)[]): HTMLElement {
  return h('section', { class: 'ch-sec' }, h('h3', { class: 'ch-sec-title' }, title), ...children)
}

export class ProfilePanel {
  readonly el: HTMLElement
  private body: HTMLDivElement
  private foot: HTMLDivElement
  private saveBtn: HTMLButtonElement
  private botId: string | null = null
  private dirty = false
  private read: (() => BotDraft) | null = null
  /** Bot.updatedAt the form was built from. */
  private builtAt = 0
  /** memoria.md was edited and not saved yet. */
  private memDirty = false
  /** The read-only parts, redrawn when the bot changes (runs, spending). */
  private live: HTMLDivElement
  /** The bot's automations: they change with the routines and the triggers, not with the bot. */
  private autos: HTMLDivElement
  private autosKey: unknown[] = []
  /** What the cost book said (botSpend), for the bot and its newest run. */
  private spend: { key: string; value: BotSpend | null; failed: boolean } | null = null

  constructor(private ctx: ProfileCtx) {
    this.body = h('div', { class: 'ch-profile-body' })
    this.live = h('div', { class: 'ch-profile-live' })
    this.autos = h('div', { class: 'ch-profile-autos' })
    this.saveBtn = h('button', { type: 'button', class: 'btn ch-btn-accent', onclick: () => void this.save() }, 'Salvar alterações')
    this.foot = h(
      'div',
      { class: 'ch-profile-foot', hidden: true },
      h('button', { type: 'button', class: 'btn ch-btn-quiet', onclick: () => this.discard() }, 'Descartar'),
      this.saveBtn,
    )
    this.el = h('aside', { class: 'ch-profile', id: 'ch-profile', 'aria-label': 'Perfil do bot', hidden: true }, this.body, this.foot)
  }

  /** The bot on screen changed, or its data did. Edits in progress are kept. */
  show(bot: Bot | undefined): void {
    if (!bot) {
      this.botId = null
      this.body.replaceChildren()
      return
    }
    if (bot.id === this.botId) {
      this.renderLive(bot)
      // runs and reads change the bot all the time: the form is rebuilt only when its definition did
      if (this.dirty || this.memDirty || bot.updatedAt === this.builtAt || this.el.contains(document.activeElement)) return
    }
    this.botId = bot.id
    this.dirty = false
    this.foot.hidden = true
    this.build(bot)
  }

  /** Scrolls to Conexões and puts the focus on its choice ("Mudar no perfil" of the Conexões screen). */
  showConnections(): void {
    const sec = this.body.querySelector<HTMLElement>('#ch-profile-connections')
    if (!sec) return
    sec.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    sec.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true })
  }

  /** The routines or the triggers changed: the Automações section follows. */
  refresh(): void {
    const bot = chatStore.bot(this.botId)
    if (bot && !this.el.hidden) this.renderAutos(bot)
  }

  private touch = (): void => {
    this.dirty = true
    this.foot.hidden = false
  }

  private discard(): void {
    this.dirty = false
    this.foot.hidden = true
    this.build(chatStore.bot(this.botId))
  }

  private build(bot: Bot | undefined): void {
    if (!bot) return
    const ctx = this.ctx
    this.builtAt = bot.updatedAt
    this.memDirty = false
    const name = h('div', { class: 'ch-profile-name' }, bot.name)
    const tagline = h('input', {
      class: 'input ch-input-line',
      value: bot.tagline,
      maxlength: BOT_LIMITS.tagline,
      placeholder: 'Uma frase: o que ele faz',
      'aria-label': 'Frase do bot',
    }) as HTMLInputElement
    tagline.addEventListener('input', this.touch)
    const role = h(
      'textarea',
      { class: 'input ch-role', rows: 9, maxlength: BOT_LIMITS.role, 'aria-label': 'Função do bot' },
      bot.role,
    ) as HTMLTextAreaElement
    role.addEventListener('input', this.touch)
    const color = colorField(bot.color, this.touch)
    const brain = brainFields({ model: bot.model ?? '', effort: bot.effort ?? '' }, true)
    brain.model.classList.add('ch-select')
    brain.model.addEventListener('change', this.touch)
    brain.meter.addEventListener('click', this.touch)
    brain.meter.addEventListener('keyup', this.touch)
    const where = floorField(ctx, { floor: bot.floor, cwd: bot.cwd }, this.touch)
    const worktree = h('input', { type: 'checkbox', checked: bot.worktree }) as HTMLInputElement
    worktree.addEventListener('change', this.touch)
    const perms = permissionsField(ctx, { mode: bot.permissionMode, askBefore: bot.askBefore }, this.touch)
    const apps = appsField(bot.apps, this.touch)
    const budget = h('input', {
      class: 'input ch-input-num',
      type: 'number',
      min: 0,
      step: 0.5,
      value: bot.dailyBudgetUsd || '',
      placeholder: '0',
      'aria-label': 'Teto por dia em dólares',
    }) as HTMLInputElement
    budget.addEventListener('input', this.touch)

    this.read = () => {
      const b = brain.value()
      const w = where.value()
      const p = perms.value()
      const cap = Number(budget.value.replace(',', '.'))
      return {
        ...draftFromBot(chatStore.bot(bot.id) ?? bot),
        tagline: tagline.value.trim(),
        role: role.value,
        color: color.value(),
        model: b.model,
        effort: b.effort,
        floor: w.floor,
        cwd: w.cwd,
        worktree: worktree.checked,
        permissionMode: p.mode,
        askBefore: p.askBefore,
        apps: apps.value(),
        dailyBudgetUsd: Number.isFinite(cap) && cap > 0 ? cap : 0,
      }
    }

    // ---------- automations and connections (phase 2) ----------
    this.autosKey = []
    const automations = section('Automações', this.autos)
    const connections = section('Conexões', apps.el)
    connections.id = 'ch-profile-connections'

    // ---------- memory ----------
    const memory = h('textarea', {
      class: 'input ch-memory',
      rows: 7,
      placeholder: 'Notas que o bot lê em toda rodada. Nunca guarde senhas ou chaves aqui.',
      'aria-label': 'Memória do bot',
      disabled: true,
    }) as HTMLTextAreaElement
    const size = h('span', { class: 'ch-mem-size', 'aria-live': 'polite' })
    const saveMem = h('button', { type: 'button', class: 'btn btn-small', disabled: true }, 'Salvar memória')
    let saved = ''
    const syncMem = () => {
      this.memDirty = memory.value !== saved
      size.textContent = memorySizeLabel(memory.value)
      const over = utf8Bytes(memory.value) > BOT_LIMITS.memoryBytes
      size.classList.toggle('over', over)
      saveMem.disabled = memory.disabled || memory.value === saved
      saveMem.title = over ? 'Passou de 16 KB: o fim é cortado ao salvar.' : ''
    }
    memory.addEventListener('input', syncMem)
    saveMem.addEventListener('click', async () => {
      saveMem.disabled = true
      try {
        await window.office.saveBotMemory(bot.id, memory.value)
        saved = memory.value
        ctx.toast('Memória salva. O bot lê na próxima rodada.', 'ok')
      } catch (err) {
        ctx.toast(chatError(err), 'err')
      }
      syncMem()
    })
    const memNote = h('p', { class: 'ch-field-hint' })
    void window.office.botMemory(bot.id).then(
      (text) => {
        if (this.botId !== bot.id) return
        saved = text
        memory.value = text
        memory.disabled = false
        syncMem()
      },
      (err: unknown) => {
        memNote.textContent = chatError(err)
        memNote.classList.add('err')
      },
    )
    syncMem()

    this.renderLive(bot)
    this.body.replaceChildren(
      h(
        'div',
        { class: 'ch-profile-head' },
        botAvatar(bot, 'idle', 56),
        h('div', { class: 'ch-profile-id' }, name, tagline),
        h(
          'button',
          { type: 'button', class: 'ch-icon-btn', title: 'Fechar o perfil', 'aria-label': 'Fechar o perfil', onclick: () => ctx.close() },
          icon('x', 17),
        ),
      ),
      section(
        'Função',
        role,
        h('p', { class: 'ch-field-hint' }, 'Quem ele é, o que faz em cada rodada, o que nunca faz e como reporta.'),
        h('div', { class: 'ch-field' }, h('span', { class: 'ch-field-label' }, 'Cor'), color.el),
      ),
      section(
        'Cérebro',
        h(
          'label',
          { class: 'ch-field' },
          h('span', { class: 'ch-field-label' }, 'Modelo'),
          brain.model,
          h('span', { class: 'ch-field-hint' }, brain.hint),
        ),
        meterField('Esforço', brain.meter),
      ),
      section(
        'Onde trabalha',
        where.el,
        h(
          'label',
          { class: 'ch-check' },
          worktree,
          h('span', {}, 'Cópia isolada (worktree)', h('small', {}, 'um branch próprio, sem mexer nos arquivos dos outros')),
        ),
      ),
      section('Permissões', perms.el),
      automations,
      connections,
      section('Memória', memory, h('div', { class: 'ch-mem-row' }, size, saveMem), memNote),
      section(
        'Gastos',
        this.live,
        h(
          'label',
          { class: 'ch-field ch-field-row' },
          h('span', { class: 'ch-field-label' }, 'Teto por dia (US$)'),
          budget,
          h('span', { class: 'ch-field-hint' }, '0 = sem teto além do teto por agente'),
        ),
      ),
    )
  }

  /** The bot's routines and event triggers, with the next run; each opens its form. */
  private renderAutos(bot: Bot): void {
    const key = [bot.id, this.ctx.state.routines, chatStore.triggers, chatStore.triggersError]
    if (key.every((k, i) => k === this.autosKey[i])) return
    this.autosKey = key
    const { routines, triggers } = scopeAutomations(this.ctx.state.routines, chatStore.triggers, [bot], { floor: 'all', botId: bot.id })
    const entries = automationEntries(routines, triggers, botName)
    const tpl = templateById(bot.templateId)
    // a bot from the gallery: "＋ Automação" comes filled with its template's suggestion
    const when: AutomationDraft['when'] | undefined = tpl?.schedule
      ? { kind: 'schedule', schedule: structuredClone(tpl.schedule) }
      : tpl?.event
        ? { kind: 'event', event: tpl.event.kind, filter: tpl.event.tags ? { tags: [...tpl.event.tags] } : {} }
        : undefined
    const suggested: AutomationDraft | undefined =
      tpl && when
        ? {
            bot: { kind: 'existing', botId: bot.id },
            name: tpl.name,
            prompt: 'Faça a sua rodada de sempre, como a sua função descreve.',
            when,
            why: '',
          }
        : undefined
    const next = (e: (typeof entries)[number]) =>
      !e.enabled ? 'pausada' : e.kind === 'event' ? 'no evento' : e.nextAt === null ? 'sem próxima' : `próxima: ${formatWhen(e.nextAt)}`
    this.autos.replaceChildren(
      entries.length
        ? h(
            'ul',
            { class: 'ch-autos' },
            entries.map((e) =>
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: `ch-auto-link${e.enabled ? '' : ' paused'}`,
                    title: 'Abrir para editar',
                    onclick: () => this.ctx.editAutomation({ kind: e.kind, id: e.id }),
                  },
                  icon(e.kind === 'event' ? 'spark' : 'history', 14),
                  h('span', { class: 'ch-auto-link-text' }, h('b', {}, e.name), h('span', {}, `${e.label} · ${next(e)}`)),
                ),
              ),
            ),
          )
        : h(
            'p',
            { class: 'ch-field-hint' },
            tpl && suggested
              ? `Nenhuma ainda. O modelo sugere "${templateAutomation(tpl)}": a nova automação já vem com ela.`
              : 'Nenhuma ainda: o bot roda quando você escreve ou usa Rodar agora.',
          ),
      chatStore.triggersError
        ? h('p', { class: 'ch-field-hint err' }, `Os gatilhos de evento não carregaram: ${chatStore.triggersError}`)
        : '',
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small ch-add-auto',
          onclick: () => this.ctx.editAutomation({ kind: 'new', botId: bot.id, draft: entries.length ? undefined : suggested }),
        },
        icon('plus', 14),
        'Automação',
      ),
    )
  }

  /** The cost book's numbers for the bot (botSpend), read again when a run starts or ends. */
  private loadSpend(bot: Bot): void {
    const key = `${bot.id}:${bot.runs[0]?.id ?? ''}:${bot.runs[0]?.status ?? ''}`
    if (this.spend?.key === key) return
    const mine: { key: string; value: BotSpend | null; failed: boolean } = { key, value: null, failed: false }
    this.spend = mine
    const redraw = () => {
      const now = chatStore.bot(bot.id)
      if (this.spend === mine && now && this.botId === bot.id) this.renderLive(now)
    }
    window.office.botSpend(bot.id).then(
      (v) => {
        mine.value = v
        redraw()
      },
      () => {
        mine.failed = true
        redraw()
      },
    )
  }

  /** Spending and history: they change with every run, the form does not. */
  private renderLive(bot: Bot): void {
    this.renderAutos(bot)
    this.loadSpend(bot)
    const book = this.spend?.key.startsWith(`${bot.id}:`) ? this.spend : null
    const s = book?.value ?? botSpending(bot.runs)
    const runs = bot.runs.slice(0, BOT_LIMITS.runs)
    this.live.replaceChildren(
      h(
        'dl',
        { class: 'ch-spend' },
        h('div', {}, h('dt', {}, 'Hoje'), h('dd', {}, usd(s.today) || 'US$ 0,00')),
        h('div', {}, h('dt', {}, '7 dias'), h('dd', {}, usd(s.week) || 'US$ 0,00')),
        h('div', {}, h('dt', {}, '30 dias'), h('dd', {}, usd(s.month) || 'US$ 0,00')),
      ),
      h(
        'p',
        { class: 'ch-field-hint' },
        book?.value
          ? 'Do livro de custos, em dias do seu relógio.'
          : book?.failed
            ? `Das últimas ${BOT_LIMITS.runs} rodadas do bot: o livro de custos não respondeu.`
            : `Das últimas ${BOT_LIMITS.runs} rodadas do bot.`,
      ),
      h('h3', { class: 'ch-sec-title ch-sec-sub' }, 'Histórico'),
      runs.length
        ? h(
            'ol',
            { class: 'ch-history' },
            runs.map((r) =>
              h(
                'li',
                {},
                h(
                  'button',
                  { type: 'button', class: `ch-hist s-${r.status}`, title: 'Ver no fio', onclick: () => this.ctx.reveal(r.itemId) },
                  icon(RUN_ICON[r.status], 14),
                  h('span', { class: 'ch-hist-label' }, triggerLabel(r.trigger)),
                  h('span', { class: 'ch-hist-status' }, BOT_RUN_STATUS_LABEL[r.status]),
                  h('span', { class: 'ch-hist-cost' }, usd(r.costUsd)),
                  h('time', { class: 'ch-hist-time' }, listTime(r.startedAt)),
                ),
              ),
            ),
          )
        : h('p', { class: 'ch-field-hint' }, 'Nenhuma rodada ainda.'),
    )
  }

  private async save(): Promise<void> {
    if (!this.read) return
    const draft = this.read()
    const err = draftError(draft)
    if (err) return this.ctx.toast(err, 'err')
    this.saveBtn.disabled = true
    try {
      await window.office.saveBot(draft)
      this.dirty = false
      this.foot.hidden = true
      this.ctx.toast('Perfil salvo. Vale a partir da próxima mensagem.', 'ok')
    } catch (err) {
      this.ctx.toast(chatError(err), 'err')
    } finally {
      this.saveBtn.disabled = false
    }
  }

  /** Unsaved edits: the screen asks before switching bots or closing. */
  get hasChanges(): boolean {
    return this.dirty
  }
}
