import { closeCrm, openCrm } from './index'
import { crmStore } from './store'

/** What `npm run bench -- --crm` writes under `crm` in out/bench.json. */
export interface CrmBenchReport {
  customers: number
  payments: number
  /** crmList over IPC plus applying it in the store, cold (ms). */
  loadMs: number
  /** From openCrm to the first frame with the customers table drawn (ms). */
  openMs: number
  /** Rows in the DOM after opening: the virtual list keeps this small whatever the count. */
  domRows: number
  frames: number
  frameMs: { mean: number; p95: number; max: number }
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r))
const round = (n: number) => Math.round(n * 10) / 10

async function until(test: () => boolean, ms = 10_000): Promise<void> {
  const end = performance.now() + ms
  while (!test()) {
    if (performance.now() > end) throw new Error('A tabela de clientes do CRM não apareceu a tempo.')
    await nextFrame()
  }
}

/**
 * Sala de CRM bench (CR-07): loads crm.json, opens the screen on Clientes and scrolls the
 * table up and down for `ms`, one step per frame, recording each frame's time.
 */
export async function crmBench(ms: number): Promise<CrmBenchReport> {
  const t0 = performance.now()
  await crmStore.reload()
  const loadMs = performance.now() - t0
  const data = crmStore.data
  if (!data) throw new Error(crmStore.error ?? 'O CRM não carregou.')

  const t1 = performance.now()
  openCrm({ tab: 'customers' })
  const rows = () => document.querySelector('.crm-screen .crm-rows')
  await until(() => (rows()?.childElementCount ?? 0) > 0)
  await nextFrame()
  const openMs = performance.now() - t1
  const domRows = rows()?.childElementCount ?? 0

  const scroll = document.querySelector<HTMLElement>('.crm-screen .crm-scroll')
  if (!scroll) throw new Error('A tabela de clientes do CRM não tem área de rolagem.')
  const frames: number[] = []
  // About 2 400 px/s at 60 fps: a fast flick, which makes the virtual list redraw often.
  const step = 40
  let dir = 1
  let last = await nextFrame()
  const end = last + ms
  while (last < end) {
    const max = scroll.scrollHeight - scroll.clientHeight
    if ((dir > 0 && scroll.scrollTop >= max) || (dir < 0 && scroll.scrollTop <= 0)) dir = -dir
    scroll.scrollTop = Math.min(max, Math.max(0, scroll.scrollTop + dir * step))
    const now = await nextFrame()
    frames.push(now - last)
    last = now
  }
  closeCrm()

  const sorted = [...frames].sort((a, b) => a - b)
  const mean = frames.reduce((s, f) => s + f, 0) / Math.max(1, frames.length)
  return {
    customers: data.customers.length,
    payments: data.payments.length,
    loadMs: round(loadMs),
    openMs: round(openMs),
    domRows,
    frames: frames.length,
    frameMs: { mean: round(mean), p95: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0), max: round(sorted.at(-1) ?? 0) },
  }
}
