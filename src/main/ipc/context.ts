import type { BrowserWindow } from 'electron'
import type { Actor, AgentBrain, OfficeEvent, SquadInfo } from '@shared/types'
import type { Accounts } from '../accounts'
import type { AgentManager } from '../agents'
import type { Bridge } from '../bridge'
import type { TicketDesk } from '../delegate'
import type { CostBook } from '../ledger'
import type { RoutineScheduler } from '../routines'
import type { StatsReader } from '../stats'
import type { Store } from '../store'
import type { SystemMonitor } from '../system'
import type { TicketBoard } from '../tickets'
import type { UsageMonitor } from '../usage'
import { idSchema, parse } from '../validate'

/** What the IPC handlers (ipc/*.ts) share; built once in index.ts when the app is ready. */
export interface IpcContext {
  /** The office window right now (null while closed on macOS). */
  win(): BrowserWindow | null
  store: Store
  manager: AgentManager
  board: TicketBoard
  book: CostBook
  desk: TicketDesk
  routines: RoutineScheduler
  bridge: Bridge
  usage: UsageMonitor
  accounts: Accounts
  system: SystemMonitor
  stats: StatsReader
  broadcast(e: OfficeEvent): void
  updateBadge(): void
  nameOf(agentId: string): string
  player(): Actor
  defaultBrain(): AgentBrain
  /** Squads of the project floors, as last read. */
  squads(): SquadInfo[]
  /** Reads the squads again (the floors changed) and returns them. */
  rereadSquads(): SquadInfo[]
  onBattery(): boolean
}

// Every argument from the renderer passes through validate.ts first.

export const id = (raw: unknown) => parse(idSchema, raw, 'ID inválido.')
export const ticketId = (raw: unknown) => parse(idSchema, raw, 'Esse ticket não existe mais.')
