// Opens the office in demo mode (`npm run demo`) from PowerShell, CMD or zsh.
// Sets AGENT_OFFICE_DEMO=1 for the child only and runs electron-vite's own bin
// with this Node, without a shell. Extra arguments go to `electron-vite dev`.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

let pkgPath
try {
  // electron-vite exports ./package.json but not its bin/ folder, so read bin from there.
  pkgPath = require.resolve('electron-vite/package.json')
} catch {
  console.error('Não encontrei o electron-vite. Rode npm install e tente de novo.')
  process.exit(1)
}

const pkg = require(pkgPath)
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['electron-vite']
if (!bin) {
  console.error('O pacote electron-vite não declara o executável. Rode npm install e tente de novo.')
  process.exit(1)
}

const child = spawn(process.execPath, [join(dirname(pkgPath), bin), 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, AGENT_OFFICE_DEMO: '1' },
})
child.on('error', (err) => {
  console.error('Não consegui abrir o modo demo:', err.message)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
