import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { brandPrompt, cropBox, daysRunning, drawSize, exportName, formatById, formatOfSize, parseAdsTarget, scaledZone } from '@shared/social'
import { artHtml } from '../src/main/creative/art'
import { assetId, bestMedia, cdnUrl } from '../src/main/creative/ads'
import { loadBrand, saveBrand } from '../src/main/creative/brand'
import { cleanJob } from '../src/main/creative/flow'
import { styleOf } from '../src/main/creative/nodes-art'
import { pieceName } from '../src/main/creative/nodes-social'
import { addManualRefs, addRefs, listRefs, removeRef, setRefTags } from '../src/main/creative/refs'

const made: string[] = []
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'ao-social-'))
  made.push(d)
  return d
}
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

describe('social formats', () => {
  it('know their exact size and the size the model draws', () => {
    expect(formatById('4:5')).toMatchObject({ w: 1080, h: 1350 })
    expect(drawSize(formatById('9:16')!).h).toBe(1536)
    expect(drawSize(formatById('1.91:1')!).w).toBe(1536)
    expect(drawSize(formatById('1:1')!).w).toBe(1024)
  })

  it('crop a model image to the ratio, centered and even', () => {
    expect(cropBox(1024, 1536, formatById('4:5')!)).toEqual({ w: 1024, h: 1280, x: 0, y: 128 })
    const c = cropBox(1536, 1024, formatById('1.91:1')!)
    expect(c.w % 2 + (c.h % 2)).toBe(0)
    expect(c.w).toBe(1536)
  })

  it('find the format of an image, exact sizes first', () => {
    expect(formatOfSize(1080, 1920)?.id).toBe('9:16')
    expect(formatOfSize(2160, 3840)?.id).toBe('9:16')
    expect(formatOfSize(1280, 720)?.id).toBe('yt-thumb')
    expect(formatOfSize(1000, 1200)).toBeUndefined()
  })

  it('scale the safe zone to the image', () => {
    const f = formatById('9:16')!
    expect(scaledZone(f.safe!, f, 540, 960).top).toBe(125)
  })
})

describe('arte com texto on Stories', () => {
  const style = { layout: 'base', tema: 'escuro', fonte: 'sans', cor: '#9b7bf0' } as const
  it('lifts the text band above the bottom zone', () => {
    const plain = artHtml('data:image/png;base64,AA', 1080, 1920, { titulo: 'Oi' }, style)
    const safe = artHtml('data:image/png;base64,AA', 1080, 1920, { titulo: 'Oi' }, style, undefined, formatById('9:16')!.safe)
    expect(plain).toContain('px 65px;')
    expect(safe).toContain('px 442px')
  })

  it('takes color and font from the brand kit when asked', () => {
    const kit = { nome: 'X', cores: ['#112233'], fonte: 'serif' as const, logo: '', tom: '', visual: '' }
    expect(styleOf({ fonte: 'marca', cor: '' }, kit)).toMatchObject({ fonte: 'serif', cor: '#112233' })
    expect(styleOf({ fonte: 'marca', cor: '#abcdef' }, null)).toMatchObject({ fonte: 'sans', cor: '#abcdef' })
  })
})

describe('brand kit', () => {
  it('saves clean values and copies an outside logo into the floor', () => {
    const root = fresh()
    const out = fresh()
    const logo = join(out, 'logo.png')
    writeFileSync(logo, PNG)
    const kit = saveBrand(root, { nome: '  Food   Wise ', cores: ['#D97757', 'red', '#d97757', '#000000'], fonte: 'evil', logo, tom: 'direto', visual: '' })
    expect(kit).toMatchObject({ nome: 'Food Wise', cores: ['#d97757', '#000000'], fonte: 'sans', tom: 'direto' })
    expect(kit.logo.startsWith(join(root, '.criativo', 'marca'))).toBe(true)
    expect(existsSync(kit.logo)).toBe(true)
    expect(loadBrand(root)).toEqual(kit)
    // saving again keeps the same logo file
    expect(saveBrand(root, kit).logo).toBe(kit.logo)
    expect(brandPrompt(kit)).toContain('#d97757')
    expect(brandPrompt(loadBrand(fresh()))).toBe('')
  })

  it('refuses a logo that is not an image', () => {
    const root = fresh()
    expect(() => saveBrand(root, { logo: '/etc/passwd' })).toThrow(/PNG/)
  })
})

