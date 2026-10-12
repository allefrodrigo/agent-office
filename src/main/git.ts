import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ChangedFile, ResultChanges, WorktreeInfo } from '@shared/types'

/**
 * Everything the office does with git: per-agent worktrees (AO-33) and the files an
 * agent changed during a task (AO-34). Every call is execFile with an argument array,
 * never a shell string, and every path that comes back from the renderer is checked
 * against the repo root before git or the disk sees it.
 */

/** Where agent worktrees live, inside the repo (kept out of git by .git/info/exclude). */
export const WORKTREES_DIR = join('.agent-office', 'worktrees')
/** git's well-known empty blob: the "other side" of an added or deleted file. */
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
/** More than this and the card says "and N more": the list is for reading, not auditing. */
const MAX_FILES = 300
/** Dirty files bigger than this are not copied into the snapshot (they can't be restored). */
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
/** Diffs bigger than this are cut. */
const MAX_DIFF_CHARS = 300_000
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/

interface GitOptions {
  /** Exit codes that are not failures (git diff --no-index exits 1 when files differ). */
  ok?: number[]
  timeout?: number
  /** Written to stdin; stdin is always closed so nothing waits for input. */
  input?: string
}

class GitError extends Error {}

function runFile(cmd: string, args: string[], cwd: string, opts: GitOptions): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd,
        timeout: opts.timeout ?? 30_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: 'buffer',
        // Never wait for a password prompt nobody can see.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1' },
      },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? -1 : 0
        if (!err || opts.ok?.includes(code)) return done(stdout)
        const msg = String(stderr ?? '').trim() || err.message
        fail(new GitError(msg.split('\n').slice(0, 6).join('\n')))
      },
    )
    child.stdin?.end(opts.input ?? '')
  })
}

const run = async (cmd: string, args: string[], cwd: string, opts: GitOptions = {}) => (await runFile(cmd, args, cwd, opts)).toString('utf8')
const git = (cwd: string, args: string[], opts?: GitOptions) => run('git', ['-c', 'core.quotepath=off', ...args], cwd, opts)
/** Raw bytes of a blob (binary files survive "Descartar"). */
const blobBytes = (cwd: string, blob: string) => runFile('git', ['cat-file', 'blob', blob], cwd, {})

/** The empty blob, written once per repo so diffs of added and deleted files find it. */
async function emptyBlob(root: string): Promise<string> {
  return (await git(root, ['hash-object', '-w', '--stdin'], { input: '' })).trim() || EMPTY_BLOB
}

/** +/- of a blob-to-blob diff (`--numstat` prints the counts first, then the two ids). */
async function blobStat(root: string, a: string, b: string): Promise<{ added: number; removed: number; binary: boolean }> {
  const m = /^(-|\d+)\t(-|\d+)\t/.exec(await git(root, ['diff', '--numstat', a, b]))
  if (!m) return { added: 0, removed: 0, binary: false }
  const binary = m[1] === '-'
  return { added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary }
}

/** NUL-separated output, without the trailing empty item. */
const zsplit = (s: string) => s.split('\0').filter(Boolean)

/** Runs `args + paths` in chunks so a long file list never hits the argv limit. */
async function chunked(cwd: string, args: string[], paths: string[], size = 100): Promise<string> {
  let out = ''
  for (let i = 0; i < paths.length; i += size) out += await git(cwd, [...args, '--', ...paths.slice(i, i + size)])
  return out
}

// ---------- repos ----------

/** Top folder of the repo holding `cwd`, or null when it is not in one (or git is missing). */
export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    const out = (await git(cwd, ['rev-parse', '--show-toplevel'], { timeout: 5000 })).trim()
    return out && isAbsolute(out) ? out : null
  } catch {
    return null
  }
}

async function headOf(cwd: string): Promise<string | null> {
  try {
    const out = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])).trim()
    return SHA_RE.test(out) ? out : null
  } catch {
    return null
  }
}

