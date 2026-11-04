#!/usr/bin/env node
// npm run pet:gerar: draws the art of the modo mini with Codex into arte-2d/pet/ (raw, not in git).
// npm run pet: turns those raw sheets into the sprites in src/renderer/src/assets/pet/.
//   node scripts/pet-art.mjs gerar [molde-1 …]    draws what is missing (or the ones named, again)
//   node scripts/pet-art.mjs processar            slices, reduces and saves every raw sheet found
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexBin, drawImage } from './pixel/codex.mjs'
import { processSceneSheet, processSheet, snapKeyHues } from './pixel/core.mjs'
import { decodePng, encodePng } from './pixel/png.mjs'
import { PET_CHARACTERS, PET_JOBS, PET_PROPS } from './pet/prompts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(root, 'arte-2d', 'pet')
const OUT = join(root, 'src', 'renderer', 'src', 'assets', 'pet')
const rawOf = (key) => join(RAW, `${key}.png`)

async function gerar(names) {
  const bin = codexBin()
  if (!bin) throw new Error('O Codex não está instalado. Instale (npm i -g @openai/codex) e entre com sua conta ChatGPT (codex login).')
  const keys = names.length ? names : Object.keys(PET_JOBS).filter((k) => !existsSync(rawOf(k)))
  const unknown = keys.filter((k) => !PET_JOBS[k])
  if (unknown.length) throw new Error(`Não conheço: ${unknown.join(', ')}. Conheço: ${Object.keys(PET_JOBS).join(', ')}`)
  mkdirSync(RAW, { recursive: true })
  // the ruler first; the rest in parallel, each with its ruler attached
  const first = keys.filter((k) => !PET_JOBS[k].ref)
  const rest = keys.filter((k) => PET_JOBS[k].ref)
  let failed = 0
  const run = async (key) => {
    const t0 = Date.now()
    try {
      const job = PET_JOBS[key]
      const img = await drawImage(bin, job.prompt, job.ref ? [rawOf(job.ref)] : [])
      copyFileSync(img, rawOf(key))
      console.log(`ok    ${key} em ${Math.round((Date.now() - t0) / 1000)} s`)
    } catch (e) {
      failed++
      console.log(`falhou ${key}: ${e instanceof Error ? e.message : e}`)
    }
  }
  for (const k of first) await run(k)
  await Promise.all(rest.map(run))
  if (!keys.length) console.log('Nada a gerar: passe o nome para redesenhar um.')
  return failed
}

function processar() {
  mkdirSync(OUT, { recursive: true })
  let failed = 0
  for (const key of Object.keys(PET_JOBS)) {
    const file = rawOf(key)
    if (!existsSync(file)) {
      console.log(`falta ${key}: rode node scripts/pet-art.mjs gerar ${key}`)
      continue
    }
    try {
      const img = decodePng(readFileSync(file))
      if (key === 'moveis') {
        const { results, warnings } = processSceneSheet(img, PET_PROPS, PET_PROPS.sprites)
        for (const w of warnings) console.log(`      aviso: ${w}`)
        for (const r of results) {
          if (r.error) {
            failed++
            console.log(`falhou moveis/${r.key}: ${r.error}`)
            continue
          }
          writeFileSync(join(OUT, `${r.key.split('/')[1]}.png`), encodePng(r.image))
          console.log(`ok    ${r.key} ${r.image.width}x${r.image.height}`)
          for (const w of r.warnings) console.log(`      aviso: ${w}`)
        }
      } else {
        const result = processSheet(img, PET_CHARACTERS)
        snapKeyHues(result.image)
        writeFileSync(join(OUT, `${key}.png`), encodePng(result.image))
        console.log(`ok    ${key} ${result.image.width}x${result.image.height}, escala ${result.scale.toFixed(3)}`)
        for (const w of result.warnings) console.log(`      aviso: ${w}`)
      }
    } catch (e) {
      failed++
      console.log(`falhou ${key}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return failed
}

const [cmd, ...rest] = process.argv.slice(2)
try {
  const failed = cmd === 'gerar' ? await gerar(rest) : cmd === 'processar' ? processar() : (console.log('Uso: node scripts/pet-art.mjs gerar|processar'), 1)
  process.exit(failed ? 1 : 0)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
