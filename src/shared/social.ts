// Social formats, brand kit, captured references and export names for the estúdio criativo.
// Shared by the page (pickers, safe-zone guides) and the main process (exact sizes, prompts, files).

/** Margins the platform covers with its own interface, in pixels of the format. */
export interface SafeZone {
  top: number
  bottom: number
  left: number
  right: number
}

export interface SocialFormat {
  /** Kept short and stable: saved in the flows. The first four are the old aspect values. */
  id: string
  label: string
  platform: string
  w: number
  h: number
  safe?: SafeZone
  /** Where the profile grid crops the post (Instagram shows feed posts as 3:4). */
  grid?: SafeZone
}

// Sizes from Meta, TikTok, YouTube, LinkedIn, X and Pinterest specs (2026).
// Stories/Reels: about 14% on top and 22% at the bottom stay under the app's buttons and caption.
export const SOCIAL_FORMATS: SocialFormat[] = [
  { id: '4:5', label: 'Feed 4:5', platform: 'Instagram', w: 1080, h: 1350, grid: { top: 0, bottom: 0, left: 34, right: 34 } },
  { id: '1:1', label: 'Quadrado 1:1', platform: 'Instagram', w: 1080, h: 1080, grid: { top: 0, bottom: 0, left: 135, right: 135 } },
  { id: '9:16', label: 'Stories/Reels 9:16', platform: 'Instagram', w: 1080, h: 1920, safe: { top: 250, bottom: 420, left: 60, right: 60 } },
  { id: '16:9', label: 'Paisagem 16:9', platform: 'YouTube', w: 1920, h: 1080 },
  { id: '3:4', label: 'Grade 3:4', platform: 'Instagram', w: 1080, h: 1440 },
  { id: 'tiktok', label: 'TikTok 9:16', platform: 'TikTok', w: 1080, h: 1920, safe: { top: 160, bottom: 480, left: 60, right: 140 } },
  { id: '1.91:1', label: 'Link/anúncio 1.91:1', platform: 'Facebook', w: 1200, h: 628 },
  { id: 'yt-thumb', label: 'Miniatura YouTube', platform: 'YouTube', w: 1280, h: 720 },
  { id: 'li-191', label: 'LinkedIn 1.91:1', platform: 'LinkedIn', w: 1200, h: 627 },
  { id: 'x-169', label: 'X 16:9', platform: 'X', w: 1600, h: 900 },
  { id: '2:3', label: 'Pinterest 2:3', platform: 'Pinterest', w: 1000, h: 1500 },
]

export const FORMAT_IDS = SOCIAL_FORMATS.map((f) => f.id)

export const formatById = (id: unknown): SocialFormat | undefined => SOCIAL_FORMATS.find((f) => f.id === id)

/** Select options: "Instagram · Feed 4:5 (1080×1350)". */
export const FORMAT_OPTIONS: [string, string][] = SOCIAL_FORMATS.map((f) => [f.id, `${f.platform} · ${f.label} (${f.w}×${f.h})`])

/** The format an image already is (same size, or the same ratio within 1%), preferring exact sizes. */
export function formatOfSize(w: number, h: number): SocialFormat | undefined {
  if (!w || !h) return undefined
  return SOCIAL_FORMATS.find((f) => f.w === w && f.h === h) ?? SOCIAL_FORMATS.find((f) => Math.abs(f.w / f.h - w / h) / (f.w / f.h) < 0.01)
}

/** The image size the image model draws for a format (it only makes these three). */
export function drawSize(f: SocialFormat): { w: number; h: number; label: string } {
  const r = f.w / f.h
  if (r >= 1.2) return { w: 1536, h: 1024, label: 'paisagem (1536x1024)' }
  if (r <= 0.85) return { w: 1024, h: 1536, label: 'retrato (1024x1536)' }
  return { w: 1024, h: 1024, label: 'quadrada (1024x1024)' }
}

/** Center crop of a w×h image to the ratio of the format (even sides, for ffmpeg). */
export function cropBox(w: number, h: number, f: SocialFormat): { w: number; h: number; x: number; y: number } {
  const want = f.w / f.h
  let cw = w
  let ch = h
  if (w / h > want) cw = Math.round(h * want)
  else ch = Math.round(w / want)
  cw -= cw % 2
  ch -= ch % 2
  return { w: cw, h: ch, x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2) }
}

/** The safe zone scaled to an image of w×h (the format's own pixels → the image's). */
export function scaledZone(z: SafeZone, f: SocialFormat, w: number, h: number): SafeZone {
  const sx = w / f.w
  const sy = h / f.h
  return { top: z.top * sy, bottom: z.bottom * sy, left: z.left * sx, right: z.right * sx }
}

/** Prompt lines that keep text and faces out of the zones the app covers. */
export function safePrompt(f: SocialFormat): string {
  if (f.safe) {
    const pct = (n: number, of: number) => Math.round((n / of) * 100)
    return `É um ${f.label} (${f.platform}): deixe os ${pct(f.safe.top, f.h)}% de cima e os ${pct(f.safe.bottom, f.h)}% de baixo sem rostos, produto ou texto importantes (a interface do app cobre essas faixas).`
  }
  if (f.grid) return 'Mantenha o assunto principal no centro: a grade do perfil corta as laterais.'
  return 'Mantenha o assunto principal no centro.'
}

// ---------- brand kit ----------

