import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * Window frame per platform (ADR-run-3). Type-only import of electron, so
 * `npm test` runs it without Electron.
 */

export type FrameOptions = Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'trafficLightPosition' | 'titleBarOverlay'>

/** Windows title bar overlay: office background, light symbols, 32 px (ux-spec §3). */
export const TITLE_BAR = { color: '#1b1d2b', symbolColor: '#e6e6f0', height: 32 } as const

/**
 * darwin: hiddenInset with the traffic lights at (16, 18), as in v0.2.0.
 * win32: hidden title bar with native caption buttons drawn over the page (TITLE_BAR);
 * the renderer keeps a drag strip and the HUD below it via `.platform-win32` CSS.
 * Others (Linux): {} — the default frame.
 */
export function windowFrame(platform: NodeJS.Platform): FrameOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
  if (platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: { ...TITLE_BAR } }
  return {}
}
