import type { AtaBlock, Meeting, MeetingTemplate, Segment } from '@shared/types/meetings'
import { ATA_JSON_SCHEMA, ATA_SYSTEM, ataToMarkdown, buildAtaPrompt, dropBadRefs, ensureNotes, mergeRegenerate, parseAta, userNotes } from '@shared/meetings-ata'
import { runClaude, type CategoryBook } from '../claude-run'

// Gera a ata de uma reunião com o Claude, na conta do andar. Sem readRoots: sem ferramenta nenhuma,
// porque a transcrição é fala de terceiros (WARNING de prompt injection na spec).

export const LIMIT_MESSAGE = 'O plano do Claude chegou ao limite. A ata pode ser gerada depois.'

export interface AtaInput {
  meeting: Meeting
  notes: string
  segments: Segment[]
  template: MeetingTemplate
  /** Blocos da ata anterior: regerar mantém os `user` e troca os da IA. */
  previous?: AtaBlock[]
  /** accountEnv(accounts.pick(...)) do andar. */
  env: NodeJS.ProcessEnv
  cwd: string
  account?: string
  book: CategoryBook
  /** 'sonnet' por padrão; 'opus' se o usuário pedir. */
  model?: string
  onProgress?(text: string): void
  signal?: AbortSignal
}

export interface AtaResult {
  title: string
  blocks: AtaBlock[]
  markdown: string
  costUsd: number
}

/** Limite do plano, como o SDK e a API o descrevem (o mesmo que agents/sdk.ts trata como limitHit). */
export function isLimitError(message: string): boolean {
  return /rate[_ ]limit|usage limit|hit your limit|limit reached|\b429\b/i.test(message)
}

export async function generateAta(input: AtaInput): Promise<AtaResult> {
  const { meeting, segments, template, previous, onProgress } = input
  // regerar: os blocos `user` da ata anterior (inclusive editados) entram como notas
  const notes = previous ? userNotes(previous) : input.notes
  onProgress?.(`Lendo ${segments.length} ${segments.length === 1 ? 'fala' : 'falas'}…`)
  const prompt = buildAtaPrompt(meeting, notes, segments, template)
  onProgress?.('Escrevendo a ata…')
  let out
  try {
    out = await runClaude({
      prompt,
      system: ATA_SYSTEM,
      cwd: input.cwd,
      model: input.model ?? 'sonnet',
      schema: ATA_JSON_SCHEMA,
      env: input.env,
      ledger: { book: input.book, category: 'reunioes', cwd: input.cwd, account: input.account },
      signal: input.signal,
      onProgress,
    })
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    if (isLimitError(message)) throw new Error(LIMIT_MESSAGE, { cause: err })
    throw err
  }
  const parsed = parseAta(out.structured)
  const checked = dropBadRefs(parsed.blocks, segments)
  const blocks = previous ? mergeRegenerate(previous, checked) : ensureNotes(checked, notes)
  const title = parsed.title || meeting.title
  return { title, blocks, markdown: ataToMarkdown(title, blocks), costUsd: out.costUsd }
}
