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
    // A CLI process is tied to one login: close it and resume on the next account.
    agent.input?.close()
    agent.query?.close()
    agent.input = undefined
    agent.query = undefined
    agent.summary.account = next.id
    this.setStatus(agent, 'starting', `Trocando para ${next.name}`)
    this.run(agent, CONTINUE_PROMPT)
    return true
  }

  // ---------- spending cap ----------

  /** The agent already spent its cap: hands a card saying so instead of starting. */
  protected overBudget(agent: Agent): boolean {
    const cap = this.store.settings.agentBudgetUsd
    if (!(cap > 0) || (agent.summary.spentUsd ?? 0) < cap) return false
    this.deliver(agent, { text: this.budgetText(agent), isError: true, costUsd: agent.summary.costUsd, durationMs: 0, turns: 0 })
    return true
  }

  protected budgetText(agent: Agent): string {
    const cap = this.store.settings.agentBudgetUsd
    return (
      `Parei: cheguei ao teto de custo por agente (${usd(cap)}). Já gastei ${usd(agent.summary.spentUsd ?? 0)} neste escritório.\n\n` +
      'Para eu continuar, aumente o teto em Configurações › Limites dos agentes, ou deixe em 0 para tirar o limite.'
    )
  }
}
