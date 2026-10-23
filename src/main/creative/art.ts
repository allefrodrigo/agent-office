import { BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { imageSize } from './media'

// Text over an image, the way a designer would set it: HTML and CSS in a hidden, offscreen,
// script-less window, captured at the image's own size. Image models misspell; this never does.

export interface ArtText {
  titulo: string
  subtitulo?: string
  cta?: string
  /** Small label above the title (e.g. "1/5", "NOVO"). */
  selo?: string
}

export interface ArtStyle {
  /** base: band at the bottom · topo: title at the top · centro: centered over a scrim. */
  layout: 'base' | 'topo' | 'centro'
  tema: 'escuro' | 'claro' | 'marca'
  fonte: 'sans' | 'serif' | 'condensada'
  /** #rrggbb */
  cor: string
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const HEX = /^#[0-9a-f]{6}$/i
const dataUri = (p: string) => {
  const ext = extname(p).slice(1).toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png'
  return `data:${mime};base64,${readFileSync(p).toString('base64')}`
}

const FONTS: Record<ArtStyle['fonte'], string> = {
  sans: "-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif",
  serif: "'New York', 'Iowan Old Style', Georgia, serif",
  condensada: "'Avenir Next Condensed', 'DIN Condensed', 'Arial Narrow', sans-serif",
}

export function artHtml(bg: string, w: number, h: number, text: ArtText, style: ArtStyle, logo?: string): string {
  const cor = HEX.test(style.cor) ? style.cor : '#9b7bf0'
  const u = Math.min(w, h) / 100
  const dark = style.tema !== 'claro'
  const ink = dark ? '#ffffff' : '#15161f'
  const scrim =
    style.tema === 'marca'
      ? `${cor}e6`
      : dark
        ? 'rgba(10,10,20,0.78)'
        : 'rgba(255,255,255,0.88)'
  const pos =
    style.layout === 'topo'
      ? `top:0;left:0;right:0;padding:${6 * u}px ${6 * u}px ${10 * u}px;background:linear-gradient(180deg, ${scrim} 55%, transparent);`
      : style.layout === 'centro'
        ? `top:50%;left:${7 * u}px;right:${7 * u}px;transform:translateY(-50%);padding:${6 * u}px;border-radius:${3 * u}px;background:${scrim};text-align:center;`
        : `bottom:0;left:0;right:0;padding:${12 * u}px ${6 * u}px ${6 * u}px;background:linear-gradient(0deg, ${scrim} 60%, transparent);`
  const ctaBg = style.tema === 'marca' ? ink : cor
  const ctaInk = style.tema === 'marca' ? cor : '#ffffff'
  const titleSize = text.titulo.length > 60 ? 6.2 : text.titulo.length > 34 ? 7.6 : 9.4
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
*{margin:0;box-sizing:border-box}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:#000}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.box{position:absolute;${pos}color:${ink};font-family:${FONTS[style.fonte]}}
.selo{display:inline-block;margin-bottom:${2 * u}px;padding:${0.8 * u}px ${2 * u}px;border-radius:${4 * u}px;background:${style.tema === 'marca' ? ink : cor};color:${style.tema === 'marca' ? cor : '#fff'};font-weight:800;font-size:${3 * u}px;letter-spacing:.06em;text-transform:uppercase}
h1{font-size:${titleSize * u}px;line-height:1.02;font-weight:${style.fonte === 'serif' ? 700 : 850};letter-spacing:${style.fonte === 'condensada' ? '0' : '-0.02em'};${style.fonte === 'condensada' ? 'text-transform:uppercase;' : ''}text-wrap:balance}
p{margin-top:${2.2 * u}px;font-size:${4.1 * u}px;line-height:1.3;opacity:.92;text-wrap:pretty}
.cta{display:inline-block;margin-top:${3.4 * u}px;padding:${1.8 * u}px ${4 * u}px;border-radius:${8 * u}px;background:${ctaBg};color:${ctaInk};font-weight:800;font-size:${3.8 * u}px}
.logo{position:absolute;${style.layout === 'topo' ? 'bottom' : 'top'}:${5 * u}px;right:${5 * u}px;max-width:${22 * u}px;max-height:${12 * u}px;object-fit:contain}
</style></head><body>
<img class="bg" src="${bg}">
${logo ? `<img class="logo" src="${logo}">` : ''}
<div class="box">
${text.selo ? `<span class="selo">${esc(text.selo)}</span>` : ''}
<h1>${esc(text.titulo)}</h1>
${text.subtitulo ? `<p>${esc(text.subtitulo)}</p>` : ''}
${text.cta ? `<span class="cta">${esc(text.cta)}</span>` : ''}
</div></body></html>`
}

/** Renders `text` over `src` and writes a PNG of the same size to `dest`. */
export async function renderArt(src: string, dest: string, text: ArtText, style: ArtStyle, logo?: string): Promise<void> {
  const { w, h } = await imageSize(src)
  if (!w || !h) throw new Error('Não consegui ler o tamanho da imagem.')
  const html = artHtml(dataUri(src), w, h, text, style, logo ? dataUri(logo) : undefined)
  const win = new BrowserWindow({
    show: false,
    width: w,
    height: h,
    useContentSize: true,
    enableLargerThanScreen: true,
    frame: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  // From a file: a data: URL over ~2 MB (a photo inside) is refused by Chromium.
  const tmp = mkdtempSync(join(tmpdir(), 'ao-arte-'))
  const page = join(tmp, 'arte.html')
  writeFileSync(page, html)
  try {
    win.webContents.setZoomFactor(1)
    await win.loadFile(page)
    // fonts and images settle
    await new Promise((r) => setTimeout(r, 250))
    let img = await win.webContents.capturePage()
    const size = img.getSize()
    if (size.width !== w || size.height !== h) img = img.resize({ width: w, height: h, quality: 'best' })
    writeFileSync(dest, img.toPNG())
  } finally {
    win.destroy()
    rmSync(tmp, { recursive: true, force: true })
  }
}
