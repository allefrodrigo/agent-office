import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { PermissionRequest } from './types'

// Notificação do sistema para pedidos de permissão (AO-35). Tudo aqui é puro (sem
// Electron) para testar com `npm test`: o main só monta a Notification.
//
// O botão "Permitir" na notificação pula o cartão, onde o pedido aparece inteiro. Por isso
// ele é uma LISTA PERMITIDA, pequena e explícita, e não uma lista de bloqueio: listas de
// bloqueio de shell são contornáveis (\rm, command rm, $(...), aspas partindo palavras,
// eval, sh -c, aliases, unicode…), e qualquer parser nosso difere do shell de verdade.
// Só ganham o botão:
// - Read/Edit/MultiEdit/Write/NotebookEdit/Glob/Grep cujo caminho resolvido fica dentro
//   da pasta do agente e não é sensível (.env, .git/, chaves…); escrita também não vale
//   para arquivos que viram código executado (package.json, Makefile, *.sh, .vscode/…);
// - comandos Bash de leitura de uma lista fixa, escritos só com letras, números, espaço,
//   ponto, barra, hífen e sublinhado (nenhum metacaractere de shell), que casam
//   exatamente com o padrão.
// Todo o resto, inclusive o que não dá para analisar, fica sem botão: só abre o app.

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

export interface NoticeScope {
  /** Pasta do agente (absoluta). Sem ela, nada de arquivo ganha botão. */
  cwd?: string
  /**
   * Caminho real (symlinks resolvidos) de um caminho absoluto já normalizado. O main passa
   * fs.realpath; sem ele, vale o caminho normalizado.
   */
  realpath?: (p: string) => string
}

const NOTICE_BODY_MAX = 140

/** Monta a notificação de um pedido. `platform` é process.platform. */
export function permissionNotice(req: NoticeInput, agentName: string, platform: string, scope: NoticeScope = {}): PermissionNotice {
  const title = `${agentName} está indo até você`
  const summary = clipLine(redactSecrets(noticeSummary(req)), NOTICE_BODY_MAX)
  const body = req.context ? clipLine(`${redactSecrets(req.context)} · ${summary}`, NOTICE_BODY_MAX + 40) : summary
  // Ações em toast no Windows pedem um ativador COM registrado: lá (e no Linux) só o clique.
  if (platform !== 'darwin') return { title, body, allow: false, reply: false, why: 'só no Mac' }
  if (req.kind === 'question') return { title, body, allow: false, reply: false, why: 'pergunta: responda no app' }
  if (req.kind === 'plan') return { title, body, allow: false, reply: true, why: 'plano: leia no app' }
  const why = toolRisk(req.toolName, req.input, scope)
  return { title, body: why ? `${body}\nAbra o app para decidir (${why}).` : body, allow: !why, reply: true, why }
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
  Glob: 'Procurar em',
  Grep: 'Buscar em',
}

/** Ferramentas que escrevem: além de dentro da pasta, o arquivo não pode virar código executado. */
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

/** Ferramentas de arquivo: o caminho (obrigatório) precisa ficar dentro da pasta do agente. */
const FILE_TOOLS: Record<string, 'file_path' | 'notebook_path'> = {
  Read: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}

/** Motivo para NÃO pôr o botão "Permitir", ou '' quando pode. */
export function toolRisk(tool: string, input: Record<string, unknown> = {}, scope: NoticeScope = {}): string {
  if (tool === 'Bash') return commandRisk(typeof input.command === 'string' ? input.command : '', scope)
  const key = FILE_TOOLS[tool]
  if (key) {
    const r = resolveInScope(input[key], scope)
    if (r.why) return r.why
    return WRITE_TOOLS.has(tool) ? writeRisk(r.rels) : ''
  }
  // Grep lê o conteúdo dos arquivos (inclusive ocultos, como .env): só pelo app.
  if (tool === 'Grep') return 'busca no conteúdo dos arquivos'
  if (tool === 'Glob') {
    // Sem path = a pasta do agente. O padrão do Glob não pode subir de pasta.
    if (input.path !== undefined && input.path !== null) {
      const why = pathRisk(input.path, scope)
      if (why) return why
    } else if (!scope.cwd) return 'sem a pasta do agente'
    for (const k of ['pattern', 'glob'] as const) {
      const v = input[k]
      if (v === undefined) continue
      if (typeof v !== 'string') return 'padrão estranho'
      if (v.startsWith('/') || v.startsWith('~') || v.split('/').includes('..')) return 'padrão fora da pasta'
      if (sensitivePath(v)) return 'arquivo sensível'
    }
    return ''
  }
  return 'fora da lista que dá para permitir pela notificação'
}

/** O caminho, resolvido, fica dentro da pasta do agente e não é sensível? */
export function pathRisk(raw: unknown, scope: NoticeScope): string {
  return resolveInScope(raw, scope).why
}

