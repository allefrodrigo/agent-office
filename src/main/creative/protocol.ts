import { net, protocol } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEDIA_EXT } from '@shared/creative'

// office-media://f/<encoded absolute path>: the studio shows local images and videos without
// opening file:// to the page. Only media extensions are served, never folders or other files.

export const MEDIA_SCHEME = 'office-media'

/** Before app ready: the scheme streams (video seeking) and works in <img>/<video>. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
}

export function handleMediaScheme(): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    let path: string
    try {
      path = decodeURIComponent(new URL(req.url).pathname.slice(1))
    } catch {
      return new Response('bad request', { status: 400 })
    }
    if (!isAbsolute(path) || !MEDIA_EXT.test(path) || !existsSync(path) || !statSync(path).isFile()) return new Response('not found', { status: 404 })
    // Range headers pass through: <video> seeks without loading the whole file.
    return net.fetch(pathToFileURL(path).toString(), { headers: req.headers, bypassCustomProtocolHandlers: true })
  })
}
