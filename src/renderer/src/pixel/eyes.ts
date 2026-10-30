// Eyes of the recolorable people. `npm run pixel` takes the drawn eyes out of each template and
// records, per sheet cell, the top-left of each eye (molde-N.json "eyes"); here they are drawn back
// as tiny sprites, open or closed, so every look gets the same clean eyes and people can blink.

/** Cell index (row * 4 + col) -> top-left of each eye, in cell pixels. */
export type Eyes = Record<string, [number, number][]>

export const EYE_W = 2
const DARK = '#1d1b26'
const SHINE = '#ffffff'

/** One string per row: D dark, S shine, . nothing. The shine sits on the side away from a mirror. */
const OPEN = ['DS', 'DD', 'DD']
const CLOSED = ['..', 'DD', '..']

/** How long a blink lasts and how often one comes, in seconds. */
const BLINK = 0.14
const BLINK_EVERY = 4.2

/** Whether a person with this seed has the eyes shut at time `t` (seconds); seeds spread the blinks. */
export function blinking(t: number, seed: number): boolean {
  const phase = (seed % 997) / 997
  return (t / BLINK_EVERY + phase) % 1 < BLINK / BLINK_EVERY
}

/**
 * Draws the eyes of one cell onto `ctx`, the cell's top-left at (x, y) and `s` screen pixels per
 * art pixel. `mirror` = the cell is drawn flipped (a person looking left).
 */
export function drawEyes(
  ctx: CanvasRenderingContext2D,
  eyes: Eyes | undefined,
  cell: number,
  x: number,
  y: number,
  s: number,
  { mirror = false, closed = false, cellW = 48 } = {},
): void {
  const spots = eyes?.[cell]
  if (!spots) return
  const rows = closed ? CLOSED : OPEN
  for (const [ex, ey] of spots) {
    const left = mirror ? cellW - ex - EYE_W : ex
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[mirror ? row.length - 1 - i : i]
        if (ch === '.') continue
        ctx.fillStyle = ch === 'S' ? SHINE : DARK
        const px = Math.round(x + (left + i) * s)
        const py = Math.round(y + (ey + j) * s)
        ctx.fillRect(px, py, Math.round(x + (left + i + 1) * s) - px, Math.round(y + (ey + j + 1) * s) - py)
      }
    })
  }
}
