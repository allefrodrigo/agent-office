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
 *
 * O Chat dos bots (CB-08) tem o tema próprio em ui/chat/chat.css, com os tokens --ch-* em
 * .chat-screen: o script lê esse arquivo também. A tela é opaca, então o mundo não entra.
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

const CHAT_CSS = join(CSS_DIR, '../ui/chat/chat.css')
const rules = [...parseRules(readStyles('index.css')), ...parseRules(readFileSync(CHAT_CSS, 'utf8'))]
/** :root, plus the Chat tokens (all --ch-*, so they never shadow the app's). */
const vars = Object.fromEntries(
  rules.filter(([s]) => s.includes(':root') || s.includes('.chat-screen')).flatMap(([, d]) => Object.entries(d).filter(([k]) => k.startsWith('--'))),
)

/** The last value a selector sets for a property (later rules win, like the cascade). */
function prop(selector, name) {
  let v
  for (const [sels, decls] of rules) if (sels.includes(selector) && decls[name] !== undefined) v = decls[name]
  if (v === undefined) throw new Error(`${selector} não define ${name} nos estilos (styles/ e ui/chat/chat.css)`)
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
  // Sala de reunião (RN-12): fundo opaco; de dia o mundo atrás é claro, de noite escuro.
  'ata (dia)': stack(WHITE, css('.mt-ata')),
  'ata (noite)': stack(WORLD, css('.mt-ata')),
  'conversa (dia)': stack(WHITE, css('.mt-chat')),
  'conversa (noite)': stack(WORLD, css('.mt-chat')),
  'detalhe do ticket': stack(WHITE, css('.tdetail')),
}

