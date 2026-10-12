import type { PermissionRequest } from './types'

// Notificação do sistema para pedidos de permissão (AO-35). Tudo aqui é puro (sem
// Electron) para dar para testar com `npm test`: o main só monta a Notification.
//
// Regra geral: o botão "Permitir" na notificação pula o cartão, onde o comando aparece
// inteiro. Por isso ele só aparece para o que dá para resumir numa linha e não destrói
// nada. Na dúvida, sem botão: a notificação só abre o app.

export interface PermissionNotice {
  title: string
  /** Uma linha: o comando ou o arquivo, sem segredos. */
  body: string
  /** Botão "Permitir" (só no Mac). */
  allow: boolean
  /** Resposta inline = negar com instrução (só no Mac). */
  reply: boolean
  /** Por que não tem "Permitir"; vazio quando tem. */
  why: string
}

export type NoticeInput = Pick<PermissionRequest, 'kind' | 'toolName' | 'title' | 'input'> & Partial<Pick<PermissionRequest, 'context'>>

const NOTICE_BODY_MAX = 140

/** Monta a notificação de um pedido. `platform` é process.platform. */
export function permissionNotice(req: NoticeInput, agentName: string, platform: string): PermissionNotice {
  const title = `${agentName} está indo até você`
  const summary = clipLine(redactSecrets(noticeSummary(req)), NOTICE_BODY_MAX)
  const body = req.context ? clipLine(`${redactSecrets(req.context)} · ${summary}`, NOTICE_BODY_MAX + 40) : summary
  // Ações em toast no Windows pedem um ativador COM registrado: lá (e no Linux) só o clique.
  if (platform !== 'darwin') return { title, body, allow: false, reply: false, why: 'só no Mac' }
  if (req.kind === 'question') return { title, body, allow: false, reply: false, why: 'pergunta: responda no app' }
  if (req.kind === 'plan') return { title, body, allow: false, reply: true, why: 'plano: leia no app' }
  const why = toolRisk(req.toolName, req.input)
  return { title, body: why ? `${body}\n${noButtonHint(why)}` : body, allow: !why, reply: true, why }
}

function noButtonHint(why: string): string {
  return `Abra o app para decidir (${why}).`
}

/** O que a notificação mostra: o comando, o arquivo ou o título do pedido. */
export function noticeSummary(req: NoticeInput): string {
  const input = req.input ?? {}
  if (req.kind === 'question') return 'Tem uma pergunta para você'
  if (req.kind === 'plan') return 'Trouxe um plano para você aprovar'
  if (req.toolName === 'Bash' && typeof input.command === 'string') return `$ ${input.command}`
  const file = input.file_path ?? input.notebook_path ?? input.path
  if (typeof file === 'string' && file) {
    const verb = FILE_VERBS[req.toolName]
    if (verb) return `${verb} ${shortPath(file)}`
  }
  return req.title
}

const FILE_VERBS: Record<string, string> = {
  Edit: 'Editar',
  MultiEdit: 'Editar',
  Write: 'Escrever',
  NotebookEdit: 'Editar',
  Read: 'Ler',
}

/** Ferramentas que dá para permitir pela notificação, desde que o arquivo não seja sensível. */
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read'])
/** Só leem, e o resumo mostra o que leem. */
const READ_TOOLS = new Set(['Glob', 'Grep', 'LS', 'WebSearch', 'TodoWrite'])

/**
 * Motivo para NÃO pôr o botão "Permitir", ou '' quando pode. MCP, subagentes, skills,
 * WebFetch (a URL pode levar dados para fora) e ferramentas desconhecidas ficam sem botão.
 */
export function toolRisk(tool: string, input: Record<string, unknown> = {}): string {
  if (tool === 'Bash') return commandRisk(typeof input.command === 'string' ? input.command : '')
  if (FILE_TOOLS.has(tool)) {
    const file = input.file_path ?? input.notebook_path
    if (typeof file !== 'string' || !file) return 'sem arquivo'
    return sensitivePath(file) ? 'arquivo sensível' : ''
  }
  if (READ_TOOLS.has(tool)) {
    const text = [input.path, input.pattern, input.query].filter((v) => typeof v === 'string').join(' ')
    return sensitivePath(text) ? 'arquivo sensível' : ''
  }
  return 'ferramenta sem resumo seguro'
}

