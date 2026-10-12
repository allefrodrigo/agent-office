import { app, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { HireRequest } from '@shared/types'
import type { AgentManager } from './agents'
import { log } from './log'

// Dev helpers driven by environment variables: screenshots, key presses, the bench, seeding and forced crashes.

/**
 * Dev helper: AGENT_OFFICE_SHOTS="out/shot:3000,8000" saves screenshots at those
 * times (ms after load) as out/shot-1.png, out/shot-2.png, then quits.
 * AGENT_OFFICE_EVAL runs a snippet in the page before each shot (e.g. to move the camera).
 * An entry `keys:N Enter Alt+Right =texto ;; js` first types real key presses (trusted,
 * with default actions: Enter clicks the focused button, Tab moves the focus), then runs
 * the js after `;;`. `=texto` types text (`_` is a space). Tests the app by keyboard (AO-38).
 */
export function captureShots(w: BrowserWindow, spec: string): void {
  const [prefix, times] = spec.split(':')
  const delays = (times ?? '4000').split(',').map(Number)
  const evals = (process.env.AGENT_OFFICE_EVAL ?? '').split('|||')
  w.webContents.on('console-message', (e) => console.log('[renderer]', e.message))
  w.webContents.once('did-finish-load', () => {
    delays.forEach((ms, i) => {
      setTimeout(async () => {
        let js = evals[i] ?? ''
        if (js.trim().startsWith('keys:')) {
          const [keys, rest] = js.trim().slice(5).split(';;')
          await pressKeys(w, keys)
          js = rest ?? ''
        }
        if (js.trim()) {
          const out = await w.webContents.executeJavaScript(js).catch((e) => `eval failed: ${e}`)
          if (out !== undefined) console.log(`[shot ${i + 1}]`, typeof out === 'string' ? out : JSON.stringify(out))
        }
        await new Promise((r) => setTimeout(r, 400))
        try {
          const img = await w.webContents.capturePage()
          writeFileSync(`${prefix}-${i + 1}.png`, img.toPNG())
        } catch (err) {
          // The window is hidden, so the fatal-error dialog would wait forever: report and quit.
          console.error(`[shot ${i + 1}] falhou:`, err)
          app.exit(1)
          return
        }
        if (i === delays.length - 1) app.quit()
      }, ms)
    })
  })
}

type KeyModifier = 'shift' | 'alt' | 'meta' | 'control'
const KEY_MODIFIERS: Record<string, KeyModifier> = { shift: 'shift', alt: 'alt', meta: 'meta', cmd: 'meta', ctrl: 'control' }

/** Real key presses for AGENT_OFFICE_EVAL `keys:` entries, 120 ms apart. */
async function pressKeys(w: BrowserWindow, spec: string): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const press = (keyCode: string, modifiers: KeyModifier[] = []) => {
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    // Chromium clicks a focused button on Enter's char event (keypress), not on keydown.
    const char = keyCode === 'Enter' ? '\r' : keyCode.length === 1 ? keyCode : null
    if (char && modifiers.every((m) => m === 'shift')) w.webContents.sendInputEvent({ type: 'char', keyCode: char, modifiers })
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  for (const token of spec.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith('=')) {
      for (const ch of token.slice(1).replace(/_/g, ' ')) {
        press(ch)
        await wait(30)
      }
    } else {
      const parts = token.split('+')
      const key = parts.pop()!
      press(key, parts.map((m) => KEY_MODIFIERS[m.toLowerCase()]).filter(Boolean))
    }
    await wait(120)
  }
}

/**
 * Dev helper (`npm run bench`): AGENT_OFFICE_BENCH=out/bench.json waits for the office
 * to fill up, records the frames for AGENT_OFFICE_BENCH_S seconds (30 by default),
 * writes the report there and quits.
 */
export function runBench(w: BrowserWindow, file: string): void {
  const seconds = Number(process.env.AGENT_OFFICE_BENCH_S) || 30
  const warmup = Number(process.env.AGENT_OFFICE_BENCH_WARMUP_S) || 8
  w.webContents.on('console-message', (e) => console.log('[renderer]', e.message))
  w.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const paced = process.env.AGENT_OFFICE_BENCH_LIVE === '1'
        const report = await w.webContents.executeJavaScript(`window.__perf.record(${seconds * 1000}, ${paced})`)
        const gpu = app.getGPUFeatureStatus()
        const out = {
          version: app.getVersion(),
          date: new Date().toISOString(),
          demo: process.env.AGENT_OFFICE_DEMO ?? '',
          paced,
          platform: `${process.platform}-${process.arch}`,
          electron: process.versions.electron,
          gpu,
          window: w.getContentSize(),
          ...report,
        }
        writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
        console.log(`bench: ${out.frames} frames, ${out.frameMs.mean} ms/frame (p95 ${out.frameMs.p95}), ${out.drawCalls.mean} draw calls -> ${file}`)
      } catch (err) {
        console.error('bench failed:', err)
        process.exitCode = 1
      }
      app.quit()
    }, warmup * 1000)
  })
}

/**
 * Dev helper: AGENT_OFFICE_SEED=/path/seed.json hires the agents listed there
 * (an array of HireRequest) at startup, one every 1.5 s so they arrive in a line.
 */
export function seedAgents(manager: AgentManager, file: string): void {
  let list: HireRequest[]
  try {
    list = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    console.error('seed: cannot read', file, err)
    return
  }
  list.forEach((req, i) =>
    setTimeout(() => {
      if (!existsSync(req.cwd)) return console.error('seed: missing folder', req.cwd)
      manager.hire({ ...req, permissionMode: req.permissionMode ?? 'default' }).catch((err) => console.error('seed:', err))
    }, 2500 + i * 1500),
  )
}

/**
 * Dev helper (never in a packaged app): AGENT_OFFICE_CRASH=main|rejection|renderer|hang|page-error
 * breaks something 6 s after start, to check the error handling.
 */
export function forceCrash(w: BrowserWindow, what: string): void {
  setTimeout(() => {
    log.warn(`AGENT_OFFICE_CRASH=${what}: quebrando de propósito`)
    if (what === 'main') throw new Error('Erro de teste no processo principal (AGENT_OFFICE_CRASH=main)')
    if (what === 'rejection') void Promise.reject(new Error('Rejeição de teste (AGENT_OFFICE_CRASH=rejection)'))
    if (what === 'renderer') w.webContents.forcefullyCrashRenderer()
    if (what === 'hang') {
      void w.webContents.executeJavaScript('for (;;) {}')
      // "unresponsive" comes from input the page does not answer: poke it like a mouse would.
      const poke = setInterval(() => (w.isDestroyed() ? clearInterval(poke) : w.webContents.sendInputEvent({ type: 'mouseMove', x: 100, y: 100 })), 500)
      setTimeout(() => clearInterval(poke), 30_000)
    }
    if (what === 'page-error') void w.webContents.executeJavaScript("setTimeout(() => { throw new Error('Erro de teste na janela') }); Promise.reject(new Error('Rejeição de teste na janela')); 1")
  }, 6000)
}
