import { spawn } from 'node:child_process'
import type { CodexUsage } from '@shared/creative'
import { findBin } from './tools'

// Codex plan limits, the same numbers as /status in the Codex CLI: one JSON-RPC round trip to
// `codex app-server` (account/rateLimits/read). Never a token spent.

interface Window {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}
interface Snapshot {
  primary: Window | null
  secondary: Window | null
  planType: string | null
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null
  rateLimitReachedType: string | null
}

const windowLabel = (mins: number | null) => (!mins ? 'Janela' : mins <= 300 ? `${Math.round(mins / 60)}h` : mins >= 10000 ? 'Semana' : `${Math.round(mins / 1440)} dias`)

export function readCodexUsage(timeoutMs = 15000): Promise<CodexUsage> {
  const codex = findBin('codex')
  if (!codex) return Promise.reject(new Error('O Codex não está instalado.'))
  return new Promise((resolve, reject) => {
    const p = spawn(codex, ['app-server'], { env: process.env, stdio: ['pipe', 'pipe', 'ignore'] })
    let buf = ''
    let done = false
    const finish = (err: Error | null, v?: CodexUsage) => {
      if (done) return
      done = true
      clearTimeout(timer)
      p.kill()
      if (err) reject(err)
      else resolve(v!)
    }
    const timer = setTimeout(() => finish(new Error('O Codex não respondeu o uso a tempo.')), timeoutMs)
    const send = (m: object) => p.stdin.write(`${JSON.stringify(m)}\n`)
    p.stdout.on('data', (b: Buffer) => {
      buf += b.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m: { id?: number; result?: { rateLimits?: Snapshot }; error?: { message?: string } }
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (m.id === 1) {
          send({ method: 'initialized' })
          send({ method: 'account/rateLimits/read', id: 2 })
        } else if (m.id === 2) {
          if (m.error || !m.result?.rateLimits) return finish(new Error(m.error?.message ?? 'O Codex não devolveu o uso.'))
          const r = m.result.rateLimits
          const windows = [r.primary, r.secondary]
            .filter((w): w is Window => !!w)
            .map((w) => ({ label: windowLabel(w.windowDurationMins), percent: Math.round(w.usedPercent), resetsAt: w.resetsAt ? w.resetsAt * 1000 : undefined }))
          finish(null, {
            plan: r.planType ?? undefined,
            windows,
            limited: !!r.rateLimitReachedType,
            credits: r.credits?.hasCredits ? (r.credits.unlimited ? 'ilimitados' : (r.credits.balance ?? undefined)) : undefined,
            updatedAt: Date.now(),
          })
        }
      }
    })
    p.on('error', (err) => finish(err))
    p.on('exit', () => finish(new Error('O Codex fechou antes de dizer o uso.')))
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'agent-office', title: 'Agent Office', version: '1' }, capabilities: null } })
  })
}