// ---------- comandos ----------

/** Nunca ganham botão, com qualquer argumento. */
const DANGEROUS = new Set([
  // apagam ou sobrescrevem
  'rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash', 'dd', 'truncate', 'mv', 'cp', 'ln', 'install', 'tee', 'rsync',
  // disco e sistema
  'mkfs', 'newfs', 'fdisk', 'diskutil', 'format', 'mount', 'umount', 'shutdown', 'reboot', 'halt', 'poweroff',
  'launchctl', 'systemctl', 'service', 'crontab', 'at', 'defaults', 'csrutil', 'nvram', 'pmset', 'scutil', 'networksetup', 'security', 'open',
  // privilégio e permissões
  'sudo', 'su', 'doas', 'pkexec', 'chmod', 'chown', 'chgrp', 'chflags', 'chattr', 'xattr', 'passwd', 'dscl', 'visudo',
  // processos
  'kill', 'killall', 'pkill',
  // executam outra coisa
  'eval', 'exec', 'source', '.', 'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'osascript', 'pwsh', 'powershell', 'cmd',
  'npx', 'bunx', 'pnpx', 'watch', 'parallel',
  // rede e máquinas remotas
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'nc', 'ncat', 'netcat', 'telnet', 'socat',
  // bancos de dados
  'psql', 'mysql', 'mariadb', 'sqlite3', 'mongo', 'mongosh', 'redis-cli',
  // nuvem e deploy
  'aws', 'gcloud', 'gsutil', 'az', 'firebase', 'vercel', 'netlify', 'heroku', 'fly', 'flyctl', 'supabase', 'wrangler', 'doctl', 'eas',
  // gerenciadores de pacote do sistema
  'brew', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'port', 'snap', 'gem', 'choco', 'winget',
  // despejam variáveis de ambiente (segredos) na conversa
  'env', 'printenv', 'export', 'set',
])

/** Rodam o comando seguinte: o que importa é o que vem depois. */
const WRAPPERS = new Set(['command', 'builtin', 'nohup', 'time', 'nice', 'caffeinate', 'stdbuf'])

/** Interpretadores: rodar um arquivo do projeto pode; código inline (-c/-e), não. */
const INTERPRETERS = new Set(['node', 'python', 'python3', 'perl', 'ruby', 'php', 'deno', 'bun', 'lua', 'Rscript'])

/**
 * Motivo para o comando NÃO ganhar "Permitir" na notificação, ou '' quando pode.
 * Conservador de propósito: o que não dá para ler com segurança fica sem botão.
 */
export function commandRisk(command: string): string {
  const cmd = command.trim()
  if (!cmd) return 'comando vazio'
  if (cmd.length > 300) return 'comando longo'
  if (/[\r\n]/.test(cmd)) return 'várias linhas'
  if (SENSITIVE_WORDS.test(cmd)) return 'arquivo sensível'
  if (SQL_DESTRUCTIVE.test(cmd)) return 'SQL destrutivo'
  const parsed = splitShell(cmd)
  if (typeof parsed === 'string') return parsed
  for (const seg of parsed) {
    const why = segmentRisk(seg)
    if (why) return why
  }
  return ''
}

