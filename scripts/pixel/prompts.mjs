// Prompts for `npm run pixel:gerar`: what Codex (image_gen) draws for each raw image in arte-2d/.
// Characters are 4x3 sheets; scenery comes in sheets too, sliced by `npm run pixel` with the
// sheet's .json. Human-facing versions of these prompts live in docs/arte-2d/.

import { readFileSync } from 'node:fs'

export const CHARACTER_STYLE = `Pixel-art character sprite sheet for a cozy 16-bit office RPG, 3/4 top-down camera (like classic SNES/GBA office RPGs). Chibi proportions: head about 1/3 of the body height.

Layout: a clean grid of 4 columns x 3 rows = 12 poses of the SAME character, same scale in every pose (the head is the same size in all 12), feet aligned on each row's baseline, wide empty space between poses (no pose touches another, no overlap between rows).
Row 1, standing idle: facing the viewer | back to the viewer | side view facing RIGHT | facing the viewer and waving with one hand raised.
Row 2, walking mid-stride: facing the viewer | back to the viewer | side view facing right with the left leg forward | side view facing right with the right leg forward.
Row 3: sitting on an invisible chair facing the viewer (knees bent, thighs horizontal, hands forward as if typing) | sitting seen from behind | sitting, side view facing right | lying flat on the back on the floor, horizontal, head on the left, knocked out with X eyes.
Every side view faces RIGHT. Do not draw chairs, furniture, floor or props.

Style: crisp hard-edged pixel art with clearly visible square pixels (the standing character is about 48 art pixels tall), 1-pixel dark outline, limited palette, simple 2-3 tone shading, light from the top-left. No anti-aliasing, no blur, no gradients.
No shadows, no text, no labels, no numbers, no grid lines, no frames, no loose objects (no stars, bubbles or Zzz). Never use magenta.`

const sheet = (bg, who) => `${CHARACTER_STYLE}
Background: perfectly flat solid pure ${bg} over the whole canvas (chroma key), no texture, no gradient.

The character: ${who}`

const GREEN = 'green #00FF00'
const BLUE = 'blue #0000FF'

/** One job per raw file: where it goes, the prompt, and whether the approved boss sheet rides along as the style ruler. */
export const JOBS = {
  'personagens/chefe': {
    prompt: sheet(
      GREEN,
      'the boss, owner of the office: a friendly man with light skin and short brown hair combed to the side, navy-blue suit, white shirt, dark red tie, black shoes.',
    ),
  },
  'personagens/agente-01': {
    ruler: true,
    prompt: sheet(
      GREEN,
      'a woman with light freckled skin and long straight dark-brown hair down to the middle of her back, round glasses, pumpkin-orange cardigan over a white t-shirt, blue jeans, white sneakers.',
    ),
  },
  'personagens/agente-02': {
    ruler: true,
    prompt: sheet(
      BLUE,
      'a man with dark black skin and a big black afro, large black headphones on his head, olive-green long-sleeve shirt, khaki pants, brown shoes.',
    ),
  },
  'personagens/agente-03': {
    ruler: true,
    prompt: sheet(
      GREEN,
      'a woman with brown skin and auburn hair in a high bun, purple blazer over a white blouse, a white ID badge hanging on a blue lanyard, black pants.',
    ),
  },
  'personagens/agente-04': {
    ruler: true,
    prompt: sheet(
      GREEN,
      'a bald man with pinkish light skin and a short full ginger beard, red short-sleeve shirt, dark-gray pants, black shoes.',
    ),
  },
  'personagens/agente-05': {
    ruler: true,
    prompt: sheet(
      GREEN,
      'a woman with black skin and long black braids down to the shoulders, light-blue dress shirt with rolled sleeves, white pants, black flats.',
    ),
  },
  'personagens/agente-06': {
    ruler: true,
    prompt: sheet(
      GREEN,
      'a man with tanned skin and short straight black hair with blunt bangs, square black glasses, graphite-gray sweater over a white collared shirt, black pants.',
    ),
  },
  'personagens/agente-07': {
    ruler: true,
    prompt: sheet(
      GREEN,
      'a man with dark-brown skin, short curly black hair and a mustache, yellow polo shirt, dark jeans, black sneakers.',
    ),
  },
  'personagens/agente-08': {
    ruler: true,
    prompt: sheet(
      BLUE,
      'a woman with light-brown skin and blond hair in a high ponytail, teal hoodie with the hood down, light-gray pants, white sneakers.',
    ),
  },
  'personagens/caveira': {
    ruler: true,
    prompt: `ONE single pixel-art sprite (not a sheet) in the same style and the same height as the standing boss in the attached sheet: a friendly cartoon skeleton (smiling, not scary, no blood) standing and facing the viewer, holding a small short-handled scythe upright beside its body; neither the handle nor the blade goes above the top of the skull. Bones light beige with warm-gray shading, metal-gray blade. 3/4 top-down RPG view, crisp square pixels, 1-pixel dark outline, no anti-aliasing. One figure, centered, square image. Background: perfectly flat solid pure green #00FF00. No shadow, no text, no frame.`,
  },
  'personagens/caveira-cabeca': {
    ruler: true,
    prompt: `ONE single pixel-art sprite in the same style as the attached sheet: just a cartoon skull head with no body, flying, facing the viewer, mischievous grin, eyes glowing violet-purple only inside the eye sockets (no halo, no aura, not magenta). Big simple shapes: it becomes a 24x24 icon. Crisp square pixels, 1-pixel dark outline. One figure, centered, square image. Background: perfectly flat solid pure green #00FF00. No trail, no flames, no particles, no text.`,
  },
}

