// Sala de reunião, a tela (RN-12, RN-18, RN-19, RN-21): as regras puras que a ata, os itens de
// ação e a conversa usam. Nada aqui toca o DOM; a tela só monta o que estas funções devolvem.

import { STATUSES } from './tickets'
import { ATA_LIMITS } from './meetings-ata'
import { QUOTE_HEADING } from './meetings'
import { GROUND_FLOOR } from './meeting-templates'
import { CHAT_HISTORY_EXCHANGES, citationLabel, parseCitations } from './meetings-search'
import type {
  AgentSummary,
  AtaBlock,
  Criterion,
  Meeting,
  MeetingChatEntry,
  MeetingRecipe,
  Segment,
  TicketDraft,
  TicketPriority,
  TicketStatus,
} from './types'

/** Mesmo teto do main (MEETING_IPC_LIMITS): pergunta e cada troca do histórico. */
export const QUESTION_MAX = 4000
export const HISTORY_TEXT_MAX = 8000

// ---------- ata (RN-12) ----------

/**
 * O bloco editado: o texto novo (aparado, no teto do schema) e a origem `user`, que sobrevive a
 * uma nova geração. Texto igual devolve a mesma lista; texto vazio tira o bloco, a não ser que ele
 * já tenha virado ticket (aí o texto fica).
 */
export function editBlock(blocks: AtaBlock[], id: string, text: string): AtaBlock[] {
  const i = blocks.findIndex((b) => b.id === id)
  if (i < 0) return blocks
  const b = blocks[i]
  const t = text.replace(/\r\n?/g, '\n').trim().slice(0, ATA_LIMITS.text)
  if (t === b.text) return blocks
  if (!t) return b.ticket ? blocks : blocks.filter((x) => x.id !== id)
  const out = blocks.slice()
  out[i] = { ...b, text: t, origin: 'user' }
  return out
}

/** Os itens de ação da ata, na ordem. */
export function actionBlocks(ata: AtaBlock[] | null | undefined): AtaBlock[] {
  return (ata ?? []).filter((b) => b.kind === 'action')
}

/** O nome do arquivo ao salvar a ata: `ata-<id da reunião>.md` (o id já é um slug com data). */
export function ataFileName(meetingId: string): string {
  return `ata-${meetingId.replace(/[^\w-]+/g, '-')}.md`
}

// ---------- itens de ação (RN-18) ----------

/** "AO-31 · a fazer": a chave e a coluna em minúsculas; sem a coluna, só a chave. */
export function ticketChip(key: string, status?: TicketStatus): string {
  const label = STATUSES.find((s) => s.value === status)?.label
  return label ? `${key} · ${label.toLowerCase()}` : key
}

/** Critérios de aceite como texto da prévia: um por linha. */
export function criteriaToText(acceptance: Criterion[] | undefined): string {
  return (acceptance ?? []).map((c) => c.text).join('\n')
}

/** Uma linha por critério; marcadores de lista ("- ", "[ ] ") saem; linhas vazias e repetidas também. */
export function textToCriteria(text: string): Criterion[] {
  const seen = new Set<string>()
  const out: Criterion[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const t = raw
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/^\[[ xX]?\]\s*/, '')
      .trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push({ text: t.slice(0, 500), done: false })
  }
  return out
}

/** O que a prévia editável guarda. */
export interface DraftForm {
  title: string
  description: string
  criteria: string
  priority: TicketPriority
  status: TicketStatus
}

/** A prévia a partir do rascunho (actionToDraft). Coluna padrão: A fazer. */
export function draftToForm(d: TicketDraft): DraftForm {
  return {
    title: d.title,
    description: d.description ?? '',
    criteria: criteriaToText(d.acceptance),
    priority: d.priority ?? 'medium',
    status: d.status && d.status !== 'done' ? d.status : 'todo',
  }
}

/**
 * O rascunho que vai ao main a partir da prévia editada. O main refaz a citação marcada, o `cwd`
 * e a tag `reuniao`; aqui só o que a pessoa editou. Título vazio volta ao do rascunho original.
 * Um ticket entregue a um agente vai para Fazendo pelo próprio quadro; a coluna não vira Feito.
 */
