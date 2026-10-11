import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account, AccountStatus, AgentSummary, PlanUsage, Settings } from '@shared/types'
import { ACCOUNT_COLORS, accountPool, MAIN_ACCOUNT } from '@shared/accounts'
import { findClaude } from './claude-path'

/** A plan limit with no reset time (a bare 429): try that account again after this. */
const LIMIT_FALLBACK_MS = 5 * 60 * 1000

/**
 * Entries of ~/.claude that belong to one login and are never linked into another
 * account's folder: its credentials (Linux/Windows; macOS keeps them in the Keychain),
 * its global config, and the backups Claude Code restores that config from.
 */
const OWN = new Set(['.credentials.json', '.claude.json', '.claude.json.backup', 'backups', 'daemon', 'statsig', '.DS_Store'])

export function mainAccount(): Account {
  return { id: MAIN_ACCOUNT, name: 'Principal', provider: 'claude', color: ACCOUNT_COLORS[0] }
}

/**
 * Environment for a Claude Code process on an account. Other accounts get
 * CLAUDE_CONFIG_DIR; the main one keeps the app's own login.
 */
export function accountEnv(account: Account | undefined): NodeJS.ProcessEnv {
  if (!account?.configDir) return { ...process.env }
  linkShared(account.configDir)
  return { ...process.env, CLAUDE_CONFIG_DIR: account.configDir }
}

/**
 * Links every shared entry of ~/.claude (settings, skills, agents, plugins, CLAUDE.md,
 * projects with sessions and memory…) into an account folder, so every login works
 * with the same setup and can resume the same sessions. Runs before each start, so
 * entries that show up in ~/.claude later get linked too. Entries Claude Code already
 * made inside the account folder are left alone.
 */
export function linkShared(dir: string): void {
  const home = join(homedir(), '.claude')
  mkdirSync(join(home, 'projects'), { recursive: true })
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const name of readdirSync(home)) {
    if (OWN.has(name) || name.endsWith('.lock')) continue
    const link = join(dir, name)
    if (present(link)) continue
    try {
      symlinkSync(join(home, name), link, process.platform === 'win32' ? 'junction' : undefined)
    } catch {
      // Windows without symlink rights: that entry stays per account
    }
  }
}

/** Claude accounts: which one each agent runs on, who hit a plan limit, who is logged in. */
export class Accounts extends EventEmitter {
  private status = new Map<string, AccountStatus>()
  /** Account id -> ms until which it is out (plan limit hit). */
  private limited = new Map<string, number>()

  constructor(
    private settings: () => Settings,
    private usage: () => PlanUsage[],
  ) {
    super()
  }

  list(): Account[] {
    return this.settings().accounts
  }

  get(id: string | undefined): Account | undefined {
    return this.list().find((a) => a.id === id)
  }

  name(id: string | undefined): string {
    return this.get(id)?.name ?? 'Conta removida'
  }

  /** Accounts an agent may run on: picked by hand, else its project floor's, else the default ones. */
  poolFor(agent: Pick<AgentSummary, 'cwd' | 'accounts'>): string[] {
    return accountPool(this.settings(), agent.cwd, agent.accounts)
  }

  /**
   * Account for an agent's next run. It stays on its current account while that one
   * has room (the prompt cache lives there), otherwise takes the least used one in the
   * 5-hour window. When every account is out, the first one: its error says when it renews.
   */
  pick(agent: Pick<AgentSummary, 'cwd' | 'accounts' | 'account'>): Account {
    return this.next(agent) ?? this.get(this.poolFor(agent)[0]) ?? mainAccount()
  }

  /** An account of the agent's pool with room, other than `avoid`; undefined when none has. */
  next(agent: Pick<AgentSummary, 'cwd' | 'accounts' | 'account'>, avoid?: string): Account | undefined {
    const open = this.poolFor(agent).filter((id) => id !== avoid && !this.out(id))
    if (agent.account && open.includes(agent.account)) return this.get(agent.account)
    open.sort((a, b) => this.fiveHour(a) - this.fiveHour(b))
    return this.get(open[0])
  }

  /** The account hit a plan limit: agents skip it until `resetsAt` (ms). */
  limitHit(id: string, resetsAt?: number): void {
    this.limited.set(id, resetsAt && resetsAt > Date.now() ? resetsAt : Date.now() + LIMIT_FALLBACK_MS)
    this.emit('changed', this.statuses())
    this.emit('limit', id)
  }

