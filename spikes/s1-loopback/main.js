// Spike S-1: áudio do sistema no macOS via getDisplayMedia + loopback. Código descartável.
// Logs e relatório só têm números (níveis, contagens, durações), nunca conteúdo de áudio.
const { app, BrowserWindow, session, desktopCapturer, ipcMain, powerSaveBlocker, systemPreferences } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const args = process.argv.slice(2)
const argVal = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=')[1] : undefined
}
const VARIANT = argVal('variant') || process.env.S1_VARIANT || 'a'
const AUTO = args.includes('--auto') || process.env.S1_AUTO === '1'
const SECONDS = Number(argVal('seconds') || process.env.S1_SECONDS || 60)
const SYSTEM_PICKER = process.env.S1_SYSTEM_PICKER === '1'
const SELFTEST = process.env.S1_SELFTEST === '1' // tom gerado na página, sem getDisplayMedia
const HIDE = process.env.S1_HIDE === '1' // testa a janela em segundo plano

// Nomes conferidos com `strings` no Electron Framework do Electron 44.5.1:
// MacLoopbackAudioForScreenShare e MacSckSystemAudioLoopbackOverride NÃO existem;
// existe MacCatapLoopbackAudioForScreenShare (Core Audio tap).
const VARIANTS = {
  a: [],
  b: ['MacLoopbackAudioForScreenShare'],
  c: ['MacSckSystemAudioLoopbackOverride'],
  d: ['MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride', 'MacCatapLoopbackAudioForScreenShare'],
  e: ['MacCatapLoopbackAudioForScreenShare'],
}
const features = VARIANTS[VARIANT]
if (!features) {
  console.error(`variante desconhecida: ${VARIANT} (use a, b, c, d ou e)`)
  process.exit(2)
}
if (features.length) app.commandLine.appendSwitch('enable-features', features.join(','))

const OUT = path.join(__dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })
const TAG = SELFTEST ? `selftest-${VARIANT}` : VARIANT
const pcmPath = path.join(OUT, `system-${TAG}.pcm`)
const wavPath = path.join(OUT, `system-${TAG}.wav`)
const reportPath = path.join(OUT, `report-${TAG}.json`)

const sh = (cmd, ...a) => {
  try { return execFileSync(cmd, a, { encoding: 'utf8' }).trim() } catch { return null }
}

const report = {
  variant: VARIANT,
  enableFeatures: features,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  macos: sh('sw_vers', '-productVersion'),
  macosBuild: sh('sw_vers', '-buildVersion'),
  arch: os.arch(),
  auto: AUTO,
  selftest: SELFTEST,
  hidden: HIDE,
  useSystemPicker: SYSTEM_PICKER,
  plannedSeconds: SECONDS,
  screenAccessStatusBefore: null,
  handlerCalled: false,
  sourcesFound: null,
  handlerError: null,
  getDisplayMedia: null, // { ok, errorName, errorMessage }
  audioTrack: null, // { present, settings, label vazio? }
  chunks: 0,
  samples: 0,
  gaps: [],
  perSecond: [], // { s, rms, peak, chunks }
  totalNonZeroSamples: 0,
  overallPeak: 0,
  trackEnded: false,
  durationMs: 0,
  finishedReason: null,
}

let pcmFd = null
let startedAt = 0
let expectedSeq = 0
let secAcc = { sumSq: 0, peak: 0, n: 0, chunks: 0 }
let blocker = null
let win = null
let finished = false

function writeReport() {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
}

function wavHeader(dataBytes, rate) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(dataBytes, 40)
  return h
}

function flushSecond() {
  if (!secAcc.n) return
  const rms = Math.sqrt(secAcc.sumSq / secAcc.n) / 32768
  const entry = { s: report.perSecond.length + 1, rms: +rms.toFixed(5), peak: +(secAcc.peak / 32768).toFixed(5), chunks: secAcc.chunks }
  report.perSecond.push(entry)
  console.log(`[s1] s=${entry.s} rms=${entry.rms} peak=${entry.peak} chunks=${entry.chunks}`)
  secAcc = { sumSq: 0, peak: 0, n: 0, chunks: 0 }
}

