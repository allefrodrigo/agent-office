import { describe, expect, it } from 'vitest'
import type { LogEntry } from '@shared/types'
import { conversationMarkdown, exportFileName, fence, finalReport } from '@shared/export-md'
import { copyTextSchema, markdownFileName, saveMarkdownArgsSchema } from '../src/main/validate'

// AO-36: exportação da conversa em Markdown e os canais que salvam e copiam.

const t0 = new Date(2026, 9, 12, 9, 30).getTime()
const log: LogEntry[] = [
  { id: '1', t: t0, kind: 'user', text: 'Conserte o login\nsem mexer no layout', attachments: [{ name: 'print.png', kind: 'image', size: 10 }] },
  { id: '2', t: t0 + 60e3, kind: 'assistant', text: 'Vou olhar o **auth.ts**.' },
  { id: '3', t: t0 + 70e3, kind: 'tool', tool: 'Bash', text: 'npm test' },
  { id: '4', t: t0 + 80e3, kind: 'tool_result', text: 'ok ```code``` 3 testes', isError: false },
  { id: '5', t: t0 + 90e3, kind: 'error', text: 'Falhou a rede' },
  { id: '6', t: t0 + 95e3, kind: 'decision', text: 'Permitido: npm test' },
  { id: '7', t: t0 + 120e3, kind: 'result', text: 'Login corrigido.\n\n- auth.ts' },
]

describe('conversationMarkdown', () => {
  it('cabeçalho com agente, pasta, modelo, custo e datas', () => {
    const md = conversationMarkdown({ agent: 'Joana', cwd: '/Users/x/proj', model: 'claude-opus-5-5', costUsd: 1.234, startedAt: t0, sessionId: 'abc', exportedAt: t0 + 3600e3 }, log)
    expect(md).toMatch(/^# Joana\n/)
    expect(md).toContain('- **Pasta:** `/Users/x/proj`')
    expect(md).toContain('- **Modelo:** claude-opus-5-5')
    expect(md).toContain('- **Custo:** $1,23')
    expect(md).toContain('- **Início:** 12/10/2026 09:30')
    expect(md).toContain('- **Exportado em:** 12/10/2026 10:30')
    expect(md).toContain('## Conversa')
  })

  it('nome vazio vira "Agente" no título e nas falas', () => {
    const md = conversationMarkdown({ agent: '  ', cwd: '/p' }, log)
    expect(md).toMatch(/^# Agente\n/)
    expect(md).toContain('### Agente · 09:31')
  })

  it('conversa legível: falas, ferramentas, erros e resultado', () => {
    const md = conversationMarkdown({ agent: 'Joana', cwd: '/p' }, log)
    expect(md).toContain('### Você · 09:30\n\n> Conserte o login\n> sem mexer no layout\n\n- anexo: print.png')
    expect(md).toContain('### Joana · 09:31\n\nVou olhar o **auth.ts**.')
    expect(md).toContain('- **Bash** · 09:31: `npm test`')
    // a saída tem ``` dentro: a cerca precisa ser maior
    expect(md).toContain('````\nok ```code``` 3 testes\n````')
    expect(md).toContain('> **Erro · 09:31:** Falhou a rede')
    expect(md).toContain('## Resultado · 09:32\n\nLogin corrigido.')
    expect(md).not.toMatch(/\n{3,}/)
  })

  it('saída longa de ferramenta é cortada', () => {
    const big = Array.from({ length: 100 }, (_, i) => `linha ${i}`).join('\n')
    const md = conversationMarkdown({ agent: 'A', cwd: '/p' }, [{ id: '1', t: t0, kind: 'tool_result', text: big }])
    expect(md).toContain('linha 39\n… (60 linhas a mais)')
    expect(md).not.toContain('linha 40')
  })

  it('conversa vazia avisa', () => {
    expect(conversationMarkdown({ agent: 'A', cwd: '/p' }, [])).toContain('_(conversa vazia)_')
  })
})

describe('apoio', () => {
  it('relatório final é o último resultado', () => {
    expect(finalReport(log)).toBe('Login corrigido.\n\n- auth.ts')
    expect(finalReport(log.slice(0, 3))).toBe('')
  })

  it('nome de arquivo sem acentos nem barras', () => {
    expect(exportFileName('João Álvares', '/Users/x/Meu Projeto', t0)).toBe('joao-alvares-meu-projeto-2026-10-12.md')
    expect(exportFileName('../../etc', '', t0)).toBe('etc-2026-10-12.md')
  })

  it('fence mínima de três crases', () => {
    expect(fence('a')).toBe('```\na\n```')
  })
})

describe('canais office:saveMarkdown e office:copyText', () => {
  it('aceitam nome e texto; recusam tipos errados e tamanhos absurdos', () => {
    expect(saveMarkdownArgsSchema.safeParse(['a.md', '# oi']).success).toBe(true)
    expect(saveMarkdownArgsSchema.safeParse([123, 'x']).success).toBe(false)
    expect(saveMarkdownArgsSchema.safeParse(['a.md']).success).toBe(false)
    expect(saveMarkdownArgsSchema.safeParse(['a.md', 'x'.repeat(20_000_001)]).success).toBe(false)
    expect(copyTextSchema.safeParse('oi').success).toBe(true)
    expect(copyTextSchema.safeParse({}).success).toBe(false)
  })

  it('o nome sugerido não leva pastas e sempre termina em .md', () => {
    expect(markdownFileName('../../.ssh/authorized_keys')).toBe('authorized_keys.md')
    expect(markdownFileName('..\\..\\x.md')).toBe('x.md')
    expect(markdownFileName('relatório final.md')).toBe('relatório final.md')
    expect(markdownFileName('')).toBe('agent-office.md')
    expect(markdownFileName('.env')).toBe('env.md')
  })
})
