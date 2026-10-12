import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { ResultChanges, WorktreeInfo } from '@shared/types'
import { insideRoot } from './repo'
import { chunked, git, run, safeGitEnv } from './run'
import { checkWorktree, worktreeState } from './worktrees'

/**
 * Commits exactly the listed files (not whatever else is staged). The message goes on
 * stdin (-F -), so nothing in it reads as an option. Hooks don't run (core.hooksPath is off for every office git call).
 * Returns the short sha.
 */
export async function commitChanges(c: ResultChanges, message: string): Promise<string> {
  if (!c.git) throw new Error('Essa pasta não é um repositório git.')
  if (c.truncated) throw new Error('São mudanças demais para commitar daqui. Use o terminal.')
  const paths = c.files.map((f) => f.path).filter((p) => insideRoot(c.root, p))
  if (!paths.length) throw new Error('Não há arquivos para commitar.')
  await chunked(c.root, ['add', '-A'], paths)
  await git(c.root, ['commit', '-F', '-', '--', ...paths], { timeout: 120_000, input: message })
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
  if (!remote || !/^\w[\w.-]*$/.test(remote)) throw new Error('Esse repositório não tem remoto para onde enviar o branch.')
  // Credentials come from gh's own helper only (the repo's credential.helper is wiped by
  // the safe config). gh's path goes inside single quotes, so it can't carry any.
  if (gh.includes("'")) throw new Error('O caminho do gh tem aspas; não dá para usar com segurança.')
  // The ref is spelled out so it can't read as an option.
  await git(wt.root, ['push', '-u', remote, `refs/heads/${wt.branch}:refs/heads/${wt.branch}`], {
    timeout: 180_000,
    config: [['credential.helper', `!'${gh}' auth git-credential`]],
  })
  // gh calls git itself: it gets the same safe config through GIT_CONFIG_*.
  // --flag=value: a title or body starting with '-' stays a value.
  const out = await run(gh, ['pr', 'create', `--head=${wt.branch}`, `--title=${title}`, `--body=${body}`], wt.root, { timeout: 120_000 }, await safeGitEnv(wt.root))
  const url = out.trim().split('\n').reverse().find((l) => /^https:\/\/\S+$/.test(l.trim()))
  if (!url) throw new Error('O gh não devolveu o link do PR.')
  return url.trim()
}
