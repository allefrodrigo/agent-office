// Sala de CRM: palavras de saída das ofertas e palavras de alerta (CR-13).
// Spec: docs/prd/sala-de-crm.md ("Uma mensagem chega", passo 4). Rodam em código, antes de qualquer modelo.
//
// Erra para o lado do cliente: na dúvida, sai das ofertas e chama você. Um falso positivo custa um
// clique seu; um falso negativo é oferta para quem pediu para sair. Por isso, além da lista das
// Configurações, um núcleo fixo de expressões vale sempre (não dá para desligar pela lista).
//
// Comparação: sem acento, sem caixa, palavra ou expressão inteira. Letras repetidas contam uma vez
// ("PAAARA", "pareee"), dos dois lados. Pontuação, quebra de linha e emoji separam orações: a negação
// só vale dentro da mesma oração ("não, pode parar" sai; "não quero parar" fica).

/** Past this, the rest of the text is not read (inbound text is already cut at 4 000 characters). */
const MAX_TEXT = 8_000
/** A clause break: punctuation, line break, emoji. */
const BREAK = '|'

/**
 * The fixed reply to who left the offers. It goes through the gate as Atendimento (ADR 0017,
 * change 8): no link, no payment data, and the same text twice in 24 h is barred (rule 8).
 */
export const OPT_OUT_REPLY =
  'Pronto, você não vai mais receber ofertas nossas por aqui. Atendimento e cobrança continuam normais. Se quiser voltar a receber, é só avisar.'

/** WhatsApp shorthand, already folded and with runs collapsed, to the words it stands for. */
const SHORT: Record<string, string[]> = {
  n: ['nao'],
  naum: ['nao'],
  q: ['que'],
  oq: ['o', 'que'],
  p: ['para'],
  vc: ['voce'],
  vcs: ['voces'],
  ce: ['voce'],
  kero: ['quero'],
  qero: ['quero'],
  qro: ['quero'],
  vo: ['vou'],
  eh: ['e'],
  msg: ['mensagem'],
  msgs: ['mensagens'],
  pf: ['por', 'favor'],
  pfv: ['por', 'favor'],
  pfvr: ['por', 'favor'],
  pls: ['por', 'favor'],
  plz: ['por', 'favor'],
  plis: ['por', 'favor'],
  msm: ['mesmo'],
  agr: ['agora'],
}

/**
 * The words of a message as the keywords compare them: folded (NFKD also turns 𝐏𝐀𝐑𝐀𝐑 into parar),
 * runs of a letter collapsed, shorthand spelled out, and '|' between clauses.
 */
export function keywordTokens(text: string): string[] {
  const s = String(text ?? '')
    .slice(0, MAX_TEXT)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}.!?;,:|\n\r…()[\]{}"“”«»¡¿]/gu, ` ${BREAK} `)
    .replace(/[^a-z0-9|]+/g, ' ')
  const out: string[] = []
  for (const raw of s.split(' ')) {
    if (!raw) continue
    if (raw === BREAK) {
      if (out.length && out[out.length - 1] !== BREAK) out.push(BREAK)
      continue
    }
    const word = raw.replace(/([a-z])\1+/g, '$1')
    out.push(...(SHORT[word] ?? [word]))
  }
  if (out[out.length - 1] === BREAK) out.pop()
  return out
}

/** A word or expression of the settings list, as tokens (no breaks). */
function phrase(word: string): string[] {
  return keywordTokens(word).filter((t) => t !== BREAK)
}

/** Where `seq` appears in `tokens` as whole words, inside one clause. */
function* find(tokens: readonly string[], seq: readonly string[]): Generator<number> {
  if (!seq.length) return
  outer: for (let i = 0; i + seq.length <= tokens.length; i++) {
    for (let k = 0; k < seq.length; k++) if (tokens[i + k] !== seq[k]) continue outer
    yield i
  }
}

/** Core expressions: a regex over the tokens joined by spaces, in collapsed form ("iso" is "isso"). */
const core = (source: string) => new RegExp(`(?:^| )(?:${source})(?= |$)`, 'g')

interface CoreRule {
  re: RegExp
  /** A negation right before it turns it around, like a list word. */
  negatable: boolean
}

/**
 * Always take the customer out of the offers, whatever the list says. "par… de mandar" and "não
 * mande mais" are never negated ("vocês não param de mandar" is a complaint); the rest is, like the
 * list ("nunca vou descadastrar").
 */
const OPT_OUT_CORE: CoreRule[] = [
  { re: core('par(?:a|e|em|am|ar) de (?:(?:me|nos|ficar) )?(?:mand|envi|encher|incomod|perturb)[a-z]*'), negatable: false },
  { re: core('par(?:a|e|em) com (?:iso|eso|esa|esas|ese|eses|as|os)'), negatable: false },
  { re: core('nao (?:(?:me|precisa|precisa me) )?(?:mand|envi)[a-z]* mais'), negatable: false },
  { re: core('saia? fora'), negatable: true },
  {
    re: core('(?:tira|tire|remove|remova|retira|retire|exclui|exclua|apaga|apague)(?: [a-z]+){0,3} (?:lista|numero|contato|cadastro)'),
    negatable: true,
  },
  { re: core('descadastr[a-z]*'), negatable: true },
  { re: core('chega de (?:mensagem|mensagens|propaganda|propagandas|oferta|ofertas|spam|promocao|promocoes)'), negatable: true },
  { re: core('stop'), negatable: true },
]