/** `p` (relative to `root`) stays inside it, also after following symlinks of the folders. */
export function insideRoot(root: string, p: string): string | null {
  if (typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0')) return null
  const abs = resolve(root, p)
  const rel = relative(root, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  // A folder on the way may be a symlink out of the repo.
  try {
    let dir = dirname(abs)
    while (!existsSync(dir)) dir = dirname(dir)
    const real = realpathSync(dir)
    const realRoot = realpathSync(root)
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null
  } catch {
    return null
  }
  return abs
}

// ---------- worktrees (AO-33) ----------

/** "Ada Lovelace" -> "ada-lovelace": safe as a folder name and as part of a branch. */
export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return s || 'agente'
}

/** A branch name git accepts, under agent/. */
export function validBranch(b: unknown): b is string {
  return typeof b === 'string' && /^agent\/[a-z0-9][a-z0-9-]{0,60}$/.test(b) && !b.includes('--') && !b.endsWith('-')
}

/** Adds `/.agent-office/` to the repo's local exclude file, so worktrees never show up in `git status`. */
function excludeOfficeDir(repo: string, commonDir: string): void {
  const file = join(isAbsolute(commonDir) ? commonDir : join(repo, commonDir), 'info', 'exclude')
  const line = '/.agent-office/'
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split(/\r?\n/).includes(line)) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}# Agent Office: cópias isoladas dos agentes\n${line}\n`)
}

/**
 * A worktree for a new agent: `<repo>/.agent-office/worktrees/<slug>-<id>` on a new
 * branch `agent/<slug>-<id>` from the current HEAD. Null when `cwd` is not in a git
 * repo (the agent works in the folder, as before). Throws when it is a repo but the
 * worktree can't be made (no commit yet, git too old…).
 */
export async function createWorktree(cwd: string, name: string, id: string): Promise<WorktreeInfo | null> {
  const repo = await repoRoot(cwd)
  if (!repo) return null
  const base = await headOf(repo)
  if (!base) throw new Error('o repositório ainda não tem nenhum commit')
  const slug = `${slugify(name)}-${id.replace(/[^0-9a-f]/gi, '').slice(0, 8).toLowerCase()}`
  const branch = `agent/${slug}`
  if (!validBranch(branch)) throw new Error(`nome de branch inválido: ${branch}`)
  await git(repo, ['check-ref-format', '--branch', branch])
  const root = join(repo, WORKTREES_DIR, slug)
  if (existsSync(root)) throw new Error(`a pasta ${root} já existe`)
  excludeOfficeDir(repo, (await git(repo, ['rev-parse', '--git-common-dir'])).trim())
  mkdirSync(dirname(root), { recursive: true })
  await git(repo, ['worktree', 'add', '-b', branch, root, base], { timeout: 120_000 })
  // Started in a subfolder of the repo: work in the same subfolder of the copy.
  const sub = relative(repo, cwd)
  const path = sub && !sub.startsWith('..') ? join(root, sub) : root
  return { path, root, repo, branch, base }
}

/**
 * A session resumed from the resume center that ran inside an agent worktree:
 * rebuilds its WorktreeInfo, so the agent goes back to the project's floor.
 */
export async function worktreeFromPath(cwd: string): Promise<{ cwd: string; worktree: WorktreeInfo } | null> {
  const marker = `${sep}${WORKTREES_DIR}${sep}`
  const at = cwd.indexOf(marker)
  if (at < 0) return null
  const repo = cwd.slice(0, at)
  const slug = cwd.slice(at + marker.length).split(sep)[0]
  const root = join(repo, WORKTREES_DIR, slug)
  if (!existsSync(root)) return null
  try {
    const branch = (await git(root, ['branch', '--show-current'])).trim()
    if (!validBranch(branch)) return null
    const repoHead = await headOf(repo)
    const base = repoHead ? (await git(root, ['merge-base', 'HEAD', repoHead])).trim() : ''
    const sub = relative(root, cwd)
    return { cwd: sub ? join(repo, sub) : repo, worktree: { path: cwd, root, repo, branch, base: SHA_RE.test(base) ? base : (await headOf(root)) ?? '' } }
  } catch {
    return null
  }
}

/** The stored worktree really is one of ours: under <repo>/.agent-office/worktrees, with an agent/ branch. */
function checkWorktree(wt: WorktreeInfo): void {
  const rel = relative(join(wt.repo, WORKTREES_DIR), wt.root)
  if (!isAbsolute(wt.repo) || !rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep) || !validBranch(wt.branch)) {
    throw new Error('Essa cópia isolada não está onde o Agent Office cria as suas.')
  }
}

export interface WorktreeState {
  exists: boolean
  /** Files with uncommitted changes (tracked or not). */
  dirty: number
  /** Commits on the branch since it was made. */
  ahead: number
}

