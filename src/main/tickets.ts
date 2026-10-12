import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { projectFor } from '@shared/projects'
import { labelOf, PRIORITIES, STATUSES, ticketBrief, TYPES } from '@shared/tickets'
import type {
  Actor,
  AgentSummary,
  Criterion,
  OfficeEvent,
  ProjectFloor,
  Ticket,
  TicketDraft,
  TicketPatch,
  TicketPriority,
  TicketStatus,
  TicketType,
} from '@shared/types'
import { backupCopies } from './backups'
import { loadJson, reportLoad, writeJsonAtomic } from './fs-safe'

const KEY_PREFIX = 'AO'
const MAX_TITLE = 160
const MAX_TEXT = 20_000
const MAX_CRITERIA = 30
const MAX_TAGS = 12
const MAX_COMMENTS = 300
const MAX_ACTIVITY = 200
const MAX_CLOSED_SHOWN = 200
const DAY = 86_400_000

const keyNumber = (key: string): number => Number(/-(\d+)$/.exec(key)?.[1] ?? 0)

const STATUS_VALUES = STATUSES.map((s) => s.value) as [TicketStatus, ...TicketStatus[]]
const TYPE_VALUES = TYPES.map((s) => s.value) as [TicketType, ...TicketType[]]
const PRIORITY_VALUES = PRIORITIES.map((s) => s.value) as [TicketPriority, ...TicketPriority[]]

interface Data {
  seq: number
  tickets: Ticket[]
}

/**
 * The office kanban. Lives in its own file (userData/tickets.json) so a shared,
 * online board can later replace this store without touching agent state.
 * Every change names its actor, so the history reads the same for people and agents.
 *
 * Closed tickets leave the board for a second file (tickets-closed.json), read only
 * when someone looks them up, so the board stays small however long it runs.
 */
export class TicketBoard extends EventEmitter {
  private file: string
  private closedFile: string
  private data: Data
  /** The archive, loaded on first use. */
  private closedData: Ticket[] | null = null
  private timer: NodeJS.Timeout | null = null
  private closedDirty = false
  /** Set while a restore or import replaces the files: nothing in memory may land on them. */
  private locked = false