/** Always hand the conversation to you, whatever the list says. */
const ALERT_CORE: CoreRule[] = [
  'reclame ?aqui',
  'proces(?:ar|a|o|em|ando|arei|aria|ariam)',
  'justica',
  'denunci[a-z]*',
  'policia',
  'estelionat[a-z]*',
  'fraude',
  'golpista',
].map((source) => ({ re: core(source), negatable: false }))

/** Negations that, a few bridge words before an exit word, turn it around ("não vou sair"). */
const NEG = new Set(['nao', 'nem', 'nunca', 'jamais'])
/** Words that may sit between a negation and what it negates ("nem pensar em sair", "não é pra parar"). */
const BRIDGE = new Set([
  'quero',
  'queria',
  'quer',
  'vou',
  'vai',
  'vamos',
  'precisa',
  'preciso',
  'pode',
  'posso',
  'deve',
  'devo',
  'e',
  'pra',
  'para',
  'que',
  'voce',
  'voces',
  'me',
  'te',
  'eu',
  'mais',
  'ainda',
  'mesmo',
  'pensar',
  'pensa',
  'penso',
  'em',
  'de',
  'ter',
  'tem',
  'agora',
  'so',
  'estou',
  'to',
  'ta',
])
const MAX_BRIDGE = 4

/** A negation sits right before `i`, in the same clause, with at most a few bridge words between. */
function negatedBefore(tokens: readonly string[], i: number): boolean {
  let bridged = 0
  for (let k = i - 1; k >= 0 && tokens[k] !== BREAK; k--) {
    if (NEG.has(tokens[k])) return true
    if (!BRIDGE.has(tokens[k]) || ++bridged > MAX_BRIDGE) return false
  }
  return false
}

/** An exit word starts at one of `starts` right after `j`, in the same clause, past at most a few bridge words. */
function exitAfter(tokens: readonly string[], j: number, starts: ReadonlySet<number>): boolean {
  let bridged = 0
  for (let k = j; k < tokens.length && tokens[k] !== BREAK; k++) {
    if (starts.has(k)) return true
    if (!BRIDGE.has(tokens[k]) || ++bridged > MAX_BRIDGE) return false
  }
  return false
}

/** Token index of each match of the core rules. */
function coreMatches(tokens: readonly string[], rules: readonly CoreRule[]): { at: number; text: string; negatable: boolean }[] {
  const joined = tokens.join(' ')
  const index = new Map<number, number>()
  let offset = 0
  tokens.forEach((t, i) => {
    index.set(offset, i)
    offset += t.length + 1
  })
  const out: { at: number; text: string; negatable: boolean }[] = []
  for (const { re, negatable } of rules) {
    for (const m of joined.matchAll(re)) {
      const start = m.index + (m[0].startsWith(' ') ? 1 : 0)
      out.push({ at: index.get(start) ?? 0, text: m[0].trim(), negatable })
    }
  }
  return out
}

/**
 * The customer asked to leave the offers: the expression that said so (from the list or the fixed
 * core), or null. A list word negated in its clause does not count ("não quero parar", "não vou
 * sair", "nem pensar em sair"); a list expression that is itself a refusal ("não quero") does not
 * count when what follows is the exit it negates ("não quero que pare").
 */
export function matchOptOut(text: string, words: readonly string[]): string | null {
  const tokens = keywordTokens(text)
  const list = words.map((w) => ({ word: w, seq: phrase(w) })).filter((x) => x.seq.length)
  const refusals = list.filter((x) => NEG.has(x.seq[0]))
  const exits = list.filter((x) => !NEG.has(x.seq[0]))
  // List words first: on the same spot, the word the player wrote is the one shown.
  const hits: { at: number; word: string; negated: boolean }[] = []
  for (const x of exits) for (const i of find(tokens, x.seq)) hits.push({ at: i, word: x.word, negated: negatedBefore(tokens, i) })
  for (const m of coreMatches(tokens, OPT_OUT_CORE))
    hits.push({ at: m.at, word: m.text, negated: m.negatable && negatedBefore(tokens, m.at) })
  const starts = new Set(hits.map((h) => h.at))
  for (const x of refusals) {
    for (const i of find(tokens, x.seq))
      if (!exitAfter(tokens, i + x.seq.length, starts)) hits.push({ at: i, word: x.word, negated: false })
  }
  const first = hits.filter((h) => !h.negated).sort((a, b) => a.at - b.at)[0]
  return first ? first.word : null
}

/** The forms a list word also takes for the alert: plural and feminine ("advogada", "reclamações"). */
function variants(seq: readonly string[]): string[][] {
  const head = seq.slice(0, -1)
  const last = seq[seq.length - 1]
  const forms = new Set([last, `${last}s`])
  if (last.endsWith('o')) forms.add(`${last.slice(0, -1)}a`).add(`${last.slice(0, -1)}as`)
  if (last.endsWith('ao')) forms.add(`${last.slice(0, -2)}oes`).add(`${last.slice(0, -2)}aes`)
  return [...forms].map((f) => [...head, f])
}

/**
 * The customer asked for a person, or spoke of a complaint or the law: the word that said so (from
 * the list or the fixed core), or null. No negation here: "não é golpe, né?" also calls you.
 */
export function matchAlert(text: string, words: readonly string[]): string | null {
  const tokens = keywordTokens(text)
  const hits: { at: number; word: string }[] = []
  for (const w of words) {
    const seq = phrase(w)
    if (!seq.length) continue
    for (const form of variants(seq)) for (const i of find(tokens, form)) hits.push({ at: i, word: w })
  }
  for (const m of coreMatches(tokens, ALERT_CORE)) hits.push({ at: m.at, word: m.text })
  const first = hits.sort((a, b) => a.at - b.at)[0]
  return first ? first.word : null
}