export async function worktreeState(wt: WorktreeInfo): Promise<WorktreeState> {
  checkWorktree(wt)
  if (!existsSync(wt.root)) return { exists: false, dirty: 0, ahead: 0 }
  const status = await git(wt.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const dirty = zsplit(status).filter((e) => e.length > 3).length
  let ahead = 0
  if (SHA_RE.test(wt.base)) ahead = Number((await git(wt.root, ['rev-list', '--count', `${wt.base}..HEAD`])).trim()) || 0
  return { exists: true, dirty, ahead }
}

/**
 * Removes the worktree. `force` only after the player confirmed losing the uncommitted
 * changes. The branch goes too when it has no commits of its own; otherwise it stays,
 * so no committed work is ever lost. Returns a line for the toast.
 */
export async function removeWorktree(wt: WorktreeInfo, force: boolean): Promise<string> {
  checkWorktree(wt)
  const st = await worktreeState(wt)
  if (st.exists) {
    if (st.dirty && !force) return `A cópia de ${wt.branch} tem mudanças novas e ficou em ${wt.root}.`
    await git(wt.repo, ['worktree', 'remove', ...(force ? ['--force'] : []), wt.root], { timeout: 60_000 })
  }
  await git(wt.repo, ['worktree', 'prune']).catch(() => '')
  if (st.ahead) return `Cópia removida. O branch ${wt.branch} ficou, com ${st.ahead} commit${st.ahead > 1 ? 's' : ''}.`
  await git(wt.repo, ['branch', '-D', wt.branch]).catch(() => '')
  return `Cópia e branch ${wt.branch} removidos.`
}

/** Forgets worktrees whose folder is gone (`git worktree prune`), in every repo given. */
export async function pruneWorktrees(folders: string[]): Promise<void> {
  const repos = new Set<string>()
  for (const f of folders) {
    if (!f || !existsSync(f)) continue
    const r = await repoRoot(f)
    if (r) repos.add(r)
  }
  await Promise.all([...repos].map((r) => git(r, ['worktree', 'prune']).catch(() => '')))
}

// ---------- what a task changed (AO-34) ----------

/**
 * State of the folder when a task starts: HEAD, and a copy (blob in the repo's object
 * store) of every file that already had changes, so "Descartar" can put the player's
 * own edits back instead of wiping them.
 */
export interface Snapshot {
  root: string
  head: string | null
  /** path -> blob of its content at the start; null = it did not exist; 'unknown' = too big to copy. */
  dirty: Record<string, string | null>
  partial?: boolean
}

const UNKNOWN = 'unknown'

/** Null when `cwd` is not in a git repo. */
export async function takeSnapshot(cwd: string): Promise<Snapshot | null> {
  const root = await repoRoot(cwd)
  if (!root) return null
  const head = await headOf(root)
  const status = zsplit(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']))
  const dirty: Record<string, string | null> = {}
  const toHash: string[] = []
  let partial = false
  for (const entry of status) {
    const path = entry.slice(3)
    if (!path) continue
    if (Object.keys(dirty).length >= MAX_FILES) {
      partial = true
      break
    }
    const abs = join(root, path)
    let st
    try {
      st = lstatSync(abs)
    } catch {
      dirty[path] = null
      continue
    }
    if (!st.isFile() || st.size > MAX_SNAPSHOT_BYTES) dirty[path] = UNKNOWN
    else toHash.push(path)
  }
  if (toHash.length) {
    const hashes = (await chunked(root, ['hash-object', '-w'], toHash)).trim().split('\n')
    toHash.forEach((p, i) => (dirty[p] = SHA_RE.test(hashes[i] ?? '') ? hashes[i] : UNKNOWN))
  }
  return { root, head, dirty, ...(partial ? { partial } : {}) }
}

/** Current blob of each path (written to the object store), or null when it is gone. */
async function currentBlobs(root: string, paths: string[], write: boolean): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const present: string[] = []
  for (const p of paths) {
    try {
      if (lstatSync(join(root, p)).isFile()) present.push(p)
      else out.set(p, null)
    } catch {
      out.set(p, null)
    }
  }
  if (present.length) {
    const hashes = (await chunked(root, ['hash-object', ...(write ? ['-w'] : [])], present)).trim().split('\n')
    present.forEach((p, i) => out.set(p, hashes[i] ?? null))
  }
  return out
}

/** "12\t3\tpath" entries of `git diff --numstat -z`. */
function parseNumstat(out: string): Map<string, { added: number; removed: number; binary: boolean }> {
  const map = new Map<string, { added: number; removed: number; binary: boolean }>()
  for (const item of zsplit(out)) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(item)
    if (!m) continue
    const binary = m[1] === '-'
    map.set(m[3], { added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary })
  }
  return map
}

