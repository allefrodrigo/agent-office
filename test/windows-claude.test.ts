import { test } from 'vitest'
import assert from 'node:assert/strict'
import { FALLBACK_WARNING, sampleEveryMs, WindowsClaude, type ProcRow } from '../src/main/win-processes'

const NPM = 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
const DESKTOP = 'C:\\Program Files\\WindowsApps\\Claude_2.26454.2.0_x64__pzs8sxrjxfjjc\\app\\claude.exe'
const CORES = 12
const EVERY = sampleEveryMs(CORES) // 15 000 ms with 12 cores
const KB = 1024

const csv = (rows: [string, number, number][]) => rows.map(([name, pid, kb]) => `"${name}","${pid}","Console","1","${kb} K"`).join('\r\n')
const cim = (pid: number, path: string, ticks = 0): ProcRow => ({ pid, name: 'claude.exe', ticks, ws: 0, created: '1', path })
const flush = () => new Promise((r) => setImmediate(r))

/** WindowsClaude with fake tasklist/CIM/clock/warn; `answer` decides each CIM reply. */
function harness(answer: () => Promise<ProcRow[] | null>) {
  const s = { t: 1_000_000, list: '', queries: 0, warns: [] as string[] }
  const wc = new WindowsClaude({
    tasklist: async () => s.list,
    query: () => {
      s.queries++
      return answer()
    },
    now: () => s.t,
    warn: (m) => s.warns.push(m),
  })
  return { s, wc }
}

test('WindowsClaude: the Claude Desktop PID leaves count and memory; an unclassified PID counts as Claude Code', async () => {
  const { s, wc } = harness(async () => [cim(1, NPM), cim(2, DESKTOP)])
  s.list = csv([['claude.exe', 1, 100], ['claude.exe', 2, 900], ['claude.exe.bak', 5, 50]])
  // before the 1st sample nothing is classified: both claude.exe count
  assert.deepEqual(await wc.read(CORES), { count: 2, cpu: null, mem: 1000 * KB })
  await flush()
  assert.deepEqual(await wc.read(CORES), { count: 1, cpu: null, mem: 100 * KB })
  // a new PID shows up: counts as Claude Code until the next sample
  s.list = csv([['claude.exe', 1, 100], ['claude.exe', 2, 900], ['claude.exe', 3, 40]])
  assert.deepEqual(await wc.read(CORES), { count: 2, cpu: null, mem: 140 * KB })
})

test('WindowsClaude: 1st sample gives cpu null, the 2nd a number', async () => {
  let ticks = 0
  const { s, wc } = harness(async () => [cim(1, NPM, ticks), cim(2, DESKTOP, 999_999_999)])
  s.list = csv([['claude.exe', 1, 100], ['claude.exe', 2, 900]])
  await wc.read(CORES)
  await flush()
  assert.equal((await wc.read(CORES)).cpu, null)
  s.t += EVERY
  ticks = 0.1 * EVERY * 10_000 * CORES // 10 % of the machine over the interval
  await wc.read(CORES) // starts the 2nd sample
  await flush()
  assert.equal((await wc.read(CORES)).cpu, 10)
  assert.equal(s.queries, 2)
})

test('WindowsClaude: no new query before sampleEveryMs, except a new PID after 5 s', async () => {
  const { s, wc } = harness(async () => [cim(1, NPM)])
  s.list = csv([['claude.exe', 1, 100]])
  await wc.read(CORES)
  await flush()
  assert.equal(s.queries, 1)
  const t0 = s.t
  s.t = t0 + EVERY - 1
  await wc.read(CORES)
  assert.equal(s.queries, 1)
  s.t = t0 + EVERY
  await wc.read(CORES)
  await flush()
  assert.equal(s.queries, 2)

  const t1 = s.t
  s.list = csv([['claude.exe', 1, 100], ['claude.exe', 7, 10]]) // unknown PID 7
  s.t = t1 + WindowsClaude.SOON_MS - 1
  await wc.read(CORES)
  assert.equal(s.queries, 2)
  s.t = t1 + WindowsClaude.SOON_MS
  await wc.read(CORES)
  await flush()
  assert.equal(s.queries, 3)
})

test('WindowsClaude: no overlapping query while one is busy', async () => {
  let release: (rows: ProcRow[]) => void = () => {}
  const { s, wc } = harness(() => new Promise((r) => (release = r)))
  s.list = csv([['claude.exe', 1, 100]])
  await wc.read(CORES)
  for (let i = 0; i < 5; i++) {
    s.t += EVERY * 2
    await wc.read(CORES)
  }
  assert.equal(s.queries, 1)
  release([cim(1, NPM)])
  await flush()
  s.t += EVERY
  await wc.read(CORES)
  assert.equal(s.queries, 2)
})

test('WindowsClaude: on failure cpu is null, every claude.exe counts, one warning, retry only after 5 min', async () => {
  let fail = false
  const { s, wc } = harness(async () => (fail ? null : [cim(1, NPM, 0), cim(2, DESKTOP)]))
  s.list = csv([['claude.exe', 1, 100], ['claude.exe', 2, 900]])
  await wc.read(CORES)
  await flush()
  assert.equal((await wc.read(CORES)).count, 1) // Desktop classified and left out

  fail = true
  s.t += EVERY
  await wc.read(CORES)
  await flush()
  const tFail = s.t
  assert.deepEqual(await wc.read(CORES), { count: 2, cpu: null, mem: 1000 * KB }) // v0.2.0 behaviour
  assert.deepEqual(s.warns, [FALLBACK_WARNING])
  assert.equal(s.queries, 2)

  s.t = tFail + WindowsClaude.RETRY_MS - 1
  await wc.read(CORES)
  assert.equal(s.queries, 2) // even with unknown PIDs (classification was cleared)
  s.t = tFail + WindowsClaude.RETRY_MS
  await wc.read(CORES)
  await flush()
  assert.equal(s.queries, 3)
  assert.equal(s.warns.length, 1) // second failure: no new warning
  assert.equal((await wc.read(CORES)).cpu, null)
})
