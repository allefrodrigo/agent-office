import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bangCommand, clipOutput, runShell, shellContext, shellFor, shellLogText } from '../src/main/shell-mode'

describe('bangCommand', () => {
  it('pega o comando depois do !', () => {
    expect(bangCommand('! git push origin main')).toBe('git push origin main')
    expect(bangCommand('  !ls -la\n')).toBe('ls -la')
  })
  it('ignora mensagens comuns e ! vazio', () => {
    expect(bangCommand('faz o push')).toBeNull()
    expect(bangCommand('ok!')).toBeNull()
    expect(bangCommand('!   ')).toBeNull()
  })
})

describe('shellFor', () => {
  it('usa o SHELL do usuário, ou PowerShell no Windows', () => {
    expect(shellFor('darwin', 'ls', { SHELL: '/bin/zsh' })).toEqual({ file: '/bin/zsh', args: ['-c', 'ls'] })
    expect(shellFor('linux', 'ls', {})).toEqual({ file: '/bin/sh', args: ['-c', 'ls'] })
    expect(shellFor('win32', 'dir').file).toBe('powershell.exe')
  })
})

describe('clipOutput', () => {
  it('mantém começo e fim de saídas grandes', () => {
    const out = clipOutput('a'.repeat(50) + 'b'.repeat(50), 20)
    expect(out.startsWith('a'.repeat(10))).toBe(true)
    expect(out.endsWith('b'.repeat(10))).toBe(true)
    expect(out).toContain('80 caracteres cortados')
  })
})

describe.skipIf(process.platform === 'win32')('runShell', () => {
  it('roda na pasta pedida e separa stdout, stderr e código', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'shell-mode-')))
    const r = await runShell('pwd; echo erro >&2; exit 3', dir)
    expect(r.stdout.trim()).toBe(dir)
    expect(r.stderr.trim()).toBe('erro')
    expect(r.code).toBe(3)
    expect(shellLogText(r)).toContain('Terminou com código 3.')
    expect(shellContext('x', r)).toBe(`<bash-input>x</bash-input>\n<bash-stdout>${dir}</bash-stdout>\n<bash-stderr>erro\nTerminou com código 3.</bash-stderr>`)
  })
  it('não espera entrada: stdin fechado', async () => {
    const r = await runShell('cat', tmpdir())
    expect(r.code).toBe(0)
  })
})
