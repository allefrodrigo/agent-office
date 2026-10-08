import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeCandidates } from './claude-path.ts'

const HOME = 'C:\\Users\\Ana'
const WIN_ENV = {
  PATH: 'C:\\Windows\\system32;"C:\\Program Files\\Tools";;C:\\Users\\Ana\\bin\\',
  APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local',
  NVM_SYMLINK: 'C:\\nvm4w\\nodejs',
}

test('claudeCandidates win32: exact order of the ADR-run-1', () => {
  assert.deepEqual(claudeCandidates({ ...WIN_ENV, AGENT_OFFICE_CLAUDE: 'D:\\tools\\claude.exe' }, 'win32', HOME), [
    'D:\\tools\\claude.exe',
    'C:\\Windows\\system32\\claude.exe',
    'C:\\Program Files\\Tools\\claude.exe',
    'C:\\Users\\Ana\\bin\\claude.exe',
    'C:\\Users\\Ana\\.local\\bin\\claude.exe',
    'C:\\Users\\Ana\\.claude\\local\\claude.exe',
    'C:\\Users\\Ana\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
    'C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
    'C:\\Users\\Ana\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe',
    'C:\\Users\\Ana\\AppData\\Local\\Programs\\claude\\claude.exe',
  ])
})

test('claudeCandidates win32: reads Path when PATH is absent (plain objects are case-sensitive)', () => {
  const list = claudeCandidates({ Path: 'C:\\bin' }, 'win32', HOME)
  assert.equal(list[0], 'C:\\bin\\claude.exe')
})

test('claudeCandidates win32: missing variables add no empty or relative entries', () => {
  const list = claudeCandidates({}, 'win32', HOME)
  assert.deepEqual(list, ['C:\\Users\\Ana\\.local\\bin\\claude.exe', 'C:\\Users\\Ana\\.claude\\local\\claude.exe'])
  const blank = claudeCandidates({ APPDATA: '', LOCALAPPDATA: '', NVM_SYMLINK: '', PATH: '' }, 'win32', HOME)
  assert.deepEqual(blank, list)
  for (const c of blank) assert.match(c, /^[A-Z]:\\/)
})

test('claudeCandidates win32: never offers claude.cmd or claude.ps1 (they need a shell)', () => {
  for (const c of claudeCandidates(WIN_ENV, 'win32', HOME)) assert.match(c, /\\claude\.exe$/)
})

test('claudeCandidates darwin: same list as v0.2.0', () => {
  assert.deepEqual(claudeCandidates({ PATH: '/usr/bin:/bin::/Users/ana/.npm/bin/', AGENT_OFFICE_CLAUDE: '/x/claude' }, 'darwin', '/Users/ana'), [
    '/x/claude',
    '/usr/bin/claude',
    '/bin/claude',
    '/Users/ana/.npm/bin/claude',
    '/Users/ana/.local/bin/claude',
    '/Users/ana/.claude/local/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ])
  assert.deepEqual(claudeCandidates({}, 'darwin', '/Users/ana'), [
    '/Users/ana/.local/bin/claude',
    '/Users/ana/.claude/local/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ])
})

test('claudeCandidates linux: same rules as darwin, no Windows folders', () => {
  const list = claudeCandidates({ ...WIN_ENV, PATH: '/usr/bin' }, 'linux', '/home/ana')
  assert.deepEqual(list, ['/usr/bin/claude', '/home/ana/.local/bin/claude', '/home/ana/.claude/local/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude'])
})
