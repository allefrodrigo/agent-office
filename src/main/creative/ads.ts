import { BrowserWindow, session } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { daysRunning, fileSlug, type AdsTarget, type RefItem } from '@shared/social'

// Captures ads from the Meta Ads Library into the floor: a hidden window of its own session opens
// the library, scrolls the page's list, then each ad's page for the HD video or the original image.
// Only facebook.com loads in it, it never gets permissions, and files only come from Meta's CDN.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const PARTITION = 'ads-library'
const MAX_BYTES = 200 * 1024 * 1024
let sessionReady = false

export interface Capture {
  target: AdsTarget
  max: number
  /** <floor>/referencias */
  dir: string
  signal: AbortSignal
  progress(text: string): void
}

interface Card {
  id: string
  video: string | null
  imagem: string | null
  inicio: string
  nome: string
}

const FB_HOST = /^(www\.|m\.|web\.)?facebook\.com$/
const CDN_HOST = /(^|\.)(fbcdn\.net|facebook\.com|cdninstagram\.com)$/

/** Media URL we may download: https on Meta's CDN. */
export function cdnUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try {
    const url = new URL(u)
    return url.protocol === 'https:' && CDN_HOST.test(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

/** The efg parameter of a video URL carries xpv_asset_id: the same video in SD and HD. */
export function assetId(url: string): string | null {
  try {
    const efg = new URL(url).searchParams.get('efg')
    if (!efg) return null
    const id = (JSON.parse(Buffer.from(efg, 'base64').toString()) as { xpv_asset_id?: unknown }).xpv_asset_id
    return id === undefined ? null : String(id)
  } catch {
    return null
  }
}

const fileOf = (u: string) => {
  try {
    return new URL(u).pathname.split('/').pop() ?? null
  } catch {
    return null
  }
}

/** HD videos (by asset id) and original images (by thumbnail file name) in an ad page's HTML. */
export function bestMedia(html: string): { hd: Record<string, string>; originals: Record<string, string> } {
  const hd: Record<string, string> = {}
  const originals: Record<string, string> = {}
  const unjson = (s: string) => {
    try {
      return JSON.parse(`"${s}"`) as string
    } catch {
      return null
    }
  }
  for (const m of html.matchAll(/"video_hd_url":"(.*?)"/g)) {
    const u = unjson(m[1])
    const a = u && assetId(u)
    if (u && a) hd[a] = u
  }
  for (const m of html.matchAll(/"original_image_url":"(.*?)","resized_image_url":"(.*?)"/g)) {
    const orig = unjson(m[1])
    const mini = unjson(m[2])
    const key = mini && fileOf(mini)
    if (orig && key) originals[key] = orig
  }
  return { hd, originals }
}

// Runs inside the library page: one card per "Library ID", with its own media.
const READ_CARDS = `(() => {
  const re = /(?:Identificação da biblioteca|Library ID):\\s*(\\d+)/;
  const nos = [...document.querySelectorAll('span, div')].filter((el) => el.children.length === 0 && re.test(el.textContent));
  const seen = new Set();
  const cards = [];
  for (const no of nos) {
    const id = no.textContent.match(re)[1];
    if (seen.has(id)) continue;
    seen.add(id);
    let el = no, card = null;
    while (el.parentElement) {
      el = el.parentElement;
      if ((el.innerText.match(/(Identificação da biblioteca|Library ID):/g) || []).length > 1) break;
      if (el.querySelector('video, img[src*="scontent"]')) card = el;
    }
    const v = card && card.querySelector('video');
    const imgs = card ? [...card.querySelectorAll('img[src*="scontent"]')].filter((i) => i.naturalWidth >= 200) : [];
    imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
    const inicio = (card && (card.innerText.match(/(?:Veiculação iniciada em|Started running on)\\s+([^\\n]+)/) || [])[1]) || '';
    const nome = card ? [...card.querySelectorAll('a[href]')]
      .filter((a) => /^https?:\\/\\/(www\\.)?facebook\\.com\\/(?!ads\\/)[^?#]+/.test(a.getAttribute('href') || ''))
      .map((a) => a.innerText.trim())
      .find((t) => t && !t.includes('\\n') && t.length < 60) || '' : '';
    cards.push({ id, video: v ? (v.currentSrc || v.src) : null, imagem: imgs[0] ? imgs[0].src : null, inicio, nome });
  }
  return cards;
})()`

export async function captureAds(c: Capture): Promise<{ anunciante: string; items: RefItem[]; notFound?: string }> {
  const wait = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (c.signal.aborted) return reject(new Error('Captura cancelada.'))
      const t = setTimeout(resolve, ms)
      c.signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('Captura cancelada.'))), { once: true })
    })
  if (!sessionReady) {
    const ses = session.fromPartition(PARTITION)
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    ses.setUserAgent(UA, 'pt-BR,pt,en')
    ses.on('will-download', (e) => e.preventDefault())
    sessionReady = true
  }
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, webSecurity: true },
  })
  const wc = win.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e, url) => {
    try {
      if (!FB_HOST.test(new URL(url).hostname)) e.preventDefault()
    } catch {
      e.preventDefault()
    }
  })
  const go = async (url: string) => {
    await wc.loadURL(url, { userAgent: UA }).catch(() => undefined)
    await wait(6000)
  }
  const js = <T>(code: string) => wc.executeJavaScript(code, true) as Promise<T>

  try {
    let listUrl = c.target.kind === 'url' ? c.target.url : c.target.kind === 'id' ? `https://www.facebook.com/ads/library/?id=${c.target.id}` : ''
    if (c.target.kind === 'handle') {
      const handle = c.target.handle
      c.progress(`Procurando @${handle} na Biblioteca…`)
      await go(`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&media_type=all&q=${encodeURIComponent(handle)}&search_type=keyword_unordered`)
      await wait(2000)
      const focused = await js<boolean>(`(() => { const i = document.querySelector('input[type="search"]'); if (!i) return false; i.focus(); i.select(); return true })()`)
      if (!focused) throw new Error('A Biblioteca de Anúncios não abriu a busca. Tente de novo ou cole o link da página na Biblioteca.')
      // typed key by key: the field comes filled from the URL, and only typing opens the suggestions
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
      await wait(400)
      for (const ch of handle) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: ch })
        wc.sendInputEvent({ type: 'char', keyCode: ch })
        wc.sendInputEvent({ type: 'keyUp', keyCode: ch })
        await wait(120)
      }
      await wait(5000)
      // the handle passed parseAdsTarget ([A-Za-z0-9._]): safe inside the pattern once escaped
      const re = JSON.stringify(`@${handle.replace(/[.]/g, '\\.')}(\\s|·|$)`)
      const picked = await js<{ ok: boolean; x: number; y: number; options: string[] }>(`(() => {
        const opts = [...document.querySelectorAll('[role="option"]')];
        const hit = opts.find((o) => new RegExp(${re}, 'i').test(o.innerText));
        if (hit) hit.scrollIntoView({ block: 'center' });
        const r = hit ? hit.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        return { ok: !!hit, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), options: opts.map((o) => o.innerText.replace(/\\n/g, ' ')).slice(0, 6) };
      })()`)
      // a real mouse click: the suggestion list ignores element.click()
      if (picked.ok) {
        wc.sendInputEvent({ type: 'mouseMove', x: picked.x, y: picked.y })
        wc.sendInputEvent({ type: 'mouseDown', x: picked.x, y: picked.y, button: 'left', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x: picked.x, y: picked.y, button: 'left', clickCount: 1 })
      }
      if (!picked.ok) return { anunciante: '', items: [], notFound: picked.options.length ? `Não achei @${handle}. Sugestões: ${picked.options.join(' / ')}` : `Não achei @${handle} na Biblioteca (Brasil). Confira o @ ou cole o link da página.` }
      for (let i = 0; i < 20 && !/view_all_page_id=/.test(wc.getURL()); i++) await wait(1000)
      listUrl = wc.getURL()
      if (!/view_all_page_id=/.test(listUrl)) throw new Error('A Biblioteca não abriu a lista da página. Cole o link da Biblioteca.')
    }

    c.progress('Abrindo a lista de anúncios…')
    await go(listUrl)
    await wait(2000)
    let height = 0
    let still = 0
    for (let i = 0; i < 60 && still < 3; i++) {
      const [h, n] = await js<[number, number]>(`(() => { window.scrollBy(0, 4000); return [document.body.scrollHeight, (document.body.innerText.match(/(Identificação da biblioteca|Library ID):/g) || []).length] })()`)
      c.progress(`Lendo a lista… ${n} anúncio(s)`)
      if (n >= c.max) break
      still = h === height ? still + 1 : 0
      height = h
      await wait(1500)
    }
    const cards = (await js<Card[]>(READ_CARDS)).filter((x) => /^\d{1,25}$/.test(x.id)).slice(0, c.max)
    const freq = new Map<string, number>()
    for (const k of cards) if (k.nome) freq.set(k.nome, (freq.get(k.nome) ?? 0) + 1)
    const anunciante = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (c.target.kind === 'handle' ? `@${c.target.handle}` : '')
    if (!cards.length) throw new Error('Nenhum anúncio na lista. A página pode não ter anúncios ativos ou a Biblioteca pediu login.')

    // the best version of each: the ad page has video_hd_url / original_image_url
    const hd: Record<string, string> = {}
    const originals: Record<string, string> = {}
    for (const [i, k] of cards.entries()) {
      if (!k.video && !k.imagem) continue
      c.progress(`Procurando a versão em alta do anúncio ${i + 1} de ${cards.length}…`)
      await go(`https://www.facebook.com/ads/library/?id=${k.id}`)
      for (let t = 0; t < 4; t++) {
        const found = bestMedia(await js<string>('document.documentElement.outerHTML'))
        Object.assign(hd, found.hd)
        Object.assign(originals, found.originals)
        if (k.video ? hd[assetId(k.video) ?? ''] : originals[fileOf(k.imagem ?? '') ?? '']) break
        await wait(2500)
      }
    }

    const folder = join(c.dir, fileSlug(anunciante, 40) || 'anuncios')
    mkdirSync(folder, { recursive: true })
    const items: RefItem[] = []
    for (const [i, k] of cards.entries()) {
      const best = k.video ? (hd[assetId(k.video) ?? ''] ?? k.video) : k.imagem ? (originals[fileOf(k.imagem) ?? ''] ?? k.imagem) : null
      const url = cdnUrl(best)
      if (!url) continue
      const dest = join(folder, `${k.id}.${k.video ? 'mp4' : 'jpg'}`)
      c.progress(`Baixando ${i + 1} de ${cards.length}…`)
      if (!existsSync(dest)) {
        const ok = await download(url, dest, c.signal)
        if (!ok) continue
      }
      items.push({
        id: k.id,
        path: dest,
        kind: k.video ? 'video' : 'image',
        anunciante: k.nome || anunciante,
        ...(k.inicio ? { inicio: k.inicio.slice(0, 80) } : {}),
        ...(daysRunning(k.inicio) !== undefined ? { dias: daysRunning(k.inicio) } : {}),
        link: `https://www.facebook.com/ads/library/?id=${k.id}`,
        tags: [],
        capturedAt: Date.now() - i,
      })
    }
    return { anunciante, items }
  } finally {
    win.destroy()
  }
}

async function download(url: string, dest: string, signal: AbortSignal): Promise<boolean> {
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal, redirect: 'follow' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      if (!cdnUrl(r.url)) throw new Error('redirecionou para fora da Meta')
      const len = Number(r.headers.get('content-length') ?? 0)
      if (len > MAX_BYTES) return false
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > MAX_BYTES) return false
      writeFileSync(dest, buf)
      return true
    } catch {
      if (signal.aborted) throw new Error('Captura cancelada.')
      await new Promise((r) => setTimeout(r, 1500 * t))
    }
  }
  return false
}
