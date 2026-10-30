#!/usr/bin/env node
// npm run pixel: turns the raw images in arte-2d/ into the 2D pixel art sprites in
// src/renderer/src/assets/pixel/, sized by src/shared/pixel-catalog.json.
//
//   npm run pixel                                    everything found in arte-2d/
//   npm run pixel -- moveis/sofa personagens/chefe   only these (folhas/<nome> = one scene sheet)
//   npm run pixel -- --check                         what is done, waiting or missing
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractEyes, parseSheetLayout, snapKeyHues, processFloor, processSceneSheet, processSheet, processSprite } from './pixel/core.mjs'
import { decodePng, encodePng, isPng } from './pixel/png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW_DIR = join(ROOT, 'arte-2d')
const OUT_DIR = join(ROOT, 'src', 'renderer', 'src', 'assets', 'pixel')
const GROUPS = ['personagens', 'moveis', 'parede', 'chao']
const SHEETS = 'folhas'
const RAW_EXTS = ['.png', '.jpg', '.jpeg', '.webp']
const AGENT = /^agente-\d{2}$/
/** Recolorable sheets, one per hair style of the 3D avatar: painted in key colors the app swaps for each look. */
const TEMPLATE = /^molde-\d$/

const USAGE = `Gera os sprites do modo 2D a partir das imagens brutas em arte-2d/.

  npm run pixel                                   processa tudo o que houver em arte-2d/
  npm run pixel -- moveis/sofa personagens/chefe  só esses
  npm run pixel -- folhas/<nome>                  só uma folha de cenário
  npm run pixel -- --check                        o que está pronto, o que falta processar e o que falta gerar

Entrada: arte-2d/<grupo>/<chave>.png (grupos: ${GROUPS.join(', ')}), folhas de personagem em
arte-2d/personagens/<nome>.png e folhas de cenário em arte-2d/folhas/<nome>.png + <nome>.json.
Saída: src/renderer/src/assets/pixel/<grupo>/<chave>.png (+ <chave>.json com a tela).`

const catalog = JSON.parse(readFileSync(join(ROOT, 'src', 'shared', 'pixel-catalog.json'), 'utf8'))
const rel = (file) => relative(ROOT, file).split(sep).join('/')
const sheetSize = () => `${catalog.characters.grid[0]}x${catalog.characters.grid[1]}`

/** 'sprite', 'floor' or 'sheet' (character sheet) for a catalog id like moveis/sofa; null when unknown. */
function kindOf(id) {
  const [group, key] = id.split('/')
  if (catalog.sprites[id]) return group === 'chao' ? 'floor' : 'sprite'
  if (group === 'personagens' && (catalog.characters.names.includes(key) || AGENT.test(key) || TEMPLATE.test(key))) return 'sheet'
  return null
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

function unknownKey(id) {
  const known = [...Object.keys(catalog.sprites), ...catalog.characters.names.map((n) => `personagens/${n}`)]
  const [best] = known.map((k) => [k, editDistance(id, k)]).sort((a, b) => a[1] - b[1])
  const hint = best && best[1] <= 3 ? `: quis dizer ${best[0]}?` : ': veja as chaves com npm run pixel -- --check'
  return `${id} não está no catálogo (src/shared/pixel-catalog.json)${hint}`
}

// ---- scanning ----

/** Raw images in `dir`, the newest per key: [{ key, file, mtime }]. */
function listImages(dir, warnings) {
  if (!existsSync(dir)) return []
  const byKey = new Map()
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const file = join(dir, name)
    const stat = statSync(file)
    if (!stat.isFile()) continue
    const ext = extname(name).toLowerCase()
    if (!RAW_EXTS.includes(ext)) {
      if (!(basename(dir) === SHEETS && ext === '.json')) warnings.push(`${rel(file)}: formato não suportado; salve como PNG`)
      continue
    }
    const key = name.slice(0, -ext.length)
    byKey.set(key, [...(byKey.get(key) ?? []), { key, file, mtime: stat.mtimeMs }])
  }
  return [...byKey.values()].map((list) => {
    list.sort((a, b) => b.mtime - a.mtime)
    if (list.length > 1) {
      warnings.push(`${list.map((f) => rel(f.file)).join(' e ')}: usei a mais nova (${basename(list[0].file)}); apague as outras`)
    }
    return list[0]
  })
}

/**
 * What arte-2d/ holds: single images (id -> { id, file, mtime }), scene sheets with their JSON, and
 * for each key listed in a sheet the newest sheet listing it (owner).
 */
