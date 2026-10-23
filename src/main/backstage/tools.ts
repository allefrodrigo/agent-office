import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpServerStatus, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { McpServerView, McpStatus, PluginView, Settings, SkillView, ToolsView } from '@shared/types'
import { writeJsonAtomic } from '../fs-safe'

// Bastidores → MCP and Skills: what the office agents can use, and how much they did in 7 days.
// Live status comes from the running CLIs; with none running, from the config files.

/** The office's own server (ticket board): the agents need it, so it is never turned off. */
export const OFFICE_MCP = 'office'

export type Usage = Map<string, { n: number; last: string }>

/** Tool names carry the server name with anything outside [A-Za-z0-9_-] turned into "_" (mcp__claude_ai_Notion__…). */
export const serverKey = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_')

const RANK: Record<McpStatus, number> = { connected: 0, 'needs-auth': 1, failed: 2, pending: 3, disabled: 4, unknown: 5 }
const toStatus = (s: string | undefined): McpStatus => (s && s in RANK ? (s as McpStatus) : 'unknown')

/**
 * One row per server across the live CLIs (the best status wins: connected in one agent
 * means it works), plus servers only configured or only seen in the usage.
 */
export function mergeMcp(
  lists: McpServerStatus[][],
  configured: { name: string; scope: string }[],
  usage: Usage,
  off: string[],
): McpServerView[] {
  const rows = new Map<string, McpServerView>()
  for (const list of lists) {
    for (const s of list) {
      const row = rows.get(s.name) ?? { name: s.name, status: 'unknown' as McpStatus, agents: 0, uses: 0 }
      const status = toStatus(s.status)
      if (RANK[status] < RANK[row.status]) {
        row.status = status
        row.error = s.error
      }
      row.agents++
      row.scope ??= s.scope ?? (s as { source?: string }).source
      if (s.tools) row.tools = Math.max(row.tools ?? 0, s.tools.length)
      rows.set(s.name, row)
    }
  }
  for (const c of configured)
    if (!rows.has(c.name)) rows.set(c.name, { name: c.name, status: 'unknown', scope: c.scope, agents: 0, uses: 0 })
  const byKey = new Map([...rows.values()].map((r) => [serverKey(r.name), r]))
  for (const [key, u] of usage) {
    if (!key.startsWith('mcp:')) continue
    const server = key.slice(4)
    const row = byKey.get(server) ?? { name: server, status: 'unknown' as McpStatus, agents: 0, uses: 0 }
    row.uses += u.n
    if (!row.lastUsed || u.last > row.lastUsed) row.lastUsed = u.last
    if (!byKey.has(server)) {
      byKey.set(server, row)
      rows.set(server, row)
    }
  }
  for (const row of rows.values()) {
    if (row.name === OFFICE_MCP) row.locked = true
    else if (off.includes(row.name)) {
      row.off = true
      row.status = 'disabled'
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(b.locked ?? 0) - Number(a.locked ?? 0) || RANK[a.status] - RANK[b.status] || b.uses - a.uses || a.name.localeCompare(b.name),
  )
}

/** `description:` of a SKILL.md front matter (one line, quoted, or a folded block). */
export function skillDescription(text: string): string | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (!fm) return undefined
  const lines = fm.split(/\r?\n/)
  const i = lines.findIndex((l) => /^description:/.test(l))
  if (i < 0) return undefined
  let value = lines[i].replace(/^description:\s*/, '')
  if (/^[>|][-+]?$/.test(value.trim())) {
    const block: string[] = []
    for (const l of lines.slice(i + 1)) {
      if (!/^\s+\S/.test(l)) break
      block.push(l.trim())
    }
    value = block.join(' ')
  }
  value = value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
  return value ? (value.length > 300 ? `${value.slice(0, 299)}…` : value) : undefined
}

export interface SkillDir {
  dir: string
  source: SkillView['source']
  plugin?: string
}

