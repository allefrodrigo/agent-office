import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  changesSince,
  commitChanges,
  createWorktree,
  discardChanges,
  fileDiff,
  insideRoot,
  openPullRequest,
  pruneWorktrees,
  removeWorktree,
  slugify,
  takeSnapshot,
  validBranch,
  worktreeFromPath,
  worktreeState,
} from '../src/main/git'

// Everything runs in throwaway repos made with `git init` in the temp folder, never in this repo.
const made: string[] = []
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })))

function tmp(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  made.push(d)
  return d
}

function newRepo(prefix = 'ao-git-'): { dir: string; git: (...args: string[]) => string } {
  const dir = tmp(prefix)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'teste@exemplo.com')
  git('config', 'user.name', 'Teste')
  git('config', 'commit.gpgsign', 'false')
  return { dir, git }
}

const read = (p: string) => readFileSync(p, 'utf8')

describe('arquivos alterados (AO-34)', () => {
  it('lista com +/−, mostra o diff da tarefa e descarta sem perder a mudança do usuário', async () => {
    const { dir, git } = newRepo()
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(dir, 'b.txt'), 'bee\n')
    writeFileSync(join(dir, 'del.txt'), 'x\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    // The player already had changes before the task.
    writeFileSync(join(dir, 'b.txt'), 'bee\nuser edit\n')
    writeFileSync(join(dir, 'mine.txt'), 'mine\n')
    const snap = (await takeSnapshot(dir))!
    // The "agent" works.
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\nthree\n')
    writeFileSync(join(dir, 'b.txt'), 'bee\nuser edit\nagent edit\n')
    writeFileSync(join(dir, 'new <b>.txt'), '<script>alert(1)</script>\n')
    unlinkSync(join(dir, 'del.txt'))

    const c = await changesSince(snap)
    const row = (p: string) => c.files.find((f) => f.path === p)
    expect(c.files.map((f) => f.path)).toEqual(['a.txt', 'b.txt', 'del.txt', 'new <b>.txt'])
    expect(row('a.txt')).toMatchObject({ status: 'modified', added: 2, removed: 1 })
    expect(row('b.txt')).toMatchObject({ status: 'modified', added: 1, removed: 0, preexisting: true })
    expect(row('del.txt')).toMatchObject({ status: 'deleted', removed: 1 })
    expect(row('new <b>.txt')).toMatchObject({ status: 'added', added: 1 })
    const diffB = await fileDiff(c, 'b.txt')
    expect(diffB).toContain('+agent edit')
    expect(diffB).not.toContain('+user edit')
    expect(diffB).toContain('--- a/b.txt')
    await expect(fileDiff(c, '../etc/passwd')).rejects.toThrow()

    await discardChanges(c)
    expect(read(join(dir, 'a.txt'))).toBe('one\ntwo\n')
    expect(read(join(dir, 'b.txt'))).toBe('bee\nuser edit\n')
    expect(existsSync(join(dir, 'del.txt'))).toBe(true)
    expect(existsSync(join(dir, 'new <b>.txt'))).toBe(false)
    expect(existsSync(join(dir, 'mine.txt'))).toBe(true)
    expect((await changesSince(snap)).files).toHaveLength(0)
  })

  it('commita só os arquivos da lista, com a mensagem literal', async () => {
    const { dir, git } = newRepo()
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    writeFileSync(join(dir, 'a.txt'), 'a\nuser\n')
    const snap = (await takeSnapshot(dir))!
    writeFileSync(join(dir, 'c.txt'), 'see\n')
    // Starts like options, carries shell syntax: it must land as plain text.
    await commitChanges(await changesSince(snap), '--amend --no-verify $(touch /tmp/ao-pwned)')
    expect(git('log', '-1', '--format=%s').trim()).toBe('--amend --no-verify $(touch /tmp/ao-pwned)')
    expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('c.txt')
    expect(git('status', '--porcelain')).toContain(' M a.txt')
  })

  it('corta um diff gigante com aviso', async () => {
    const { dir, git } = newRepo()
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    const snap = (await takeSnapshot(dir))!
    writeFileSync(join(dir, 'big.txt'), 'linha comprida de teste\n'.repeat(200_000))
    const d = await fileDiff(await changesSince(snap), 'big.txt')
    expect(d.length).toBeLessThan(301_000)
    expect(d).toContain('diff cortado')
  })

  it('pasta sem git não tem snapshot nem worktree', async () => {
    const plain = tmp('ao-plain-')
    expect(await takeSnapshot(plain)).toBeNull()
    expect(await createWorktree(plain, 'Ada', 'abc')).toBeNull()
  })
})

