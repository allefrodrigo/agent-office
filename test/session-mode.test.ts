import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastPermissionMode } from '../src/main/sessions'

const ID = '11111111-2222-3333-4444-555555555555'
let root = ''

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  if (root) rmSync(root, { recursive: true, force: true })
})

function saved(lines: object[]): void {
  root = mkdtempSync(join(tmpdir(), 'ao-mode-'))
  const dir = join(root, 'projects', '-w-repo')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${ID}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'))
  process.env.CLAUDE_CONFIG_DIR = root
}

describe('modo de permissão de uma sessão salva', () => {
  it('pega o último modo do transcript', async () => {
    saved([
      { type: 'user', permissionMode: 'default' },
      { type: 'assistant' },
      { type: 'user', permissionMode: 'auto' },
    ])
    expect(await lastPermissionMode(ID)).toBe('auto')
  })

  it('ignora a mesma chave dentro de ferramentas e de outros registros', async () => {
    saved([
      { type: 'user', permissionMode: 'default' },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__x__y', input: { permissionMode: 'auto' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: { permissionMode: 'acceptEdits' } }] } },
      { type: 'system', permissionMode: 'auto' },
    ])
    expect(await lastPermissionMode(ID)).toBe('default')
  })

  it('sem modo gravado ou sem arquivo, não inventa', async () => {
    saved([{ type: 'user' }])
    expect(await lastPermissionMode(ID)).toBeNull()
    expect(await lastPermissionMode('99999999-2222-3333-4444-555555555555')).toBeNull()
  })
})
