// Quem pode pedir o quê ao Chromium (permissões da sessão padrão do Electron). Sem handler, o
// Electron aprova tudo; com ele, a página do app ganha só o que usa, e o iframe da rádio só o
// que o player do YouTube precisa. Puro, para testar (docs/prd/sala-de-reuniao.md, Segurança).

/** Origem do iframe da rádio (src/renderer/src/ui/radio.ts; CSP frame-src). */
export const RADIO_ORIGIN = 'https://www.youtube-nocookie.com'

/** O que a página do app usa: microfone (voz e reunião), copiar texto, tela cheia. */
const APP_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write', 'fullscreen'])
/** O player do YouTube: tela cheia e vídeo protegido (encrypted-media). Nunca microfone. */
const RADIO_PERMISSIONS = new Set(['fullscreen', 'mediaKeySystem'])

export interface PermissionDetails {
  /** O pedido vem do quadro principal da janela (não de um iframe). */
  isMainFrame?: boolean
  /** Pedido (`setPermissionRequestHandler`): o que o getUserMedia quer. */
  mediaTypes?: string[]
  /** Checagem (`setPermissionCheckHandler`): 'audio', 'video' ou 'unknown'. */
  mediaType?: string
}

/**
 * Libera a permissão?
 * - `url`: a URL de quem pede (`requestingUrl`; na checagem, a origem quando não houver URL).
 * - `appUrl`: a página do app: o `index.html` do pacote (file://) ou o servidor de dev
 *   (ELECTRON_RENDERER_URL). No file:// vale o caminho exato, porque toda página file://
 *   divide a mesma origem; no http(s), a origem.
 *
 * `media` só para o quadro principal do app e só áudio: pedido com vídeo é negado.
 */
export function allowPermission(permission: string, url: string, appUrl: string, details: PermissionDetails = {}): boolean {
  if (isAppUrl(url, appUrl)) {
    if (!APP_PERMISSIONS.has(permission)) return false
    if (permission !== 'media') return true
    if (details.isMainFrame === false) return false
    if (details.mediaTypes) return details.mediaTypes.length > 0 && details.mediaTypes.every((t) => t === 'audio')
    // a checagem (enumerateDevices, por exemplo) vem com 'audio' ou 'unknown'; vídeo, não
    return details.mediaType !== 'video'
  }
  return originOf(url) === RADIO_ORIGIN && RADIO_PERMISSIONS.has(permission)
}

/** `url` é a página do app? */
export function isAppUrl(url: string, appUrl: string): boolean {
  const u = parse(url)
  const app = parse(appUrl)
  if (!u || !app) return false
  if (app.protocol === 'file:') return u.protocol === 'file:' && u.pathname === app.pathname
  if (app.protocol !== 'http:' && app.protocol !== 'https:') return false
  return u.origin === app.origin
}

function originOf(url: string): string | null {
  const u = parse(url)
  return u && (u.protocol === 'https:' || u.protocol === 'http:') ? u.origin : null
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}