// Chat dos bots (CB-08): fundos opacos, do mais escuro (o fio) ao mais claro (a linha escolhida).
const CHAT = css('.chat-screen')
const SIDE = css('.ch-side')
const CARD_CH = stack(CHAT, css('.ch-card'))
const MENU = stack(CHAT, css('.ch-menu'))
Object.assign(BG, {
  'chat: fio': CHAT,
  'chat: lateral': SIDE,
  'chat: lateral + hover': stack(SIDE, css('.ch-row-btn:hover')),
  'chat: lateral + atual': stack(SIDE, css('.ch-row.on .ch-row-btn')),
  'chat: balão do bot': stack(CHAT, css('.ch-msg-bot .ch-bubble')),
  'chat: balão seu': stack(CHAT, css('.ch-msg-you .ch-bubble')),
  'chat: cartão': CARD_CH,
  'chat: opção': stack(CARD_CH, css('.ch-option')),
  'chat: aviso': stack(CHAT, css('.ch-notice')),
  'chat: aviso de erro': stack(CHAT, css('.ch-notice.tone-error')),
  'chat: caixa': stack(CHAT, css('.ch-pill')),
  'chat: pedido na caixa': stack(CHAT, css('.ch-reply')),
  'chat: botão': stack(CHAT, css('.chat-screen .btn')),
  'chat: select': stack(CHAT, css('.ch-select', 'background-color')),
  'chat: perfil': stack(CHAT, css('.ch-profile')),
  'chat: perfil + gasto': stack(CHAT, css('.ch-profile'), css('.ch-spend div')),
  'chat: modelo + hover': stack(CHAT, css('.ch-tpl:hover')),
  'chat: menu': MENU,
  'chat: menu + hover': stack(MENU, css('.ch-menu-item:hover')),
})

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
  ...['dia', 'noite'].flatMap((t) => [
    [`Ata (${t}): seu texto`, '.mt-block-user', `ata (${t})`],
    [`Ata (${t}): texto da IA`, '.mt-block-ai', `ata (${t})`],
    [`Ata (${t}): legenda sua`, '.mt-legend-user', `ata (${t})`],
    [`Ata (${t}): legenda da IA`, '.mt-legend-ai', `ata (${t})`],
    [`Ata (${t}): título dos itens`, '.mt-actions-title', `ata (${t})`],
    [`Ata (${t}): dono e prazo`, '.mt-action-meta', `ata (${t})`],
    [`Ata (${t}): ticket criado`, '.mt-ticket-chip', ['.mt-ticket-chip', `ata (${t})`]],
    [`Ata (${t}): gerando`, '.mt-ata-progress', ['.mt-ata-progress', `ata (${t})`]],
    [`Ata (${t}): aviso`, '.mt-ata-warn', ['.mt-ata-warn', `ata (${t})`]],
    [`Ata (${t}): vazia`, '.mt-ata-empty', `ata (${t})`],
    [`Conversa (${t}): pergunta`, '.mt-msg-user', ['.mt-msg-user', `conversa (${t})`]],
    [`Conversa (${t}): resposta`, '.mt-msg-assistant', `conversa (${t})`],
    [`Conversa (${t}): citação`, '.mt-cite-link', ['.mt-cite-link', `conversa (${t})`]],
    [`Conversa (${t}): escopo`, '.mt-scope-btn', ['.mt-scope', `conversa (${t})`]],
    [`Conversa (${t}): vazia`, '.mt-chat-empty', `conversa (${t})`],
  ]),
  ['Quadro: link da reunião', '.tmeeting-link', ['.tmeeting-link', 'detalhe do ticket']],
  ['Botão Chat: não lidas', '.chat-launch-badge', ['.chat-launch-badge', 'card']],
  // Chat dos bots, a lateral: o pior caso é a linha escolhida, o fundo mais claro
  ['Chat: título', '.ch-title', 'chat: lateral'],
  ['Chat: busca (dica)', '.ch-side-search::placeholder', ['.ch-side-search', 'chat: lateral']],
  ['Chat: grupo', '.ch-group-title', 'chat: lateral'],
  ['Chat: grupo vazio', '.ch-group-empty', 'chat: lateral'],
  ['Chat: nome do bot', '.ch-row-btn', 'chat: lateral + atual'],
  ['Chat: hora na lateral', '.ch-row-time', 'chat: lateral + atual'],
  ['Chat: hora não lida', '.ch-row.unread .ch-row-time', 'chat: lateral + atual'],
  ['Chat: estado', '.ch-row-status', 'chat: lateral + atual'],
  ['Chat: esperando', '.chat-screen .tone-wait', 'chat: lateral + atual'],
  ['Chat: trabalhando', '.chat-screen .tone-work', 'chat: lateral + atual'],
  ['Chat: falhou', '.chat-screen .tone-fail', 'chat: lateral + atual'],
  ['Chat: sem mensagens', '.chat-screen .tone-none', 'chat: lateral + atual'],
  ['Chat: fixado', '.ch-pin', 'chat: lateral + atual'],
  ['Chat: não lidas', '.ch-unread', ['.ch-unread', 'chat: lateral']],
  ['Chat: ⋯ da linha', '.ch-row-more', ['.ch-row-more', 'chat: lateral + hover']],
  ['Chat: mostrar escondidos', '.ch-show-hidden', 'chat: lateral'],
  ['Chat: achado na busca', '.ch-hit-text', 'chat: lateral + hover'],
  ['Chat: rodapé', '.ch-foot-btn', 'chat: lateral'],
  ['Chat: rodapé (em breve)', '.ch-foot-btn small', 'chat: lateral'],
  ['Chat: novo bot', '.ch-foot-btn.ch-new', 'chat: lateral + hover'],
  // o cabeçalho e o fio
  ['Chat: texto', '.chat-screen', 'chat: fio'],
  ['Chat: linha do cabeçalho', '.ch-head-sub', 'chat: fio'],
  ['Chat: modelo (select)', '.ch-select', 'chat: select'],
  ['Chat: botão de ícone', '.ch-icon-btn', 'chat: fio'],
  ['Chat: botão de ícone ligado', '.ch-icon-btn.on', ['.ch-icon-btn.on', 'chat: fio']],
  ['Chat: dia', '.ch-day', 'chat: fio'],
  ['Chat: autor e hora', '.ch-meta', 'chat: fio'],
  ['Chat: autor', '.ch-author', 'chat: fio'],
  ['Chat: balão do bot', '.ch-msg-bot .ch-bubble', 'chat: balão do bot'],
  ['Chat: seu balão', '.ch-msg-you .ch-bubble', 'chat: balão seu'],
  ['Chat: anexo (balão do bot)', '.ch-file', ['.ch-file', 'chat: balão do bot']],
  ['Chat: tamanho do anexo', '.ch-file small', ['.ch-file', 'chat: balão do bot']],
  ['Chat: anexo (seu balão)', '.ch-file', ['.ch-msg-you .ch-file', 'chat: balão seu']],
  ['Chat: rodada', '.ch-run', 'chat: fio'],
  ['Chat: rodada (nome)', '.ch-run-label', 'chat: fio'],
  ['Chat: rodada falhou', '.ch-run.s-failed .ch-run-text', 'chat: fio'],
  ['Chat: rodada pulada', '.ch-run.s-skipped .ch-run-text', 'chat: fio'],
  ['Chat: rodada ao vivo', '.ch-run.s-running .ch-run-text', 'chat: fio'],
  ['Chat: hora', '.ch-time', 'chat: cartão'],
  ['Chat: passo', '.ch-step', 'chat: fio'],
  ['Chat: ferramenta do passo', '.ch-step-tool', 'chat: fio'],
  ['Chat: passo com erro', '.ch-step.k-error', 'chat: fio'],
  ['Chat: decisão', '.ch-decided', 'chat: fio'],
  ['Chat: o que foi decidido', '.ch-decided-what', 'chat: fio'],
  ['Chat: aviso', '.ch-notice', 'chat: aviso'],
  ['Chat: aviso de alerta', '.ch-notice.tone-warn', 'chat: aviso'],
  ['Chat: aviso de erro', '.ch-notice.tone-error', 'chat: aviso de erro'],
  ['Chat: conversa entre bots', '.ch-aside', 'chat: fio'],
  ['Chat: vazio', '.ch-empty', 'chat: fio'],
  ['Chat: sugestão', '.ch-suggestion', ['.ch-suggestion', 'chat: fio']],
  ['Chat: busca no fio', '.ch-search-count', ['.ch-search-bar', 'chat: fio']],
  ['Chat: nova mensagem ↓', '.ch-newpill', ['.ch-newpill', 'chat: fio']],
  ['Chat: link', '.ch-link', 'chat: cartão'],
  // pedidos: aprovação, pergunta e plano
  ['Chat: pedido (título)', '.ch-card-head', 'chat: cartão'],
  ['Chat: pedido sensível', '.ch-card.sensitive .ch-card-head', 'chat: cartão'],
  ['Chat: pedido (resumo)', '.ch-card-sub', 'chat: cartão'],
  ['Chat: pedido (texto)', '.ch-card-title', 'chat: cartão'],
  ['Chat: pedido (detalhe)', '.ch-card-detail', ['.ch-card-detail', 'chat: cartão']],
  ['Chat: pedido (nota)', '.ch-card-note', 'chat: cartão'],
  ['Chat: pedido (risco)', '.ch-card-warn', 'chat: cartão'],
  ['Chat: opção', '.ch-option', 'chat: opção'],
  ['Chat: opção (descrição)', '.ch-option-desc', 'chat: opção'],
  ['Chat: opção escolhida', '.ch-option', [".ch-option[aria-pressed='true']", 'chat: opção']],
  ['Chat: Outra…', '.ch-option-other', ['.ch-option-other', 'chat: cartão']],
  ['Chat: botão', '.chat-screen .btn', 'chat: botão'],
  ['Chat: botão (hover)', '.chat-screen .btn', ['.chat-screen .btn:hover', 'chat: fio']],
  ['Chat: botão principal', '.chat-screen .ch-btn-accent', ['.chat-screen .ch-btn-accent', 'chat: cartão']],
  ['Chat: botão principal (hover)', '.chat-screen .ch-btn-accent', ['.chat-screen .ch-btn-accent:hover', 'chat: cartão']],
  ['Chat: botão discreto', '.chat-screen .ch-btn-quiet', 'chat: cartão'],
  ['Chat: botão de perigo', '.chat-screen .btn-danger-soft', ['.chat-screen .btn-danger-soft', 'chat: cartão']],
  // a caixa de mensagem
  ['Chat: caixa (dica)', '.ch-input::placeholder', 'chat: caixa'],
  ['Chat: caixa (texto)', '.ch-input', 'chat: caixa'],
  ['Chat: Enviar', '.ch-send', ['.ch-send', 'chat: caixa']],
  ['Chat: Enviar (hover)', '.ch-send', ['.ch-send:hover', 'chat: caixa']],
  ['Chat: Parar', '.ch-send.stop', ['.ch-send.stop', 'chat: caixa']],
  ['Chat: dica embaixo', '.ch-hint', 'chat: fio'],
  ['Chat: responder ao pedido', '.ch-reply', 'chat: pedido na caixa'],
  ['Chat: pedido citado', '.ch-reply span', 'chat: pedido na caixa'],
  ['Chat: qual dos dois?', '.ch-ask-text', ['.ch-ask', 'chat: fio']],
  // perfil, galeria e formulário
  ['Chat: seção do perfil', '.ch-sec-title', 'chat: perfil'],
  ['Chat: rótulo', '.ch-field-label', 'chat: perfil'],
  ['Chat: dica do campo', '.ch-field-hint', 'chat: perfil'],
  ['Chat: erro do campo', '.ch-field-hint.err', 'chat: perfil'],
  ['Chat: explicação da opção', '.ch-check small', 'chat: perfil'],
  ['Chat: em breve', '.ch-soon', 'chat: perfil'],
  ['Chat: tamanho da memória', '.ch-mem-size', 'chat: perfil'],
  ['Chat: memória cheia', '.ch-mem-size.over', 'chat: perfil'],
  ['Chat: pasta', '.ch-path-label', 'chat: perfil'],
  ['Chat: gasto (rótulo)', '.ch-spend dt', 'chat: perfil + gasto'],
  ['Chat: histórico', '.ch-hist-status', 'chat: lateral + hover'],
  ['Chat: campo', '.chat-screen .input', ['.chat-screen .input', 'chat: perfil']],
  ['Chat: frase da galeria', '.ch-gallery-pitch', 'chat: fio'],
  ['Chat: modelo (nome)', '.ch-tpl', 'chat: modelo + hover'],
  ['Chat: modelo (frase)', '.ch-tpl-line', 'chat: modelo + hover'],
  ['Chat: modelo (automação)', '.ch-tpl-auto', 'chat: modelo + hover'],
  ['Chat: erro do formulário', '.ch-form-error', 'chat: fio'],
  ['Chat: menu', '.ch-menu-item', 'chat: menu + hover'],
  ['Chat: menu (perigo)', '.ch-menu-item.danger', 'chat: menu + hover'],
  ['Chat: menu (dica)', '.ch-menu-hint', 'chat: menu + hover'],
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
