import type { BgKind, BgOwner } from '@shared/types'

// Reading `ps` and `lsof` for Bastidores: which processes hang under each claude, and which
// were left behind. Pure functions, so the rules can be tested without a real process table.

/** One line of `ps -axo pid=,ppid=,etime=,%cpu=,rss=,args=`. */
export interface PsRow {
  pid: number
  ppid: number
  startedAt: number
  /** % of one core. */
  cpu: number
  /** Kilobytes. */
  rss: number
  args: string
}

/** A command an agent's shell is running, with everything below it. */
export interface Found {
  root: PsRow
  command: string
  /** The shell and all its descendants. */
  pids: number[]
  cpu: number
  rss: number
}

/** "[[dd-]hh:]mm:ss" in seconds, or null. */
export function parseEtime(s: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim())
  if (!m) return null
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3]) * 60 + Number(m[4])
}

export function parsePs(out: string, now: number): PsRow[] {
  const rows: PsRow[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!m) continue
    const secs = parseEtime(m[3])
    if (secs === null) continue
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), startedAt: now - secs * 1000, cpu: Number(m[4]), rss: Number(m[5]), args: m[6] })
  }
  return rows
}

/** A Claude Code CLI, not the Chrome bridge (`claude --chrome-native-host`), which is no agent. */
export function isClaude(args: string): boolean {
  const first = args.split(' ')[0]
  return /(^|\/)claude$/.test(first) && !args.includes('--chrome-native-host')
}

/** The session a CLI runs (`--resume=<id>`, `--resume <id>`, `--session-id <id>`). */
export function sessionOf(args: string): string | undefined {
  return /--(?:resume|session-id)[= ]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(args)?.[1]
}

/**
 * The command inside Claude Code's shell wrapper (`zsh -c source …/shell-snapshots/… && eval '<cmd>' && pwd -P >| …`),
 * or null when the process is not one. ps shows newlines as \012.
 */
