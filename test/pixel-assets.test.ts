import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  backgroundColors,
  createImage,
  downscaleMode,
  findBands,
  opaqueBounds,
  parseSheetLayout,
  processFloor,
  processSceneSheet,
  processSheet,
  processSprite,
  removeBackground,
  removeSpecks,
  SCREEN_HOLE,
  sliceSheet,
  type CharacterSpec,
  type Rect,
  type Rgb,
  type SpriteSpec,
} from '../scripts/pixel/core.mjs'
import { crc32, decodePng, encodePng, type RgbaImage } from '../scripts/pixel/png.mjs'

// Synthetic images only: every picture here is drawn by the test itself.

const WHITE: Rgb = [255, 255, 255]
const RED: Rgb = [255, 0, 0]
const BLUE: Rgb = [0, 0, 255]
const GREEN: Rgb = [0, 160, 0]
const MAGENTA: Rgb = [255, 0, 255]

function canvas(w: number, h: number, color: Rgb = WHITE): RgbaImage {
  const img = createImage(w, h)
  fill(img, { x: 0, y: 0, w, h }, color)
  return img
}

function fill(img: RgbaImage, r: Rect, color: Rgb, alpha = 255): RgbaImage {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) img.data.set([...color, alpha], (y * img.width + x) * 4)
  return img
}

const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))
const alphaAt = (img: RgbaImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]

