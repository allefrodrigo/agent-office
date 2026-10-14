// Builds the Mac app (npm run dist:mac). Extra arguments go to electron-builder,
// e.g. `npm run dist:mac -- --publish always` or `-- --arm64`.
//
// With a Developer ID in the environment (CSC_LINK or CSC_NAME) it signs with it,
// hardened runtime on, and notarizes when the APPLE_* variables are set too.
// Without one it falls back to an ad-hoc signature with no hardened runtime: the app
// runs on this Mac, but Gatekeeper blocks it elsewhere and the auto-update cannot install.
import { spawnSync } from 'node:child_process'

const signed = Boolean(process.env.CSC_LINK?.trim() || process.env.CSC_NAME?.trim())
const args = ['--mac', ...process.argv.slice(2)]
const env = { ...process.env }
if (!signed) {
  console.log('dist-mac: sem CSC_LINK/CSC_NAME, assinatura ad-hoc (só roda nesta máquina).')
  args.push('-c.mac.identity=-', '-c.mac.hardenedRuntime=false', '-c.mac.notarize=false')
  // The CI passes missing secrets as empty strings; electron-builder would read an empty
  // CSC_LINK as the current folder and fail with "not a file".
  for (const k of ['CSC_LINK', 'CSC_NAME', 'CSC_KEY_PASSWORD']) delete env[k]
}
const r = spawnSync('electron-builder', args, { stdio: 'inherit', env })
process.exit(r.status ?? 1)
