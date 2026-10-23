import { CONTINUE_PROMPT, clock, usd, type Agent } from './types'
import { AgentSdk } from './sdk'

/** Account rotation when one hits its limit, and the spending cap. */
export abstract class AgentRotation extends AgentSdk {
  /**
   * The account ran out of plan mid-task: carry on with the same conversation on
   * another account of the agent's pool. Every account keeps its sessions in
   * ~/.claude, so the new process resumes this one. False when none has room.
   */
  protected failover(agent: Agent, hit: { resetsAt?: number }): boolean {
    const accounts = this.accounts
    const from = agent.summary.account
    if (!accounts || !from) return false
    accounts.limitHit(from, hit.resetsAt)
    const renews = hit.resetsAt ? ` (renova às ${clock(hit.resetsAt)})` : ''
    const next = accounts.next(agent.summary, from)
    if (!next) {
      if (accounts.poolFor(agent.summary).length > 1) this.addLog(agent, 'system', `${accounts.name(from)} bateu o limite${renews}, e as outras contas também estão sem espaço.`)
      return false
    }
    this.addLog(agent, 'system', `${accounts.name(from)} bateu o limite${renews}. Continuando em ${next.name}.`)
    if (agent.summary.sessionId) this.book?.switched(agent.summary, agent.summary.sessionId, next.id, from, 'failover')
    this.closeProcess(agent)
    agent.summary.account = next.id
    this.setStatus(agent, 'starting', `Trocando para ${next.name}`)
    this.run(agent, CONTINUE_PROMPT)
    return true
  }

  /**
   * A plan limit stopped the agent and the player picked another account on its card:
   * it carries on with the same conversation there, even when that account is outside
   * its pool. It keeps that account while the pool has no room (see Accounts.pick).
   */
  continueOn(id: string, accountId: string): void {
    const agent = this.agents.get(id)
    const accounts = this.accounts
    if (!agent || agent.summary.source !== 'office' || agent.demo || !accounts) return
    const next = accounts.get(accountId)
    if (!next) throw new Error('Essa conta não existe mais. Escolha outra.')
    if (this.busy(agent)) throw new Error(`${agent.summary.name} já voltou ao trabalho.`)
    if (accounts.out(accountId)) throw new Error(`${next.name} também está sem espaço ou sem login agora. Escolha outra conta.`)
    this.dropResults(id)
    if (this.overBudget(agent)) return
    this.addLog(agent, 'system', `Continuando em ${next.name}, a seu pedido.`)
    this.closeProcess(agent)
    agent.borrowed = accountId
    this.setStatus(agent, 'starting', `Trocando para ${next.name}`)
    this.run(agent, CONTINUE_PROMPT)
  }

  /** A CLI process is tied to one login: close it so the next run starts on another account. */
  private closeProcess(agent: Agent): void {
    if (agent.query) this.replaced.add(agent.query)
    agent.input?.close()
    agent.query?.close()
    agent.input = undefined
    agent.query = undefined
  }

  // ---------- spending cap ----------

  /** The agent already spent its cap: hands a card saying so instead of starting. */
  protected overBudget(agent: Agent): boolean {
    const cap = this.store.settings.agentBudgetUsd
    if (!this.dailyCapHit() && (!(cap > 0) || (agent.summary.spentUsd ?? 0) < cap)) return false
    this.deliver(agent, { text: this.budgetText(agent), isError: true, costUsd: agent.summary.costUsd, durationMs: 0, turns: 0 })
    return true
  }

  /** The office spent its daily cap (a cent of slack: the SDK stops just past it). */
  protected dailyCapHit(): boolean {
    const daily = this.store.settings.dailyBudgetUsd
    return daily > 0 && (this.book?.spentToday() ?? 0) >= daily - 0.01
  }

  protected budgetText(agent: Agent): string {
    if (this.dailyCapHit()) {
      return (
        `Parei: o escritório chegou ao teto de custo do dia (${usd(this.store.settings.dailyBudgetUsd)}). O teto zera à meia-noite.\n\n` +
        'Para eu continuar hoje, aumente o teto em Configurações › Economia de tokens, ou deixe em 0 para tirar o limite.'
      )
    }
    const cap = this.store.settings.agentBudgetUsd
    return (
      `Parei: cheguei ao teto de custo por agente (${usd(cap)}). Já gastei ${usd(agent.summary.spentUsd ?? 0)} neste escritório.\n\n` +
      'Para eu continuar, aumente o teto em Configurações › Economia de tokens, ou deixe em 0 para tirar o limite.'
    )
  }
}
