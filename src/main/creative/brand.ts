import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, sep } from 'node:path'
import { EMPTY_BRAND, HEX, MAX_BRAND_COLORS, type BrandFont, type BrandKit } from '@shared/social'
import { insideRoot } from './flow'

// The floor's brand kit: .criativo/marca.json, with the logo copied to .criativo/marca/ so the kit
// travels with the folder. Nodes read it when their "Kit de marca" says so.

const LOGO_EXT = /\.(png|jpe?g|webp)$/i
export const brandFile = (root: string) => join(root, '.criativo', 'marca.json')
const brandDir = (root: string) => join(root, '.criativo', 'marca')

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const font = (v: unknown): BrandFont => (v === 'serif' || v === 'condensada' ? v : 'sans')

export function loadBrand(root: string): BrandKit {
  try {
    const raw = JSON.parse(readFileSync(brandFile(root), 'utf8')) as Record<string, unknown>
    const logo = typeof raw.logo === 'string' && insideRoot(root, raw.logo) && LOGO_EXT.test(raw.logo) ? raw.logo : ''
    return {
      nome: text(raw.nome, 60),
      cores: (Array.isArray(raw.cores) ? raw.cores : []).filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, MAX_BRAND_COLORS),
      fonte: font(raw.fonte),
      logo,
      tom: text(raw.tom, 600),
      visual: text(raw.visual, 600),
    }
  } catch {
    return { ...EMPTY_BRAND }
  }
}

/** Cleans and saves the kit. A logo from outside the floor is copied into .criativo/marca/. */
export function saveBrand(root: string, raw: unknown): BrandKit {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  let logo = ''
  if (typeof r.logo === 'string' && r.logo) {
    if (!isAbsolute(r.logo) || !LOGO_EXT.test(r.logo) || !existsSync(r.logo)) throw new Error('O logo precisa ser um PNG, JPEG ou WebP desta máquina.')
    const inside = insideRoot(root, r.logo)
    const kitDir = existsSync(brandDir(root)) ? realpathSync(brandDir(root)) : null
    if (inside && kitDir && inside.startsWith(kitDir + sep)) logo = r.logo
    else {
      mkdirSync(brandDir(root), { recursive: true })
      logo = join(brandDir(root), `logo-${Date.now()}${extname(r.logo).toLowerCase()}`)
      copyFileSync(r.logo, logo)
    }
  }
  const kit: BrandKit = {
    nome: text(r.nome, 60),
    cores: [...new Set((Array.isArray(r.cores) ? r.cores : []).filter((c): c is string => typeof c === 'string' && HEX.test(c)).map((c) => c.toLowerCase()))].slice(0, MAX_BRAND_COLORS),
    fonte: font(r.fonte),
    logo,
    tom: text(r.tom, 600),
    visual: text(r.visual, 600),
  }
  mkdirSync(join(root, '.criativo'), { recursive: true })
  writeFileSync(`${brandFile(root)}.tmp`, JSON.stringify(kit, null, 1))
  renameSync(`${brandFile(root)}.tmp`, brandFile(root))
  return kit
}