/** Lines of a new file, or binary when it has a NUL byte. */
function countLines(abs: string): { added: number; binary: boolean } {
  try {
    if (statSync(abs).size > 4 * 1024 * 1024) return { added: 0, binary: true }
    const buf = readFileSync(abs)
    if (buf.includes(0)) return { added: 0, binary: true }
    if (!buf.length) return { added: 0, binary: false }
    let n = 0
    for (const b of buf) if (b === 10) n++
    return { added: buf[buf.length - 1] === 10 ? n : n + 1, binary: false }
  } catch {
    return { added: 0, binary: false }
  }
}

/** What changed in the repo since the snapshot, file by file, with line counts. */
export async function changesSince(snap: Snapshot, extra?: { branch?: string }): Promise<ResultChanges> {
  const { root, head } = snap
  const tracked = head ? parseNumstat(await git(root, ['diff', '--numstat', '-z', '--no-renames', head])) : new Map()
  const untracked = new Set(zsplit(await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])))
  // Empty repo at the start: everything staged since then is new too.
  const staged = head ? [] : zsplit(await git(root, ['ls-files', '-z']))
  const inHead = head ? new Set(zsplit(await chunked(root, ['ls-tree', '-r', '-z', '--name-only', head], [...tracked.keys()]))) : new Set<string>()

  const files: ChangedFile[] = []
  // Files that already had changes at the start: compare with the copy taken then.
  const pre = Object.keys(snap.dirty)
  const now = await currentBlobs(root, pre, true)
  const empty = pre.length ? await emptyBlob(root) : EMPTY_BLOB
  for (const path of pre) {
    const start = snap.dirty[path]
    const cur = now.get(path) ?? null
    if (start === cur) continue
    const status: ChangedFile['status'] = start === null ? 'added' : cur === null ? 'deleted' : 'modified'
    if (start === UNKNOWN) {
      files.push({ path, status: cur === null ? 'deleted' : 'modified', added: 0, removed: 0, preexisting: true, restorable: false })
      continue
    }
    const s = await blobStat(root, start ?? empty, cur ?? empty)
    files.push({ path, status, ...s, start, preexisting: true, restorable: true })
  }
  const seen = new Set(pre)
  for (const [path, s] of tracked) {
    if (seen.has(path)) continue
    seen.add(path)
    const gone = !existsSync(join(root, path))
    files.push({ path, status: gone ? 'deleted' : inHead.has(path) ? 'modified' : 'added', ...s, restorable: true })
  }
  for (const path of [...untracked, ...staged]) {
    if (seen.has(path)) continue
    seen.add(path)
    files.push({ path, status: 'added', removed: 0, ...countLines(join(root, path)), restorable: true })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const truncated = files.length > MAX_FILES || !!snap.partial
  return {
    git: true,
    root,
    head: head ?? undefined,
    files: files.slice(0, MAX_FILES),
    ...(truncated ? { truncated, total: files.length } : {}),
    ...(extra?.branch ? { branch: extra.branch } : {}),
  }
}

/** The ChangedFile for `path`, only if the card lists it. */
function listed(c: ResultChanges, path: unknown): ChangedFile {
  const f = typeof path === 'string' ? c.files.find((x) => x.path === path) : undefined
  if (!f || !insideRoot(c.root, f.path)) throw new Error('Esse arquivo não está na lista de mudanças.')
  return f
}

