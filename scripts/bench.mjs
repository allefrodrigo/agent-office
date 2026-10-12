// npm run bench: opens the stress demo (50 agents, 4 floors) in a hidden window,
// records 30 s of frames and writes out/bench.json, to compare versions.
// Runs on a throwaway data folder, never on your office.json.
// AGENT_OFFICE_BENCH_S sets the seconds; AGENT_OFFICE_BENCH_OUT the report path.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, process.env.AGENT_OFFICE_BENCH_OUT ?? 'out/bench.json')
const data = mkdtempSync(join(tmpdir(), 'agent-office-bench-'))

const env = { ...process.env, AGENT_OFFICE_DATA_DIR: data, AGENT_OFFICE_DEMO: 'stress', AGENT_OFFICE_BENCH: out }
// the built bundle, not a dev server
delete env.ELECTRON_RENDERER_URL

const child = spawn(electron, [root], { cwd: root, stdio: 'inherit', env })
child.on('exit', (code) => {
  rmSync(data, { recursive: true, force: true })
  process.exit(code ?? 1)
})
