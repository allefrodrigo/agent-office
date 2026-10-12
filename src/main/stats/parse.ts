import type { ModelTokens } from '@shared/types'

/** One assistant line of a transcript, reduced to its counts, and token arithmetic. */

export type Tokens = Omit<ModelTokens, 'costUsd'> & { costUsd: number }

export const zeroTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, webSearch: 0, messages: 0, costUsd: 0 })
export const tokenSum = (t: Omit<ModelTokens, 'messages' | 'costUsd'>) => t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export function addTokens(into: Tokens, t: Tokens): void {
  into.input += t.input
  into.output += t.output
  into.cacheRead += t.cacheRead
  into.cacheWrite5m += t.cacheWrite5m
  into.cacheWrite1h += t.cacheWrite1h
  into.webSearch += t.webSearch
  into.messages += t.messages
  into.costUsd += t.costUsd
}

/** The part of an assistant line we use. Everything else (the conversation) is dropped right away. */
export interface Line {
  sessionId: string
  t: number
  key?: string
  model: string
  tokens: Tokens
  fast: boolean
  toolCalls: number
}

export function parseLine(raw: string): Line | null {
  // Cheap filter before JSON.parse: most lines are user turns, tool results, metadata.
  if (!raw.includes('"type":"assistant"')) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (o.type !== 'assistant') return null
  const msg = o.message as Record<string, unknown> | undefined
  const model = typeof msg?.model === 'string' ? msg.model : ''
  if (!msg || !model || model === '<synthetic>') return null
  const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
  const sessionId = typeof o.sessionId === 'string' ? o.sessionId : ''
  if (!Number.isFinite(t) || !sessionId) return null
  const u = (msg.usage ?? {}) as Record<string, unknown>
  const cc = (u.cache_creation ?? {}) as Record<string, unknown>
  const w1h = num(cc.ephemeral_1h_input_tokens)
  const w5m = cc.ephemeral_5m_input_tokens !== undefined ? num(cc.ephemeral_5m_input_tokens) : Math.max(0, num(u.cache_creation_input_tokens) - w1h)
  const stu = (u.server_tool_use ?? {}) as Record<string, unknown>
  const tokens: Tokens = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite5m: w5m,
    cacheWrite1h: w1h,
    webSearch: num(stu.web_search_requests),
    messages: 1,
    costUsd: 0,
  }
  const content = Array.isArray(msg.content) ? (msg.content as { type?: string }[]) : []
  const id = typeof msg.id === 'string' ? msg.id : ''
  const req = typeof o.requestId === 'string' ? o.requestId : ''
  return {
    sessionId,
    t,
    key: id || req ? `${id}|${req}` : undefined,
    model,
    tokens,
    fast: u.speed === 'fast',
    toolCalls: content.filter((c) => c?.type === 'tool_use').length,
  }
}
