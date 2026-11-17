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
    // PowerShell has too many ways to build and run a command (iex, &, .NET calls, casts,
    // Start-Process, -EncodedCommand) to be read here: every PowerShell call asks.
    if (command.length > MAX_COMMAND || tool === 'PowerShell') all(found)
    else shellKinds(command, found, 0)
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
  // Every kind at once means the guard could not read the call: say so instead of "Pagar".
  if (sensitiveKinds(tool, input).length === SENSITIVE_KINDS.length) return `Conferir: ${what} (o guarda não conseguiu ler o que isto faz)`
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
const SQLISH = new Set(['sql', 'query', 'queries', 'statement', 'statements', 'execute'])

function mcpKinds(tool: string, input: Record<string, unknown>, opts: GuardOptions, found: Set<SensitiveKind>): void {
  const { server, name } = splitMcp(tool)
  // The office's own server (board, atas, memory) never leaves the machine. Trust its provenance,
  // not its name: a configured server could also call itself "office" (CLI docs: key trust on source).
  if (server === 'office' && (opts.mcpSource === undefined || opts.mcpSource === 'sdk')) return
  const w = words(name)
  const reads = READ.has(w[0] ?? '')
  // A tool that runs what it is given (execute, run_command, eval, execute_sql): its name says
  // nothing of what it will do, so it asks, whatever its input looks like.
  if (!reads && w.some((x) => EXECUTOR.has(x))) return all(found)
  const { strings, keys, complete } = inputStrings(input)
  // A query tool (by its name or an argument called sql, query, statement, execute): every text
  // must be one plain read, or clearly not SQL (an identifier, a number, a date). Anything else,
  // or input not read to the end, asks.
  if (w.some((x) => SQLISH.has(x)) || keys.some((k) => words(k).some((x) => SQLISH.has(x)))) {
    if (!complete || strings.some((s) => !notSql(s) && !readOnlySql(s))) return all(found)
    if (!reads && (w.includes('sql') || w.includes('statement')) && !strings.some(readOnlySql)) return all(found)
  }
  nameKinds(w, reads, found)
  // What the call carries counts too (a remote shell's host({ cmd: 'git push' }) under any name).
  // Not when the name already asks (a send_message about "git push" is still a message) nor for
  // a tool that only reads (a search for "drop table" drops nothing).
  if (found.size || reads) return
  if (!complete) return all(found)
  for (const s of strings) shellKinds(s, found, 1)
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

/** How deep an MCP input is read; deeper, it is not read, so it asks. */
const MCP_DEPTH = 8

/**
 * String values and keys of an MCP input. `complete` is false when something was left out
 * (too many strings, too deep, a string past MAX_COMMAND): the caller asks instead of guessing.
 */
function inputStrings(input: Record<string, unknown>): { strings: string[]; keys: string[]; complete: boolean } {
  const strings: string[] = []
  const keys: string[] = []
  let complete = true
  const walk = (v: unknown, depth: number) => {
    if (!complete) return
    if (typeof v === 'string') {
      if (!v.trim()) return
      if (strings.length >= MAX_MCP_STRINGS || v.length > MAX_COMMAND) complete = false
      else strings.push(v)
    } else if (v && typeof v === 'object') {
      if (depth >= MCP_DEPTH) complete = false
      else if (Array.isArray(v)) for (const x of v) walk(x, depth + 1)
      else
        for (const [k, x] of Object.entries(v)) {
          keys.push(k)
          walk(x, depth + 1)
        }
    }
  }
  walk(input, 0)
  return { strings, keys, complete }
}

/** A bare word that is a whole SQL statement on its own (VACUUM, COMMIT, CHECKPOINT…), or starts one. */
const SQL_VERBS = new Set(
  (
    'select insert update delete drop alter create truncate grant revoke merge call exec execute copy replace upsert ' +
    'vacuum analyze analyse reindex cluster checkpoint begin commit rollback savepoint release start end abort lock ' +
    'unlock set reset show explain describe desc pragma attach detach load prepare deallocate listen unlisten notify ' +
    'refresh import unload discard do with values table use rename comment optimize flush kill shutdown purge backup ' +
    'restore declare fetch move close open go'
  ).split(' '),
)
/** Clearly not SQL: an identifier (users, public.orders, abc-123) that is not a SQL verb, a number or an ISO date. */
const notSql = (s: string) =>
  (/^[A-Za-z_][\w.-]*$/.test(s) && !SQL_VERBS.has(s.toLowerCase())) ||
  /^-?\d+(\.\d+)?$/.test(s) ||
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)
/** PRAGMAs that read one table or index: bare or with one identifier, table_info(users). */
const TABLE_PRAGMAS = new Set(['table_info', 'table_xinfo', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list'])
/** PRAGMAs that read a setting: only bare. With an argument, journal_mode(x) or user_version(1) writes. */
const SETTING_PRAGMAS = new Set(['database_list', 'compile_options', 'user_version', 'schema_version', 'page_count', 'page_size', 'journal_mode'])
/** Writes, or reads with side effects (SELECT INTO, nextval, pg_terminate_backend, dblink…). */
const SQL_WRITE = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|call|exec|execute|copy|replace|upsert|attach|detach|vacuum|set|reindex|cluster|lock|comment|rename|do|into|load|nextval|setval|set_config|load_file|outfile|dumpfile|sleep|benchmark)\b|\b(pg_|dblink|lo_|xp_|sp_)\w*/i
/**
 * One plain read: starts with SELECT, WITH, EXPLAIN, SHOW, DESCRIBE or a read PRAGMA, writes
 * nothing, has no comment (--, /*, #) and no second statement. Comments are not stripped: inside
 * a string literal ('--') they would hide the rest, so any of them asks.
 */
function readOnlySql(s: string): boolean {
  const t = s.trim().replace(/;\s*$/, '')
  if (/--|\/\*|#|;/.test(t)) return false
  if (/^pragma\b/i.test(t)) {
    const m = /^pragma\s+(\w+)\s*(\(\s*[A-Za-z_]\w*\s*\))?$/i.exec(t)
    if (!m) return false
    const name = m[1].toLowerCase()
    return TABLE_PRAGMAS.has(name) || (!m[2] && SETTING_PRAGMAS.has(name))
  }
  return /^\(?\s*(select|with|explain|show|describe|desc)\b/i.test(t) && !SQL_WRITE.test(t)
}

// ---------- shell commands ----------

interface Token {
  text: string
  /** Starts inside quotes ("if", "A=1"): a plain word, never a keyword or an assignment. */
  quoted: boolean
  /** Has an unquoted brace expansion ({push,status}, {1..3}): bash makes several words of it. */
  brace?: boolean
}

interface Parsed {
  segments: Token[][]
  /** Per segment: it reads the output of the one before (a single |). */
  piped: boolean[]
  /** $(…) and `…`, read as commands of their own. */
  subs: string[]
}

/** {a,b} and {1..3} outside quotes ($-braces are parameter expansions, read elsewhere). */
const BRACE = /(^|[^$])\{[^{}]*(,|\.\.)[^{}]*\}/

/**
 * Splits a command line into simple commands (on ; && || | & newlines and parentheses) and
 * collects command substitutions, even inside double quotes. A substitution stays in its word
 * too, so `$(echo git) push` keeps a command that comes from an expansion. Close enough to sh
 * for this purpose; the literal patterns of rawKinds catch what it gets wrong.
 */
function tokenize(cmd: string): Parsed {
  const segments: Token[][] = []
  const piped: boolean[] = []
  const subs: string[] = []
  let seg: Token[] = []
  let cur = ''
  /** The word as the shell sees its structure: unquoted characters as they are, quoted ones as 'x'. */
  let bare = ''
  let quoted = false
  let inWord = false
  let pipeIn = false
  const endWord = () => {
    if (inWord) seg.push({ text: cur, quoted, brace: BRACE.test(bare) })
    cur = ''
    bare = ''
    quoted = false
    inWord = false
  }
  /** `pipe`: the next segment reads this one's output. */
  const endSeg = (pipe = false) => {
    endWord()
    if (seg.length) {
      segments.push(seg)
      piped.push(pipeIn)
    }
    seg = []
    pipeIn = pipe
  }
  const lit = (text: string) => {
    cur += text
    bare += 'x'.repeat(text.length)
  }
  const raw = (text: string) => {
    cur += text
    bare += text
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
      if (!inWord) quoted = true
      lit(cmd.slice(i + 1, stop))
      inWord = true
      i = stop + 1
    } else if (c === '"') {
      if (!inWord) quoted = true
      let j = i + 1
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === '\\' && j + 1 < cmd.length) {
          lit(cmd[j + 1])
          j += 2
        } else if (cmd[j] === '$' && cmd[j + 1] === '(') {
          const start = j
          j = readParen(j + 1)
          raw(cmd.slice(start, j))
        } else if (cmd[j] === '`') {
          const start = j
          j = readTick(j)
          raw(cmd.slice(start, j))
        } else if (cmd[j] === '$') {
          // "$X" still expands inside double quotes.
          raw(cmd[j++])
        } else lit(cmd[j++])
      }
      inWord = true
      i = j + 1
    } else if (c === '\\') {
      if (cmd[i + 1] === '\n') i += 2
      else {
        lit(cmd[i + 1] ?? '')
        inWord = true
        i += 2
      }
    } else if (c === '$' && cmd[i + 1] === '(') {
      const start = i
      i = readParen(i + 1)
      raw(cmd.slice(start, i))
      inWord = true
    } else if (c === '`') {
      const start = i
      i = readTick(i)
      raw(cmd.slice(start, i))
      inWord = true
    } else if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')' || c === '{' || c === '}') {
      // `{` and `}` only group when they stand alone ("{ cmd; }"); "a{b}", "{a,b}" and "${X}" are words.
      const next = cmd[i + 1] ?? ' '
      if ((c === '{' && (inWord || !/\s/.test(next))) || (c === '}' && inWord)) {
        raw(c)
        inWord = true
        i++
        continue
      }
      endSeg(c === '|' && cmd[i + 1] !== '|' && cmd[i - 1] !== '|')
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
    } else {
      raw(c)
      inWord = true
      i++
    }
  }
  endSeg()
  return { segments, piped, subs }
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
  /** Reads the output of the command before it (cmd | this). */
  piped?: boolean
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

