import { SENSITIVE_KINDS, SENSITIVE_LABEL, type SensitiveKind } from './types/bots'

// Guarda de ações sensíveis do Chat dos bots (docs/prd/chat-de-bots.md, "Guarda de ações sensíveis").
// Função pura: diz se uma chamada de ferramenta envia, publica, apaga, paga ou mexe no git remoto.
// Erra para o lado de pedir: um falso positivo custa um clique; um falso negativo, um envio sem o seu sim.
// O que não dá para ler (um comando que vem de uma variável, um alias, um executor de MCP) pede tudo.

export interface GuardOptions {
  /** Where an mcp__ tool comes from (PreToolUse mcp_server.source, canUseTool mcpServer.source). */
  mcpSource?: string
}

const MAX_DEPTH = 4
/** Past this, a command is not read word by word: it asks. */
const MAX_COMMAND = 20_000
/** MCP input: string values read, and how much of each. */
const MAX_MCP_STRINGS = 100

/**
 * The first sensitive kind of a tool call, or null. Order when several match: pay, push,
 * publish, send, delete (the costliest first).
 */
export function sensitiveKind(tool: string, input: unknown, opts: GuardOptions = {}): SensitiveKind | null {
  return sensitiveKinds(tool, input, opts)[0] ?? null
}

/** Every sensitive kind a tool call falls in, costliest first (pay, push, publish, send, delete). */
export function sensitiveKinds(tool: string, input: unknown, opts: GuardOptions = {}): SensitiveKind[] {
  const found = new Set<SensitiveKind>()
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (tool === 'Bash' || tool === 'Monitor' || tool === 'PowerShell') {
    const command = typeof args.command === 'string' ? args.command : ''
    if (command.length > MAX_COMMAND) all(found)
    else shellKinds(command, found, 0, tool === 'PowerShell')
  } else if (tool.startsWith('mcp__')) {
    mcpKinds(tool, args, opts, found)
  }
  return ORDER.filter((k) => found.has(k))
}