describe('references', () => {
  it('keeps tags on recapture and sends removed files to the bin', () => {
    const root = fresh()
    const dir = join(root, 'referencias', 'marca-x')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, '123.jpg')
    writeFileSync(file, PNG)
    addRefs(root, [{ id: '123', path: file, kind: 'image', anunciante: 'Marca X', tags: [], capturedAt: 1 }])
    setRefTags(root, '123', ['UGC', 'ugc', 'oferta', '<script>'])
    expect(listRefs(root)[0].tags).toEqual(['ugc', 'oferta'])
    addRefs(root, [{ id: '123', path: file, kind: 'image', anunciante: 'Marca X', dias: 40, tags: [], capturedAt: 2 }])
    expect(listRefs(root)[0]).toMatchObject({ tags: ['ugc', 'oferta'], dias: 40 })
    removeRef(root, '123')
    expect(listRefs(root)).toEqual([])
    expect(existsSync(file)).toBe(false)
  })

  it('copies files picked by hand and ignores other kinds', () => {
    const root = fresh()
    const out = fresh()
    const img = join(out, 'a.png')
    writeFileSync(img, PNG)
    const refs = addManualRefs(root, [img, '/etc/hosts', join(out, 'missing.png')])
    expect(refs).toHaveLength(1)
    expect(refs[0].path.startsWith(join(root, 'referencias', 'manual'))).toBe(true)
  })

  it('drops entries pointing outside the floor', () => {
    const root = fresh()
    mkdirSync(join(root, '.criativo'), { recursive: true })
    writeFileSync(join(root, '.criativo', 'referencias.json'), JSON.stringify({ items: [{ id: 'x', path: '/etc/hosts', kind: 'image', tags: [] }] }))
    expect(listRefs(root)).toEqual([])
  })
})

describe('ads library capture', () => {
  it('accepts @perfil, library links and ad ids only', () => {
    expect(parseAdsTarget('@bizzu.ai')).toEqual({ kind: 'handle', handle: 'bizzu.ai' })
    expect(parseAdsTarget('1234567890')).toEqual({ kind: 'id', id: '1234567890' })
    expect(parseAdsTarget('https://www.facebook.com/ads/library/?view_all_page_id=1')?.kind).toBe('url')
    expect(parseAdsTarget('https://evil.com/ads/library/')).toBeNull()
    expect(parseAdsTarget('http://www.facebook.com/ads/library/')).toBeNull()
    expect(parseAdsTarget('@a"); alert(1)//')).toBeNull()
  })

  it('downloads only from the Meta CDN over https', () => {
    expect(cdnUrl('https://video.fgru1-1.fna.fbcdn.net/v/x.mp4')).toBeTruthy()
    expect(cdnUrl('https://scontent.xx.fbcdn.net/a.jpg')).toBeTruthy()
    expect(cdnUrl('http://scontent.xx.fbcdn.net/a.jpg')).toBeNull()
    expect(cdnUrl('https://fbcdn.net.evil.com/a.jpg')).toBeNull()
  })

  it('finds the HD video and the original image in an ad page', () => {
    const efg = Buffer.from(JSON.stringify({ xpv_asset_id: 42 })).toString('base64')
    const sd = `https://video.x.fbcdn.net/sd.mp4?efg=${efg}`
    const hdUrl = `https://video.x.fbcdn.net/hd.mp4?efg=${efg}`
    const html = `{"video_hd_url":"${hdUrl.replace(/\//g, '\\/')}","original_image_url":"https:\\/\\/scontent.x.fbcdn.net\\/big.jpg","resized_image_url":"https:\\/\\/scontent.x.fbcdn.net\\/v\\/small.jpg?x=1"}`
    const m = bestMedia(html)
    expect(m.hd[assetId(sd)!]).toBe(hdUrl)
    expect(m.originals['small.jpg']).toBe('https://scontent.x.fbcdn.net/big.jpg')
  })

  it('counts the days an ad has been running', () => {
    const now = new Date(2026, 9, 24).getTime()
    expect(daysRunning('3 de set de 2026', now)).toBe(51)
    expect(daysRunning('Sep 3, 2026', now)).toBe(51)
    expect(daysRunning('ontem', now)).toBeUndefined()
  })
})

describe('export', () => {
  it('names pieces the same way every time, in carousel order', () => {
    const name = exportName({ date: new Date(2026, 9, 24), brand: 'Food Wise', platform: 'instagram', format: formatById('4:5'), piece: 'Promoção anual!', index: 3, ext: 'jpg' })
    expect(name).toBe('2026-10-24_food-wise_instagram_1080x1350_promocao-anual_03.jpg')
  })

  it('takes the piece name from the caption when none is given', () => {
    expect(pieceName('', '🔥 Promo de outubro: 20% off no plano anual\n\n#promo')).toBe('Promo de outubro 20 off')
    expect(pieceName('meu-nome', 'x')).toBe('meu-nome')
  })

  it('jobs keep only known formats', () => {
    const j = cleanJob({ jobId: 'j', floorId: 'f', nodeId: 'n', kind: 'formats', params: { formats: ['4:5', 'evil', '9:16', '4:5'], engine: 'codex' }, inputs: {} }, ['f'])
    expect(j.params.formats).toEqual(['4:5', '9:16'])
    expect(j.params.engine).toBe('codex')
    const e = cleanJob({ jobId: 'j', floorId: 'f', nodeId: 'n', kind: 'export', params: { platform: 'myspace', aspect: 'auto' }, inputs: {} }, ['f'])
    expect(e.params).toMatchObject({ platform: 'instagram', aspect: 'auto', group: 'carrossel', file: 'jpg' })
  })
})
