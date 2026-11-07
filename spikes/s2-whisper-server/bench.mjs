// Spike S-2 (descartável): sobe o whisper-server com token, mede a latência de N trechos
// e a memória do processo. Saída só com números; nunca imprime o texto transcrito.
// Uso: node bench.mjs <modelo.bin> <pasta-de-wavs> [n=50] [saida.json]
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, join } from 'node:path'

const [model, dir, nArg, outFile] = process.argv.slice(2)
const n = Number(nArg) || 50

const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
  })

const rssMB = (pid) => Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim()) / 1024)
// footprint inclui memória da GPU (Metal) mapeada no processo; o RSS sozinho subestima.
const footprintMB = (pid) => {
  try {
    const out = execFileSync('footprint', ['-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const m = out.match(/Footprint:\s+([\d.]+)\s*(KB|MB|GB)/)
    if (!m) return null
    const v = Number(m[1])
    return Math.round(m[2] === 'GB' ? v * 1024 : m[2] === 'KB' ? v / 1024 : v)
  } catch {
    return null
  }
}

const token = randomBytes(32).toString('hex')
const port = await freePort()
const base = `http://127.0.0.1:${port}/${token}`
const t0 = performance.now()
const child = spawn(
  '/opt/homebrew/bin/whisper-server',
  ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--request-path', `/${token}`, '-l', 'pt', '-nth', '0.6', '-sns'],
  { stdio: 'ignore' },
)

// pronto quando GET /<token>/ responde
for (;;) {
  try {
    const r = await fetch(`${base}/`)
    if (r.ok) break
  } catch {}
  if (performance.now() - t0 > 30000) throw new Error('servidor não subiu em 30 s')
  await new Promise((r) => setTimeout(r, 100))
}
const startupMs = Math.round(performance.now() - t0)
const idleRss = rssMB(child.pid)

const files = readdirSync(dir).filter((f) => /^c\d+\.wav$/.test(f)).sort((a, b) => Number(a.slice(1, -4)) - Number(b.slice(1, -4))).slice(0, n)
const lat = []
let peakRss = idleRss
let segs = 0
for (const f of files) {
  const fd = new FormData()
  fd.append('file', new Blob([readFileSync(join(dir, f))], { type: 'audio/wav' }), basename(f))
  fd.append('response_format', 'verbose_json')
  fd.append('temperature', '0')
  const s = performance.now()
  const r = await fetch(`${base}/inference`, { method: 'POST', body: fd })
  const body = await r.json()
  lat.push(performance.now() - s)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  segs += (body.segments ?? []).length
  peakRss = Math.max(peakRss, rssMB(child.pid))
}
const footprint = footprintMB(child.pid)
child.kill('SIGTERM')

const sorted = [...lat].sort((a, b) => a - b)
const q = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)])
const report = {
  model: basename(model),
  chunks: lat.length,
  chunkSeconds: 20,
  startupMs,
  latencyMs: { p50: q(0.5), p95: q(0.95), min: Math.round(sorted[0]), max: Math.round(sorted.at(-1)), mean: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) },
  realTimeFactor: Math.round((q(0.5) / 20000) * 1000) / 1000,
  rssMB: { idle: idleRss, peak: peakRss },
  footprintMB: footprint,
  segmentsReturned: segs,
}
console.log(JSON.stringify(report))
if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n')
