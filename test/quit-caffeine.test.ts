import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSummary, BgProcess } from '../src/shared/types'

const h = vi.hoisted(() => ({
  quit: vi.fn(),
  answers: [] as { response: number; checkboxChecked: boolean }[],
  shown: [] as { message?: string; checkboxLabel?: string }[],
  blockers: new Set<number>(),
  next: 1,
}))

vi.mock('electron', () => ({
  app: { quit: h.quit, isPackaged: false, getPath: () => '' },
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      const opts = args.at(-1) as { message?: string; checkboxLabel?: string }
      h.shown.push(opts)
      return h.answers.shift() ?? { response: 1, checkboxChecked: false }
    },
  },
  powerSaveBlocker: {
    start: () => {
      const id = h.next++
      h.blockers.add(id)
      return id
    },
    stop: (id: number) => h.blockers.delete(id),
    isStarted: (id: number) => h.blockers.has(id),
  },
}))

const { QuitFlow } = await import('../src/main/quit')
const { Caffeine } = await import('../src/main/caffeine')

const agent = (name: string) => ({ id: `id-${name}`, name, activity: 'editando', status: 'working', source: 'office' }) as AgentSummary
const proc = (id: string) =>
  ({ id, label: 'npm run dev', ports: [5173], kind: 'server', owner: { kind: 'office', name: 'Ada' } }) as unknown as BgProcess

function flow(working: AgentSummary[] = [], bg: BgProcess[] = []) {
  const deps = {
    win: () => null,
    working: vi.fn(() => [...working]),
    pending: vi.fn(() => 0),
    interrupt: vi.fn(async (_id: string) => undefined),
    background: () => bg,
    stopProcess: vi.fn(async () => undefined),
    holdRoutines: vi.fn(),
    broadcast: vi.fn(),
  }
  return { q: new QuitFlow(deps), deps }
}

beforeEach(() => {
  h.quit.mockReset()
  h.answers = []
  h.shown = []
})

describe('sair do Agent Office', () => {
  it('⌘Q sem ninguém trabalhando sai direto; com agente trabalhando pergunta', () => {
    expect(flow().q.intercept()).toBe(false)
    const { q } = flow([agent('Ada')])
    expect(q.intercept()).toBe(true)
  })

  it('sem agentes: confirma e para os processos em segundo plano marcados', async () => {
    const { q, deps } = flow([], [proc('pid:1')])
    h.answers.push({ response: 0, checkboxChecked: true })
    expect(await q.ask()).toBe('quit')
    expect(h.shown[0].checkboxLabel).toContain('1 processo')
    expect(deps.stopProcess).toHaveBeenCalledWith('pid:1')
    expect(h.quit).toHaveBeenCalledOnce()
    // already confirmed: before-quit lets it through
    expect(q.intercept()).toBe(false)
  })

  it('cancelar não sai nem para nada', async () => {
    const { q, deps } = flow([agent('Ada')], [proc('pid:1')])
    h.answers.push({ response: 2, checkboxChecked: true })
    expect(await q.ask()).toBe('cancelled')
    expect(h.quit).not.toHaveBeenCalled()
    expect(deps.interrupt).not.toHaveBeenCalled()
    expect(deps.stopProcess).not.toHaveBeenCalled()
  })

  it('interromper e sair: interrompe cada agente e mantém os processos se desmarcado', async () => {
    const { q, deps } = flow([agent('Ada'), agent('Barbara')], [proc('pid:1')])
    h.answers.push({ response: 1, checkboxChecked: false })
    expect(await q.ask()).toBe('quit')
    expect(deps.interrupt).toHaveBeenCalledTimes(2)
    expect(deps.stopProcess).not.toHaveBeenCalled()
    expect(h.quit).toHaveBeenCalledOnce()
  })

  describe('esperar terminarem', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('segura as rotinas, avisa e sai quando o último termina', async () => {
      const working = [agent('Ada')]
      const { q, deps } = flow(working)
      h.answers.push({ response: 0, checkboxChecked: false })
      expect(await q.ask()).toBe('waiting')
      expect(deps.holdRoutines).toHaveBeenCalledWith(true)
      expect(deps.broadcast).toHaveBeenLastCalledWith({ working: 1, pending: 0 })
      expect(h.quit).not.toHaveBeenCalled()
      working.length = 0
      await vi.advanceTimersByTimeAsync(2100)
      expect(h.quit).toHaveBeenCalledOnce()
    })

    it('"Ficar" cancela a espera e solta as rotinas', async () => {
      const { q, deps } = flow([agent('Ada')])
      h.answers.push({ response: 0, checkboxChecked: false })
      await q.ask()
      q.cancelWait()
      expect(deps.holdRoutines).toHaveBeenLastCalledWith(false)
      expect(deps.broadcast).toHaveBeenLastCalledWith(null)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(h.quit).not.toHaveBeenCalled()
    })
  })
})

describe('cantinho do café', () => {
  it('segura a tela conforme o modo e os agentes', () => {
    let mode: 'off' | 'agents' | 'on' = 'off'
    let working = 0
    const changed = vi.fn()
    const c = new Caffeine({ mode: () => mode, working: () => working, changed })
    c.check()
    expect(c.awake).toBe(false)
    mode = 'agents'
    c.check()
    expect(c.awake).toBe(false)
    working = 2
    c.check()
    expect(c.awake).toBe(true)
    expect(changed).toHaveBeenLastCalledWith(true)
    working = 0
    c.check()
    expect(c.awake).toBe(false)
    mode = 'on'
    c.check()
    expect(c.awake).toBe(true)
    c.stop()
    expect(c.awake).toBe(false)
    expect(h.blockers.size).toBe(0)
  })
})
