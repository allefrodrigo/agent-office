import { powerSaveBlocker, type Session, type WebContents } from 'electron'
import { allowPermission } from '@shared/media-permissions'
import { log } from '../log'

// Sala de reunião, lado do main: quem pode abrir o microfone e como a gravação segue com a
// janela escondida (docs/prd/sala-de-reuniao.md, "Captura de áudio" e "Segurança e privacidade").
// No macOS o áudio do sistema vem do ajudante Swift (RN-05b), não do getDisplayMedia: aqui não
// há setDisplayMediaRequestHandler.

type PermissionSession = Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>

/**
 * Sem handler, o Electron aprova qualquer pedido de permissão. Com estes, `media` (só áudio) vai
 * só para a página do app (`appUrl`: o index.html do pacote ou ELECTRON_RENDERER_URL); o iframe
 * da rádio fica com tela cheia e encrypted-media; o resto é negado. Regras em allowPermission.
 */
export function installMediaPermissions(ses: PermissionSession, appUrl: string): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok = allowPermission(permission, details.requestingUrl, appUrl, {
      isMainFrame: details.isMainFrame,
      mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
    })
    // Só o nome da permissão e a origem: a URL do app traz o caminho do usuário.
    if (!ok) log.warn(`Permissão negada: ${permission} (${originForLog(details.requestingUrl)})`)
    callback(ok)
  })
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    // A checagem nem sempre traz a URL; no quadro principal, a URL da janela serve.
    const url = details.requestingUrl || (details.isMainFrame && wc ? wc.getURL() : requestingOrigin)
    return allowPermission(permission, url, appUrl, { isMainFrame: details.isMainFrame, mediaType: details.mediaType })
  })
}

type Blocker = Pick<typeof powerSaveBlocker, 'start' | 'stop' | 'isStarted'>

/**
 * Durante a gravação: a página não é estrangulada em segundo plano e o sistema não suspende o
 * app. Devolve a função que desfaz tudo como estava (pode chamar mais de uma vez).
 */
export function keepAwake(wc: Pick<WebContents, 'getBackgroundThrottling' | 'setBackgroundThrottling' | 'isDestroyed'>, blocker: Blocker = powerSaveBlocker): () => void {
  const throttled = wc.getBackgroundThrottling()
  wc.setBackgroundThrottling(false)
  const id = blocker.start('prevent-app-suspension')
  let done = false
  return () => {
    if (done) return
    done = true
    if (blocker.isStarted(id)) blocker.stop(id)
    if (!wc.isDestroyed()) wc.setBackgroundThrottling(throttled)
  }
}

function originForLog(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'file:' ? 'file://' : u.origin
  } catch {
    return '?'
  }
}
