import { SENSITIVE_KINDS, SENSITIVE_LABEL, type SensitiveKind } from './types/bots'

// Guarda de ações sensíveis do Chat dos bots (docs/prd/chat-de-bots.md, "Guarda de ações sensíveis").
// Função pura: diz se uma chamada de ferramenta envia, publica, apaga, paga ou mexe no git remoto.
// Erra para o lado de pedir: um falso positivo custa um clique; um falso negativo, um envio sem o seu sim.

export interface GuardOptions {
  /** Where an mcp__ tool comes from (PreToolUse mcp_server.source, canUseTool mcpServer.source). */
  mcpSource?: string
}

const MAX_DEPTH = 4
/** Past this, a command is not read word by word: it asks. */
const MAX_COMMAND = 20_000

/**
 * The first sensitive kind of a tool call, or null. Order when several match: pay, push,
 * publish, send, delete (the costliest first).
 */
export function sensitiveKind(tool: string, input: unknown, opts: GuardOptions = {}): SensitiveKind | null {
  return sensitiveKinds(tool, input, opts)[0] ?? null
}

/** Every sensitive kind a tool call falls in, in SENSITIVE_KINDS order of cost (pay first). */
export function sensitiveKinds(tool: string, input: unknown, opts: GuardOptions = {}): SensitiveKind[] {
  const found = new Set<SensitiveKind>()
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (tool === 'Bash' || tool === 'Monitor' || tool === 'PowerShell') {
    const command = typeof args.command === 'string' ? args.command : ''
    if (command.length > MAX_COMMAND) for (const k of SENSITIVE_KINDS) found.add(k)
    else shellKinds(command, found, 0, tool === 'PowerShell')
  } else if (tool.startsWith('mcp__')) {
    mcpKinds(tool, opts, found)
  }
  return ORDER.filter((k) => found.has(k))
}

const ORDER: SensitiveKind[] = ['pay', 'push', 'publish', 'send', 'delete']

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

function mcpKinds(tool: string, opts: GuardOptions, found: Set<SensitiveKind>): void {
  const { server, name } = splitMcp(tool)
  // The office's own server (board, atas, memory) never leaves the machine. Trust its provenance,
  // not its name: a configured server could also call itself "office" (CLI docs: key trust on source).
  if (server === 'office' && (opts.mcpSource === undefined || opts.mcpSource === 'sdk')) return
  const w = words(name)
  if (!w.length) return
  if (READ.has(w[0]) && !w.slice(1).some((x) => STRONG.has(x))) return
  const has = (set: Set<string>) => w.some((x) => set.has(x))
  if (has(PAY)) found.add('pay')
  if (has(PUSH) || (w.includes('pull') && w.includes('request') && w.some((x) => MAKE.has(x) || x === 'open'))) found.add('push')
  if (has(PUBLISH)) found.add('publish')
  // A draft stays on the machine of whoever reads it later: create_draft is fine, send_draft is not.
  const drafting = w.includes('draft') || w.includes('drafts')
  if (w.includes('send') || (!drafting && (has(SEND) || (w.some((x) => MAKE.has(x)) && has(MESSAGE))))) found.add('send')
  if (has(DELETE)) found.add('delete')
}

// ---------- shell commands ----------

interface Token {
  text: string
  /** Came (even partly) from inside quotes: a word, never an operator. */
  quoted: boolean
}

interface Parsed {
  segments: Token[][]
  /** $(…) and `…`, read as commands of their own. */
  subs: string[]
}