function shellKinds(cmd: string, found: Set<SensitiveKind>, depth: number): void {
  if (depth > MAX_DEPTH) {
    // Nested this deep on purpose: it asks.
    all(found)
    return
  }
  // CR alone and the Unicode line breaks split lines for some readers and not for others: the
  // tokenizer and the shell could see different commands, so the guard does not choose.
  const text = cmd.replace(/\r\n/g, '\n')
  if (/[\r\u0085\u2028\u2029]/.test(text) || looksPowerShell(text)) return all(found)
  rawKinds(text, found)
  const { segments, piped, subs } = tokenize(text)
  for (const sub of subs) shellKinds(sub, found, depth + 1)
  segments.forEach((seg, k) => simpleKinds(seg, found, depth, piped[k]))
}

/** PowerShell's approved verbs, plus ForEach and Where (ForEach-Object, Where-Object). */
const PS_VERBS =
  'Add|Approve|Assert|Backup|Block|Build|Checkpoint|Clear|Close|Compare|Complete|Compress|Confirm|Connect|Convert|ConvertFrom|ConvertTo|Copy|Debug|Deny|Deploy|Disable|Disconnect|Dismount|Edit|Enable|Enter|Exit|Expand|Export|Find|ForEach|Format|Get|Grant|Group|Hide|Import|Initialize|Install|Invoke|Join|Limit|Lock|Measure|Merge|Mount|Move|New|Open|Optimize|Out|Ping|Pop|Protect|Publish|Push|Read|Receive|Redo|Register|Remove|Rename|Repair|Request|Reset|Resize|Resolve|Restart|Restore|Resume|Revoke|Save|Search|Select|Send|Set|Show|Skip|Split|Start|Step|Stop|Submit|Suspend|Switch|Sync|Test|Trace|Unblock|Undo|Uninstall|Unlock|Unprotect|Unpublish|Unregister|Update|Use|Wait|Watch|Where|Write'
