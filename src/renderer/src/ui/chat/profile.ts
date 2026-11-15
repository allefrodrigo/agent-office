import {
  botAutomations,
  botSpending,
  draftError,
  draftFromBot,
  listTime,
  memorySizeLabel,
  triggerLabel,
  usd,
  utf8Bytes,
} from '@shared/bots-view'
import { templateAutomation, templateById } from '@shared/bot-templates'
import { BOT_LIMITS, BOT_RUN_STATUS_LABEL, type Bot, type BotDraft } from '@shared/types'
import { h, icon } from '../dom'
import { brainFields, meterField } from '../modals/brain'
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

  constructor(private ctx: ProfileCtx) {
    this.body = h('div', { class: 'ch-profile-body' })
    this.live = h('div', { class: 'ch-profile-live' })
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
        dailyBudgetUsd: Number.isFinite(cap) && cap > 0 ? cap : 0,
      }
    }

    // ---------- automations and connections (phase 2) ----------
    const autos = botAutomations(bot.id, ctx.state.routines, chatStore.triggers)
    const tpl = templateById(bot.templateId)
    const automations = section(
      'Automações',
      autos.length
        ? h(
            'ul',
            { class: 'ch-autos' },
            autos.map((a) => h('li', {}, icon(a.nextAt === null ? 'spark' : 'history', 14), a.label)),
          )
        : h(
            'p',
            { class: 'ch-soon' },
            h('b', {}, 'Em breve. '),
            tpl
              ? `Este bot nasceu com a sugestão "${templateAutomation(tpl)}". Agenda e eventos chegam na próxima fase; até lá, use Rodar agora.`
              : 'Agenda e eventos chegam na próxima fase; até lá, use Rodar agora.',
          ),
    )
    const connections = section(
      'Conexões',
      h(
        'p',
        { class: 'ch-soon' },
        h('b', {}, 'Em breve. '),
        bot.apps === 'all'
          ? 'Hoje o bot enxerga todos os servidores MCP do seu Claude Code.'
          : `Hoje o bot enxerga: ${bot.apps.join(', ') || 'só o office'}.`,
        ' O servidor office (quadro e atas) fica sempre ligado.',
      ),
    )

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

  /** Spending and history: they change with every run, the form does not. */
  private renderLive(bot: Bot): void {
    const s = botSpending(bot.runs)
    const runs = bot.runs.slice(0, BOT_LIMITS.runs)
    this.live.replaceChildren(
      h(
        'dl',
        { class: 'ch-spend' },
        h('div', {}, h('dt', {}, 'Hoje'), h('dd', {}, usd(s.today) || 'US$ 0,00')),
        h('div', {}, h('dt', {}, '7 dias'), h('dd', {}, usd(s.week) || 'US$ 0,00')),
        h('div', {}, h('dt', {}, '30 dias'), h('dd', {}, usd(s.month) || 'US$ 0,00')),
      ),
      h('p', { class: 'ch-field-hint' }, `Das últimas ${BOT_LIMITS.runs} rodadas do bot.`),
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