function finish(reason) {
  if (finished) return
  finished = true
  flushSecond()
  report.finishedReason = reason
  report.durationMs = startedAt ? Date.now() - startedAt : 0
  if (pcmFd !== null) {
    fs.closeSync(pcmFd)
    pcmFd = null
    const pcm = fs.readFileSync(pcmPath)
    fs.writeFileSync(wavPath, Buffer.concat([wavHeader(pcm.length, 16000), pcm]))
  }
  if (blocker !== null && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
  if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(true)
  writeReport()
  console.log(`[s1] fim (${reason}): chunks=${report.chunks} gaps=${report.gaps.length} nonZero=${report.totalNonZeroSamples} peak=${report.overallPeak} -> ${reportPath}`)
  if (AUTO) setTimeout(() => app.quit(), 300)
}

ipcMain.handle('s1:config', () => ({ variant: VARIANT, auto: AUTO, seconds: SECONDS, selftest: SELFTEST }))

ipcMain.on('s1:gdm', (_e, info) => {
  report.getDisplayMedia = info.gdm
  report.audioTrack = info.audioTrack
  console.log(`[s1] getDisplayMedia ok=${info.gdm.ok} err=${info.gdm.errorName || '-'} audioTrack=${info.audioTrack ? info.audioTrack.present : '-'}`)
  writeReport()
  if (!info.gdm.ok || !info.audioTrack || !info.audioTrack.present) finish('no-audio-track')
})

ipcMain.on('s1:start', () => {
  startedAt = Date.now()
  pcmFd = fs.openSync(pcmPath, 'w')
  win.webContents.setBackgroundThrottling(false)
  blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (HIDE) win.hide()
})

ipcMain.on('s1:chunk', (_e, { seq, buf }) => {
  if (pcmFd === null || finished) return
  if (seq !== expectedSeq) {
    report.gaps.push({ expected: expectedSeq, got: seq, atMs: Date.now() - startedAt })
    console.log(`[s1] gap expected=${expectedSeq} got=${seq}`)
  }
  expectedSeq = seq + 1
  const b = Buffer.from(buf)
  fs.writeSync(pcmFd, b)
  const s = new Int16Array(b.buffer, b.byteOffset, b.length / 2)
  for (let i = 0; i < s.length; i++) {
    const v = s[i]
    secAcc.sumSq += v * v
    const a = Math.abs(v)
    if (a > secAcc.peak) secAcc.peak = a
    if (a > report.overallPeak) report.overallPeak = a
    if (v !== 0) report.totalNonZeroSamples++
  }
  secAcc.n += s.length
  secAcc.chunks++
  report.chunks++
  report.samples += s.length
  // 10 blocos de 100 ms = 1 s de áudio; a contagem segue o áudio, não o relógio.
  if (secAcc.chunks === 10) flushSecond()
  if (report.samples >= SECONDS * 16000) finish('done')
})

ipcMain.on('s1:ended', () => {
  report.trackEnded = true
  console.log('[s1] faixa de áudio terminou')
  finish('track-ended')
})

// Negar com cb({}) lança "Video was requested, but no video stream was provided" no Electron 44.
function safeCb(cb, v) {
  try { cb(v) } catch (err) { report.callbackError = String(err && err.message).slice(0, 200) }
}

app.whenReady().then(() => {
  report.screenAccessStatusBefore = systemPreferences.getMediaAccessStatus('screen')
  console.log(`[s1] electron=${process.versions.electron} macos=${report.macos} variant=${VARIANT} features=${features.join(',') || '-'} screenAccess=${report.screenAccessStatusBefore}`)

  session.defaultSession.setDisplayMediaRequestHandler(
    (req, cb) => {
      report.handlerCalled = true
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((s) => {
          report.sourcesFound = s.length
          console.log(`[s1] handler: ${s.length} telas`)
          if (!s.length) return safeCb(cb, {})
          safeCb(cb, { video: s[0], audio: 'loopback' })
        })
        .catch((err) => {
          report.handlerError = { type: typeof err, name: err && err.name, message: String(err && err.message !== undefined ? err.message : err).slice(0, 200) }
          console.log(`[s1] getSources falhou: ${report.handlerError.message}`)
          safeCb(cb, {})
        })
    },
    { useSystemPicker: SYSTEM_PICKER },
  )

  win = new BrowserWindow({
    width: 420,
    height: 300,
    title: `S-1 loopback (${VARIANT})`,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  win.loadFile(path.join(__dirname, 'index.html'))
  win.on('closed', () => finish('window-closed'))

  // Rede de segurança só para o modo --auto (prompt de permissão travado etc.).
  if (AUTO) setTimeout(() => finish('timeout'), (SECONDS + 20) * 1000)
})

app.on('window-all-closed', () => app.quit())
