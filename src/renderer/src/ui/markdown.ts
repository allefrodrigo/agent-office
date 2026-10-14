import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'
import { icon } from './dom'

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Agent output is untrusted: raw HTML is escaped, images are not loaded,
// and links open through the main process (which only allows http/https).
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text)
    },
    image({ text }: Tokens.Image) {
      return `<span class="md-img">[imagem: ${escapeHtml(text)}]</span>`
    },
    link({ href, tokens }: Tokens.Link) {
      const label = this.parser.parseInline(tokens)
      return `<a href="#" data-href="${escapeHtml(href)}">${label}</a>`
    },
  },
})

export function renderMarkdown(md: string): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'md'
  // Defense in depth: sanitize the rendered HTML even though raw HTML is already escaped.
  div.innerHTML = DOMPurify.sanitize(marked.parse(md, { async: false }) as string, { ADD_ATTR: ['data-href'] })
  for (const pre of div.querySelectorAll('pre')) pre.replaceWith(copyable(pre))
  div.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[data-href]')
    if (!a) return
    e.preventDefault()
    window.office.openExternal(a.getAttribute('data-href') ?? '')
  })
  return div
}

/** A code block with a copy button in its corner; the icon turns into a check for a moment. */
function copyable(pre: HTMLPreElement): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'md-code'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'icon-btn md-copy'
  btn.title = 'Copiar código'
  btn.setAttribute('aria-label', 'Copiar código')
  btn.append(icon('copy', 14))
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(pre.textContent ?? '').then(
      () => {
        btn.replaceChildren(icon('check', 14))
        btn.classList.add('done')
        btn.title = 'Copiado'
        setTimeout(() => {
          btn.replaceChildren(icon('copy', 14))
          btn.classList.remove('done')
          btn.title = 'Copiar código'
        }, 1500)
      },
      () => (btn.title = 'Não consegui copiar. Selecione o texto e use ⌘C.'),
    )
  })
  wrap.append(pre, btn)
  return wrap
}
