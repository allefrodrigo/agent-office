import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpuPercent,
  encodePs,
  isClaudeImage,
  isDesktopPath,
  parseCimLines,
  parseTasklistCsv,
  powershellPath,
  psScript,
  sameClaudeProcess,
  sampleEveryMs,
  type ProcRow,
} from './win-processes.ts'

const NPM = 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
const DESKTOP = 'C:\\Program Files\\WindowsApps\\Claude_2.26454.2.0_x64__pzs8sxrjxfjjc\\app\\claude.exe'

test('powershellPath: absolute, from SystemRoot, never from PATH', () => {
  assert.equal(powershellPath({ SystemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.equal(powershellPath({}), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.equal(powershellPath({ PATH: 'C:\\evil' }), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
})

test('psScript: name filter, or a validated integer PID; anything else throws', () => {
  const all = psScript()
  assert.match(all, /-Filter "Name='claude\.exe'"/)
  assert.match(all, /\$ProgressPreference='SilentlyContinue'/)
  assert.match(all, /\[Console\]::OutputEncoding=\[Text\.Encoding\]::UTF8/)
  assert.doesNotMatch(all, /CommandLine/i)
  assert.match(psScript(1234), /-Filter "ProcessId=1234"/)
  for (const bad of [0, -1, 1.5, NaN, Infinity, 2 ** 53, '1;calc', '1234'] as unknown[]) {
    assert.throws(() => psScript(bad as number), /positive integer/)
  }
})

test('encodePs: base64 of UTF-16LE round-trips, accents included', () => {
  const s = psScript(42) + " # João"
  const b64 = encodePs(s)
  assert.match(b64, /^[A-Za-z0-9+/]+=*$/)
  assert.equal(Buffer.from(b64, 'base64').toString('utf16le'), s)
})

test('parseCimLines: real line, spaces and accents, empty fields, CRLF, BOM and junk', () => {
  const out =
    '\uFEFF18292\tclaude.exe\t37191250000\t366555136\t134352193202422190\t' + NPM + '\r\n' +
    '\r\n' +
    '5000\tclaude.exe\t10\t2048\t134352193202422191\tC:\\Users\\João\\Meus Apps\\claude.exe\r\n' +
    '6000\tclaude.exe\t0\t0\t\t\r\n' +
    'garbage line\r\n' +
    'x\tclaude.exe\t1\t1\t1\tC:\\a\r\n' +
    '7000\tclaude.exe\t-5\t1\t1\tC:\\a\n'
  assert.deepEqual(parseCimLines(out), [
    { pid: 18292, name: 'claude.exe', ticks: 37191250000, ws: 366555136, created: '134352193202422190', path: NPM },
    { pid: 5000, name: 'claude.exe', ticks: 10, ws: 2048, created: '134352193202422191', path: 'C:\\Users\\João\\Meus Apps\\claude.exe' },
    { pid: 6000, name: 'claude.exe', ticks: 0, ws: 0, created: null, path: null },
  ])
  assert.deepEqual(parseCimLines(''), [])
})

test('isDesktopPath: Claude Desktop (MSIX and legacy) only', () => {
  assert.equal(isDesktopPath(DESKTOP), true)
  assert.equal(isDesktopPath(DESKTOP.toUpperCase()), true)
  assert.equal(isDesktopPath('C:\\Users\\Ana\\AppData\\Local\\AnthropicClaude\\app-1.0\\claude.exe'), true)
  assert.equal(isDesktopPath(NPM), false)
  assert.equal(isDesktopPath('C:\\Users\\Ana\\.local\\bin\\claude.exe'), false)
  assert.equal(isDesktopPath(null), false)
})

const row = (pid: number, ticks: number, extra: Partial<ProcRow> = {}): ProcRow => ({ pid, name: 'claude.exe', ticks, ws: 0, created: '1', path: NPM, ...extra })

test('cpuPercent: share of the whole machine; new PIDs do not count; no overlap is null', () => {
  // 1 s of CPU (10^7 ticks) in 15 s on 12 cores ≈ 0.556 %
  const v = cpuPercent(new Map([[1, 0]]), [row(1, 10_000_000)], 15_000, 12)
  assert.ok(v !== null && Math.abs(v - 0.5556) < 0.001)
  // a new PID (2) is ignored; two known ones add up
  const sum = cpuPercent(new Map([[1, 0], [3, 0]]), [row(1, 10_000_000), row(2, 99_000_000), row(3, 10_000_000)], 10_000, 2)
  assert.equal(sum, 10)
  assert.equal(cpuPercent(new Map(), [row(1, 5)], 15_000, 12), null)
  assert.equal(cpuPercent(new Map([[9, 0]]), [row(1, 5)], 15_000, 12), null)
  // reused PID with fewer ticks counts as idle, not negative
  assert.equal(cpuPercent(new Map([[1, 500]]), [row(1, 100)], 15_000, 12), 0)
  assert.equal(cpuPercent(new Map([[1, 0]]), [row(1, 5)], 0, 12), null)
  assert.equal(cpuPercent(new Map([[1, 0]]), [row(1, 5)], 1000, 0), null)
})

test('sampleEveryMs: 100 s / cores, between 15 s and 60 s', () => {
  assert.deepEqual([1, 2, 4, 8, 12, 64].map(sampleEveryMs), [60_000, 50_000, 25_000, 15_000, 15_000, 15_000])
  assert.equal(sampleEveryMs(0), 60_000)
  assert.equal(sampleEveryMs(NaN), 60_000)
})

test('parseTasklistCsv: pt-BR and en-US output, "no tasks" message, exact names', () => {
  const out =
    '"claude.exe","18292","Console","1","362.936 K"\r\n' +
    '"claude.exe","4","Services","0","1,024 K"\r\n' +
    '"myclaude.exe","77","Console","1","10 K"\r\n' +
    '"claude.exe.bak","78","Console","1","10 K"\r\n'
  const rows = parseTasklistCsv(out)
  assert.deepEqual(rows, [
    { name: 'claude.exe', pid: 18292, mem: 362936 * 1024 },
    { name: 'claude.exe', pid: 4, mem: 1024 * 1024 },
    { name: 'myclaude.exe', pid: 77, mem: 10 * 1024 },
    { name: 'claude.exe.bak', pid: 78, mem: 10 * 1024 },
  ])
  assert.deepEqual(rows.filter((r) => isClaudeImage(r.name)).map((r) => r.pid), [18292, 4])
  assert.deepEqual(parseTasklistCsv('INFORMAÇÕES: Nenhuma tarefa em execução corresponde aos critérios especificados.\r\n'), [])
  assert.deepEqual(parseTasklistCsv('INFO: No tasks are running which match the specified criteria.'), [])
  assert.equal(isClaudeImage('CLAUDE.EXE'), true)
})

test('sameClaudeProcess: exact name, not Claude Desktop, same creation time when known', () => {
  assert.equal(sameClaudeProcess(row(1, 0, { created: '100' }), '100'), true)
  assert.equal(sameClaudeProcess(row(1, 0, { created: '100' }), undefined), true)
  assert.equal(sameClaudeProcess(row(1, 0, { created: null }), '100'), true)
  assert.equal(sameClaudeProcess(row(1, 0, { created: '200' }), '100'), false) // PID reused
  assert.equal(sameClaudeProcess(row(1, 0, { path: DESKTOP }), undefined), false)
  assert.equal(sameClaudeProcess(row(1, 0, { name: 'notepad.exe' }), undefined), false)
  assert.equal(sameClaudeProcess(row(1, 0, { name: 'myclaude.exe' }), undefined), false)
  assert.equal(sameClaudeProcess(undefined, '100'), false)
})