// ---------- scenery: sheets of objects, sliced by `npm run pixel` with the sheet's .json ----------

const catalog = JSON.parse(readFileSync(new URL('../../src/shared/pixel-catalog.json', import.meta.url), 'utf8'))

export const SCENERY_STYLE = `Pixel-art game asset sheet for a cozy 16-bit office RPG (SNES era), 3/4 top-down camera: seen from the front and above at about 45 degrees, so each object shows its top AND its front face. Front edges perfectly horizontal, sides perfectly vertical: no vanishing point, no isometric rotation, no side faces (except objects I describe as "profile facing right", which are turned to look RIGHT, and "seen from behind").
Crisp hard-edged pixel art with clearly visible square pixels, 1-pixel dark outline around every object and its main parts, limited cheerful palette (honey wood, lilac and purple, lively greens, bluish-gray metal), simple 2-3 tone shading, light from the top-left. No anti-aliasing, no blur, no gradients, no 3D render look. Big readable shapes: every object is later reduced to the small pixel size given, some only 10-20 pixels wide.
Composition: an invisible grid, one object per cell, each object whole and centered in its cell with wide empty space around it; nothing touches a neighbour or the image edge. No floor, rug or wall behind objects, no cast shadows, no contact shadows, no text, letters, numbers, logos, labels, captions, card frames or grid lines (not even on screens, books or boards).
Background: perfectly flat solid pure blue #0000FF over the whole canvas (chroma key), no texture, no gradient.
Magenta rule: where I say a screen or glass is magenta, paint that whole area flat #FF00FF, one tone, no reflection, clean rectangle. Never use magenta anywhere else; use light pink or salmon for pink details.`

/** "1) a sofa … (sprite about 96 x 52 px: 3 tiles wide, 1 deep)" */
function item(n, key) {
  const s = catalog.sprites[key]
  if (!s) throw new Error(`sem ${key} no catálogo`)
  const [tw, td] = s.tiles
  const base = td
    ? `${tw} tile${tw > 1 ? 's' : ''} wide, ${td} deep on the floor`
    : `${tw} tile${tw > 1 ? 's' : ''} wide, hung flat on the back wall, seen straight from the front`
  return `${n}) ${s.label}${s.screen ? ' (the screen/glass area flat magenta #FF00FF)' : ''} — sprite proportion about ${s.w} wide x ${s.h} tall px, ${base}`
}

function sheetJob(cols, rows, keys, extra = '') {
  const list = keys.map((k, i) => (k ? item(i + 1, k) : `${i + 1}) leave this cell empty`)).join('\n')
  return {
    sheet: { grid: [cols, rows], keys },
    prompt: `${SCENERY_STYLE}

Layout: ${cols} columns x ${rows} rows, in reading order (left to right, top to bottom), one object per cell:
${list}
${extra}`.trim(),
  }
}

const tileJob = (key, how) => ({
  prompt: `ONE seamless, tileable pixel-art floor texture for a cozy 16-bit office RPG, seen from straight above: ${catalog.sprites[key].label}. ${how} The pattern fills the WHOLE square image edge to edge and repeats without seams on all four sides. Crisp square pixels, limited palette, simple 2-3 tone shading, no anti-aliasing, no blur, no gradients, no objects, no text, no frame, no border, no perspective.`,
})

