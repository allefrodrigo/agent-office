import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { claudeNotFoundMessage } from './claude-messages'
import { findClaude } from './claude-path'
import { toJpegSmall } from './creative/media'
import type { CategoryCharge, LedgerCategory } from './ledger'

// One Claude turn with no saved session, on the floor's Claude Code account: the studio's
// analysis and writing, a meeting's minutes. The caller gives the system prompt. Images go inline
// in the message. Without readRoots the session has no tools at all; with them, only read tools,
// and only inside those folders.

/** What runClaude needs from the cost book (CostBook fits). */
export interface CategoryBook {
  recordCategory(category: LedgerCategory, charge: CategoryCharge): number
}

export interface ClaudeRun {
  prompt: string
  /** Appended to the Claude Code preset system prompt. */
  system: string
  cwd: string
  /** 'sonnet' | 'opus' | 'haiku' (CLI aliases). Default 'sonnet'. */
  model?: string
  images?: string[]
  /** Structured answer (outputFormat json_schema). */
  schema?: Record<string, unknown>
  env: NodeJS.ProcessEnv
  /** Folders Claude may read. Missing or empty = no tools at all. */
  readRoots?: string[]
  /** Why a read was refused, shown to Claude. */
  denyMessage?: string
  /** Book the call's cost in the cost book under a category (e.g. 'reunioes'). */
  ledger?: { book: CategoryBook; category: LedgerCategory; cwd: string; account?: string }
  signal?: AbortSignal
  onProgress?(text: string): void
}

export interface ClaudeOutcome {
  text: string
  structured?: unknown
  costUsd: number
}

export const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LS']

// Never readable, even inside an allowed folder: keys, tokens, logins, env files.
const SECRET = /(^|[\\/])(\.ssh|\.aws|\.gnupg|\.config|\.claude[^\\/]*|\.codex|\.docker|\.kube|\.netrc|Keychains|\.env[^\\/]*|[^\\/]*\.(pem|key|p12|pfx)|id_[a-z0-9]+|credentials[^\\/]*|[^\\/]*secret[^\\/]*|[^\\/]*token[^\\/]*)([\\/]|$)/i

