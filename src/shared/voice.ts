// Modo voz: the mic beside each Send button records, whisper-cli turns it into text on this machine.

/** What the voice button heard. */
export interface Dictation {
  text: string
  /** The language whisper detected ("pt"), when its log says. */
  lang?: string
  /** The ggml model file ("ggml-small.bin"). */
  model: string
  /** Converting plus transcribing, in ms. */
  ms: number
}

/** A recording stops by itself at this length. */
export const VOICE_MAX_SECONDS = 120
/** Main refuses anything bigger; two minutes of opus stay under 2 MB. */
export const VOICE_MAX_BYTES = 16 * 1024 * 1024
/** After the player spoke, this much quiet ends a clicked recording by itself. */
export const SILENCE_STOP_MS = 3000
/** Nothing said this long after the click: stop without bothering whisper. */
export const NO_SPEECH_MS = 10_000
/** The first moments are the click and the gain settling, not speech. */
export const SETTLE_MS = 300

/**
 * Whether a clicked recording should stop by itself: `heardAt` is the last time the mic
 * went above the speech level (0 = not yet), all times in ms.
 */
export function autoStop(now: number, startedAt: number, heardAt: number): 'silence' | 'nospeech' | null {
  if (heardAt) return now - heardAt >= SILENCE_STOP_MS ? 'silence' : null
  return now - startedAt >= NO_SPEECH_MS ? 'nospeech' : null
}

/**
 * FFT bin edges of `bands` log-spaced bands between `lowHz` and `highHz`: the wave's bars,
 * so each one follows a slice of the voice (low in the middle, high at the ends).
 * Every band gets at least one bin.
 */
export function bandEdges(sampleRate: number, fftSize: number, bands: number, lowHz = 90, highHz = 3200): number[] {
  const hz = sampleRate / fftSize
  const edges: number[] = []
  for (let k = 0; k <= bands; k++) {
    const bin = Math.round((lowHz * (highHz / lowHz) ** (k / bands)) / hz)
    edges.push(k ? Math.max(bin, edges[k - 1] + 1) : bin)
  }
  return edges
}

/**
 * whisper-cli's stdout (run with -nt) as one line of text, and the language from its log.
 * Tags whisper writes for silence or noise ("[BLANK_AUDIO]", "(música)") are dropped.
 */
export function parseWhisper(stdout: string, stderr = ''): { text: string; lang?: string } {
  const text = stdout
    .replace(/\[[^\]\n]*\]/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\([^)]*\)$/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const lang = /auto-detected language:\s*([a-z]{2,3})\b/i.exec(stderr)?.[1]?.toLowerCase()
  return lang ? { text, lang } : { text }
}

/**
 * What a text box holds after a dictation lands in it: the text replaces the selection (or
 * goes at the caret), with a space before it when it would glue onto a word.
 * Returns the new value and where the caret goes.
 */
export function insertDictation(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  const a = Math.max(0, Math.min(start, value.length))
  const b = Math.max(a, Math.min(end, value.length))
  const before = value.slice(0, a)
  const after = value.slice(b)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^[\s.,;:!?)]/.test(after) ? ' ' : ''
  const inserted = lead + text.trim() + trail
  return { value: before + inserted + after, caret: a + inserted.length }
}
