// Generates resources/background.tiff (1x + 2x), the backdrop of the macOS .dmg installer.
// Run: npm run dmg-bg  (needs resources/dmg-screenshot.jpg; refresh it with AGENT_OFFICE_SHOTS, see README)
// Icon positions here must match dmg.contents in electron-builder.yml.
import { app, BrowserWindow, screen } from 'electron'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Finder on recent macOS applies the user's own path/status/tab bars and ignores
// the .dmg asking to hide them; they eat ~130 pt. So everything sits in the top
// ~450 pt, and the image runs taller than the window for when the bars are off.
const W = 720
const H = 600
const SHOT_W = 360
const APP = { x: 200, y: 380 }
const APPLICATIONS = { x: 520, y: 380 }

const res = new URL('../resources/', import.meta.url).pathname
const shot = readFileSync(join(res, 'dmg-screenshot.jpg')).toString('base64')

// pixel-art arrow, 4px cells: shaft + head
const cells = []
for (let x = 0; x < 11; x++) cells.push([x, 3], [x, 4])
for (let i = 0; i < 4; i++) for (let y = i; y < 8 - i; y++) cells.push([11 + i, y])
const arrow = cells.map(([x, y]) => `<rect x="${x * 4}" y="${y * 4}" width="4" height="4"/>`).join('')

const html = `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    position: relative;
    font-family: -apple-system, 'SF Pro Text', sans-serif;
    color: #eceaf6;
    background:
      radial-gradient(520px 260px at 50% 0%, rgba(217, 119, 87, 0.22), transparent 70%),
      radial-gradient(600px 300px at 50% 100%, rgba(91, 156, 240, 0.10), transparent 70%),
      #1c1d2e;
  }
  /* faint pixel grid, a nod to the office floor */
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .head { position: absolute; top: 20px; width: 100%; text-align: center; }
  .title { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .title span { color: #d97757; margin-right: 6px; }
  .sub { margin-top: 3px; font-size: 12px; color: #9c9ab5; }
  .window {
    position: absolute;
    left: ${(W - SHOT_W) / 2}px;
    top: 74px;
    width: ${SHOT_W}px;
    border-radius: 10px;
    overflow: hidden;
    background: #11121d;
    box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 24px 60px rgba(5,5,15,.6), 0 4px 14px rgba(5,5,15,.4);
  }
  .bar { height: 20px; display: flex; gap: 6px; align-items: center; padding-left: 9px; background: #232438; }
  .bar i { width: 8px; height: 8px; border-radius: 50%; }
  .window img { display: block; width: 100%; }
  /* fade the screenshot's bottom into the backdrop so the icons own that space */
  .window::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 60px;
    background: linear-gradient(transparent, #1c1d2e);
  }
  .arrow { position: absolute; left: ${(APP.x + APPLICATIONS.x) / 2 - 32}px; top: ${APP.y - 16}px; fill: #d97757; }
  .hint { position: absolute; top: ${APP.y + 26}px; width: 100%; text-align: center; font-size: 11px; color: #6f6d8a; }
</style></head><body>
  <div class="head">
    <div class="title"><span>✳</span>Agent Office</div>
    <div class="sub">O escritório dos seus agentes do Claude Code</div>
  </div>
  <div class="window">
    <div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <img src="data:image/jpeg;base64,${shot}">
  </div>
  <svg class="arrow" width="64" height="32" viewBox="0 0 64 32">${arrow}</svg>
  <div class="hint">arraste para instalar</div>
</body></html>`

/** Renders at 2x (zoom on a 1x screen, native on Retina) and scales to `scale`. */
async function render(win, scale) {
  const zoom = 2 / screen.getPrimaryDisplay().scaleFactor
  win.setContentSize(W * zoom, H * zoom)
  win.webContents.setZoomFactor(zoom)
  await new Promise((r) => setTimeout(r, 300))
  const img = await win.webContents.capturePage()
  return img.resize({ width: W * scale, height: H * scale, quality: 'best' }).toPNG()
}

app.dock?.hide()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, useContentSize: true, width: W, height: H, paintWhenInitiallyHidden: true, enableLargerThanScreen: true })
  const page = join(tmpdir(), 'agent-office-dmg-bg.html')
  writeFileSync(page, html)
  await win.loadFile(page)
  const one = join(tmpdir(), 'dmg-bg.png')
  const two = join(tmpdir(), 'dmg-bg@2x.png')
  writeFileSync(one, await render(win, 1))
  writeFileSync(two, await render(win, 2))
  // One TIFF holding both resolutions: Finder picks the sharp one on Retina screens.
  execFileSync('tiffutil', ['-cathidpicheck', one, two, '-out', join(res, 'background.tiff')])
  for (const f of [page, one, two]) rmSync(f)
  app.quit()
})
