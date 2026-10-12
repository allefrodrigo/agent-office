import { ATTACH_KIND_LABEL, formatBytes } from '@shared/attachments'
import type { LogEntry } from '@shared/types'
import { h, icon } from '../dom'
import { renderMarkdown } from '../markdown'
import type { LogFilter } from './helpers'

// How each log entry shows in the feed, its filter category and its searchable text.

/** Mesma regra do CSS de .panel-feed[data-filter]: "Tudo" mostra todas. */
export function passesFilter(cat: string, filter: LogFilter): boolean {
  return filter === 'all' || cat.split(' ').includes(filter)
}

/** Texto que a entrada mostra no feed, em minúsculas (guardado: o log não muda). */
const texts = new WeakMap<LogEntry, string>()
export function entryText(e: LogEntry): string {
  let t = texts.get(e)
  if (t === undefined) {
    t = (entryView(e).textContent ?? '').toLowerCase()
    texts.set(e, t)
  }
  return t
}

/** msg = conversa; tool = ferramentas e decisões; err = erros; other = sistema e raciocínio (só em "Tudo"). */
export function entryCategory(e: LogEntry): string {
  switch (e.kind) {
    case 'user':
    case 'assistant':
      return 'msg'
    case 'result':
      return e.isError ? 'err' : 'msg'
    case 'tool':
    case 'decision':
      return 'tool'
    case 'tool_result':
      return e.isError ? 'tool err' : 'tool'
    case 'error':
      return 'err'
    default:
      return 'other'
  }
}

export function entryView(e: LogEntry): HTMLElement {
  switch (e.kind) {
    case 'user':
      return h(
        'div',
        { class: 'entry entry-user' },
        h(
          'div',
          { class: 'entry-bubble' },
          e.text,
          e.attachments?.length
            ? h(
                'div',
                { class: 'entry-files' },
                e.attachments.map((a) =>
                  h('span', { class: 'file-chip', title: `${ATTACH_KIND_LABEL[a.kind]} · ${formatBytes(a.size)}` }, icon(a.kind === 'image' ? 'image' : 'file', 12), h('span', { class: 'file-chip-name' }, a.name)),
                ),
              )
            : null,
        ),
      )
    case 'assistant':
      return h('div', { class: 'entry entry-assistant' }, renderMarkdown(e.text))
    case 'tool':
      return h('div', { class: 'entry entry-tool' }, h('span', { class: 'tool-name' }, e.tool ?? 'tool'), h('span', { class: 'tool-text' }, e.text))
    case 'tool_result': {
      const pre = h('pre', { class: 'entry-pre' + (e.isError ? ' err' : '') }, e.text)
      const wrap = h('div', { class: 'entry entry-result collapsed' }, pre)
      wrap.addEventListener('click', () => wrap.classList.toggle('collapsed'))
      return wrap
    }
    case 'decision':
      return h('div', { class: 'entry entry-decision' }, icon('check', 13), e.text)
    case 'result':
      return h('div', { class: 'entry entry-final' + (e.isError ? ' err' : '') }, h('div', { class: 'final-label' }, e.isError ? 'Erro' : 'Resultado entregue'), renderMarkdown(e.text))
    case 'error':
      return h('div', { class: 'entry entry-error' }, e.text)
    default:
      return h('div', { class: 'entry entry-system' }, e.text)
  }
}
