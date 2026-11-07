import { ataFileName, editBlock } from '@shared/meetings-view'
import type { AtaBlock, MeetingDetail, MeetingTemplate, MeetingTicketResult, OfficeEvent } from '@shared/types'
import { h, icon } from '../dom'
import { saveMarkdown } from '../export'
import { renderMarkdown } from '../markdown'
import { cleanError } from '../modals'
import { actionsSection } from './actions'
import type { MeetingViewCtx } from './ctx'
import { office } from './office'

// RN-12: a ata na tela. Blocos com a cor da origem (seu texto em destaque, o da IA em cinza),
// citação que destaca a transcrição, clique para editar (o bloco vira seu), "Modelo ▾" que
// regera, Copiar e Salvar .md, e "Gerar ata" quando ela não saiu. Todo texto da ata e da
// transcrição passa pelo renderMarkdown (DOMPurify) ou entra como texto puro.

/** Etapas em que a ata ainda não pode sair: a gravação não acabou. */
const RECORDING = new Set(['recording', 'paused', 'finishing'])

export function mountAta(el: HTMLElement, ctx: MeetingViewCtx): { update(detail: MeetingDetail): void; destroy(): void } {
  let detail: MeetingDetail | null = null
  let templates: MeetingTemplate[] = []
  /** O modelo escolhido para a próxima geração (sem ata, o select não regera na hora). */
  let picked: string | null = null
  let progress: string | null = null
  let warning: string | null = null
  let generating = false
  let editing: string | null = null
  let saving = false
  let destroyed = false

  const root = h('div', { class: 'mt-ata' })
  el.replaceChildren(root)

  void window.office
    .meetingTemplates(ctx.floor)
    .then((info) => {
      templates = info.templates
      render()
    })
    .catch(() => undefined)
  void office.ready().catch(() => undefined)
  const stopMirror = office.on(() => render())

  const stopEvents = window.office.onEvent((e: OfficeEvent) => {
    if (!('meetingId' in e) || e.meetingId !== ctx.meetingId) {
      if (e.type === 'meeting:upsert' && e.meeting.id === ctx.meetingId && detail) {
        detail = { ...detail, meeting: e.meeting }
        if (e.meeting.status !== 'enhancing' && !generating) progress = null
        render()
      }
      return
    }
    if (e.type === 'meeting:progress' && e.stage === 'ata') {
      progress = e.label || 'Escrevendo a ata…'
      warning = null
      render()
    } else if (e.type === 'meeting:warning' && e.kind === 'ata') {
      warning = e.message
      progress = null
      render()
    }
  })

  const toast = (t: string) => ctx.toast(t)

  async function generate(template?: string): Promise<void> {
    if (!detail || generating) return
    generating = true
    warning = null
    progress = `Lendo ${detail.segments.length} ${detail.segments.length === 1 ? 'fala' : 'falas'}…`
    render()
    try {
      const r = await window.office.meetingEnhance(detail.meeting.id, template)
      if (destroyed) return
      if (r.error) warning = r.error
      if (detail) detail = { ...detail, meeting: r.meeting, ata: r.ata ?? detail.ata, ataMarkdown: r.ataMarkdown ?? detail.ataMarkdown }
    } catch (err) {
      warning = cleanError(err)
    } finally {
      generating = false
      progress = null
    }
    render()
    void ctx.refresh()
  }

  async function saveEdit(block: AtaBlock, text: string): Promise<void> {
    if (!detail?.ata || saving) return
    const next = editBlock(detail.ata, block.id, text)
    editing = null
    if (next === detail.ata) return render()
    saving = true
    const before = detail.ata
    // shows the edit at once; the main's answer (or the old ata, on error) replaces it
    detail = { ...detail, ata: next }
    render()
    try {
      const r = await window.office.meetingBlocks(detail.meeting.id, next)
      if (detail) detail = { ...detail, meeting: r.meeting, ata: r.ata, ataMarkdown: r.ataMarkdown }
      void ctx.refresh()
    } catch (err) {
      if (detail) detail = { ...detail, ata: before }
      toast(cleanError(err))
    } finally {
      saving = false
    }
    render()
  }

  function created(r: MeetingTicketResult): void {
    if (!detail?.ata) return
    detail = { ...detail, ata: detail.ata.map((b) => (b.id === r.block.id ? r.block : b)) }
    render()
  }

  /** O texto de um bloco: clique (ou Enter) para editar; links e a citação não editam. */
  function blockText(b: AtaBlock): HTMLElement {
    if (editing === b.id) {
      const area = h('textarea', {
        class: 'input mt-block-edit',
        rows: Math.min(8, Math.max(2, Math.ceil(b.text.length / 70))),
        maxlength: 2000,
        'aria-label': 'Editar o bloco da ata',
      }) as HTMLTextAreaElement
      area.value = b.text
      let done = false
      const finish = (keep: boolean) => {
        if (done) return
        done = true
        if (keep) void saveEdit(b, area.value)
        else {
          editing = null
          render()
        }
      }
      area.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      })
      area.addEventListener('blur', () => finish(true))
      setTimeout(() => {
        area.focus()
        area.setSelectionRange(area.value.length, area.value.length)
      })
      return area
    }
    const content = b.kind === 'heading' ? h('span', {}, b.text) : renderMarkdown(b.text)
    const canEdit = !!detail && detail.meeting.status !== 'enhancing' && !generating
    const text = h(
      'div',
      {
        class: 'mt-block-text',
        ...(canEdit ? { tabindex: 0, role: 'button', title: 'Clique para editar', 'aria-label': `Editar: ${b.text.slice(0, 80)}` } : {}),
      },
      content,
    )
    if (canEdit) {
      const start = (e: Event) => {
        if ((e.target as HTMLElement).closest('a, button')) return
        editing = b.id
        render()
      }
      text.addEventListener('click', start)
      text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          start(e)
        }
      })
    }
    return h('div', { class: 'mt-block-row' }, text, citeButton(b))
  }

  /** Bloco da IA com fontes: o ícone destaca as falas na transcrição. */
  function citeButton(b: AtaBlock): HTMLElement | null {
    if (b.origin !== 'ai' || !b.refs.length) return null
    const n = b.refs.length
    return h(
      'button',
      {
        class: 'icon-btn mt-cite',
        type: 'button',
        title: `Ver ${n === 1 ? 'a fala que sustenta' : `as ${n} falas que sustentam`} este trecho`,
        'aria-label': `Ver na transcrição (${n} ${n === 1 ? 'fala' : 'falas'})`,
        onclick: (e: Event) => {
          e.stopPropagation()
          ctx.highlightSegments(b.refs)
        },
      },
      icon('quote', 13),
    )
  }

  function blockEl(b: AtaBlock): HTMLElement {
    const tag = b.kind === 'heading' ? 'h3' : 'div'
    return h(tag, { class: `mt-block mt-kind-${b.kind} mt-block-${b.origin}`, 'data-block': b.id }, blockText(b))
  }

  function head(d: MeetingDetail): HTMLElement {
    const current = picked ?? d.meeting.template
    const select = h(
      'select',
      {
        class: 'input mt-template',
        'aria-label': 'Modelo da ata',
        disabled: generating || d.meeting.status === 'enhancing' || RECORDING.has(d.meeting.status),
      },
      ...(templates.length ? templates : [{ id: current, name: current }]).map((t) => h('option', { value: t.id }, t.name)),
    )
    select.value = current
    select.addEventListener('change', () => {
      picked = select.value
      // with an ata, a new template rewrites only the AI's blocks; without one, it waits for "Gerar ata"
      if (d.ata) void generate(select.value)
      else render()
    })
    const md = d.ataMarkdown
    return h(
      'div',
      { class: 'mt-ata-head' },
      h('h2', { class: 'mt-ata-title' }, 'Ata'),
      h('label', { class: 'mt-template-wrap' }, h('span', {}, 'Modelo:'), select),
      h('span', { class: 'grow' }),
      h(
        'button',
        {
          class: 'btn btn-small',
          type: 'button',
          disabled: !md,
          title: 'Copiar a ata em Markdown',
          onclick: () =>
            md &&
            window.office.copyText(md).then(
              () => toast('Ata copiada em Markdown.'),
              (err) => toast(cleanError(err)),
            ),
        },
        icon('copy', 13),
        'Copiar',
      ),
      h(
        'button',
        {
          class: 'btn btn-small',
          type: 'button',
          disabled: !md,
          onclick: () => md && void saveMarkdown(ataFileName(d.meeting.id), md, toast, 'Ata salva'),
        },
        icon('download', 13),
        'Salvar .md',
      ),
    )
  }

  function render(): void {
    if (destroyed) return
    // typing in a block: a re-render would throw the text away
    if (editing && root.contains(document.activeElement) && document.activeElement instanceof HTMLTextAreaElement) return
    const d = detail
    if (!d) {
      root.replaceChildren(h('div', { class: 'mt-ata-empty' }, 'Carregando a ata…'))
      return
    }
    const status = d.meeting.status
    const parts: (HTMLElement | null)[] = [head(d)]
    const label = progress ?? (status === 'enhancing' ? 'Escrevendo a ata…' : null)
    if (label)
      parts.push(
        h(
          'div',
          { class: 'mt-ata-progress', role: 'status', 'aria-live': 'polite' },
          h('span', { class: 'mt-spin', 'aria-hidden': 'true' }),
          label,
        ),
      )
    if (warning && !label) parts.push(h('div', { class: 'mt-ata-warn', role: 'alert' }, icon('alert', 15), h('span', {}, warning)))

    if (RECORDING.has(status)) {
      parts.push(h('div', { class: 'mt-ata-empty' }, 'A ata é escrita quando a reunião termina.'))
    } else if (!d.ata?.length && !label) {
      parts.push(
        h(
          'div',
          { class: 'mt-ata-empty' },
          h(
            'span',
            {},
            warning ? 'A ata não saiu. Tente de novo; as suas notas e a transcrição estão guardadas.' : 'Esta reunião ainda não tem ata.',
          ),
          h(
            'button',
            { class: 'btn btn-primary btn-small', type: 'button', disabled: generating, onclick: () => void generate(picked ?? undefined) },
            icon('spark', 14),
            'Gerar ata',
          ),
        ),
      )
    } else if (d.ata?.length) {
      if (warning && !label)
        parts.push(
          h(
            'div',
            { class: 'mt-ata-retry' },
            h(
              'button',
              { class: 'btn btn-small', type: 'button', onclick: () => void generate(picked ?? undefined) },
              icon('reset', 13),
              'Gerar ata de novo',
            ),
          ),
        )
      const blocks = d.ata.filter((b) => b.kind !== 'action')
      parts.push(h('div', { class: 'mt-ata-body' }, ...blocks.map(blockEl)))
      parts.push(actionsSection(d, ctx, { text: blockText, created }))
      parts.push(
        h(
          'div',
          { class: 'mt-ata-legend' },
          h('span', { class: 'mt-legend-user' }, 'Texto em destaque: o que você escreveu ou editou.'),
          h('span', { class: 'mt-legend-ai' }, 'Em cinza: o que a IA acrescentou. Clique num bloco para editar.'),
        ),
      )
    }
    const scroll = root.scrollTop
    root.replaceChildren(...parts.filter((x): x is HTMLElement => !!x))
    root.scrollTop = scroll
  }

  return {
    update(next: MeetingDetail) {
      detail = next
      if (next.meeting.status !== 'enhancing' && !generating) progress = null
      render()
    },
    destroy() {
      destroyed = true
      stopEvents()
      stopMirror()
      root.remove()
    },
  }
}
