import { existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { ChangedFile, ResultChanges } from '@shared/types'
import { headOf, insideRoot, repoRoot } from './repo'
import { blobBytes, chunked, git, runGit, SHA_RE, zsplit } from './run'

/** git's well-known empty blob: the "other side" of an added or deleted file. */
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
/** More than this and the card says "and N more": the list is for reading, not auditing. */
const MAX_FILES = 300
/** Dirty files bigger than this are not copied into the snapshot (they can't be restored). */
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
/** A diff is read up to this many bytes (the rest is never loaded) and shown up to MAX_DIFF_CHARS. */
const MAX_DIFF_BYTES = 1024 * 1024
const MAX_DIFF_CHARS = 300_000

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
  /** path -> its index entry at the start ("<mode> <blob>"); null = not in the index; 'unknown' = conflict or unreadable. */
  index?: Record<string, string | null>
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
    // Every file counts toward the cap, also the ones waiting to be hashed.
    if (Object.keys(dirty).length + toHash.length >= MAX_FILES) {
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
    const hashes = (await chunked(root, ['hash-object', '--no-filters', '-w'], toHash)).trim().split('\n')
    toHash.forEach((p, i) => (dirty[p] = SHA_RE.test(hashes[i] ?? '') ? hashes[i] : UNKNOWN))
  }
  const index = await indexEntries(root, Object.keys(dirty))
  return { root, head, dirty, index, ...(partial ? { partial } : {}) }
}

