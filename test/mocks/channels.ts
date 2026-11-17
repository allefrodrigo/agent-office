import {
  BOT_COLORS,
  SENSITIVE_KINDS,
  type AttachmentInput,
  type Bot,
  type Channel,
  type OfficeEvent,
  type RunTrigger,
  type ThreadItem,
} from '@shared/types'
import { lookFromSeed } from '@shared/describe'
import { ChannelService, type ChannelRunHost, type ChannelStore, type RunEndEvent, type ThreadLike } from '../../src/main/bots/channels'
import type { Route, RouteRequest } from '../../src/main/bots/router'
import type { RunStart } from '../../src/main/bots/runner'

// Fakes for the channel tests: the BotStore's bots, channels and threads in memory, and a
// BotRunner that records what it was asked to send.

export function makeBot(id: string, name: string, floor = 'p1', extra: Partial<Bot> = {}): Bot {
  return {
    id,
    name,
    tagline: '',
    role: `Você é ${name}.`,
    color: BOT_COLORS[0],
    look: lookFromSeed(id),
    floor,
    permissionMode: 'default',
    askBefore: [...SENSITIVE_KINDS],
    apps: 'all',
    worktree: false,
    dailyBudgetUsd: 0,
    pinned: false,
    hidden: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 0,
    runs: [],
    ...extra,
  }
}

export class FakeThread implements ThreadLike {
  items: ThreadItem[] = []
  all(): ThreadItem[] {
    return [...this.items]
  }
  get(id: string): ThreadItem | undefined {
    return this.items.find((i) => i.id === id)
  }
  put(item: ThreadItem): void {
    const k = this.items.findIndex((i) => i.id === item.id)
    if (k >= 0) this.items[k] = item
    else this.items.push(item)
  }
  search(query: string): ThreadItem[] {
    const q = query.toLowerCase()
    return this.items.filter((i) => 'text' in i && i.text.toLowerCase().includes(q)).reverse()
  }
}

export class FakeStore implements ChannelStore {
  private list: Channel[] = []
  saves = 0
  removed: string[] = []
  threads = new Map<string, FakeThread>()
  constructor(public bots: Bot[] = []) {}
  get channels(): Channel[] {
    return this.list
  }
  set channels(list: Channel[]) {
    this.list = list
    this.saves++
  }
  bot(id: string): Bot | undefined {
    return this.bots.find((b) => b.id === id)
  }
  thread(id: string): FakeThread {
    let t = this.threads.get(id)
    if (!t) {
      t = new FakeThread()
      this.threads.set(id, t)
    }
    return t
  }
  removeFolder(id: string): void {
    this.removed.push(id)
    this.threads.delete(id)
  }
}

export interface Sent {
  botId: string
  text: string
  attachments: AttachmentInput[]
  trigger: RunTrigger
  threadId: string
  runId: string
}

export class FakeHost implements ChannelRunHost {
  sent: Sent[] = []
  /** botId -> the thread of its run in progress. */
  busy = new Map<string, string>()
  failWith: Error | null = null
  /** The runner skips the next sends with this reason (busy agent, daily cap). */
  skipWith: string | null = null
  private listeners: ((e: RunEndEvent) => void)[] = []
  private n = 0
  async send(
    botId: string,
    text: string,
    attachments: AttachmentInput[],
    trigger: RunTrigger,
    opts: { threadId: string; showUser: false },
  ): Promise<RunStart> {
    if (this.failWith) throw this.failWith
    if (this.skipWith) return { skipped: this.skipWith }
    const runId = `run-${++this.n}`
    this.sent.push({ botId, text, attachments, trigger, threadId: opts.threadId, runId })
    this.busy.set(botId, opts.threadId)
    return { runId }
  }
  onRunEnd(listener: (e: RunEndEvent) => void): void {
    this.listeners.push(listener)
  }
  activeThread(botId: string): string | undefined {
    return this.busy.get(botId)
  }
  /** The run that `sent` started ends. */
  end(s: Sent, status: RunEndEvent['status'] = 'ok', text?: string): void {
    this.busy.delete(s.botId)
    for (const fn of this.listeners) fn({ botId: s.botId, runId: s.runId, threadId: s.threadId, status, text, trigger: s.trigger })
  }
  last(): Sent {
    return this.sent[this.sent.length - 1]
  }
}

export interface Setup {
  store: FakeStore
  host: FakeHost
  events: OfficeEvent[]
  routes: RouteRequest[]
  svc: ChannelService
  /** What the router answers next (a function to throw). */
  answer: { next: Route | (() => never) }
  clock: { t: number }
}

export const FLOORS = [
  { id: 'terreo', name: 'Térreo' },
  { id: 'p1', name: 'Agent Office' },
  { id: 'p2', name: 'Loja' },
]

export function setup(bots: Bot[], opts: { perHour?: number } = {}): Setup {
  const store = new FakeStore(bots)
  const host = new FakeHost()
  const events: OfficeEvent[] = []
  const routes: RouteRequest[] = []
  const answer: Setup['answer'] = { next: { bots: [], why: '' } }
  const clock = { t: Date.UTC(2026, 10, 15, 12, 0) }
  const svc = new ChannelService({
    store,
    host,
    route: async (r) => {
      routes.push(r)
      const a = answer.next
      return typeof a === 'function' ? a() : a
    },
    floors: () => FLOORS,
    chat: () => ({ maxEventRunsPerHour: opts.perHour ?? 6 }),
    broadcast: (e) => events.push(e),
    attachmentInfos: (list) => list.map((a) => ({ name: a.name, kind: 'file' as const, size: 10 })),
    now: () => clock.t++,
  })
  return { store, host, events, routes, svc, answer, clock }
}

/** The items of a channel's thread. */
export function items(s: Setup, threadId: string): ThreadItem[] {
  return s.store.thread(threadId).all()
}
