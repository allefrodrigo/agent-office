import DOMPurify from 'dompurify'
import { Marked, type Tokens } from 'marked'

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
  div.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[data-href]')
    if (!a) return
    e.preventDefault()
    window.office.openExternal(a.getAttribute('data-href') ?? '')
  })
  return div
}