export function shellCommand(args: string): string | null {
  if (!args.includes('shell-snapshots')) return null
  const m = /\beval '([\s\S]*)'(?:\s*\\?<\s*\/dev\/null)?\s*&&\s*pwd -P/.exec(args)
  if (!m) return null
  const cmd = m[1].replace(/'"'"'/g, "'").replace(/\\012/g, '\n').trim()
  return cmd || null
}

/**
 * First meaningful line of a command, for a one-line label, without the redirect Claude Code
 * adds to a background command (`> /tmp/claude-501/…/tasks/x.output 2>&1`).
 */
export function commandLabel(cmd: string): string {
  const first =
    cmd
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? cmd
  const line = first
    .replace(/\s+\d?>>?\s*\S*\/claude-[^\s]*/g, '')
    .replace(/\s+2>&1/g, '')
    .replace(/\s*&\s*$/, '')
    .trim()
  return line.length > 200 ? `${line.slice(0, 199)}…` : line || first
}

/** Ports worth showing: the ones a person opens (below the ephemeral range), at most three; else the lowest. */
export function mainPorts(ports: number[]): number[] {
  const sorted = [...new Set(ports)].sort((a, b) => a - b)
  const chosen = sorted.filter((p) => p < 49152)
  return (chosen.length ? chosen : sorted).slice(0, 3)
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn`: pid -> ports it listens on. */
export function parseListen(out: string): Map<number, number[]> {
  const map = new Map<number, number[]>()
  let pid = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1)) || 0
    else if (line.startsWith('n') && pid) {
      const port = Number(line.slice(line.lastIndexOf(':') + 1))
      if (!Number.isInteger(port) || port <= 0) continue
      const ports = map.get(pid) ?? []
      if (!ports.includes(port)) ports.push(port)
      map.set(pid, ports)
    }
  }
  return map
}

const MONITOR = /(^|\s|\/)(tail\s+(-\w*\s+)*-[fF]|watch\s|fswatch|inotifywait|nodemon|entr\s)|--watch\b|\bwatch\b.*\btest/

export function kindOf(label: string, ports: number[], taskType = ''): BgKind {
  if (/agent|workflow/.test(taskType)) return 'helper'
  if (ports.length) return 'server'
  if (/monitor/.test(taskType) || MONITOR.test(label)) return 'monitor'
  return 'shell'
}

export function childrenOf(rows: PsRow[]): Map<number, PsRow[]> {
  const kids = new Map<number, PsRow[]>()
  for (const r of rows) {
    const list = kids.get(r.ppid)
    if (list) list.push(r)
    else kids.set(r.ppid, [r])
  }
  return kids
}

/** `root` and every process below it. */
export function subtree(root: PsRow, kids: Map<number, PsRow[]>): PsRow[] {
  const out: PsRow[] = []
  const stack = [root]
  while (stack.length) {
    const r = stack.pop()!
    out.push(r)
    for (const k of kids.get(r.pid) ?? []) stack.push(k)
  }
  return out
}

/** The commands a claude process is running through its shell, each with its children. */
export function shellsUnder(claudePid: number, kids: Map<number, PsRow[]>): Found[] {
  const found: Found[] = []
  for (const child of kids.get(claudePid) ?? []) {
    const command = shellCommand(child.args)
    if (!command) continue
    const tree = subtree(child, kids)
    found.push({
      root: child,
      command,
      pids: tree.map((r) => r.pid),
      cpu: tree.reduce((s, r) => s + r.cpu, 0),
      rss: tree.reduce((s, r) => s + r.rss, 0),
    })
  }
  return found
}

interface Seen {
  startedAt: number
  owner: BgOwner
  command: string
}

/** A process an agent started that no claude holds anymore. */
export interface Orphan {
  root: PsRow
  owner: BgOwner
  command: string
  pids: number[]
  cpu: number
  rss: number
}

/** Same process as before: the pid was not reused (start times within 2 s; etime has 1 s steps). */
const same = (row: PsRow | undefined, seen: { startedAt: number }) => !!row && Math.abs(row.startedAt - seen.startedAt) <= 2000

/**
 * Remembers every process seen under an agent's claude. When one is still alive but no
 * claude holds it (the agent left, or the shell that started it ended), it is an orphan.
 */
export class OrphanBook {
  private seen = new Map<number, Seen>()

  /** Every pid of this command now belongs to `owner`. */
  note(found: Found, owner: BgOwner, rows: Map<number, PsRow>): void {
    for (const pid of found.pids) {
      const row = rows.get(pid)
      if (row && !this.seen.has(pid)) this.seen.set(pid, { startedAt: row.startedAt, owner, command: found.command })
    }
  }

  /** Remembered processes still alive and outside `held` (the pids under a live claude), grouped by their top process. */
  orphans(rows: PsRow[], held: Set<number>, kids: Map<number, PsRow[]>): Orphan[] {
    const byPid = new Map(rows.map((r) => [r.pid, r]))
    const loose = new Set<number>()
    for (const [pid, s] of this.seen) {
      if (!same(byPid.get(pid), s)) this.seen.delete(pid)
      else if (!held.has(pid)) loose.add(pid)
    }
    const out: Orphan[] = []
    for (const pid of loose) {
      const row = byPid.get(pid)!
      if (loose.has(row.ppid)) continue
      const tree = subtree(row, kids)
      const s = this.seen.get(pid)!
      // A child left behind shows its own command, not the shell line it came from.
      const command = shellCommand(row.args) ?? (row.args.length > 200 ? `${row.args.slice(0, 199)}…` : row.args)
      out.push({
        root: row,
        owner: { ...s.owner, kind: 'gone' },
        command: command || s.command,
        pids: tree.map((r) => r.pid),
        cpu: tree.reduce((a, r) => a + r.cpu, 0),
        rss: tree.reduce((a, r) => a + r.rss, 0),
      })
    }
    return out
  }

  /** Forget a stopped process right away. */
  forget(pids: number[]): void {
    for (const pid of pids) this.seen.delete(pid)
  }
}

/** Where Claude Code writes a background task's output: <tmp>/claude-<uid>/<project>/<session>/tasks/<task>.output. */
export function taskOutputCandidates(
  roots: string[],
  uid: number | undefined,
  projects: (root: string) => string[],
  sessionId: string,
  taskId: string,
): string[] {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !/^[\w-]{1,64}$/.test(taskId)) return []
  const out: string[] = []
  for (const root of roots) {
    const base = uid === undefined ? `${root}/claude` : `${root}/claude-${uid}`
    for (const project of projects(base)) out.push(`${base}/${project}/${sessionId}/tasks/${taskId}.output`)
  }
  return out
}
