import { test } from 'vitest'
import assert from 'node:assert/strict'
import { resumeCommand } from '../src/shared/commands'

const ID = '0f8e2c1a-5b3d-4e6f-9a7b-1c2d3e4f5a6b'
/** The command v0.2.0 built inline in modals.ts, for the equality check on the Mac. */
const legacy = (cwd: string) => `cd '${cwd.replace(/'/g, `'\\''`)}' && claude --resume ${ID}`

test('resumeCommand win32: Set-Location -LiteralPath for PowerShell 5.1', () => {
  assert.equal(resumeCommand('win32', 'C:\\Proj', ID), `Set-Location -LiteralPath 'C:\\Proj'; claude --resume ${ID}`)
  assert.equal(
    resumeCommand('win32', 'C:\\Users\\João\\Meus Projetos\\[app]', ID),
    `Set-Location -LiteralPath 'C:\\Users\\João\\Meus Projetos\\[app]'; claude --resume ${ID}`,
  )
})

test('resumeCommand win32: doubles straight and typographic single quotes', () => {
  assert.equal(resumeCommand('win32', "C:\\O'Brien", ID), `Set-Location -LiteralPath 'C:\\O''Brien'; claude --resume ${ID}`)
  assert.equal(resumeCommand('win32', 'C:\\‘x’', ID), `Set-Location -LiteralPath 'C:\\‘‘x’’'; claude --resume ${ID}`)
  assert.equal(resumeCommand('win32', 'C:\\a‚b‛c', ID), `Set-Location -LiteralPath 'C:\\a‚‚b‛‛c'; claude --resume ${ID}`)
  // ; inside the quotes is a literal character for PowerShell, not a separator
  assert.equal(resumeCommand('win32', 'C:\\tmp\\a;calc', ID), `Set-Location -LiteralPath 'C:\\tmp\\a;calc'; claude --resume ${ID}`)
})

test('resumeCommand: no cwd or a control character in it gives only claude --resume', () => {
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.equal(resumeCommand(p, undefined, ID), `claude --resume ${ID}`)
    assert.equal(resumeCommand(p, '', ID), `claude --resume ${ID}`)
    assert.equal(resumeCommand(p, 'C:\\a\nRemove-Item x', ID), `claude --resume ${ID}`)
    assert.equal(resumeCommand(p, '/tmp/a\rb', ID), `claude --resume ${ID}`)
    assert.equal(resumeCommand(p, '/tmp/a\u007fb', ID), `claude --resume ${ID}`)
  }
})

test('resumeCommand: a session id that is not a UUID gives an empty string', () => {
  for (const id of ['', 'abc', `${ID}; calc`, `${ID}\n`, '../../etc']) {
    assert.equal(resumeCommand('win32', 'C:\\Proj', id), '')
    assert.equal(resumeCommand('darwin', '/Users/a', id), '')
  }
})

test('resumeCommand darwin and linux: identical to v0.2.0, quotes included', () => {
  for (const cwd of ['/Users/ana/dev/app', "/Users/ana/O'Brien's app", '/tmp/a;b', '/Users/ana/‘x’']) {
    assert.equal(resumeCommand('darwin', cwd, ID), legacy(cwd))
    assert.equal(resumeCommand('linux', cwd, ID), legacy(cwd))
  }
  assert.equal(resumeCommand('darwin', "/a/O'B", ID), `cd '/a/O'\\''B' && claude --resume ${ID}`)
})