const lexists = (p: string): boolean => {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

/**
 * realpath of the deepest part that exists, plus the rest (a file not made yet still resolves its folder's links).
 * A link to nowhere gives null: it can't be checked, so it is never readable.
 */
const real = (p: string): string | null => {
  const parts: string[] = []
  let cur = p
  while (!lexists(cur)) {
    const up = dirname(cur)
    if (up === cur) return p
    parts.unshift(basename(cur))
    cur = up
  }
  try {
    return join(realpathSync(cur), ...parts)
  } catch {
    return null
  }
}

/** A path a read tool asked for is inside one of the roots and is not a secret. */
export function readable(raw: unknown, cwd: string, roots: string[]): boolean {
  if (typeof raw !== 'string' || !raw) return true
  // glob patterns: check the fixed part before the first wildcard
  const fixed = raw.split(/[*?[{]/)[0]
  const p = real(resolve(cwd, fixed || '.'))
  if (!p || SECRET.test(p) || SECRET.test(raw)) return false
  return roots.some((r) => {
    const root = real(r)
    return !!root && (p === root || p.startsWith(root.endsWith(sep) ? root : root + sep))
  })
}

/** Absolute folders and files named in the player's text, minus the home folder itself and secrets. */
export function pathsIn(texts: string[]): string[] {
  const home = homedir()
  const out = new Set<string>()
  for (const t of texts)
    // ~/x, /x and, on Windows, C:\x or C:/x
    for (const m of t.matchAll(/(?:~|(?<![\w])[A-Za-z]:(?=[\\/])|\/)[^\s"'`,;()<>]+/g)) {
      const named = m[0].replace(/^~/, home).replace(/[.:]+$/, '')
      if (!isAbsolute(named)) continue
      const p = resolve(named)
      if (p !== home && p !== '/' && p.split(sep).length > 3 && existsSync(p) && !SECRET.test(p)) out.add(p)
    }
  return [...out].slice(0, 10)
}

const DENY = 'Você só pode ler as pastas liberadas para esta tarefa, nunca chaves ou credenciais.'

/** The SDK options of a run: tools, permission guard, system prompt. Pure, so the no-tools rule is testable. */
export function claudeOptions(run: ClaudeRun, claudePath: string, abort: AbortController): Options {
  const roots = run.readRoots ?? []
  return {
    cwd: run.cwd,
    model: run.model ?? 'sonnet',
    pathToClaudeCodeExecutable: claudePath,
    abortController: abort,
    persistSession: false,
    // only the read tools exist in this session (none without roots): fewer tool definitions, fewer tokens
    tools: roots.length ? READ_TOOLS : [],
    permissionMode: 'default',
    // reads only, and only inside the roots: a transcript or a pasted brief can carry instructions
    canUseTool: async (tool, toolInput) => {
      const i = toolInput as { file_path?: string; path?: string; pattern?: string }
      const ok = READ_TOOLS.includes(tool) && roots.length > 0 && [i.file_path, i.path, tool === 'Glob' ? i.pattern : undefined].every((p) => readable(p, run.cwd, roots))
      return ok ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: run.denyMessage ?? DENY }
    },
    settingSources: [],
    maxTurns: 12,
    ...(run.schema ? { outputFormat: { type: 'json_schema' as const, schema: withoutSchemaUrl(run.schema) } } : {}),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: run.system },
    env: { ...run.env, AGENT_OFFICE_MANAGED: '1' },
  }
}

export async function runClaude(run: ClaudeRun): Promise<ClaudeOutcome> {
  const claude = findClaude()
  if (!claude) throw new Error(claudeNotFoundMessage(process.platform))
  // Claude takes images up to ~5 MB each: send JPEGs of 1024 px at most.
  const blocks: SDKUserMessage['message']['content'] = []
  for (const [i, img] of (run.images ?? []).entries()) {
    const small = join(run.cwd, `claude-${String(i + 1).padStart(2, '0')}.jpg`)
    await toJpegSmall(img, small)
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(small).toString('base64') } })
  }
  blocks.push({ type: 'text', text: run.prompt })
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content: blocks }, parent_tool_use_id: null, session_id: '' }
  }

  const abort = new AbortController()
  const stop = () => abort.abort()
  run.signal?.addEventListener('abort', stop, { once: true })
  const q = query({ prompt: input(), options: claudeOptions(run, claude, abort) })
  try {
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const c of m.message.content) {
          if (c.type === 'tool_use' && c.name === 'StructuredOutput') run.onProgress?.('Claude está montando a resposta…')
          else if (c.type === 'tool_use') run.onProgress?.(`Claude está lendo: ${String((c.input as { file_path?: string; pattern?: string }).file_path ?? (c.input as { pattern?: string }).pattern ?? c.name).slice(0, 90)}`)
          else if (c.type === 'text' && c.text.trim()) run.onProgress?.(c.text.trim().split('\n')[0].slice(0, 140))
        }
      } else if (m.type === 'result') {
        if (m.subtype !== 'success') throw new Error(`O Claude parou: ${m.subtype.replace(/_/g, ' ')}.`)
        if (m.is_error) throw new Error(`O Claude falhou: ${m.result.slice(0, 300)}`)
        const costUsd = m.total_cost_usd || 0
        if (run.ledger) {
          const { book, category, cwd, account } = run.ledger
          // a cost book that fails must not lose an answer already paid for
          try {
            book.recordCategory(category, { cwd, account, costUsd, modelUsage: m.modelUsage, turns: m.num_turns, durationMs: m.duration_ms })
          } catch (err) {
            console.warn(`[claude-run] custo não registrado: ${(err as Error).message}`)
          }
        }
        return { text: m.result, structured: m.structured_output, costUsd }
      }
    }
  } catch (err) {
    if (run.signal?.aborted) throw new Error('Cancelado.', { cause: err })
    throw err
  } finally {
    run.signal?.removeEventListener('abort', stop)
  }
  throw new Error('O Claude terminou sem resposta. Rode de novo.')
}

/** The CLI only knows the draft it bundles: a `$schema` URL from another draft makes it refuse the schema. */
export function withoutSchemaUrl(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _drop, ...rest } = schema
  return rest
}
