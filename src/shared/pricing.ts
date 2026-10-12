import type { ModelTokens } from './types'

/**
 * Claude API list prices in USD per million tokens, kept by hand.
 * Source: Anthropic pricing as of 2026-10 (claude-api skill, cached 2026-10-06).
 * Cache writes follow the published multipliers: 1.25x input for 5 minutes, 2x for 1 hour.
 * Subscription users are not billed these: the app shows them as "API equivalent".
 */
export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  /** Price changes above this many prompt tokens per request (Haiku 5.5). */
  longPrompt?: { over: number; input: number; output: number }
  /** Some number in this row is derived, not published. */
  estimate?: boolean
}

const p = (input: number, output: number, cacheRead: number, extra: Partial<ModelPrice> = {}): ModelPrice => ({ input, output, cacheRead, ...extra })

/** Longest prefix wins, so dated ids ("claude-haiku-4-5-20251001") find their family. */
const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': p(10, 50, 0.25),
  'claude-mythos-5-1': p(10, 50, 0.25),
  'claude-fable-5': p(10, 50, 1),
  'claude-mythos-5': p(10, 50, 1),
  'claude-opus-5-5': p(4, 20, 0.2),
  'claude-opus-5': p(5, 25, 0.5),
  'claude-opus-4-8': p(5, 25, 0.5),
  'claude-opus-4-7': p(5, 25, 0.5),
  'claude-opus-4-6': p(5, 25, 0.5),
  'claude-sonnet-5-5': p(2, 10, 0.2),
  'claude-sonnet-5': p(2, 10, 0.2),
  'claude-sonnet-4-6': p(3, 15, 0.3),
  // Cache reads for Haiku 5.5 are not in the table we have: 0.1x input, like most models.
  'claude-haiku-5-5': p(0.1, 0.5, 0.01, { longPrompt: { over: 100_000, input: 0.5, output: 2.5 }, estimate: true }),
  'claude-haiku-4-5': p(1, 5, 0.1),
}

/** Web search: $10 per 1,000 searches. */
const WEB_SEARCH_USD = 0.01
/** Fast mode on Opus 5 / 5.5 costs twice the standard rate. */
const FAST_FACTOR = 2

export function priceOf(model: string): ModelPrice | undefined {
  const id = model.replace(/\[1m\]$/i, '').toLowerCase()
  let best: string | undefined
  for (const key of Object.keys(PRICES)) if ((id === key || id.startsWith(key + '-')) && (!best || key.length > best.length)) best = key
  return best ? PRICES[best] : undefined
}

/** USD for one API response, or undefined when the model has no price. */
export function messageCost(model: string, u: Omit<ModelTokens, 'messages' | 'costUsd'>, fast = false): number | undefined {
  const price = priceOf(model)
  if (!price) return undefined
  const prompt = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h
  const long = price.longPrompt && prompt > price.longPrompt.over ? price.longPrompt : undefined
  const input = long?.input ?? price.input
  const output = long?.output ?? price.output
  const cacheRead = long ? (price.cacheRead / price.input) * input : price.cacheRead
  const usd =
    (u.input * input + u.output * output + u.cacheRead * cacheRead + u.cacheWrite5m * input * 1.25 + u.cacheWrite1h * input * 2) / 1_000_000
  return usd * (fast ? FAST_FACTOR : 1) + u.webSearch * WEB_SEARCH_USD
}
