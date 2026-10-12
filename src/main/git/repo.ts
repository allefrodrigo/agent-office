import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { git, SHA_RE } from './run'

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

export async function headOf(cwd: string): Promise<string | null> {
  try {
    const out = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])).trim()
    return SHA_RE.test(out) ? out : null
  } catch {
    return null
  }
}

/** `p` (relative to `root`) stays inside it, also after following symlinks of the folders. */
export function insideRoot(root: string, p: string): string | null {
  // A leading '-' could read as an option to git or the editor.
  if (typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0') || p.startsWith('-')) return null
  const abs = resolve(root, p)
  const rel = relative(root, abs)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null
  // Never inside the repo's own .git.
  if (rel.split(sep)[0] === '.git') return null
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

/** Real path of `p`; for a file that is gone, its folder's real path + its name; else `p`. */
function realOrSelf(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p))
    } catch {
      return p
    }
  }
}

/**
 * How the card shows a file written without git: relative to `root` when it is inside
 * (also after resolving symlinks such as /tmp -> /private/tmp), absolute otherwise.
 */
export function displayPath(root: string, file: string): string {
  const inside = (r: string, f: string) => {
    const rel = relative(r, f)
    return rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel) ? rel : null
  }
  return inside(root, file) ?? inside(realOrSelf(root), realOrSelf(file)) ?? file
}