interface Resolved {
  why: string
  /** Caminho dentro da pasta, pelo pedido e pelo real: ['src/a.ts', 'src/a.ts']. */
  rels: string[]
}

/**
 * Confere e resolve um caminho de ferramenta de arquivo. Recusa: relativo, ~, \, caractere
 * de controle, segmento vazio, "." ou ".." (nada de normalizar: o que chega é o que vale);
 * fora da pasta pelo caminho pedido ou pelo real (symlinks, também no meio do caminho de um
 * arquivo novo); arquivo sensível. A pasta compara com "/" no fim (/proj ≠ /proj-evil).
 * Qualquer passo que falha deixa sem botão.
 */
function resolveInScope(raw: unknown, scope: NoticeScope): Resolved {
  const no = (why: string): Resolved => ({ why, rels: [] })
  if (typeof raw !== 'string' || !raw) return no('sem arquivo')
  if (!scope.cwd) return no('sem a pasta do agente')
  if (!strictAbsolute(raw)) return no('caminho estranho')
  const cwd = normalizePath(scope.cwd)
  if (!cwd || cwd === '/') return no('caminho estranho')
  let realCwd = cwd
  let realFile = raw
  if (scope.realpath) {
    try {
      realCwd = scope.realpath(cwd)
      realFile = scope.realpath(raw)
    } catch {
      return no('caminho que não deu para resolver')
    }
    if (!strictAbsolute(realCwd) || !strictAbsolute(realFile)) return no('caminho que não deu para resolver')
  }
  if (!strictlyInside(raw, cwd) || !strictlyInside(realFile, realCwd)) return no('fora da pasta do agente')
  if (sensitivePath(raw) || sensitivePath(realFile)) return no('arquivo sensível')
  return { why: '', rels: [raw.slice(cwd.length + 1), realFile.slice(realCwd.length + 1)] }
}

/** "/a/b": absoluto POSIX, sem segmento vazio, ".", ".." nem caracteres estranhos. */
function strictAbsolute(p: string): boolean {
  if (!p.startsWith('/') || p.length > 4096 || /[\\\0-\x1f\x7f]/.test(p)) return false // eslint-disable-line no-control-regex
  if (p === '/') return true
  return p
    .slice(1)
    .split('/')
    .every((s) => s && s !== '.' && s !== '..')
}

/** `file` fica abaixo de `dir` (não é a própria pasta). */
const strictlyInside = (file: string, dir: string) => file.length > dir.length + 1 && file.startsWith(dir.endsWith('/') ? dir : dir + '/')

/** "/a/./b/../c" → "/a/c"; '' quando sobe acima da raiz. */
export function normalizePath(p: string): string {
  if (!p.startsWith('/')) return ''
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!out.length) return ''
      out.pop()
    } else out.push(part)
  }
  return '/' + out.join('/')
}

/**
 * Caminho real com symlinks resolvidos, para o main passar em NoticeScope.realpath. Arquivo
 * que ainda não existe: realpath da pasta existente mais próxima + o resto. Um componente que
 * existe como link (inclusive link quebrado) passa pelo realpath, que falha se o alvo não
 * existir: assim um link quebrado para fora nunca vira "arquivo novo dentro da pasta".
 */
export function realPathOf(p: string): string {
  if (!strictAbsolute(p)) throw new Error('caminho estranho')
  let head = p
  const tail: string[] = []
  for (;;) {
    let exists = true
    try {
      lstatSync(head)
    } catch {
      exists = false
    }
    if (exists || head === '/') break
    tail.unshift(basename(head))
    head = dirname(head)
  }
  const real = realpathSync(head)
  return tail.length ? `${real === '/' ? '' : real}/${tail.join('/')}` : real
}

/**
 * Escrita só ganha botão numa LISTA PERMITIDA: nenhum segmento começando com "." (.git,
 * .github, .vscode, .husky, .envrc, .npmrc…), extensão de código ou texto da lista, e nome
 * fora da lista de arquivos que algo roda sozinho ou que mudam o que comandos executam
 * (package.json, *.config.*, Makefile, *.sh…). Sem extensão, sem botão. Vale para o caminho
 * pedido e para o real.
 */
export function writeRisk(rels: string[]): string {
  if (!rels.length) return 'caminho estranho'
  for (const rel of rels) {
    const parts = rel.split('/')
    if (parts.some((s) => !s || s.startsWith('.'))) return 'arquivo ou pasta oculta'
    if (parts.slice(0, -1).some((d) => EXEC_DIRS.test(d))) return 'pasta de scripts'
    const name = parts[parts.length - 1]
    const dot = name.lastIndexOf('.')
    if (dot <= 0 || !WRITE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) return 'tipo de arquivo fora da lista'
    if (EXEC_FILES.some((re) => re.test(name))) return 'arquivo que roda código'
  }
  return ''
}

