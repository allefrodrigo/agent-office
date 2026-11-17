import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// CR-12: todo envio passa por Outbox.enqueue (ou sendSelfTest). Só a fila e o próprio cliente da
// Evolution chamam sendText, sendDocument ou presence. O renderer não alcança o cliente (ele vive no
// main e só se fala por IPC), então a busca cobre src/main, src/shared e src/preload.

const ROOT = join(__dirname, '..')
const SCANNED = ['src/main', 'src/shared', 'src/preload']
const ALLOWED = new Set(['src/main/crm/outbox.ts', 'src/main/crm/evolution.ts'])

/** The source without comments, so a comment that cites `client.sendText(` is not a call. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1')
}

const SEND = '(?:sendText|sendDocument|presence)'
/**
 * Ways to reach a sending method: a call (also ?. and .call/.apply/.bind), a send method taken as a
 * value, brackets, destructuring (into a variable or a typed parameter).
 */
const PATTERNS = [
  new RegExp(`\\.\\s*${SEND}\\s*(?:\\(|\\.\\s*(?:call|apply|bind)\\b)`),
  /\.\s*(?:sendText|sendDocument)\b/,
  new RegExp(`\\[\\s*['"\`]${SEND}['"\`]\\s*\\]`),
  new RegExp(`\\{[^{}]*\\b${SEND}\\b[^{}]*\\}\\s*(?:=[^=>]|:\\s*(?:[A-Z]|typeof\\b))`),
]

/** The first way `text` reaches a sending method, or null. */
function sendCall(text: string): string | null {
  const src = code(text)
  for (const re of PATTERNS) {
    const m = re.exec(src)
    if (m) return m[0].trim()
  }
  return null
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return files(p)
    return /\.(ts|mts|cts|js|mjs)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : []
  })
}

describe('arquitetura: um caminho só até a Evolution', () => {
  it('nenhum arquivo de src/main, src/shared ou src/preload, fora da fila e do cliente, chama sendText, sendDocument ou presence', () => {
    const offenders: string[] = []
    for (const base of SCANNED) {
      for (const file of files(join(ROOT, base))) {
        const rel = relative(ROOT, file).split(sep).join('/')
        if (ALLOWED.has(rel)) continue
        const hit = sendCall(readFileSync(file, 'utf8'))
        if (hit) offenders.push(`${rel}: ${hit}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('a fila é quem chama: o teste não passa por estar olhando o lugar errado', () => {
    expect(sendCall(readFileSync(join(ROOT, 'src/main/crm/outbox.ts'), 'utf8'))).not.toBeNull()
  })

  it.each([
    'await client.sendText(number, text)',
    'deps.sender?.sendDocument(n, doc)',
    'evo.presence(n, 3000)',
    'const send = client.sendText',
    'client.sendText.call(client, n, t)',
    "client['sendText'](n, t)",
    'const { sendText } = client',
    'const { presence, sendDocument: doc } = evo',
    'function go({ sendText }: EvolutionSender) {}',
    'const f = ({ presence }: typeof evo) => presence',
  ])('pega: %s', (snippet) => {
    expect(sendCall(snippet)).not.toBeNull()
  })

  it.each([
    '// só a fila chama client.sendText(n, t)',
    '/* EvolutionClient.sendText(n, t) */',
    "const url = 'http://localhost:8080/message/sendText/x'",
    'interface EvolutionSender { sendText(number: string, text: string): Promise<{ waId: string }> }',
    'const fake = { sendText: async () => ({ waId: "1" }) }',
    'type P = { presence: number } | null',
    "if (event === 'PRESENCE_UPDATE') return",
    'composer.send(text)',
    'const x = ok ? { presence: 1 } : { presence: 2 }',
  ])('deixa: %s', (snippet) => {
    expect(sendCall(snippet)).toBeNull()
  })
})
