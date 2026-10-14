import { type FSWatcher } from 'node:fs'
import { type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSummary, LogEntry, PermissionDecision, PermissionRequest } from '@shared/types'
import { type SquadDefinition } from '../squads'
import { type Snapshot } from '../git'
import { Coalescer, SubagentLogs } from '../subagent-log'

// What the parts of the AgentManager share: the agent record, the input queue and small formatters.

export const LOG_LIMIT = 400
export const PERSISTED_LOG = 150
export const DESK_COUNT = 10

/** A plain string, or content blocks when the message carries attachments. */
export type Prompt = SDKUserMessage['message']['content']

/** Async queue that feeds user messages into a streaming-input query. */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(content: Prompt): void {
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w({ value: msg, done: false })
    } else this.items.push(msg)
  }

  close(): void {
    this.closed = true
    this.waiting?.({ value: undefined, done: true })
    this.waiting = null
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      },
    }
  }
}

export interface Agent {
  summary: AgentSummary
  log: LogEntry[]
  input?: InputQueue
  query?: Query
  /** Session already exists on disk, so the next start must resume it. */
  started: boolean
  /** Running /compact: its result is housekeeping, not a report for the player. */
  compacting?: boolean
  /** The account ran out of plan during this turn; resetsAt in ms when known. */
  limitHit?: { resetsAt?: number }
  /** Account the player picked outside the pool after a limit; used while the pool has no room. */
  borrowed?: string
  /** Orchestrators: the squad, read again from disk before each run. */
  squad?: SquadDefinition
  /** Orchestrators: watches squads/<code>/state.json. */
  watcher?: FSWatcher
  /** Demo mode: simulated, never saved. */
  demo?: boolean
  /** The task under way: the folder as it was when it started, and the files the Edit/Write tools touched. */
  /** `ready`: the snapshot finished, so the CLI may start (and runs again without waiting). */
  task?: { snapshot: Promise<Snapshot | null>; touched: Map<string, string>; ready?: boolean }
  /** run() is waiting for task.snapshot before starting the CLI; input already exists. */
  awaitingSnapshot?: boolean
  /** Logs of its subagents (AO-46), in memory only. */
  subs?: SubagentLogs
  /** Groups subagent updates into one IPC burst every ~250 ms. */
  subFlush?: Coalescer
  /** A subagent card changed since the last burst: send the summary again. */
  subDirty?: boolean
}

/** Tools whose file_path the card lists when the folder has no git. */
export const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

export interface Pending {
  request: PermissionRequest
  resolve: (d: PermissionDecision) => void
}

/** Sent after moving to another account, so the agent picks up the interrupted turn. */
export const CONTINUE_PROMPT =
  'Continue de onde parou. A conta anterior atingiu o limite do plano no meio da tarefa; esta é outra conta, com o mesmo histórico.'

/** Rate limit resets come in seconds. */
export function toMs(t: number | undefined): number | undefined {
  if (!t) return undefined
  return t < 1e12 ? t * 1000 : t
}

/** 14:30 */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** $0.42 */
export function usd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function kTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}