const ORDER: SensitiveKind[] = ['pay', 'push', 'publish', 'send', 'delete']
const all = (found: Set<SensitiveKind>) => {
  for (const k of SENSITIVE_KINDS) found.add(k)
}
/** Text that the shell fills in at run time ($VAR, ${…}, $'…', $(…), `…`): it cannot be read here. */
const expands = (s: string) => /[$`]/.test(s)

/** "Publicar: npm publish", "Enviar: gmail › send_email": the reason the card and the hook show. */
export function guardReason(kind: SensitiveKind, tool: string, input: unknown): string {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  let what = tool
  if (typeof args.command === 'string') what = oneLine(args.command, 120)
  else if (tool.startsWith('mcp__')) {
    const { server, name } = splitMcp(tool)
    what = `${server} › ${name}`
  }
  return `${SENSITIVE_LABEL[kind]}: ${what}`
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// ---------- MCP tools ----------

function splitMcp(tool: string): { server: string; name: string } {
  const rest = tool.slice('mcp__'.length)
  const i = rest.indexOf('__')
  return i < 0 ? { server: rest, name: '' } : { server: rest.slice(0, i), name: rest.slice(i + 2) }
}

/** send_email, sendEmail, chat.postMessage -> ['send', 'email'], ['chat', 'post', 'message']. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const PAY = new Set(['pay', 'payment', 'payments', 'charge', 'charges', 'refund', 'refunds', 'invoice', 'invoices', 'payout', 'payouts', 'transfer', 'purchase', 'checkout', 'subscribe', 'subscription', 'billing'])
const PUSH = new Set(['merge', 'push'])
const PUBLISH = new Set(['publish', 'deploy', 'release', 'promote', 'launch', 'rollout'])
const SEND = new Set(['send', 'reply', 'forward', 'post', 'tweet', 'dm', 'invite', 'share', 'broadcast', 'notify', 'sms'])
const DELETE = new Set(['delete', 'remove', 'archive', 'destroy', 'drop', 'purge', 'erase', 'trash', 'wipe', 'truncate', 'unpublish', 'revoke', 'cancel', 'terminate', 'rm', 'del'])
/** Verbs that only read: `get_release`, `list_payments` stay quiet unless a stronger verb comes later. */
const READ = new Set(['get', 'list', 'search', 'read', 'fetch', 'find', 'query', 'describe', 'view', 'show', 'count', 'lookup', 'download', 'preview', 'check', 'inspect', 'status'])
/** Verbs that act whatever the first word says. */
const STRONG = new Set(['send', 'reply', 'forward', 'delete', 'remove', 'destroy', 'purge', 'publish', 'deploy', 'merge', 'push', 'charge', 'refund', 'pay', 'payout'])
/** create_message, write_email: making a message is sending it. */
const MAKE = new Set(['create', 'new', 'write', 'compose', 'add', 'post', 'submit'])
const MESSAGE = new Set(['message', 'messages', 'email', 'emails', 'mail', 'comment', 'comments', 'reply', 'post', 'tweet', 'chat'])
/** Tools that run whatever their input says: nothing in the name tells what they will do. */
const EXECUTOR = new Set(['execute', 'exec', 'run', 'shell', 'command', 'commands', 'cmd', 'script', 'eval', 'bash', 'sh', 'terminal', 'powershell', 'pwsh', 'invoke', 'repl'])
const SQLISH = new Set(['sql', 'query', 'statement'])

function mcpKinds(tool: string, input: Record<string, unknown>, opts: GuardOptions, found: Set<SensitiveKind>): void {
  const { server, name } = splitMcp(tool)
  // The office's own server (board, atas, memory) never leaves the machine. Trust its provenance,
  // not its name: a configured server could also call itself "office" (CLI docs: key trust on source).
  if (server === 'office' && (opts.mcpSource === undefined || opts.mcpSource === 'sdk')) return
  const w = words(name)
  const strings = inputStrings(input)
  const reads = READ.has(w[0] ?? '')
  // SQL (query, execute_sql…): one read-only statement goes, anything else asks for everything.
  const sql = strings.map(stripSql).filter(looksSql)
  if (w.some((x) => SQLISH.has(x)) && sql.length) {
    if (!sql.every(readOnlySql)) return all(found)
  } else if (!reads && w.some((x) => EXECUTOR.has(x) || x === 'sql' || x === 'statement')) {
    // A tool that runs what it is given (execute, run_command, eval, a sql tool whose statement
    // cannot be found): its name says nothing of what it will do, so it asks.
    return all(found)
  }
  nameKinds(w, reads, found)
  // What the call carries counts too (a remote shell's host({ cmd: 'git push' }) under any name).
  // Not when the name already asks (a send_message about "git push" is still a message) nor for
  // a tool that only reads (a search for "drop table" drops nothing).
  if (!found.size && !reads) for (const s of strings) shellKinds(s, found, 1)
}

function nameKinds(w: string[], reads: boolean, found: Set<SensitiveKind>): void {
  if (!w.length || (reads && !w.slice(1).some((x) => STRONG.has(x)))) return
  const has = (set: Set<string>) => w.some((x) => set.has(x))
  if (has(PAY)) found.add('pay')
  if (has(PUSH) || (w.includes('pull') && w.includes('request') && w.some((x) => MAKE.has(x) || x === 'open'))) found.add('push')
  if (has(PUBLISH)) found.add('publish')
  // A draft stays on the machine of whoever reads it later: create_draft is fine, send_draft is not.
  const drafting = w.includes('draft') || w.includes('drafts')
  if (w.includes('send') || (!drafting && (has(SEND) || (w.some((x) => MAKE.has(x)) && has(MESSAGE))))) found.add('send')
  if (has(DELETE)) found.add('delete')
}

/** String values of an MCP input, three levels down at most, each cut at MAX_COMMAND. */
function inputStrings(input: Record<string, unknown>): string[] {
  const out: string[] = []
  const walk = (v: unknown, depth: number) => {
    if (out.length >= MAX_MCP_STRINGS) return
    if (typeof v === 'string') {
      if (v.trim()) out.push(v.slice(0, MAX_COMMAND))
    } else if (depth < 3 && v && typeof v === 'object') {
      for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1)
    }
  }
  walk(input, 0)
  return out
}

const stripSql = (s: string) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').trim()
const looksSql = (s: string) => /^\(?\s*(select|with|explain|show|describe|desc|insert|update|delete|drop|alter|create|truncate|pragma|grant|revoke|call|exec|execute|merge|copy|set|replace|upsert|vacuum|attach|lock|begin|commit|do)\b/i.test(s)
/** Writes, or reads with side effects (SELECT INTO, nextval, pg_terminate_backend, dblink…). */
const SQL_WRITE = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|exec|execute|copy|replace|upsert|attach|detach|vacuum|set|reindex|cluster|lock|comment|rename|do|into|nextval|setval|set_config|load_file|outfile|dumpfile|sleep|benchmark)\b|\b(pg_|dblink|lo_|xp_|sp_)\w*/i
/** One SELECT (or WITH/EXPLAIN/SHOW/DESCRIBE) that writes nothing. */
function readOnlySql(s: string): boolean {
  return /^\(?\s*(select|with|explain|show|describe|desc)\b/i.test(s) && !/;\s*\S/.test(s) && !SQL_WRITE.test(s)
}

// ---------- shell commands ----------

interface Token {
  text: string
  /** Starts inside quotes ("if", "A=1"): a plain word, never a keyword or an assignment. */
  quoted: boolean
}

interface Parsed {
  segments: Token[][]
  /** $(…) and `…`, read as commands of their own. */
  subs: string[]
}

/**
 * Splits a command line into simple commands (on ; && || | & newlines and parentheses) and
 * collects command substitutions, even inside double quotes. A substitution stays in its word
 * too, so `$(echo git) push` keeps a command that comes from an expansion. Close enough to sh
 * for this purpose; the literal patterns of rawKinds catch what it gets wrong.
 */
function tokenize(cmd: string): Parsed {
  const segments: Token[][] = []
  const subs: string[] = []
  let seg: Token[] = []
  let cur = ''
  let quoted = false
  let inWord = false
  const endWord = () => {
    if (inWord) seg.push({ text: cur, quoted })
    cur = ''
    quoted = false
    inWord = false
  }
  const endSeg = () => {
    endWord()
    if (seg.length) segments.push(seg)
    seg = []
  }
  /** Reads $( … ) from i (pointing at '('), returns the index after ')'. */
  const readParen = (i: number): number => {
    let depth = 1
    let j = i + 1
    let quote = ''
    while (j < cmd.length && depth > 0) {
      const c = cmd[j]
      if (quote) {
        if (c === quote) quote = ''
        else if (c === '\\' && quote === '"') j++
      } else if (c === '"' || c === "'") quote = c
      else if (c === '(') depth++
      else if (c === ')') depth--
      j++
    }
    subs.push(cmd.slice(i + 1, depth === 0 ? j - 1 : j))
    return j
  }
  const readTick = (i: number): number => {
    const end = cmd.indexOf('`', i + 1)
    const stop = end < 0 ? cmd.length : end
    subs.push(cmd.slice(i + 1, stop))
    return stop + 1
  }
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1)
      const stop = end < 0 ? cmd.length : end
      cur += cmd.slice(i + 1, stop)
      if (!inWord) quoted = true
      inWord = true
      i = stop + 1
    } else if (c === '"') {
      let j = i + 1
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === '\\' && j + 1 < cmd.length) {
          cur += cmd[j + 1]
          j += 2
        } else if (cmd[j] === '$' && cmd[j + 1] === '(') {
          const start = j
          j = readParen(j + 1)
          cur += cmd.slice(start, j)
        } else if (cmd[j] === '`') {
          const start = j
          j = readTick(j)
          cur += cmd.slice(start, j)
        } else cur += cmd[j++]
      }
      if (!inWord) quoted = true
      inWord = true
      i = j + 1
    } else if (c === '\\') {
      if (cmd[i + 1] === '\n') i += 2
      else {
        cur += cmd[i + 1] ?? ''
        inWord = true
        i += 2
      }
    } else if (c === '$' && cmd[i + 1] === '(') {
      const start = i
      i = readParen(i + 1)
      cur += cmd.slice(start, i)
      inWord = true
    } else if (c === '`') {
      const start = i
      i = readTick(i)
      cur += cmd.slice(start, i)
      inWord = true
    } else if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')' || c === '{' || c === '}') {
      // `{` and `}` only group when they stand alone; "a{b}" and "${X}" stay one word.
      if ((c === '{' || c === '}') && (inWord || cmd[i - 1] === '$')) {
        cur += c
        inWord = true
        i++
        continue
      }
      endSeg()
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
    } else {
      cur += c
      inWord = true
      i++
    }
  }
  endSeg()
  return { segments, subs }
}

