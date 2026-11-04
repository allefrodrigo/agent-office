// Prompts for `npm run pet:gerar`: the side-view art of the modo mini (agents living on the
// bottom of the screen, desktop-pet style). People are recolorable templates in the key hues of
// src/renderer/src/pixel/tint.ts, so every agent keeps the colors of its look.
import { TEMPLATE_KEYS } from '../pixel/prompts.mjs'

/** Sizes the processing step uses (art pixels; the app scales them up whole). */
export const PET_CHARACTERS = {
  cell: [64, 64],
  grid: [4, 3],
  standHeight: 44,
  poses: [
    ['andar-1', 'andar-2', 'andar-3', 'andar-4'],
    ['parado', 'agachado', 'pulo', 'queda'],
    ['digitando-1', 'digitando-2', 'dormindo', 'aceno'],
  ],
}

export const PET_PROPS = {
  grid: [3, 2],
  keys: ['pet/mesa', 'pet/cadeira', 'pet/planta', 'pet/caneca', 'pet/luminaria', 'pet/servidor'],
  sprites: {
    'pet/mesa': { w: 54, h: 36, fit: 'h' },
    'pet/cadeira': { w: 28, h: 38, fit: 'h' },
    'pet/planta': { w: 24, h: 30, fit: 'h' },
    'pet/caneca': { w: 12, h: 10, fit: 'h' },
    'pet/luminaria': { w: 20, h: 54, fit: 'h' },
    'pet/servidor': { w: 18, h: 30, fit: 'h' },
  },
}

const STYLE = `Pixel-art sprite sheet for a cute desktop-pet idle game, pure SIDE VIEW (2D platformer camera, flat profile, no top-down angle), like the tiny cozy characters of desktop idle games that live on the bottom of the screen. Chibi proportions: a big round head about half of the body height, small body, short stubby arms and legs, very cute and readable.
Crisp hard-edged pixel art with clearly visible square pixels (the standing character is about 44 art pixels tall), 1-pixel near-black outline, 5-tone shading, light from the top-left. No anti-aliasing, no blur, no gradients.`

const LAYOUT = `Layout: a clean grid of 4 columns x 3 rows = 12 poses of the SAME character, same scale in every pose (the head is the same size in all 12), feet aligned on each row's baseline, wide empty space between poses (no pose touches another, no overlap between rows). Every pose faces RIGHT, except the last one.
Row 1, walking cycle facing right, 4 consecutive frames: left leg forward heel down | passing (legs together, body slightly up) | right leg forward heel down | passing again; the arms swing opposite to the legs.
Row 2: standing idle facing right, arms relaxed | crouching low ready to jump, knees bent | jumping up in the air, knees tucked, both arms raised up, happy | falling down, legs straight and apart, arms flailing above the head, surprised round mouth.
Row 3: sitting on an invisible chair facing right, thighs horizontal, both hands forward at desk height typing on an invisible keyboard (hands low) | the same sitting pose with the hands a little higher (second typing frame) | sitting on the invisible chair asleep, head drooped forward, eyes closed | standing facing the viewer, smiling, one hand raised high waving.
Do not draw chairs, desks, keyboards, floor, props or shadows. No text, labels, numbers, grid lines, frames or loose objects (no stars, bubbles, Zzz or sweat drops).`

const person = (hair, ref) => `${STYLE}
${LAYOUT}
${TEMPLATE_KEYS}
Background: perfectly flat solid pure magenta #FF00FF over the whole canvas (chroma key), no texture, no gradient.
${ref ? '\nSTYLE REFERENCE: the attached sheet. Match it exactly: same proportions, same pixel size, same face, same 12 poses in the same grid, same key colors. Only the hair changes.\n' : ''}
The character: a friendly office worker with ${hair}, long-sleeve shirt, plain pants, sneakers.`

/** One job per raw file in arte-2d/pet/. `ref` = another raw sheet that rides along as the style ruler. */
export const PET_JOBS = {
  'molde-0': { prompt: person('short messy hair') },
  'molde-1': { ref: 'molde-0', prompt: person('long straight hair falling past the shoulders') },
  'molde-2': { ref: 'molde-0', prompt: person('hair tied in a round bun on top of the head') },
  moveis: {
    ref: 'molde-0',
    prompt: `${STYLE.replace('(the standing character is about 44 art pixels tall)', '(same pixel size as the characters of the attached sheet)')}
Asset sheet: an invisible grid of 3 columns x 2 rows, one object per cell, each whole and centered with wide empty space around it; nothing touches a neighbour or the image edge. Same flat side-view camera as the attached character sheet and to the same scale (the chair seat sits at the knee height of a sitting character).
Row 1: a small cozy wooden work desk seen from the side, with an open laptop on top whose screen faces LEFT (toward a person sitting on the left), the screen glowing light blue | a cute office swivel chair seen from the side, backrest on the LEFT and the seat open to the right, one leg with little wheels | a small potted plant with round green leaves in a terracotta pot.
Row 2: a small white coffee mug with a handle | a thin floor lamp with a warm yellow glowing shade, bent toward the right | a small dark computer tower with tiny green and blue lights.
Cheerful palette (honey wood, warm whites, lively greens, bluish-gray metal). No floor, no rug, no wall, no shadows, no text, letters, logos or labels.
Background: perfectly flat solid pure magenta #FF00FF over the whole canvas (chroma key). Never use magenta or pink anywhere else.`,
  },
}
