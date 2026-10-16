// ---------- Bastidores: what runs behind the agents (background processes, MCP, skills) ----------

/** server = listening on a port; monitor = follows a log or watches files; helper = a background subagent. */
export type BgKind = 'server' | 'monitor' | 'shell' | 'helper'

/** Who started it. 'gone': the agent left (fired, closed) and the process kept running. */
export interface BgOwner {
  kind: 'office' | 'terminal' | 'gone'
  name: string
  agentId?: string
  accountId?: string
}

/** One thing running in the background, as the HUD and the Bastidores window show it. */
export interface BgProcess {
  /** 'task:<agentId>:<taskId>' (an office agent's task) or 'pid:<pid>' (a process found under a claude). */
  id: string
  owner: BgOwner
  kind: BgKind
  /** The command, or the task's description. */
  label: string
  startedAt: number
  /** TCP ports it (or a child) listens on. */
  ports: number[]
  /** Share of the whole machine, like the HUD's CPU; missing where unknown. */
  cpu?: number
  /** Resident memory of it and its children, in bytes. */
  mem?: number
  /** Its output can be read (an office agent's shell or monitor). */
  output: boolean
}

export type McpStatus = 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled' | 'unknown'

/** One MCP server across the office agents running now, or as configured when none runs. */
export interface McpServerView {
  name: string
  status: McpStatus
  /** user, project, local, plugin, claudeai, sdk… as Claude Code reports it. */
  scope?: string
  error?: string
  /** Tools it gives each agent; missing until an agent connects to it. */
  tools?: number
  /** Office agents that have it now. */
  agents: number
  /** Calls to its tools in the last 7 days, from the transcripts. */
  uses: number
  /** 'YYYY-MM-DD' of the last call within those days. */
  lastUsed?: string
  /** The office's own server (the ticket board): it cannot be turned off. */
  locked?: boolean
  /** Turned off in the office: every agent starts with it off. */
  off?: boolean
}

export interface SkillView {
  name: string
  description?: string
  /** builtin: comes with Claude Code (no SKILL.md of the user's). */
  source: 'user' | 'project' | 'plugin' | 'builtin'
  plugin?: string
  /** Its SKILL.md, when found on disk. */
  path?: string
  uses: number
  lastUsed?: string
}

export interface PluginView {
  /** As in enabledPlugins: "name@marketplace". */
  id: string
  enabled: boolean
}

export interface ToolsView {
  mcp: McpServerView[]
  skills: SkillView[]
  plugins: PluginView[]
  /** Office agents with a running CLI: the live status comes from them. */
  live: number
  /** First day the usage numbers cover. */
  usageSince?: string
  /** The transcripts are still being read: the numbers may grow. */
  reading: boolean
}
