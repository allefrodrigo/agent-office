#!/usr/bin/env node
/**
 * Contraste dos textos do HUD (AO-38): lê as cores de verdade dos estilos (styles/), compõe os
 * fundos translúcidos (cartão sobre o mundo) e calcula a razão WCAG 2.x de cada par.
 *
 *   node scripts/contrast.mjs          tabela com todos os pares
 *   node scripts/contrast.mjs --check  sai com erro se algum ficar abaixo de AA (4,5:1)
 *
 * O mundo atrás dos cartões é a cena 3D: varia. Para fundos translúcidos o script usa o
 * pior caso, o mundo branco; para o texto solto sobre a cena (marca e estatísticas no
 * topo), a cor clara do gradiente do #world, já que lá a sombra do texto ajuda.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/src/styles')

/** styles/index.css with its `@import`s inlined, in cascade order. */
function readStyles(file) {
  return readFileSync(join(CSS_DIR, file), 'utf8').replace(/@import '\.\/([\w-]+\.css)';/g, (_, f) => readStyles(f))
}
const AA = 4.5

/** Rules as [selectors[], declarations{}], in file order, ignoring @media bodies' nesting. */
function parseRules(css) {
  const rules = []
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(clean))) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
    const decls = {}
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':')
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim().replace(/\s*!important$/, '')
    }
    rules.push([selectors, decls])
  }
  return rules
}

const rules = parseRules(readStyles('index.css'))
const vars = Object.fromEntries(rules.filter(([s]) => s.includes(':root')).flatMap(([, d]) => Object.entries(d).filter(([k]) => k.startsWith('--'))))

/** The last value a selector sets for a property (later rules win, like the cascade). */
function prop(selector, name) {
  let v
  for (const [sels, decls] of rules) if (sels.includes(selector) && decls[name] !== undefined) v = decls[name]
  if (v === undefined) throw new Error(`${selector} não define ${name} nos estilos (styles/)`)
  return v
}

function resolve(v) {
  for (let i = 0; i < 5 && v.includes('var('); i++) v = v.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, n, fb) => vars[n] ?? fb ?? '')
  return v.trim()
}

/** '#abc', '#aabbcc', 'rgb(…)', 'rgba(…)' or a few names → [r, g, b, a]. */
function parseColor(raw) {
  const v = resolve(raw).toLowerCase()
  if (v === '#fff' || v === 'white') return [255, 255, 255, 1]
  if (v === 'transparent' || v === 'none') return [0, 0, 0, 0]
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (m) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1)
  }
  m = /^rgba?\(([^)]+)\)$/.exec(v)
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return [p[0], p[1], p[2], p[3] ?? 1]
  }
  throw new Error(`cor que o script não entende: ${raw}`)
}

/** Paints `top` (with alpha) over an opaque `under`. */
function over(top, under) {
  const a = top[3]
  return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1)
}

