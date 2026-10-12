import './styles.css'
import { Game } from './game'
import { State } from './state'
import { Board } from './ui/board'
import { AgentPanel } from './ui/panel'
import { Dialog } from './ui/dialog'
import { Hud } from './ui/hud'
import { Radio } from './ui/radio'
import type { DataNotice, ProjectFloor } from '@shared/types'
import { openAccounts } from './ui/accounts'
import { openSkull } from './ui/skull'
import { openReports } from './ui/reports'
import { copyReport, exportConversation } from './ui/export'
import { showDataNotice } from './ui/data'
import { mountUpdateNotice } from './ui/updates'
import { cleanError, confirmDialog, openNewAgent, openNewFloor, openResume, openRunSquad, openSettings } from './ui/modals'

// Errors nobody caught go to the app log (userData/logs), so a broken screen leaves a trace.
window.addEventListener('error', (e) => {
  window.office.reportError({
    kind: 'error',
    message: String(e.message || e.error?.message || 'erro sem mensagem'),
    source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
    stack: e.error instanceof Error ? e.error.stack : undefined,
  })
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  window.office.reportError({ kind: 'rejection', message: r instanceof Error ? r.message : String(r), stack: r instanceof Error ? r.stack : undefined })
})

async function boot(): Promise<void> {
  const initial = await window.office.getState()
  const initialNotices = initial.dataNotices ?? []
  const state = new State(initial)
  const ui = document.getElementById('ui')!
  document.body.classList.add(`platform-${state.platform}`)

  // Cards the player closed with "later" stay closed until they walk away and back.
  const dismissed = new Set<string>()
  let nearId: string | null = null

  const toast = (text: string, kind: 'info' | 'ok' | 'err' = 'info') => hud.toast(text, kind)

  /** Asks, then stops the claude process behind a terminal agent. Returns true if it closed. */
  const closeTerminal = async (id: string): Promise<boolean> => {
    const a = state.agents.get(id)
    if (!a) return false
    const yes = await confirmDialog(ui, {
      title: `Fechar a sessão de ${a.name}?`,
      text: `O Claude Code rodando no terminal em …/${a.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/')} vai ser encerrado, como se você fechasse aquela aba.\nA conversa fica salva: dá para voltar com claude --resume.`,
      confirm: 'Fechar sessão',
      cancel: 'Deixar viver',
      danger: true,
    })
    if (!yes || !state.agents.has(id)) return false
    game.ghostOut(id)
    return endTerminal(id, a.name)
  }

  /** Stops the claude process behind a terminal agent, no questions. Returns true if it closed. */
  const endTerminal = async (id: string, name: string): Promise<boolean> => {
    const r = await window.office.closeTerminal(id)
    if (r.ok) toast(`A sessão de ${name} foi encerrada.`, 'err')
    else toast(r.message ?? 'Não consegui fechar a sessão.', 'err')
    return r.ok
  }

  /**
   * Picked at the skull (already confirmed): the camera goes to the agent, the skull
   * strikes, and then its session ends. If that fails, the agent gets back up.
   */
  const dismiss = async (id: string) => {
    const a = state.agents.get(id)
    if (!a) return
    // An agent in a worktree asks first whether its copy stays or goes.
    if (a.source === 'office' && (await window.office.prepareFire(id).catch(() => 'cancelled')) === 'cancelled') return
    dialog.close()
    panel.close()
    const started = game.dismiss(id, () => {
      // it may have left on its own during the animation
      if (!state.agents.has(id)) return
      if (a.source === 'terminal') {
        void endTerminal(id, a.name).then((closed) => {
          if (!closed) game.revive(id)
        })
        return
      }
      window.office
        .fire(id)
        .then((note) => toast(`${a.name} saiu do escritório. A sessão foi encerrada.${note ? ` ${note}` : ''}`, 'err'))
        .catch((err) => {
          toast(cleanError(err), 'err')
          game.revive(id)
        })
    })
    if (!started) toast(`${a.name} já está de saída.`)
  }

  /**
   * "Novo agente". Conversar: pick a folder (and how free the agent is) and an agent shows
   * up there, waiting for your first message. Com tarefa and Squad finish inside the
   * dialog. On a project floor the folder is the project's.
   */
  const newAgent = async (tab?: 'summon') => {
    const project = game.currentProject
    const choice = await openNewAgent(ui, state, project, { toast, tab, hireSquad: project ? () => hireSquad(project) : undefined })
    if (choice?.kind !== 'summon') return
    try {
      const a = await window.office.summon(choice.cwd, choice.permissionMode, choice.brain, choice.worktree)
      const floor = state.settings.projects.find((p) => p.id === a.project)
      toast(floor && floor !== project ? `${a.name} está subindo para o andar ${floor.name}. Diga o que fazer.` : `${a.name} chegou. Diga o que fazer.`, 'ok')
      panel.open(a.id).then(() => panel.focusInput())
      game.focusAgent(a.id)
    } catch (err) {
      toast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err), 'err')
    }
  }

  const openItem = (agentId: string, itemId?: string) => {
    if (!dialog.open(agentId, itemId)) panel.open(agentId)
  }

  /** An orchestrator with its squad, in the Diretoria of the project's floor. */
  const hireSquad = (project: ProjectFloor) =>
    openRunSquad(ui, state, project, toast, (a) => {
      panel.open(a.id)
      game.focusAgent(a.id)
    })

  /** A project folder becomes a floor; the player rides up to it. */
  const newFloor = async () => {
    const floor = await openNewFloor(ui, state, toast)
    if (!floor) return
    game.setProjects(state.settings.projects, state.squads)
    game.goFloor(state.settings.projects.findIndex((p) => p.id === floor.id) + 1)
    toast(`Andar ${floor.name} pronto. Quem você contratar ou chamar aqui trabalha em ${floor.cwd}.`, 'ok')
  }

  const radio = new Radio(document.getElementById('overlay')!)

  const game = new Game(document.getElementById('world')!, document.getElementById('overlay')!, state, {
    onAgentClick: (id) => {
      const items = state.itemsFor(id)
      if (items.permissions.length || items.results.length) openItem(id)
      panel.open(id)
    },
    onNear: (id) => {
      if (nearId && nearId !== id) {
        for (const p of state.itemsFor(nearId).permissions) dismissed.delete(p.id)
        for (const r of state.itemsFor(nearId).results) dismissed.delete(r.id)
      }
      nearId = id
      if (!id || dialog.isOpen) return
      const items = state.itemsFor(id)
      const first = items.permissions[0] ?? items.results[0]
      if (first && !dismissed.has(first.id)) openItem(id, first.id)
    },
    onSkull: () => openSkull(ui, state, dismiss),
    onComputer: () => void newAgent('summon'),
    onRunSquad: (project) => hireSquad(project),
    onFloor: (n) => hud.setFloors(game.floors, n),
    onTv: () => void radio.toggle(),
  })

  const hud = new Hud(ui, state, {
    openAgent: (id) => {
      panel.open(id)
      game.focusAgent(id)
    },
    focusAgent: (id) => game.focusAgent(id),
    openItem: (agentId, itemId) => openItem(agentId, itemId),
    settings: (section) => openSettings(ui, state, toast, { section }),
    goHome: () => game.goHome(),
    zoom: (d) => game.zoom(d),
    newAgent: () => void newAgent(),
    goFloor: (n) => game.goFloor(n),
    newFloor: () => void newFloor(),
    accounts: () => openAccounts(ui, state, toast),
    reports: () => openReports(ui, state, { project: game.currentProject, toast }),
    board: (ticketId) => {
      if (ticketId) board.open(ticketId)
      else board.toggle()
    },
    resume: () =>
      openResume(ui, state, {
        openAgent: (id) => {
          panel.open(id).then(() => panel.focusInput())
          game.focusAgent(id)
        },
        toast,
      }),
  }, radio)

  radio.attach({ corners: () => game.tvCorners(), setOn: (on) => game.setTvOn(on) })

  const panel = new AgentPanel(ui, state, {
    goTo: (id) => game.goToAgent(id),
    closeTerminal: (id) => void closeTerminal(id),
    openItem: (agentId, itemId) => openItem(agentId, itemId),
    toast,
    exportConversation: (id) => void exportConversation(state, id, toast),
    copyReport: (id) => void copyReport(state, id, toast),
  })

  const dialog = new Dialog(ui, state, {
    reply: (id) => {
      panel.open(id).then(() => panel.focusInput())
    },
    toast,
    exportConversation: (id) => void exportConversation(state, id, toast),
  })

  const board = new Board(ui, state, {
    currentProject: () => game.currentProject,
    openAgent: (id) => {
      panel.open(id)
      game.focusAgent(id)
    },
    toast,
  })

  // T opens the board, like a shortcut in any kanban; N opens "Novo agente"; R the reports.
  window.addEventListener('keydown', (e) => {
    const a = document.activeElement
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) return
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !board.isOpen) board.open()
    if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !board.isOpen && !ui.querySelector('.backdrop')) openReports(ui, state, { project: game.currentProject, toast })
    if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !board.isOpen && !ui.querySelector('.backdrop')) {
      e.preventDefault()
      void newAgent()
    }
  })

  // Remember which card the player closed without deciding.
  const closeDialog = dialog.close.bind(dialog)
  dialog.close = () => {
    if (dialog.itemId && (state.permissions.has(dialog.itemId) || state.results.has(dialog.itemId))) dismissed.add(dialog.itemId)
    closeDialog()
  }

  hud.setFloors(game.floors, game.currentFloor)
  mountUpdateNotice(ui)

  let pixelSize = state.settings.pixelSize
  state.onChange(() => {
    game.setProjects(state.settings.projects, state.squads)
    hud.render()
    panel.render()
    dialog.sync()
    board.render()
    if (state.settings.pixelSize !== pixelSize) {
      pixelSize = state.settings.pixelSize
      game.setPixelSize(pixelSize)
    }
  })

  // Data files found corrupt (AO-24): one warning each, now and when the archive loads later.
  const noticed = new Set<string>()
  const notice = (n: DataNotice) => {
    if (noticed.has(n.id)) return
    noticed.add(n.id)
    showDataNotice(ui, n)
  }
  for (const n of initialNotices) notice(n)

  window.office.onEvent((e) => {
    if (e.type === 'data:notice') return notice(e.notice)
    if (e.type === 'agent:chat') return game.chat(e.fromId, e.toId, e.text)
    if (e.type === 'member:ended') return game.memberEnded(e.taskId, e.status, e.summary)
    // Clique na notificação do sistema: o cartão abre na hora, sem esperar a caminhada.
    if (e.type === 'notice:open') {
      dismissed.delete(e.itemId)
      if (dialog.itemId !== e.itemId) openItem(e.agentId, e.itemId)
      return game.focusAgent(e.agentId)
    }
    // Every 3 s: redraw only the info card (it also ticks the reset countdowns), not the whole HUD.
    if (e.type === 'system') {
      state.system = e.system
      return hud.renderInfo()
    }
    const before = e.type === 'ticket:upsert' ? state.tickets.get(e.ticket.id) : undefined
    state.apply(e)
    if (e.type === 'result:changes') dialog.syncChanges(e.resultId)
    if (e.type === 'ticket:upsert' && e.ticket.status !== before?.status) {
      const by = e.ticket.activity.at(-1)?.actor
      if (e.ticket.status === 'review' && by?.kind === 'agent') toast(`${by.name} entregou o ${e.ticket.key}. Está esperando sua revisão no quadro.`, 'ok')
      else if (!before && e.ticket.reporter.kind === 'agent') toast(`${e.ticket.reporter.name} abriu o ${e.ticket.key}: ${e.ticket.title}`, 'info')
    }
    if (e.type === 'permission:new') {
      const a = state.agents.get(e.request.agentId)
      if (a) toast(`${a.name} está indo até a sua sala.`, 'info')
    } else if (e.type === 'result:new') {
      const a = state.agents.get(e.result.agentId)
      if (a) toast(e.result.isError ? `${a.name} teve um problema.` : `${a.name} terminou e vai te entregar o resultado.`, e.result.isError ? 'err' : 'ok')
    }
  })

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('shots')) Object.assign(window, { __game: game, __state: state, __panel: panel, __dialog: dialog, __board: board })

  // Full frame rate while the window has focus; ~20 fps in the background to save battery.
  let last = performance.now()
  const frame = (now: number) => {
    requestAnimationFrame(frame)
    if (!document.hasFocus() && now - last < 50) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    game.update(dt)
    radio.update()
  }
  requestAnimationFrame(frame)
}

boot().catch((err) => {
  window.office.reportError({ kind: 'error', message: `Falha ao iniciar: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : undefined })
  document.body.textContent = `Falha ao iniciar: ${err instanceof Error ? err.message : String(err)}`
})
