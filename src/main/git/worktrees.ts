import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { WorktreeInfo } from '@shared/types'
import { headOf, insideRoot, repoRoot } from './repo'
import { git, SHA_RE, zsplit } from './run'

/** Where agent worktrees live, inside the repo (kept out of git by .git/info/exclude). */
export const WORKTREES_DIR = join('.agent-office', 'worktrees')

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
  // .agent-office could be a symlink out of the repo: the copy must land inside it. Checked
  // before mkdir, so nothing is ever created at the far end of such a link.
  if (!insideRoot(repo, relative(repo, root))) throw new Error('a pasta .agent-office aponta para fora do repositório')
  mkdirSync(dirname(root), { recursive: true })
  if (!insideRoot(repo, relative(repo, root))) throw new Error('a pasta .agent-office aponta para fora do repositório')
  await git(repo, ['worktree', 'add', '-b', branch, '--', root, base], { timeout: 120_000 })
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
export function checkWorktree(wt: WorktreeInfo): void {
  const rel = relative(join(wt.repo, WORKTREES_DIR), wt.root)
  if (!isAbsolute(wt.repo) || !rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep) || !validBranch(wt.branch)) {
    throw new Error('Essa cópia isolada não está onde o Agent Office cria as suas.')
  }
}

export interface WorktreeState {
  exists: boolean
  /** Files with uncommitted changes (tracked or not). */
  dirty: number
  /**
   * Ignored files and folders (.env, node_modules, local configs). `git worktree remove`
   * deletes them too, so they count as something to confirm before removing the copy.
   */
  ignored: number
  /** Commits on the branch since it was made. */
  ahead: number
  /**
   * Which files those are, with size and modification time: confirming a loss covers
   * exactly this set, so a file swapped or edited after the dialog keeps the copy.
   */
  fingerprint: string
}

export async function worktreeState(wt: WorktreeInfo): Promise<WorktreeState> {
  checkWorktree(wt)
  if (!existsSync(wt.root)) return { exists: false, dirty: 0, ignored: 0, ahead: 0, fingerprint: '' }
  // One status for both: `!! ` entries are ignored (a fully ignored folder is one entry).
  const status = zsplit(await git(wt.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=traditional']))
  const entries = status.filter((e) => e.length > 3)
  const ignored = entries.filter((e) => e.startsWith('!! ')).length
  const dirty = entries.length - ignored
  let ahead = 0
  if (SHA_RE.test(wt.base)) ahead = Number((await git(wt.root, ['rev-list', '--count', `${wt.base}..HEAD`])).trim()) || 0
  return { exists: true, dirty, ignored, ahead, fingerprint: fingerprintOf(wt.root, entries) }
}

/** Hash of the status entries plus each path's size and mtime (missing paths count as such). */
function fingerprintOf(root: string, entries: string[]): string {
  const h = createHash('sha256')
  for (const e of [...entries].sort()) {
    let stamp = 'missing'
    try {
      const st = lstatSync(join(root, e.slice(3)))
      stamp = `${st.size}:${st.mtimeMs}`
    } catch {
      /* deleted or unreadable: the entry alone still counts */
    }
    h.update(`${e}\0${stamp}\0`)
  }
  return h.digest('hex')
}

/** What removing the copy would delete without git being able to bring it back. */
export const pendingLoss = (st: Pick<WorktreeState, 'dirty' | 'ignored'>) => st.dirty + st.ignored

/**
 * True only when every commit of the branch is also reachable from another ref (another
 * branch, a tag, a HEAD): then deleting the branch loses nothing. Any doubt gives false.
 */
async function branchIsRedundant(repo: string, branch: string): Promise<boolean> {
  try {
    const ref = `refs/heads/${branch}`
    const own = (await git(repo, ['rev-list', '--count', ref, '--not', `--exclude=${ref}`, '--all'])).trim()
    return own === '0'
  } catch {
    return false
  }
}

/**
 * Removes the worktree. `force` only after the player confirmed losing the uncommitted
 * changes and the ignored files (.env, node_modules…), which `git worktree remove` also
 * deletes. The branch goes with `-D` only when it is proven to have no commits of its own;
 * otherwise only `git branch -d` is tried (git refuses unmerged work), so no committed work
 * is ever lost. Returns a line for the toast.
 */
export async function removeWorktree(wt: WorktreeInfo, force: boolean): Promise<string> {
  checkWorktree(wt)
  const st = await worktreeState(wt)
  if (st.exists) {
    if (pendingLoss(st) && !force) {
      const what = st.dirty ? 'mudanças novas' : 'arquivos ignorados pelo git (como .env ou node_modules)'
      return `A cópia de ${wt.branch} tem ${what} e ficou em ${wt.root}.`
    }
    await git(wt.repo, ['worktree', 'remove', ...(force ? ['--force'] : []), wt.root], { timeout: 60_000 })
  }
  await git(wt.repo, ['worktree', 'prune']).catch(() => '')
  if (st.ahead) return `Cópia removida. O branch ${wt.branch} ficou, com ${st.ahead} commit${st.ahead > 1 ? 's' : ''}.`
  // A missing folder says nothing about the branch (ahead was never counted): no -D then.
  if (st.exists && SHA_RE.test(wt.base) && (await branchIsRedundant(wt.repo, wt.branch))) {
    await git(wt.repo, ['branch', '-D', wt.branch]).catch(() => '')
  } else {
    await git(wt.repo, ['branch', '-d', wt.branch]).catch(() => '')
  }
  const kept = await git(wt.repo, ['rev-parse', '--verify', '-q', `refs/heads/${wt.branch}`], { ok: [1] }).then((o) => !!o.trim(), () => true)
  const copy = st.exists ? 'Cópia removida' : 'A cópia já não existia'
  return kept ? `${copy}. O branch ${wt.branch} ficou no repositório, porque pode ter commits só dele.` : `${copy}. Branch ${wt.branch} removido.`
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
