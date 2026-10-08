import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUSY_MESSAGE, checkResumeTarget, createOpenGuard, createThrottle, INVALID_CWD_MESSAGE, NO_CLAUDE_MESSAGE, OPEN_THROTTLE_MS } from './resume-guard.ts'

const EXE = 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
const exists = () => true

test('checkResumeTarget win32: an absolute existing folder with a .exe is accepted', () => {
  assert.deepEqual(checkResumeTarget('C:\\x', 'win32', EXE, exists), { ok: true, exe: EXE })
  assert.deepEqual(checkResumeTarget('C:\\x', 'win32', 'C:\\X\\CLAUDE.EXE', exists), { ok: true, exe: 'C:\\X\\CLAUDE.EXE' })
})

test('checkResumeTarget: relative or control characters are refused with the same message', () => {
  for (const cwd of ['x\\y', 'C:\\a\nb', 'C:\\a\u007fb', 'C:\\a\tb', 'C:\\a\u0000b']) {
    assert.deepEqual(checkResumeTarget(cwd, 'win32', EXE, exists), { ok: false, message: INVALID_CWD_MESSAGE }, JSON.stringify(cwd))
  }
  assert.equal(INVALID_CWD_MESSAGE, 'A pasta dessa sessão é inválida. Abra um terminal na pasta do projeto e use "Copiar comando".')
  assert.deepEqual(checkResumeTarget('x/y', 'darwin', undefined, exists), { ok: false, message: INVALID_CWD_MESSAGE })
  assert.deepEqual(checkResumeTarget('/Users/a\nb', 'darwin', undefined, exists), { ok: false, message: INVALID_CWD_MESSAGE })
})

test('checkResumeTarget: a missing folder names it; the disk is not touched for an invalid cwd', () => {
  assert.deepEqual(checkResumeTarget('C:\\sumiu', 'win32', EXE, () => false), { ok: false, message: 'A pasta C:\\sumiu não existe mais.' })
  let probed = false
  checkResumeTarget('rel', 'win32', EXE, () => (probed = true))
  assert.equal(probed, false)
})

test('checkResumeTarget win32: only a .exe runs (no .cmd, .ps1 or missing claude)', () => {
  for (const exe of ['C:\\npm\\claude.cmd', 'C:\\npm\\claude.ps1', undefined, '']) {
    assert.deepEqual(checkResumeTarget('C:\\x', 'win32', exe, exists), { ok: false, message: NO_CLAUDE_MESSAGE }, String(exe))
  }
  assert.equal(NO_CLAUDE_MESSAGE, 'Não encontrei o Claude Code neste computador. Instale e tente de novo, ou use "Copiar comando".')
})

test('checkResumeTarget darwin: no exe needed, POSIX absolute path accepted', () => {
  assert.deepEqual(checkResumeTarget('/Users/ana/proj', 'darwin', undefined, exists), { ok: true })
})

test('createThrottle: 2nd call at 1 499 ms refused, at 1 500 ms accepted', () => {
  let t = 0
  const allow = createThrottle(OPEN_THROTTLE_MS, () => t)
  assert.equal(OPEN_THROTTLE_MS, 1500)
  assert.equal(allow(), true)
  t = 1499
  assert.equal(allow(), false)
  t = 1500
  assert.equal(allow(), true)
  // a refused call does not move the window
  t = 2999
  assert.equal(allow(), false)
  t = 3000
  assert.equal(allow(), true)
})

test('createOpenGuard: an invalid call also consumes the window', () => {
  let t = 1_000_000
  const guard = createOpenGuard(() => t)
  const claude = () => EXE
  assert.deepEqual(guard('relativa', 'win32', claude, exists), { ok: false, message: INVALID_CWD_MESSAGE })
  t += 1499
  assert.deepEqual(guard('C:\\x', 'win32', claude, exists), { ok: false, message: BUSY_MESSAGE })
  assert.equal(BUSY_MESSAGE, 'Já estou abrindo um terminal.')
  t += 1
  assert.deepEqual(guard('C:\\x', 'win32', claude, exists), { ok: true, exe: EXE })
})

test('createOpenGuard: claude is looked up only on win32 and only after the throttle', () => {
  let t = 0
  let lookups = 0
  const guard = createOpenGuard(() => t)
  const claude = () => (lookups++, EXE)
  guard('/Users/a', 'darwin', claude, exists)
  assert.equal(lookups, 0)
  t = 2000
  guard('C:\\x', 'win32', claude, exists)
  assert.equal(lookups, 1)
  guard('C:\\x', 'win32', claude, exists) // throttled
  assert.equal(lookups, 1)
})