export type BrandFont = 'sans' | 'serif' | 'condensada'

/** The floor's brand: .criativo/marca.json, the logo copied to .criativo/marca/. */
export interface BrandKit {
  nome: string
  /** #rrggbb, the first is the main color. */
  cores: string[]
  fonte: BrandFont
  /** Absolute path of the logo inside the floor folder, or ''. */
  logo: string
  /** Voice of the captions. */
  tom: string
  /** What the images should and should not have. */
  visual: string
}

export const EMPTY_BRAND: BrandKit = { nome: '', cores: [], fonte: 'sans', logo: '', tom: '', visual: '' }
export const HEX = /^#[0-9a-f]{6}$/i
export const MAX_BRAND_COLORS = 6

export const brandIsSet = (b: BrandKit | null | undefined): b is BrandKit => !!b && !!(b.nome || b.cores.length || b.logo || b.tom || b.visual)

/** What the image model should follow; '' when the kit is empty. */
export function brandPrompt(b: BrandKit | null | undefined): string {
  if (!brandIsSet(b)) return ''
  return [
    `Identidade visual da marca${b.nome ? ` ${b.nome}` : ''}:`,
    b.cores.length ? `paleta ${b.cores.join(', ')} (a primeira é a principal; use como cores dominantes ou de destaque)` : '',
    b.visual ? `direção: ${b.visual}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

// ---------- captured references ----------

/** A creative kept as reference: captured from the Meta Ads Library or added by hand. */
export interface RefItem {
  /** Library ID of the ad, or "m-<time>" for files added by hand. */
  id: string
  path: string
  kind: 'video' | 'image'
  /** Advertiser (page name) or "Manual". */
  anunciante: string
  /** "Veiculação iniciada em …" as the library wrote it. */
  inicio?: string
  /** Days running when captured (a long-running ad is one that works). */
  dias?: number
  link?: string
  tags: string[]
  capturedAt: number
}

export const MAX_TAGS = 12
export const TAG = /^[\p{L}\p{N} _-]{1,24}$/u

export const cleanTag = (t: unknown): string | null => {
  if (typeof t !== 'string') return null
  const v = t.trim().toLowerCase().replace(/\s+/g, ' ')
  return TAG.test(v) ? v : null
}

/** What the capture box accepts: @perfil, a link of facebook.com/ads/library, or an ad ID. */
export type AdsTarget = { kind: 'handle'; handle: string } | { kind: 'url'; url: string } | { kind: 'id'; id: string }

export function parseAdsTarget(raw: unknown): AdsTarget | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (/^\d{6,25}$/.test(v)) return { kind: 'id', id: v }
  if (/^@?[A-Za-z0-9._]{2,60}$/.test(v)) return { kind: 'handle', handle: v.replace(/^@/, '') }
  try {
    const u = new URL(v)
    if (u.protocol === 'https:' && /^(www\.|m\.)?facebook\.com$/.test(u.hostname) && u.pathname.startsWith('/ads/library')) return { kind: 'url', url: u.toString() }
  } catch {
    // not a URL
  }
  return null
}

/** Days between "Veiculação iniciada em 3 de set de 2026" (or "Started running on Sep 3, 2026") and `now`. */
export function daysRunning(inicio: string | undefined, now = Date.now()): number | undefined {
  if (!inicio) return undefined
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const monthsEn = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const s = inicio.toLowerCase()
  let d: Date | null = null
  const pt = s.match(/(\d{1,2}) de ([a-zç]{3})[a-zç.]* de (\d{4})/)
  if (pt) {
    const m = months.indexOf(pt[2])
    if (m >= 0) d = new Date(Number(pt[3]), m, Number(pt[1]))
  }
  const en = !d && s.match(/([a-z]{3})[a-z.]* (\d{1,2}), (\d{4})/)
  if (en) {
    const m = monthsEn.indexOf(en[1])
    if (m >= 0) d = new Date(Number(en[3]), m, Number(en[2]))
  }
  if (!d) return undefined
  return Math.max(0, Math.floor((now - d.getTime()) / 86_400_000))
}

// ---------- export ----------

export const EXPORT_PLATFORMS: [string, string][] = [
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['tiktok', 'TikTok'],
  ['linkedin', 'LinkedIn'],
  ['x', 'X'],
  ['youtube', 'YouTube'],
  ['pinterest', 'Pinterest'],
]

export const fileSlug = (s: string, max = 40) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/, '')

/**
 * Standard name of an exported piece: <data>_<marca>_<plataforma>_<formato>_<peça>_<NN>.<ext>
 * e.g. 2026-10-24_foodwise_instagram_1080x1350_promo-anual_01.jpg (NN keeps the carousel order).
 */
export function exportName(o: { date: Date; brand: string; platform: string; format: SocialFormat | undefined; piece: string; index: number; ext: string }): string {
  const day = `${o.date.getFullYear()}-${String(o.date.getMonth() + 1).padStart(2, '0')}-${String(o.date.getDate()).padStart(2, '0')}`
  const fmt = o.format ? `${o.format.w}x${o.format.h}` : 'original'
  const parts = [day, fileSlug(o.brand, 24) || 'marca', fileSlug(o.platform, 16) || 'social', fmt, fileSlug(o.piece, 32) || 'peca', String(o.index).padStart(2, '0')]
  return `${parts.join('_')}.${o.ext}`
}