/**
 * Splits a command line into simple commands (on ; && || | & newlines and parentheses) and
 * collects command substitutions, even inside double quotes. Close enough to sh for this
 * purpose; anything it gets wrong is caught by the literal patterns of rawKinds.
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
      quoted = true
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
      quoted = true
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
      endWord()
      i = readParen(i + 1)
    } else if (c === '`') {
      endWord()
      i = readTick(i)
    } else if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')' || c === '{' || c === '}') {
      // `{` and `}` only group when they stand alone; "a{b}" stays one word.
      if ((c === '{' || c === '}') && inWord) {
        cur += c
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

/** Drops what only wraps the real command: VAR=1, sudo, env, nohup, time, xargs, npx… */
function unwrap(tokens: Token[]): Token[] {
  let t = tokens
  for (let guard = 0; guard < 10 && t.length; guard++) {
    const first = t[0].text
    if (/^[A-Za-z_][\w]*=/.test(first) && !t[0].quoted) {
      t = t.slice(1)
      continue
    }
    const p = prog(first)
    if (p === 'sudo' || p === 'doas') {
      let k = 1
      while (k < t.length && t[k].text.startsWith('-')) k += /^-[ugCchpr]$/.test(t[k].text) ? 2 : 1
      t = t.slice(k)
    } else if (p === 'env') {
      let k = 1
      while (k < t.length && (t[k].text.startsWith('-') || /^[A-Za-z_][\w]*=/.test(t[k].text))) k += /^-[uSC]$/.test(t[k].text) ? 2 : 1
      t = t.slice(k)
    } else if (['nohup', 'time', 'command', 'exec', 'builtin', 'caffeinate', 'stdbuf', 'unbuffer'].includes(p)) {
      let k = 1
      while (k < t.length && t[k].text.startsWith('-')) k++
      t = t.slice(k)
    } else if (p === 'nice' || p === 'ionice' || p === 'timeout' || p === 'watch' || p === 'xargs' || p === 'parallel') {
      // Options, then (timeout) a duration: whatever looks like an option or a number goes.
      let k = 1
      while (k < t.length && (t[k].text.startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(t[k].text))) k++
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
  return t
}

function shellKinds(cmd: string, found: Set<SensitiveKind>, depth: number, powershell = false): void {
  if (depth > MAX_DEPTH) {
    // Nested this deep on purpose: it asks.
    for (const k of SENSITIVE_KINDS) found.add(k)
    return
  }
  rawKinds(cmd, found, powershell)
  const { segments, subs } = tokenize(cmd)
  for (const sub of subs) shellKinds(sub, found, depth + 1, powershell)
  for (const seg of segments) segmentKinds(unwrap(seg), found, depth, powershell)
}

/** Literal patterns over the whole text: they catch what hides in quotes, heredocs and scripts. */
function rawKinds(cmd: string, found: Set<SensitiveKind>, powershell: boolean): void {
  const raw: [RegExp, SensitiveKind][] = [
    [/\bgit\s+push\b/i, 'push'],
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
  if (powershell && /\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i.test(cmd) && /-Method\s+['"]?(post|put|patch|delete)\b|-Body\b|-InFile\b/i.test(cmd)) {
    if (!allLocal(urlsIn(cmd))) found.add('send')
  }
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

function segmentKinds(tokens: Token[], found: Set<SensitiveKind>, depth: number, powershell: boolean): void {
  if (!tokens.length) return
  const p = prog(tokens[0].text)
  const args = tokens.slice(1).map((t) => t.text)

  // Commands that run other commands: read what they run.
  if (SHELLS.has(p)) {
    const c = args.findIndex((a) => /^-[a-z]*c$/.test(a))
    if (c >= 0 && args[c + 1] !== undefined) shellKinds(args[c + 1], found, depth + 1)
    return
  }
  if (PS.has(p)) {
    const c = args.findIndex((a) => /^-(c|command|encodedcommand|e|ec)$/i.test(a))
    if (c >= 0 && /^-(encodedcommand|e|ec)$/i.test(args[c])) for (const k of SENSITIVE_KINDS) found.add(k)
    else if (c >= 0) shellKinds(args.slice(c + 1).join(' '), found, depth + 1, true)
    return
  }
  if (p === 'eval') return shellKinds(args.join(' '), found, depth + 1, powershell)
  if (p === 'ssh') {
    // ssh [options] host command…: the command runs over there, read it too.
    const withValue = ['-p', '-i', '-l', '-o', '-F', '-J', '-L', '-R', '-D', '-b', '-c', '-E', '-e', '-m', '-O', '-Q', '-S', '-W', '-w', '-B', '-I']
    const { rest } = subcommand(args, withValue)
    if (rest.length) shellKinds(rest.join(' '), found, depth + 1)
    return
  }

  switch (p) {
    case 'git': {
      const { sub, rest } = subcommand(args, ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])
      if (sub === 'push') found.add('push')
      else if (sub === 'clean' && (hasShort(rest, 'f') || hasArg(rest, '--force'))) found.add('delete')
      else if (sub === 'reset' && hasArg(rest, '--hard')) found.add('delete')
      else if (sub === 'branch' && (hasShort(rest, 'D') || (hasArg(rest, '--delete', '-d') && hasArg(rest, '--force', '-f')))) found.add('delete')
      return
    }
    case 'gh': {
      const { sub, rest } = subcommand(args, ['-R', '--repo', '--hostname'])
      const action = subcommand(rest, ['-R', '--repo']).sub
      if (sub === 'pr' && (action === 'merge' || action === 'create')) found.add('push')
      else if (sub === 'pr' && (action === 'comment' || action === 'review' || action === 'close')) found.add('send')
      else if (sub === 'issue' && (action === 'create' || action === 'comment' || action === 'close')) found.add('send')
      else if (sub === 'release' && (action === 'create' || action === 'upload' || action === 'edit')) found.add('publish')
      else if ((sub === 'release' || sub === 'repo' || sub === 'gist') && action === 'delete') found.add('delete')
      else if (sub === 'gist' && action === 'create') found.add('publish')
      else if (sub === 'workflow' && action === 'run') found.add('publish')
      else if (sub === 'api') {
        const method = methodOf(rest, ['-X', '--method'])
        if ((method && method !== 'GET' && method !== 'HEAD') || rest.some((a) => /^(-f|-F|--field|--raw-field|--input)$/.test(a) || /^--(field|raw-field|input)=/.test(a))) found.add('send')
      }
      return
    }
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun': {
      const { sub, rest } = subcommand(args, ['--registry', '--otp', '--tag', '--access', '-w', '--workspace', '--filter', '-F', '--cwd', '-C', '--prefix'])
      if (sub === 'publish' || sub === 'deprecate' || (sub === 'npm' && subcommand(rest).sub === 'publish')) found.add('publish')
      else if (sub === 'unpublish') found.add('delete')
      else if (sub === 'run' || sub === 'run-script') {
        const script = subcommand(rest).sub
        if (/^(deploy|release|publish|ship)\b/.test(script)) found.add('publish')
      } else if (p !== 'npm' && /^(deploy|release|publish|ship)\b/.test(sub)) found.add('publish')
      return
    }
    case 'cargo':
    case 'poetry':
    case 'expo':
      if (subcommand(args).sub === 'publish') found.add('publish')
      return
    case 'twine':
      if (subcommand(args).sub === 'upload') found.add('publish')
      return
    case 'gem':
    case 'helm':
      if (subcommand(args).sub === 'push') found.add('publish')
      return
    case 'docker':
    case 'podman': {
      const { sub } = subcommand(args)
      if (sub === 'push' || (sub === 'buildx' && hasArg(args, '--push'))) found.add('publish')
      if (/^(rm|rmi|prune)$/.test(sub) || ((sub === 'system' || sub === 'volume' || sub === 'image' || sub === 'container') && hasArg(args, 'prune', 'rm'))) found.add('delete')
      return
    }
    case 'dotnet':
      if (args.includes('push') && args.includes('nuget')) found.add('publish')
      return
    case 'vercel': {
      const { sub } = subcommand(args, ['--token', '--scope', '-t', '-S', '--cwd', '-A', '--local-config'])
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
      const { sub } = subcommand(args)
      if (sub === 'deploy' || sub === 'up') found.add('publish')
      else if (/^(destroy|remove|delete)$/.test(sub)) found.add('delete')
      return
    }
    case 'wrangler': {
      const { sub } = subcommand(args)
      if (sub === 'deploy' || sub === 'publish') found.add('publish')
      else if (sub === 'delete') found.add('delete')
      return
    }
    case 'kubectl': {
      const { sub } = subcommand(args, ['-n', '--namespace', '--context', '-f'])
      if (/^(apply|create|replace|patch|rollout|scale|set)$/.test(sub)) found.add('publish')
      else if (sub === 'delete' || sub === 'drain') found.add('delete')
      return
    }
    case 'terraform':
    case 'tofu':
    case 'pulumi': {
      const { sub } = subcommand(args, ['-chdir'])
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
    case 'unlink':
      if (p === 'rm' && (hasShort(args, 'r') || hasShort(args, 'R') || hasArg(args, '--recursive'))) found.add('delete')
      return
    case 'find':
      if (args.includes('-delete') || args.some((a, k) => (a === '-exec' || a === '-execdir' || a === '-ok') && /^(rm|shred|unlink)$/.test(prog(args[k + 1] ?? '')))) found.add('delete')
      return
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
      if (curlWrites(args) && !allLocal(hostsOf(args, CURL_VALUE_OPTS))) found.add('send')
      return
    case 'wget':
      if (wgetWrites(args) && !allLocal(hostsOf(args, WGET_VALUE_OPTS))) found.add('send')
      return
    case 'http':
    case 'https':
    case 'xh':
    case 'httpie': {
      const method = args.find((a) => /^(post|put|patch|delete)$/i.test(a))
      const data = args.some((a) => /^[\w.-]+(:=|=|@)/.test(a) && !/^[a-z]+:\/\//i.test(a))
      if ((method || data) && !allLocal(hostsOf(args, []))) found.add('send')
      return
    }
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
      if ((args.some((a) => /^-body$|^-infile$/i.test(a)) || /^(post|put|patch|delete)$/i.test(methodOf(args, ['-Method', '-method']) ?? '')) && !allLocal(hostsOf(args, ['-Method', '-method', '-Body', '-body', '-Headers', '-headers']))) found.add('send')
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

const CURL_VALUE_OPTS = ['-X', '--request', '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--json', '-F', '--form', '-T', '--upload-file', '-H', '--header', '-u', '--user', '-o', '--output', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-x', '--proxy', '--resolve', '--cacert', '--cert', '--key', '-K', '--config', '-r', '--range', '--retry', '-E', '--limit-rate']
const WGET_VALUE_OPTS = ['--post-data', '--post-file', '--body-data', '--body-file', '--method', '-O', '--output-document', '-o', '--output-file', '--header', '-U', '--user-agent', '--user', '--password', '-P', '--directory-prefix', '-t', '--tries', '-T', '--timeout']

function curlWrites(args: string[]): boolean {
  const method = methodOf(args, ['-X', '--request'])
  if (method && method !== 'GET' && method !== 'HEAD') return true
  return args.some((a) => /^(-d|-F|-T)/.test(a) || /^--(data|data-raw|data-binary|data-urlencode|json|form|form-string|upload-file)(=|$)/.test(a))
}

function wgetWrites(args: string[]): boolean {
  const method = methodOf(args, ['--method'])
  if (method && method !== 'GET' && method !== 'HEAD') return true
  return args.some((a) => /^--(post-data|post-file|body-data|body-file)(=|$)/.test(a))
}

/** The hosts a curl-like command talks to: URLs, or the plain words that are not option values. */
function hostsOf(args: string[], valueOpts: string[]): string[] {
  const hosts: string[] = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a.startsWith('-')) {
      if (valueOpts.includes(a)) k++
      continue
    }
    const h = hostOf(a)
    if (h) hosts.push(h)
  }
  return hosts
}

function urlsIn(text: string): string[] {
  return [...text.matchAll(/\b[a-z][\w+.-]*:\/\/[^\s'"`)]+/gi)].map((m) => hostOf(m[0])).filter((h): h is string => !!h)
}

/** https://user@api.example.com:8443/x -> api.example.com; localhost:3000/x -> localhost. */
function hostOf(arg: string): string | null {
  let s = arg.trim()
  if (!s || s.includes(' ')) return null
  s = s.replace(/^[a-z][\w+.-]*:\/\//i, '')
  s = s.replace(/^[^@/]*@/, '')
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    return end > 0 ? s.slice(1, end).toLowerCase() : null
  }
  const host = s.split(/[/:?#]/)[0].toLowerCase()
  // A word with no dot and that is not localhost is not a host (a header value, a file name).
  if (!host || (!host.includes('.') && host !== 'localhost' && !/^[\d.]+$/.test(host))) return /^[a-z][\w+.-]*:\/\//i.test(arg) ? host || null : null
  return host
}

/** Every host is this machine. No host found at all: not sure, so not local. */
function allLocal(hosts: string[]): boolean {
  if (!hosts.length) return false
  return hosts.every((h) => h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1' || h === '0.0.0.0')
}