function scan() {
  const warnings = []
  const singles = new Map()
  for (const group of GROUPS) {
    for (const { key, file, mtime } of listImages(join(RAW_DIR, group), warnings))
      singles.set(`${group}/${key}`, { id: `${group}/${key}`, file, mtime })
  }
  const sheetDir = join(RAW_DIR, SHEETS)
  const sheets = listImages(sheetDir, warnings).map(({ key, file, mtime }) => {
    const jsonFile = join(sheetDir, `${key}.json`)
    const sheet = { name: key, file, mtime, layout: null, error: null }
    if (!existsSync(jsonFile)) {
      sheet.error = `falta ${rel(jsonFile)} com { "grid": [colunas, linhas], "keys": ["moveis/sofa", null, ...] }`
      return sheet
    }
    sheet.mtime = Math.max(mtime, statSync(jsonFile).mtimeMs)
    try {
      sheet.layout = parseSheetLayout(JSON.parse(readFileSync(jsonFile, 'utf8')))
    } catch (err) {
      sheet.error =
        err instanceof SyntaxError
          ? `${rel(jsonFile)} não é um JSON válido (${err.message}): corrija e rode de novo`
          : `${rel(jsonFile)}: ${err.message}`
    }
    return sheet
  })
  if (existsSync(sheetDir)) {
    for (const name of readdirSync(sheetDir)) {
      if (extname(name) === '.json' && !sheets.some((s) => s.name === basename(name, '.json'))) {
        warnings.push(`${rel(join(sheetDir, name))} não tem a imagem ao lado: salve a folha como ${basename(name, '.json')}.png`)
      }
    }
  }
  const owners = new Map()
  for (const sheet of [...sheets].sort((a, b) => a.mtime - b.mtime))
    for (const id of sheet.layout?.keys ?? []) if (id) owners.set(id, sheet)
  return { singles, sheets, owners, warnings }
}

// ---- IO ----