  statuses(): AccountStatus[] {
    const now = Date.now()
    return this.list().map((a) => {
      const until = this.limited.get(a.id)
      return { ...(this.status.get(a.id) ?? { id: a.id, loggedIn: null }), limitedUntil: until && until > now ? until : undefined }
    })
  }

  /** Reads the login of every account with `claude auth status`. */
  async check(): Promise<AccountStatus[]> {
    const claude = findClaude()
    await Promise.all(
      this.list().map(async (a) => {
        this.status.set(a.id, claude ? await authStatus(claude, a) : { id: a.id, loggedIn: null, error: 'Claude Code não encontrado.' })
      }),
    )
    const out = this.statuses()
    this.emit('changed', out)
    return out
  }

  /** Some account is not known to be logged in: worth checking again when the user comes back. */
  unsure(): boolean {
    return this.list().some((a) => this.status.get(a.id)?.loggedIn !== true)
  }

  /** A new account with its own config folder, ~/.claude-<name>. Not saved: the caller adds it to Settings. */
  create(name: string): Account {
    const clean = name.trim().slice(0, 32) || 'Conta'
    const used = new Set(this.list().map((a) => a.configDir))
    const base = slug(clean)
    let dir = join(homedir(), `.claude-${base}`)
    for (let n = 2; used.has(dir); n++) dir = join(homedir(), `.claude-${base}-${n}`)
    linkShared(dir)
    return { id: randomUUID(), name: clean, provider: 'claude', configDir: dir, color: ACCOUNT_COLORS[this.list().length % ACCOUNT_COLORS.length] }
  }

  /** Opens Terminal running `claude auth login` on the account; the browser does the rest. */
  login(id: string): Promise<{ ok: boolean; message?: string }> {
    const account = this.get(id)
    if (!account) return Promise.resolve({ ok: false, message: 'Conta não encontrada.' })
    const claude = findClaude()
    if (!claude) return Promise.resolve({ ok: false, message: 'Não encontrei o Claude Code neste computador.' })
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
    const env = account.configDir ? `CLAUDE_CONFIG_DIR=${q(account.configDir)} ` : ''
    const command = `${env}${q(claude)} auth login --claudeai`
    if (process.platform !== 'darwin') return Promise.resolve({ ok: false, message: `Rode no terminal: ${command}` })
    if (account.configDir) linkShared(account.configDir)
    // A .command file opens in Terminal without needing Automation permission.
    const file = join(tmpdir(), `agent-office-login-${account.id.replace(/[^\w-]/g, '')}.command`)
    const script = [
      '#!/bin/zsh -l',
      `echo ${q(`Agent Office: entrando na conta "${account.name}"`)}`,
      command,
      `echo; echo ${q('Pronto. Pode fechar esta janela e voltar ao Agent Office.')}`,
    ]
    writeFileSync(file, script.join('\n') + '\n', { mode: 0o700 })
    return new Promise((resolve) => {
      execFile('open', ['-a', 'Terminal', file], (err) => resolve(err ? { ok: false, message: err.message } : { ok: true }))
    })
  }

  private out(id: string): boolean {
    const until = this.limited.get(id)
    if (until && until > Date.now()) return true
    if (this.status.get(id)?.loggedIn === false) return true
    const u = this.usage().find((x) => x.accountId === id)
    return !!u?.windows.some((w) => (w.key === 'five_hour' || w.key === 'seven_day') && w.percent >= 100 && (!w.resetsAt || w.resetsAt > Date.now()))
  }

  private fiveHour(id: string): number {
    return this.usage().find((x) => x.accountId === id)?.windows.find((w) => w.key === 'five_hour')?.percent ?? 0
  }
}

function authStatus(claude: string, account: Account): Promise<AccountStatus> {
  return new Promise((resolve) => {
    execFile(claude, ['auth', 'status', '--json'], { env: accountEnv(account), timeout: 15000 }, (err, stdout) => {
      // Logged out exits non-zero but still prints the JSON.
      try {
        const s = JSON.parse(String(stdout)) as { loggedIn?: boolean; email?: string; subscriptionType?: string }
        resolve({ id: account.id, loggedIn: s.loggedIn === true, email: s.email || undefined, plan: s.subscriptionType || undefined })
      } catch {
        resolve({ id: account.id, loggedIn: null, error: err?.message ?? 'Resposta inesperada do Claude Code.' })
      }
    })
  })
}

/** "Trabalho 2" -> "trabalho-2" */
function slug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return s || 'conta'
}

/** True for anything at the path, a broken link included. */
function present(p: string): boolean {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}