/** Every <dir>/<name>/SKILL.md, each folder once (account folders link to the same skills). */
export function findSkills(dirs: SkillDir[]): SkillView[] {
  const seen = new Set<string>()
  const out: SkillView[] = []
  for (const d of dirs) {
    let names: string[]
    try {
      names = readdirSync(d.dir)
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(d.dir, name, 'SKILL.md')
      if (!existsSync(path)) continue
      const real = realOr(path)
      if (seen.has(real)) continue
      seen.add(real)
      let description: string | undefined
      try {
        description = skillDescription(readFileSync(path, 'utf8').slice(0, 8000))
      } catch {
        // unreadable: still listed
      }
      out.push({ name, description, source: d.source, plugin: d.plugin, path, uses: 0 })
    }
  }
  return out
}

/** Skills on disk, plus the ones only the CLI knows (built in), with their 7 days of use. */
export function mergeSkills(found: SkillView[], liveNames: string[], commands: SlashCommand[], usage: Usage): SkillView[] {
  const rows = new Map<string, SkillView>()
  const qualified = (s: SkillView) => (s.plugin ? `${s.plugin}:${s.name}` : s.name)
  for (const s of found) rows.set(qualified(s), { ...s })
  const known = (name: string) => rows.get(name) ?? [...rows.values()].find((s) => s.name === name || qualified(s) === name)
  const describe = new Map(commands.map((c) => [c.name, c.description]))
  for (const name of liveNames) if (!known(name)) rows.set(name, { name, source: 'builtin', uses: 0, description: describe.get(name) })
  for (const [key, u] of usage) {
    if (!key.startsWith('skill:')) continue
    const name = key.slice(6)
    let row = known(name)
    if (!row) rows.set(name, (row = { name, source: 'builtin', uses: 0, description: describe.get(name) }))
    row.uses += u.n
    if (!row.lastUsed || u.last > row.lastUsed) row.lastUsed = u.last
  }
  for (const row of rows.values()) row.description ??= describe.get(row.name) ?? describe.get(qualified(row))
  const order: SkillView['source'][] = ['user', 'project', 'plugin', 'builtin']
  return [...rows.values()].sort(
    (a, b) => b.uses - a.uses || order.indexOf(a.source) - order.indexOf(b.source) || a.name.localeCompare(b.name),
  )
}

