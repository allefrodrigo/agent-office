import { ticketBrief } from '@shared/tickets'
import type { Actor, AgentSummary, DelegateTarget, OfficeEvent, Settings } from '@shared/types'
import type { AgentManager } from './agents'
import type { TicketBoard } from './tickets'

const REPORT_LIMIT = 8000

/**
 * Connects the board to the agents: handing a ticket over sends its brief,
 * and the agent's report comes back to the ticket, which then waits for review.
 */
export class TicketDesk {
  /** agentId -> ticket it is working on right now. */
  private working = new Map<string, string>()

  constructor(
    private board: TicketBoard,
    private manager: AgentManager,
    private settings: () => Settings,
  ) {
    manager.on('event', (e: OfficeEvent) => {
      if (e.type === 'result:new') this.delivered(e.result.agentId, e.result.text, e.result.isError)
      else if (e.type === 'agent:removed') {
        this.working.delete(e.agentId)
        board.agentLeft(e.agentId)
      }
    })
  }

  delegate(ticketId: string, target: DelegateTarget, by: Actor): AgentSummary {
    const t = this.board.get(ticketId)
    if (!t) throw new Error('Esse ticket não existe mais.')
    if (t.status === 'done') throw new Error('Esse ticket já está feito. Mova para outra coluna antes de delegar.')

    let agent: AgentSummary
    const display = `Ticket ${t.key}: ${t.title}`
    if ('agentId' in target) {
      const a = this.manager.list().find((x) => x.id === target.agentId)
      if (!a) throw new Error('Esse agente não está mais no escritório.')
      if (a.source !== 'office') throw new Error('Sessões do terminal não recebem tarefas daqui. Escolha um agente do escritório.')
      if (a.role === 'orchestrator') throw new Error(`${a.name} só roda o ciclo do squad. Delegue a um agente do térreo.`)
      // Same rule as hiring: ticket text may come from others, so it never runs without approvals.
      if (a.permissionMode === 'bypassPermissions') throw new Error(`${a.name} está no modo "Sem pedir nada". Delegue a outro agente ou contrate um novo.`)
      if (this.manager.isBusy(a.id)) throw new Error(`${a.name} está ocupado. Espere terminar ou escolha outro agente.`)
      if (t.cwd && t.cwd !== a.cwd) throw new Error(`${a.name} trabalha em outra pasta (${a.cwd}). Contrate um agente novo para este ticket.`)
      if (!t.cwd) this.board.update(t.id, { cwd: a.cwd }, by)
      agent = a
      this.board.assign(t.id, { kind: 'agent', name: a.name, id: a.id }, by)
      this.board.move(t.id, 'doing', undefined, by)
      this.manager.sendMessage(a.id, ticketBrief(t), display)
    } else {
      if (!t.cwd) throw new Error('Defina a pasta do projeto no ticket antes de contratar um agente para ele.')
      const s = this.settings()
      const mode = target.hire.permissionMode ?? s.defaultPermissionMode
      agent = this.manager.hire(
        {
          name: '',
          cwd: t.cwd,
          task: ticketBrief(t),
          model: 'model' in target.hire ? target.hire.model : s.defaultModel || undefined,
          effort: 'effort' in target.hire ? target.hire.effort : s.defaultEffort || undefined,
          accounts: target.hire.accounts,
          // Tickets may come from other people or agents: never run one with "bypass".
          permissionMode: mode === 'bypassPermissions' ? 'default' : mode,
        },
        display,
      )
      this.board.assign(t.id, { kind: 'agent', name: agent.name, id: agent.id }, by)
      this.board.move(t.id, 'doing', undefined, by)
    }
    this.working.set(agent.id, t.id)
    return agent
  }

  private delivered(agentId: string, text: string, isError: boolean): void {
    const ticketId = this.working.get(agentId)
    if (!ticketId) return
    this.working.delete(agentId)
    const t = this.board.get(ticketId)
    if (!t || t.assignee?.id !== agentId) return
    const me: Actor = { kind: 'agent', name: t.assignee.name, id: agentId }
    const body = text.length > REPORT_LIMIT ? text.slice(0, REPORT_LIMIT) + '\n\n…' : text
    this.board.comment(t.id, isError ? `**Parei com um problema**\n\n${body}` : `**Relatório de entrega**\n\n${body}`, me)
    if (!isError && t.status === 'doing') this.board.move(t.id, 'review', undefined, me)
  }
}