/**
 * Nouns of cmdlets that change things, run things or reach out, matched in any case
 * (remove-item). Nouns common in file names (date, file, path, string) are left to the
 * capitalised match, so format-date.ts stays a file.
 */
const PS_NOUNS =
  'Item|ChildItem|ItemProperty|Content|Process|WebRequest|RestMethod|MailMessage|Expression|Command|Service|Job|PSSession|ScheduledTask|ScheduledJob|LocalUser|LocalGroup|Acl|CimInstance|CimMethod|WmiObject|WmiMethod|Computer|ExecutionPolicy|PSDrive|SmbShare|NetFirewallRule|Package|Module|Script|BitsTransfer'
/**
 * Text that reads as PowerShell: a cmdlet (Remove-Item, Invoke-WebRequest, Send-MailMessage;
 * remove-item in any case with a known noun), iex, iwr, irm, saps, pwsh or powershell. Bash
 * does not run cmdlets, but the text may reach a PowerShell host (a script, an MCP server),
 * and PowerShell has too many ways to build a command to read it here. Not a part of a longer
 * name: X-Request-Id, add-item.tsx and fix-powershell-docs are not commands.
 */
const PS_CMDLET = new RegExp(`(?<![\\w./\\\\-])(${PS_VERBS})-[A-Z][A-Za-z]*(?![\\w./\\\\-])`)
const PS_KNOWN = new RegExp(`(?<![\\w./\\\\-])(${PS_VERBS})-(${PS_NOUNS})(?![\\w./\\\\-])`, 'i')
const PS_WORDS = /(?<![\w-])(pwsh|powershell|powershell_ise|iex|iwr|irm|saps|icm)(\.exe)?(?![\w-])/i
const looksPowerShell = (s: string) => PS_CMDLET.test(s) || PS_KNOWN.test(s) || PS_WORDS.test(s)

/** One simple command: what wraps it, the code hidden in its environment, then the command itself. */
function simpleKinds(seg: Token[], found: Set<SensitiveKind>, depth: number, piped = false): void {
  // git {push,status}, rm -{r,f}: bash turns one word into several; which ones is not read here.
  if (seg.some((t) => t.brace)) return all(found)
  const u = unwrap(seg)
  u.piped = piped
  if (u.unknown) all(found)
  for (const code of u.code) shellKinds(code, found, depth + 1)
  segmentKinds(u, found, depth)
}

