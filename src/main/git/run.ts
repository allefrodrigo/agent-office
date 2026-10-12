import { execFile } from 'node:child_process'

/**
 * How the office runs git and gh: execFile with an argument array (never a shell),
 * a clean environment, the safe config, filters off, a timeout and an output cap.
 */

/** Any other git output (status, numstat…) past this fails instead of filling memory. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
export const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/

interface GitOptions {
  /** Exit codes that are not failures (git diff --no-index exits 1 when files differ). */
  ok?: number[]
  timeout?: number
  /** Written to stdin; stdin is always closed so nothing waits for input. */
  input?: string
  /** Output cap in bytes. */
  maxBytes?: number
  /** Past maxBytes, keep what came instead of failing (the caller says it was cut). */
  cut?: boolean
  /** Extra `-c key=value` pairs, after the safe ones (push adds its credential helper). */
  config?: [string, string][]
}

class GitError extends Error {}

/** Result of a capped run: `cut` = the output hit the cap and was stopped there. */
interface Output {
  out: Buffer
  cut: boolean
}

/**
 * The environment git and gh run with: the app's, minus every GIT_* it inherited (a
 * GIT_DIR or GIT_CONFIG_* from outside could point git anywhere), no system config,
 * never a prompt, never a pager.
 */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1', ...extra }
}

function runFile(cmd: string, args: string[], cwd: string, opts: GitOptions, env: NodeJS.ProcessEnv = cleanEnv()): Promise<Output> {
  return new Promise((done, fail) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd,
        timeout: opts.timeout ?? 30_000,
        maxBuffer: opts.maxBytes ?? MAX_OUTPUT_BYTES,
        windowsHide: true,
        encoding: 'buffer',
        env,
      },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? -1 : 0
        if (!err || opts.ok?.includes(code)) return done({ out: stdout, cut: false })
        if (opts.cut && (err as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return done({ out: stdout, cut: true })
        const msg = String(stderr ?? '').trim() || err.message
        fail(new GitError(msg.split('\n').slice(0, 6).join('\n')))
      },
    )
    child.stdin?.end(opts.input ?? '')
  })
}

/**
 * Config that keeps a repo (its .git/config, an included file, the player's global
 * config) from making git run a program: no fsmonitor, hooks, pager, editor, external
 * diff, askpass, credential helper, `ext::` remotes or local `file://` remotes (whose
 * receive-pack would run here), and the stock signing and ssh programs. Diff commands
 * also get --no-ext-diff --no-textconv.
 */
const SAFE_CONFIG: [string, string][] = [
  ['core.quotepath', 'off'],
  ['core.fsmonitor', 'false'],
  ['core.hooksPath', process.platform === 'win32' ? 'NUL' : '/dev/null'],
  ['core.pager', 'cat'],
  ['core.editor', 'true'],
  ['sequence.editor', 'true'],
  ['core.sshCommand', 'ssh'],
  ['core.askPass', ''],
  ['credential.helper', ''],
  ['diff.external', ''],
  ['protocol.ext.allow', 'never'],
  ['protocol.file.allow', 'never'],
  ['gpg.program', 'gpg'],
  ['gpg.ssh.program', 'ssh-keygen'],
  ['gpg.x509.program', 'gpgsm'],
  ['core.alternateRefsCommand', ''],
]

/**
 * clean/smudge/process filters of .gitattributes run programs on status, add, diff and
 * checkout. Every driver configured for the repo is switched off here: the office reads
 * and restores the bytes on disk as they are. Cached for a few seconds per folder.
 */
const filterCache = new Map<string, { at: number; pairs: [string, string][] }>()
async function filterOff(cwd: string): Promise<[string, string][]> {
  const hit = filterCache.get(cwd)
  if (hit && Date.now() - hit.at < 5000) return hit.pairs
  let names: string[] = []
  try {
    const raw = (await runFile('git', ['config', '--name-only', '--get-regexp', '^filter\\.'], cwd, { ok: [1] })).out.toString('utf8')
    names = [...new Set(raw.split('\n').map((k) => /^filter\.(.+)\.(clean|smudge|process|required)$/i.exec(k.trim())?.[1]).filter((n): n is string => !!n))]
  } catch {
    // not a repo: nothing to switch off
  }
  const pairs = names.flatMap((n): [string, string][] => [
    [`filter.${n}.clean`, ''],
    [`filter.${n}.smudge`, ''],
    [`filter.${n}.process`, ''],
    [`filter.${n}.required`, 'false'],
  ])
  filterCache.set(cwd, { at: Date.now(), pairs })
  return pairs
}

const DIFF_COMMANDS = new Set(['diff', 'show', 'log'])

/**
 * The one way the office runs git: argument array (never a shell), the safe config,
 * filters off, a clean environment, a timeout and an output cap. Diff commands get
 * --no-ext-diff --no-textconv --no-color.
 */
export async function runGit(cwd: string, args: string[], opts: GitOptions = {}): Promise<Output> {
  const config = [...SAFE_CONFIG, ...(await filterOff(cwd)), ...(opts.config ?? [])]
  const [cmd, ...rest] = args
  const diffFlags = DIFF_COMMANDS.has(cmd) ? ['--no-ext-diff', '--no-textconv', '--no-color'] : []
  return runFile('git', [...config.flatMap(([k, v]) => ['-c', `${k}=${v}`]), cmd, ...diffFlags, ...rest], cwd, opts)
}

/** The same safe config as GIT_CONFIG_* variables, for programs that call git themselves (gh). */
export async function safeGitEnv(cwd: string): Promise<NodeJS.ProcessEnv> {
  const pairs = [...SAFE_CONFIG, ...(await filterOff(cwd))]
  const vars: Record<string, string> = { GIT_CONFIG_COUNT: String(pairs.length) }
  pairs.forEach(([k, v], i) => {
    vars[`GIT_CONFIG_KEY_${i}`] = k
    vars[`GIT_CONFIG_VALUE_${i}`] = v
  })
  return cleanEnv(vars)
}

export const run = async (cmd: string, args: string[], cwd: string, opts: GitOptions = {}, env?: NodeJS.ProcessEnv) =>
  (await runFile(cmd, args, cwd, opts, env)).out.toString('utf8')
export const git = async (cwd: string, args: string[], opts?: GitOptions) => (await runGit(cwd, args, opts)).out.toString('utf8')
/** Raw bytes of a blob (binary files survive "Descartar"). */
export const blobBytes = async (cwd: string, blob: string) => (await runGit(cwd, ['cat-file', 'blob', blob])).out


/** NUL-separated output, without the trailing empty item. */
export const zsplit = (s: string) => s.split('\0').filter(Boolean)

/** Runs `args + paths` in chunks so a long file list never hits the argv limit. */
export async function chunked(cwd: string, args: string[], paths: string[], size = 100): Promise<string> {
  let out = ''
  for (let i = 0; i < paths.length; i += size) out += await git(cwd, [...args, '--', ...paths.slice(i, i + size)])
  return out
}