/** /usr/local/bin/git, git.exe -> git */
function prog(token: string): string {
  return (token.split(/[\\/]/).pop() ?? token).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh'])
const PS = new Set(['powershell', 'pwsh'])
/** What xargs may feed without the guard losing track: the arguments it adds are files or words. */
const XARGS_SAFE = new Set(['grep', 'egrep', 'fgrep', 'rg', 'cat', 'head', 'tail', 'wc', 'ls', 'echo', 'printf', 'file', 'stat', 'du', 'basename', 'dirname', 'sort', 'uniq', 'touch', 'mkdir', 'rm', 'sed', 'prettier', 'eslint', 'tsc', 'chmod', 'dos2unix'])
/** Shell words that come before a command (`if git push; then`, `do rm -rf x`). */
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!'])
/** Environment variables whose value is a command the program runs. */
const CODE_ENV = /^(GIT_SSH_COMMAND|GIT_SSH|GIT_EXTERNAL_DIFF|GIT_PAGER|GIT_EDITOR|GIT_ASKPASS|GIT_SEQUENCE_EDITOR|PAGER|EDITOR|VISUAL|SSH_ASKPASS|BASH_ENV|ENV|PROMPT_COMMAND)=/
/** Variables that change what git does (aliases, hooks, remotes): not readable from here. */
const CONFIG_ENV = /^(GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM)|GIT_EXEC_PATH|GIT_DIR|GIT_TEMPLATE_DIR)=/

interface Unwrapped {
  tokens: Token[]
  /** xargs (or parallel) adds arguments read from stdin. */
  xargs: boolean
  /** Commands hidden in environment variables (GIT_SSH_COMMAND=…). */
  code: string[]
  /** Something it cannot read changed the command (GIT_CONFIG_*). */
  unknown: boolean
}

/** Drops what only wraps the real command: VAR=1, sudo, env, nohup, time, xargs, npx… */
function unwrap(tokens: Token[]): Unwrapped {
  const out: Unwrapped = { tokens, xargs: false, code: [], unknown: false }
  const assignment = (t: string) => {
    if (CONFIG_ENV.test(t)) out.unknown = true
    else if (CODE_ENV.test(t)) out.code.push(t.slice(t.indexOf('=') + 1))
  }
  let t = tokens
  for (let guard = 0; guard < 10 && t.length; guard++) {
    const first = t[0].text
    if (/^[A-Za-z_][\w]*=/.test(first) && !t[0].quoted) {
      assignment(first)
      t = t.slice(1)
      continue
    }
    const p = prog(first)
    if (KEYWORDS.has(first) && !t[0].quoted) {
      t = t.slice(1)
    } else if (p === 'sudo' || p === 'doas') {
      let k = 1
      while (k < t.length && t[k].text.startsWith('-')) k += /^-[ugCchpr]$/.test(t[k].text) ? 2 : 1
      t = t.slice(k)
    } else if (p === 'env') {
      let k = 1
      while (k < t.length && (t[k].text.startsWith('-') || /^[A-Za-z_][\w]*=/.test(t[k].text))) {
        const a = t[k].text
        if (!a.startsWith('-')) assignment(a)
        // env -S "git push": the string is the command.
        else if (a === '-S' || a === '--split-string') out.code.push(t[k + 1]?.text ?? '')
        else if (a.startsWith('-S') || a.startsWith('--split-string=')) out.code.push(a.slice(a.startsWith('-S') ? 2 : 15))
        k += /^-[uSC]$|^--split-string$/.test(a) ? 2 : 1
      }
      t = t.slice(k)
    } else if (['nohup', 'time', 'command', 'exec', 'builtin', 'caffeinate', 'stdbuf', 'unbuffer'].includes(p)) {
      let k = 1
      while (k < t.length && t[k].text.startsWith('-')) k++
      t = t.slice(k)
    } else if (p === 'nice' || p === 'ionice' || p === 'timeout' || p === 'watch' || p === 'xargs' || p === 'parallel') {
      if (p === 'xargs' || p === 'parallel') out.xargs = true
      // Options, then (timeout) a duration: whatever looks like an option or a number goes.
      let k = 1
      while (k < t.length && (t[k].text.startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(t[k].text))) k += /^-[IinPLsEd]$/.test(t[k].text) && p === 'xargs' ? 2 : 1
      t = t.slice(k)
    } else if (p === 'npx' || p === 'pnpx' || p === 'bunx') {
      let k = 1
      while (k < t.length && t[k].text.startsWith('-')) k++
      t = t.slice(k)
    } else if ((p === 'pnpm' || p === 'yarn') && t[1]?.text === 'dlx') {
      t = t.slice(2)
    } else if (p === 'npm' && t[1]?.text === 'exec') {
      let k = 2
      while (k < t.length && t[k].text.startsWith('-')) k++
      t = t.slice(k)
    } else break
  }
  out.tokens = t
  return out
}

