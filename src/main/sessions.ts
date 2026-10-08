import { execFile } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { getSessionInfo, getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk'
import type { LogEntry, OpenTerminalResult, SessionEntry } from '@shared/types'
import { toolDetail } from './agents'
import { findClaude } from './claude-path'
import { createOpenGuard } from './resume-guard'
import { launchOnWindows } from './terminal-launch'

/**
 * Resume center: recent Claude Code sessions saved on this machine
 * (~/.claude/projects/<project>/<session>.jsonl), from the terminal or the office.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const cwdCache = new Map<string, string | null>()

export function isSessionId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id)
}

export async function recentSessions(limit = 80): Promise<SessionEntry[]> {
  const list = await listSessions({ limit })
  return Promise.all(
    list.map(async (s) => ({
      sessionId: s.sessionId,
      title: (s.customTitle || s.summary || s.firstPrompt || 'Sessão sem título').trim(),
      firstPrompt: s.firstPrompt?.trim(),
      cwd: s.cwd || (await cwdFromTranscript(s.sessionId)) || undefined,
      branch: s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : undefined,
      lastModified: s.lastModified,
      fileSize: s.fileSize,
    })),
  )
}

export async function sessionEntry(sessionId: string): Promise<SessionEntry | null> {
  const s = await getSessionInfo(sessionId)
  if (!s) return null
  return {
    sessionId,
    title: (s.customTitle || s.summary || s.firstPrompt || 'Sessão sem título').trim(),
    firstPrompt: s.firstPrompt,
    cwd: s.cwd || (await cwdFromTranscript(sessionId)) || undefined,
    lastModified: s.lastModified,
  }
}

/** The end of a transcript as office log entries, plus the model the session last used. */
export async function transcript(sessionId: string, keep = 80): Promise<{ log: LogEntry[]; model?: string }> {
  const messages = await getSessionMessages(sessionId)
  const out: LogEntry[] = []
  let model: string | undefined
  let n = 0
  const add = (kind: LogEntry['kind'], text: string, tool?: string, isError?: boolean) =>
    out.push({ id: `${sessionId}-${n++}`, t: 0, kind, text, tool, isError })

  for (const m of messages) {
    if (m.parent_tool_use_id) continue // subagent chatter
    const msg = m.message as { content?: unknown }
    const content = msg?.content
    if (m.type === 'user') {
      if (typeof content === 'string') {
        if (!isMeta(content)) add('user', content)
        continue
      }
      for (const b of asBlocks(content)) {
        if (b.type === 'text' && typeof b.text === 'string' && !isMeta(b.text)) add('user', b.text)
        else if (b.type === 'tool_result') {
          const text = typeof b.content === 'string' ? b.content : asBlocks(b.content).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n')
          if (text.trim()) add('tool_result', text.slice(0, 1200), undefined, b.is_error === true)
        }
      }
    } else if (m.type === 'assistant') {
      const used = (msg as { model?: unknown }).model
      if (typeof used === 'string' && used.startsWith('claude-')) model = used
      for (const b of asBlocks(content)) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) add('assistant', b.text)
        else if (b.type === 'tool_use' && typeof b.name === 'string') add('tool', toolDetail(b.name, (b.input ?? {}) as Record<string, unknown>), b.name)
      }
    }
  }
  const tail = out.slice(-keep)
  if (out.length > keep) tail.unshift({ id: `${sessionId}-older`, t: 0, kind: 'system', text: `… ${out.length - keep} mensagens anteriores ocultas` })
  tail.push({ id: `${sessionId}-back`, t: Date.now(), kind: 'system', text: 'Sessão retomada. Mande a próxima instrução.' })
  return { log: tail, model }
}

// One terminal per click burst (throttle of 1.5 s), see resume-guard.ts.
const guardOpen = createOpenGuard()

/**
 * Runs `claude --resume <id>` in the session's folder: a new Terminal window on
 * macOS; a Windows Terminal tab or a console window of its own on Windows.
 * `cwd` comes from ~/.claude, so it is untrusted: absolute, existing, no control
 * characters; on Windows only a .exe runs (a .cmd/.ps1 would need a shell).
 */
export function openInTerminal(sessionId: string, cwd: string): Promise<OpenTerminalResult> {
  if (!isSessionId(sessionId)) return Promise.resolve({ ok: false, message: 'ID de sessão inválido.' })
  const guard = guardOpen(cwd, process.platform, findClaude)
  if (!guard.ok) return Promise.resolve(guard)

  if (process.platform === 'win32' && guard.exe) return launchOnWindows(resolvePath(cwd), guard.exe, sessionId)
  if (process.platform !== 'darwin') return Promise.resolve({ ok: false, message: 'Abrir no terminal funciona no Mac e no Windows. Use "Copiar comando".' })
  // A .command file opens in Terminal without needing Automation permission.
  // Paths go in single quotes; the session id is a validated UUID.
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const file = join(tmpdir(), `agent-office-resume-${sessionId}.command`)
  writeFileSync(file, `#!/bin/zsh -l\ncd -- ${q(cwd)} && exec ${q(findClaude() ?? 'claude')} --resume ${sessionId}\n`, { mode: 0o700 })
  return new Promise((resolve) => {
    execFile('open', ['-a', 'Terminal', file], (err) => resolve(err ? { ok: false, message: err.message } : { ok: true, via: 'terminal-app' }))
  })
}

// ---------- helpers ----------

type Block = { type?: string; text?: unknown; name?: unknown; input?: unknown; content?: unknown; is_error?: unknown }

function asBlocks(v: unknown): Block[] {
  return Array.isArray(v) ? (v as Block[]) : []
}

/** Slash-command echoes, hook output and system reminders are not things the user typed. */
function isMeta(text: string): boolean {
  const t = text.trimStart()
  return !t || /^<(command-|local-command|system-reminder|bash-|user-memory|task-notification)/.test(t) || t.startsWith('[Request interrupted')
}

/**
 * Sessions whose first prompt carries images report no cwd: the field comes after
 * the image data. Read the start of the transcript until it shows up.
 */
async function cwdFromTranscript(sessionId: string): Promise<string | null> {
  if (cwdCache.has(sessionId)) return cwdCache.get(sessionId) ?? null
  const file = findTranscript(sessionId)
  const cwd = file ? await scanForCwd(file) : null
  cwdCache.set(sessionId, cwd)
  return cwd
}

function findTranscript(sessionId: string): string | null {
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  try {
    for (const dir of readdirSync(root)) {
      const f = join(root, dir, `${sessionId}.jsonl`)
      if (existsSync(f)) return f
    }
  } catch {
    // no projects folder
  }
  return null
}

function scanForCwd(file: string, maxBytes = 16 * 1024 * 1024): Promise<string | null> {
  return new Promise((resolve) => {
    let buf = ''
    let read = 0
    const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 256 * 1024 })
    const done = (v: string | null) => {
      stream.destroy()
      resolve(v)
    }
    stream.on('data', (chunk: string | Buffer) => {
      const text = String(chunk)
      read += text.length
      buf = buf.slice(-512) + text // keep a little overlap so a match is never split
      const m = buf.match(/"cwd":"((?:[^"\\]|\\.)*)"/)
      if (m) {
        try {
          return done(JSON.parse(`"${m[1]}"`))
        } catch {
          return done(null)
        }
      }
      if (read > maxBytes) done(null)
    })
    stream.on('end', () => resolve(null))
    stream.on('error', () => resolve(null))
  })
}
