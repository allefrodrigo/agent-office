import { test } from 'node:test'
import assert from 'node:assert/strict'
import { osText, terminalError, terminalToast } from './os-text.ts'

test('osText darwin: the exact texts of v0.2.0', () => {
  const t = osText('darwin')
  assert.equal(t.revealTitle, 'Mostrar no Finder')
  assert.equal(t.cpuTitle, 'Uso de CPU do Mac inteiro')
  assert.equal(t.ramTitle, 'Memória em uso, como no Monitor de Atividade')
  assert.equal(t.agentsTitle, 'Todos os processos claude: agentes do escritório e sessões do terminal')
  assert.equal(
    t.closeSessionText('dev/app'),
    'O Claude Code rodando no terminal em …/dev/app vai ser encerrado, como se você fechasse aquela aba.\nA conversa fica salva: dá para voltar com claude --resume.',
  )
  assert.equal(t.copiedToast, 'Comando copiado. Cole no terminal.')
})

test('osText win32: Windows names, honest close text and PowerShell toast', () => {
  const t = osText('win32')
  assert.equal(t.revealTitle, 'Mostrar no Explorador')
  assert.equal(t.cpuTitle, 'Uso de CPU do computador inteiro')
  assert.equal(t.ramTitle, 'Memória em uso, como no Gerenciador de Tarefas')
  assert.match(t.agentsTitle, /sem o app Claude Desktop/)
  assert.equal(
    t.closeSessionText('Repo/app'),
    'O Claude Code rodando no terminal em …/Repo/app vai ser encerrado na hora (o Windows não tem fechamento suave).\nA conversa fica salva: dá para voltar com claude --resume.',
  )
  assert.equal(t.copiedToast, 'Comando copiado para o PowerShell.')
})

test('osText linux and unknown: neutral texts without Mac or Windows names', () => {
  for (const p of ['linux', 'freebsd', '']) {
    const t = osText(p)
    assert.equal(t.revealTitle, 'Mostrar na pasta')
    assert.equal(t.cpuTitle, 'Uso de CPU do computador inteiro')
    assert.equal(t.ramTitle, 'Memória em uso')
    const all = [t.revealTitle, t.cpuTitle, t.ramTitle, t.agentsTitle, t.closeSessionText('a/b'), t.copiedToast].join(' ')
    assert.doesNotMatch(all, /Mac|Finder|Monitor de Atividade|Windows|Explorador|Gerenciador|PowerShell/)
  }
})

test('terminalToast: one text per via; without via it depends on the OS', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.equal(terminalToast('windows-terminal', platform), 'Abrindo a sessão no Windows Terminal.')
    assert.equal(terminalToast('console', platform), 'Abrindo a sessão num terminal novo.')
    assert.equal(terminalToast('terminal-app', platform), 'Abrindo a sessão no Terminal.')
  }
  assert.equal(terminalToast(undefined, 'darwin'), 'Abrindo a sessão no Terminal.') // v0.2.0
  assert.equal(terminalToast(undefined, 'win32'), 'Abrindo a sessão num terminal novo.')
})

test('terminalError: the main process message wins; fallback by OS, darwin as in v0.2.0', () => {
  assert.equal(terminalError('Já estou abrindo um terminal.', 'darwin'), 'Já estou abrindo um terminal.')
  assert.equal(terminalError('A pasta dessa sessão é inválida.', 'win32'), 'A pasta dessa sessão é inválida.')
  assert.equal(terminalError(undefined, 'darwin'), 'Não consegui abrir o Terminal.')
  assert.equal(terminalError(undefined, 'win32'), 'Não consegui abrir o terminal. Use "Copiar comando".')
})