export function formToDraft(form: DraftForm, base: TicketDraft): TicketDraft {
  const title = form.title.replace(/\s+/g, ' ').trim().slice(0, 160) || base.title
  return {
    ...base,
    title,
    description: form.description.replace(/\r\n?/g, '\n').trim(),
    acceptance: textToCriteria(form.criteria),
    priority: form.priority,
    status: form.status === 'done' ? 'todo' : form.status,
  }
}

/**
 * A descrição da prévia em duas partes: o texto que a pessoa edita e a seção da reunião (citação
 * marcada e referência), que o main refaz ao criar e a tela só mostra.
 */
export function splitQuote(description: string): { own: string; quote: string } {
  const lines = description.replace(/\r\n?/g, '\n').split('\n')
  const cut = lines.findIndex((l) => l.trimStart().startsWith(QUOTE_HEADING))
  if (cut < 0) return { own: description.trim(), quote: '' }
  return { own: lines.slice(0, cut).join('\n').trim(), quote: lines.slice(cut).join('\n').trim() }
}

/** Reunião do térreo: o ticket precisa de um andar de projeto. */
export function needsFloorPick(meetingFloor: string): boolean {
  return meetingFloor === GROUND_FLOOR
}

/** Uma linha da escolha de agente: desabilitada quando há motivo. */
export interface AgentChoice {
  agent: AgentSummary
  /** Por que não dá para escolher (pt-BR); ausente = pode. */
  reason?: string
  /** Pode, mas com um aviso ("trabalhando: a pergunta espera ele terminar"). */
  note?: string
}

const busy = (a: AgentSummary) => a.status === 'working' || a.status === 'starting' || a.status === 'waiting'

/**
 * Os agentes do andar para "Entregar a um agente" (`delegate`) ou "Abrir com um agente" (`ask`).
 * As regras são as do quadro (TicketDesk.delegate e checkMeetingAgent): só agentes do escritório,
 * do andar, fora do modo "Sem pedir nada"; para entregar, livres e na pasta do andar. Agentes de
 * outro andar, sessões do terminal e orquestradores nem aparecem. Os livres vêm primeiro.
 */
export function agentChoices(agents: Iterable<AgentSummary>, floor: string, mode: 'delegate' | 'ask', floorCwd?: string): AgentChoice[] {
  const out: AgentChoice[] = []
  for (const a of agents) {
    if (a.source !== 'office' || a.role === 'orchestrator') continue
    if ((a.project ?? GROUND_FLOOR) !== floor) continue
    let reason: string | undefined
    let note: string | undefined
    if (a.permissionMode === 'bypassPermissions') reason = 'no modo "Sem pedir nada"'
    else if (mode === 'delegate' && busy(a)) reason = a.status === 'waiting' ? 'esperando você' : 'ocupado agora'
    else if (mode === 'delegate' && floorCwd && a.cwd !== floorCwd) reason = 'trabalha em outra pasta'
    else if (mode === 'ask' && busy(a)) note = 'trabalhando: a pergunta espera ele terminar'
    out.push(reason ? { agent: a, reason } : note ? { agent: a, note } : { agent: a })
  }
  return out.sort((x, y) => Number(!!x.reason) - Number(!!y.reason) || x.agent.name.localeCompare(y.agent.name, 'pt-BR'))
}

// ---------- conversa (RN-19) ----------

/**
 * O autocompletar das receitas: com o texto começando por `/` e ainda sem espaço, as receitas cujo
 * comando começa com o que foi digitado, depois as que o contêm (no comando ou no nome).
 */
export function matchRecipes(input: string, recipes: readonly MeetingRecipe[]): MeetingRecipe[] {
  if (!input.startsWith('/') || /\s/.test(input)) return []
  const q = input.slice(1).toLowerCase()
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const prefix = recipes.filter((r) => r.command.slice(1).startsWith(q))
  const rest = q ? recipes.filter((r) => !prefix.includes(r) && (r.command.includes(q) || fold(r.name).includes(fold(q)))) : []
  return [...prefix, ...rest]
}

/**
 * A pergunta que vai ao Claude: `/resumo` vira o prompt da receita; o que vier depois do comando
 * entra como pedido extra. Comando desconhecido segue como texto. Tudo no teto do main.
 */
