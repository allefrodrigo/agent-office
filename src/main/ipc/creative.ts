import { app, dialog, ipcMain } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CodexUsage } from '@shared/creative'
import type { ProjectFloor } from '@shared/types'
import { cleanJob } from '../creative/flow'
import { runNode } from '../creative/nodes'
import { readCodexUsage } from '../creative/usage'
import { forgetKey, storeKey, useKeyFile, voices } from '../creative/elevenlabs'
import { cancelCodexLogin, codexLogin, codexLogout, creativeStatus } from '../creative/tools'
import { accountEnv } from '../accounts'
import { log } from '../log'
import { idSchema, parse } from '../validate'
import type { IpcContext } from './context'

/** Estúdio criativo: Codex setup, the floor's flow file, and running one node at a time. */
export function registerCreativeIpc(ctx: IpcContext): void {
  const { store, broadcast, win, accounts } = ctx
  const floors = () => store.settings.projects.filter((p) => p.kind === 'creative')
  const floorOf = (raw: unknown): ProjectFloor => {
    const fid = parse(idSchema, raw, 'Esse andar não existe mais.')
    const f = floors().find((p) => p.id === fid)
    if (!f) throw new Error('Esse andar criativo não existe mais.')
    return f
  }
  const jobs = new Map<string, AbortController>()

  ipcMain.handle('office:creativeStatus', () => creativeStatus())
  ipcMain.handle('office:codexLogin', async () => {
    await codexLogin((url) => broadcast({ type: 'creative:login-url', url }))
    return creativeStatus()
  })
  // Codex limits: read on demand (studio open) and after every Codex run, pushed to the page.
  let usage: CodexUsage | null = null
  let reading: Promise<CodexUsage> | null = null
  const refreshUsage = () =>
    (reading ??= readCodexUsage()
      .then((u) => (usage = u))
      .catch((err: unknown) => (usage = { ...(usage ?? { windows: [], limited: false }), updatedAt: Date.now(), error: err instanceof Error ? err.message : String(err) }))
      .then((u) => {
        broadcast({ type: 'creative:usage', usage: u })
        return u
      })
      .finally(() => (reading = null)))
  ipcMain.handle('office:codexUsage', (_e, force: unknown) => (usage && force !== true && Date.now() - usage.updatedAt < 60_000 ? usage : refreshUsage()))
  // ElevenLabs: the key stays in main (a file of ~/.config/elevenlabs or the OS keychain).
  ipcMain.handle('office:elevenUseFile', async (_e, name: unknown) => {
    if (typeof name !== 'string' || !/^[\w.-]{1,80}$/.test(name)) throw new Error('Arquivo de chave inválido.')
    useKeyFile(name)
    return creativeStatus()
  })
  ipcMain.handle('office:elevenStoreKey', async (_e, key: unknown) => {
    if (typeof key !== 'string' || key.length > 200) throw new Error('Chave inválida.')
    await storeKey(key)
    return creativeStatus()
  })
  ipcMain.handle('office:elevenForget', async () => {
    forgetKey()
    return creativeStatus()
  })
  ipcMain.handle('office:elevenVoices', () => voices())
  ipcMain.handle('office:codexCancelLogin', () => cancelCodexLogin())
  ipcMain.handle('office:codexLogout', async () => {
    await codexLogout()
    return creativeStatus()
  })
  /** ~/Documents/Agent Office/Criativo, made on demand: the default folder of a creative floor. */
  ipcMain.handle('office:creativeFolder', () => {
    const dir = join(app.getPath('documents'), 'Agent Office', 'Criativo')
    mkdirSync(dir, { recursive: true })
    return dir
  })


  ipcMain.handle('office:pickMedia', async (_e, kind: unknown, multi: unknown) => {
    const video = kind === 'video'
    const r = await dialog.showOpenDialog(win()!, {
      title: video ? 'Escolha o vídeo' : 'Escolha as imagens',
      properties: video || multi !== true ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: [video ? { name: 'Vídeos', extensions: ['mp4', 'mov', 'm4v', 'webm'] } : { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('office:runCreative', async (_e, raw: unknown) => {
    const job = cleanJob(raw, floors().map((f) => f.id))
    const floor = floorOf(job.floorId)
    if (jobs.has(job.jobId)) throw new Error('Esse nó já está rodando.')
    const ctrl = new AbortController()
    jobs.set(job.jobId, ctrl)
    const progress = (text: string) => broadcast({ type: 'creative:progress', jobId: job.jobId, text: text.slice(0, 200) })
    const started = Date.now()
    try {
      const claudeEnv = accountEnv(accounts.pick({ cwd: floor.cwd, accounts: floor.accounts }))
      const r = await runNode(job, { root: floor.cwd, signal: ctrl.signal, progress, claudeEnv })
      if (job.kind === 'generate-image' || job.params.engine === 'codex') void refreshUsage()
      log.info(`Estúdio: ${job.kind} em ${Math.round((Date.now() - started) / 1000)} s (${floor.name})`)
      return r
    } catch (err) {
      log.warn(`Estúdio: ${job.kind} falhou:`, err instanceof Error ? err.message : err)
      throw err
    } finally {
      jobs.delete(job.jobId)
    }
  })
  ipcMain.handle('office:cancelCreative', (_e, jobId: unknown) => {
    if (typeof jobId === 'string') jobs.get(jobId)?.abort()
  })
}