/** Distinct colors of the opaque pixels, as "r,g,b". */
function palette(img: RgbaImage): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]) out.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`)
  return out
}

function rng(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}

/** Light gray background with small random variation, like the sheets Codex returns. */
function unevenBackground(w: number, h: number): RgbaImage {
  const rand = rng(7)
  const img = createImage(w, h)
  for (let p = 0; p < w * h; p++) {
    const v = 238 + Math.round((rand() - 0.5) * 16)
    img.data.set([v, v + Math.round((rand() - 0.5) * 6), v, 255], p * 4)
  }
  return img
}

function checker(img: RgbaImage, r: Rect, size: number, a: Rgb, b: Rgb) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const odd = (Math.floor((x - r.x) / size) + Math.floor((y - r.y) / size)) % 2
      img.data.set([...(odd ? b : a), 255], (y * img.width + x) * 4)
    }
  }
}

/** Hand-built PNG (filter 0 on every row) to exercise the decoder's color types. */
function rawPng(width: number, height: number, depth: number, colorType: number, rows: number[][], extra: [string, number[]][] = []) {
  const chunk = (type: string, body: Buffer) => {
    const out = Buffer.alloc(12 + body.length)
    out.writeUInt32BE(body.length, 0)
    out.write(type, 4, 'latin1')
    body.copy(out, 8)
    out.writeUInt32BE(crc32(out, 4, 8 + body.length), 8 + body.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = depth
  ihdr[9] = colorType
  const scan = Buffer.from(rows.flatMap((row) => [0, ...row]))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra.map(([type, body]) => chunk(type, Buffer.from(body))),
    chunk('IDAT', deflateSync(scan)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('PNG', () => {
  const rand = rng(1)
  const img = createImage(13, 9)
  for (let i = 0; i < img.data.length; i++) img.data[i] = Math.floor(rand() * 256)

  it('codifica e decodifica RGBA sem perda, com qualquer filtro', () => {
    for (const filter of [undefined, 0, 1, 2, 3, 4] as const) {
      const back = decodePng(encodePng(img, { filter }))
      expect([back.width, back.height]).toEqual([13, 9])
      expect(back.data).toEqual(img.data)
    }
  })

  it('lê paleta com tRNS, cinza 16 bits, cinza com alpha e paleta de 2 bits', () => {
    const pal = decodePng(
      rawPng(
        2,
        1,
        8,
        3,
        [[0, 1]],
        [
          ['PLTE', [255, 0, 0, 0, 0, 255]],
          ['tRNS', [0]],
        ],
      ),
    )
    expect([px(pal, 0, 0), px(pal, 1, 0)]).toEqual([
      [255, 0, 0, 0],
      [0, 0, 255, 255],
    ])
    const gray16 = decodePng(rawPng(1, 1, 16, 0, [[0x80, 0xff]]))
    expect(px(gray16, 0, 0)).toEqual([128, 128, 128, 255])
    const grayAlpha = decodePng(rawPng(1, 1, 8, 4, [[50, 100]]))
    expect(px(grayAlpha, 0, 0)).toEqual([50, 50, 50, 100])
    // 2 bits: indices 3, 2, 1, 0 packed in one byte
    const small = decodePng(rawPng(4, 1, 2, 3, [[0b11100100]], [['PLTE', [0, 0, 0, 10, 10, 10, 20, 20, 20, 30, 30, 30]]]))
    expect([0, 1, 2, 3].map((x) => px(small, x, 0)[0])).toEqual([30, 20, 10, 0])
    const rgbKey = decodePng(rawPng(2, 1, 8, 2, [[1, 2, 3, 9, 9, 9]], [['tRNS', [0, 1, 0, 2, 0, 3]]]))
    expect([alphaAt(rgbKey, 0, 0), alphaAt(rgbKey, 1, 0)]).toEqual([0, 255])
  })

  it('recusa PNG entrelaçado e arquivo que não é PNG com mensagem clara', () => {
    const interlaced = rawPng(1, 1, 8, 0, [[0]])
    interlaced[8 + 8 + 12] = 1
    interlaced.writeUInt32BE(crc32(interlaced, 12, 12 + 4 + 13), 12 + 4 + 13)
    expect(() => decodePng(interlaced)).toThrow(/entrelaçado/)
    expect(() => decodePng(Buffer.from('GIF89a......'))).toThrow(/não é um PNG/)
  })
})

describe('remoção de fundo', () => {
  it('fundo liso: tira só o que encosta na borda (o buraco fechado fica)', () => {
    const img = canvas(60, 40)
    fill(img, { x: 10, y: 10, w: 40, h: 20 }, RED)
    fill(img, { x: 25, y: 15, w: 10, h: 10 }, WHITE)
    const { image, colors } = removeBackground(img)
    expect(colors).toEqual([WHITE])
    expect(alphaAt(image, 0, 0)).toBe(0)
    expect(alphaAt(image, 5, 35)).toBe(0)
    expect(px(image, 12, 12)).toEqual([...RED, 255])
    expect(px(image, 30, 20)).toEqual([...WHITE, 255])
  })

  it('fundo verde de chroma key: sai também o buraco fechado', () => {
    const img = canvas(60, 40, [0, 255, 0])
    fill(img, { x: 10, y: 10, w: 40, h: 20 }, RED)
    fill(img, { x: 25, y: 15, w: 10, h: 10 }, [10, 250, 5])
    // soft edge: a 1 px ring blending the green into the art
    fill(img, { x: 9, y: 9, w: 42, h: 1 }, [40, 170, 40])
    const { image } = removeBackground(img)
    expect(alphaAt(image, 30, 20)).toBe(0)
    expect(alphaAt(image, 20, 9)).toBe(0)
    expect(px(image, 12, 12)).toEqual([...RED, 255])
    expect(opaqueBounds(image)).toEqual({ x: 10, y: 10, w: 40, h: 20 })
  })

  it('fundo xadrez cinza e branco sai inteiro', () => {
    const img = createImage(64, 64)
    checker(img, { x: 0, y: 0, w: 64, h: 64 }, 8, WHITE, [204, 204, 204])
    fill(img, { x: 16, y: 16, w: 32, h: 32 }, BLUE)
    const { image, colors } = removeBackground(img)
    expect(colors).toHaveLength(2)
    expect(palette(image)).toEqual(new Set(['0,0,255']))
    expect(opaqueBounds(image)).toEqual({ x: 16, y: 16, w: 32, h: 32 })
  })

  it('fundo levemente irregular sai sem comer o objeto', () => {
    const img = unevenBackground(80, 60)
    fill(img, { x: 20, y: 15, w: 40, h: 30 }, [90, 90, 90])
    const { image } = removeBackground(img)
    expect(palette(image)).toEqual(new Set(['90,90,90']))
    expect(opaqueBounds(image)).toEqual({ x: 20, y: 15, w: 40, h: 30 })
  })

  it('objeto encostado numa borda não vira cor de fundo', () => {
    const img = canvas(100, 60)
    fill(img, { x: 20, y: 30, w: 60, h: 30 }, GREEN)
    expect(backgroundColors(img)).toEqual([WHITE])
    expect(opaqueBounds(removeBackground(img).image)).toEqual({ x: 20, y: 30, w: 60, h: 30 })
  })

  it('usa a transparência que a imagem já tem e deixa o alpha binário', () => {
    const img = createImage(20, 20)
    fill(img, { x: 5, y: 5, w: 10, h: 10 }, RED, 200)
    fill(img, { x: 4, y: 5, w: 1, h: 10 }, RED, 100)
    const { image, colors } = removeBackground(img)
    expect(colors).toBeNull()
    expect(alphaAt(image, 5, 5)).toBe(255)
    expect(alphaAt(image, 4, 5)).toBe(0)
  })

  it('fundo magenta de molde recolorível: tira também o vão fechado, mas só quando pedido', () => {
    // a red ring around a magenta hole, like the gap between a raised arm and the head
    const img = canvas(60, 60, MAGENTA)
    fill(img, { x: 10, y: 10, w: 40, h: 40 }, RED)
    fill(img, { x: 25, y: 25, w: 10, h: 10 }, MAGENTA)
    expect(alphaAt(removeBackground(img).image, 30, 30)).toBe(255)
    const keyed = removeBackground(img, { magentaKey: true }).image
    expect(alphaAt(keyed, 30, 30)).toBe(0)
    expect(alphaAt(keyed, 15, 15)).toBe(255)
  })
})

describe('sprite comum', () => {
  it('recorta pela caixa do objeto ignorando pontinhos soltos', () => {
    const img = canvas(200, 200)
    fill(img, { x: 50, y: 60, w: 40, h: 20 }, RED)
    fill(img, { x: 180, y: 10, w: 2, h: 2 }, BLUE)
    const clean = removeBackground(img).image
    expect(opaqueBounds(removeSpecks(clean, 20))).toEqual({ x: 50, y: 60, w: 40, h: 20 })
    const { image, size } = processSprite(img, { w: 40, h: 20 })
    expect(size).toEqual([40, 20])
    expect(palette(image)).toEqual(new Set(['255,0,0']))
  })

  it('acha a tela magenta, abre um buraco nela e converte o retângulo para a saída', () => {
    const img = canvas(140, 100)
    fill(img, { x: 20, y: 20, w: 100, h: 60 }, [51, 51, 51])
    fill(img, { x: 40, y: 30, w: 40, h: 20 }, MAGENTA)
    const exact = processSprite(img, { w: 50, h: 30, screen: true })
    expect(exact.screen).toEqual([10, 5, 20, 10])
    expect(px(exact.image, 15, 8)).toEqual([...SCREEN_HOLE])
    expect(palette(exact.image).has('255,0,255')).toBe(false)
    // 0.6x: 60x36 anchored at the bottom of 60x40, so 4 px down
    const offset = processSprite(img, { w: 60, h: 40, screen: true })
    expect(offset.size).toEqual([60, 36])
    expect(offset.screen).toEqual([12, 10, 24, 12])
    const noScreen = fill(canvas(50, 50), { x: 10, y: 10, w: 30, h: 30 }, RED)
    expect(() => processSprite(noScreen, { w: 20, h: 20, screen: true })).toThrow(/magenta/)
  })

  it('redução "moda" mantém as cores puras', () => {
    const img = createImage(8, 2)
    // block 0: 3 red + 1 blue -> red
    fill(img, { x: 0, y: 0, w: 2, h: 2 }, RED)
    fill(img, { x: 1, y: 1, w: 1, h: 1 }, BLUE)
    // block 1: three shades in the same 5-bit bucket + 1 blue -> their average
    fill(img, { x: 2, y: 0, w: 1, h: 1 }, [250, 10, 10])
    fill(img, { x: 3, y: 0, w: 1, h: 1 }, [252, 12, 9])
    fill(img, { x: 2, y: 1, w: 1, h: 1 }, [254, 14, 13])
    fill(img, { x: 3, y: 1, w: 1, h: 1 }, BLUE)
    // block 2: 1 of 4 opaque -> transparent; block 3: 2 of 4 -> opaque
    fill(img, { x: 4, y: 0, w: 1, h: 1 }, GREEN)
    fill(img, { x: 6, y: 0, w: 2, h: 1 }, GREEN)
    const out = downscaleMode(img, 4, 1)
    expect(px(out, 0, 0)).toEqual([...RED, 255])
    expect(px(out, 1, 0)).toEqual([252, 12, 11, 255])
    expect(alphaAt(out, 2, 0)).toBe(0)
    expect(px(out, 3, 0)).toEqual([...GREEN, 255])

    // a 2-2 tie keeps the darker color whichever side it is on
    const tie = createImage(4, 2)
    fill(tie, { x: 0, y: 0, w: 1, h: 2 }, WHITE)
    fill(tie, { x: 1, y: 0, w: 2, h: 2 }, [20, 20, 20])
    fill(tie, { x: 3, y: 0, w: 1, h: 2 }, WHITE)
    expect([px(downscaleMode(tie, 2, 1), 0, 0), px(downscaleMode(tie, 2, 1), 1, 0)]).toEqual([
      [20, 20, 20, 255],
      [20, 20, 20, 255],
    ])

    const big = createImage(90, 90)
    checker(big, { x: 0, y: 0, w: 90, h: 90 }, 7, RED, BLUE)
    expect([...palette(downscaleMode(big, 30, 30))].every((c) => c === '255,0,0' || c === '0,0,255')).toBe(true)
  })

  it('ancora no centro de baixo da caixa', () => {
    const wide = canvas(100, 100)
    fill(wide, { x: 30, y: 45, w: 40, h: 10 }, RED)
    const low = processSprite(wide, { w: 20, h: 20 })
    expect(low.size).toEqual([20, 5])
    expect(opaqueBounds(low.image)).toEqual({ x: 0, y: 15, w: 20, h: 5 })

    const tall = canvas(100, 100)
    fill(tall, { x: 45, y: 30, w: 10, h: 40 }, RED)
    const narrow = processSprite(tall, { w: 20, h: 20 })
    expect(opaqueBounds(narrow.image)).toEqual({ x: 7, y: 0, w: 5, h: 20 })
    expect(narrow.warnings.join(' ')).toMatch(/proporção/)
  })

  it('fit "h": a altura manda e a largura pode passar da caixa até 1,6·w', () => {
    const tall = fill(canvas(200, 200), { x: 90, y: 50, w: 20, h: 100 }, RED)
    const narrow = processSprite(tall, { w: 28, h: 72, fit: 'h' })
    expect([narrow.image.width, narrow.image.height]).toEqual([28, 72])
    expect(opaqueBounds(narrow.image)).toEqual({ x: 7, y: 0, w: 14, h: 72 })

    // within 1.6·w: fills the height and the output widens to 36
    const square = fill(canvas(200, 200), { x: 50, y: 50, w: 100, h: 100 }, RED)
    const wider = processSprite(square, { w: 28, h: 36, fit: 'h' })
    expect([wider.image.width, wider.image.height]).toEqual([36, 36])
    expect(opaqueBounds(wider.image)).toEqual({ x: 0, y: 0, w: 36, h: 36 })
    expect(wider.warnings).toEqual([])
    expect(processSprite(square, { w: 28, h: 36 }).size).toEqual([28, 28])

    // past 1.6·w (44 px): shrinks until 44 wide, still anchored at the bottom
    const wide = fill(canvas(300, 200), { x: 50, y: 50, w: 200, h: 100 }, RED)
    const capped = processSprite(wide, { w: 28, h: 36, fit: 'h' })
    expect([capped.image.width, capped.image.height]).toEqual([44, 36])
    expect(opaqueBounds(capped.image)).toEqual({ x: 0, y: 14, w: 44, h: 22 })
    expect(capped.warnings.join(' ')).toMatch(/largo demais/)
  })

  it('piso: não tira fundo, corta o centro quadrado e reduz a imagem inteira', () => {
    const img = createImage(120, 80)
    fill(img, { x: 0, y: 0, w: 20, h: 80 }, RED)
    fill(img, { x: 100, y: 0, w: 20, h: 80 }, BLUE)
    checker(img, { x: 20, y: 0, w: 80, h: 80 }, 10, WHITE, GREEN)
    const { image } = processFloor(img, { w: 16, h: 16 })
    expect([image.width, image.height]).toEqual([16, 16])
    expect(palette(image)).toEqual(new Set(['255,255,255', '0,160,0']))
    expect(opaqueBounds(image)).toEqual({ x: 0, y: 0, w: 16, h: 16 })
  })
})

describe('folha de personagem', () => {
  const characters: CharacterSpec = {
    cell: [48, 64],
    grid: [4, 3],
    standHeight: 46,
    poses: [
      ['frente', 'costas', 'lado', 'aceno'],
      ['andar-frente', 'andar-costas', 'andar-lado', 'andar-lado-2'],
      ['sentado-frente', 'sentado-costas', 'sentado-lado', 'caido'],
    ],
  }
  const heights = [92, 90, 80, 100, 92, 88, 84, 96, 60, 58, 62, 40]
  const colorOf = (i: number): Rgb => [20 * i, 255 - 20 * i, (60 * i) % 256]

  it('fatia 4x3 pelos vãos, aplica uma escala só e encosta os pés em y = 62', () => {
    const img = canvas(560, 330)
    heights.forEach((h, i) => {
      const w = i === 11 ? 110 : 40
      const [c, r] = [i % 4, Math.floor(i / 4)]
      fill(img, { x: c * 140 + (140 - w) / 2, y: r * 110 + 105 - h, w, h }, colorOf(i))
    })
    const { image, scale, warnings } = processSheet(img, characters)
    expect([image.width, image.height]).toEqual([192, 192])
    expect(scale).toBe(0.5)
    heights.forEach((h, i) => {
      const [c, r] = [i % 4, Math.floor(i / 4)]
      const box = opaqueBounds(image, { x: c * 48, y: r * 64, w: 48, h: 64 })!
      if (i === 11) {
        // "caido" would be 55 px wide: shrunk alone to fit 48
        expect(box).toEqual({ x: c * 48, y: r * 64 + 62 - 17, w: 48, h: 17 })
      } else {
        expect(box).toEqual({ x: c * 48 + 14, y: r * 64 + 62 - h / 2, w: 20, h: h / 2 })
      }
      expect(px(image, box.x + 2, box.y + 2)).toEqual([...colorOf(i), 255])
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/"caido".*reduzi só ela/)
  })

  it('cai para grade uniforme quando as poses se encostam', () => {
    const img = canvas(320, 330)
    heights.forEach((h, i) => {
      const [c, r] = [i % 4, Math.floor(i / 4)]
      fill(img, { x: c * 80, y: r * 110 + 105 - h, w: 80, h }, colorOf(i))
    })
    const { image, warnings } = processSheet(img, characters)
    expect(warnings.join(' ')).toMatch(/partes iguais/)
    heights.forEach((h, i) => {
      const [c, r] = [i % 4, Math.floor(i / 4)]
      const box = opaqueBounds(image, { x: c * 48, y: r * 64, w: 48, h: 64 })!
      expect(box).toEqual({ x: c * 48 + 4, y: r * 64 + 62 - h / 2, w: 40, h: h / 2 })
      expect(px(image, box.x + 2, box.y + 2)).toEqual([...colorOf(i), 255])
    })
  })

  it('avisa quantas poses achou quando falta pose', () => {
    const img = canvas(560, 330)
    heights.forEach((h, i) => {
      if (i === 3 || i === 7) return
      const [c, r] = [i % 4, Math.floor(i / 4)]
      fill(img, { x: c * 140 + 50, y: r * 110 + 105 - h, w: 40, h }, colorOf(i))
    })
    expect(() => processSheet(img, characters)).toThrow(/achei 10 poses, esperava 12/)
  })
})

describe('folha de cenário', () => {
  const sprites: Record<string, SpriteSpec> = {
    'moveis/a': { w: 30, h: 20 },
    'moveis/tela': { w: 30, h: 20, screen: true },
    'moveis/c': { w: 20, h: 30 },
    'moveis/d': { w: 25, h: 25 },
    'chao/piso': { w: 16, h: 16 },
  }
  const ORANGE: Rgb = [230, 120, 30]
  const BROWN: Rgb = [110, 60, 20]

  /** 3x2 sheet on an uneven light background; cell 4 (row 2, column 2) is null. */
  function sheet(fillNull = false) {
    const img = unevenBackground(300, 200)
    fill(img, { x: 20, y: 35, w: 60, h: 30 }, RED)
    fill(img, { x: 120, y: 30, w: 60, h: 40 }, [51, 51, 51])
    fill(img, { x: 130, y: 40, w: 40, h: 20 }, MAGENTA)
    fill(img, { x: 230, y: 20, w: 40, h: 60 }, BLUE)
    fill(img, { x: 25, y: 125, w: 50, h: 50 }, GREEN)
    if (fillNull) fill(img, { x: 130, y: 130, w: 40, h: 40 }, [250, 220, 0])
    checker(img, { x: 210, y: 110, w: 80, h: 80 }, 10, ORANGE, BROWN)
    return img
  }
  const layout = { grid: [3, 2], keys: ['moveis/a', 'moveis/tela', 'moveis/c', 'moveis/d', null, 'chao/piso'] }

  it('fatia 3x2, pula a célula null e gera cada sprite na caixa do catálogo', () => {
    for (const fillNull of [false, true]) {
      const { results, warnings } = processSceneSheet(sheet(fillNull), layout, sprites)
      expect(warnings).toEqual([])
      expect(results.map((r) => r.key)).toEqual(['moveis/a', 'moveis/tela', 'moveis/c', 'moveis/d', 'chao/piso'])
      const byKey = Object.fromEntries(results.map((r) => [r.key, r]))
      for (const r of results) expect('error' in r ? r.error : '').toBe('')
      const get = (key: string) => {
        const r = byKey[key]
        if ('error' in r) throw new Error(r.error)
        return r
      }
      expect(opaqueBounds(get('moveis/a').image)).toEqual({ x: 0, y: 5, w: 30, h: 15 })
      expect(palette(get('moveis/a').image)).toEqual(new Set(['255,0,0']))
      expect(get('moveis/tela').screen).toEqual([5, 5, 20, 10])
      expect(get('moveis/c').size).toEqual([20, 30])
      expect(palette(get('moveis/d').image)).toEqual(new Set(['0,160,0']))
      const floor = get('chao/piso').image
      expect(opaqueBounds(floor)).toEqual({ x: 0, y: 0, w: 16, h: 16 })
      expect(palette(floor)).toEqual(new Set([ORANGE.join(','), BROWN.join(',')]))
    }
  })

  it('processa só as chaves pedidas', () => {
    const { results } = processSceneSheet(sheet(), layout, sprites, { only: new Set(['moveis/c']) })
    expect(results.map((r) => r.key)).toEqual(['moveis/c'])
  })

  it('separa por blocos quando as colunas vazias não bastam', () => {
    // A and B overlap in x but not in y, each in its own third; C is tall, so the row is one band
    const img = canvas(300, 100)
    fill(img, { x: 40, y: 10, w: 70, h: 30 }, RED)
    fill(img, { x: 100, y: 60, w: 70, h: 30 }, BLUE)
    fill(img, { x: 230, y: 10, w: 40, h: 80 }, GREEN)
    const { cells, warnings } = sliceSheet(removeBackground(img).image, 3, 1)
    expect(warnings.join(' ')).toMatch(/blocos/)
    expect(cells.map((c) => c.box)).toEqual([
      { x: 40, y: 10, w: 70, h: 30 },
      { x: 100, y: 60, w: 70, h: 30 },
      { x: 230, y: 10, w: 40, h: 80 },
    ])
    const { results } = processSceneSheet(img, { grid: [3, 1], keys: ['moveis/a', 'moveis/d', 'moveis/c'] }, sprites)
    expect(results.map((r) => ('error' in r ? r.error : palette(r.image)))).toEqual([
      new Set(['255,0,0']),
      new Set(['0,0,255']),
      new Set(['0,160,0']),
    ])
  })

  it('valida o JSON da folha', () => {
    expect(() => parseSheetLayout({ grid: [3, 2], keys: ['moveis/a'] })).toThrow(/3x2 \(6 células\) mas tem 1 keys/)
    expect(() => parseSheetLayout({ keys: [] })).toThrow(/grid/)
    expect(() => parseSheetLayout({ grid: [1, 1], keys: ['sofa'] })).toThrow(/grupo\/chave/)
  })

  it('funde faixas separadas por vãos pequenos', () => {
    expect(findBands([1, 1, 0, 1, 1, 0, 0, 0, 0, 1], 2)).toEqual([
      [0, 5],
      [9, 10],
    ])
  })
})
