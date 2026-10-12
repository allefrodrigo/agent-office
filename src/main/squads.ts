import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentDefinition, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { parse } from 'yaml'
import type { SquadInfo, SquadMember, SquadProgress, SquadStep } from '@shared/types'

// Opensquad squads: squads/<code>/squad.yaml + agents/<id>.agent.md + pipeline/pipeline.yaml.
// Read as they are; the office never writes to a squad folder.

export const DEFAULT_SECTOR = 'Equipe'
const RUNNER = '_opensquad/core/runner.pipeline.md'
/** Tools that start a subagent (Agent; Task in older Claude Code builds). */
const SPAWN_TOOLS = new Set(['Agent', 'Task'])

export interface SquadDefinition extends SquadInfo {
  /** Member id -> body of its .agent.md (persona, principles). */
  prompts: Record<string, string>
}

/** Every squad under `cwd`/squads. A folder without squads gives an empty list, never an error. */
export function loadSquads(cwd: string): SquadDefinition[] {
  const root = join(cwd, 'squads')
  let dirs: string[]
  try {
    dirs = readdirSync(root).filter((d) => existsSync(join(root, d, 'squad.yaml')))
  } catch {
    return []
  }
  const out: SquadDefinition[] = []
  for (const d of dirs.sort()) {
    try {
      out.push(loadSquad(cwd, join(root, d)))
    } catch (err) {
      console.error(`squads: ignoring ${d}:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

export function findSquad(cwd: string, code: string): SquadDefinition | undefined {
  return loadSquads(cwd).find((s) => s.code === code)
}

/** What the renderer gets: no prompts. */
export function squadInfo(s: SquadDefinition): SquadInfo {
  const { prompts: _prompts, ...info } = s
  return info
}

function loadSquad(cwd: string, dir: string): SquadDefinition {
  // The squad folder itself must live in the project (no squads/x -> /somewhere/else).
  if (!within(realpathSync(cwd), realpathSync(dir))) throw new Error('squad folder points outside the project')
  const yaml = inside(dir, 'squad.yaml')
  if (!yaml) throw new Error('squad.yaml points outside the squad folder')
  const y = (parse(readFileSync(yaml, 'utf8')) ?? {}) as Record<string, unknown>
  // The code builds paths (state.json, the watcher) and goes into the orchestrator prompt: keep it plain.
  const folder = dir.split(/[\\/]/).pop()!
  const code = /^[\w-]+$/.test(str(y.code)) ? str(y.code) : folder
  const members: SquadMember[] = []
  const prompts: Record<string, string> = {}
  for (const raw of Array.isArray(y.agents) ? y.agents : []) {
    const a = (raw ?? {}) as Record<string, unknown>
    const id = str(a.id)
    // The id becomes a subagent type and a file name: keep it plain.
    if (!/^[\w-]+$/.test(id) || members.some((m) => m.id === id)) continue
    const file = inside(dir, str(a.file) || `agents/${id}.agent.md`)
    const { meta, body } = file && existsSync(file) ? frontmatter(readFileSync(file, 'utf8')) : { meta: {}, body: '' }
    members.push({
      id,
      name: str(a.name) || str(meta.name) || id,
      icon: str(a.icon) || str(meta.icon) || '•',
      title: str(meta.title),
      execution: str(meta.execution) === 'inline' ? 'inline' : 'subagent',
      sector: str(a.setor) || DEFAULT_SECTOR,
    })
    prompts[id] = body.trim() || `Você é ${str(a.name) || id}, membro do squad ${str(y.name) || code}.`
  }
  return {
    code,
    name: str(y.name) || code,
    icon: str(y.icon) || '🧩',
    description: str(y.description).trim(),
    cwd,
    members,
    steps: loadSteps(dir, y),
    prompts,
  }
}

function loadSteps(dir: string, y: Record<string, unknown>): SquadStep[] {
  const pipe = (y.pipeline ?? {}) as Record<string, unknown>
  const file = inside(dir, str(pipe.entry) || 'pipeline/pipeline.yaml')
  if (!file || !existsSync(file)) return []
  const p = (parse(readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>
  return (Array.isArray(p.steps) ? p.steps : []).map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    return {
      id: str(s.id) || `step-${i + 1}`,
      name: str(s.name) || str(s.id) || `Passo ${i + 1}`,
      type: str(s.type) === 'checkpoint' ? 'checkpoint' : 'agent',
      agent: str(s.agent) || undefined,
    }
  })
}

/** Subagent definitions for the members that run as subagents. */
export function memberAgents(s: SquadDefinition): Record<string, AgentDefinition> {
  const out: Record<string, AgentDefinition> = {}
  for (const m of s.members) {
    if (m.execution !== 'subagent') continue
    out[m.id] = {
      description: `${m.icon} ${m.name}${m.title ? `, ${m.title}` : ''}. Membro do squad ${s.name}.`,
      prompt: s.prompts[m.id],
      // Members do their own step; only the orchestrator hands out work.
      disallowedTools: [...SPAWN_TOOLS],
    }
  }
  return out
}

/** Why a subagent call is refused, or null when it is a member of the team. */
export function outsideTeam(s: SquadDefinition, tool: string, input: unknown): string | null {
  if (!SPAWN_TOOLS.has(tool)) return null
  const type = String((input as { subagent_type?: unknown } | null)?.subagent_type ?? '') || 'general-purpose'
  const m = s.members.find((x) => x.id === type)
  if (m?.execution === 'subagent') return null
  const team = s.members.filter((x) => x.execution === 'subagent').map((x) => x.id).join(', ')
  if (m) return `${m.name} (${m.id}) é membro inline: faça o passo dele aqui mesmo, nesta conversa, sem chamar subagente.`
  return `Bloqueado pelo Agent Office: "${type}" não é da equipe do squad ${s.name}. Chame só membros do squad pelo id (subagent_type): ${team}.`
}

/**
 * Runs before every subagent call, whatever the permission mode: blocks anyone from
 * outside the team and keeps members in the foreground, so the orchestrator waits for
 * each delivery as the runner expects (calls sent in one message still run in parallel).
 */
export function teamGuard(s: SquadDefinition): HookCallbackMatcher[] {
  return [
    {
      matcher: '^(Agent|Task)$',
      hooks: [
        async (input) => {
          if (input.hook_event_name !== 'PreToolUse') return {}
          const why = outsideTeam(s, input.tool_name, input.tool_input)
          if (why) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }
          const updatedInput = { ...(input.tool_input as Record<string, unknown>), run_in_background: false }
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } }
        },
      ],
    },
  ]
}

/** Appended to the orchestrator's system prompt. */
export function orchestratorPrompt(s: SquadDefinition): string {
  const runner = existsSync(join(s.cwd, RUNNER)) ? `\`${RUNNER}\`` : 'the Opensquad pipeline runner'
  const line = (m: SquadMember) => `- ${m.id}: ${m.icon} ${m.name}${m.title ? ` (${m.title})` : ''}`
  const subs = s.members.filter((m) => m.execution === 'subagent')
  const inline = s.members.filter((m) => m.execution === 'inline')
  return [
    `You are the orchestrator of the Opensquad squad "${s.name}" (code ${s.code}). Your only job is to run its cycle: follow ${runner} and \`squads/${s.code}/squad.yaml\` + \`squads/${s.code}/pipeline/pipeline.yaml\` step by step.`,
    'Your team is closed. Call members as subagents with the Agent tool, subagent_type = member id; any other subagent type (general-purpose, Explore, fork…) is blocked. Wherever the runner says to dispatch with the Task tool, use the Agent tool with the step agent\'s id. The member already has its .agent.md as system prompt, so your prompt carries the step: task files, inputs, transformed output paths, veto conditions, company context and squad memory. Members run in the foreground and you wait for each delivery; when steps can run in parallel, send all their Agent calls in one message.',
    `Subagent members:\n${subs.map(line).join('\n') || '- (none)'}`,
    inline.length ? `Inline members (you play them yourself, in this conversation, never as subagents):\n${inline.map(line).join('\n')}` : '',
    'Checkpoints: present EVERY checkpoint step (type: checkpoint) and every choice the runner asks the user for with the AskUserQuestion tool, never as plain text or a numbered list in a message. Put the step name in the question, keep the options short, and include the paths of files the user must review. Never pick an answer yourself or skip a checkpoint: without an answer the cycle waits. If the question is cancelled, stop and wait for instructions.',
    `Write \`squads/${s.code}/state.json\` exactly when the runner says to: the office reads it to show the current step.`,
    'Talk to the user in Brazilian Portuguese.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Progress of a running cycle, from squads/<code>/state.json; undefined when there is none. */
export function readProgress(s: SquadInfo): SquadProgress | undefined {
  let raw: Record<string, unknown>
  try {
    const file = inside(join(s.cwd, 'squads', s.code), 'state.json')
    if (!file) return undefined
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
  const step = (raw.step ?? {}) as Record<string, unknown>
  const current = Number(step.current) || 0
  const def = s.steps[current - 1]
  const label = str(step.label)
  // The runner may write the step id as label; the pipeline has the readable name.
  const byLabel = s.steps.find((x) => x.id === label)
  const at = byLabel ?? def
  return {
    current,
    total: Number(step.total) || s.steps.length,
    label: at?.name ?? label,
    status: str(raw.status) || 'running',
    type: at?.type,
    agent: at?.agent,
  }
}

export function squadDir(s: SquadInfo): string {
  return join(s.cwd, 'squads', s.code)
}

export function isDir(p: unknown): p is string {
  try {
    return typeof p === 'string' && statSync(p).isDirectory()
  } catch {
    return false
  }
}

function frontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { meta: {}, body: text }
  let meta: Record<string, unknown> = {}
  try {
    meta = (parse(m[1]) ?? {}) as Record<string, unknown>
  } catch {
    // a broken header still leaves a usable persona
  }
  return { meta, body: text.slice(m[0].length) }
}

/**
 * Resolves a path from squad.yaml, refusing anything that climbs out of the squad folder,
 * symlinks included: both sides go through realpath, so a link pointing outside is refused.
 * A file that does not exist gives null (there is nothing to read).
 */
function inside(dir: string, rel: string): string | null {
  let realDir: string
  let p: string
  try {
    realDir = realpathSync(dir)
    p = realpathSync(resolve(dir, rel))
  } catch {
    return null
  }
  return within(realDir, p) ? p : null
}

/** `p` is strictly below `dir` (both already real paths). */
function within(dir: string, p: string): boolean {
  const r = relative(dir, p)
  return !!r && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}
