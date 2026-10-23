import { dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { sep } from 'node:path'
import type { WorktreeFloor } from '@shared/types'
import { projectFor } from '@shared/projects'
import {
  commitChanges,
  discardChanges,
  fileDiff,
  folderSize,
  insideRoot,
  isSafeToRemove,
  listRepoWorktrees,
  openInEditor,
  openPullRequest,
  pendingLoss,
  removeLooseFolder,
  removeWorktree,
  repoRoot,
  worktreeState,
  WORKTREES_DIR,
  type FoundWorktree,
} from '../git'
import { changedPathSchema, commitMessageSchema, prTitleSchema, uuidSchema, parse } from '../validate'
import { id, type IpcContext } from './context'

/** Worktrees (AO-33) and the result card's changed files (AO-34). */
export function registerWorktreesIpc(ctx: IpcContext): void {
  const { win, manager, nameOf, store } = ctx
  // ---------- worktrees (AO-33) ----------
  // What the player chose in the native dialog of prepareFire. Only that dialog can
  // authorize removing a worktree: the renderer never sends "remove".
  const fireChoices = new Map<string, { remove: boolean; dirty: number; ignored: number; fingerprint: string }>()
  const agentId = (raw: unknown) => parse(uuidSchema, raw, 'Esse agente não está mais no escritório.')
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
  ipcMain.handle('office:prepareFire', async (_e, raw: unknown) => {
    const a = manager.agent(agentId(raw))
    const wt = a?.worktree
    if (!a || !wt) return 'plain'
    const st = await worktreeState(wt).catch(() => null)
    if (!st?.exists) {
      fireChoices.set(a.id, { remove: false, dirty: 0, ignored: 0, fingerprint: '' })
      return 'plain'
    }
    const kept = st.ahead ? ` O branch tem ${st.ahead} commit${st.ahead > 1 ? 's' : ''} e fica no repositório mesmo se você remover a cópia.` : ''
    // git worktree remove also deletes ignored files (.env, node_modules): say so.
    const ignoredLine = st.ignored
      ? `\n\nTem também ${plural(st.ignored, 'arquivo ou pasta ignorado', 'arquivos ou pastas ignorados')} pelo git (como .env ou node_modules), que somem junto com a cópia.`
      : ''
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'question',
      buttons: ['Manter a cópia', 'Remover a cópia', 'Cancelar'],
      // Nothing to lose: removing is the default, so copies don't pile up on disk.
      defaultId: st.dirty === 0 && st.ahead === 0 ? 1 : 0,
      cancelId: 2,
      message: `Dispensar ${a.name}?`,
      detail:
        `A sessão para e o agente vai embora. Ele trabalhava numa cópia isolada (branch ${wt.branch}) em ${wt.root}.\n\n` +
        (st.dirty ? `A cópia tem ${st.dirty} arquivo${st.dirty > 1 ? 's' : ''} com mudanças não commitadas.` : 'A cópia não tem mudanças não commitadas.') +
        kept +
        ignoredLine,
    })
    if (response === 2) return 'cancelled'
    if (response === 1 && pendingLoss(st)) {
      const what = [
        st.dirty ? plural(st.dirty, 'mudança não commitada', 'mudanças não commitadas') : '',
        st.ignored ? plural(st.ignored, 'arquivo ignorado pelo git', 'arquivos ignorados pelo git') : '',
      ].filter(Boolean)
      const sure = await dialog.showMessageBox(win()!, {
        type: 'warning',
        buttons: ['Apagar e dispensar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        message: `Apagar ${what.join(' e ')}?`,
        detail:
          'Não dá para desfazer. Para guardar o trabalho, cancele e use "Commitar" no cartão de resultado' +
          (st.ignored ? '; copie antes os arquivos ignorados que quiser manter (.env, configs locais).' : '.'),
      })
      if (sure.response !== 0) return 'cancelled'
    }
    fireChoices.set(a.id, { remove: response === 1, dirty: st.dirty, ignored: st.ignored, fingerprint: st.fingerprint })
    return 'confirmed'
  })
  ipcMain.handle('office:fire', async (_e, raw: unknown) => {
    const aid = id(raw)
    const wt = manager.agent(aid)?.worktree
    const choice = fireChoices.get(aid)
    fireChoices.delete(aid)
    manager.fire(aid)
    if (!wt) return
    if (!choice?.remove) return `A cópia isolada ficou em ${wt.root} (branch ${wt.branch}).`
    // Forced only when the player confirmed losing exactly these files; any change since keeps the copy.
    const now = await worktreeState(wt).catch(() => null)
    const force = pendingLoss(choice) > 0 && !!now && now.fingerprint === choice.fingerprint
    return removeWorktree(wt, force).catch((err) => `Não consegui remover a cópia: ${err instanceof Error ? err.message : String(err)}`)
  })

  // ---------- Bastidores → Worktrees ----------
  const gb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`)
  /** The repos to look in: every floor's, plus any repo an agent works in. */
  const knownRepos = async (): Promise<string[]> => {
    const repos = new Set<string>()
    for (const p of store.settings.projects) {
      const r = existsSync(p.cwd) ? await repoRoot(p.cwd) : null
      if (r) repos.add(r)
    }
    for (const a of manager.list()) if (a.worktree) repos.add(a.worktree.repo)
    return [...repos]
  }
  const withOwners = (items: FoundWorktree[]) => {
    const agents = manager.list()
    for (const w of items) {
      const a = agents.find((x) => x.worktree?.root === w.root)
      if (a) Object.assign(w, { agentId: a.id, agentName: a.name })
    }
    return items
  }
  /** One copy, read again from disk: only roots the office listed can be removed. */
  const findCopy = async (raw: unknown): Promise<FoundWorktree> => {
    const root = typeof raw === 'string' && raw.length < 4096 ? raw : ''
    const at = root.indexOf(`${sep}${WORKTREES_DIR}${sep}`)
    const repo = at > 0 ? root.slice(0, at) : ''
    if (!repo || !(await knownRepos()).includes(repo)) throw new Error('Essa cópia não é de nenhum andar do escritório.')
    const w = withOwners(await listRepoWorktrees(repo)).find((x) => x.root === root)
    if (!w) throw new Error('Essa cópia já não existe. Atualize a lista.')
    return w
  }
  const lossLine = (w: FoundWorktree) =>
    [
      w.dirty ? plural(w.dirty, 'arquivo com mudanças não commitadas', 'arquivos com mudanças não commitadas') : '',
      w.ignored ? plural(w.ignored, 'arquivo ou pasta ignorado pelo git (node_modules, .env)', 'arquivos ou pastas ignorados pelo git (node_modules, .env)') : '',
    ]
      .filter(Boolean)
      .join(' e ')
  /** Removes a copy already confirmed; forced only if its files are the ones the player saw. */
  const removeCopy = async (w: FoundWorktree): Promise<string> => {
    if (w.broken) {
      await removeLooseFolder(w.repo, w.root)
      return 'Pasta solta apagada.'
    }
    const wt = { path: w.root, root: w.root, repo: w.repo, branch: w.branch, base: w.base }
    const now = await worktreeState(wt).catch(() => null)
    const force = !!w.state && pendingLoss(w.state) > 0 && !!now && now.fingerprint === w.state.fingerprint
    return removeWorktree(wt, force)
  }

  ipcMain.handle('office:listWorktrees', async (): Promise<WorktreeFloor[]> => {
    const floors: WorktreeFloor[] = []
    for (const repo of await knownRepos()) {
      const items = withOwners(await listRepoWorktrees(repo).catch(() => []))
      // du on node_modules takes a moment: all copies at once.
      await Promise.all(items.map(async (w) => (w.size = w.exists ? await folderSize(w.root) : 0)))
      const floor = projectFor(store.settings.projects, repo)
      floors.push({
        floorId: floor?.id,
        name: floor?.name ?? repo.split(/[\\/]/).filter(Boolean).pop() ?? repo,
        repo,
        worktrees: floor?.worktrees !== false,
        items: items.map(({ state: _s, base: _b, ...entry }) => entry),
      })
    }
    // Elevator order, then the repos outside the floors.
    const order = (f: WorktreeFloor) => (f.floorId ? store.settings.projects.findIndex((p) => p.id === f.floorId) : 99)
    return floors.sort((a, b) => order(a) - order(b))
  })

  ipcMain.handle('office:removeWorktreeAt', async (_e, raw: unknown) => {
    const w = await findCopy(raw)
    if (w.agentId) throw new Error(`${w.agentName} ainda trabalha nessa cópia. Dispense o agente para remover.`)
    const kept = w.unique
      ? `\n\nO branch tem ${plural(w.unique, 'commit que não está', 'commits que não estão')} em nenhum outro lugar: ele fica no repositório, só a pasta sai.`
      : ''
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'question',
      buttons: ['Remover a cópia', 'Cancelar'],
      defaultId: w.dirty ? 1 : 0,
      cancelId: 1,
      message: w.broken ? 'Apagar essa pasta solta?' : `Remover a cópia ${w.branch}?`,
      detail: w.broken
        ? `${w.root}\n\nO git não conhece mais essa pasta como cópia de agente. Ela só ocupa espaço${w.size ? ` (${gb(w.size)})` : ''}. Não dá para desfazer.`
        : `${w.root}${w.size ? ` · ${gb(w.size)}` : ''}${kept}${pendingLoss(w) ? `\n\nSomem junto: ${lossLine(w)}. Não dá para desfazer.` : ''}`,
    })
    if (response !== 0) return null
    return removeCopy(w)
  })

  ipcMain.handle('office:cleanWorktrees', async (_e, raw: unknown) => {
    const floorId = typeof raw === 'string' ? raw : undefined
    const all: FoundWorktree[] = []
    for (const repo of await knownRepos()) {
      if (floorId && projectFor(store.settings.projects, repo)?.id !== floorId) continue
      all.push(...withOwners(await listRepoWorktrees(repo).catch(() => [])))
    }
    const safe = all.filter(isSafeToRemove)
    if (!safe.length) return 'Nenhuma cópia para limpar: as que sobraram têm agente ou trabalho guardado só nelas.'
    const sizes = await Promise.all(safe.map((w) => (w.exists ? folderSize(w.root) : 0)))
    const total = sizes.reduce<number>((n, s) => n + (s ?? 0), 0)
    const ignored = safe.filter((w) => w.ignored).length
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'question',
      buttons: [`Remover ${safe.length === 1 ? 'a cópia' : `as ${safe.length} cópias`}`, 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: `Remover ${plural(safe.length, 'cópia sem trabalho pendente', 'cópias sem trabalho pendente')}?`,
      detail:
        `Libera cerca de ${gb(total)}. Nenhuma tem agente trabalhando, mudança sem commit ou commit que só exista nela.\n\n` +
        safe.map((w) => `• ${w.branch || w.root}`).join('\n') +
        (ignored ? `\n\n${ignored === 1 ? 'Uma delas tem' : `${ignored} delas têm`} arquivos ignorados pelo git (node_modules, .env), que somem junto.` : ''),
    })
    if (response !== 0) return null
    let done = 0
    const failed: string[] = []
    for (const w of safe) {
      try {
        await removeCopy(w)
        if (!existsSync(w.root)) done++
        else failed.push(w.branch)
      } catch {
        failed.push(w.branch || w.root)
      }
    }
    return `Removi ${plural(done, 'cópia', 'cópias')}.${failed.length ? ` Ficaram ${failed.length} que mudaram nesse meio-tempo: ${failed.join(', ')}.` : ''}`
  })

  // ---------- result card: changed files (AO-34) ----------
  const changesFor = (raw: unknown) => {
    const r = manager.result(parse(uuidSchema, raw, 'Esse resultado já foi recebido.'))
    if (!r) throw new Error('Esse resultado já foi recebido.')
    if (!r.changes) throw new Error('Ainda não sei o que esse agente mudou.')
    return { r, c: r.changes }
  }
  ipcMain.handle('office:resultDiff', (_e, raw: unknown, path: unknown) => {
    const { c } = changesFor(raw)
    return fileDiff(c, parse(changedPathSchema, path, 'Caminho inválido.'))
  })
  ipcMain.handle('office:openResultInEditor', async (_e, raw: unknown, path: unknown) => {
    const { c } = changesFor(raw)
    const p = changedPathSchema.optional().safeParse(path)
    const file = p.success && p.data && c.files.some((f) => f.path === p.data) ? p.data : undefined
    if (await openInEditor(c.root, file)) return true
    // No Cursor or VS Code: show it in Finder. Never shell.openPath: the agent may have
    // written a .command or .app, and the default app would run it.
    const target = file ? insideRoot(c.root, file) : c.root
    if (target && existsSync(target)) shell.showItemInFolder(target)
    return false
  })
  ipcMain.handle('office:discardResult', async (_e, raw: unknown) => {
    const { r, c } = changesFor(raw)
    if (!c.git || c.committed || c.discarded) throw new Error('Não há mudanças para descartar aqui.')
    const n = c.files.filter((f) => f.restorable).length
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'warning',
      buttons: ['Descartar mudanças', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      message: `Descartar as mudanças de ${n} arquivo${n === 1 ? '' : 's'}?`,
      detail:
        `Os arquivos voltam a ser como eram quando ${nameOf(r.agentId)} começou a tarefa, em ${c.root}. Arquivos criados pela tarefa são apagados. ` +
        'Mudanças que você já tinha antes da tarefa ficam. Não dá para desfazer.',
    })
    if (response !== 0) return null
    const done = await discardChanges(c)
    const next = { ...c, discarded: true }
    manager.setChanges(r.id, next)
    if (done.skipped.length) dialog.showErrorBox('Alguns arquivos ficaram como estão', `Não deu para restaurar:\n${done.skipped.slice(0, 20).join('\n')}`)
    return next
  })
  ipcMain.handle('office:commitResult', async (_e, raw: unknown, message: unknown) => {
    const { r, c } = changesFor(raw)
    const msg = parse(commitMessageSchema, message, 'Escreva uma mensagem de commit (até 2000 caracteres).')
    if (!c.git || c.committed || c.discarded) throw new Error('Não há mudanças para commitar aqui.')
    const sha = await commitChanges(c, msg)
    const next = { ...c, committed: sha }
    manager.setChanges(r.id, next)
    return next
  })
  ipcMain.handle('office:openResultPR', async (_e, raw: unknown, title: unknown) => {
    const { r } = changesFor(raw)
    const wt = manager.agent(r.agentId)?.worktree
    if (!wt) throw new Error('Só dá para abrir PR de um agente que trabalha numa cópia isolada (worktree).')
    const t = parse(prTitleSchema, title, 'Escreva um título para o PR.')
    const { response } = await dialog.showMessageBox(win()!, {
      type: 'question',
      buttons: ['Enviar e abrir PR', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      message: `Abrir um pull request do branch ${wt.branch}?`,
      detail: `Vamos rodar git push do branch para o remoto do repositório e gh pr create com o título "${t}" e o relatório do agente como descrição.`,
    })
    if (response !== 0) return null
    const body = `${r.text.slice(0, 6000)}\n\n---\nAberto pelo Agent Office (${nameOf(r.agentId)}, branch \`${wt.branch}\`).`
    return openPullRequest(wt, t, body)
  })
}
