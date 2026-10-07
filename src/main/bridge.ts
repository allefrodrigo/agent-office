import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { describeTool } from '@shared/describe'
import type { BridgeStatus, PermissionDecision } from '@shared/types'
import { permissionFromTool, type AgentManager } from './agents'
import { isClaudeProcess, pidForClientPort, terminate } from './session-process'

/**
 * Bridge for Claude Code sessions running in a terminal.
 *
 * Claude Code posts its hook events (type "http" hooks in ~/.claude/settings.json)
 * to this local server. Each session becomes an agent in the office, and
 * PermissionRequest hooks are held open until the player decides in the game.
 *
 * Security: binds to 127.0.0.1 only, requires a random token header, and
 * rejects any request carrying an Origin header (i.e. coming from a browser page).
 */

const HOOK_PATH = '/agent-office/hook'
const MARKER = 'agent-office/hook'
const BODY_LIMIT = 2 * 1024 * 1024
const PERMISSION_TIMEOUT_S = 600

type HookInput = {
  hook_event_name: string
  session_id: string
  cwd?: string
  prompt?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  permission_suggestions?: unknown[]
  notification_type?: string
  message?: string
  last_assistant_message?: string
  error?: string
}

export class Bridge {
  private server: Server | null = null
  private listening = false
  private lastError: string | undefined
  private token: string
  private settingsPath = join(homedir(), '.claude', 'settings.json')
  /** session_id -> PID of the claude process, learned from its hook connections. */
  private pids = new Map<string, number>()

  constructor(
    private manager: AgentManager,
    private port: number,
    tokenFile: string,
    private onStatus: (s: BridgeStatus) => void,
  ) {
    this.token = loadToken(tokenFile)
  }

  status(): BridgeStatus {
    return { installed: this.isInstalled(), listening: this.listening, port: this.port, error: this.lastError }
  }

  start(): void {
    const server = createServer((req, res) => this.handle(req, res))
    server.on('error', (err: NodeJS.ErrnoException) => {
      this.listening = false
      this.lastError = err.code === 'EADDRINUSE' ? `A porta ${this.port} já está em uso.` : err.message
      this.onStatus(this.status())
    })
    server.listen(this.port, '127.0.0.1', () => {
      this.listening = true
      this.lastError = undefined
      this.onStatus(this.status())
    })
    this.server = server
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.listening = false
  }

