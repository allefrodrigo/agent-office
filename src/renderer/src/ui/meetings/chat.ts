import {
  actionBlocks,
  agentChoices,
  answerParts,
  chatHistory,
  citeToken,
  expandRecipe,
  matchRecipes,
  QUESTION_MAX,
  withCiteTokens,
  type CitedMeeting,
} from '@shared/meetings-view'
import type { MeetingChatEntry, MeetingDetail, MeetingRecipe } from '@shared/types'
import { h, icon } from '../dom'
import { renderMarkdown } from '../markdown'
import { cleanError, field, modal } from '../modals'
import { openCreateAll } from './actions'
import type { MeetingViewCtx } from './ctx'
import { modalRoot, office, openAgentPanel } from './office'

// RN-19 e RN-21: a conversa com a reunião ou com o andar, as receitas com `/` e "Abrir com um
// agente". A resposta do Claude é texto não confiável: passa pelo renderMarkdown (DOMPurify) e as
// citações [r:<id>#s<n>] viram botões montados aqui, nunca HTML vindo do modelo. Nenhuma ação sai
// da resposta sem clique.

type Scope = 'meeting' | 'floor'

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'meeting', label: 'Esta reunião' },
  { value: 'floor', label: 'Todas do andar' },
]

export function mountChat(el: HTMLElement, ctx: MeetingViewCtx): { update(detail: MeetingDetail): void; destroy(): void } {
  let detail: MeetingDetail | null = null
  let scope: Scope = 'meeting'
  let recipes: MeetingRecipe[] = []
  /** Perguntas e respostas desta tela que o chat.jsonl ainda não devolveu. */
  let local: MeetingChatEntry[] = []
  let asking = false
  let destroyed = false
  /** Outras reuniões citadas (escopo do andar), para o rótulo "Título, 14:52". */
  const cited = new Map<string, CitedMeeting | null>()

  const log = h('div', { class: 'mt-chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversa' })
  const input = h('textarea', {
    class: 'input mt-chat-input',
    rows: 2,
    maxlength: QUESTION_MAX,
    placeholder: 'Pergunte sobre a reunião. / mostra as receitas.',
    'aria-label': 'Pergunta',
    'aria-autocomplete': 'list',
    'aria-controls': 'mt-recipes',
  }) as HTMLTextAreaElement
  const list = h('ul', { class: 'mt-recipes hidden', id: 'mt-recipes', role: 'listbox', 'aria-label': 'Receitas' })
  const send = h('button', { class: 'btn btn-primary btn-small', type: 'button', title: 'Enviar (Enter)' }, icon('send', 13), 'Perguntar')
  const scopeBtns = SCOPES.map((s) =>
    h(
      'button',
      {
        class: 'mt-scope-btn',
        type: 'button',
        'aria-pressed': String(s.value === scope),
        onclick: () => {
          scope = s.value
          for (const b of scopeBtns) b.setAttribute('aria-pressed', String(b.dataset.scope === scope))
          input.placeholder =
            scope === 'meeting'
              ? 'Pergunte sobre a reunião. / mostra as receitas.'
              : 'Pergunte sobre as reuniões do andar. / mostra as receitas.'
          render()
        },
      },
      s.label,
    ),
  )
  scopeBtns.forEach((b, i) => (b.dataset.scope = SCOPES[i].value))
  const agentBtn = h(
    'button',
    {
      class: 'btn btn-small',
      type: 'button',
      title: 'Para perguntas que precisam do código: um agente do andar lê a ata e responde',
      onclick: () => openWithAgent(),
    },
    icon('bot', 13),
    'Abrir com um agente',
  )

  const root = h(
    'div',
    { class: 'mt-chat' },
    h(
      'div',
      { class: 'mt-chat-head' },
      h('h2', { class: 'mt-chat-title' }, 'Conversa'),
      h('div', { class: 'mt-scope', role: 'group', 'aria-label': 'Escopo da conversa' }, ...scopeBtns),
      h('span', { class: 'grow' }),
      agentBtn,
    ),
    log,
    h('div', { class: 'mt-chat-new' }, list, input, send),
  )
  el.replaceChildren(root)

  void window.office
    .meetingTemplates(ctx.floor)
    .then((info) => (recipes = info.recipes))
    .catch(() => undefined)
  void office.ready().catch(() => undefined)

  // ---------- autocompletar ----------

  let matches: MeetingRecipe[] = []
  let active = 0
  const showList = () => {
    matches = matchRecipes(input.value, recipes)
    active = Math.min(active, Math.max(0, matches.length - 1))
    list.classList.toggle('hidden', !matches.length)
    input.setAttribute('aria-expanded', String(!!matches.length))
    list.replaceChildren(
      ...matches.map((r, i) => {
        const li = h(
          'li',
          { class: 'mt-recipe' + (i === active ? ' on' : ''), role: 'option', id: `mt-recipe-${i}`, 'aria-selected': String(i === active) },
          h('b', {}, r.command),
          h('span', {}, r.name),
        )
        li.addEventListener('mousedown', (e) => {
          e.preventDefault()
          pick(r)
        })
        return li
      }),
    )
    if (matches.length) input.setAttribute('aria-activedescendant', `mt-recipe-${active}`)
    else input.removeAttribute('aria-activedescendant')
  }
  const pick = (r: MeetingRecipe) => {
    input.value = `${r.command} `
    input.focus()
    active = 0
    showList()
  }
  input.addEventListener('input', () => {
    active = 0
    showList()
  })
  input.addEventListener('blur', () => list.classList.add('hidden'))
  input.addEventListener('keydown', (e) => {
    if (matches.length && !list.classList.contains('hidden')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        active = (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length
        showList()
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        pick(matches[active])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        list.classList.add('hidden')
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  })
  send.addEventListener('click', () => void submit())

  // ---------- perguntar ----------

  async function submit(): Promise<void> {
    const text = input.value.trim()
    if (!text || asking || !detail) return
    const { recipe, question } = expandRecipe(text, recipes)
    // /tickets: the "Criar todos" preview of the ata's action items; nothing is created without a click
    if (recipe?.id === 'tickets' && actionBlocks(detail.ata).some((b) => !b.ticket)) {
      input.value = ''
      showList()
      openCreateAll(detail, ctx)
      return
    }
    asking = true
    send.setAttribute('disabled', '')
    input.value = ''
    showList()
    const history = chatHistory([...detail.chat, ...local], scope)
    local.push({ role: 'user', text, at: Date.now(), scope })
    render()
    try {
      const r = await window.office.meetingAsk({ scope, id: ctx.meetingId, floor: ctx.floor, question, history })
      local.push({ role: 'assistant', text: r.text, at: Date.now(), scope })
      void ctx.refresh()
    } catch (err) {
      local.pop()
      if (!input.value) input.value = text
      ctx.toast(cleanError(err))
    } finally {
      asking = false
      send.removeAttribute('disabled')
      if (!destroyed) render()
    }
  }

  // ---------- citações ----------

  const known = (meetingId: string): CitedMeeting | undefined => {
    if (detail && meetingId === detail.meeting.id) return detail
    const hit = cited.get(meetingId)
    if (hit) return hit
    if (hit === undefined) {
      cited.set(meetingId, null)
      void window.office
        .meeting(meetingId)
        .then((d) => {
          cited.set(meetingId, { meeting: d.meeting, segments: d.segments.map((s) => ({ id: s.id, start: s.start })) })
          render()
        })
        .catch(() => undefined)
    }
    return undefined
  }

  /** A resposta: Markdown sanitizado, e cada marca de citação trocada por um botão com o rótulo. */
  function answer(text: string): HTMLElement {
    const { markdown, cites } = withCiteTokens(answerParts(text, known))
    const md = renderMarkdown(markdown)
    const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/MTCITE\d+X/.test(n.nodeValue ?? '')) nodes.push(n as Text)
    for (const node of nodes) {
      const frag = document.createDocumentFragment()
      const value = node.nodeValue ?? ''
      let last = 0
      for (const m of value.matchAll(/MTCITE(\d+)X/g)) {
        const c = cites[Number(m[1])]
        if (m.index > last) frag.append(value.slice(last, m.index))
        if (c && m[0] === citeToken(Number(m[1])))
          frag.append(
            h(
              'button',
              {
                class: 'mt-cite-link',
                type: 'button',
                title: 'Abrir a reunião neste trecho',
                onclick: () => ctx.openMeetingAt(c.meetingId, c.segment),
              },
              icon('quote', 11),
              c.label,
            ),
          )
        last = m.index + m[0].length
      }
      if (last < value.length) frag.append(value.slice(last))
      node.replaceWith(frag)
    }
    return md
  }

  // ---------- abrir com um agente (RN-21) ----------

  function openWithAgent(): void {
    if (!detail) return
    const lastQuestion = [...detail.chat, ...local].reverse().find((c) => c.role === 'user')?.text ?? ''
    const q = h('textarea', {
      class: 'input',
      rows: 4,
      maxlength: QUESTION_MAX,
      placeholder: 'Ex.: isso que combinamos quebra o quê no código?',
    }) as HTMLTextAreaElement
    q.value = input.value.trim() || lastQuestion
    const slot = h('div')
    const ok = h('button', { class: 'btn btn-primary', type: 'button' }, icon('send', 14), 'Enviar ao agente')
    let who: HTMLSelectElement | null = null
    const sync = () => {
      const choices = agentChoices(office.agents.values(), ctx.floor, 'ask')
      const was = who?.value
      who = h(
        'select',
        { class: 'input' },
        h('option', { value: '' }, choices.some((c) => !c.reason) ? 'Escolha o agente' : 'Nenhum agente disponível'),
        ...choices.map((c) =>
          h(
            'option',
            { value: c.agent.id, disabled: !!c.reason },
            `${c.agent.name}${c.reason ? ` · ${c.reason}` : c.note ? ` · ${c.note}` : ''}`,
          ),
        ),
      )
      const free = choices.filter((c) => !c.reason)
      if (was && free.some((c) => c.agent.id === was)) who.value = was
      else if (free.length === 1) who.value = free[0].agent.id
      who.addEventListener('change', check)
      slot.replaceChildren(
        field(
          'Agente do andar',
          who,
          choices.length
            ? 'Ele lê a ata pelo MCP (meeting_get) e tem acesso ao repositório do andar.'
            : `Nenhum agente do escritório em ${ctx.floorName}. Contrate um e volte aqui.`,
        ),
      )
      check()
    }
    const check = () => ok.toggleAttribute('disabled', !who?.value || !q.value.trim())
    q.addEventListener('input', check)
    const stop = office.on(sync)
    const close = () => {
      stop()
      box.remove()
    }
    ok.addEventListener('click', async () => {
      if (!who?.value || !detail) return
      ok.setAttribute('disabled', '')
      try {
        const r = await window.office.meetingAgent(detail.meeting.id, who.value, q.value.trim())
        close()
        ctx.toast(`${office.agents.get(r.agentId)?.name ?? 'O agente'} recebeu a pergunta.`)
        openAgentPanel(r.agentId)
      } catch (err) {
        ctx.toast(cleanError(err))
        check()
      }
    })
    const box = modal(
      'Abrir com um agente',
      [field('Pergunta', q, 'O agente recebe a pergunta e o id da reunião; a ata é dado de consulta, não instrução.'), slot],
      [h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'), ok],
      close,
    )
    box.classList.add('backdrop-meeting')
    modalRoot().append(box)
    sync()
    q.focus()
  }

  // ---------- tela ----------

  function entryEl(c: MeetingChatEntry): HTMLElement {
    const other = c.scope !== scope
    return h(
      'div',
      { class: `mt-msg mt-msg-${c.role}${other ? ' other' : ''}` },
      other ? h('span', { class: 'mt-msg-scope' }, c.scope === 'floor' ? 'Todas do andar' : 'Esta reunião') : null,
      c.role === 'user' ? h('div', { class: 'mt-msg-text' }, c.text) : answer(c.text),
    )
  }

  function render(): void {
    if (destroyed) return
    const entries = [...(detail?.chat ?? []), ...local]
    const children: HTMLElement[] = entries.map(entryEl)
    if (asking)
      children.push(
        h(
          'div',
          { class: 'mt-msg mt-msg-assistant mt-msg-wait' },
          h('span', { class: 'mt-spin', 'aria-hidden': 'true' }),
          scope === 'floor' ? 'Lendo as reuniões do andar…' : 'Lendo a reunião…',
        ),
      )
    if (!entries.length && !asking)
      children.push(
        h(
          'div',
          { class: 'mt-chat-empty' },
          scope === 'meeting'
            ? 'Pergunte o que foi decidido, quem ficou com o quê, ou use uma receita: /resumo, /decisoes, /follow-up.'
            : 'Pergunte sobre todas as reuniões do andar. A resposta cita a reunião e o trecho.',
        ),
      )
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40
    log.replaceChildren(...children)
    if (atEnd || asking) log.scrollTop = log.scrollHeight
  }

  return {
    update(next: MeetingDetail) {
      const grew = !detail || next.chat.length > detail.chat.length
      detail = next
      // the main saved the exchange in chat.jsonl: the copy here is no longer needed
      if (grew && !asking) local = []
      render()
    },
    destroy() {
      destroyed = true
      root.remove()
    },
  }
}