function realOr(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

const keysOf = (v: unknown) => (v && typeof v === 'object' ? Object.keys(v) : [])

export interface ToolsDeps {
  /** Office agents with a running CLI: what each one loaded. */
  live(): { init?: { skills: string[]; plugins: { name: string; path: string }[] } }[]
  mcpStatus(): Promise<McpServerStatus[][]>
  commands(): Promise<SlashCommand[]>
  usage(): Promise<{ uses: Usage; since: string; reading: boolean }>
  settings(): Settings
}

/** MCP servers, skills and plugins for the Bastidores window. Keeps the skill paths for revealSkill. */
export class ToolsDesk {
  private paths = new Map<string, string>()

  constructor(
    private deps: ToolsDeps,
    private home = homedir(),
  ) {}

  private get settingsFile(): string {
    return join(this.home, '.claude', 'settings.json')
  }

  /** ~/.claude plus every account folder, each once. */
  private configDirs(): string[] {
    const dirs = [join(this.home, '.claude'), ...this.deps.settings().accounts.flatMap((a) => (a.configDir ? [a.configDir] : []))]
    return [...new Set(dirs)]
  }

  async view(): Promise<ToolsView> {
    const s = this.deps.settings()
    const [lists, commands, usage] = await Promise.all([this.deps.mcpStatus(), this.deps.commands(), this.deps.usage()])
    const live = this.deps.live()
    const mcp = mergeMcp(lists, lists.length ? [] : this.configuredMcp(), usage.uses, s.disabledMcp ?? [])
    const skills = mergeSkills(
      findSkills(this.skillDirs(live)),
      [...new Set(live.flatMap((a) => a.init?.skills ?? []))],
      commands,
      usage.uses,
    )
    this.paths = new Map(skills.flatMap((k) => (k.path ? [[k.plugin ? `${k.plugin}:${k.name}` : k.name, k.path] as const] : [])))
    return { mcp, skills, plugins: this.plugins(), live: live.length, usageSince: usage.since, reading: usage.reading }
  }

  /** Servers in the config files, for when no CLI runs to ask: user, local (per floor) and project (.mcp.json). */
  private configuredMcp(): { name: string; scope: string }[] {
    const out: { name: string; scope: string }[] = [{ name: OFFICE_MCP, scope: 'sdk' }]
    const floors = this.deps.settings().projects.map((p) => p.cwd)
    for (const file of [
      join(this.home, '.claude.json'),
      ...this.configDirs()
        .slice(1)
        .map((d) => join(d, '.claude.json')),
    ]) {
      const j = readJson(file)
      if (!j) continue
      for (const name of keysOf(j.mcpServers)) out.push({ name, scope: 'user' })
      const projects = (j.projects ?? {}) as Record<string, { mcpServers?: unknown }>
      for (const cwd of floors) for (const name of keysOf(projects[cwd]?.mcpServers)) out.push({ name, scope: 'local' })
    }
    for (const cwd of floors) for (const name of keysOf(readJson(join(cwd, '.mcp.json'))?.mcpServers)) out.push({ name, scope: 'project' })
    const seen = new Set<string>()
    return out.filter((c) => !seen.has(c.name) && seen.add(c.name))
  }

  private skillDirs(live: { init?: { plugins: { name: string; path: string }[] } }[]): SkillDir[] {
    const dirs: SkillDir[] = this.configDirs().map((d) => ({ dir: join(d, 'skills'), source: 'user' as const }))
    for (const p of this.deps.settings().projects) dirs.push({ dir: join(p.cwd, '.claude', 'skills'), source: 'project' })
    const plugins = new Map<string, string>()
    for (const a of live) for (const p of a.init?.plugins ?? []) plugins.set(p.name, p.path)
    for (const d of this.configDirs()) {
      const reg = readJson(join(d, 'plugins', 'installed_plugins.json'))?.plugins as Record<string, { installPath?: string }[]> | undefined
      for (const [id, installs] of Object.entries(reg ?? {})) {
        const path = Array.isArray(installs) ? installs.find((i) => typeof i?.installPath === 'string')?.installPath : undefined
        if (path && !plugins.has(id.split('@')[0])) plugins.set(id.split('@')[0], path)
      }
    }
    for (const [name, path] of plugins) dirs.push({ dir: join(path, 'skills'), source: 'plugin', plugin: name })
    return dirs
  }

  plugins(): PluginView[] {
    const enabled = (readJson(this.settingsFile)?.enabledPlugins ?? {}) as Record<string, unknown>
    const ids = new Set(Object.keys(enabled))
    for (const d of this.configDirs()) for (const id of keysOf(readJson(join(d, 'plugins', 'installed_plugins.json'))?.plugins)) ids.add(id)
    return [...ids].sort().map((id) => ({ id, enabled: enabled[id] === true }))
  }

  /** enabledPlugins in ~/.claude/settings.json, keeping everything else in the file. */
  setPlugin(id: string, on: boolean): void {
    if (!this.plugins().some((p) => p.id === id)) throw new Error('Esse plugin não está instalado.')
    const settings = readJson(this.settingsFile) ?? {}
    const enabledPlugins = { ...((settings.enabledPlugins ?? {}) as Record<string, unknown>), [id]: on }
    writeJsonAtomic(
      this.settingsFile,
      { ...settings, enabledPlugins },
      { mode: 0o600, space: 2, newline: true, tmpSuffix: '.agent-office.tmp' },
    )
  }

  /** The SKILL.md of a skill listed in the last view. */
  skillPath(name: string): string {
    const path = this.paths.get(name)
    if (!path) throw new Error('Não achei o arquivo dessa skill.')
    return path
  }
}