const SQL_DESTRUCTIVE = /\b(drop\s+(table|database|schema|index|view)|truncate\s+table|delete\s+from|alter\s+table)\b/i
const SENSITIVE_WORDS = /(^|[\s"'=/~])(\.env\b|\.ssh\b|\.aws\b|\.gnupg\b|\.netrc\b|\.npmrc\b|\.pypirc\b|\.git-credentials\b|\.kube\b|id_rsa|id_ed25519|\.pem\b|\.p12\b|keychain|credentials)/i

/** Arquivos de configuração, chaves e pastas do sistema. */
export function sensitivePath(p: string): boolean {
  if (SENSITIVE_WORDS.test(p)) return true
  const s = p.replace(/\\/g, '/')
  if (/(^|\/)\.git\//.test(s) || /\/\.git$/.test(s)) return true
  if (/(^|\/)\.claude\/(settings[^/]*\.json|hooks\/)/.test(s)) return true
  if (/^(\/etc|\/usr|\/bin|\/sbin|\/System|\/Library|\/private|\/var|[A-Za-z]:\/Windows)(\/|$)/i.test(s)) return true
  if (/\/Library\/(LaunchAgents|LaunchDaemons|Keychains)(\/|$)/.test(s)) return true
  // dotfiles na raiz da casa: ~/.zshrc, /Users/x/.bashrc, ~/.gitconfig…
  if (/^(~|\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\/Users\/[^/]+)\/\.[^/]+$/.test(s)) return true
  return false
}

interface Segment {
  words: string[]
  /** Separador antes do segmento: '|' quando recebe a saída de outro comando. */
  after: string
}

/**
 * Quebra o comando em segmentos (;, &&, ||, |, &) e palavras, respeitando aspas.
 * Devolve um motivo (string) quando há algo que não dá para ler com segurança.
 */
export function splitShell(cmd: string): Segment[] | string {
  const segs: Segment[] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  let quote: '' | '"' | "'" = ''
  let after = ''
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSeg = (sep: string) => {
    endWord()
    if (words.length) segs.push({ words, after })
    else if (sep) return 'comando estranho'
    words = []
    after = sep
    return ''
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (quote === "'") {
      if (c === "'") quote = ''
      else word += c
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = ''
      else if (c === '`' || (c === '$' && cmd[i + 1] === '(')) return 'subcomando'
      else if (c === '\\' && i + 1 < cmd.length) word += cmd[++i]
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      inWord = true
      continue
    }
    if (c === '\\') {
      if (i + 1 < cmd.length) word += cmd[++i]
      inWord = true
      continue
    }
    if (c === '`' || (c === '$' && cmd[i + 1] === '(')) return 'subcomando'
    if (c === '<' && cmd[i + 1] === '(') return 'subcomando'
    if (c === '>' && cmd[i + 1] === '(') return 'subcomando'
    if (c === '<' && cmd[i + 1] === '<') return 'heredoc'
    if (c === '>') {
      // Só vale jogar fora (/dev/null) ou juntar saídas (2>&1).
      const rest = cmd.slice(i + 1)
      const m = /^(>?)\s*(&\d|\/dev\/null\b)/.exec(rest)
      if (!m) return 'grava em arquivo'
      // "2>" deixou o 2 na palavra atual
      if (/^\d$/.test(word)) {
        word = ''
        inWord = false
      }
      endWord()
      i += m[0].length
      continue
    }
    if (c === ' ' || c === '\t') {
      endWord()
      continue
    }
    // &>/dev/null: quem decide é o > logo abaixo
    if (c === '&' && cmd[i + 1] === '>') continue
    if (c === ';' || c === '|' || c === '&') {
      let sep = c
      if ((c === '|' || c === '&') && cmd[i + 1] === c) {
        sep = c + c
        i++
      } else if (c === '|' && cmd[i + 1] === '&') {
        sep = '|'
        i++
      }
      const bad = endSeg(sep)
      if (bad) return bad
      continue
    }
    if (c === '(' || c === ')' || c === '{' || c === '}') return 'subshell'
    word += c
    inWord = true
  }
  if (quote) return 'aspas sem fechar'
  endSeg('')
  return segs
}

function segmentRisk(seg: Segment): string {
  const w = [...seg.words]
  // VAR=valor antes do comando
  while (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w.shift()
  while (w.length && WRAPPERS.has(base(w[0]))) {
    w.shift()
    while (w.length && w[0].startsWith('-')) w.shift()
  }
  if (base(w[0] ?? '') === 'timeout') {
    w.shift()
    while (w.length && (w[0].startsWith('-') || /^\d/.test(w[0]))) w.shift()
  }
  if (!w.length) return ''
  if (w[0].startsWith('$') || w[0].includes('$')) return 'comando em variável'
  const name = base(w[0])
  const args = w.slice(1)
  if (seg.after === '|' && (SHELLS.has(name) || INTERPRETERS.has(name))) return 'roda o que veio pela rede (| sh)'
  if (DANGEROUS.has(name) || /^mkfs/.test(name)) return `${name} é destrutivo`
  if (name === 'xargs') return args.some((a) => DANGEROUS.has(base(a)) || SHELLS.has(base(a))) ? 'xargs com comando destrutivo' : ''
  if (INTERPRETERS.has(name)) return args.some((a) => /^-(c|e|p|-eval|-print|r)$/.test(a) || /^-[a-z]*[ce]$/.test(a)) ? 'código inline' : ''
  if (name === 'find') return args.some((a) => /^-(delete|exec|execdir|ok|okdir|fprint\w*|fls)$/.test(a)) ? 'find que apaga ou executa' : ''
  if (name === 'sed' || name === 'perl') return args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place')) ? 'edita arquivos no lugar' : ''
  if (name === 'git') return gitRisk(args)
  if (name === 'gh') return ghRisk(args)
  if (PKG.has(name)) return pkgRisk(name, args)
  if (name === 'pip' || name === 'pip3' || name === 'uv' || name === 'poetry') return pipRisk(args)
  if (name === 'cargo') return /^(build|check|test|run|fmt|clippy|doc|tree|metadata|bench)$/.test(args[0] ?? '') ? '' : `cargo ${args[0] ?? ''}`.trim()
  if (name === 'docker' || name === 'podman') return /^(ps|images|logs|inspect|version|info|stats|top)$/.test(args[0] ?? '') ? '' : `${name} ${args[0] ?? ''}`.trim()
  if (name === 'kubectl' || name === 'helm') return /^(get|describe|logs|version|explain|top|list|status|cluster-info)$/.test(args[0] ?? '') ? '' : `${name} ${args[0] ?? ''}`.trim()
  if (name === 'terraform' || name === 'tofu' || name === 'pulumi') return /^(plan|validate|fmt|show|version|preview|output)$/.test(args[0] ?? '') ? '' : `${name} ${args[0] ?? ''}`.trim()
  if (name === 'make') return args.some((a) => /^(clean|distclean|install|uninstall|deploy|publish|release)$/.test(a)) ? `make ${args.find((a) => !a.startsWith('-'))}` : ''
  return ''
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'pwsh', 'powershell', 'sudo', 'osascript'])

const base = (w: string) => w.split('/').pop() ?? w

/** git: tudo que reescreve histórico, fala com o remoto ou descarta trabalho fica sem botão. */
function gitRisk(args: string[]): string {
  // git -c / -C antes do subcomando muda configuração ou pasta
  if (args.some((a) => a === '-c' || a.startsWith('--exec-path') || a.startsWith('--git-dir') || a.startsWith('--work-tree'))) return 'git com configuração extra'
  const rest = [...args]
  while (rest.length && rest[0].startsWith('-')) rest.splice(0, rest[0] === '-C' ? 2 : 1)
  const sub = rest[0] ?? ''
  const opts = rest.slice(1)
  if (opts.some((a) => a === '-f' || a.startsWith('--force') || a === '--hard' || a === '--mirror' || a === '--delete' || a === '-D')) return `git ${sub} forçado`
  const unsafe = new Set(['push', 'reset', 'clean', 'restore', 'rebase', 'filter-branch', 'filter-repo', 'gc', 'prune', 'reflog', 'update-ref', 'rm', 'send-email', 'config', 'remote', 'submodule', 'worktree', 'am', 'apply', 'replace', 'notes', 'lfs', 'clone', 'fetch', 'pull', 'credential'])
  if (unsafe.has(sub)) return `git ${sub}`
  if (sub === 'checkout') return opts.length === 2 && opts[0] === '-b' ? '' : 'git checkout'
  if (sub === 'switch') return opts.some((a) => a === '--discard-changes' || a === '-C') ? 'git switch' : ''
  if (sub === 'branch') return opts.some((a) => /^-[a-zA-Z]*[dDmMcC]/.test(a) || a.startsWith('--move') || a.startsWith('--copy') || a.startsWith('--set-upstream') || a.startsWith('--unset')) ? 'git branch' : ''
  if (sub === 'tag') return opts.some((a) => /^-[a-zA-Z]*d/.test(a) || a === '--delete') ? 'git tag -d' : ''
  if (sub === 'stash') return /^(drop|clear|pop)$/.test(opts[0] ?? '') ? `git stash ${opts[0]}` : ''
  if (sub === 'commit') return opts.some((a) => a === '--amend' || a === '--no-verify' || a === '-n') ? 'git commit que reescreve ou pula hooks' : ''
  return ''
}

/** gh: só leitura (view, list, status, diff, checks). */
function ghRisk(args: string[]): string {
  const [area, action] = args
  if (/^(pr|issue|run|repo|release|workflow|gist|search)$/.test(area ?? '') && /^(view|list|status|diff|checks)$/.test(action ?? '')) return ''
  if (area === 'status') return ''
  return `gh ${[area, action].filter(Boolean).join(' ')}`
}

const PKG = new Set(['npm', 'yarn', 'pnpm', 'bun'])

/** npm/yarn/pnpm/bun: scripts do projeto pode; publicar, global, remover ou instalar pacote novo, não. */
function pkgRisk(name: string, args: string[]): string {
  if (args.some((a) => a === '-g' || a === '--global' || a === '--location=global')) return `${name} global`
  const sub = args.find((a) => !a.startsWith('-')) ?? ''
  const subArgs = args.slice(args.indexOf(sub) + 1).filter((a) => !a.startsWith('-'))
  if (/^(publish|unpublish|deprecate|owner|access|token|adduser|login|logout|exec|x|dlx|link|unlink|uninstall|remove|rm|un|r|prune|dedupe|cache|config|set|patch|create|init|team|org|hook|profile|star|dist-tag|version)$/.test(sub)) return `${name} ${sub}`
  if (/^(install|i|add|ci|update|up|upgrade)$/.test(sub)) return subArgs.length ? `${name} ${sub} de pacote` : ''
  return ''
}

function pipRisk(args: string[]): string {
  const sub = args.find((a) => !a.startsWith('-')) ?? ''
  return /^(list|show|freeze|check|--version|tree|run|sync|lock)$/.test(sub) ? '' : `pip ${sub}`.trim()
}

// ---------- segredos ----------

/** Tira tokens, senhas e chaves do texto antes de ele ir para a notificação ou um arquivo. */
export function redactSecrets(text: string): string {
  return (
    text
      // usuário:senha@ em URLs
      .replace(/([a-z][\w+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1***@')
      // chaves com prefixo conhecido
      .replace(/\b(sk-ant-[\w-]{8,}|sk-[\w-]{16,}|gh[posur]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{16,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|npm_[A-Za-z0-9]{30,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/g, '***')
      // Authorization: Bearer xyz
      .replace(/\b(bearer|basic)\s+[\w.~+/=-]{8,}/gi, '$1 ***')
      // VAR_COM_TOKEN=valor
      .replace(/\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|AUTH|CREDENTIALS?)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, '$1=***')
      // --password x, --token=x, -H "x-api-key: y"
      .replace(/(--?(?:password|passwd|token|api[-_]?key|secret|auth|access[-_]?key)\b)(=|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1$2***')
      .replace(/\b((?:x-)?(?:api[-_]?key|auth[-_]?token|access[-_]?token|authorization)\s*:\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi, '$1***')
      // tiras longas e opacas (chaves sem prefixo, base64)
      // (sem / nem _ para não pegar caminhos e nomes longos; hashes do git, só minúsculas, passam)
      .replace(/[A-Za-z0-9+=]{32,}/g, (m) => (/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m) ? '***' : m))
  )
}

/** Uma linha, no máximo `max` caracteres. */
export function clipLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

/** "…/src/main/index.ts" */
function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p
}
