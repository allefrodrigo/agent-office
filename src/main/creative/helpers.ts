import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CreativeJob, PortValue } from '@shared/creative'
import { runClaude } from './claude'
import { parseJsonAnswer, runCodex } from './codex'

// What every studio node shares: the run context, text work on the chosen engine, names and inputs.

export interface NodeRunCtx {
  /** The creative floor's folder. */
  root: string
  signal: AbortSignal
  progress(text: string): void
  /** Environment for Claude on the floor's account (CLAUDE_CONFIG_DIR). */
  claudeEnv: NodeJS.ProcessEnv
}

/** Text work (analysis, writing) on the engine the node picked: Claude by default, Codex when asked. */
export async function think(
  engine: unknown,
  run: { prompt: string; cwd: string; images: string[]; schema?: Record<string, unknown> },
  ctx: NodeRunCtx,
): Promise<{ text: string; structured?: unknown; by: string }> {
  if (engine === 'codex') {
    let schemaFile: string | undefined
    if (run.schema) {
      schemaFile = join(run.cwd, 'resposta.schema.json')
      writeFileSync(schemaFile, JSON.stringify(run.schema))
    }
    const r = await runCodex({ prompt: run.prompt, cwd: run.cwd, images: run.images, schemaFile, signal: ctx.signal, onProgress: ctx.progress })
    return { text: r.message, structured: run.schema ? parseJsonAnswer(r.message) : undefined, by: 'ChatGPT' }
  }
  const model = engine === 'claude-opus' ? 'opus' : engine === 'claude-haiku' ? 'haiku' : 'sonnet'
  ctx.progress(`Claude ${model} está pensando…`)
  const r = await runClaude({ prompt: run.prompt, cwd: run.cwd, model, images: run.images, schema: run.schema, env: ctx.claudeEnv, signal: ctx.signal, onProgress: ctx.progress })
  return { text: r.text, structured: r.structured ?? (run.schema ? parseJsonAnswer(r.text) : undefined), by: `Claude ${model} · US$ ${r.costUsd.toFixed(2)}` }
}

export const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
export const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'criativo'

export const texts = (v: PortValue[] | undefined) =>
  (v ?? [])
    .map((x) => (x.type === 'text' ? x.text : x.type === 'post' ? `${x.post.legenda}\n\n${x.post.hashtags.map((t) => `#${t}`).join(' ')}` : ''))
    .filter((t) => t.trim())
export const imagesOf = (v: PortValue[] | undefined) => (v ?? []).flatMap((x) => (x.type === 'image' ? x.paths : [])).filter((p) => existsSync(p))
export const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const int = (v: unknown, min: number, max: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt)

export function runDir(root: string, job: CreativeJob): string {
  const dir = join(root, '.criativo', 'runs', `${job.nodeId}-${stamp()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

