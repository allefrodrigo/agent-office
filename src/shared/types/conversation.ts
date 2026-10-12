// What an agent says and asks: log entries, attachments, permissions and results.

import type { ResultChanges } from './agents'

export type LogKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_result' | 'system' | 'error' | 'result' | 'decision'

export interface LogEntry {
  id: string
  t: number
  kind: LogKind
  text: string
  tool?: string
  isError?: boolean
  /** Files sent with a user message: names only, never the content. */
  attachments?: AttachmentInfo[]
}

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'file'

/** A file sent with a message. Files from disk travel as a path; pasted images as base64. */
export interface AttachmentInput {
  name: string
  /** What the browser claims; the main process checks the bytes instead. */
  mime?: string
  path?: string
  dataBase64?: string
}

export interface AttachmentInfo {
  name: string
  kind: AttachmentKind
  size: number
}

export interface AskQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

export interface PermissionRequest {
  id: string
  agentId: string
  /** tool = approve a tool call; question = AskUserQuestion; plan = ExitPlanMode */
  kind: 'tool' | 'question' | 'plan'
  toolName: string
  title: string
  detail: string
  input: Record<string, unknown>
  questions?: AskQuestion[]
  plan?: string
  reason?: string
  /** Where the request comes from, e.g. "Ciclo de Produto · Passo 1 · Foco da semana". */
  context?: string
  /** Set when a subagent (Agent tool) of this agent asked, not the agent itself: what that subagent is doing, or '' when unknown. */
  subagent?: string
  canAlwaysAllow: boolean
  createdAt: number
}

export interface PermissionDecision {
  requestId: string
  behavior: 'allow' | 'allow_always' | 'deny'
  message?: string
  /** For AskUserQuestion: question text -> chosen label(s), comma separated. */
  answers?: Record<string, string>
}

export interface AgentResult {
  id: string
  agentId: string
  text: string
  isError: boolean
  costUsd: number
  durationMs: number
  turns: number
  createdAt: number
  /** Files the task changed; arrives a moment after the result (result:changes). */
  changes?: ResultChanges
}
