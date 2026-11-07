// Spike S-3 (descartável): mantém o whisper-server (small) transcrevendo trechos de 20 s sem parar,
// o pior caso para a GPU. PACE_MS=10000 espera entre trechos (ritmo real: 2 faixas de 20 s). Saída só com contagens. Uso: node whisper-loop.mjs <modelo> <pasta-wavs>
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
const [model, dir] = process.argv.slice(2)
const port = await new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const token = randomBytes(32).toString('hex')
const base = `http://127.0.0.1:${port}/${token}`
const child = spawn('/opt/homebrew/bin/whisper-server', ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--request-path', `/${token}`, '-l', 'pt'], { stdio: 'ignore' })
const stop = () => { child.kill('SIGTERM'); process.exit(0) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
for (;;) { try { if ((await fetch(`${base}/`)).ok) break } catch {} await new Promise((r) => setTimeout(r, 100)) }
let n = 0
for (;;) {
  const fd = new FormData()
  fd.append('file', new Blob([readFileSync(`${dir}/c${n % 50}.wav`)], { type: 'audio/wav' }), 'c.wav')
  fd.append('response_format', 'json')
  await (await fetch(`${base}/inference`, { method: 'POST', body: fd })).text()
  if (process.env.PACE_MS) await new Promise((r) => setTimeout(r, Number(process.env.PACE_MS)))
  if (++n % 10 === 0) console.error(`whisper-loop: ${n} trechos`)
}
