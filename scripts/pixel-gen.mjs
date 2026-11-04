// npm run pixel:gerar: draws the raw 2D art with Codex (its image_gen tool, on your ChatGPT login)
// and saves it in arte-2d/, where `npm run pixel` picks it up. One Codex turn per image, in order.
//   npm run pixel:gerar                          every job whose raw file is still missing
//   npm run pixel:gerar -- personagens/agente-03  only these (redraws even if the file exists)
//   npm run pixel:gerar -- --list                 the jobs and which ones are done
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexBin, drawImage } from './pixel/codex.mjs'
import { JOBS } from './pixel/prompts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const raw = join(root, 'arte-2d')
const RULER = join(raw, 'personagens', 'chefe.png')

const target = (key) => (JOBS[key].sheet ? join(raw, 'folhas', `${key.split('/').pop()}.png`) : join(raw, `${key}.png`))

/** One non-interactive Codex turn; resolves with the image it generated. */
function draw(bin, key) {
  const job = JOBS[key]
  // ruler: true rides with the boss sheet; a key rides with that raw sheet instead
  const ruler = typeof job.ruler === 'string' ? join(raw, `${job.ruler}.png`) : RULER
  return drawImage(bin, job.prompt, job.ruler && key !== 'personagens/chefe' ? [ruler] : [])
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