/** Literal patterns over the whole text: they catch what hides in quotes, heredocs and scripts. */
function rawKinds(cmd: string, found: Set<SensitiveKind>): void {
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

function segmentKinds(u: Unwrapped, found: Set<SensitiveKind>, depth: number): void {
  const tokens = u.tokens
  if (!tokens.length) return
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
  programKinds(p, args, found, depth, sc, !!u.piped)
  if (unknown) all(found)
}

type Sub = (a: string[], withValue?: string[]) => { sub: string; rest: string[] }

/** npm commands and aliases by their full name (publish, unpublish and deprecate have rules of their own). */
const NPM_KNOWN = new Set(
  'access adduser audit bugs cache ci completion config dedupe deprecate diff dist-tag docs doctor edit exec explain explore find-dupes fund get help help-search hook init install install-ci-test install-test link ll login logout ls org outdated owner pack ping pkg prefix profile prune publish query rebuild repo restart root run run-script sbom search set shrinkwrap star stars start stop team test token uninstall unpublish unstar update version view whoami i add c ci cit it ln list la rm r un unlink remove t tst up upgrade v info show home issues x create innit s se find author why clean-install ic install-clean urn rum ddp isntall'.split(' '),
)

/** git subcommands that touch nothing remote (and, for the ones with rules below, how). Anything else may be an alias. */
const GIT_LOCAL = new Set(
  'status diff log show add commit checkout switch restore branch tag fetch pull merge rebase cherry-pick revert stash reset clean rm mv init clone remote config rev-parse rev-list ls-files ls-tree ls-remote blame grep describe shortlog reflog worktree submodule bisect apply am format-patch cat-file diff-tree diff-index diff-files merge-base name-rev for-each-ref symbolic-ref show-ref notes archive gc fsck prune count-objects version help check-ignore check-attr var hash-object write-tree read-tree update-index sparse-checkout maintenance range-diff whatchanged mergetool difftool show-branch citool gui annotate verify-commit verify-tag update-ref commit-tree mktree mktag pack-refs repack stage bundle request-pull filter-branch replace rerere cherry patch-id interpret-trailers mailinfo mailsplit merge-file merge-tree fetch-pack index-pack pack-objects unpack-objects verify-pack fast-export fast-import check-ref-format check-mailmap show-index stripspace column'.split(' '),
)
/** -c keys safe to set for one command; any other (alias.*, core.sshCommand, credential.helper…) may run something. */
const GIT_SAFE_CONFIG = /^(user\.(name|email|signingkey)|color\.[\w.-]+|core\.(quotepath|autocrlf|safecrlf|filemode|ignorecase|longpaths|precomposeunicode|abbrev)|advice\.[\w.-]+|init\.defaultbranch|commit\.gpgsign|tag\.gpgsign|safe\.directory|pull\.(rebase|ff)|merge\.ff|diff\.(renames|algorithm|noprefix|mnemonicprefix)|i18n\.[\w.-]+|gc\.auto|maintenance\.auto|column\.ui|log\.(showsignature|date|decorate))$/i
/** Keys that make git run a command or send somewhere else: setting them is a way around the guard. */
const GIT_CODE_CONFIG = /^(alias\.|core\.(sshcommand|pager|editor|fsmonitor|hookspath|askpass|gitproxy)|credential\.|sequence\.editor|diff\.external|diff\.[\w.-]+\.(command|textconv)|merge\.[\w.-]+\.driver|filter\.|gpg\.|uploadpack\.|receive\.|url\.|remote\.|include|protocol\.|pager\.)/i

function programKinds(p: string, args: string[], found: Set<SensitiveKind>, depth: number, sc: Sub, piped: boolean): void {
  // Commands that run other commands: read what they run.
  if (SHELLS.has(p)) {
    // bash -c 'cmd' is read; bash script.sh, bash <(curl …) and curl … | bash (a script on stdin) are not.
    const c = args.findIndex((a) => /^-[a-z]*c$/.test(a))
    if (c >= 0 && args[c + 1] !== undefined) shellKinds(args[c + 1], found, depth + 1)
    else all(found)
    return
  }
  // PowerShell is not read: any pwsh or powershell line asks, -Command included.
  if (PS.has(p)) return all(found)
  if (p === 'eval') {
    if (args.some(expands)) return all(found)
    return shellKinds(args.join(' '), found, depth + 1)
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

  // AppleScript and Shortcuts drive other apps (Mail, Messages): nothing in the line says what they do.
  if (p === 'osascript' || (p === 'shortcuts' && sc(args).sub === 'run')) return all(found)
  if (interpreterKinds(p, args, found, piped)) return
  if (p === 'bun' && args.some((a) => /^(-e|--eval|-p|--print)(=|$)/.test(a))) return all(found)

  switch (p) {
    case 'sed':
    case 'gsed':
      if (sedScripts(args).some(sedRuns)) all(found)
      return
    case 'awk':
    case 'gawk':
    case 'mawk':
    case 'nawk':
      // system(), print | "cmd", "cmd" | getline and /inet/ (gawk's sockets) leave the program.
      if (awkPrograms(args).some((s) => /\bsystem\s*\(|\||\/inet/.test(s.replace(/\|\|/g, '')))) all(found)
      return
    case 'deno': {
      const { sub, rest } = sc(args, ['-c', '--config', '--import-map', '--lock', '--cert', '--location', '--env-file'])
      if (sub === 'eval') return all(found)
      const script = sub === 'run' || sub === 'task' ? (rest.find((a) => !a.startsWith('-')) ?? '') : sub
      // deno run - (stdin), deno run https://… (code from the network), or plain deno fed by a pipe.
      if (script === '-' || /^https?:/i.test(script) || (!script && piped)) return all(found)
      if (RELEASE_NAME.test(prog(script))) found.add('publish')
      return
    }
    case 'make':
    case 'gmake':
    case 'just':
      if (args.some((a) => !a.startsWith('-') && !a.includes('=') && RELEASE_NAME.test(a))) found.add('publish')
      return
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
      // npm takes abbreviations (npm pu = publish): a command it does not know by name asks.
      if (p === 'npm' && sub && !NPM_KNOWN.has(sub)) return all(found)
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
        else if (inner.length) simpleKinds(inner.map((text) => ({ text, quoted: false })), found, depth + 1)
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
      if (httpieSends(args, piped)) found.add('send')
      return
    case 'scp':
    case 'rsync':
    case 'sftp':
      // A copy to another machine (host:path, user@host:path, rsync://).
      if (args.some((a) => !a.startsWith('-') && (/^[^/\s:]+:/.test(a) || /^rsync:\/\//.test(a)) && !/^[A-Za-z]:[\\/]/.test(a))) found.add('send')
      return
    default:
      // ./deploy.sh, release-it: the script is not read, but its name says what it is for.
      if (RELEASE_NAME.test(p)) found.add('publish')
      return
  }
}

/** A script or target named for shipping: deploy.sh, release, publish-docs. */
const RELEASE_NAME = /^(deploy|release|publish|ship)\b/

/** Interpreters, and the options that hand each one code in the line itself (python -c, node -e, perl -ne…). */
const INTERPRETERS: [RegExp, RegExp][] = [
  [/^(python|pypy)[\d.]*$/, /^-[A-Za-z]*c/],
  [/^(node|nodejs|tsx|ts-node)$/, /^(-[A-Za-z]*[ep]|--eval|--print)/],
  // perl -M'strict; system …' turns into `use strict; system …;`.
  [/^(perl|ruby|lua|luajit|julia|rscript|tclsh)[\d.]*$/, /^-[A-Za-z]*[eE]|^-[mM].*[^\w:=,.-]/],
  [/^php[\d.]*$/, /^(-[A-Za-z]*[rBRE]|--run|--process-)/],
]
/** Options of those interpreters whose value is the next word, not the script. */
const INTERPRETER_VALUE = new Set(['-W', '-X', '-I', '-r', '-l', '-d', '-c', '-C', '--require', '--import', '--loader', '--experimental-loader', '--conditions', '--env-file', '--input-type'])

/**
 * Code given to an interpreter in the line (python -c, node -e), on stdin (curl … | python,
 * python - <<EOF) or as a data: URL is a program the guard cannot read: it asks for everything.
 * A script file is read by its name only (see "Limites conhecidos" in ADR 0014).
 * Returns false when `p` is not an interpreter.
 */
function interpreterKinds(p: string, args: string[], found: Set<SensitiveKind>, piped: boolean): boolean {
  const entry = INTERPRETERS.find(([name]) => name.test(p))
  if (!entry) return false
  if (args.some((a) => /(^|=)data:/i.test(a))) {
    all(found)
    return true
  }
  let script = ''
  let stdin = piped
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (/^\d*</.test(a)) {
      // <file, <<EOF, <<<"code", and a lone < (process substitution, <(curl …), ends up here too).
      stdin = true
      if (/^\d*<[<&-]*$/.test(a)) k++
      continue
    }
    if (/^\d*&?>/.test(a)) {
      if (/^\d*&?>[>&|]*$/.test(a)) k++
      continue
    }
    if (entry[1].test(a)) {
      all(found)
      return true
    }
    // python -m pkg: an installed module, not code from here.
    if (a === '-m' && /^(python|pypy)/.test(p)) return true
    if (a === '--') {
      script = args[k + 1] ?? ''
      break
    }
    if (a.startsWith('-') && a !== '-') {
      // A value never starts with a dash: perl -l -e … still sees the -e.
      if (INTERPRETER_VALUE.has(a) && !(args[k + 1] ?? '-').startsWith('-')) k++
      continue
    }
    script = a
    break
  }
  // `-` names stdin as the script, whatever feeds it (a pipe, a heredoc, a file).
  if (script === '-' || (!script && stdin)) all(found)
  else if (script && RELEASE_NAME.test(prog(script))) found.add('publish')
  return true
}

/** The scripts sed runs: what follows -e/--expression, or the first word (files after it are scanned too: it errs to asking). */
function sedScripts(args: string[]): string[] {
  const scripts: string[] = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a === '--expression' || /^-[A-Za-z]*e$/.test(a)) {
      scripts.push(args[k + 1] ?? '')
      k++
    } else if (a.startsWith('--expression=')) scripts.push(a.slice('--expression='.length))
    else if (/^-[A-Za-z]*e./.test(a) && !a.startsWith('--')) scripts.push(a.slice(a.indexOf('e') + 1))
    else if (a === '-f' || a === '--file' || a === '-l' || a === '--line-length') k++
    else if (!a.startsWith('-')) scripts.push(a)
  }
  return scripts
}

/** GNU sed's `e` command and the `e` flag of s/// run a shell command. */
const sedRuns = (s: string) => /(?:^|[;\n{}\d$/,!])\s*[gpiImM\d]*e[gpiImM\dw]*(?:\s|;|}|$)/.test(s)

/** The awk program text: -e/--source values, or the first word when there is no -f. */
function awkPrograms(args: string[]): string[] {
  const programs: string[] = []
  let file = false
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a === '-f' || a === '--file' || a === '-E' || a === '--exec') {
      file = true
      k++
    } else if (a === '-e' || a === '--source') {
      programs.push(args[k + 1] ?? '')
      k++
    } else if (/^-[FvilW]$/.test(a)) k++
    else if (a === '--') continue
    else if (!a.startsWith('-')) {
      if (!file && !programs.length) programs.push(a)
      break
    }
  }
  return programs
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
  // Options that hand git a program to run (on the other side, per commit, as hooks from a
  // template) or config for this one command, and the ext:: transport (a command as a remote).
  // git takes any unambiguous prefix of a long option (--upload-p), so prefixes count too.
  const risky = ['upload-pack', 'receive-pack', 'exec', 'config', 'separate-git-dir', ...(sub === 'clone' || sub === 'init' ? ['template'] : [])]
  const riskyLong = (a: string) => {
    const m = /^--([\w-]{2,})/.exec(a)
    return !!m && risky.some((r) => r.startsWith(m[1]))
  }
  const shortRisk = (sub === 'clone' && (hasShort(rest, 'u') || hasShort(rest, 'c'))) || (sub === 'rebase' && hasShort(rest, 'x'))
  const runsCommands = (sub === 'bisect' && rest.includes('run')) || (sub === 'submodule' && rest.includes('foreach')) || (sub === 'filter-branch' && rest.some((a) => /-filter$/.test(a)))
  if (shortRisk || runsCommands || rest.some((a) => riskyLong(a) || /^ext::/i.test(a))) return all(found)
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
/** Short flags with no value; any other letter is not read, so it asks. */
const CURL_SHORT_FLAG = new Set('sSLfIikvqgGNOJRZjlBnpM0123456#:'.split(''))
/** Long options taken exactly (curl also takes unambiguous prefixes, which are not read: they ask). */
const CURL_LONG_VALUE = new Set(['request', 'header', 'user', 'output', 'user-agent', 'referer', 'cookie', 'cookie-jar', 'max-time', 'connect-timeout', 'write-out', 'proxy', 'preproxy', 'resolve', 'connect-to', 'cacert', 'capath', 'cert', 'key', 'cert-type', 'key-type', 'range', 'retry', 'limit-rate', 'data', 'data-raw', 'data-binary', 'data-urlencode', 'data-ascii', 'json', 'form', 'form-string', 'upload-file', 'url-query', 'url', 'oauth2-bearer', 'interface', 'dns-servers', 'max-filesize', 'output-dir', 'retry-delay', 'retry-max-time', 'speed-limit', 'speed-time', 'variable', 'expand-url', 'socks4', 'socks4a', 'socks5', 'socks5-hostname', 'proxy1.0', 'doh-url', 'config', 'max-redirs', 'time-cond', 'create-file-mode', 'unix-socket', 'abstract-unix-socket', 'trace', 'trace-ascii', 'stderr', 'etag-save', 'etag-compare', 'parallel-max', 'dump-header', 'continue-at', 'pinnedpubkey', 'ciphers', 'tls-max', 'proto', 'proto-redir', 'proto-default', 'aws-sigv4', 'login-options', 'netrc-file', 'keepalive-time', 'expect100-timeout', 'happy-eyeballs-timeout-ms', 'local-port', 'quote', 'telnet-option', 'ftp-port', 'proxy-user', 'proxy-header', 'mail-from', 'mail-rcpt', 'mail-auth', 'hostpubmd5', 'hostpubsha256', 'pass', 'crlfile'])
const CURL_LONG_FLAG = new Set(['silent', 'show-error', 'location', 'location-trusted', 'fail', 'fail-with-body', 'fail-early', 'insecure', 'compressed', 'verbose', 'include', 'show-headers', 'head', 'get', 'globoff', 'http1.0', 'http1.1', 'http2', 'http2-prior-knowledge', 'http3', 'http3-only', 'ipv4', 'ipv6', 'progress-bar', 'no-progress-meter', 'raw', 'no-buffer', 'remote-name', 'remote-name-all', 'remote-header-name', 'remote-time', 'create-dirs', 'netrc', 'netrc-optional', 'path-as-is', 'retry-connrefused', 'retry-all-errors', 'tcp-nodelay', 'tcp-fastopen', 'no-keepalive', 'no-sessionid', 'no-alpn', 'no-npn', 'styled-output', 'list-only', 'crlf', 'digest', 'basic', 'ntlm', 'negotiate', 'anyauth', 'ssl', 'ssl-reqd', 'tlsv1', 'tlsv1.0', 'tlsv1.1', 'tlsv1.2', 'tlsv1.3', 'sslv2', 'sslv3', 'help', 'version', 'manual', 'junk-session-cookies', 'disable', 'xattr', 'trace-time', 'suppress-connect-headers', 'proxy-insecure', 'ignore-content-length', 'post301', 'post302', 'post303', 'parallel', 'parallel-immediate', 'disallow-username-in-url', 'ssl-no-revoke', 'ssl-revoke-best-effort', 'ssl-allow-beast', 'cert-status', 'false-start', 'skip-existing', 'clobber', 'next', 'append', 'ftp-pasv', 'ftp-ssl', 'ftp-create-dirs', 'proxytunnel', 'noproxy', 'compressed-ssh', 'mail-rcpt-allowfails', 'metalink', 'sasl-ir', 'tr-encoding', 'use-ascii', 'http0.9'])
/** Options that send the request somewhere else than the URL says (a proxy, another address for the name, a file of options). */
const CURL_REROUTE = new Set(['proxy', 'preproxy', 'resolve', 'connect-to', 'socks4', 'socks4a', 'socks5', 'socks5-hostname', 'proxy1.0', 'doh-url', 'config', 'next', 'variable', 'expand-url', 'proxytunnel', 'proxy-user', 'proxy-header', 'unix-socket', 'abstract-unix-socket'])
/** Options that make a body, an upload or a write on the other side. */
const CURL_WRITES = /^(data|data-raw|data-binary|data-urlencode|data-ascii|json|form|form-string|upload-file|post30[123]|mail-rcpt|mail-from|quote|append)$/

/** --no-X turns off a flag X (curl, wget): read as X. */
const unNo = (name: string, flags: Set<string>) => (name.startsWith('no-') && flags.has(name.slice(3)) ? name.slice(3) : name)

/**
 * A curl that writes (a body, an upload or a method other than GET/HEAD) to a host that is not
 * this machine. Short clusters are read letter by letter (-sSd, -XPOST, -Fa=@f); long options
 * only when spelled out (curl takes --dat for --data). A host or an option it cannot read counts
 * as remote and writing.
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
      const name = unNo((eq < 0 ? a : a.slice(0, eq)).slice(2), CURL_LONG_FLAG)
      if (!CURL_LONG_VALUE.has(name) && !CURL_LONG_FLAG.has(name)) {
        unknown = true
        continue
      }
      const value = CURL_LONG_VALUE.has(name) ? (eq < 0 ? args[++k] : a.slice(eq + 1)) : undefined
      if (CURL_WRITES.test(name)) write = true
      if (CURL_REROUTE.has(name)) unknown = true
      if (name === 'request') method = value?.toUpperCase()
      else if (name === 'url') urls.push(value ?? '')
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let c = 1; c < a.length; c++) {
        const letter = a[c]
        // -K (a config file), -: (--next), -x (a proxy), -Q (a raw FTP command): not the URL's request any more.
        if (letter === 'K' || letter === ':' || letter === 'x' || letter === 'Q') unknown = true
        if (!CURL_SHORT_VALUE.has(letter)) {
          if (!CURL_SHORT_FLAG.has(letter)) unknown = true
          continue
        }
        const value = c + 1 < a.length ? a.slice(c + 1) : args[++k]
        if (letter === 'd' || letter === 'F' || letter === 'T') write = true
        if (letter === 'X') method = value?.toUpperCase()
        break
      }
      continue
    }
    urls.push(a)
  }
  // A config file, a reroute or an option it does not know may also carry a body: it counts as writing.
  if (!write && !unknown && reads(method)) return false
  return unknown || !allLocal(urls)
}

const WGET_LONG_VALUE = new Set(['post-data', 'post-file', 'body-data', 'body-file', 'method', 'output-document', 'output-file', 'append-output', 'header', 'user-agent', 'user', 'password', 'http-user', 'http-password', 'directory-prefix', 'tries', 'timeout', 'connect-timeout', 'read-timeout', 'dns-timeout', 'wait', 'waitretry', 'referer', 'level', 'quota', 'limit-rate', 'cut-dirs', 'accept', 'reject', 'accept-regex', 'reject-regex', 'domains', 'exclude-domains', 'include-directories', 'exclude-directories', 'compression', 'max-redirect', 'load-cookies', 'save-cookies', 'backups', 'progress', 'restrict-file-names', 'local-encoding', 'remote-encoding', 'default-page', 'ca-certificate', 'ca-directory', 'certificate', 'private-key', 'secure-protocol', 'input-file', 'execute', 'config', 'base', 'bind-address', 'use-proxy', 'proxy-user', 'proxy-password', 'report-speed', 'dns-servers'])
const WGET_LONG_FLAG = new Set(['quiet', 'verbose', 'debug', 'continue', 'timestamping', 'clobber', 'parent', 'recursive', 'mirror', 'page-requisites', 'convert-links', 'adjust-extension', 'server-response', 'spider', 'check-certificate', 'content-disposition', 'trust-server-names', 'show-progress', 'inet4-only', 'inet6-only', 'cache', 'cookies', 'save-headers', 'directories', 'force-directories', 'host-directories', 'span-hosts', 'relative', 'follow-ftp', 'dns-cache', 'https-only', 'keep-session-cookies', 'ignore-length', 'glob', 'proxy', 'xattr', 'help', 'version', 'background', 'force-html', 'iri', 'hsts', 'netrc', 'passive-ftp', 'retry-connrefused', 'random-wait', 'delete-after', 'backup-converted', 'convert-file-only', 'auth-no-challenge', 'ignore-case', 'protocol-directories', 'unlink'])
const WGET_SHORT_VALUE = new Set('OoaPtTUBQwlDXIARei'.split(''))
const WGET_SHORT_FLAG = new Set('qvdcNrmpkKESHbx46nFhVL'.split(''))

/** wget that posts (--post-data, --method PUT…) to a host that is not this machine; long options only spelled out. */
function wgetSends(args: string[]): boolean {
  let write = false
  let method: string | undefined
  let unknown = false
  const urls: string[] = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = unNo((eq < 0 ? a : a.slice(0, eq)).slice(2), WGET_LONG_FLAG)
      if (!WGET_LONG_VALUE.has(name) && !WGET_LONG_FLAG.has(name)) {
        unknown = true
        continue
      }
      const value = WGET_LONG_VALUE.has(name) ? (eq < 0 ? args[++k] : a.slice(eq + 1)) : undefined
      if (/^(post-data|post-file|body-data|body-file)$/.test(name)) write = true
      else if (name === 'method') method = value?.toUpperCase()
      // URLs from a file, a wgetrc command (post_data, http_proxy…), a config file, a proxy.
      else if (/^(input-file|execute|config|use-proxy|proxy-user|proxy-password|base)$/.test(name)) unknown = true
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let c = 1; c < a.length; c++) {
        const letter = a[c]
        if (!WGET_SHORT_VALUE.has(letter)) {
          if (!WGET_SHORT_FLAG.has(letter)) unknown = true
          continue
        }
        if (letter === 'i' || letter === 'e' || letter === 'B') unknown = true
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

const HTTPIE_VALUE = new Set(['-a', '--auth', '-A', '--auth-type', '-o', '--output', '--session', '--session-read-only', '--verify', '--cert', '--cert-key', '--cert-key-pass', '--timeout', '--max-redirects', '--max-headers', '--pretty', '-s', '--style', '-p', '--print', '-P', '--history-print', '--format-options', '--boundary', '--default-scheme', '--ssl', '--ciphers', '--response-charset', '--response-mime', '--raw', '--proxy'])
const HTTPIE_FLAG = new Set(['--json', '-j', '--form', '-f', '--multipart', '--unsorted', '--sorted', '--headers', '-h', '--meta', '-m', '--body', '-b', '--verbose', '-v', '--all', '--stream', '-S', '--download', '-d', '--continue', '-c', '--quiet', '-q', '--ignore-netrc', '--offline', '--follow', '-F', '--check-status', '--path-as-is', '--chunked', '--ignore-stdin', '-I', '--help', '--version', '--traceback', '--debug', '--compress', '-x', '--https', '--http1', '--http2', '--http3', '-4', '-6'])

/**
 * httpie / xh: `http POST host x=1`, data items (x=1, x:=1, x@file) or a body on stdin (cmd | http
 * host, unless --ignore-stdin) make it write. Options only spelled out; an unknown one asks.
 */
function httpieSends(args: string[], piped = false): boolean {
  const positional: string[] = []
  let write = false
  let unknown = false
  let ignoreStdin = false
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a.startsWith('-') && a.length > 1) {
      const eq = a.indexOf('=')
      const name = eq < 0 ? a : a.slice(0, eq)
      if (/^(--form|--multipart|--raw|-f)$/.test(name)) write = true
      if (name === '--ignore-stdin' || name === '-I') ignoreStdin = true
      if (name === '--proxy') unknown = true
      if (HTTPIE_VALUE.has(name)) {
        if (eq < 0) k++
      } else if (/^-[a-zA-Z]{2,}$/.test(a)) {
        // A cluster of short flags (-fv): each letter must be a known flag.
        for (const letter of a.slice(1)) {
          if (!HTTPIE_FLAG.has(`-${letter}`)) unknown = true
          if (letter === 'f') write = true
          if (letter === 'I') ignoreStdin = true
        }
      } else if (!HTTPIE_FLAG.has(name)) unknown = true
      continue
    }
    positional.push(a)
  }
  if (piped && !ignoreStdin) write = true
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
