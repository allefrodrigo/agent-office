// Prompts for `npm run arte:pessoas`: the recolorable people of the 2D view, one sheet per hair
// style of the 3D avatar. All of it is our own design: chibi office workers drawn for this game.

/** The processed sheet: 4 x 3 cells of 64 x 100, the standing figure 76 pixels tall. */
export const PEOPLE_SHEET = {
  cell: [64, 100],
  grid: [4, 3],
  standHeight: 76,
  poses: [
    ['front', 'front-walk-1', 'front-walk-2', 'front-wave'],
    ['back', 'back-walk-1', 'back-walk-2', 'back-sit'],
    ['front-sit', 'down', 'front-talk', 'front-sit-talk'],
  ],
}

const KEYS = `PALETTE-SWAP TEMPLATE: paint every body part ONLY in its key color family, with exactly these 5 tones of the same hue (highlight, light, base, shade, deep shade), so a program can recolor it later:
- skin (face, ears, neck, hands): pure yellow — #FFFF80, #FFFF40, #FFFF00, #C0C000, #808000
- hair (and eyebrows): pure green — #80FF80, #40FF40, #00FF00, #00C000, #008000
- shirt / top / sleeves: pure red — #FF8080, #FF4040, #FF0000, #C00000, #800000
- pants: pure blue — #8080FF, #4040FF, #0000FF, #0000C0, #000080
- shoes: pure cyan — #80FFFF, #40FFFF, #00FFFF, #00C0C0, #008080
- outline: near-black #141414; eyes: black #000000 with a white #FFFFFF shine; mouth: black
No other colors at all: no real skin tones, no browns, no grays besides the outline, no beard, no accessories (no glasses, headphones, badges, ties, jewelry), no gradients, no anti-aliasing between colors.`

const LAYOUT = `Original isometric pixel-art character sprite sheet for "Agent Office", a cozy office management game. The camera looks down at the classic 2:1 isometric angle (about 30 degrees from above), the same for every pose.
Our character design: a friendly chibi office worker, big round head about 2/5 of the body height, large expressive eyes (2 pixels wide, 3 tall, with a white shine), small smile, short rounded body, stubby arms and legs, simple clean shapes. The standing figure is about 76 art pixels tall.

Layout: a clean grid of 4 columns x 3 rows = 12 poses of the SAME character, same scale in every pose (the head is the same size in all 12), feet aligned on each row's baseline, wide empty space between poses (no pose touches another).
"Three-quarter front" = the body turned to face the viewer's LOWER-RIGHT (we see the face, the chest and a bit of the left side). "Three-quarter back" = the body turned to face the viewer's UPPER-RIGHT, away from us (we see the back of the head and the back).
Row 1, three-quarter front: standing idle | walking mid-stride, left leg forward | walking mid-stride, right leg forward | standing, waving with one hand raised high.
Row 2, three-quarter back: standing idle | walking, left leg forward | walking, right leg forward | sitting on an invisible chair, seen from behind.
Row 3: sitting on an invisible chair, three-quarter front (knees bent, thighs level, hands forward as if typing) | lying flat on the back on the floor, horizontal, head on the left, knocked out with X eyes | standing three-quarter front, talking with the mouth open | sitting three-quarter front like cell 1 of this row, talking with the mouth open.
Do not draw chairs, furniture, floor, shadows or props.

Style: crisp hard-edged pixel art with clearly visible square pixels, 1-pixel near-black outline, 5-tone shading, light from the top-left. No anti-aliasing, no blur, no gradients, no text, no labels, no numbers, no grid lines, no frames, no loose objects.`

const MASC = 'a masculine face (slightly squarer jaw, thicker eyebrows)'
const FEM = 'a feminine face (eyelashes drawn as one dark pixel above the outer corner of each eye, softer rounder cheeks, thinner eyebrows)'

/** Hair styles (Look.hairStyle), in order: the first six are the 3D avatar's; the rest come after. Same order as HAIR_STYLE_INFO in src/shared/describe.ts. */
const HAIR = [
  ['short neat hair with a side part', ''],
  ['short spiky hair', ''],
  ['long straight hair falling past the shoulders', ''],
  ['hair tied in a round bun on top of the head', ''],
  ['two pigtails, one on each side of the head', ''],
  ['a big round curly afro', ''],
  ['NO hair at all: a completely bald shiny head (the scalp in the skin key), only the eyebrows in the hair key', MASC],
  ['a very short buzz cut, the hair a thin even layer close to the scalp', MASC],
  ['an undercut with a tall swept-back quiff on top and short sides', MASC],
  ['short tight curls on top, faded short sides', MASC],
  ['shoulder-length dreadlocks', MASC],
  ['a chin-length straight bob with blunt bangs', FEM],
  ['a high ponytail tied at the back of the crown, swinging down to the shoulders', FEM],
  ['two long braids hanging over the shoulders', FEM],
  ['long wavy hair falling past the shoulders with a side part', FEM],
  ['a short pixie cut with a side-swept fringe', FEM],
]

export const PEOPLE_RULER = 'molde-0'