/** Reads any raw image as RGBA. PNG is decoded here; on macOS anything else goes through sips first. */
function readImage(file) {
  const bytes = readFileSync(file)
  if (isPng(bytes)) {
    try {
      return decodePng(bytes)
    } catch (err) {
      if (err.code !== 'PNG_INTERLACED' || process.platform !== 'darwin') throw err
    }
  } else if (process.platform !== 'darwin') {
    throw new Error(`${basename(file)} não é PNG, e fora do macOS o script só lê PNG: converta para PNG e salve com o mesmo nome`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'pixel-'))
  try {
    const out = join(dir, 'imagem.png')
    try {
      execFileSync('sips', ['-s', 'format', 'png', file, '--out', out], { stdio: 'pipe' })
    } catch {
      throw new Error(`o sips não conseguiu converter ${basename(file)}: abra no Preview e exporte como PNG`)
    }
    return decodePng(readFileSync(out))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function outputFiles(id) {
  const [group, key] = id.split('/')
  const files = [join(OUT_DIR, group, `${key}.png`)]
  if (catalog.sprites[id]?.screen || catalog.sprites[id]?.tint || TEMPLATE.test(key)) files.push(join(OUT_DIR, group, `${key}.json`))
  return files
}

function writeSprite(id, result) {
  const [png, json] = outputFiles(id)
  mkdirSync(dirname(png), { recursive: true })
  writeFileSync(png, encodePng(result.image))
  const meta = {
    ...(result.screen ? { screen: result.screen } : {}),
    ...(result.tint || TEMPLATE.test(id.split('/')[1]) ? { tint: true } : {}),
    ...(result.eyes ? { eyes: result.eyes } : {}),
  }
  if (json && Object.keys(meta).length) writeFileSync(json, `${JSON.stringify(meta)}\n`)
  return png
}

// ---- processing ----

const tally = { ok: 0, failed: 0 }
const warn = (message) => console.log(`aviso ${message}`)
function fail(source, message) {
  tally.failed++
  console.log(`ERRO  ${source}: ${message}`)
}
function ok(source, file, details, warnings) {
  tally.ok++
  console.log(`ok    ${source} → ${rel(file)}  ${details}`)
  for (const w of warnings) console.log(`      aviso: ${w}`)
}

function spriteDetails(id, result) {
  const object = kindOf(id) === 'floor' ? '' : `, objeto ${result.size.join('x')}`
  return `${result.image.width}x${result.image.height}${object}${result.screen ? `, tela ${result.screen.join(',')}` : ''}`
}

function runSingle(raw) {
  const source = rel(raw.file)
  try {
    const img = readImage(raw.file)
    const kind = kindOf(raw.id)
    if (kind === 'sheet') {
      const result = processSheet(img, catalog.characters)
      // templates lose their drawn eyes: the app draws its own, open or blinking (pixel/eyes.ts)
      if (TEMPLATE.test(raw.id.split('/')[1])) snapKeyHues(result.image)
      const eyeSpec = catalog.characters.eyes?.[raw.id.split('/')[1]]
      if (eyeSpec) result.eyes = extractEyes(result.image, catalog.characters, eyeSpec)
      const poses = catalog.characters.poses.flat().length
      const details = `${result.image.width}x${result.image.height}, ${poses} poses, escala ${result.scale.toFixed(3).replace('.', ',')}`
      ok(source, writeSprite(raw.id, result), details, result.warnings)
    } else {
      const spec = catalog.sprites[raw.id]
      const result = kind === 'floor' ? processFloor(img, spec) : processSprite(img, spec)
      ok(source, writeSprite(raw.id, result), spriteDetails(raw.id, result), result.warnings)
    }
  } catch (err) {
    fail(source, err.message)
  }
}

/** Processes the cells of one scene sheet; `wanted` = only these ids (null = all its keys). */
function runSheet(sheet, wanted, { singles, owners }) {
  const source = rel(sheet.file)
  if (sheet.error) return fail(source, sheet.error)
  const only = new Set()
  sheet.layout.keys.forEach((id, i) => {
    if (!id || (wanted && !wanted.has(id))) return
    const cell = `célula ${i + 1}`
    const kind = kindOf(id)
    if (kind === 'sheet')
      warn(`${source}, ${cell}: ${id} é folha de personagem ${sheetSize()}, não entra em folha de cenário; salve como arte-2d/${id}.png`)
    else if (!kind) warn(`${source}, ${cell}: ${unknownKey(id)}; pulei`)
    else if (singles.has(id)) warn(`${source}, ${cell}: ${id} tem imagem avulsa (${rel(singles.get(id).file)}), que ganha da folha; pulei`)
    else if (owners.get(id) !== sheet) warn(`${source}, ${cell}: ${id} também está em ${rel(owners.get(id).file)}, mais nova; pulei`)
    else only.add(id)
  })
  if (!only.size) return
  let out
  try {
    out = processSceneSheet(readImage(sheet.file), sheet.layout, catalog.sprites, { only })
  } catch (err) {
    return fail(source, err.message)
  }
  for (const w of out.warnings) warn(`${source}: ${w}`)
  for (const r of out.results) {
    const label = `${source} ${r.where} ${r.key}`
    if ('error' in r) fail(label, r.error)
    else ok(label, writeSprite(r.key, r), spriteDetails(r.key, r), r.warnings)
  }
}

function normalizeTarget(arg) {
  const t = arg
    .replace(/\\/g, '/')
    .replace(/^(\.\/)?arte-2d\//, '')
    .replace(/\.(png|jpe?g|webp|json)$/i, '')
  return /^[^/]+\/[^/]+$/.test(t) ? t : null
}

function run(targets) {
  const state = scan()
  state.warnings.forEach(warn)
  const singleIds = new Set()
  const sheetJobs = new Map() // sheet name -> Set of ids, or null for the whole sheet
  if (!targets.length) {
    for (const [id, raw] of state.singles) {
      if (kindOf(id)) singleIds.add(id)
      else warn(`${rel(raw.file)}: ${unknownKey(id)}; pulei`)
    }
    for (const sheet of state.sheets) sheetJobs.set(sheet.name, null)
  }
  for (const arg of targets) {
    const id = normalizeTarget(arg)
    if (!id) {
      warn(`${arg}: use grupo/chave (ex.: moveis/sofa) ou folhas/<nome>; pulei`)
      continue
    }
    const [group, key] = id.split('/')
    if (group === SHEETS) {
      if (state.sheets.some((s) => s.name === key)) sheetJobs.set(key, null)
      else fail(id, `não achei arte-2d/folhas/${key}.png: salve a folha lá, com o ${key}.json ao lado`)
    } else if (!kindOf(id)) warn(`${unknownKey(id)}; pulei`)
    else if (state.singles.has(id)) singleIds.add(id)
    else if (kindOf(id) !== 'sheet' && state.owners.has(id)) {
      const name = state.owners.get(id).name
      const ids = sheetJobs.get(name)
      if (ids !== null) sheetJobs.set(name, (ids ?? new Set()).add(id))
    } else fail(id, `não achei arte-2d/${id}.png (nem .jpg, .jpeg ou .webp) nem folha com essa chave: salve a imagem bruta e rode de novo`)
  }
  if (!singleIds.size && !sheetJobs.size) {
    if (!tally.failed) {
      console.log(
        'Nada para processar: salve as imagens brutas em arte-2d/<grupo>/<chave>.png ou as folhas em arte-2d/folhas/ (veja o que falta com npm run pixel -- --check).',
      )
    }
  } else {
    for (const id of singleIds) runSingle(state.singles.get(id))
    for (const [name, ids] of sheetJobs)
      runSheet(
        state.sheets.find((s) => s.name === name),
        ids,
        state,
      )
    const made = `${tally.ok} ${tally.ok === 1 ? 'sprite gerado' : 'sprites gerados'}`
    const failed = tally.failed ? `, ${tally.failed} com erro: corrija e rode de novo só esses (npm run pixel -- grupo/chave)` : ''
    console.log(`\n${made}${failed}.`)
  }
  process.exitCode = tally.failed ? 1 : 0
}

// ---- --check ----

function outputTime(id) {
  const files = outputFiles(id)
  return files.every((f) => existsSync(f)) ? Math.min(...files.map((f) => statSync(f).mtimeMs)) : null
}

function groupIds(group) {
  const ids = Object.keys(catalog.sprites).filter((id) => id.startsWith(`${group}/`))
  if (group !== 'personagens') return ids
  const extra = new Set()
  for (const dir of [join(RAW_DIR, group), join(OUT_DIR, group)]) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const key = name.replace(/\.[^.]+$/, '')
      if (AGENT.test(key) && !catalog.characters.names.includes(key)) extra.add(key)
    }
  }
  return [...catalog.characters.names, ...[...extra].sort()].map((n) => `personagens/${n}`).concat(ids)
}

function check() {
  const state = scan()
  state.warnings.forEach(warn)
  const totals = { done: 0, fromSheets: 0, pending: 0, missing: 0 }
  for (const group of GROUPS) {
    const ids = groupIds(group)
    const done = []
    const fromSheets = []
    const pending = []
    const missing = new Map()
    for (const id of ids) {
      const key = id.split('/')[1]
      const single = state.singles.get(id)
      const sheet = kindOf(id) === 'sheet' ? undefined : state.owners.get(id)
      const source = single ?? sheet
      const outTime = outputTime(id)
      if (source && (outTime === null || source.mtime > outTime)) pending.push(single ? key : `${key} (folha ${sheet.name})`)
      else if (outTime !== null) (single || !sheet ? done : fromSheets).push(key)
      else {
        const label = kindOf(id) === 'sheet' ? `folhas ${sheetSize()}` : `prio ${catalog.sprites[id].prio ?? 2}`
        missing.set(label, [...(missing.get(label) ?? []), key])
      }
    }
    const ready = done.length + fromSheets.length
    console.log(`${group}: ${ready} de ${ids.length} prontos${fromSheets.length ? ` (${fromSheets.length} de folhas)` : ''}`)
    if (done.length) console.log(`  prontos: ${done.join(', ')}`)
    if (fromSheets.length) console.log(`  prontos de folhas: ${fromSheets.join(', ')}`)
    if (pending.length) console.log(`  para processar (npm run pixel): ${pending.join(', ')}`)
    for (const label of [...missing.keys()].sort()) console.log(`  falta gerar, ${label}: ${missing.get(label).join(', ')}`)
    totals.done += ready
    totals.fromSheets += fromSheets.length
    totals.pending += pending.length
    totals.missing += [...missing.values()].reduce((n, list) => n + list.length, 0)
  }
  if (state.sheets.length) {
    console.log(`folhas de cenário: ${state.sheets.length}`)
    for (const sheet of state.sheets) {
      if (sheet.error) {
        console.log(`  ${sheet.name}: ERRO ${sheet.error}`)
        continue
      }
      const keys = sheet.layout.keys.filter(Boolean)
      const beaten = keys.filter((id) => state.singles.has(id))
      const elsewhere = keys.filter((id) => !state.singles.has(id) && state.owners.get(id) !== sheet)
      const notes = [
        beaten.length ? `avulsas ganham: ${beaten.join(', ')}` : '',
        elsewhere.length ? `em folha mais nova: ${elsewhere.join(', ')}` : '',
        keys.filter((id) => !kindOf(id) || kindOf(id) === 'sheet').length ? 'tem chaves fora do catálogo' : '',
      ].filter(Boolean)
      console.log(
        `  ${sheet.name}: grade ${sheet.layout.grid.join('x')}, ${keys.length} chaves${notes.length ? ` (${notes.join('; ')})` : ''}`,
      )
    }
  }
  const unknown = [...state.singles.values()].filter((raw) => !kindOf(raw.id))
  for (const raw of unknown) warn(`${rel(raw.file)}: ${unknownKey(raw.id)}`)
  console.log(
    `\nTotal: ${totals.done} prontos (${totals.fromSheets} de folhas), ${totals.pending} para processar, ${totals.missing} faltam gerar.`,
  )
}

// ---- main ----

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE)
} else {
  for (const arg of args) if (arg.startsWith('-') && arg !== '--check') warn(`opção desconhecida: ${arg} (use --check ou --help)`)
  if (args.includes('--check')) check()
  else run(args.filter((a) => !a.startsWith('-')))
}
