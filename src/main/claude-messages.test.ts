import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeNotFoundMessage } from './claude-messages.ts'

// Text shipped in v0.2.0 (agents.ts run()); the Mac must keep it byte for byte (NFR-1).
const CURRENT =
  'Não encontrei o Claude Code neste computador.\n\n' +
  'Instale com `curl -fsSL https://claude.ai/install.sh | bash` (macOS/Linux) ou veja https://code.claude.com/docs, ' +
  'faça login rodando `claude` uma vez no terminal e tente de novo.'

test('claudeNotFoundMessage: macOS and Linux keep the current text', () => {
  assert.equal(claudeNotFoundMessage('darwin'), CURRENT)
  assert.equal(claudeNotFoundMessage('linux'), CURRENT)
})

test('claudeNotFoundMessage: Windows points to the PowerShell installer (ux-spec §5)', () => {
  assert.equal(
    claudeNotFoundMessage('win32'),
    'Não encontrei o Claude Code neste computador.\n\n' +
      'Instale no PowerShell com `irm https://claude.ai/install.ps1 | iex`, faça login rodando `claude` uma vez e tente de novo.',
  )
  assert.doesNotMatch(claudeNotFoundMessage('win32'), /install\.sh|curl/)
})
