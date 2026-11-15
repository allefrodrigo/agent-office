import type { HookCallbackMatcher, PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { guardReason, sensitiveKinds } from '@shared/bots-guard'
import type { OfficePermissionMode, SensitiveKind } from '@shared/types'

/**
 * Guarda de ações sensíveis (CB-03, docs/adr/0014-guarda-de-acoes-sensiveis.md).
 *
 * Default: a PreToolUse hook answers 'ask' for a sensitive call, which sends it to the office's
 * canUseTool (the card, or the approval in the thread) in any permission mode, auto included.
 *
 * Fallback (AGENT_OFFICE_BOT_GUARD=fallback), for a CLI where 'ask' would not reach canUseTool:
 * the bot's CLI runs in "Pedir permissão" and askPlayer allows by itself what the bot's own mode
 * would have allowed, as long as it is not sensitive.
 */
export const GUARD_FALLBACK = process.env.AGENT_OFFICE_BOT_GUARD === 'fallback'

/** The first kind of this call that the bot holds for a yes, or null. */
export function heldKind(tool: string, input: unknown, askBefore: readonly SensitiveKind[], mcpSource?: string): SensitiveKind | null {
  if (!askBefore.length) return null
  return sensitiveKinds(tool, input, { mcpSource }).find((k) => askBefore.includes(k)) ?? null
}

/**
 * Runs before every tool call of a bot's agent (its subagents too). `askBefore` is read on each
 * call, so unticking a kind in the profile counts at once. Anything else is left to the mode.
 */
export function guardHook(askBefore: () => readonly SensitiveKind[]): HookCallbackMatcher[] {
  return [
    {
      hooks: [
        async (input) => {
          if (input.hook_event_name !== 'PreToolUse') return {}
          const kind = heldKind(input.tool_name, input.tool_input, askBefore(), input.mcp_server?.source)
          if (!kind) return {}
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: guardReason(kind, input.tool_name, input.tool_input) } }
        },
      ],
    },
  ]
}

/** The MCP server of a tool name (mcp__gmail__send -> gmail); null for any other tool. */
function serverOf(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const rest = tool.slice('mcp__'.length)
  const i = rest.indexOf('__')
  return i < 0 ? rest : rest.slice(0, i)
}

/**
 * The built-in tools that reach MCP servers by name in their input (ListMcpResourcesTool,
 * ReadMcpResourceTool, ReadMcpResourceDirTool, RefreshMcpTools…): any tool called *Mcp* that
 * is not an mcp__ tool counts as one.
 */
const isMcpBuiltin = (tool: string) => !tool.startsWith('mcp__') && /mcp/i.test(tool)

/** The server a built-in MCP tool names in its input; '' when it names none. */
function namedServer(input: unknown): string {
  const server = input && typeof input === 'object' ? (input as Record<string, unknown>).server : undefined
  return typeof server === 'string' ? server : ''
}

/**
 * Whether a bot with these connections may call this tool. Fails closed: an MCP call whose
 * server cannot be worked out, or a resource list over every server, is denied unless the bot
 * sees them all. The office's own server always passes (by provenance for mcp__ tools).
 */
export function appAllowed(apps: 'all' | readonly string[], tool: string, input: unknown, mcp?: { name: string; source: string }): boolean {
  if (apps === 'all') return true
  if (isMcpBuiltin(tool)) {
    const server = namedServer(input)
    return !!server && (server === 'office' || apps.includes(server))
  }
  const server = mcp?.name ?? serverOf(tool)
  if (server === null) return true
  if (server === 'office' && (!mcp || mcp.source === 'sdk')) return true
  return !!server && apps.includes(server)
}

/**
 * A bot sees only the connections ticked in its profile. The manager turns the others off when
 * the CLI starts (toggleMcpServer); this hook closes the gap until then, covers its subagents
 * and the built-in resource tools, which name the server in their input.
 */
export function appsHook(apps: () => 'all' | readonly string[]): HookCallbackMatcher[] {
  return [
    {
      hooks: [
        async (input) => {
          if (input.hook_event_name !== 'PreToolUse' || appAllowed(apps(), input.tool_name, input.tool_input, input.mcp_server)) return {}
          const server = isMcpBuiltin(input.tool_name) ? namedServer(input.tool_input) : (input.mcp_server?.name ?? serverOf(input.tool_name))
          const why = server
            ? `Este bot não tem acesso à conexão ${server}. Para usar, marque-a nas conexões do perfil do bot.`
            : 'Este bot só vê as conexões marcadas no perfil: diga de qual delas quer os recursos.'
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }
        },
      ],
    },
  ]
}

/** The mode the bot's CLI runs in: never "Sem pedir nada"; in the fallback, "Pedir permissão" for the modes that skip asking. */
export function cliMode(mode: OfficePermissionMode, fallback = GUARD_FALLBACK): PermissionMode {
  if (mode === 'bypassPermissions') return 'default'
  if (fallback && (mode === 'auto' || mode === 'acceptEdits')) return 'default'
  return mode
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
/** Questions and plans always reach the player, whatever the mode. */
const ALWAYS_ASK = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** Fallback only: what the bot's own mode lets through without asking (the call is not sensitive). */
export function modeAllows(mode: OfficePermissionMode, tool: string, fallback = GUARD_FALLBACK): boolean {
  if (!fallback || ALWAYS_ASK.has(tool)) return false
  if (mode === 'auto') return true
  if (mode === 'acceptEdits') return EDIT_TOOLS.has(tool)
  return false
}