function shellKinds(cmd: string, found: Set<SensitiveKind>, depth: number, powershell = false): void {
  if (depth > MAX_DEPTH) {
    // Nested this deep on purpose: it asks.
    all(found)
    return
  }
  rawKinds(cmd, found, powershell)
  // PowerShell's call operators run what a variable or an expression holds: & $cmd, . $script, & (…).
  if (powershell && /(^|[\s;|({])[&.]\s*[$(]/.test(cmd)) all(found)
  const { segments, subs } = tokenize(cmd)
  for (const sub of subs) shellKinds(sub, found, depth + 1, powershell)
  for (const seg of segments) simpleKinds(seg, found, depth, powershell)
}

/** One simple command: what wraps it, the code hidden in its environment, then the command itself. */
function simpleKinds(seg: Token[], found: Set<SensitiveKind>, depth: number, powershell: boolean): void {
  const u = unwrap(seg)
  if (u.unknown) all(found)
  for (const code of u.code) shellKinds(code, found, depth + 1)
  segmentKinds(u, found, depth, powershell)
}

/** Literal patterns over the whole text: they catch what hides in quotes, heredocs and scripts. */
function rawKinds(cmd: string, found: Set<SensitiveKind>, powershell: boolean): void {
  const raw: [RegExp, SensitiveKind][] = [
    [/\bgit\s+push\b/i, 'push'],
    [/\bgit\s+(send-pack|http-push)\b/i, 'push'],
    [/\bgh\s+pr\s+(merge|create)\b/i, 'push'],
    [/\bgh\s+release\s+create\b/i, 'publish'],
    [/\b(npm|pnpm|yarn|bun)\s+publish\b/i, 'publish'],
    [/\b(vercel|netlify|fly|flyctl|firebase|wrangler|serverless|sls)\s+deploy\b/i, 'publish'],
    [/\bvercel\s+(--prod|-p\b)/i, 'publish'],
    [/\brm\s+(-[a-z]*r[a-z]*|-[a-z]*R[a-z]*|--recursive)\b/, 'delete'],
    [/\bgit\s+clean\s+-[a-z]*f/i, 'delete'],
    [/\bgit\s+reset\s+--hard\b/i, 'delete'],
    [/\b(drop|truncate)\s+(table|database|schema|index|view|collection)\b/i, 'delete'],
    [/\btruncate\s+(?!-)\w/i, 'delete'],
    [/\bdelete\s+from\b/i, 'delete'],
    [/\bdropDatabase\b|\bflushall\b|\bflushdb\b/i, 'delete'],
    [/\bsendmail\b/i, 'send'],
    [/\bglab\s+mr\s+(merge|create)\b/i, 'push'],
    [/\bglab\s+release\s+create\b/i, 'publish'],
    // A proxy set in the command sends even a request to localhost through someone else.
    [/\b(https?|all|ftp|socks)_proxy\s*=/i, 'send'],
  ]
  if (powershell) {
    raw.push(
      [/\bRemove-Item\b[^\n;|]*-Recurse\b/i, 'delete'],
      [/\b(rd|rmdir)\s+\/s\b/i, 'delete'],
      [/\bdel\s+[^\n;|]*\/s\b/i, 'delete'],
      [/\bSend-MailMessage\b/i, 'send'],
    )
  }
  for (const [re, kind] of raw) if (re.test(cmd)) found.add(kind)
}

/** Short options of one token: -rf -> r, f; --force stays as is. */
const hasShort = (args: string[], letter: string) => args.some((a) => /^-[A-Za-z]+$/.test(a) && a.slice(1).includes(letter))
const hasArg = (args: string[], ...names: string[]) => args.some((a) => names.includes(a))

/** The first word that is not an option: git -C x push -> push. `withValue` options eat the next word. */
function subcommand(args: string[], withValue: string[] = []): { sub: string; rest: string[] } {
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a.startsWith('-')) {
      if (withValue.includes(a)) k++
      continue
    }
    return { sub: a.toLowerCase(), rest: args.slice(k + 1) }
  }
  return { sub: '', rest: [] }
}

function segmentKinds(u: Unwrapped, found: Set<SensitiveKind>, depth: number, powershell: boolean): void {
  let tokens = u.tokens
  if (!tokens.length) return
  if (powershell && !tokens[0].quoted && tokens[0].text.startsWith('$')) {
    // PowerShell: `$x = git push` assigns what the command on the right returns; `$x=1` too.
    const head = /^\$[\w:]+=(.*)$/.exec(tokens[0].text)
    if (/^\$[\w:]+$/.test(tokens[0].text) && tokens[1]?.text === '=') tokens = tokens.slice(2)
    else if (head) tokens = head[1] ? [{ text: head[1], quoted: false }, ...tokens.slice(1)] : tokens.slice(1)
    // Anything else starting with $ is an expression ($_.Length -gt 1), not a command: & $x is caught above.
    else return
    if (!tokens.length) return
  }
  // The command itself comes from an expansion ($CMD, "$(echo git)", ${X}): no way to read it.
  if (expands(tokens[0].text)) return all(found)
  const p = prog(tokens[0].text)
  const args = tokens.slice(1).map((t) => t.text)
  if (u.xargs && !XARGS_SAFE.has(p)) return all(found)
  let unknown = false
  /** A subcommand that comes from an expansion (git $SUB) is as unreadable as the command. */
  const sc = (a: string[], withValue: string[] = []) => {
    const r = subcommand(a, withValue)
    if (expands(r.sub)) unknown = true
    return r
  }
  programKinds(p, args, found, depth, powershell, sc)
  if (unknown) all(found)
}

type Sub = (a: string[], withValue?: string[]) => { sub: string; rest: string[] }

/** git subcommands that touch nothing remote (and, for the ones with rules below, how). Anything else may be an alias. */
const GIT_LOCAL = new Set(
  'status diff log show add commit checkout switch restore branch tag fetch pull merge rebase cherry-pick revert stash reset clean rm mv init clone remote config rev-parse rev-list ls-files ls-tree ls-remote blame grep describe shortlog reflog worktree submodule bisect apply am format-patch cat-file diff-tree diff-index diff-files merge-base name-rev for-each-ref symbolic-ref show-ref notes archive gc fsck prune count-objects version help check-ignore check-attr var hash-object write-tree read-tree update-index sparse-checkout maintenance range-diff whatchanged mergetool difftool show-branch citool gui annotate verify-commit verify-tag update-ref commit-tree mktree mktag pack-refs repack stage bundle request-pull filter-branch replace rerere cherry patch-id interpret-trailers mailinfo mailsplit merge-file merge-tree fetch-pack index-pack pack-objects unpack-objects verify-pack fast-export fast-import check-ref-format check-mailmap show-index stripspace column'.split(' '),
)
/** -c keys safe to set for one command; any other (alias.*, core.sshCommand, credential.helper…) may run something. */
const GIT_SAFE_CONFIG = /^(user\.(name|email|signingkey)|color\.[\w.-]+|core\.(quotepath|autocrlf|safecrlf|filemode|ignorecase|longpaths|precomposeunicode|abbrev)|advice\.[\w.-]+|init\.defaultbranch|commit\.gpgsign|tag\.gpgsign|safe\.directory|pull\.(rebase|ff)|merge\.ff|diff\.(renames|algorithm|noprefix|mnemonicprefix)|i18n\.[\w.-]+|gc\.auto|maintenance\.auto|column\.ui|log\.(showsignature|date|decorate))$/i
/** Keys that make git run a command or send somewhere else: setting them is a way around the guard. */
const GIT_CODE_CONFIG = /^(alias\.|core\.(sshcommand|pager|editor|fsmonitor|hookspath|askpass|gitproxy)|credential\.|sequence\.editor|diff\.external|diff\.[\w.-]+\.(command|textconv)|merge\.[\w.-]+\.driver|filter\.|gpg\.|uploadpack\.|receive\.|url\.|remote\.|include|protocol\.|pager\.)/i

function programKinds(p: string, args: string[], found: Set<SensitiveKind>, depth: number, powershell: boolean, sc: Sub): void {
  // Commands that run other commands: read what they run.
  if (SHELLS.has(p)) {
    const c = args.findIndex((a) => /^-[a-z]*c$/.test(a))
    if (c >= 0 && args[c + 1] !== undefined) shellKinds(args[c + 1], found, depth + 1)
    else if (c < 0 && args.some((a) => !a.startsWith('-'))) all(found) // bash script.sh, bash <(curl …): not readable
    return
  }
  if (PS.has(p)) {
    const c = args.findIndex((a) => /^-(c|command|encodedcommand|e|ec)$/i.test(a))
    if (c >= 0 && /^-(encodedcommand|e|ec)$/i.test(args[c])) all(found)
    else if (c >= 0) shellKinds(args.slice(c + 1).join(' '), found, depth + 1, true)
    return
  }
  if (p === 'eval' || p === 'invoke-expression' || p === 'iex') {
    if (args.some(expands)) return all(found)
    return shellKinds(args.join(' '), found, depth + 1, powershell)
  }
  if (p === 'start-process' || p === 'saps') {
    // Start-Process git -ArgumentList push: the program and its arguments, without the option names.
    return shellKinds(args.filter((a) => !a.startsWith('-')).join(' '), found, depth + 1, powershell)
  }
  if (p === 'alias') {
    // alias p='git push': what the alias will run.
    for (const a of args) if (a.includes('=')) shellKinds(a.slice(a.indexOf('=') + 1), found, depth + 1)
    return
  }
  if (p === 'ssh') {
    // ssh [options] host command…: the command runs over there, read it too.
    const withValue = ['-p', '-i', '-l', '-o', '-F', '-J', '-L', '-R', '-D', '-b', '-c', '-E', '-e', '-m', '-O', '-Q', '-S', '-W', '-w', '-B', '-I']
    const { rest } = subcommand(args, withValue)
    if (rest.length) shellKinds(rest.join(' '), found, depth + 1)
    return
  }

  switch (p) {
    case 'git':
    case 'hub':
      return gitKinds(args, found, sc)
    case 'gh':
      return ghKinds(args, found, sc)
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun': {
      const { sub, rest } = sc(args, ['--registry', '--otp', '--tag', '--access', '-w', '--workspace', '--filter', '-F', '--cwd', '-C', '--prefix'])
      if (sub === 'publish' || sub === 'deprecate' || (sub === 'npm' && subcommand(rest).sub === 'publish')) found.add('publish')
      else if (sub === 'unpublish') found.add('delete')
      else if (sub === 'run' || sub === 'run-script') {
        const script = sc(rest).sub
        if (/^(deploy|release|publish|ship)\b/.test(script)) found.add('publish')
      } else if (p !== 'npm' && /^(deploy|release|publish|ship)\b/.test(sub)) found.add('publish')
      return
    }
    case 'cargo':
    case 'poetry':
    case 'expo':
      if (sc(args).sub === 'publish') found.add('publish')
      return
    case 'twine':
      if (sc(args).sub === 'upload') found.add('publish')
      return
    case 'gem':
    case 'helm':
      if (sc(args).sub === 'push') found.add('publish')
      return
    case 'docker':
    case 'podman': {
      const { sub } = sc(args)
      if (sub === 'push' || (sub === 'buildx' && hasArg(args, '--push'))) found.add('publish')
      if (/^(rm|rmi|prune)$/.test(sub) || ((sub === 'system' || sub === 'volume' || sub === 'image' || sub === 'container') && hasArg(args, 'prune', 'rm'))) found.add('delete')
      return
    }
    case 'dotnet':
      if (args.includes('push') && args.includes('nuget')) found.add('publish')
      return
    case 'vercel': {
      const { sub } = sc(args, ['--token', '--scope', '-t', '-S', '--cwd', '-A', '--local-config'])
      // Plain `vercel` deploys the folder.
      if (!sub || sub === 'deploy' || sub === 'promote' || sub === 'redeploy' || sub === 'rollback' || hasArg(args, '--prod', '-p')) found.add('publish')
      else if (sub === 'rm' || sub === 'remove') found.add('delete')
      return
    }
    case 'netlify':
    case 'fly':
    case 'flyctl':
    case 'firebase':
    case 'serverless':
    case 'sls':
    case 'railway':
    case 'render': {
      const { sub } = sc(args)
      if (sub === 'deploy' || sub === 'up') found.add('publish')
      else if (/^(destroy|remove|delete)$/.test(sub)) found.add('delete')
      return
    }
    case 'wrangler': {
      const { sub } = sc(args)
      if (sub === 'deploy' || sub === 'publish') found.add('publish')
      else if (sub === 'delete') found.add('delete')
      return
    }
    case 'kubectl': {
      const { sub } = sc(args, ['-n', '--namespace', '--context', '-f'])
      if (/^(apply|create|replace|patch|rollout|scale|set)$/.test(sub)) found.add('publish')
      else if (sub === 'delete' || sub === 'drain') found.add('delete')
      return
    }
    case 'terraform':
    case 'tofu':
    case 'pulumi': {
      const { sub } = sc(args, ['-chdir'])
      if (sub === 'apply' || sub === 'up' || sub === 'import') found.add('publish')
      else if (sub === 'destroy') found.add('delete')
      return
    }
    case 'aws': {
      if (args.some((a) => /^(delete|terminate|remove)-/.test(a)) || (args[0] === 's3' && (args[1] === 'rm' || args[1] === 'rb'))) found.add('delete')
      if (args[0] === 's3' && /^(cp|mv|sync)$/.test(args[1] ?? '')) found.add('send')
      if (args.some((a) => /^deploy$|^create-deployment$|^update-function-code$/.test(a))) found.add('publish')
      return
    }
    case 'rm':
      if (hasShort(args, 'r') || hasShort(args, 'R') || hasArg(args, '--recursive')) found.add('delete')
      return
    case 'find': {
      if (args.includes('-delete')) found.add('delete')
      // -exec cmd … ; runs cmd once per file: rm there deletes a tree, anything else is read as a command.
      for (let k = 0; k < args.length; k++) {
        if (!/^-(exec|execdir|ok|okdir)$/.test(args[k])) continue
        let end = k + 1
        while (end < args.length && args[end] !== ';' && args[end] !== '+') end++
        const inner = args.slice(k + 1, end)
        if (inner.length && prog(inner[0]) === 'rm') found.add('delete')
        else if (inner.length) simpleKinds(inner.map((text) => ({ text, quoted: false })), found, depth + 1, powershell)
        k = end
      }
      return
    }
    case 'shred':
    case 'srm':
    case 'wipe':
    case 'dropdb':
    case 'mkfs':
      found.add('delete')
      return
    case 'dd':
      if (args.some((a) => /^of=\/dev\//.test(a))) found.add('delete')
      return
    case 'diskutil':
      if (args.some((a) => /^(erase|zero|secureErase|reformat|partitionDisk)/i.test(a))) found.add('delete')
      return
    case 'redis-cli':
      if (args.some((a) => /^(flushall|flushdb|del|unlink)$/i.test(a))) found.add('delete')
      return
    case 'sendmail':
    case 'mail':
    case 'mailx':
    case 'mutt':
    case 'msmtp':
    case 'swaks':
      found.add('send')
      return
    case 'curl':
      if (curlSends(args)) found.add('send')
      return
    case 'wget':
      if (wgetSends(args)) found.add('send')
      return
    case 'http':
    case 'https':
    case 'xh':
    case 'xhs':
    case 'httpie':
      if (httpieSends(args)) found.add('send')
      return
    case 'scp':
    case 'rsync':
    case 'sftp':
      // A copy to another machine (host:path, user@host:path, rsync://).
      if (args.some((a) => !a.startsWith('-') && (/^[^/\s:]+:/.test(a) || /^rsync:\/\//.test(a)) && !/^[A-Za-z]:[\\/]/.test(a))) found.add('send')
      return
    case 'invoke-webrequest':
    case 'invoke-restmethod':
    case 'iwr':
    case 'irm':
      if (psWebSends(args)) found.add('send')
      return
    case 'remove-item':
      if (args.some((a) => /^-recurse$/i.test(a))) found.add('delete')
      return
    case 'send-mailmessage':
      found.add('send')
      return
    default:
      return
  }
}

function gitKinds(args: string[], found: Set<SensitiveKind>, sc: Sub): void {
  // Global options before the subcommand: -c with anything but a harmless key (an alias, a
  // command for ssh or the pager) and --config-env can turn any subcommand into a push.
  for (let k = 0; k < args.length && args[k].startsWith('-'); k++) {
    const a = args[k]
    if (a === '-c') {
      const key = (args[k + 1] ?? '').split('=')[0]
      if (!GIT_SAFE_CONFIG.test(key)) return all(found)
      k++
    } else if (a.startsWith('--config-env') || a.startsWith('--exec-path') || a.startsWith('--upload-pack') || a.startsWith('--receive-pack')) return all(found)
    else if (a === '-C' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') k++
  }
  const { sub, rest } = sc(args, ['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
  if (!sub) return
  // Options that hand git a program to run on the other side, and the ext:: transport (a command as a remote).
  if (rest.some((a) => /^--(upload-pack|receive-pack|exec)(=|$)/.test(a) || /^ext::/i.test(a)) || (sub === 'clone' && hasArg(rest, '-u'))) return all(found)
  switch (sub) {
    case 'push':
    case 'send-pack':
    case 'http-push':
      return void found.add('push')
    case 'send-email':
    case 'imap-send':
      return void found.add('send')
    case 'subtree':
    case 'lfs':
      if (rest.includes('push')) found.add('push')
      return
    case 'svn':
      if (rest.includes('dcommit')) found.add('push')
      return
    case 'p4':
      if (rest.includes('submit')) found.add('push')
      return
    case 'clean':
      if (hasShort(rest, 'f') || hasArg(rest, '--force')) found.add('delete')
      return
    case 'reset':
      if (hasArg(rest, '--hard')) found.add('delete')
      return
    case 'branch':
      if (hasShort(rest, 'D') || (hasArg(rest, '--delete', '-d') && hasArg(rest, '--force', '-f'))) found.add('delete')
      return
    case 'config': {
      // Writing an alias or a command key prepares a way around the guard for the next call.
      // Reading one (git config --get remote.origin.url) is fine.
      const pos = rest.filter((a) => !a.startsWith('-'))
      const reading = hasArg(rest, '--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l') || pos[0] === 'get' || pos[0] === 'list'
      const editing = hasArg(rest, '--edit', '-e') || pos[0] === 'edit'
      const writing = !reading && (pos.length >= 2 || hasArg(rest, '--unset', '--unset-all', '--add', '--replace-all', '--rename-section', '--remove-section'))
      if (editing || (writing && rest.some((a) => GIT_CODE_CONFIG.test(a)))) all(found)
      return
    }
    default:
      // Not a subcommand git ships: an alias from the user's config (or an extension) may push.
      if (!GIT_LOCAL.has(sub)) all(found)
  }
}

/** gh actions that change something on GitHub. */
const GH_WRITES = new Set(['create', 'edit', 'close', 'reopen', 'comment', 'review', 'set', 'add', 'upload', 'transfer', 'rename', 'fork', 'sync', 'lock', 'unlock', 'pin', 'unpin', 'ready', 'develop', 'rerun', 'cancel', 'enable', 'disable', 'run', 'revert', 'update-branch', 'merge', 'import', 'clone-to'])
const GH_DELETES = new Set(['delete', 'remove', 'archive', 'unarchive', 'delete-asset'])
const GH_KNOWN = new Set(['auth', 'browse', 'codespace', 'cs', 'gist', 'issue', 'org', 'pr', 'project', 'release', 'repo', 'cache', 'run', 'workflow', 'api', 'attestation', 'completion', 'config', 'gpg-key', 'label', 'ruleset', 'search', 'secret', 'ssh-key', 'status', 'variable', 'help', 'version', 'agent-task'])

function ghKinds(args: string[], found: Set<SensitiveKind>, sc: Sub): void {
  const { sub, rest } = sc(args, ['-R', '--repo', '--hostname'])
  if (!sub) return
  // gh aliases and extensions run anything; so does defining one.
  if (!GH_KNOWN.has(sub) || sub === 'alias' || sub === 'extension') return all(found)
  if (sub === 'api') {
    const method = methodOf(rest, ['-X', '--method'])
    if ((method && method !== 'GET' && method !== 'HEAD') || rest.some((a) => /^(-f|-F|--field|--raw-field|--input)$/.test(a) || /^--(field|raw-field|input)=/.test(a) || /^-[fF].+/.test(a))) found.add('send')
    return
  }
  const action = sc(rest, ['-R', '--repo']).sub
  if (sub === 'pr' && (action === 'merge' || action === 'create')) found.add('push')
  else if (sub === 'release' && (action === 'create' || action === 'upload' || action === 'edit')) found.add('publish')
  else if (sub === 'gist' && action === 'create') found.add('publish')
  else if (sub === 'workflow' && action === 'run') found.add('publish')
  else if (sub === 'repo' && action === 'sync') found.add('push')
  else if (GH_DELETES.has(action)) found.add('delete')
  else if (GH_WRITES.has(action)) found.add('send')
}

// ---------- HTTP clients ----------

/** -X POST, -XPOST, --request=POST, --method POST -> POST */
function methodOf(args: string[], names: string[]): string | undefined {
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    for (const n of names) {
      if (a === n) return args[k + 1]?.toUpperCase()
      if (a.startsWith(`${n}=`)) return a.slice(n.length + 1).toUpperCase()
      if (n.length === 2 && a.startsWith(n) && a.length > 2) return a.slice(2).toUpperCase()
    }
  }
  return undefined
}

const reads = (method: string | undefined) => !method || method === 'GET' || method === 'HEAD' || method === 'OPTIONS'

/** curl short options that take a value (the rest of the cluster, or the next word). */
const CURL_SHORT_VALUE = new Set('dFTXHuoAebcmwxrEKCYyzQPUDt'.split(''))
const CURL_LONG_VALUE = new Set(['--request', '--header', '--user', '--output', '--user-agent', '--referer', '--cookie', '--cookie-jar', '--max-time', '--connect-timeout', '--write-out', '--proxy', '--preproxy', '--resolve', '--connect-to', '--cacert', '--cert', '--key', '--range', '--retry', '--limit-rate', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--data-ascii', '--json', '--form', '--form-string', '--upload-file', '--url-query', '--oauth2-bearer', '--interface', '--dns-servers', '--max-filesize', '--output-dir', '--retry-delay', '--retry-max-time', '--speed-limit', '--speed-time', '--variable', '--expand-url', '--socks4', '--socks4a', '--socks5', '--socks5-hostname', '--proxy1.0', '--doh-url', '--config'])
/** Options that send the request somewhere else than the URL says (a proxy, another address for the name). */
const CURL_REROUTE = /^--(proxy|preproxy|resolve|connect-to|socks4a?|socks5(-hostname)?|proxy1\.0|doh-url|config|next|variable|expand-url)$/

/**
 * A curl that writes (a body, an upload or a method other than GET/HEAD) to a host that is not
 * this machine. Short clusters are read letter by letter (-sSd, -XPOST, -Fa=@f). A host it cannot
 * read (a variable, a config file) counts as remote.
 */
function curlSends(args: string[]): boolean {
  let write = false
  let method: string | undefined
  let unknown = false
  const urls: string[] = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a === '--') {
      urls.push(...args.slice(k + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq < 0 ? a : a.slice(0, eq)
      const value = eq < 0 ? (CURL_LONG_VALUE.has(name) ? args[++k] : undefined) : a.slice(eq + 1)
      if (/^--(data|form|json|upload-file|post30)/.test(name)) write = true
      else if (name === '--request') method = value?.toUpperCase()
      else if (name === '--url') {
        if (eq < 0) urls.push(args[++k] ?? '')
        else urls.push(value ?? '')
      } else if (CURL_REROUTE.test(name)) unknown = true
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let c = 1; c < a.length; c++) {
        const letter = a[c]
        // -K (a config file), -: (--next), -x (a proxy): where it goes is no longer the URL.
        if (letter === 'K' || letter === ':' || letter === 'x') unknown = true
        if (!CURL_SHORT_VALUE.has(letter)) continue
        const value = c + 1 < a.length ? a.slice(c + 1) : args[++k]
        if (letter === 'd' || letter === 'F' || letter === 'T') write = true
        if (letter === 'X') method = value?.toUpperCase()
        break
      }
      continue
    }
    urls.push(a)
  }
  // A config file or a reroute may also carry a body: not sure, so it counts as writing.
  if (!write && !unknown && reads(method)) return false
  return unknown || !allLocal(urls)
}

const WGET_LONG_VALUE = new Set(['--post-data', '--post-file', '--body-data', '--body-file', '--method', '--output-document', '--output-file', '--header', '--user-agent', '--user', '--password', '--directory-prefix', '--tries', '--timeout', '--referer'])
const WGET_SHORT_VALUE = new Set('OoPtTUaBQwlDXIARei'.split(''))

function wgetSends(args: string[]): boolean {
  let write = false
  let method: string | undefined
  let unknown = false
  const urls: string[] = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq < 0 ? a : a.slice(0, eq)
      const value = eq < 0 ? (WGET_LONG_VALUE.has(name) ? args[++k] : undefined) : a.slice(eq + 1)
      if (/^--(post-data|post-file|body-data|body-file)$/.test(name)) write = true
      else if (name === '--method') method = value?.toUpperCase()
      else if (name === '--input-file' || name === '--execute' || name === '--config') unknown = true
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let c = 1; c < a.length; c++) {
        const letter = a[c]
        if (!WGET_SHORT_VALUE.has(letter)) continue
        // -i (URLs from a file), -e (a wgetrc command: post_data, http_proxy…).
        if (letter === 'i' || letter === 'e') unknown = true
        if (c + 1 >= a.length) k++
        break
      }
      continue
    }
    urls.push(a)
  }
  if (!write && !unknown && reads(method)) return false
  return unknown || !allLocal(urls)
}

const HTTPIE_VALUE = new Set(['-a', '--auth', '-A', '--auth-type', '-o', '--output', '--session', '--session-read-only', '--verify', '--cert', '--cert-key', '--cert-key-pass', '--timeout', '--max-redirects', '--pretty', '-s', '--style', '-p', '--print', '-P', '--history-print', '--format-options', '--boundary', '--default-scheme', '--ssl', '--ciphers', '--response-charset', '--response-mime', '--raw'])

/** httpie / xh: `http POST host x=1`, or data items (x=1, x:=1, x@file) that make it a POST. */
function httpieSends(args: string[]): boolean {
  const positional: string[] = []
  let write = false
  let unknown = false
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a.startsWith('-') && a.length > 1) {
      const name = a.split('=')[0]
      if (/^(--form|--multipart|--raw)$/.test(name) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) write = true
      if (name === '--proxy') unknown = true
      if (!a.includes('=') && (HTTPIE_VALUE.has(name) || name === '--proxy')) k++
      continue
    }
    positional.push(a)
  }
  // A method word anywhere (even after an option it was not read as the value of) writes.
  if (positional.some((a) => /^(post|put|patch|delete|connect|trace)$/i.test(a))) write = true
  const k = /^(get|head|options|post|put|patch|delete|trace|connect)$/i.test(positional[0] ?? '') ? 1 : 0
  const url = positional[k]
  // name=value, name:=json, name@file, name=@file write; name==value is a query, Name:value a header.
  if (positional.slice(k + 1).some((a) => /^[^=:@]+(:=|=(?!=)|@)/.test(a))) write = true
  if (!write && !unknown) return false
  if (unknown || url === undefined) return true
  // :3000/x and :/x are httpie's shorthand for localhost.
  if (/^:(\d+)?(\/|$)/.test(url)) return false
  return !allLocal([url])
}

function psWebSends(args: string[]): boolean {
  // PowerShell parameters ignore case: -METHOD post is -Method Post.
  const low = args.map((a) => (a.startsWith('-') ? a.toLowerCase() : a))
  const method = methodOf(low, ['-method'])
  const proxy = low.includes('-proxy')
  const write = low.some((a) => a === '-body' || a === '-infile') || !reads(method)
  if (!write && !proxy) return false
  const urls: string[] = []
  for (let k = 0; k < low.length; k++) {
    const a = low[k]
    if (a === '-uri') urls.push(low[++k] ?? '')
    else if (a.startsWith('-')) k++
    else urls.push(a)
  }
  return proxy || !allLocal(urls)
}

/**
 * https://user@api.example.com:8443/x -> api.example.com; [::1]:3000 -> ::1. Null when it is
 * not something a host can be read from (a variable, a file name, a word).
 */
function hostOf(arg: string): string | null {
  const s = arg.trim()
  if (!s || /\s/.test(s) || expands(s)) return null
  // The authority ends at the first / ? #: "evil.com#@localhost" is evil.com.
  const authority = s.replace(/^[a-z][\w+.-]*:\/\//i, '').split(/[/?#]/)[0]
  // A backslash or two @ read differently from one parser to the next: not sure, so not local.
  if (authority.includes('\\') || (authority.match(/@/g)?.length ?? 0) > 1) return null
  const hostPort = authority.slice(authority.indexOf('@') + 1)
  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']')
    return end > 0 ? hostPort.slice(1, end).toLowerCase() : null
  }
  return hostPort.split(':')[0].toLowerCase() || null
}

/** 127.0.0.1 …127.255.255.255, written as four decimal numbers: nothing a DNS name can pass for. */
function loopbackIPv4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  return !!m && m.slice(1).every((n) => Number(n) <= 255 && (n === '0' || !n.startsWith('0'))) && m[1] === '127'
}

/**
 * Every target is this machine: exactly `localhost`, `::1` or a literal 127.x.x.x. A name that
 * only looks local (127.evil.com, x.localhost, 0.0.0.0) or that cannot be read is remote; no
 * target at all is not sure, so not local either.
 */
function allLocal(targets: string[]): boolean {
  if (!targets.length) return false
  return targets.every((t) => {
    const h = hostOf(t)
    return h === 'localhost' || h === '::1' || (h !== null && loopbackIPv4(h))
  })
}