/** Index entry ("<mode> <blob>") of each path; null = not in the index; 'unknown' = conflict or unreadable. */
async function indexEntries(root: string, paths: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  for (const p of paths) out[p] = null
  if (!paths.length) return out
  let raw: string
  try {
    raw = await chunked(root, ['ls-files', '-s', '-z'], paths)
  } catch {
    for (const p of paths) out[p] = UNKNOWN
    return out
  }
  for (const item of zsplit(raw)) {
    const m = /^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?) (\d)\t([\s\S]+)$/.exec(item)
    if (!m || !(m[4] in out)) continue
    // A conflict has stages 1-3: the index can't be put back with one entry.
    out[m[4]] = m[3] === '0' && out[m[4]] === null ? `${m[1]} ${m[2]}` : UNKNOWN
  }
  return out
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
    const hashes = (await chunked(root, ['hash-object', '--no-filters', ...(write ? ['-w'] : [])], present)).trim().split('\n')
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
async function countLines(abs: string): Promise<{ added: number; binary: boolean }> {
  try {
    // lstat: a symlink is listed, never followed out of the repo.
    const st = lstatSync(abs)
    if (!st.isFile()) return { added: 0, binary: false }
    if (st.size > MAX_DIFF_BYTES) return { added: 0, binary: true }
    const buf = await readFile(abs)
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
    const startIndex = snap.index ? (path in snap.index ? snap.index[path] : UNKNOWN) : undefined
    files.push({ path, status, ...s, start, ...(startIndex !== undefined ? { startIndex } : {}), preexisting: true, restorable: true })
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
    files.push({ path, status: 'added', removed: 0, ...(await countLines(join(root, path))), restorable: true })
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


/** A diff read up to MAX_DIFF_BYTES: git is stopped there, so a huge file never fills memory. */
async function cappedDiff(root: string, args: string[], ok?: number[]): Promise<{ text: string; cut: boolean }> {
  const { out, cut } = await runGit(root, ['diff', ...args], { ok, maxBytes: MAX_DIFF_BYTES, cut: true })
  return { text: out.toString('utf8'), cut }
}

/** Unified diff of one file of the card, from the start of the task to now. */
export async function fileDiff(c: ResultChanges, path: unknown): Promise<string> {
  if (!c.git) throw new Error('Sem git não há diff para mostrar.')
  const f = listed(c, path)
  const abs = join(c.root, f.path)
  let st
  try {
    st = lstatSync(abs)
  } catch {
    st = null
  }
  // A link is shown as a link, never followed (it may point out of the repo).
  if (st?.isSymbolicLink()) return `(link simbólico para ${readlinkSync(abs)})`
  const exists = !!st?.isFile()
  let d: { text: string; cut: boolean }
  if (f.start === undefined && c.head && SHA_RE.test(c.head) && f.status !== 'added') {
    d = await cappedDiff(c.root, [c.head, '--', f.path])
  } else if (f.start === undefined || f.start === null) {
    // New since the start: everything is an added line.
    d = exists ? await cappedDiff(c.root, ['--no-index', '--', '/dev/null', f.path], [1]) : { text: '', cut: false }
  } else {
    if (!SHA_RE.test(f.start)) return '(o arquivo era grande demais para guardar a versão anterior)'
    const empty = await emptyBlob(c.root)
    const cur = exists ? ((await currentBlobs(c.root, [f.path], true)).get(f.path) ?? empty) : empty
    d = await cappedDiff(c.root, [f.start, cur])
    // Blob diffs are headed by the two ids: show the file name instead.
    d.text = d.text.replace(/^(diff --git a\/|--- a\/|\+\+\+ b\/)[0-9a-f]{40}( b\/[0-9a-f]{40})?$/gm, (_m, lead: string, two?: string) => `${lead}${f.path}${two ? ` b/${f.path}` : ''}`)
  }
  let out = d.text
  if (!out.trim()) return f.binary ? '(arquivo binário)' : '(sem diferenças agora)'
  const cut = d.cut || out.length > MAX_DIFF_CHARS
  if (out.length > MAX_DIFF_CHARS) out = out.slice(0, MAX_DIFF_CHARS)
  return cut ? `${out.replace(/\n[^\n]*$/, '')}\n… (diff cortado: grande demais para mostrar aqui; abra no editor)` : out
}

/**
 * Writes a saved blob back without following a symlink: into a temp file in the same
 * (already checked) folder, then renamed over the path, which replaces a link itself.
 */
async function restoreBlob(root: string, abs: string, blob: string): Promise<void> {
  const content = await blobBytes(root, blob)
  mkdirSync(dirname(abs), { recursive: true })
  if (!insideRoot(root, relative(root, abs))) throw new Error('caminho fora do repositório')
  const tmp = join(dirname(abs), `.agent-office-restore-${process.pid}-${Date.now()}`)
  writeFileSync(tmp, content, { flag: 'wx' })
  renameSync(tmp, abs)
}

/**
 * Puts the index entry of a preexisting file back as it was at the start (the agent may
 * have run `git add`). Unknown start entry: back to HEAD's (or out of the index), which
 * never touches the disk. Paths were checked by the caller.
 */
async function restoreIndex(root: string, f: ChangedFile, head: string | undefined): Promise<void> {
  const m = typeof f.startIndex === 'string' ? /^([0-7]{6}) ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/.exec(f.startIndex) : null
  if (m) {
    await git(root, ['update-index', '--add', '--cacheinfo', `${m[1]},${m[2]},${f.path}`])
  } else if (f.startIndex === null) {
    await git(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', f.path])
  } else if (head) {
    await git(root, ['reset', '-q', head, '--', f.path])
  } else {
    await git(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', f.path])
  }
}

/**
 * Puts every listed file back as it was at the start of the task: files from HEAD come
 * back with `git checkout`, files the task created go with `git rm --cached` + `git clean`,
 * and files the player had already changed get their saved copy. Every path is checked
 * against the root first. The caller confirms with the player.
 */
export async function discardChanges(c: ResultChanges): Promise<{ restored: number; skipped: string[] }> {
  if (!c.git) throw new Error('Sem git não dá para desfazer as mudanças.')
  const head = c.head && SHA_RE.test(c.head) ? c.head : undefined
  const skipped: string[] = []
  const fromHead: string[] = []
  const created: string[] = []
  let restored = 0
  for (const f of c.files) {
    const abs = insideRoot(c.root, f.path)
    if (!abs || !f.restorable) {
      skipped.push(f.path)
      continue
    }
    if (f.start === undefined && f.status !== 'added' && head) fromHead.push(f.path)
    else if (f.start === undefined || f.start === null) created.push(f.path)
    else if (SHA_RE.test(f.start)) {
      try {
        await restoreBlob(c.root, abs, f.start)
        await restoreIndex(c.root, f, head)
        restored++
      } catch {
        skipped.push(f.path)
      }
    } else skipped.push(f.path)
  }
  if (created.length) {
    // Out of the index, then off the disk; git clean removes a link, never what it points to.
    await chunked(c.root, ['rm', '--cached', '-q', '--ignore-unmatch'], created).catch(() => '')
    await chunked(c.root, ['clean', '-f', '-q'], created)
    restored += created.length
  }
  if (fromHead.length && head) {
    await chunked(c.root, ['checkout', head], fromHead)
    restored += fromHead.length
  }
  return { restored, skipped }
}
