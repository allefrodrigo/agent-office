// Configurações → Vídeo (AO-29, AO-32): what the 3D scene may spend per frame.

/** 0 = no cap (the display's refresh rate). */
export type FpsLimit = 0 | 30 | 60
export type ShadowMapSize = 1024 | 2048
/** iso = the 3D isometric office (default); 2d = flat pixel art on a 2D canvas, for weaker computers. */
export type ViewMode = 'iso' | '2d'

export interface VideoSettings {
  shadows: boolean
  shadowMapSize: ShadowMapSize
  fpsLimit: FpsLimit
  /** Sparks, smoke, ghosts and the alarm beacon: full or toned down. */
  effects: 'full' | 'reduced'
  /** On battery the scene switches to Economia by itself, and back on the charger. */
  batterySaver: boolean
  /** How the office is drawn. Changing it reloads the window. Missing = 'iso'. */
  view?: ViewMode
}

export type Quality = 'high' | 'balanced' | 'saver'

type Preset = Omit<VideoSettings, 'batterySaver' | 'view'>

export const QUALITY_PRESETS: Record<Quality, Preset> = {
  high: { shadows: true, shadowMapSize: 2048, fpsLimit: 0, effects: 'full' },
  // 1024 looks the same as 2048 at the pixel-art scale and costs a quarter of the texels
  balanced: { shadows: true, shadowMapSize: 1024, fpsLimit: 60, effects: 'full' },
  saver: { shadows: false, shadowMapSize: 1024, fpsLimit: 30, effects: 'reduced' },
}

export const QUALITY_LABELS: Record<Quality, string> = { high: 'Alta', balanced: 'Equilibrada', saver: 'Economia' }

export const DEFAULT_VIDEO: VideoSettings = { ...QUALITY_PRESETS.balanced, batterySaver: true, view: 'iso' }

/** The preset these settings match, or null when the player mixed them by hand. */
export function qualityOf(v: VideoSettings): Quality | null {
  for (const q of Object.keys(QUALITY_PRESETS) as Quality[]) {
    const p = QUALITY_PRESETS[q]
    // with shadows off their resolution does not matter
    if (p.shadows === v.shadows && (!v.shadows || p.shadowMapSize === v.shadowMapSize) && p.fpsLimit === v.fpsLimit && p.effects === v.effects) return q
  }
  return null
}

/** What the scene uses now: Economia on battery when the player asked for it. */
export function effectiveVideo(v: VideoSettings, onBattery: boolean): VideoSettings & { saving: boolean } {
  // the view stays: switching it needs a reload
  if (v.batterySaver && onBattery) return { ...QUALITY_PRESETS.saver, batterySaver: true, view: v.view, saving: true }
  return { ...v, saving: false }
}

/** Shortest wait between drawn frames, in ms (0 = every animation frame). */
export function frameInterval(o: { fpsLimit: FpsLimit; busy: boolean; focused: boolean; fullSpeed: boolean }): number {
  if (o.fullSpeed) return 0
  let ms = o.fpsLimit ? 1000 / o.fpsLimit : 0
  // nothing moving: a slow tick keeps typing hands and monitors alive
  if (!o.busy) ms = Math.max(ms, 1000 / IDLE_FPS)
  if (!o.focused) ms = Math.max(ms, 1000 / BLUR_FPS)
  return ms
}

/** Drawn frames per second while the office stands still. */
export const IDLE_FPS = 12
/** Drawn frames per second while another app has the focus. */
export const BLUR_FPS = 20
