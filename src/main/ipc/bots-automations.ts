import { ipcMain } from 'electron'
import { BOT_GROUND_FLOOR, CHAT_DEFAULTS, type Bot, type BotEventTrigger, type ChatSettings, type ProjectFloor } from '@shared/types'
import { draftAutomation, type DraftDeps } from '../bots/automation'
import { cleanAutomationText, cleanBotId, cleanBotTriggerDraft, cleanFloorId, triggerIdSchema } from '../bots/automation-validate'
import type { BotTriggers } from '../bots/triggers'
import type { CategoryBook } from '../claude-run'
import { parse } from '../validate'

export interface BotAutomationsIpcDeps {
  triggers: Pick<BotTriggers, 'list' | 'save' | 'remove' | 'setEnabled' | 'setEnabledForBot'>
  /** The bots' routines (schedules are routines with who { kind: 'bot' }). */
  routines: { setEnabledForBot(botId: string, enabled: boolean): number }
  /** The bots now (BotStore.bots). */
  bots(): Bot[]
  settings(): { projects: ProjectFloor[]; chat?: Partial<ChatSettings> }
  /** The floor's Claude Code account: accounts.pick for the floor, then accountEnv. */
  claudeFor(floor: string): { env: NodeJS.ProcessEnv; account?: string }
  /** A folder with nothing of the player's, where the sentence is read (e.g. userData). */
  scratchDir(): string
  book: CategoryBook
  /** runClaude; a fake one in the tests. */
  run?: DraftDeps['run']
  now?: () => number
}

/**
 * The phase-2 handlers, by channel. Every argument passes through automation-validate.ts (or
 * validate.ts) before it reaches a service. Exported for the tests.
 */
export function botAutomationHandlers(d: BotAutomationsIpcDeps): Record<string, (...args: unknown[]) => unknown> {
  const projects = () => d.settings().projects
  const triggerId = (raw: unknown) => parse(triggerIdSchema, raw, 'Essa automação não existe mais.')
  const flag = (raw: unknown) => {
    if (typeof raw !== 'boolean') throw new Error('Valor inválido.')
    return raw
  }
  return {
    'office:listBotTriggers': (): BotEventTrigger[] => d.triggers.list(),
    'office:saveBotTrigger': (raw) =>
      d.triggers.save(cleanBotTriggerDraft(raw, { bots: d.bots(), projects: projects(), perHourDefault: { ...CHAT_DEFAULTS, ...d.settings().chat }.maxEventRunsPerHour })),
    'office:deleteBotTrigger': (raw) => d.triggers.remove(triggerId(raw)),
    'office:setBotTriggerEnabled': (raw, on) => d.triggers.setEnabled(triggerId(raw), flag(on)),
    'office:setBotAutomationsEnabled': (raw, on) => {
      const botId = cleanBotId(raw, d.bots())
      const enabled = flag(on)
      d.routines.setEnabledForBot(botId, enabled)
      d.triggers.setEnabledForBot(botId, enabled)
    },
    'office:draftAutomation': (rawText, rawFloor) => {
      const text = cleanAutomationText(rawText)
      const floor = cleanFloorId(rawFloor, projects())
      const project = projects().find((p) => p.id === floor)
      const claude = d.claudeFor(floor)
      const scratch = d.scratchDir()
      const now = (d.now ?? Date.now)()
      return draftAutomation(text, { id: floor, name: floor === BOT_GROUND_FLOOR ? 'Térreo' : (project?.name ?? floor) }, d.bots(), now, {
        ...claude,
        cwd: scratch,
        ledgerCwd: project?.cwd ?? scratch,
        book: d.book,
        ...(d.run ? { run: d.run } : {}),
      })
    },
  }
}

/** Chat dos bots, fase 2: event triggers, pausing a bot's automations, and the sentence reader. */
export function registerBotAutomationsIpc(d: BotAutomationsIpcDeps): void {
  for (const [channel, handler] of Object.entries(botAutomationHandlers(d))) ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args))
}
