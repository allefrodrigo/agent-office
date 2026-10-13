import { DEFAULT_BRAND } from '../../world/brand'
import type { ProjectFloor } from '@shared/types'
import { h, icon } from '../dom'
import { cleanError } from './common'

// A floor's logo, brand color and uniform (Configurações and Novo andar).

const MAX_LOGO_PX = 256

/**
 * Reads an image file into a PNG data URL no bigger than 256 px, plus its most
 * common vivid color. Re-encoding drops anything that is not pixels.
 */
async function readLogo(file: File): Promise<{ logo: string; color: string | null }> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use uma imagem PNG, JPG, WebP ou GIF.')
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const k = Math.min(1, MAX_LOGO_PX / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * k))
    c.height = Math.max(1, Math.round(img.naturalHeight * k))
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return { logo: c.toDataURL('image/png'), color: vividColor(ctx.getImageData(0, 0, c.width, c.height).data) }
  } catch (err) {
    throw new Error(err instanceof Error && err.message.startsWith('Use') ? err.message : 'Não consegui abrir essa imagem.', { cause: err })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The most frequent saturated color (opaque, not near white/black/gray), or null. */
function vividColor(px: Uint8ClampedArray): string | null {
  const counts = new Map<number, number>()
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (a < 200 || max < 40 || min > 225 || max - min < 50) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = -1
  let n = 0
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c]
  if (best < 0) return null
  const ch = (v: number) => ((v << 4) | 8).toString(16).padStart(2, '0')
  return `#${ch(best >> 8)}${ch((best >> 4) & 15)}${ch(best & 15)}`
}

/** Logo, brand color and the uniform toggle of one floor in Configurações. */
export function brandFields(p: ProjectFloor, set: (patch: Partial<ProjectFloor>) => void, toast: (t: string, k?: 'info' | 'ok' | 'err') => void): HTMLElement {
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden' }) as HTMLInputElement
  const thumb = h('button', { class: 'floor-brand-logo', type: 'button', title: 'Logo da empresa (placa do andar e farda)' })
  const clear = h('button', { class: 'icon-btn floor-brand-clear', type: 'button', title: 'Tirar o logo' }, icon('x', 12))
  const color = h('input', { type: 'color', class: 'floor-brand-color', value: p.brandColor ?? DEFAULT_BRAND, title: 'Cor da empresa' }) as HTMLInputElement
  const uniform = h('input', { type: 'checkbox' }) as HTMLInputElement
  uniform.checked = !!p.uniform
  const showLogo = (logo: string | undefined) => {
    thumb.replaceChildren(logo ? h('img', { src: logo, alt: '' }) : icon('image', 16))
    clear.classList.toggle('hidden', !logo)
  }
  showLogo(p.logo)
  thumb.addEventListener('click', () => file.click())
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    try {
      const { logo, color: found } = await readLogo(f)
      // the logo's color becomes the brand color until the player picks one
      const patch: Partial<ProjectFloor> = { logo }
      if (found && !p.brandColor) {
        patch.brandColor = found
        color.value = found
      }
      set(patch)
      p = { ...p, ...patch }
      showLogo(logo)
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  })
  clear.addEventListener('click', () => {
    set({ logo: undefined })
    p = { ...p, logo: undefined }
    showLogo(undefined)
  })
  color.addEventListener('input', () => {
    set({ brandColor: color.value })
    p = { ...p, brandColor: color.value }
  })
  uniform.addEventListener('change', () => set({ uniform: uniform.checked }))
  return h(
    'div',
    { class: 'floor-brand-row' },
    h('span', { class: 'floor-brand-logo-wrap' }, thumb, clear),
    file,
    color,
    h('label', { class: 'check' }, uniform, 'Agentes com a farda da empresa'),
  )
}
