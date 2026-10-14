import { test } from 'vitest'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { ClaudeIdentities, type ProcRow } from '../src/main/win-processes'
import { terminate } from '../src/main/session-process'

const NPM = 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
const DESKTOP = 'C:\\Program Files\\WindowsApps\\Claude_2.26454.2.0_x64__pzs8sxrjxfjjc\\app\\claude.exe'

const row = (pid: number, over: Partial<ProcRow> = {}): ProcRow => ({ pid, name: 'claude.exe', ticks: 0, ws: 0, created: '111', path: NPM, ...over })
const noTasklist = async () => {
  throw new Error('tasklist should not run')
}

test('ClaudeIdentities.remember: only claude.exe outside Claude Desktop with a creation time', async () => {
  const cases: [string, ProcRow[] | null, string | undefined][] = [
    ['Claude Code', [row(10)], '111'],
    ['Claude Desktop', [row(10, { path: DESKTOP })], undefined],
    ['no creation time', [row(10, { created: null })], undefined],
    ['other image', [row(10, { name: 'node.exe' })], undefined],
    ['other PID only', [row(11)], undefined],
    ['PowerShell unavailable', null, undefined],
  ]
  for (const [label, rows, expected] of cases) {
    const ids = new ClaudeIdentities(async () => rows, noTasklist)
    await ids.remember(10)
    assert.equal(ids.get(10), expected, label)
  }
})

test('ClaudeIdentities: past 256 entries the oldest goes', async () => {
  const ids = new ClaudeIdentities(async (pid) => [row(pid, { created: String(pid * 7) })], noTasklist)
  for (let pid = 1; pid <= 256; pid++) await ids.remember(pid)
  assert.equal(ids.size, 256)
  await ids.remember(1) // learned again: becomes the newest
  await ids.remember(257)
  assert.equal(ids.size, 256)
  assert.equal(ids.get(2), undefined)
  assert.equal(ids.get(1), '7')
  assert.equal(ids.get(257), '1799')
})

test('ClaudeIdentities.check: a different creation time is false and forgets the entry', async () => {
  let created = '111'
  const ids = new ClaudeIdentities(async (pid) => [row(pid, { created })], noTasklist)
  await ids.remember(10)
  assert.equal(await ids.check(10), true)
  assert.equal(ids.get(10), '111')
  created = '222' // PID reused by another claude.exe
  assert.equal(await ids.check(10), false)
  assert.equal(ids.get(10), undefined)
})

test('ClaudeIdentities.check: Claude Desktop or a missing row is false', async () => {
  assert.equal(await new ClaudeIdentities(async (pid) => [row(pid, { path: DESKTOP })], noTasklist).check(10), false)
  assert.equal(await new ClaudeIdentities(async () => [], noTasklist).check(10), false)
})

test('ClaudeIdentities.check without PowerShell: tasklist by PID, exact image name', async () => {
  const asked: number[] = []
  const answer = (out: string) =>
    new ClaudeIdentities(
      async () => null,
      async (pid) => {
        asked.push(pid)
        return out
      },
    )
  assert.equal(await answer('"claude.exe","10","Console","1","1.024 K"').check(10), true)
  assert.equal(await answer('"Claude.EXE","10","Console","1","1.024 K"').check(10), true)
  assert.equal(await answer('"claude.exe.bak","10","Console","1","1.024 K"').check(10), false)
  assert.equal(await answer('"myclaude.exe","10","Console","1","1.024 K"').check(10), false)
  assert.equal(await answer('"claude.exe","11","Console","1","1.024 K"').check(10), false)
  assert.equal(await answer('INFORMAÇÕES: Nenhuma tarefa em execução corresponde aos critérios especificados.').check(10), false)
  assert.deepEqual(asked, [10, 10, 10, 10, 10, 10])
})

test('terminate: a process that exits is forgotten by the registry', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  await new Promise((r) => child.once('spawn', r))
  const pid = child.pid!
  const ids = new ClaudeIdentities(async (p) => [row(p)], noTasklist)
  await ids.remember(pid)
  assert.equal(ids.get(pid), '111')
  try {
    assert.equal(await terminate(pid, ids), true)
    assert.equal(ids.get(pid), undefined)
  } finally {
    child.kill()
  }
})
