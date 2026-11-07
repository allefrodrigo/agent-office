// Builds the meeting room's system audio helper (npm run native; dist:mac runs it too):
// native/system-audio/tap.swift → resources/bin/system-audio-tap, a universal binary
// (arm64 + x86_64) with Info.plist embedded, signed ad hoc. electron-builder copies it into
// Contents/Resources/bin (extraResources) and signs it again with the app's identity.
//
// Needs only the Command Line Tools (swiftc, lipo, codesign), no Xcode. On other systems it
// does nothing: the helper is macOS only. Skips the build when the binary is newer than the
// sources; --force rebuilds anyway.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'native', 'system-audio', 'tap.swift')
const plist = join(root, 'native', 'system-audio', 'Info.plist')
const out = join(root, 'resources', 'bin', 'system-audio-tap')
const MIN_MACOS = '14.2'
const ARCHS = ['arm64', 'x86_64']

if (process.platform !== 'darwin') {
  console.log('build-system-audio: só no macOS; nada a fazer.')
  process.exit(0)
}

const mtime = (p) => statSync(p).mtimeMs
if (!process.argv.includes('--force') && existsSync(out) && mtime(out) > Math.max(mtime(src), mtime(plist))) {
  console.log('build-system-audio: resources/bin/system-audio-tap já está em dia.')
  process.exit(0)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.error || r.status !== 0) {
    const why = r.error?.code === 'ENOENT' ? `${cmd} não encontrado. Instale as Command Line Tools com "xcode-select --install".` : `${cmd} saiu com ${r.status}.`
    console.error(`build-system-audio: ${why}`)
    process.exit(1)
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'system-audio-'))
try {
  const slices = ARCHS.map((arch) => {
    const slice = join(tmp, `tap-${arch}`)
    // Swift 5 mode: the helper keeps its state in globals touched only on one serial queue.
    run('/usr/bin/xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', `${arch}-apple-macos${MIN_MACOS}`, src, '-o', slice,
      '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist])
    return slice
  })
  mkdirSync(dirname(out), { recursive: true })
  run('/usr/bin/xcrun', ['lipo', '-create', ...slices, '-output', out])
  // Ad hoc, so it runs in dev; the packaged copy is signed again by electron-builder.
  run('/usr/bin/codesign', ['--force', '--sign', '-', out])
  console.log(`build-system-audio: ${out} (${ARCHS.join(' + ')}, macOS ${MIN_MACOS}+, ${Math.round(statSync(out).size / 1024)} KB)`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