/** Unified diff of one file of the card, from the start of the task to now. */
export async function fileDiff(c: ResultChanges, path: unknown): Promise<string> {
  if (!c.git) throw new Error('Sem git não há diff para mostrar.')
  const f = listed(c, path)
  let out: string
  const exists = existsSync(join(c.root, f.path))
  if (f.start === undefined && c.head && f.status !== 'added') {
    out = await git(c.root, ['diff', '--no-color', '--no-ext-diff', c.head, '--', f.path])
  } else if (f.start === undefined || f.start === null) {
    // New since the start: everything is an added line.
    out = exists ? await git(c.root, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', f.path], { ok: [1] }) : ''
  } else {
    if (!SHA_RE.test(f.start)) return '(o arquivo era grande demais para guardar a versão anterior)'
    const empty = await emptyBlob(c.root)
    const cur = exists ? ((await currentBlobs(c.root, [f.path], true)).get(f.path) ?? empty) : empty
    out = await git(c.root, ['diff', '--no-color', '--no-ext-diff', f.start, cur])
    // Blob diffs are headed by the two ids: show the file name instead.
    out = out.replace(/^(diff --git a\/|--- a\/|\+\+\+ b\/)[0-9a-f]{40}( b\/[0-9a-f]{40})?$/gm, (_m, lead: string, two?: string) => `${lead}${f.path}${two ? ` b/${f.path}` : ''}`)
  }
  if (!out.trim()) return f.binary ? '(arquivo binário)' : '(sem diferenças agora)'
  return out.length > MAX_DIFF_CHARS ? out.slice(0, MAX_DIFF_CHARS) + '\n… (diff cortado)' : out
}

/**
 * Puts every listed file back as it was at the start of the task: files from HEAD come
 * back from HEAD, files the player had already changed get their saved copy, files the
 * task created are deleted. The caller confirms with the player first.
 */
export async function discardChanges(c: ResultChanges): Promise<{ restored: number; skipped: string[] }> {
  if (!c.git) throw new Error('Sem git não dá para desfazer as mudanças.')
  const skipped: string[] = []
  const fromHead: string[] = []
  let restored = 0
  for (const f of c.files) {
    const abs = insideRoot(c.root, f.path)
    if (!abs || !f.restorable) {
      skipped.push(f.path)
      continue
    }
    if (f.start === undefined && f.status !== 'added' && c.head) {
      fromHead.push(f.path)
    } else if (f.start === undefined || f.start === null) {
      // Created by the task: out of the index and off the disk.
      await git(c.root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', f.path]).catch(() => '')
      if (existsSync(abs) && lstatSync(abs).isFile()) unlinkSync(abs)
      restored++
    } else if (SHA_RE.test(f.start)) {
      const content = await blobBytes(c.root, f.start)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
      restored++
    } else skipped.push(f.path)
  }
  if (fromHead.length && c.head) {
    await chunked(c.root, ['checkout', c.head], fromHead)
    restored += fromHead.length
  }
  return { restored, skipped }
}

/** Commits exactly the listed files (not whatever else is staged). Returns the short sha. */
export async function commitChanges(c: ResultChanges, message: string): Promise<string> {
  if (!c.git) throw new Error('Essa pasta não é um repositório git.')
  if (c.truncated) throw new Error('São mudanças demais para commitar daqui. Use o terminal.')
  const paths = c.files.map((f) => f.path).filter((p) => insideRoot(c.root, p))
  if (!paths.length) throw new Error('Não há arquivos para commitar.')
  await chunked(c.root, ['add', '-A'], paths)
  await git(c.root, ['commit', '-m', message, '--', ...paths], { timeout: 120_000 })
  return (await git(c.root, ['rev-parse', '--short', 'HEAD'])).trim()
}

// ---------- tools on PATH ----------

/** First of `names` found on PATH, as an absolute path. */
export function findOnPath(names: string[]): string | null {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const n of names) {
    for (const d of dirs) {
      const p = join(d, process.platform === 'win32' ? `${n}.cmd` : n)
      if (existsSync(p)) return p
    }
  }
  return null
}

/** Opens the folder (and a file of it) in Cursor or VS Code. False when neither is installed. */
export async function openInEditor(root: string, file?: string): Promise<boolean> {
  const editor = findOnPath(['cursor', 'code'])
  if (!editor) return false
  const target = file ? insideRoot(root, file) : null
  await run(editor, [root, ...(target ? [target] : [])], root, { timeout: 15_000 })
  return true
}

/**
 * Pushes the agent's branch and opens a pull request with `gh`. Only after the player
 * clicked "Abrir PR" and confirmed. Returns the PR's URL.
 */
export async function openPullRequest(wt: WorktreeInfo, title: string, body: string): Promise<string> {
  checkWorktree(wt)
  const gh = findOnPath(['gh'])
  if (!gh) throw new Error('Não achei o GitHub CLI (gh). Instale com `brew install gh` e rode `gh auth login`.')
  const st = await worktreeState(wt)
  if (!st.exists) throw new Error('A cópia isolada deste agente não existe mais.')
  if (st.dirty) throw new Error('Tem mudanças não commitadas na cópia. Commite antes de abrir o PR.')
  if (!st.ahead) throw new Error('O branch ainda não tem commits. Commite as mudanças antes.')
  const remotes = (await git(wt.root, ['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remote || !/^[\w.-]+$/.test(remote)) throw new Error('Esse repositório não tem remoto para onde enviar o branch.')
  await git(wt.root, ['push', '-u', remote, wt.branch], { timeout: 180_000 })
  const out = await run(gh, ['pr', 'create', '--head', wt.branch, '--title', title, '--body', body], wt.root, { timeout: 120_000 })
  const url = out.trim().split('\n').reverse().find((l) => /^https:\/\/\S+$/.test(l.trim()))
  if (!url) throw new Error('O gh não devolveu o link do PR.')
  return url.trim()
}