describe('worktrees (AO-33)', () => {
  it('cada agente tem pasta e branch próprios e não interfere no outro', async () => {
    const { dir, git } = newRepo('ao-wt-')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    const ada = (await createWorktree(dir, 'Ada Lóvelace', '1234abcd-0000'))!
    const bob = (await createWorktree(dir, 'Bob', '99999999-0000'))!
    expect(ada.branch).toBe('agent/ada-lovelace-1234abcd')
    expect(ada.root).toBe(join(dir, '.agent-office', 'worktrees', 'ada-lovelace-1234abcd'))
    writeFileSync(join(ada.root, 'a.txt'), 'ada\n')
    writeFileSync(join(bob.root, 'a.txt'), 'bob\n')
    expect(read(join(ada.root, 'a.txt'))).toBe('ada\n')
    expect(read(join(bob.root, 'a.txt'))).toBe('bob\n')
    expect(read(join(dir, 'a.txt'))).toBe('a\n')
    expect(git('status', '--porcelain')).not.toContain('.agent-office')

    // Without confirmation, uncommitted work stays.
    expect(await removeWorktree(ada, false)).toContain('mudanças novas')
    expect(existsSync(ada.root)).toBe(true)
    await removeWorktree(ada, true)
    expect(existsSync(ada.root)).toBe(false)
    expect(git('branch', '--list', ada.branch).trim()).toBe('')

    // A branch with commits is never deleted.
    execFileSync('git', ['commit', '-qam', 'bob'], { cwd: bob.root })
    expect((await worktreeState(bob)).ahead).toBe(1)
    await removeWorktree(bob, false)
    expect(git('branch', '--list', bob.branch).trim()).not.toBe('')
  })

  it('sessão retomada volta ao projeto de origem e prune esquece cópia apagada', async () => {
    const { dir, git } = newRepo('ao-wt-')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    const cy = (await createWorktree(dir, 'Cy', 'abcdef01'))!
    expect((await worktreeFromPath(cy.path))?.cwd).toBe(dir)
    rmSync(cy.root, { recursive: true, force: true })
    await pruneWorktrees([dir])
    expect(git('worktree', 'list')).not.toContain('cy-abcdef01')
  })

  it('repo sem commit não ganha worktree', async () => {
    const { dir } = newRepo('ao-empty-')
    await expect(createWorktree(dir, 'x', 'abc')).rejects.toThrow('nenhum commit')
  })
})

