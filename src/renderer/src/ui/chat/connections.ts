import { appsLabel, botsOnFloor, botsSeeing, isOfficeServer, mcpStatus, missingApps, sortBots } from '@shared/bots-view'
import type { Bot, McpServerView, ToolsView } from '@shared/types'
import { keepFocus } from '../a11y'
import { h, icon } from '../dom'
import { botAvatar } from './avatar'
import { chatStore } from './store'
import { chatError, floorName, type ChatCtx } from './util'

// "⧉ Conexões" (CB-16): os servidores MCP que o Claude Code conhece (os mesmos de Bastidores →
// MCP), o estado de cada um e quais bots usam cada um. Em cada bot, o perfil escolhe "Todos" ou
// uma lista; o office fica sempre ligado. Conectar um app novo é configurar o MCP no Claude Code.

export interface ConnectionsCtx extends ChatCtx {
  /** The floor on screen ('all' = every floor): whose bots are counted. */
  floor(): string
  /** Opens the bot's thread with the profile on Conexões. */
  editBot(botId: string): void
}

const DOCS_URL = 'https://code.claude.com/docs/en/mcp'

/** Scope names as Bastidores shows them. */
const SCOPE: Record<string, string> = {
  user: 'seu',
  project: 'do projeto',
  local: 'local',
  plugin: 'de plugin',
  claudeai: 'claude.ai',
  sdk: 'do escritório',
  dynamic: 'dinâmico',
  managed: 'da empresa',
  enterprise: 'da empresa',
}

/** Bots shown as faces per server before "+N". */
const FACES = 5

export class ConnectionsView {
  readonly el: HTMLElement
  private body: HTMLElement
  private tools: ToolsView | null = null
  private error = ''
  private loading = false

  constructor(private ctx: ConnectionsCtx) {
    this.body = h('div', { class: 'ch-conn-body' })
    this.el = h('div', { class: 'ch-conn' }, this.body)
  }

  /** Reads the servers once (again with `force`), and draws. */
  load(force = false): void {
    this.draw()
    if (this.loading || (this.tools && !force)) return
    this.loading = true
    this.error = ''
    this.draw()
    window.office
      .toolsView()
      .then((v) => {
        this.tools = v
      })
      .catch((err: unknown) => {
        this.error = chatError(err)
      })
      .finally(() => {
        this.loading = false
        this.draw()
      })
  }

  /** The bots changed: who uses what. */
  refresh(): void {
    this.draw()
  }

  focus(): void {
    this.body.querySelector<HTMLElement>('.ch-conn-row button, .ch-conn-how .btn')?.focus()
  }

  private bots(): Bot[] {
    return sortBots(botsOnFloor(chatStore.bots, this.ctx.floor(), true))
  }

  private draw(): void {
    keepFocus(this.body, () => this.body.replaceChildren(...this.parts()))
  }

  private parts(): HTMLElement[] {
    const floor = this.ctx.floor()
    const whose = floor === 'all' ? 'dos bots de todos os andares' : `dos bots do andar ${floorName(this.ctx.state, floor)}`
    const intro = h(
      'p',
      { class: 'ch-conn-intro' },
      `Os servidores MCP que o Claude Code conhece, os mesmos de Bastidores → MCP, e quem usa cada um, ${whose}. Cada bot enxerga todos ou uma lista, que você escolhe no perfil dele. O office (quadro, atas e as ferramentas do Chat) fica sempre ligado.`,
    )
    return [intro, this.serverList(), this.byBot(), this.howTo()].filter((x): x is HTMLElement => !!x)
  }