/** Extensões de código e texto que dá para escrever pela notificação. */
const WRITE_EXTENSIONS = new Set(
  'ts tsx js jsx mjs cjs css scss sass less html htm md mdx txt json yml yaml svg py go rs java kt swift c h cc cpp hpp rb php sql vue svelte ipynb csv'.split(' '),
)

/** Pastas de scripts e dependências (pasta oculta já fica de fora pela regra do ponto). */
const EXEC_DIRS = /^(node_modules|bin|scripts?|hooks?|vendor)$/i

/** Nomes de arquivo (sem a pasta), sem diferenciar maiúsculas. */
const EXEC_FILES: readonly RegExp[] = [
  // instruções que outros agentes seguem
  /^(claude|claude\.local|agents|gemini|copilot-instructions)\.md$/i,
  // npm, yarn, pnpm, bun, node
  /^(package|package-lock|npm-shrinkwrap|deno|bower|composer)\.jsonc?$/i,
  /^(yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml|bun\.lockb?|bunfig\.toml|composer\.lock)$/i,
  /^\.(npmrc|yarnrc(\.yml)?|pnpmfile\.cjs|nvmrc|node-version)$/i,
  // make e sistemas de build
  /^(gnu)?makefile$/i,
  /\.mk$/i,
  /^(justfile|taskfile\.ya?ml|rakefile|gemfile(\.lock)?|procfile|cmakelists\.txt|meson\.build|pom\.xml|build\.rs|cargo\.toml|go\.mod|build\.xml|vagrantfile|brewfile)$/i,
  /^(build|settings)\.(gradle|sbt)(\.kts)?$/i,
  /^gradlew(\.bat)?$/i,
  // python
  /^(setup\.(py|cfg)|pyproject\.toml|tox\.ini|noxfile\.py|conftest\.py|manage\.py|pipfile(\.lock)?)$/i,
  /^requirements.*\.txt$/i,
  // containers e ambiente
  /^dockerfile/i,
  /\.dockerfile$/i,
  /^(docker-)?compose.*\.ya?ml$/i,
  /^\.(envrc|tool-versions|mise\.toml|editorconfig|mcp\.json|gitlab-ci\.ya?ml|travis\.yml|pre-commit-config\.ya?ml)$/i,
  /^(flake|shell|default)\.nix$/i,
  // git (.gitattributes roda filtros, .gitmodules busca código) e hooks
  /^\.git/i,
  /^\.?lefthook/i,
  // configs de ferramentas JS/TS: rodam como código ao chamar a ferramenta
  /^[tj]sconfig.*\.json$/i,
  /\.config\./i,
  /\.conf\.json$/i,
  /rc\.[cm]?[jt]s$/i,
  // configs que guardam comandos (build, deploy, CI, tarefas)
  /^(nx|project|workspace|turbo|lerna|angular|firebase|vercel|now|app|electron-builder|tauri\.conf)\.jsonc?$/i,
  /^(electron-builder|mkdocs|serverless|skaffold|devfile|codemagic|bitbucket-pipelines|azure-pipelines|cloudbuild|appveyor|buildspec|netlify|render|fly|railway|app|lefthook|taskfile|melos|pubspec)\.ya?ml$/i,
  /^(sitecustomize|usercustomize)\.py$/i,
  /\.(plist|lock)$/i,
  /^\.[a-z0-9-]+rc(\.json|\.ya?ml|\.toml)?$/i,
  /^(babel\.config|gulpfile|gruntfile|jakefile)/i,
  // scripts
  /\.(sh|bash|zsh|fish|ksh|csh|command|ps1|psm1|bat|cmd|vbs|applescript|scpt)$/i,
]


// ---------- comandos ----------

/**
 * Só letras e números ASCII, espaço, ponto, barra, hífen e sublinhado. Fica de fora todo
 * metacaractere de shell (; & | ` $ ( ) < > \ aspas * ? ~ { } [ ] # ! = e quebra de linha),
 * e também unicode (letras parecidas, espaços invisíveis).
 */
const COMMAND_CHARS = /^[A-Za-z0-9 ._/-]+$/

/** Caminho relativo à pasta do agente: sem / no começo, sem .., sem começar com hífen. */
const REL_PATH = /^(?![-/])[A-Za-z0-9._/-]+$/

interface CommandSpec {
  /** Palavras fixas do começo. */
  cmd: string[]
  /** Opções aceitas, uma por palavra. */
  flags?: RegExp
  /** Aceita números soltos (head -n 20). */
  numbers?: boolean
  /** Aceita caminhos relativos. */
  paths?: boolean
  /** Aceita uma referência do git (HEAD ou hash). */
  refs?: boolean
}