describe('segurança', () => {
  it('recusa nomes de branch maliciosos e limpa o nome do agente', async () => {
    for (const b of ['agent/x;rm -rf ~', '--upload-pack=evil', 'agent/../main', 'agent/-x', 'main', 'agent/a b', 'agent/x.lock', 'agent/$(id)']) {
      expect(validBranch(b)).toBe(false)
    }
    expect(validBranch('agent/ada-1234abcd')).toBe(true)
    expect(slugify('$(rm -rf /); `id` ../../x')).toBe('rm-rf-id-x')
    expect(slugify('---')).toBe('agente')

    const { dir, git } = newRepo('ao-sec-')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    const wt = (await createWorktree(dir, '--force $(id)', 'deadbeef'))!
    expect(wt.branch).toBe('agent/force-id-deadbeef')
    await expect(removeWorktree({ ...wt, root: '/etc' }, true)).rejects.toThrow()
    await expect(removeWorktree({ ...wt, branch: 'main' }, true)).rejects.toThrow()
    await expect(openPullRequest({ ...wt, branch: '--delete' }, 't', 'b')).rejects.toThrow()
  })

  it('recusa caminhos com ../, absolutos, com - , dentro de .git ou atrás de symlink para fora', () => {
    const { dir } = newRepo('ao-sec-')
    const outside = tmp('ao-outside-')
    expect(insideRoot(dir, '../x')).toBeNull()
    expect(insideRoot(dir, 'sub/../../x')).toBeNull()
    expect(insideRoot(dir, '/etc/passwd')).toBeNull()
    expect(insideRoot(dir, '-rf')).toBeNull()
    expect(insideRoot(dir, '.git/config')).toBeNull()
    symlinkSync(outside, join(dir, 'link-dir'))
    expect(insideRoot(dir, 'link-dir/secret.txt')).toBeNull()
    expect(insideRoot(dir, 'ok/new.txt')).toBe(join(dir, 'ok', 'new.txt'))
  })

  it('symlink para fora nunca é lido nem seguido ao descartar', async () => {
    const { dir, git } = newRepo('ao-sec-')
    const outside = tmp('ao-outside-')
    const secret = join(outside, 'secret.txt')
    writeFileSync(secret, 'TOP SECRET\n')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    git('add', '.')
    git('commit', '-qm', 'init')

    const snap = (await takeSnapshot(dir))!
    symlinkSync(secret, join(dir, 'leak.txt'))
    const c = await changesSince(snap)
    expect(c.files.some((f) => f.path === 'leak.txt')).toBe(true)
    expect(await fileDiff(c, 'leak.txt')).not.toContain('TOP SECRET')
    await discardChanges(c)
    expect(existsSync(join(dir, 'leak.txt'))).toBe(false)
    expect(read(secret)).toBe('TOP SECRET\n')

    // The player's change comes back over a symlink the agent planted: the link is replaced, not written through.
    writeFileSync(join(dir, 'a.txt'), 'a\nuser change\n')
    const snap2 = (await takeSnapshot(dir))!
    unlinkSync(join(dir, 'a.txt'))
    symlinkSync(secret, join(dir, 'a.txt'))
    await discardChanges(await changesSince(snap2))
    expect(read(secret)).toBe('TOP SECRET\n')
    expect(lstatSync(join(dir, 'a.txt')).isSymbolicLink()).toBe(false)
    expect(read(join(dir, 'a.txt'))).toBe('a\nuser change\n')
  })

  it('a configuração do repo não consegue rodar programas (fsmonitor, diff externo, textconv, filtros, hooks)', async () => {
    const { dir, git } = newRepo('ao-evil-')
    const outside = tmp('ao-evil-out-')
    const marker = join(outside, 'pwned')
    const evil = join(outside, 'evil.sh')
    writeFileSync(evil, `#!/bin/sh\necho "$0 $*" >> '${marker}'\ncat\n`)
    chmodSync(evil, 0o755)
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    writeFileSync(join(dir, 'f.dat'), 'f\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    // A hostile .git/config and .gitattributes, as a cloned repo or an agent could leave them.
    git('config', 'core.fsmonitor', evil)
    git('config', 'diff.external', evil)
    git('config', 'diff.evil.textconv', evil)
    git('config', 'diff.evil.command', evil)
    git('config', 'filter.evil.clean', evil)
    git('config', 'filter.evil.smudge', evil)
    git('config', 'filter.evil.process', evil)
    git('config', 'filter.evil.required', 'true')
    git('config', 'core.pager', evil)
    git('config', 'core.editor', evil)
    git('config', 'gpg.program', evil)
    writeFileSync(join(dir, '.gitattributes'), '* diff=evil filter=evil\n')
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true })
    for (const hook of ['post-checkout', 'pre-commit', 'commit-msg', 'post-commit', 'reference-transaction']) {
      writeFileSync(join(dir, '.git', 'hooks', hook), `#!/bin/sh\necho hook >> '${marker}'\n`)
      chmodSync(join(dir, '.git', 'hooks', hook), 0o755)
    }

    const snap = (await takeSnapshot(dir))!
    writeFileSync(join(dir, 'a.txt'), 'a\nchanged\n')
    writeFileSync(join(dir, 'f.dat'), 'f\nchanged\n')
    writeFileSync(join(dir, 'novo.txt'), 'n\n')
    const c = await changesSince(snap)
    for (const f of c.files) await fileDiff(c, f.path)
    await discardChanges(c)
    const wt = (await createWorktree(dir, 'Eve', 'eeeeeeee'))!
    const snap2 = (await takeSnapshot(wt.root))!
    writeFileSync(join(wt.root, 'a.txt'), 'eve\n')
    await commitChanges(await changesSince(snap2), 'Mudança da Eve')
    await worktreeState(wt)
    await removeWorktree(wt, true)

    expect(existsSync(marker) ? read(marker) : '').toBe('')

    // Control: plain git in the same repo does run the hostile config, so the check above means something.
    writeFileSync(join(dir, 'a.txt'), 'a\nagain\n')
    try {
      execFileSync('git', ['diff'], { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } })
    } catch {
      // the fake filter isn't a real filter process, so git gives up after running it
    }
    expect(existsSync(marker)).toBe(true)
  })
})