  private serverList(): HTMLElement {
    const head = h(
      'div',
      { class: 'ch-conn-head' },
      h('h3', { class: 'ch-sec-title' }, 'Servidores'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-small',
          disabled: this.loading,
          'aria-busy': String(this.loading),
          'data-focus-key': 'reload',
          onclick: () => this.load(true),
        },
        icon('reset', 14),
        this.loading ? 'Atualizando…' : 'Atualizar',
      ),
    )
    if (!this.tools) {
      return h(
        'section',
        { class: 'ch-conn-servers', 'aria-label': 'Servidores MCP' },
        head,
        this.error
          ? h(
              'div',
              { class: 'ch-banner err', role: 'alert' },
              icon('alert', 15),
              h('span', {}, `Não consegui ler os servidores: ${this.error}`),
            )
          : h('p', { class: 'ch-field-hint' }, 'Perguntando ao Claude Code pelos servidores…'),
      )
    }
    const bots = this.bots()
    const servers = [...this.tools.mcp].sort(
      (a, b) => Number(isOfficeServer(b)) - Number(isOfficeServer(a)) || a.name.localeCompare(b.name),
    )
    return h(
      'section',
      { class: 'ch-conn-servers', 'aria-label': 'Servidores MCP' },
      head,
      this.tools.live
        ? null
        : h(
            'div',
            { class: 'ch-banner', role: 'status' },
            icon('alert', 15),
            h(
              'span',
              {},
              'Nenhum agente do escritório está rodando: a lista vem das configurações, sem estado. O estado aparece quando um agente começar a trabalhar.',
            ),
          ),
      this.error ? h('div', { class: 'ch-banner err', role: 'alert' }, icon('alert', 15), h('span', {}, this.error)) : null,
      servers.length
        ? h('ul', { class: 'ch-conn-list' }, ...servers.map((m) => this.serverRow(m, bots)))
        : h('p', { class: 'ch-field-hint' }, 'O Claude Code não tem nenhum servidor MCP configurado além do office.'),
    )
  }

  private serverRow(m: McpServerView, bots: Bot[]): HTMLElement {
    const st = mcpStatus(m)
    const office = isOfficeServer(m)
    const seeing = botsSeeing(bots, m)
    const facts = [
      m.tools ? `${m.tools} ferramentas` : '',
      m.scope ? (SCOPE[m.scope] ?? m.scope) : '',
      m.uses ? `${m.uses} usos em 7 dias` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const who = office
      ? h('span', { class: 'ch-conn-all' }, 'Todos os bots · sempre ligado')
      : m.off
        ? h('span', { class: 'ch-conn-none' }, 'Nenhum bot: desligado para o escritório todo')
        : seeing.length
          ? h(
              'span',
              { class: 'ch-conn-faces' },
              ...seeing.slice(0, FACES).map((b) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'ch-conn-face',
                    title: `${b.name}: ${appsLabel(b.apps)}. Abrir o perfil`,
                    'aria-label': `${b.name} usa ${m.name}. Abrir o perfil de ${b.name}`,
                    onclick: () => this.ctx.editBot(b.id),
                  },
                  botAvatar(b, 'idle', 24),
                ),
              ),
              h(
                'span',
                { class: 'ch-conn-count' },
                seeing.length === 1 ? '1 bot' : `${seeing.length} bots`,
                seeing.length > FACES ? ` (+${seeing.length - FACES})` : '',
              ),
            )
          : h('span', { class: 'ch-conn-none' }, bots.length ? 'Nenhum bot' : 'Sem bots neste andar')
    return h(
      'li',
      { class: `ch-conn-row${m.off ? ' off' : ''}` },
      h('span', { class: `ch-led tone-${st.tone}`, 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'ch-conn-main' },
        h('div', { class: 'ch-conn-name' }, h('b', {}, m.name), office ? h('span', { class: 'ch-chip' }, 'do escritório') : null),
        h('div', { class: `ch-conn-status tone-${st.tone}` }, st.text, facts ? h('span', { class: 'ch-conn-facts' }, ` · ${facts}`) : null),
      ),
      h('div', { class: 'ch-conn-who', 'aria-label': `Bots que usam ${m.name}` }, who),
    )
  }

  /** Each bot with what it sees, and a way to change it. */
  private byBot(): HTMLElement | null {
    const bots = this.bots()
    if (!bots.length) return null
    const servers = this.tools?.mcp ?? []
    return h(
      'section',
      { class: 'ch-conn-bots', 'aria-label': 'Por bot' },
      h('h3', { class: 'ch-sec-title' }, 'Por bot'),
      h(
        'ul',
        { class: 'ch-conn-list' },
        ...bots.map((b) => {
          const gone = this.tools ? missingApps(b.apps, servers) : []
          return h(
            'li',
            { class: 'ch-conn-row' },
            botAvatar(b, 'idle', 28),
            h(
              'div',
              { class: 'ch-conn-main' },
              h('div', { class: 'ch-conn-name' }, h('b', {}, b.name)),
              h(
                'div',
                { class: 'ch-conn-status' },
                appsLabel(b.apps),
                gone.length ? h('span', { class: 'tone-warn' }, ` · ${gone.join(', ')} não existe mais no Claude Code`) : null,
              ),
            ),
            h(
              'button',
              { type: 'button', class: 'btn btn-small', 'data-focus-key': `bot:${b.id}`, onclick: () => this.ctx.editBot(b.id) },
              'Mudar no perfil',
            ),
          )
        }),
      ),
    )
  }

  private howTo(): HTMLElement {
    const code = (text: string) => h('pre', { class: 'ch-conn-code' }, h('code', {}, text))
    return h(
      'section',
      { class: 'ch-conn-how', 'aria-label': 'Conectar um app novo' },
      h('h3', { class: 'ch-sec-title' }, 'Conectar um app novo'),
      h('p', {}, 'Conectar um app é configurar um servidor MCP no Claude Code. No terminal, rode um destes:'),
      code('claude mcp add --transport http nome-do-app https://exemplo.com/mcp'),
      code('claude mcp add nome-do-app -- npx -y pacote-do-servidor'),
      h(
        'p',
        {},
        'Apps com login (Gmail, Linear, Notion…) pedem entrada: abra o ',
        h('code', {}, 'claude'),
        ' no terminal e use ',
        h('code', {}, '/mcp'),
        '. Depois volte aqui e clique em Atualizar. Bots com "Todos" já enxergam o servidor novo; bots com lista precisam dele marcado no perfil.',
      ),
      h(
        'div',
        { class: 'ch-conn-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => void window.office.openExternal(DOCS_URL).catch((err: unknown) => this.ctx.toast(chatError(err), 'err')),
          },
          icon('book', 14),
          'Abrir a documentação',
        ),
      ),
    )
  }
}
