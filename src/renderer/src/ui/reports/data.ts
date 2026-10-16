import type { SpendSplit } from '@shared/economy'
import { formatCost } from '../dom'

/** Numbers of the Relatórios: totals, dates, money and token formats. */

/** 'YYYY-MM-DD' in local time, `offset` days from today. */
export function dayKey(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const dateOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "qui, 9 out" */
export const dayLong = (day: string) => dateOf(day).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')

export const usd = (n: number) => formatCost(n) || '$0,00'
export const int = (n: number) => Math.round(n).toLocaleString('pt-BR')

/** "5h12", "42min", "30s", "—". */
export function workTime(ms: number): string {
  const s = Math.round(ms / 1000)
  if (!s) return '—'
  if (s < 60) return `${s}s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min}min`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

/** "claude-opus-4-1-20250805" -> "opus 4.1" */
export function modelName(id: string): string {
  return id.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[1m\]$/, ' 1M').replace(/-(\d+)-(\d+)\b/, ' $1.$2').replace(/-(\d+)\b/, ' $1')
}

/** A project of the report: a floor, or a folder outside the floors. */
export interface Group {
  key: string
  name: string
  color: string
  title: string
}

export interface Totals {
  cost: number
  turns: number
  durationMs: number
  results: number
}

export const zero = (): Totals => ({ cost: 0, turns: 0, durationMs: 0, results: 0 })

export interface Report {
  days: string[]
  total: Totals
  prevCost: number
  /** day -> group key -> USD */
  byDay: Map<string, Map<string, number>>
  groups: Map<string, Totals & { byDay: Map<string, number> }>
  agents: Map<string, Totals & { groups: Set<string> }>
  models: Map<string, { cost: number; output: number }>
  /** Where the money went (cache reads, cache writes, output, plain input) and the tokens read from the cache. */
  split: SpendSplit & { readTokens: number }
}

export function add(t: Totals, d: { costUsd: number; turns: number; durationMs: number; results: number }): void {
  t.cost += d.costUsd
  t.turns += d.turns
  t.durationMs += d.durationMs
  t.results += d.results
}

export function sum(xs: Iterable<number>): number {
  let s = 0
  for (const x of xs) s += x
  return s
}

/** "▲ 12%" (spent more: red), "▼ 8%" (green); null without a base. */
export function variation(now: number, before: number): { text: string; tone: 'up' | 'down' | 'flat' } | null {
  if (before < 0.005) return null
  const pct = Math.round(((now - before) / before) * 100)
  if (pct === 0) return { text: '= 0%', tone: 'flat' }
  return pct > 0 ? { text: `▲ ${pct}%`, tone: 'up' } : { text: `▼ ${Math.abs(pct)}%`, tone: 'down' }
}

/** 1,2 mi · 340 mil · 512 */
export function tokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} mi`
  if (n >= 1e3) return `${Math.round(n / 1e3)} mil`
  return String(n)
}