function luminance([r, g, b]) {
  const ch = (c) => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

export function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

// ---------- fundos ----------

const WHITE = [255, 255, 255, 1]
const WORLD = parseColor('#2a2b45') // centro do gradiente do #world (styles/base.css)
const css = (selector, name = 'background') => parseColor(prop(selector, name))
/** A stack of layers, bottom first, flattened to one opaque color. */
const stack = (...layers) => layers.reduce((under, top) => over(top, under))

const CARD = stack(WHITE, css('.card'))
const INFO = stack(WHITE, css('.info'))
const BG = {
  card: CARD,
  'card + linha pendente': stack(CARD, css('.roster-row.has-pending')),
  'card + hover': stack(CARD, css('.roster-row:hover')),
  info: INFO,
  'info + chip': stack(INFO, css('.info-chip')),
  'info + chip cheio': stack(INFO, css('.info-chip.ctx-full')),
  'info + led': stack(INFO, css('.info-led')),
  toast: stack(WHITE, css('.toast')),
  mundo: WORLD,
  'mundo + versão': stack(WORLD, css('.brand-version')),
  'card + andar atual': stack(CARD, css('.floor-btn.on')),
}

/** [what, text selector, background name or [selector, prop] over a named background]. */
const PAIRS = [
  ['Estatísticas no topo', '.brand-stats', 'mundo'],
  ['Versão', '.brand-version', 'mundo + versão'],
  ['Contagem de agentes', '.roster-count', 'card'],
  ['Atividade do agente', '.roster-activity', 'card'],
  ['Atividade (linha pendente)', '.roster-activity', 'card + linha pendente'],
  ['Custo do agente', '.roster-cost', 'card'],
  ['Chip', '.chip', ['.chip', 'card']],
  ['Chip terminal', '.chip-term', ['.chip-term', 'card']],
  ['Chip ajudantes', '.chip-helpers', ['.chip-helpers', 'card']],
  ['Chip esperando', '.chip-wait', ['.chip-wait', 'card']],
  ['Chip resultado', '.chip-done', ['.chip-done', 'card']],
  ['Chip erro', '.chip-err', ['.chip-err', 'card']],
  ['Chip ticket', '.chip-ticket', ['.chip-ticket', 'card']],
  ['Badge pendente', '.badge', ['.badge', 'card']],
  ['Badge revisão', '.badge-review', ['.badge-review', 'card']],
  ['Botão de ícone', '.icon-btn', 'card'],
  ['Botão do dock', '.dock-btn', 'card'],
  ['Botão do dock ligado', '.dock-btn.on', 'card'],
  ['Botão do dock pulsando', '.dock-btn.pulse', 'card'],
  ['Novo agente', '.dock-primary', ['.dock-primary', 'card']],
  ['Novo agente (hover)', '.dock-primary', ['.dock-primary:hover', 'card']],
  ['Botão principal', '.btn-primary', ['.btn-primary', 'card']],
  ['Botão principal (hover)', '.btn-primary', ['.btn-primary:hover', 'card']],
  ['Zoom', '.zoom button', 'card'],
  ['Caixa: texto', '.inbox-text', 'card'],
  ['Caixa: hora', '.inbox-time', 'card'],
  ['Caixa: vazia', '.inbox-empty', 'card'],
  ['Toast', 'body', 'toast'],
  ['Limites: faixa', '.info-strip', 'info'],
  ['Limites: chip', '.info-chip', 'info + chip'],
  ['Limites: chip alerta', '.info-chip.ctx-warn', 'info + chip'],
  ['Limites: chip cheio', '.info-chip.ctx-full', 'info + chip cheio'],
  ['Limites: desatualizado', '.info-stale', ['.info-stale', 'info']],
  ['Limites: led ok', '.info-led', 'info + led'],
  ['Limites: led alerta', '.info-led.ctx-warn', 'info + led'],
  ['Limites: led cheio', '.info-led.ctx-full', 'info + led'],
  ['Limites: título', '.info-head', 'info'],
  ['Limites: cabeçalho da tabela', '.info-table th', 'info'],
  ['Limites: renovação', '.info-table small', 'info'],
  ['Limites: agentes na conta', '.info-agents', ['.info-agents', 'info']],
  ['Limites: sem login', '.info-flag', ['.info-flag', 'info']],
  ['Limites: zero', '.info-zero', 'info'],
  ['Sistema: rótulo', '.info-sys-k', 'info'],
  ['Sistema: processos', '.info-procs', 'info'],
  ['Sistema: números', '.info-procs b', 'info'],
  ['Porcentagem', '.ctx-num', 'info'],
  ['Porcentagem alerta', '.ctx-warn .ctx-num', 'info'],
  ['Porcentagem cheia', '.ctx-full .ctx-num', 'info'],
  ['Elevador: título', '.floors-head', 'card'],
  ['Elevador: andar', '.floor-btn', 'card'],
  ['Elevador: andar atual', '.floor-btn.on', 'card + andar atual'],
  ['Elevador: número atual', '.floor-btn.on .floor-num', ['.floor-btn.on .floor-num', 'card']],
  ['Elevador: novo andar', '.floor-btn.floor-add', 'card'],
  ['Elevador: andar com pedido', '.floor-btn.pulse', 'card'],
]

export function measure() {
  return PAIRS.map(([what, sel, bgRef]) => {
    const bg = Array.isArray(bgRef) ? stack(BG[bgRef[1]], css(bgRef[0])) : BG[bgRef]
    const fg = stack(bg, css(sel, 'color'))
    return { what, selector: sel, color: resolve(prop(sel, 'color')), ratio: ratio(fg, bg) }
  })
}

const rows = measure()
const failing = rows.filter((r) => r.ratio < AA)
if (process.argv.includes('--check')) {
  for (const r of failing) console.error(`abaixo de AA: ${r.what} (${r.selector}, ${r.color}) ${r.ratio.toFixed(2)}:1`)
  process.exit(failing.length ? 1 : 0)
}
for (const r of rows) console.log(`${r.ratio < AA ? 'FALHA' : 'ok   '} ${r.ratio.toFixed(2).padStart(5)}:1  ${r.what.padEnd(30)} ${r.selector} (${r.color})`)
console.log(`\n${rows.length - failing.length}/${rows.length} pares passam AA (${AA}:1).`)