Object.assign(JOBS, {
  'folhas/escritorio': sheetJob(4, 2, [
    'moveis/mesa-trabalho',
    'moveis/mesa-chefe',
    'moveis/estante',
    'moveis/arquivo',
    'moveis/impressora',
    'moveis/bebedouro',
    'moveis/cadeira-escritorio-costas',
    'moveis/cadeira-chefe',
  ]),
  'folhas/telas': sheetJob(4, 2, [
    'moveis/monitor',
    'moveis/monitor-costas',
    'moveis/notebook',
    'moveis/luminaria-mesa',
    'moveis/cadeira-simples',
    'moveis/cadeira-simples-lado',
    'moveis/cadeira-simples-costas',
    'moveis/lixeira',
  ]),
  'folhas/plantas': sheetJob(4, 2, [
    'moveis/planta-alta',
    'moveis/planta-arbusto',
    'moveis/planta-samambaia',
    'moveis/planta-flor',
    'moveis/cacto',
    'moveis/luminaria-chao',
    'moveis/puff',
    'moveis/mesa-baixa',
  ]),
  'folhas/sofas': sheetJob(4, 2, [
    'moveis/sofa',
    'moveis/sofa-lado',
    'moveis/poltrona',
    'moveis/poltrona-lado',
    'moveis/mesa-centro',
    'moveis/mesa-redonda',
    'moveis/banqueta',
    'moveis/mesa-bar',
  ]),
  'folhas/lazer': sheetJob(3, 2, [
    'moveis/pebolim',
    'moveis/pingue-pongue',
    'moveis/tv-lounge',
    'moveis/fliperama',
    'moveis/fliperama-costas',
    'moveis/tanque-agua',
  ]),
  'folhas/copa': sheetJob(4, 2, [
    'moveis/bancada',
    'moveis/bancada-lado',
    'moveis/bancada-costas',
    'moveis/geladeira',
    'moveis/geladeira-lado',
    'moveis/geladeira-costas',
    'moveis/micro-ondas',
    'moveis/cafeteira',
  ]),
  'folhas/parede': sheetJob(
    4,
    3,
    [
      'parede/janela',
      'parede/elevador',
      'parede/elevador-aberto',
      'parede/tv-parede',
      'parede/quadro-mondrian',
      'parede/quadro-montanhas',
      'parede/quadro-por-do-sol',
      'parede/quadro-planta',
      'parede/relogio',
      'parede/sirene',
      'moveis/ar-condicionado',
      null,
    ],
    'Cells 2 and 3 are the SAME elevator: closed, then with both doors slid open and the lit cabin inside.',
  ),
  'chao/chao-hall': tileJob('chao/chao-hall', 'Square vinyl plates, 2 x 2 plates across the image, thin darker joints.'),
  'chao/chao-chefe': tileJob('chao/chao-chefe', 'Long planks running left to right, 8 rows of boards across the image, staggered joints.'),
  'chao/chao-time': tileJob('chao/chao-time', 'Low-pile carpet with a faint woven grid, 4 x 4 carpet tiles across the image.'),
  'chao/chao-lounge': tileJob('chao/chao-lounge', 'Light wooden planks running left to right, 8 rows across the image, staggered joints.'),
  'chao/chao-copa': tileJob('chao/chao-copa', 'Checkerboard tiles, exactly 4 x 4 tiles across the image.'),
  'chao/chao-deck': tileJob(
    'chao/chao-deck',
    'Outdoor deck boards running left to right, 8 rows across the image, small gaps between boards.',
  ),
  'chao/parede-fundo': {
    prompt: `ONE pixel-art texture strip for a cozy 16-bit office RPG: the back wall of an office seen straight from the front, filling the WHOLE image edge to edge (image proportion 64 wide x 88 tall), repeating seamlessly left to right. Top three fifths: light lilac painted wall (#aaa6d6-ish) with a subtle texture; then a thin light trim; bottom two fifths: darker lilac wainscot panels (#8f8ac2-ish); at the very bottom a purple baseboard (#5f5a8c-ish). Crisp square pixels, 2-3 tone shading, no anti-aliasing, no objects, no text, no frame.`,
  },
})

// ---------- recolorable people: one template sheet per hair style of the 3D avatar ----------
// Every part is painted in a key hue (3 tones each); the app swaps the hues for the agent's look.