/** `ruler`: the first sheet rides along as the reference, so every hair style shares one body. */
export const PEOPLE_JOBS = Object.fromEntries(
  HAIR.map(([hair, face], i) => [
    `molde-${i}`,
    (ruler) => `${LAYOUT}
${KEYS}
Background: perfectly flat solid pure magenta #FF00FF over the whole canvas (chroma key).
${ruler ? '\nREFERENCE: the attached sheet is an approved sheet of this game. Keep EVERYTHING identical (same body, proportions, pixel size, poses, grid, palette, same face except what the description below says); change ONLY the hair (and the face details named below).\n' : ''}
The character: a friendly office worker with ${hair}${face ? `, ${face}` : ''}, long-sleeve shirt, plain pants, sneakers.`,
  ]),
)

// ---------- the effort aura: flames behind an agent on high, xhigh or max effort ----------

/** 4 animation frames (columns) x 3 strengths (rows: high, xhigh, max), each 120 x 130. */
export const AURA_SHEET = {
  cell: [120, 130],
  grid: [4, 3],
  standHeight: 72,
  poses: [
    ['high-1', 'high-2', 'high-3', 'high-4'],
    ['xhigh-1', 'xhigh-2', 'xhigh-3', 'xhigh-4'],
    ['max-1', 'max-2', 'max-3', 'max-4'],
  ],
}

export const AURA_PROMPT = `Original pixel-art effect sprite sheet for "Agent Office", a cozy isometric office game: a POWER-UP FLAME AURA that burns behind a character when they think very hard (the character itself is NOT drawn).
Each aura is a tall upright oval of rising flame tongues, wider at the bottom, licking upward to pointed tips, with a few small square embers floating above. It stands on the ground: its bottom edge is flat and level.
Layout: a clean grid of 4 columns x 3 rows, wide empty space between cells (nothing touches).
Columns = 4 animation frames of a seamless loop (the tongues flicker and rise, the embers drift up).
Row 1: a calm, small aura (short soft flames). Row 2: a medium aura, taller, more tongues. Row 3: a huge roaring aura, tallest and widest, many sharp tongues and more embers. The bottom of every cell has the same width scale.
Colors: GRAYSCALE ONLY (white, light grays, mid grays), so the game can tint it: the outer rim of each tongue white, the inside mid-gray, a few light-gray highlights. No outline, no black, no color at all.
Style: crisp hard-edged pixel art with clearly visible square pixels, no anti-aliasing, no blur, no gradients, no glow halo.
No text, no labels, no frames, no grid lines, no characters.
Background: perfectly flat solid pure green #00FF00 over the whole canvas (chroma key).`

// ---------- extra poses: playing (foosball, arcade, ping-pong) and lounging ----------

/** 4 x 2 cells of 64 x 100, same scale as the main sheet. */
export const EXTRA_SHEET = {
  cell: [64, 100],
  grid: [4, 2],
  standHeight: 74,
  poses: [
    ['play-front-1', 'play-front-2', 'play-back-1', 'play-back-2'],
    ['relax-front-1', 'relax-front-2', 'type-front-2', 'relax-back'],
  ],
}

const EXTRA_LAYOUT = `Layout: a clean grid of 4 columns x 2 rows = 8 NEW poses of the SAME character as the attached reference sheet, same scale (the head exactly as big as in the reference), feet or seat aligned on each row's baseline, wide empty space between poses.
"Three-quarter front" = turned to face the viewer's LOWER-RIGHT, exactly like row 1 of the reference. "Three-quarter back" = turned to face the viewer's UPPER-RIGHT, away from us, like row 2 of the reference.
Row 1 (playing a table game such as table football, the table NOT drawn): three-quarter front, standing with knees slightly bent, leaning forward a little, both hands forward at hip height gripping invisible rod handles, excited face | the same, next animation frame: hands twisted, body leaning to the other side, mouth open cheering | three-quarter back, the same playing stance seen from behind | three-quarter back, next frame, leaning to the other side.
Row 2: sitting relaxed deep on an invisible sofa, three-quarter front, leaning back, thighs level, lower legs hanging down, hands resting on the lap, content smile | the same relaxed sitting, head tilted, one arm stretched out along the invisible backrest | sitting on an invisible office chair, three-quarter front, hands forward typing, like row 3 cell 1 of the reference but the hands in the next typing position | sitting relaxed on an invisible sofa seen from BEHIND (three-quarter back), leaning back.
Do not draw any furniture, table, chair, sofa, floor, shadow or prop.`

export const EXTRA_JOBS = Object.fromEntries(
  Array.from({ length: HAIR.length }, (_, i) => [
    `molde-${i}-extra`,
    () => `Original isometric pixel-art character sprite sheet for "Agent Office", a cozy office management game, 2:1 isometric camera from above, the same for every pose.
REFERENCE: the attached sheet is this exact character. Keep EVERYTHING identical: body, head, face, hair, proportions, pixel size, outline, palette; only the poses are new.
${EXTRA_LAYOUT}
${KEYS}
Background: perfectly flat solid pure magenta #FF00FF over the whole canvas (chroma key).
Style: crisp hard-edged pixel art, clearly visible square pixels, 1-pixel near-black outline, 5-tone shading, light from the top-left. No anti-aliasing, no blur, no gradients, no text, no labels, no grid lines, no frames.`,
  ]),
)
