import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfficeEvent, UpdateChannel, UpdateStatus } from '../src/shared/types'

// The packaged app with a fake electron-updater: no network, no real quit.
const h = vi.hoisted(() => ({
  quit: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, quit: h.quit, getPath: () => '', getVersion: () => '0.3.3' },
  ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(name, fn) },
}))

class FakeUpdater extends EventEmitter {
  channel: string | null = null
  allowPrerelease = false
  allowDowngrade = true
  autoDownload = false
  autoInstallOnAppQuit = false
  logger: unknown = null
  // By default the feed has nothing newer, as a real check reports it: by an event.
  checkForUpdates = vi.fn(async (): Promise<unknown> => {
    this.emit('update-not-available', {})
    return {}
  })
  quitAndInstall = vi.fn()
}
let fake: FakeUpdater
vi.mock('electron-updater', () => ({ default: { get autoUpdater() { return fake } } }))

const { Updater } = await import('../src/main/updater')

let channel: UpdateChannel
let busy: { working: number; pending: number }
let flush: ReturnType<typeof vi.fn<() => void>>
let events: OfficeEvent[]
const make = () => new Updater({ channel: () => channel, busy: () => busy, flush, broadcast: (e) => events.push(e) })
const last = (): UpdateStatus | undefined => {
  const e = events.at(-1)
  return e?.type === 'update' ? e.update : undefined
}

/** An updater whose check found and downloaded `version`. */
async function ready(version = '0.4.0') {
  const u = make()
  fake.checkForUpdates.mockImplementationOnce(async () => {
    fake.emit('update-available', { version })
    fake.emit('update-downloaded', { version })
    return {}
  })
  await u.check()
  return u
}

beforeEach(() => {
  fake = new FakeUpdater()
  channel = 'stable'
  busy = { working: 0, pending: 0 }
  flush = vi.fn<() => void>()
  events = []
  h.quit.mockReset()
})

describe('Updater: canal', () => {
  it('estável não pega pré-lançamento nem volta versão', async () => {
    await make().check()
    expect(fake.allowPrerelease).toBe(false)
    expect(fake.allowDowngrade).toBe(false)
    // never set: electron-updater keeps its default channel
    expect(fake.channel).toBeNull()
  })

  it('beta pega pré-lançamentos; voltar ao estável troca o canal sem permitir downgrade', async () => {
    channel = 'beta'
    const u = make()
    await u.check()
    expect(fake.channel).toBe('beta')
    expect(fake.allowPrerelease).toBe(true)
    channel = 'stable'
    await u.check()
    expect(fake.channel).toBe('latest')
    expect(fake.allowPrerelease).toBe(false)
    expect(fake.allowDowngrade).toBe(false)
  })
})

describe('Updater: verificação', () => {
  it('sem versão nova: "latest"', async () => {
    expect((await make().check()).state).toBe('latest')
  })

  it('404 do GitHub vira "nenhuma versão publicada"', async () => {
    fake.checkForUpdates.mockRejectedValueOnce(new Error('404 Not Found\n"method: GET url: https://github.com/x/y/releases.atom"'))
    const s = await make().check()
    expect(s).toMatchObject({ state: 'error', message: 'nenhuma versão publicada no GitHub.' })
  })

  it('outro erro: só a primeira linha, curta', async () => {
    fake.checkForUpdates.mockRejectedValueOnce(new Error(`net::ERR_INTERNET_DISCONNECTED\n${'x'.repeat(5000)}`))
    expect(await make().check()).toMatchObject({ state: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' })
  })

  it('com a versão pronta não verifica de novo', async () => {
    const u = await ready()
    expect(last()).toMatchObject({ state: 'ready', version: '0.4.0' })
    await u.check()
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})

describe('Updater: instalar', () => {
  const tick = () => new Promise((r) => setImmediate(r))

  it('sem versão pronta não faz nada', async () => {
    expect(await make().install(false)).toEqual({ ok: false })
    expect(flush).not.toHaveBeenCalled()
  })

  it('agentes ocupados: pede confirmação e não salva nem reinicia', async () => {
    const u = await ready()
    busy = { working: 2, pending: 1 }
    expect(await u.install(false)).toEqual({ ok: false, working: 2, pending: 1 })
    await tick()
    expect(flush).not.toHaveBeenCalled()
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
  })

  it('confirmado (force): salva antes e instala', async () => {
    const u = await ready()
    busy = { working: 2, pending: 0 }
    expect(await u.install(true)).toEqual({ ok: true })
    expect(flush).toHaveBeenCalledTimes(1)
    // flush runs before quitAndInstall, which waits for the next turn
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
    await tick()
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(fake.quitAndInstall.mock.invocationCallOrder[0])
  })

  it('quitAndInstall que falha vira erro na tela, não exceção solta', async () => {
    const u = await ready()
    fake.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('Squirrel: código de assinatura inválido')
    })
    await u.install(false)
    await tick()
    expect(last()).toMatchObject({ state: 'error' })
    expect(last()?.message).toContain('Squirrel: código de assinatura inválido')
  })
})
