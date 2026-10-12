// npm test: exportação da conversa em Markdown (AO-36).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationMarkdown, exportFileName, fence, finalReport } from '../src/shared/export-md.ts'

const t0 = new Date(2026, 9, 12, 9, 30).getTime()
const log = [
  { id: '1', t: t0, kind: 'user', text: 'Conserte o login\nsem mexer no layout', attachments: [{ name: 'print.png', kind: 'image', size: 10 }] },
  { id: '2', t: t0 + 60e3, kind: 'assistant', text: 'Vou olhar o **auth.ts**.' },
  { id: '3', t: t0 + 70e3, kind: 'tool', tool: 'Bash', text: 'npm test' },
  { id: '4', t: t0 + 80e3, kind: 'tool_result', text: 'ok ```code``` 3 testes', isError: false },
  { id: '5', t: t0 + 90e3, kind: 'error', text: 'Falhou a rede' },
  { id: '6', t: t0 + 95e3, kind: 'decision', text: 'Permitido: npm test' },
  { id: '7', t: t0 + 120e3, kind: 'result', text: 'Login corrigido.\n\n- auth.ts' },
]

test('cabeçalho com agente, pasta, modelo, custo e datas', () => {
  const md = conversationMarkdown({ agent: 'Joana', cwd: '/Users/x/proj', model: 'claude-opus-5-5', costUsd: 1.234, startedAt: t0, sessionId: 'abc', exportedAt: t0 + 3600e3 }, log)
  assert.match(md, /^# Joana\n/)
  assert.match(md, /- \*\*Pasta:\*\* `\/Users\/x\/proj`/)
  assert.match(md, /- \*\*Modelo:\*\* claude-opus-5-5/)
  assert.match(md, /- \*\*Custo:\*\* \$1,23/)
  assert.match(md, /- \*\*Início:\*\* 12\/10\/2026 09:30/)
  assert.match(md, /- \*\*Exportado em:\*\* 12\/10\/2026 10:30/)
  assert.match(md, /## Conversa/)
})

test('conversa legível: falas, ferramentas, erros e resultado', () => {
  const md = conversationMarkdown({ agent: 'Joana', cwd: '/p' }, log)
  assert.match(md, /### Você · 09:30\n\n> Conserte o login\n> sem mexer no layout\n\n- anexo: print.png/)
  assert.match(md, /### Joana · 09:31\n\nVou olhar o \*\*auth.ts\*\*\./)
  assert.match(md, /- \*\*Bash\*\* · 09:31: `npm test`/)
  // a saída tem ``` dentro: a cerca precisa ser maior
  assert.match(md, /````\nok ```code``` 3 testes\n````/)
  assert.match(md, /> \*\*Erro · 09:31:\*\* Falhou a rede/)
  assert.match(md, /## Resultado · 09:32\n\nLogin corrigido\./)
  assert.doesNotMatch(md, /\n{3,}/)
})

test('saída longa de ferramenta é cortada', () => {
  const big = Array.from({ length: 100 }, (_, i) => `linha ${i}`).join('\n')
  const md = conversationMarkdown({ agent: 'A', cwd: '/p' }, [{ id: '1', t: t0, kind: 'tool_result', text: big }])
  assert.match(md, /linha 39\n… \(60 linhas a mais\)/)
  assert.doesNotMatch(md, /linha 40/)
})

test('relatório final é o último resultado', () => {
  assert.equal(finalReport(log), 'Login corrigido.\n\n- auth.ts')
  assert.equal(finalReport(log.slice(0, 3)), '')
})

test('nome de arquivo sem acentos nem barras', () => {
  assert.equal(exportFileName('João Álvares', '/Users/x/Meu Projeto', t0), 'joao-alvares-meu-projeto-2026-10-12.md')
  assert.equal(exportFileName('../../etc', '', t0), 'etc-2026-10-12.md')
})

test('fence mínima de três crases', () => {
  assert.equal(fence('a'), '```\na\n```')
})
