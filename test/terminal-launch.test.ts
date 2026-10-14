import { test } from 'vitest'
import assert from 'node:assert/strict'
import { launchOnWindows, OPEN_FAILED, terminalEnv, wtArgs, wtCandidates, wtSafe, type Launcher, type LaunchOutcome } from '../src/main/terminal-launch'

const ID = '0b5c6a8e-3f1d-4c2a-9e7b-1a2b3c4d5e6f'
const EXE = 'C:\\Users\\Ana\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'

test('wtSafe: ; and control characters are unsafe; spaces, accents and quotes are fine', () => {
  assert.equal(wtSafe('C:\\tmp\\a;calc'), false)
  assert.equal(wtSafe('C:\\x; new-tab cmd /c calc'), false)
  assert.equal(wtSafe('C:\\tmp\\a\nb'), false)
  assert.equal(wtSafe('C:\\tmp\\a\tb'), false)
  assert.equal(wtSafe('C:\\tmp\\a\u007fb'), false)
  assert.equal(wtSafe('C:\\Users\\João\\Meus Projetos\\O\'Brien'), true)
  assert.equal(wtSafe(EXE), true)
})

test('wtArgs: new tab in the most recent window, constant title, exe then --resume id', () => {
  assert.deepEqual(wtArgs('C:\\Proj X', EXE, ID), ['-w', '0', 'new-tab', '-d', 'C:\\Proj X', '--title', 'Claude Code', EXE, '--resume', ID])
})

test('wtCandidates: Store alias by absolute path first, then PATH; no empty entry without LOCALAPPDATA', () => {
  assert.deepEqual(wtCandidates({ LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local' }), [
    'C:\\Users\\Ana\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe',
    'wt.exe',
  ])
  assert.deepEqual(wtCandidates({}), ['wt.exe'])
  assert.deepEqual(wtCandidates({ LOCALAPPDATA: '' }), ['wt.exe'])
})

test('terminalEnv: drops AGENT_OFFICE_* and ELECTRON_* (any case), keeps the rest', () => {
  const env = {
    PATH: 'C:\\Windows',
    Path: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\Ana',
    AGENT_OFFICE_MANAGED: '1',
    AGENT_OFFICE_DATA_DIR: 'C:\\tmp',
    ELECTRON_RUN_AS_NODE: '1',
    electron_no_attach_console: '1',
    MY_ELECTRON_APP: 'keep',
  }
  const out = terminalEnv(env)
  assert.deepEqual(out, { PATH: 'C:\\Windows', Path: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Ana', MY_ELECTRON_APP: 'keep' })
  assert.equal(env.AGENT_OFFICE_MANAGED, '1', 'input is not mutated')
})

/** Records calls and answers with scripted outcomes. */
function fake(wt: LaunchOutcome[], consoleOutcome: LaunchOutcome = 'ok') {
  const calls: { kind: 'wt' | 'console'; file: string; args: string[]; cwd?: string; env: NodeJS.ProcessEnv }[] = []
  const launcher: Launcher = {
    wt: async (file, args, env) => {
      calls.push({ kind: 'wt', file, args, env })
      return wt.shift() ?? 'missing'
    },
    console: async (exe, args, cwd, env) => {
      calls.push({ kind: 'console', file: exe, args, cwd, env })
      return consoleOutcome
    },
  }
  return { launcher, calls }
}

const ENV = { LOCALAPPDATA: 'C:\\L', PATH: 'C:\\Windows', AGENT_OFFICE_MANAGED: '1' }

test('launchOnWindows: Windows Terminal when the alias starts', async () => {
  const { launcher, calls } = fake(['ok'])
  assert.deepEqual(await launchOnWindows('C:\\Proj', EXE, ID, launcher, ENV), { ok: true, via: 'windows-terminal' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, 'C:\\L\\Microsoft\\WindowsApps\\wt.exe')
  assert.deepEqual(calls[0].args, wtArgs('C:\\Proj', EXE, ID))
  assert.equal(calls[0].env.AGENT_OFFICE_MANAGED, undefined)
})

test('launchOnWindows: missing alias tries wt.exe on PATH, then the console', async () => {
  const { launcher, calls } = fake(['missing', 'missing'])
  assert.deepEqual(await launchOnWindows('C:\\Proj', EXE, ID, launcher, ENV), { ok: true, via: 'console' })
  assert.deepEqual(calls.map((c) => c.file), ['C:\\L\\Microsoft\\WindowsApps\\wt.exe', 'wt.exe', EXE])
  assert.deepEqual(calls[2].args, ['--resume', ID])
  assert.equal(calls[2].cwd, 'C:\\Proj')
  assert.equal(calls[2].env.AGENT_OFFICE_MANAGED, undefined)
})

test('launchOnWindows: a folder with ; never reaches wt (no injected subcommand)', async () => {
  const { launcher, calls } = fake(['ok'])
  assert.deepEqual(await launchOnWindows('C:\\tmp\\a;calc', EXE, ID, launcher, ENV), { ok: true, via: 'console' })
  assert.deepEqual(calls.map((c) => c.kind), ['console'])
  assert.deepEqual(calls[0].args, ['--resume', ID])
  assert.equal(calls[0].cwd, 'C:\\tmp\\a;calc')
})

test('launchOnWindows: an exe path with ; also skips wt', async () => {
  const { launcher, calls } = fake(['ok'])
  await launchOnWindows('C:\\Proj', 'C:\\a;b\\claude.exe', ID, launcher, ENV)
  assert.deepEqual(calls.map((c) => c.kind), ['console'])
})

test('launchOnWindows: wt that ran and failed does not open a second terminal', async () => {
  const { launcher, calls } = fake(['failed'])
  assert.deepEqual(await launchOnWindows('C:\\Proj', EXE, ID, launcher, ENV), { ok: false, message: OPEN_FAILED })
  assert.equal(calls.length, 1)
})

test('launchOnWindows: console that cannot start reports the error', async () => {
  const { launcher } = fake(['missing', 'missing'], 'failed')
  assert.deepEqual(await launchOnWindows('C:\\Proj', EXE, ID, launcher, ENV), { ok: false, message: OPEN_FAILED })
})