export function expandRecipe(input: string, recipes: readonly MeetingRecipe[]): { recipe?: MeetingRecipe; question: string } {
  const text = input.trim()
  const m = /^(\/[a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/.exec(text)
  const recipe = m ? recipes.find((r) => r.command === m[1]) : undefined
  if (!recipe) return { question: text.slice(0, QUESTION_MAX) }
  const extra = m?.[2]?.trim()
  const question = extra ? `${recipe.prompt}\n\nPedido extra: ${extra}` : recipe.prompt
  return { recipe, question: question.slice(0, QUESTION_MAX) }
}

/** O histórico reenviado ao main: as últimas trocas do escopo, cada texto no teto. */
export function chatHistory(
  chat: readonly MeetingChatEntry[],
  scope: 'meeting' | 'floor',
  exchanges = CHAT_HISTORY_EXCHANGES,
): { role: 'user' | 'assistant'; text: string }[] {
  return chat
    .filter((c) => c.scope === scope)
    .slice(-exchanges * 2)
    .map((c) => ({ role: c.role, text: c.text.slice(0, HISTORY_TEXT_MAX) }))
}

/** O que se sabe de uma reunião citada para montar o rótulo. */
export interface CitedMeeting {
  meeting: Pick<Meeting, 'title' | 'startedAt'>
  segments?: Pick<Segment, 'id' | 'start'>[]
}

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; meetingId: string; segment: number; label: string }

/**
 * A resposta em pedaços: texto e citações `[r:<id>#s<n>]` com o rótulo "Kickoff do checkout,
 * 14:52". Reunião que a tela não conhece fica "Outra reunião"; trecho que não existe, só o título.
 */
export function answerParts(text: string, known: (meetingId: string) => CitedMeeting | undefined): AnswerPart[] {
  return parseCitations(text).parts.map((p): AnswerPart => {
    if (p.kind === 'text') return p
    const m = known(p.meetingId)
    const label = m
      ? citationLabel(
          m.meeting,
          m.segments?.find((s) => s.id === p.segment),
        )
      : 'Outra reunião'
    return { kind: 'cite', meetingId: p.meetingId, segment: p.segment, label }
  })
}

/** Marca segura no Markdown no lugar de cada citação: só letras e números, sem nada do modelo. */
export function citeToken(i: number): string {
  return `MTCITE${i}X`
}

/**
 * O texto da resposta com cada citação trocada por uma marca (`MTCITE0X`…): a tela passa o texto
 * pelo renderMarkdown (sanitizado) e depois troca cada marca por um link. Devolve as citações na
 * ordem das marcas.
 */
export function withCiteTokens(parts: AnswerPart[]): { markdown: string; cites: Extract<AnswerPart, { kind: 'cite' }>[] } {
  const cites: Extract<AnswerPart, { kind: 'cite' }>[] = []
  let markdown = ''
  for (const p of parts) {
    if (p.kind === 'text') markdown += p.text.replace(/MTCITE\d+X/g, '')
    else {
      markdown += citeToken(cites.length)
      cites.push(p)
    }
  }
  return { markdown, cites }
}

// ---------- quadro (RN-18) ----------

/** Uma referência `reuniao:<id>#s<n>` achada num texto do ticket. */
export interface MeetingRefMatch {
  index: number
  length: number
  meetingId: string
  segment?: number
}

const REF_RE = /reuniao:([a-z0-9][a-z0-9-]{0,63})(?:#s(\d{1,6}))?/g

/** As referências `reuniao:<id>` (com ou sem `#s<n>`) de um texto, para o quadro trocar por links. */
export function findMeetingRefs(text: string): MeetingRefMatch[] {
  const out: MeetingRefMatch[] = []
  for (const m of text.matchAll(REF_RE)) {
    // "reuniao" solto no meio de outra palavra ("preuniao:") não conta
    if (m.index > 0 && /[\w-]/.test(text[m.index - 1])) continue
    out.push({ index: m.index, length: m[0].length, meetingId: m[1], ...(m[2] !== undefined ? { segment: Number(m[2]) } : {}) })
  }
  return out
}
