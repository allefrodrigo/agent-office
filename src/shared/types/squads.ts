// ---------- squads (Opensquad) ----------

/** A member of an Opensquad squad, without its prompt. */
export interface SquadMember {
  id: string
  name: string
  icon: string
  title: string
  /** subagent = called with the Agent tool; inline = the orchestrator plays the part in its own conversation. */
  execution: 'subagent' | 'inline'
  /** Sector on the project floor: `setor:` in squad.yaml, or "Equipe". */
  sector: string
}

export interface SquadStep {
  id: string
  name: string
  type: 'agent' | 'checkpoint'
  agent?: string
}

export interface SquadInfo {
  code: string
  name: string
  icon: string
  description: string
  /** Project folder (the one holding squads/). */
  cwd: string
  members: SquadMember[]
  steps: SquadStep[]
}

export interface SquadProgress {
  /** 1-based; 0 before the first step. */
  current: number
  total: number
  /** Step name ("Spec"), or the label the runner wrote. */
  label: string
  /** running, completed, failed… as written by the runner. */
  status: string
  type?: 'agent' | 'checkpoint'
  /** Member id of the current step. */
  agent?: string
}
