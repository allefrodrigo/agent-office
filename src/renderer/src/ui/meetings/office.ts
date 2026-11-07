import type { AgentSummary, OfficeEvent, ProjectFloor, Ticket } from '@shared/types'

// O que a sala de reunião precisa do resto do escritório: agentes (com o estado, para saber quem
// está livre), tickets (a coluna do "AO-31 · a fazer") e os andares. A tela da sala não recebe o
// State do main.ts; este espelho lê o estado uma vez e segue os eventos do office.

type Listener = () => void

class OfficeMirror {
  agents = new Map<string, AgentSummary>()
  /** Por chave (AO-31). */
  tickets = new Map<string, Ticket>()
  projects: ProjectFloor[] = []
  private loading: Promise<void> | null = null
  private listeners = new Set<Listener>()

  /** Lê o estado na primeira vez; depois só segue os eventos. */
  ready(): Promise<void> {
    this.loading ??= window.office.getState().then((s) => {
      // events that arrived while loading win over the snapshot
      for (const a of s.agents) if (!this.agents.has(a.id)) this.agents.set(a.id, a)
      for (const t of s.tickets) if (!this.tickets.has(t.key)) this.tickets.set(t.key, t)
      if (!this.projects.length) this.projects = s.settings.projects
      window.office.onEvent((e) => this.apply(e))
      this.changed()
    })
    return this.loading
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(): void {
    for (const fn of this.listeners) fn()
  }

  private apply(e: OfficeEvent): void {
    switch (e.type) {
      case 'agent:upsert':
        this.agents.set(e.agent.id, e.agent)
        break
      case 'agent:removed':
        this.agents.delete(e.agentId)
        break
      case 'ticket:upsert':
        this.tickets.set(e.ticket.key, e.ticket)
        break
      case 'ticket:removed':
        for (const [k, t] of this.tickets) if (t.id === e.ticketId) this.tickets.delete(k)
        break
      case 'settings':
        this.projects = e.settings.projects
        break
      default:
        return
    }
    this.changed()
  }
}

export const office = new OfficeMirror()

/** Evento que abre o painel de um agente; o main.ts escuta em window (panel.open + câmera nele). */
export const OPEN_AGENT_EVENT = 'agent-office:open-agent'

export function openAgentPanel(agentId: string): void {
  window.dispatchEvent(new CustomEvent<{ agentId: string }>(OPEN_AGENT_EVENT, { detail: { agentId } }))
}

/** Onde as janelas da sala abrem: a raiz da UI, por cima da tela da sala (z-index em meeting-ata.css). */
export function modalRoot(): HTMLElement {
  return document.getElementById('ui') ?? document.body
}