/** A lista inteira do que o Bash pode ter "Permitir" na notificação. */
export const ALLOWED_COMMANDS: readonly CommandSpec[] = [
  { cmd: ['pwd'] },
  { cmd: ['ls'], flags: /^-[1aAlhtrRSF]+$/, paths: true },
  { cmd: ['cat'], paths: true },
  { cmd: ['head'], flags: /^-(n|\d+)$/, numbers: true, paths: true },
  { cmd: ['tail'], flags: /^-(n|\d+)$/, numbers: true, paths: true },
  { cmd: ['wc'], flags: /^-[lwcm]+$/, paths: true },
  // Sem git nem npm: git roda filtros, textconv e fsmonitor do repo, e npm roda scripts do
  // package.json — o agente pode ter editado qualquer um deles. Esses pedidos abrem o app.
]

/**
 * Motivo para o comando NÃO ganhar "Permitir" na notificação, ou '' quando pode: o
 * comando inteiro casa exatamente com um padrão de ALLOWED_COMMANDS. Caminhos nos
 * argumentos só valem com a pasta do agente em `scope`.
 */
export function commandRisk(command: string, scope: NoticeScope = {}): string {
  if (!command) return 'comando vazio'
  if (command.length > 200) return 'comando longo'
  if (!COMMAND_CHARS.test(command)) return 'tem caracteres de shell'
  const words = command.split(' ')
  if (words.some((w) => !w)) return 'espaços estranhos'
  return ALLOWED_COMMANDS.some((spec) => matches(spec, words, scope)) ? '' : 'fora da lista de comandos de leitura'
}

function matches(spec: CommandSpec, words: string[], scope: NoticeScope): boolean {
  if (words.length < spec.cmd.length || spec.cmd.some((w, i) => words[i] !== w)) return false
  let refs = 0
  for (const w of words.slice(spec.cmd.length)) {
    if (spec.flags?.test(w)) continue
    if (spec.numbers && /^\d{1,6}$/.test(w)) continue
    if (spec.refs && refs === 0 && /^(HEAD|[0-9a-f]{7,40})$/.test(w)) {
      refs++
      continue
    }
    // Caminho relativo à pasta do agente, e que continua lá dentro depois dos symlinks.
    // Nada absoluto (`ls /`, `cat /tmp/x`): `${cwd}/${w}` normalizaria para dentro da pasta.
    if (spec.paths && !w.startsWith('/') && REL_PATH.test(w) && !w.split('/').includes('..') && !sensitivePath(w) && scope.cwd && !pathRisk(`${scope.cwd}/${w}`, scope)) continue
    return false
  }
  return true
}

const SENSITIVE_WORDS = /(^|[\s"'=/~])(\.env\b|\.ssh\b|\.aws\b|\.gnupg\b|\.netrc\b|\.npmrc\b|\.pypirc\b|\.git-credentials\b|\.kube\b|id_rsa|id_ed25519|\.pem\b|\.p12\b|keychain|credentials)/i

/** Arquivos de configuração, chaves e pastas do sistema. */
export function sensitivePath(p: string): boolean {
  if (SENSITIVE_WORDS.test(p)) return true
  const s = p.replace(/\\/g, '/')
  if (/(^|\/)\.git(\/|$)/.test(s)) return true
  if (/(^|\/)\.claude\/(settings[^/]*\.json|hooks(\/|$))/.test(s)) return true
  if (/(^|\/)\.(github|husky)\//.test(s)) return true
  if (/\.(pem|p12|pfx|key|keystore|jks)$/i.test(s)) return true
  // (fora da pasta do agente já não passa; isto pega um agente aberto numa pasta do sistema)
  if (/^(\/etc|\/usr|\/bin|\/sbin|\/System|\/Library)(\/|$)/i.test(s)) return true
  if (/\/Library\/(LaunchAgents|LaunchDaemons|Keychains)(\/|$)/.test(s)) return true
  // dotfiles na raiz da casa: ~/.zshrc, /Users/x/.bashrc, ~/.gitconfig…
  if (/^(~|\/Users\/[^/]+|\/home\/[^/]+)\/\.[^/]+$/.test(s)) return true
  return false
}

// ---------- segredos ----------

/** Tira tokens, senhas e chaves do texto antes de ele ir para a notificação. */
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
      // --password x, --token=x
      .replace(/(--?(?:password|passwd|token|api[-_]?key|secret|auth|access[-_]?key)\b)(=|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1$2***')
      // -H "x-api-key: y"
      .replace(/\b((?:x-)?(?:api[-_]?key|auth[-_]?token|access[-_]?token|authorization)\s*:\s*)("[^"]*"|'[^']*'|[^\s"']+)/gi, '$1***')
      // tiras longas e opacas (sem / nem _ para não pegar caminhos; hashes do git, só minúsculas, passam)
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
