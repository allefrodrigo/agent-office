// npm run pixel:gerar: draws the raw 2D art with Codex (its image_gen tool, on your ChatGPT login)
// and saves it in arte-2d/, where `npm run pixel` picks it up. One Codex turn per image, in order.
//   npm run pixel:gerar                          every job whose raw file is still missing
//   npm run pixel:gerar -- personagens/agente-03  only these (redraws even if the file exists)
//   npm run pixel:gerar -- --list                 the jobs and which ones are done
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOBS } from './pixel/prompts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const raw = join(root, 'arte-2d')
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
const RULER = join(raw, 'personagens', 'chefe.png')

const target = (key) => (JOBS[key].sheet ? join(raw, 'folhas', `${key.split('/').pop()}.png`) : join(raw, `${key}.png`))

function codexBin() {
  try {
    return execFileSync(process.platform === 'win32' ? 'where' : 'which', ['codex'], { encoding: 'utf8' })
      .split(/\r?\n/)[0]
      .trim()
  } catch {
    return null
  }
}

/** One non-interactive Codex turn; resolves with the image it generated. */
function draw(bin, key) {
  const job = JOBS[key]
  const cwd = mkdtempSync(join(tmpdir(), 'pixel-gen-'))
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--disable', 'hooks', '-C', cwd]
  // ruler: true rides with the boss sheet; a key rides with that raw sheet instead
  const ruler = typeof job.ruler === 'string' ? join(raw, `${job.ruler}.png`) : RULER
  if (job.ruler && existsSync(ruler) && key !== 'personagens/chefe') args.push('-i', ruler)
  args.push('-')
  const ask = `Use your image generation tool to create exactly ONE image. Do not run shell commands and do not write files; just generate the image and reply "ok".\n\n${job.prompt}`
  return new Promise((done, fail) => {
    const p = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let thread = ''
    let out = ''
    let err = ''
    p.stdout.on('data', (b) => {
      out += b.toString()
      const m = out.match(/"thread_id":"([^"]+)"/)
      if (m) thread = m[1]
    })
    p.stderr.on('data', (b) => (err = (err + b.toString()).slice(-1500)))
    p.on('close', (code) => {
      rmSync(cwd, { recursive: true, force: true })
      const dir = join(codexHome, 'generated_images', thread)
      const images =
        thread && existsSync(dir)
          ? readdirSync(dir)
              .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
              .map((f) => join(dir, f))
          : []
      images.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
      if (images.length) return done(images.at(-1))
      fail(new Error(`o Codex não devolveu imagem (código ${code}). ${err.trim().split('\n').pop() ?? ''}`))
    })
    p.stdin.end(ask)
  })
}

const argv = process.argv.slice(2)
if (argv.includes('--list')) {
  for (const key of Object.keys(JOBS)) console.log(`${existsSync(target(key)) ? '✓' : '·'} ${key}`)
  process.exit(0)
}
const unknown = argv.filter((k) => !JOBS[k])
if (unknown.length) {
  console.error(`Não conheço: ${unknown.join(', ')}. Veja a lista com npm run pixel:gerar -- --list`)
  process.exit(1)
}
const bin = codexBin()
if (!bin) {
  console.error('O Codex não está instalado. Instale (npm i -g @openai/codex) e entre com sua conta ChatGPT (codex login).')
  process.exit(1)
}
// the boss first: the others ride with his sheet as the style ruler
const keys = argv.length ? argv : Object.keys(JOBS).filter((k) => !existsSync(target(k)))
let failed = 0
for (const key of keys) {
  const t0 = Date.now()
  process.stdout.write(`${key} … `)
  try {
    const img = await draw(bin, key)
    mkdirSync(dirname(target(key)), { recursive: true })
    copyFileSync(img, target(key))
    if (JOBS[key].sheet) writeFileSync(target(key).replace(/\.png$/, '.json'), JSON.stringify(JOBS[key].sheet, null, 2) + '\n')
    console.log(`ok em ${Math.round((Date.now() - t0) / 1000)} s → ${target(key).slice(root.length + 1)}`)
  } catch (e) {
    failed++
    console.log(`falhou: ${e instanceof Error ? e.message : e}`)
  }
}
if (!keys.length) console.log('Nada a gerar: todos os brutos já existem. Passe o nome para redesenhar um.')
else console.log(failed ? `${failed} falharam. Rode de novo com os nomes que faltaram.` : 'Pronto. Agora rode npm run pixel.')
process.exit(failed ? 1 : 0)
