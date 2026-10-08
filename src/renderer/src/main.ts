import './styles.css'
import { Game } from './game'
import { State } from './state'
import { Board } from './ui/board'
import { AgentPanel } from './ui/panel'
import { Dialog } from './ui/dialog'
import { Hud } from './ui/hud'
import { confirmDialog, openHire, openResume, openSettings, openSummon } from './ui/modals'
import { osText } from './ui/os-text'

async function boot(): Promise<void> {
  const state = new State(await window.office.getState())
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
      text: osText(state.platform).closeSessionText(a.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/')),
      confirm: 'Fechar sessão',
      cancel: 'Deixar viver',
      danger: true,
    })
    if (!yes || !state.agents.has(id)) return false
    game.ghostOut(id)
    const r = await window.office.closeTerminal(id)
    if (r.ok) toast(`A sessão de ${a.name} foi encerrada.`, 'err')
    else toast(r.message ?? 'Não consegui fechar a sessão.', 'err')
    return r.ok
  }

  /** Pick a folder (and how free the agent is) and an agent shows up there, waiting for your first message. */
  const summon = async () => {
    const choice = await openSummon(ui, state)
    if (!choice) return
    try {
      const a = await window.office.summon(choice.cwd, choice.permissionMode)
      toast(`${a.name} chegou. Diga o que fazer.`, 'ok')
      panel.open(a.id).then(() => panel.focusInput())
      game.focusAgent(a.id)
    } catch (err) {
      toast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err), 'err')
    }
  }

  const openItem = (agentId: string, itemId?: string) => {
    if (!dialog.open(agentId, itemId)) panel.open(agentId)
  }

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
    onGun: (armed) => {
      hud.setArmed(armed)
      if (armed) {
        dialog.close()
        panel.close()
      }
    },
    onKill: (id) => {
      const name = state.agents.get(id)?.name ?? 'O agente'
      window.office
        .fire(id)
        .then(() => toast(`${name} levou o terceiro tiro e saiu do escritório. A sessão foi encerrada.`, 'err'))
        .catch((err) => toast(String(err), 'err'))
    },
    onComputer: () => void summon(),
    onKnockout: (id) => {
      closeTerminal(id).then((closed) => {
        if (!closed) game.revive(id)
      })
    },
  })

  const hud = new Hud(ui, state, {
    openAgent: (id) => {
      panel.open(id)
      game.focusAgent(id)
    },
    focusAgent: (id) => game.focusAgent(id),
    openItem: (agentId, itemId) => openItem(agentId, itemId),
    hire: () => openHire(ui, state, toast),
    settings: () => openSettings(ui, state, toast),
    goHome: () => game.goHome(),
    bridge: () => openSettings(ui, state, toast),
    zoom: (d) => game.zoom(d),
    dropGun: () => game.dropGun(),
    summon: () => void summon(),
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
  })

  const panel = new AgentPanel(ui, state, {
    goTo: (id) => game.goToAgent(id),
    closeTerminal: (id) => void closeTerminal(id),
    openItem: (agentId, itemId) => openItem(agentId, itemId),
    toast,
  })

  const dialog = new Dialog(ui, state, {
    reply: (id) => {
      panel.open(id).then(() => panel.focusInput())
    },
    toast,
  })

  const board = new Board(ui, state, {
    openAgent: (id) => {
      panel.open(id)
      game.focusAgent(id)
    },
    toast,
  })

  // T opens the board, like a shortcut in any kanban.
  window.addEventListener('keydown', (e) => {
    const a = document.activeElement
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) return
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !board.isOpen) board.open()
  })

  // Remember which card the player closed without deciding.
  const closeDialog = dialog.close.bind(dialog)
  dialog.close = () => {
    if (dialog.itemId && (state.permissions.has(dialog.itemId) || state.results.has(dialog.itemId))) dismissed.add(dialog.itemId)
    closeDialog()
  }

  let pixelSize = state.settings.pixelSize
  state.onChange(() => {
    hud.render()
    panel.render()
    dialog.sync()
    board.render()
    if (state.settings.pixelSize !== pixelSize) {
      pixelSize = state.settings.pixelSize
      game.setPixelSize(pixelSize)
    }
  })

  window.office.onEvent((e) => {
    if (e.type === 'agent:chat') return game.chat(e.fromId, e.toId, e.text)
    // Every 3 s: redraw only its card, not the whole HUD.
    if (e.type === 'system') {
      state.system = e.system
      return hud.renderSystem()
    }
    const before = e.type === 'ticket:upsert' ? state.tickets.get(e.ticket.id) : undefined
    state.apply(e)
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

  if (import.meta.env.DEV) Object.assign(window, { __game: game, __state: state, __panel: panel, __dialog: dialog, __board: board })

  // Full frame rate while the window has focus; ~20 fps in the background to save battery.
  let last = performance.now()
  const frame = (now: number) => {
    requestAnimationFrame(frame)
    if (!document.hasFocus() && now - last < 50) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    game.update(dt)
  }
  requestAnimationFrame(frame)
}

boot().catch((err) => {
  document.body.textContent = `Falha ao iniciar: ${err instanceof Error ? err.message : String(err)}`
})