  // ---------- HTTP ----------

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const reply = (code: number, body: unknown = {}) => {
      if (res.writableEnded) return
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || req.url !== HOOK_PATH) return reply(404)
    if (req.headers.origin) return reply(403)
    const given = String(req.headers['x-agent-office-token'] ?? '')
    if (!safeEqual(given, this.token)) return reply(401)

    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > BODY_LIMIT) {
        reply(413)
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      let input: HookInput
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reply(400)
      }
      if (!input?.session_id || !input.hook_event_name) return reply(400)
      // Learn which process owns the session while its connection is still open.
      const port = req.socket.remotePort
      if (!this.pids.has(input.session_id) && port && input.hook_event_name !== 'SessionEnd') {
        pidForClientPort(port, this.port)
          .then((pid) => {
            if (pid) this.pids.set(input.session_id, pid)
          })
          .finally(() => this.dispatch(input, res, reply))
      } else this.dispatch(input, res, reply)
    })
  }

  /** Closes the terminal session behind an agent by stopping its claude process. */
  async closeSession(agentId: string): Promise<{ ok: boolean; message?: string }> {
    const agent = this.manager.list().find((a) => a.id === agentId && a.source === 'terminal')
    if (!agent?.sessionId) return { ok: false, message: 'Esse agente não é uma sessão do terminal.' }
    const pid = this.pids.get(agent.sessionId)
    if (!pid) return { ok: false, message: 'Não descobri qual processo é essa sessão. Feche pelo terminal.' }
    if (await isClaudeProcess(pid)) {
      if (!(await terminate(pid))) return { ok: false, message: 'A sessão não respondeu. Feche pelo terminal.' }
    }
    // Gone now (or already was): drop it from the office.
    this.pids.delete(agent.sessionId)
    this.manager.terminalKill(agentId)
    return { ok: true }
  }

  private dispatch(input: HookInput, res: ServerResponse, reply: (code: number, body?: unknown) => void): void {
    // Sessions spawned by the office report through the SDK, not through hooks.
    if (this.manager.isOfficeSession(input.session_id)) return reply(200)

    const event = input.hook_event_name
    if (event === 'SessionEnd') {
      this.pids.delete(input.session_id)
      const agent = this.manager.findTerminal(input.session_id)
      if (agent) this.manager.terminalEnded(agent.id)
      return reply(200)
    }

    const agent = this.manager.terminalAgent(input.session_id, input.cwd ?? '')
    switch (event) {
      case 'SessionStart':
        this.manager.terminalUpdate(agent.id, 'idle', 'Esperando no terminal')
        return reply(200)
      case 'UserPromptSubmit':
        this.manager.terminalPrompt(agent.id, input.prompt ?? '')
        return reply(200)
      case 'PreToolUse': {
        // A new tool call means any pending question was answered in the terminal.
        this.manager.cancelAgentRequests(agent.id, 'Respondido no terminal.')
        const tool = input.tool_name ?? 'tool'
        this.manager.terminalUpdate(agent.id, 'working', describeTool(tool, input.tool_input ?? {}), {
          kind: 'tool',
          text: describeTool(tool, input.tool_input ?? {}),
          tool,
        })
        if (tool === 'SendMessage') this.manager.terminalChat(agent.id, input.tool_input ?? {})
        return reply(200)
      }
      case 'PostToolUseFailure':
        this.manager.terminalUpdate(agent.id, null, null, { kind: 'tool_result', text: input.error ?? 'Falhou', tool: input.tool_name })
        return reply(200)
      case 'Notification':
        if (input.notification_type === 'idle_prompt') this.manager.terminalUpdate(agent.id, 'idle', 'Esperando no terminal')
        return reply(200)
      case 'Stop':
        this.manager.terminalResult(agent.id, input.last_assistant_message?.trim() || 'Terminei.')
        return reply(200)
      case 'StopFailure':
        this.manager.terminalUpdate(agent.id, 'error', 'Deu problema', { kind: 'error', text: input.error ?? 'Erro' })
        return reply(200)
      case 'PermissionRequest':
        return this.permission(agent.id, input, res, reply)
      default:
        return reply(200)
    }
  }

  private permission(agentId: string, input: HookInput, res: ServerResponse, reply: (code: number, body?: unknown) => void): void {
    const tool = input.tool_name ?? 'tool'
    const toolInput = input.tool_input ?? {}
    const suggestions = input.permission_suggestions ?? []
    let done = false
    const requestId = this.manager.requestDecision(agentId, permissionFromTool(tool, toolInput, undefined, suggestions.length > 0), (d: PermissionDecision) => {
      if (done) return
      done = true
      reply(200, hookDecision(tool, toolInput, suggestions, d))
    })
    // Claude Code hung up before we answered (timeout, Esc, session killed): drop the request.
    // (Listen on the response: the request's own 'close' fires as soon as its body is read.)
    res.on('close', () => {
      if (done) return
      done = true
      this.manager.cancelRequest(requestId, 'Respondido no terminal.')
    })
  }

  // ---------- installer ----------

  private hookEntry(timeout = 5): Record<string, unknown> {
    return {
      type: 'http',
      url: `http://127.0.0.1:${this.port}${HOOK_PATH}`,
      headers: { 'X-Agent-Office-Token': this.token },
      timeout,
    }
  }

  private readSettings(): Record<string, unknown> {
    if (!existsSync(this.settingsPath)) return {}
    const raw = readFileSync(this.settingsPath, 'utf8').trim()
    if (!raw) return {}
    // Throws on invalid JSON on purpose: never overwrite a file we cannot parse.
    return JSON.parse(raw)
  }

  isInstalled(): boolean {
    try {
      const hooks = (this.readSettings().hooks ?? {}) as Record<string, unknown>
      return JSON.stringify(hooks).includes(`127.0.0.1:${this.port}${HOOK_PATH}`) && JSON.stringify(hooks).includes(this.token)
    } catch {
      return false
    }
  }

  install(): BridgeStatus {
    this.writeHooks((hooks) => {
      const add = (event: string, matcher: string | null, timeout?: number) => {
        const list = (hooks[event] as unknown[]) ?? []
        list.push({ ...(matcher !== null ? { matcher } : {}), hooks: [this.hookEntry(timeout)] })
        hooks[event] = list
      }
      add('SessionStart', null)
      add('SessionEnd', null)
      add('UserPromptSubmit', null)
      add('PreToolUse', '*')
      add('PostToolUseFailure', '*')
      add('PermissionRequest', '*', PERMISSION_TIMEOUT_S)
      add('Notification', null)
      add('Stop', null)
      add('StopFailure', null)
    })
    return this.status()
  }

  uninstall(): BridgeStatus {
    this.writeHooks(() => undefined)
    return this.status()
  }

  /** Removes our hook entries, lets `mutate` add new ones, then writes atomically with a backup. */
  private writeHooks(mutate: (hooks: Record<string, unknown>) => void): void {
    const settings = this.readSettings()
    const hooks = ((settings.hooks as Record<string, unknown>) ?? {}) as Record<string, unknown>
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue
      const kept = groups.filter((g) => !JSON.stringify(g).includes(MARKER))
      if (kept.length) hooks[event] = kept
      else delete hooks[event]
    }
    mutate(hooks)
    if (Object.keys(hooks).length) settings.hooks = hooks
    else delete settings.hooks

    mkdirSync(dirname(this.settingsPath), { recursive: true })
    if (existsSync(this.settingsPath)) copyFileSync(this.settingsPath, this.settingsPath + '.agent-office.bak')
    const tmp = this.settingsPath + '.agent-office.tmp'
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, this.settingsPath)
  }
}

function hookDecision(tool: string, toolInput: Record<string, unknown>, suggestions: unknown[], d: PermissionDecision): unknown {
  let decision: Record<string, unknown>
  if (d.behavior === 'deny') {
    decision = { behavior: 'deny', message: d.message?.trim() || 'O usuário negou esta ação no Agent Office.' }
  } else if (tool === 'AskUserQuestion') {
    decision = { behavior: 'allow', updatedInput: { ...toolInput, answers: d.answers ?? {} } }
  } else {
    decision = { behavior: 'allow', ...(d.behavior === 'allow_always' && suggestions.length ? { updatedPermissions: suggestions } : {}) }
  }
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }
}

function loadToken(file: string): string {
  try {
    const t = readFileSync(file, 'utf8').trim()
    if (t.length >= 32) return t
  } catch {
    // first run
  }
  const t = randomBytes(24).toString('hex')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, t, { mode: 0o600 })
  return t
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
