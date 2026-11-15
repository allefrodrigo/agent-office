import { CHAT_DEFAULTS, type Bot, type Channel, type ThreadItem } from '@shared/types'
import { channelLines, pickRoute, ROUTER_SCHEMA, ROUTER_SYSTEM, routerMember, routerPrompt } from '@shared/bots-mentions'
import { runClaude, type ClaudeOutcome, type ClaudeRun } from '../claude-run'
import { log } from '../log'

// O roteador dos canais (CB-18): sem @menção, um modelo rápido escolhe quem responde. Uma chamada
// runClaude sem ferramentas e com esquema; lê só o nome e o tema do canal, o nome e a frase de cada
// membro e as últimas mensagens. A saída fica entre os membros (pickRoute).

export interface RouteRequest {
  channel: Pick<Channel, 'id' | 'name' | 'topic' | 'floor'>
  /** The channel's members that exist now. */
  members: readonly Pick<Bot, 'id' | 'name' | 'tagline' | 'role'>[]
  /** The channel's items before the new message (the last ones go). */
  items: readonly ThreadItem[]
  /** Who each bot id is, for the last messages. */
  names: Readonly<Record<string, string>>
  message: string
}

export interface Route {
  /** Member ids, 0 to 2. */
  bots: string[]
  why: string
}

export type RouteFn = (req: RouteRequest) => Promise<Route>

/** Where the router's call runs and is booked: the floor's folder and Claude Code account. */
export interface RouterPlace {
  cwd: string
  env: NodeJS.ProcessEnv
  account?: string
}

export interface RouterDeps {
  /** settings.chat.routerModel ('haiku' by default). */
  model(): string | undefined
  place(floor: string): RouterPlace
  /** Books the call in the cost book, category 'bots'. */
  ledger?: Pick<NonNullable<ClaudeRun['ledger']>, 'book' | 'category'>
  /** runClaude; a fake in the tests. */
  run?: (r: ClaudeRun) => Promise<ClaudeOutcome>
}

/** A router bound to the app's settings and accounts. */
export function makeRouter(deps: RouterDeps): RouteFn {
  const run = deps.run ?? runClaude
  return async (req) => {
    if (!req.members.length) return { bots: [], why: 'O canal não tem membros.' }
    const place = deps.place(req.channel.floor)
    const model = deps.model() || CHAT_DEFAULTS.routerModel
    const prompt = routerPrompt({
      channel: req.channel,
      members: req.members.map(routerMember),
      recent: channelLines(req.items, req.names),
      message: req.message,
    })
    const t0 = Date.now()
    const out = await run({
      prompt,
      system: ROUTER_SYSTEM,
      cwd: place.cwd,
      model,
      schema: ROUTER_SCHEMA,
      env: place.env,
      // no readRoots: the router has no tools at all
      ...(deps.ledger ? { ledger: { ...deps.ledger, cwd: place.cwd, account: place.account } } : {}),
    })
    const route = pickRoute(out.structured, req.members)
    log.info(
      `[canais] roteador em ${req.channel.id}: ${route.bots.length} de ${req.members.length} membros, ${Date.now() - t0} ms, modelo ${model}`,
    )
    return route
  }
}
