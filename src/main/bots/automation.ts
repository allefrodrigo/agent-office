import { AUTOMATION_JSON_SCHEMA, AUTOMATION_SYSTEM, automationPrompt, cleanAutomationDraft } from '@shared/bots-automation'
import type { AutomationDraft, Bot } from '@shared/types'
import { runClaude, type CategoryBook, type ClaudeOutcome, type ClaudeRun } from '../claude-run'
import { log } from '../log'
import { isLimitError } from '../meetings/ata'

export const DRAFT_LIMIT_MESSAGE = 'O plano do Claude chegou ao limite. Monte a automação pelo formulário ou tente mais tarde.'

export interface DraftDeps {
  /** The floor's Claude Code account (accountEnv). */
  env: NodeJS.ProcessEnv
  account?: string
  /** Where Claude runs: a folder with nothing of the player's (it has no tools anyway). */
  cwd: string
  /** The floor's folder: the cost goes to that floor, under "Chat dos bots". */
  ledgerCwd: string
  book: CategoryBook
  /** runClaude; a fake one in the tests. */
  run?: (r: ClaudeRun) => Promise<ClaudeOutcome>
}

/**
 * "Automação a partir de uma frase" (CB-15): Haiku reads the sentence into a proposal (bot,
 * schedule or event, task) for the form; nothing is saved. Claude gets only the sentence, the
 * floor's name and its bots' names and taglines, runs with no tools, and its answer is checked
 * by cleanAutomationDraft. The cost goes into the cost book under 'bots'.
 */
export async function draftAutomation(
  text: string,
  floor: { id: string; name: string },
  bots: Pick<Bot, 'id' | 'name' | 'tagline' | 'floor'>[],
  now: number,
  deps: DraftDeps,
): Promise<AutomationDraft> {
  const mine = bots.filter((b) => b.floor === floor.id)
  const started = Date.now()
  let out: ClaudeOutcome
  try {
    out = await (deps.run ?? runClaude)({
      prompt: automationPrompt(text, floor.name, mine, now),
      system: AUTOMATION_SYSTEM,
      cwd: deps.cwd,
      model: 'haiku',
      schema: AUTOMATION_JSON_SCHEMA,
      env: deps.env,
      ledger: { book: deps.book, category: 'bots', cwd: deps.ledgerCwd, account: deps.account },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.warn(`[bots] automação por frase falhou após ${Date.now() - started} ms (${isLimitError(message) ? 'limite' : 'erro'})`)
    if (isLimitError(message)) throw new Error(DRAFT_LIMIT_MESSAGE, { cause: err })
    throw err
  }
  const draft = cleanAutomationDraft(out.structured, { bots: mine, floor: floor.id, now })
  log.info(`[bots] automação por frase em ${Date.now() - started} ms: ${mine.length} bots no andar, ${draft.when.kind}, bot ${draft.bot.kind}, haiku`)
  return draft
}