export const TEMPLATE_KEYS = `PALETTE-SWAP TEMPLATE: paint every body part ONLY in its key color family, flat, with exactly 3 tones of the same hue (light, base, dark), so a program can recolor it later:
- skin (face, ears, neck, hands): pure yellow — light #FFFF80, base #FFFF00, dark #B4B400
- hair (and eyebrows): pure green — light #80FF80, base #00FF00, dark #00A000
- shirt / top / sleeves: pure red — light #FF8080, base #FF0000, dark #A00000
- pants: pure blue — light #8080FF, base #0000FF, dark #0000A0
- shoes: pure cyan — light #80FFFF, base #00FFFF, dark #00A0A0
- outline, eyes and mouth: black #000000 (eye shine may be white #FFFFFF)
No other colors at all: no real skin tones, no browns, no grays, no gradients, no anti-aliasing between colors.`

const HAIR = [
  'short hair with a side part',
  'short spiky hair',
  'long straight hair falling past the shoulders',
  'hair tied in a round bun on top of the head',
  'two pigtails, one on each side',
  'a big round curly afro',
]

for (const [i, hair] of HAIR.entries()) {
  JOBS[`personagens/molde-${i}`] = {
    prompt: `${CHARACTER_STYLE.replace('Never use magenta.', '')}
${TEMPLATE_KEYS}
Background: perfectly flat solid pure magenta #FF00FF over the whole canvas (chroma key).

The character: a friendly office worker with ${hair}, long-sleeve shirt, plain pants, simple shoes. Same chibi proportions as a 16-bit RPG hero.`,
  }
}

// ---------- recolorable furniture: the part that changes color per piece in 3D, in key hues ----------

const FURNITURE_KEYS = `PALETTE-SWAP TEMPLATE: the parts I call "color A" are painted ONLY in the red key family and the parts I call "color B" ONLY in the blue key family, flat, 3 tones each (light, base, dark), so a program can recolor them later:
- color A: light #FF8080, base #FF0000, dark #A00000
- color B: light #8080FF, base #0000FF, dark #0000A0
Everything else in muted natural colors (dark gray metal, black wheels, brown wood). Never use any other saturated red, blue, green, yellow, cyan or magenta.`

const COLOR_ITEMS = [
  [
    'moveis/mesa-trabalho',
    'an office desk, 2 tiles wide and 1 deep: the desk top and the drawer fronts in color A; the legs, frame and drawer pedestal body in color B; drawer handles dark gray. Seen from the side where the person sits, desk top empty',
  ],
  [
    'moveis/cadeira-escritorio-costas',
    'a swivel office chair seen from BEHIND: backrest and seat in color A; armrests, post, five-star base and wheels dark gray/black',
  ],
  [
    'moveis/cadeira-simples',
    'a simple wooden chair facing the viewer: brown wooden frame and legs; seat cushion and backrest panel in color A',
  ],
  ['moveis/cadeira-simples-lado', 'the same wooden chair in profile, facing RIGHT: brown wood, seat and backrest in color A'],
  ['moveis/cadeira-simples-costas', 'the same wooden chair seen from BEHIND: brown wood, backrest in color A'],
  [
    'moveis/sofa',
    'a three-seat sofa facing the viewer, 3 tiles wide: all upholstery (cushions, backrest, arms) in color A, small brown wooden feet',
  ],
  [
    'moveis/sofa-lado',
    'a two-seat sofa turned to face RIGHT, pushed against a wall on its left, 2 tiles long from top to bottom of the image: seen from above, the two seat cushions as a tall vertical shape, the backrest along its left side, an armrest at the top end and one at the bottom end; all upholstery in color A',
  ],
  ['moveis/poltrona', 'one upholstered armchair facing the viewer: all upholstery in color A, small brown wooden feet'],
  ['moveis/poltrona-lado', 'the same armchair in profile, facing RIGHT: all upholstery in color A'],
  ['moveis/puff', 'a round bean bag: the whole bag in color A'],
  ['moveis/banqueta', 'a tall bar stool: round seat in color A, thin gray metal legs and footrest ring'],
]

JOBS['folhas/moveis-cor'] = {
  sheet: { grid: [4, 3], keys: [...COLOR_ITEMS.map(([k]) => k), null] },
  prompt: `${SCENERY_STYLE.replace(/Background:[^\n]*\n/, '').replace(/Magenta rule:[^\n]*/, '')}
${FURNITURE_KEYS}
Background: perfectly flat solid pure magenta #FF00FF over the whole canvas (chroma key).

Layout: 4 columns x 3 rows, in reading order (left to right, top to bottom), one object per cell:
${COLOR_ITEMS.map(([, d], i) => `${i + 1}) ${d}`).join('\n')}
12) leave this cell empty`,
}
