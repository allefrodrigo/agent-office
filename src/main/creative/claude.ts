import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { claudeNotFoundMessage } from '../claude-messages'
import { findClaude } from '../claude-path'
import { toJpegSmall } from './media'

// One Claude turn for the studio (analysis and writing): images go inline in the message,
// and only read tools are allowed, so it can look at folders the brief names and nothing else.

export interface ClaudeRun {
  prompt: string
  cwd: string
  /** 'sonnet' | 'opus' | 'haiku' (CLI aliases). */
  model: string
  images?: string[]
  /** Structured answer (outputFormat json_schema). */
  schema?: Record<string, unknown>
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
  onProgress?(text: string): void
}

export interface ClaudeOutcome {
  text: string
  structured?: unknown
  costUsd: number
}

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LS']

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
  const q = query({
    prompt: input(),
    options: {
      cwd: run.cwd,
      model: run.model,
      pathToClaudeCodeExecutable: claude,
      abortController: abort,
      persistSession: false,
      // only the read tools exist in this session: fewer tool definitions, fewer tokens
      tools: READ_TOOLS,
      permissionMode: 'default',
      // anything that writes or runs is refused: the studio only reads
      canUseTool: async (tool, toolInput) => (READ_TOOLS.includes(tool) ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: 'No estúdio você só lê arquivos.' }),
      settingSources: [],
      maxTurns: 12,
      ...(run.schema ? { outputFormat: { type: 'json_schema' as const, schema: run.schema } } : {}),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'You are a creative strategist inside a creative studio. Answer in Brazilian Portuguese. Never edit files.' },
      env: { ...run.env, AGENT_OFFICE_MANAGED: '1' },
    },
  })
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
        return { text: m.result, structured: m.structured_output, costUsd: m.total_cost_usd }
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
