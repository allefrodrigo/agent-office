import { spawn, type ChildProcess } from 'node:child_process'

// Modo "!" do composer, como no CLI: `! git push` roda o comando direto no shell, na
// pasta do agente, sem passar pelo modelo nem pelo classificador de permissões. Quem
// digitou foi você, então é você quem autoriza. A saída vai para o log e segue junto
// da próxima mensagem, para o agente ler.

/** Tempo máximo de um comando; depois disso o processo é encerrado. */
export const SHELL_TIMEOUT_MS = 10 * 60_000
/** Quanto de cada saída (stdout, stderr) fica guardado: começo e fim. */
const OUTPUT_MAX = 30_000

export interface ShellResult {
  stdout: string
  stderr: string
  /** null quando o processo morreu por sinal (timeout, interrupção). */
  code: number | null
  timedOut: boolean
  /** Não deu nem para iniciar o shell. */
  spawnError?: string
}

/** O comando de uma mensagem que começa com "!", ou null. */
export function bangCommand(text: string): string | null {
  const t = text.trimStart()
  if (!t.startsWith('!')) return null
  const cmd = t.slice(1).trim()
  return cmd || null
}

/** Shell e argumentos para rodar `cmd` como o usuário rodaria no terminal. */
export function shellFor(platform: string, cmd: string, env: NodeJS.ProcessEnv = process.env): { file: string; args: string[] } {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', cmd] }
  return { file: env.SHELL || '/bin/sh', args: ['-c', cmd] }
}

/** Corta o meio de uma saída grande, mantendo começo e fim. */
export function clipOutput(s: string, max = OUTPUT_MAX): string {
  if (s.length <= max) return s
  const half = Math.floor(max / 2)
  return `${s.slice(0, half)}\n… (${s.length - max} caracteres cortados) …\n${s.slice(-half)}`
}

/** Roda o comando. `onStart` recebe o processo, para quem quiser interromper. */
export function runShell(cmd: string, cwd: string, onStart?: (child: ChildProcess) => void, platform = process.platform): Promise<ShellResult> {
  const { file, args } = shellFor(platform, cmd)
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child: ChildProcess
    try {
      child = spawn(file, args, {
        cwd,
        // Sem terminal: o que pedir senha falha na hora em vez de travar esperando.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
    } catch (err) {
      resolve({ stdout: '', stderr: '', code: null, timedOut: false, spawnError: (err as Error).message })
      return
    }
    onStart?.(child)
    // Guarda no máximo o dobro do limite enquanto lê; o corte final fica com clipOutput.
    const keep = (acc: string, chunk: Buffer): string => {
      const next = acc + chunk.toString()
      return next.length > OUTPUT_MAX * 2 ? next.slice(0, OUTPUT_MAX) + next.slice(-OUTPUT_MAX) : next
    }
    child.stdout?.on('data', (c: Buffer) => (stdout = keep(stdout, c)))
    child.stderr?.on('data', (c: Buffer) => (stderr = keep(stderr, c)))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, SHELL_TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: null, timedOut, spawnError: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout: clipOutput(stdout), stderr: clipOutput(stderr), code, timedOut })
    })
  })
}

/** Uma linha sobre como o comando terminou. */
export function shellStatus(r: ShellResult): string {
  if (r.spawnError) return `Não consegui iniciar o shell: ${r.spawnError}`
  if (r.timedOut) return `Encerrado após ${SHELL_TIMEOUT_MS / 60_000} min sem terminar.`
  if (r.code === null) return 'Interrompido.'
  return r.code === 0 ? 'Terminou sem erro.' : `Terminou com código ${r.code}.`
}

/** O que o log mostra como saída. */
export function shellLogText(r: ShellResult): string {
  const out = [r.stdout.trimEnd(), r.stderr.trimEnd()].filter(Boolean).join('\n')
  return out ? `${out}\n\n${shellStatus(r)}` : shellStatus(r)
}

/** O que segue para o agente, no mesmo formato que o CLI usa no modo "!". */
export function shellContext(cmd: string, r: ShellResult): string {
  return (
    `<bash-input>${cmd}</bash-input>\n` +
    `<bash-stdout>${r.stdout.trimEnd()}</bash-stdout>\n` +
    `<bash-stderr>${[r.stderr.trimEnd(), r.code === 0 ? '' : shellStatus(r)].filter(Boolean).join('\n')}</bash-stderr>`
  )
}