  constructor(private dir: string) {
    super()
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'tickets.json')
    this.closedFile = join(dir, 'tickets-closed.json')
    this.data = this.load()
  }

  private get closed(): Ticket[] {
    if (!this.closedData) {
      // A broken archive is moved aside, never replaced by the next "Fechar" (AO-24).
      const r = loadJson<{ tickets?: Ticket[] }>(this.closedFile, { fallbacks: backupCopies(this.dir, 'tickets-closed.json') })
      reportLoad(this.closedFile, r)
      const raw = r.status === 'ok' || r.status === 'restored' ? r.data : {}
      this.closedData = Array.isArray(raw.tickets) ? raw.tickets : []
      // What came from a backup goes back to disk under the real name.
      if (r.status === 'restored') this.closedDirty = true
    }
    return this.closedData
  }

  private load(): Data {
    // A broken board is moved aside and the last good copy loads, so AO-N keys never repeat (AO-24).
    const r = loadJson<Partial<Data>>(this.file, { fallbacks: backupCopies(this.dir, 'tickets.json') })
    reportLoad(this.file, r)
    const raw: Partial<Data> = r.status === 'ok' || r.status === 'restored' ? r.data : {}
    const data = { seq: raw.seq ?? 0, tickets: raw.tickets ?? [] }
    // An older copy (or none) may be behind the keys already handed out: count past them.
    if (r.status === 'restored' || r.status === 'lost') data.seq = Math.max(data.seq, ...[...data.tickets, ...this.closed].map((t) => keyNumber(t.key)))
    return data
  }

  // ---------- reads ----------

  list(): Ticket[] {
    return this.data.tickets
  }

  get(id: string): Ticket | undefined {
    return this.data.tickets.find((t) => t.id === id)
  }

  /** Finds by key ("AO-12", "ao-12" or just "12"); `closed` also looks in the archive. */
  byKey(key: string, closed = false): Ticket | undefined {
    const k = key.trim().toUpperCase()
    const n = /^\d+$/.test(k) ? `${KEY_PREFIX}-${k}` : k
    return this.data.tickets.find((t) => t.key === n) ?? (closed ? this.closed.find((t) => t.key === n) : undefined)
  }

  /** Closed tickets, newest first, matching the text in key, title, description or tags. */
  listClosed(search?: string, limit = MAX_CLOSED_SHOWN): Ticket[] {
    const q = typeof search === 'string' ? search.toLowerCase().trim() : ''
    return this.closed
      .filter((t) => !q || [t.key, t.title, t.description, ...t.tags].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      .slice(0, limit)
  }

  /** Tickets an agent is assigned to and still working on. */
  activeFor(agentId: string): Ticket[] {
    return this.data.tickets.filter((t) => t.assignee?.id === agentId && t.status === 'doing')
  }

  // ---------- writes ----------

  create(draft: TicketDraft, by: Actor): Ticket {
    const d = cleanDraft(draft, true)
    const status = d.status ?? 'backlog'
    const now = Date.now()
    this.data.seq += 1
    const ticket: Ticket = {
      id: randomUUID(),
      key: `${KEY_PREFIX}-${this.data.seq}`,
      title: d.title!,
      type: d.type ?? 'task',
      priority: d.priority ?? 'medium',
      status,
      description: d.description ?? '',
      acceptance: d.acceptance ?? [],
      cwd: d.cwd ?? undefined,
      tags: d.tags ?? [],
      estimate: d.estimate ?? undefined,
      dueDate: d.dueDate ?? undefined,
      reporter: by,
      order: this.nextOrder(status),
      createdAt: now,
      updatedAt: now,
      comments: [],
      activity: [],
    }
    this.log(ticket, by, `criou o ticket em ${labelOf(STATUSES, status)}`)
    this.data.tickets.push(ticket)
    this.changed(ticket)
    return ticket
  }

  update(id: string, patch: TicketPatch, by: Actor): Ticket {
    const t = this.must(id)
    const d = cleanDraft(patch, false)
    if (d.title !== undefined && d.title !== t.title) t.title = d.title
    if (d.type && d.type !== t.type) {
      this.log(t, by, `mudou o tipo para ${labelOf(TYPES, d.type)}`)
      t.type = d.type
    }
    if (d.priority && d.priority !== t.priority) {
      this.log(t, by, `mudou a prioridade para ${labelOf(PRIORITIES, d.priority)}`)
      t.priority = d.priority
    }
    if (d.description !== undefined && d.description !== t.description) {
      t.description = d.description
      this.log(t, by, 'editou a descrição')
    }
    if (d.acceptance) t.acceptance = d.acceptance
    if (d.cwd !== undefined) t.cwd = d.cwd ?? undefined
    if (d.tags) t.tags = d.tags
    if (d.estimate !== undefined) t.estimate = d.estimate ?? undefined
    if (d.dueDate !== undefined) t.dueDate = d.dueDate ?? undefined
    if (d.status && d.status !== t.status) this.setStatus(t, d.status, by)
    this.changed(t)
    return t
  }

  move(id: string, status: TicketStatus, beforeId: string | undefined, by: Actor): void {
    const t = this.must(id)
    if (!STATUS_VALUES.includes(status)) throw new Error('Coluna inválida.')
    if (status !== t.status) this.setStatus(t, status, by)
    const column = this.column(status).filter((x) => x.id !== t.id)
    const at = beforeId ? column.findIndex((x) => x.id === beforeId) : -1
    column.splice(at < 0 ? column.length : at, 0, t)
    column.forEach((x, i) => {
      if (x.order === i) return
      x.order = i
      if (x !== t) this.changed(x, false)
    })
    this.changed(t)
  }

  comment(id: string, text: string, by: Actor): Ticket {
    const t = this.must(id)
    const body = cleanText(text, MAX_TEXT)
    if (!body) throw new Error('O comentário está vazio.')
    t.comments.push({ id: randomUUID(), t: Date.now(), author: by, text: body })
    if (t.comments.length > MAX_COMMENTS) t.comments.splice(0, t.comments.length - MAX_COMMENTS)
    this.changed(t)
    return t
  }

  /** Marks acceptance criteria (1-based positions) as done or not. */
  check(id: string, items: number[], done: boolean, by: Actor): Ticket {
    const t = this.must(id)
    const hit = items.filter((i) => Number.isInteger(i) && i >= 1 && i <= t.acceptance.length)
    if (!hit.length) throw new Error(`O ticket tem ${t.acceptance.length} critério(s); use posições de 1 a ${t.acceptance.length}.`)
    for (const i of hit) t.acceptance[i - 1].done = done
    this.log(t, by, `${done ? 'cumpriu' : 'reabriu'} o critério ${hit.join(', ')}`)
    this.changed(t)
    return t
  }

  assign(id: string, who: Actor | undefined, by: Actor): Ticket {
    const t = this.must(id)
    t.assignee = who
    this.log(t, by, who ? `passou o ticket para ${who.name}` : 'tirou o responsável')
    this.changed(t)
    return t
  }

  /** The agent left the office: keep its name on the ticket, drop the live link. */
  agentLeft(agentId: string): void {
    for (const t of this.data.tickets) {
      if (t.assignee?.id !== agentId) continue
      const name = t.assignee.name
      t.assignee = { kind: 'agent', name }
      this.log(t, { kind: 'agent', name }, 'saiu do escritório')
      this.changed(t)
    }
  }

  remove(id: string): void {
    const before = this.data.tickets.length
    this.data.tickets = this.data.tickets.filter((t) => t.id !== id)
    if (this.data.tickets.length === before) return
    this.emitEvent({ type: 'ticket:removed', ticketId: id })
    this.save()
  }

  /** Moves tickets in "Feito" to the archive (all of them when no ids). Returns how many closed. */
  close(ids: string[] | undefined, by: Actor): number {
    const pick = ids ? new Set(ids) : null
    const going = this.data.tickets.filter((t) => t.status === 'done' && (!pick || pick.has(t.id)))
    if (!going.length) return 0
    const now = Date.now()
    for (const t of going) {
      this.log(t, by, 'fechou o ticket')
      t.closedAt = now
      t.updatedAt = now
      this.closed.push(t)
    }
    const gone = new Set(going.map((t) => t.id))
    this.data.tickets = this.data.tickets.filter((t) => !gone.has(t.id))
    for (const id of gone) this.emitEvent({ type: 'ticket:removed', ticketId: id })
    this.closedDirty = true
    this.save()
    return going.length
  }

  /** Closes what has sat in "Feito" for `days` days or more; 0 turns it off. */
  autoClose(days: number): number {
    if (!(days > 0)) return 0
    const limit = Date.now() - days * DAY
    const old = this.data.tickets.filter((t) => t.status === 'done' && (t.doneAt ?? t.updatedAt) <= limit).map((t) => t.id)
    return old.length ? this.close(old, { kind: 'agent', name: 'Quadro' }) : 0
  }

  /** A closed ticket comes back to "A fazer", history and comments intact. */
  reopen(id: string, by: Actor): Ticket {
    const i = this.closed.findIndex((t) => t.id === id)
    if (i < 0) throw new Error('Esse ticket não está entre os fechados.')
    const [t] = this.closed.splice(i, 1)
    delete t.closedAt
    delete t.doneAt
    t.status = 'todo'
    t.order = this.nextOrder('todo')
    this.log(t, by, 'reabriu o ticket em A fazer')
    this.data.tickets.push(t)
    this.closedDirty = true
    this.changed(t)
    return t
  }

  // ---------- helpers ----------

  private setStatus(t: Ticket, status: TicketStatus, by: Actor): void {
    this.log(t, by, `moveu de ${labelOf(STATUSES, t.status)} para ${labelOf(STATUSES, status)}`)
    t.status = status
    t.order = this.nextOrder(status)
    if (status === 'done') t.doneAt = Date.now()
    else delete t.doneAt
  }

  private column(status: TicketStatus): Ticket[] {
    return this.data.tickets.filter((t) => t.status === status).sort((a, b) => a.order - b.order)
  }

  private nextOrder(status: TicketStatus): number {
    return this.column(status).reduce((m, t) => Math.max(m, t.order + 1), 0)
  }

  private must(id: string): Ticket {
    const t = this.get(id)
    if (!t) throw new Error('Esse ticket não existe mais.')
    return t
  }

  private log(t: Ticket, actor: Actor, text: string): void {
    t.activity.push({ id: randomUUID(), t: Date.now(), actor, text })
    if (t.activity.length > MAX_ACTIVITY) t.activity.splice(0, t.activity.length - MAX_ACTIVITY)
  }

  private changed(t: Ticket, touch = true): void {
    if (touch) t.updatedAt = Date.now()
    this.emitEvent({ type: 'ticket:upsert', ticket: structuredClone(t) })
    this.save()
  }

  private emitEvent(e: OfficeEvent): void {
    this.emit('event', e)
  }

  private save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.locked) return
    writeJsonAtomic(this.file, this.data)
    if (this.closedDirty && this.closedData) {
      writeJsonAtomic(this.closedFile, { tickets: this.closedData })
      this.closedDirty = false
    }
  }

  /** Writes what is pending, then stops writing for good (the app restarts next). */
  lock(): void {
    this.flush()
    this.locked = true
  }

  // ---------- agent tools ----------

  /**
   * In-process MCP server an office agent uses to work the board as itself.
   * Agents can open, read, comment and move tickets up to review; closing ("done")
   * stays with the people who review the work.
   */
  toolsFor(agent: AgentSummary, projects: () => ProjectFloor[]): McpSdkServerConfigWithInstance {
    const me: Actor = { kind: 'agent', name: agent.name, id: agent.id }
    // Each project floor has its own board: by default an agent sees the tickets of the floor it works on.
    const onMyFloor = (t: Ticket) => projectFor(projects(), t.cwd)?.id === agent.project
    const find = (key: string) => {
      const t = this.byKey(key)
      if (!t && this.byKey(key, true)) throw new Error(`${key} está fechado: só dá para ler (ticket_get). Peça para uma pessoa reabrir se precisar mexer.`)
      if (!t) throw new Error(`Não achei o ticket ${key}. Use tickets_list para ver as chaves.`)
      return t
    }
    const run = (fn: () => string) => async () => {
      try {
        return { content: [{ type: 'text' as const, text: fn() }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }], isError: true }
      }
    }
    const agentStatus = z.enum(['backlog', 'todo', 'doing', 'review'])

    return createSdkMcpServer({
      name: 'office',
      version: '1.0.0',
      instructions:
        'Quadro kanban do escritório (Agent Office). Colunas: backlog, todo (a fazer), doing (fazendo), review (revisão), done (feito). ' +
        'Tickets têm chave curta como AO-12. Cada andar (projeto) tem o seu quadro: tickets_list mostra só os do seu andar, a não ser que peça all_floors. ' +
        'Crie tickets quando o usuário pedir ou quando achar trabalho que não cabe na tarefa atual. ' +
        'Um bom ticket se explica sozinho: título no imperativo, contexto com arquivos e passos de reprodução, critérios de aceite verificáveis. ' +
        'Só pessoas movem para done. Tickets fechados (arquivados depois de done) saem do quadro: consulte só quando precisar, com tickets_list closed=true ou ticket_get.',
      tools: [
        tool(
          'tickets_list',
          'Lista tickets do quadro, com filtros opcionais. Devolve uma linha por ticket.',
          {
            status: z.array(z.enum(STATUS_VALUES)).optional().describe('Colunas a incluir; omita para todas menos done'),
            search: z.string().optional().describe('Texto no título, descrição ou tags'),
            mine: z.boolean().optional().describe('Só os tickets atribuídos a você'),
            closed: z.boolean().optional().describe('Busca nos tickets fechados (arquivo) em vez do quadro; combine com search'),
            all_floors: z.boolean().optional().describe('Inclui os tickets de todos os andares; padrão: só os do seu andar'),
          },
          (args) =>
            run(() => {
              const floor = (t: Ticket) => args.all_floors || onMyFloor(t)
              const others = args.all_floors ? '' : ' neste andar. Use all_floors=true para ver os outros andares'
              if (args.closed) {
                const found = this.listClosed(args.search, 50).filter((t) => floor(t) && (!args.mine || t.assignee?.id === agent.id))
                return found.length ? found.map((t) => `${listLine(t)} · fechado`).join('\n') : `Nenhum ticket fechado com esses filtros${others}.`
              }
              const q = args.search?.toLowerCase().trim()
              const shown = this.list()
                .filter(floor)
                .filter((t) => (args.status?.length ? args.status.includes(t.status) : t.status !== 'done'))
                .filter((t) => !args.mine || t.assignee?.id === agent.id)
                .filter((t) => !q || [t.title, t.description, ...t.tags].some((v) => v.toLowerCase().includes(q)))
                .sort((a, b) => STATUS_VALUES.indexOf(a.status) - STATUS_VALUES.indexOf(b.status) || a.order - b.order)
              if (!shown.length) return `Nenhum ticket com esses filtros${others}.`
              return shown.map(listLine).join('\n')
            })(),
          { annotations: { readOnlyHint: true } },
        ),
        tool(
          'ticket_get',
          'Lê um ticket completo: contexto, critérios de aceite, comentários e status.',
          { key: z.string().describe('Chave do ticket, ex.: AO-12') },
          (args) =>
            run(() => {
              const t = this.byKey(args.key, true)
              if (!t) throw new Error(`Não achei o ticket ${args.key}. Use tickets_list para ver as chaves.`)
              const head = `Status: ${t.closedAt ? 'fechado' : t.status} · Responsável: ${t.assignee?.name ?? 'ninguém'}${t.cwd ? ` · Pasta: ${t.cwd}` : ''}`
              return `${head}\n\n${ticketBrief(t)}`
            })(),
          { annotations: { readOnlyHint: true } },
        ),
        tool(
          'ticket_create',
          'Abre um ticket no quadro. Escreva em pt-BR, com contexto suficiente para outro agente fazer o trabalho sem perguntar.',
          {
            title: z.string().describe('Curto e no imperativo: "Corrigir FITID duplicado na importação OFX"'),
            type: z.enum(TYPE_VALUES).default('task'),
            priority: z.enum(PRIORITY_VALUES).default('medium'),
            description: z.string().describe('Markdown: contexto, arquivos relevantes, passos de reprodução, trechos de erro'),
            acceptance: z.array(z.string()).default([]).describe('Critérios de aceite verificáveis, um por item'),
            tags: z.array(z.string()).default([]),
            status: z.enum(['backlog', 'todo']).default('backlog'),
            cwd: z.string().optional().describe('Pasta do projeto; padrão: a sua pasta atual'),
            estimate: z.number().optional().describe('Pontos de esforço'),
          },
          (args) =>
            run(() => {
              const cwd = args.cwd ?? agent.cwd
              const t = this.create(
                {
                  title: args.title,
                  type: args.type,
                  priority: args.priority,
                  description: args.description,
                  acceptance: args.acceptance.map((text) => ({ text, done: false })),
                  tags: args.tags,
                  status: args.status,
                  cwd: isDir(cwd) ? cwd : undefined,
                  estimate: args.estimate,
                },
                me,
              )
              return `Criei ${t.key}: ${t.title} (${labelOf(STATUSES, t.status)}).`
            })(),
        ),
        tool(
          'ticket_update',
          'Muda status, prioridade, título ou descrição de um ticket. Ao terminar um ticket, mova para review.',
          {
            key: z.string(),
            status: agentStatus.optional(),
            priority: z.enum(PRIORITY_VALUES).optional(),
            title: z.string().optional(),
            description: z.string().optional().describe('Substitui a descrição inteira'),
          },
          (args) =>
            run(() => {
              const t = find(args.key)
              this.update(t.id, { status: args.status, priority: args.priority, title: args.title, description: args.description }, me)
              return `${t.key} atualizado: ${labelOf(STATUSES, t.status)}, prioridade ${labelOf(PRIORITIES, t.priority)}.`
            })(),
        ),
        tool(
          'ticket_check',
          'Marca critérios de aceite como cumpridos (ou reabre). Posições começam em 1.',
          { key: z.string(), items: z.array(z.number().int()), done: z.boolean().default(true) },
          (args) =>
            run(() => {
              const t = this.check(find(args.key).id, args.items, args.done, me)
              const ok = t.acceptance.filter((c) => c.done).length
              return `${t.key}: ${ok}/${t.acceptance.length} critérios cumpridos.`
            })(),
        ),
        tool(
          'ticket_comment',
          'Comenta num ticket: progresso, decisões, bloqueios, o que falta.',
          { key: z.string(), text: z.string() },
          (args) =>
            run(() => {
              const t = this.comment(find(args.key).id, args.text, me)
              return `Comentei em ${t.key}.`
            })(),
        ),
      ],
    })
  }
}

