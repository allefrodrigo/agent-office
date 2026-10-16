import { execFile } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { WorktreeEntry } from '@shared/types'
import { headOf } from './repo'
import { git, SHA_RE } from './run'
import { validBranch, worktreeState, WORKTREES_DIR, type WorktreeState } from './worktrees'

// ---------- inventory: every agent copy of a repo (Bastidores → Worktrees) ----------

/** A copy as found on disk, with what removing it would take. */
export interface FoundWorktree extends WorktreeEntry {
  /** Commit the branch shares with the repo's HEAD: the base removeWorktree counts from. */
  base: string
  /** worktreeState at listing time; its fingerprint guards a confirmed removal. */
  state?: WorktreeState
}

/** `git worktree list --porcelain`, only the entries under <repo>/.agent-office/worktrees. */
async function registered(repo: string): Promise<Map<string, string>> {
  const out = await git(repo, ['worktree', 'list', '--porcelain'])
  const dir = join(repo, WORKTREES_DIR) + sep
  const found = new Map<string, string>()
  let path = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice(9)
    else if (line.startsWith('branch refs/heads/') && path.startsWith(dir)) found.set(path, line.slice(18))
    else if (line === 'detached' && path.startsWith(dir)) found.set(path, '')
  }
  return found
}

/**
 * Commits that live only on this branch: not on any other branch, tag or remote. Those
 * are lost if the branch goes. `--all` can't be used: it counts the copy's own HEAD.
 */
async function uniqueCommits(repo: string, branch: string): Promise<number> {
  const own = `refs/heads/${branch}`
  const refs = (await git(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags', 'refs/remotes']))
    .split('\n')
    .filter((r) => r && r !== own)
  const out = await git(repo, ['rev-list', '--count', own, '--stdin'], { input: refs.map((r) => `^${r}\n`).join('') })
  return Number(out.trim()) || 0
}

/** Bytes on disk: `du` where there is one (fast on node_modules), else a walk that never follows links. */
export async function folderSize(root: string): Promise<number | undefined> {
  if (process.platform !== 'win32') {
    return new Promise((done) =>
      execFile('du', ['-sk', root], { timeout: 60_000 }, (err, out) => {
        const kb = Number(String(out).split('\t')[0])
        done(err || !Number.isFinite(kb) ? undefined : kb * 1024)
      }),
    )
  }
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      items.map(async (d) => {
        const p = join(dir, d.name)
        if (d.isDirectory()) return walk(p)
        if (d.isFile()) total += (await lstat(p).catch(() => null))?.size ?? 0
      }),
    )
  }
  await walk(root)
  return total
}

/**
 * Every copy the office made in `repo`: the ones git knows (with branch, changes, commits
 * and size) and loose folders git forgot (`broken`), which still take disk space.
 */
export async function listRepoWorktrees(repo: string): Promise<FoundWorktree[]> {
  const dir = join(repo, WORKTREES_DIR)
  if (!existsSync(dir)) return []
  const known = await registered(repo)
  const head = await headOf(repo)
  const folders = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => join(dir, d.name))
  for (const p of known.keys()) if (!folders.includes(p)) folders.push(p)
  const out: FoundWorktree[] = []
  for (const root of folders.sort()) {
    const createdAt = (() => {
      try {
        const st = lstatSync(root)
        return st.birthtimeMs || st.ctimeMs
      } catch {
        return undefined
      }
    })()
    const branch = known.get(root)
    if (branch === undefined || !validBranch(branch)) {
      // A folder git no longer lists (or one on a branch the office never makes).
      out.push({
        root,
        repo,
        branch: branch ?? '',
        base: '',
        broken: true,
        exists: existsSync(root),
        dirty: 0,
        ignored: 0,
        ahead: 0,
        unique: 0,
        createdAt,
      })
      continue
    }
    let base = ''
    let ahead = 0
    if (head) {
      base = (await git(repo, ['merge-base', head, `refs/heads/${branch}`]).catch(() => '')).trim()
      ahead = Number((await git(repo, ['rev-list', '--count', `${head}..refs/heads/${branch}`]).catch(() => '0')).trim()) || 0
    }
    if (!SHA_RE.test(base)) base = ''
    const state = await worktreeState({ path: root, root, repo, branch, base }).catch(() => undefined)
    out.push({
      root,
      repo,
      branch,
      base,
      state,
      exists: state?.exists ?? existsSync(root),
      dirty: state?.dirty ?? 0,
      ignored: state?.ignored ?? 0,
      ahead,
      unique: await uniqueCommits(repo, branch).catch(() => ahead),
      createdAt,
    })
  }
  return out
}

/** Nothing to lose: no agent in it, no uncommitted change, every commit also elsewhere. */
export const isSafeToRemove = (w: WorktreeEntry) => !w.agentId && !w.broken && w.dirty === 0 && w.unique === 0

/**
 * A loose folder under .agent-office/worktrees that git no longer lists: deleted from
 * disk after the player confirmed. Never follows a symlink out of the repo.
 */
export async function removeLooseFolder(repo: string, root: string): Promise<void> {
  const rel = relative(join(repo, WORKTREES_DIR), root)
  if (!rel || rel.startsWith('..') || rel.includes(sep)) throw new Error('Essa pasta não está onde o Agent Office cria as cópias.')
  if (lstatSync(join(repo, '.agent-office')).isSymbolicLink() || lstatSync(join(repo, WORKTREES_DIR)).isSymbolicLink()) {
    throw new Error('A pasta .agent-office aponta para fora do repositório.')
  }
  if (!lstatSync(root).isSymbolicLink()) await rm(root, { recursive: true, force: true })
  else await rm(root, { force: true })
  await git(repo, ['worktree', 'prune']).catch(() => '')
}
