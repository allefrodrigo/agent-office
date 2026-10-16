import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createWorktree, folderSize, isSafeToRemove, listRepoWorktrees, removeLooseFolder, WORKTREES_DIR } from '../src/main/git'
import { cleanProjects } from '../src/main/validate'

// Throwaway repos in the temp folder, never this repo.
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

function newRepo(): { dir: string; git: (...args: string[]) => string } {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ao-inv-')))
  made.push(dir)
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'teste@exemplo.com')
  git('config', 'user.name', 'Teste')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  return { dir, git }
}

describe('inventário de worktrees', { timeout: 30_000 }, () => {
  it('separa a cópia limpa, a com mudança, a com commit só dela e a pasta solta', async () => {
    const { dir, git } = newRepo()
    const clean = (await createWorktree(dir, 'Ada', 'aaaaaaaa'))!
    const dirty = (await createWorktree(dir, 'Barbara', 'bbbbbbbb'))!
    const committed = (await createWorktree(dir, 'Dennis', 'cccccccc'))!
    const merged = (await createWorktree(dir, 'Grace', 'dddddddd'))!
    writeFileSync(join(dirty.root, 'novo.txt'), 'x\n')
    writeFileSync(join(committed.root, 'b.txt'), 'y\n')
    execFileSync('git', ['add', '.'], { cwd: committed.root })
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'só dela'], {
      cwd: committed.root,
    })
    // A commit that is also on main: nothing is lost if the branch goes.
    writeFileSync(join(merged.root, 'c.txt'), 'z\n')
    execFileSync('git', ['add', '.'], { cwd: merged.root })
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'mergeado'], {
      cwd: merged.root,
    })
    git('branch', 'copia-de-grace', merged.branch)
    const loose = join(dir, WORKTREES_DIR, 'esquecida')
    mkdirSync(loose)
    writeFileSync(join(loose, 'lixo.bin'), 'x'.repeat(4096))

    const list = await listRepoWorktrees(dir)
    const by = (root: string) => list.find((w) => w.root === root)!
    expect(list).toHaveLength(5)
    expect(by(clean.root)).toMatchObject({ dirty: 0, unique: 0, ahead: 0 })
    expect(by(clean.root).broken).toBeFalsy()
    expect(by(dirty.root).dirty).toBe(1)
    expect(by(committed.root)).toMatchObject({ unique: 1, ahead: 1 })
    expect(by(merged.root)).toMatchObject({ unique: 0, ahead: 1 })
    expect(by(loose)).toMatchObject({ broken: true, exists: true })

    expect(isSafeToRemove(by(clean.root))).toBe(true)
    expect(isSafeToRemove(by(merged.root))).toBe(true)
    expect(isSafeToRemove(by(dirty.root))).toBe(false)
    expect(isSafeToRemove(by(committed.root))).toBe(false)
    expect(isSafeToRemove(by(loose))).toBe(false)
    expect(isSafeToRemove({ ...by(clean.root), agentId: 'x' })).toBe(false)

    expect(await folderSize(loose)).toBeGreaterThanOrEqual(4096)
    await removeLooseFolder(dir, loose)
    expect(existsSync(loose)).toBe(false)
  })

  it('não apaga pasta fora de .agent-office/worktrees', async () => {
    const { dir } = newRepo()
    mkdirSync(join(dir, WORKTREES_DIR), { recursive: true })
    await expect(removeLooseFolder(dir, join(dir, 'src'))).rejects.toThrow()
    await expect(removeLooseFolder(dir, join(dir, WORKTREES_DIR, 'a', 'b'))).rejects.toThrow()
    expect(await listRepoWorktrees(dir)).toEqual([])
  })

  it('o andar guarda "sem worktree" e esquece quando volta a ligar', () => {
    const { dir } = newRepo()
    const off = cleanProjects([{ id: 'p1', name: 'X', cwd: dir, worktrees: false }], [])
    expect(off[0].worktrees).toBe(false)
    const on = cleanProjects([{ id: 'p1', name: 'X', cwd: dir }], off)
    expect(on[0]).not.toHaveProperty('worktrees')
  })
})