function listLine(t: Ticket): string {
  const ok = t.acceptance.filter((c) => c.done).length
  const crit = t.acceptance.length ? ` · ${ok}/${t.acceptance.length} critérios` : ''
  const who = t.assignee ? ` · com ${t.assignee.name}` : ''
  return `${t.key} [${t.status}] ${t.title} (${t.type}, ${t.priority}${crit}${who})`
}

function isDir(p: string | undefined | null): p is string {
  try {
    return !!p && existsSync(p) && statSync(p).isDirectory()
  } catch {
    return false
  }
}

function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : ''
}

function oneOf<T extends string>(v: unknown, values: readonly T[]): T | undefined {
  return values.includes(v as T) ? (v as T) : undefined
}

/** Input from IPC or agent tools is untrusted: keep only known fields, in range. */
function cleanDraft(d: TicketPatch, creating: boolean): TicketPatch {
  if (!d || typeof d !== 'object') throw new Error('Ticket inválido.')
  const out: TicketPatch = {}
  if (d.title !== undefined || creating) {
    const title = cleanText(d.title, MAX_TITLE).replace(/\s+/g, ' ')
    if (!title) throw new Error('Dê um título ao ticket.')
    out.title = title
  }
  if (d.type !== undefined) out.type = oneOf(d.type, TYPE_VALUES)
  if (d.priority !== undefined) out.priority = oneOf(d.priority, PRIORITY_VALUES)
  if (d.status !== undefined) out.status = oneOf(d.status, STATUS_VALUES)
  if (d.description !== undefined) out.description = cleanText(d.description, MAX_TEXT)
  if (d.acceptance !== undefined) {
    if (!Array.isArray(d.acceptance)) throw new Error('Critérios de aceite inválidos.')
    out.acceptance = d.acceptance
      .map((c: Partial<Criterion>) => ({ text: cleanText(c?.text, 500).replace(/\s+/g, ' '), done: c?.done === true }))
      .filter((c) => c.text)
      .slice(0, MAX_CRITERIA)
  }
  if (d.tags !== undefined) {
    if (!Array.isArray(d.tags)) throw new Error('Tags inválidas.')
    const tags = d.tags.map((t) => cleanText(t, 30).toLowerCase().replace(/\s+/g, '-')).filter(Boolean)
    out.tags = [...new Set(tags)].slice(0, MAX_TAGS)
  }
  if (d.cwd !== undefined) {
    if (d.cwd && !isDir(d.cwd)) throw new Error('A pasta do projeto não existe.')
    out.cwd = d.cwd || null
  }
  if (d.estimate !== undefined) {
    const n = Number(d.estimate)
    out.estimate = d.estimate === null || !Number.isFinite(n) || n <= 0 ? null : Math.min(100, Math.round(n * 10) / 10)
  }
  if (d.dueDate !== undefined) out.dueDate = typeof d.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.dueDate) ? d.dueDate : null
  return out
}
