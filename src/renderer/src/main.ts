import './styles/index.css'
import { Game } from './game'
import { PixelEngine } from './pixel/engine'
import { bindPerfKeys, perf } from './perf'
import { State } from './state'
import { Board } from './ui/board'
import { AgentPanel } from './ui/panel'
import { Dialog } from './ui/dialog'
import { Hud } from './ui/hud'
import { Radio } from './ui/radio'
import type { DataNotice, ProjectFloor } from '@shared/types'
import { DEFAULT_VIDEO, effectiveVideo, frameInterval } from '@shared/video'
import { openAccounts } from './ui/accounts'
import { openSkull } from './ui/skull'
import { openRoutines } from './ui/routines'
import { openReports } from './ui/reports'
import { copyReport, exportConversation } from './ui/export'
import { showDataNotice } from './ui/data'
import { mountUpdateNotice } from './ui/updates'
import { announce, isTyping, mountLiveRegions } from './ui/a11y'
import { openShortcuts } from './ui/shortcuts'
import { Tour } from './ui/tour'
import { autoStart, tourDone } from './ui/tour-plan'
import { openAbout } from './ui/about'
import { openBackstage, refreshBackstage } from './ui/backstage'
import { isSafe, sizeText } from './ui/backstage/worktrees'
import { openCoffee } from './ui/coffee'
import { mountQuitBanner } from './ui/quit'
import { cleanError, confirmDialog, openNewAgent, openNewFloor, openResume, openRunSquad, openSettings } from './ui/modals'
import { osText } from './ui/os-text'
import { openStudio } from './ui/studio'
import { setLoginUrl } from './ui/studio/integrations'
import { studioProgress } from './ui/studio/session'
import { setCodexUsage } from './ui/studio/usage'
import { h, icon } from './ui/dom'

/** localStorage: '1' when the office lights are off (modo noturno). */
const NIGHT_KEY = 'office.night'

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
  // AGENT_OFFICE_VIEW=2d|iso (screenshots, bench) wins over the saved Visual for this run
  const forcedView = initial.forceView
  if (forcedView) state.settings.video = { ...(state.settings.video ?? DEFAULT_VIDEO), view: forcedView }
  const bootView = state.settings.video?.view ?? 'iso'
  document.body.classList.toggle('view-2d', bootView === '2d')
  const ui = document.getElementById('ui')!
  document.body.classList.add(`platform-${state.platform}`)
  // Empty from the start, so screen readers read what goes in later (AO-38).
  mountLiveRegions(document.body)

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

  const openItem = (agentId: string, itemId?: string, read = false) => {
    if (!dialog.open(agentId, itemId, read)) panel.open(agentId)
  }

  /** An orchestrator with its squad, in the Diretoria of the project's floor. */
  const hireSquad = (project: ProjectFloor) =>
    openRunSquad(ui, state, project, toast, (a) => {
      panel.open(a.id)
      game.focusAgent(a.id)
    })

  /** A project folder becomes a floor; the player rides up to it. A creative floor opens its studio. */
  const newFloor = async () => {
    const floor = await openNewFloor(ui, state, toast)
    if (!floor) return
    game.setProjects(state.settings.projects, state.squads)
    game.goFloor(state.settings.projects.findIndex((p) => p.id === floor.id) + 1)
    if (floor.kind === 'creative') {
      toast(`Andar ${floor.name} pronto. O estúdio salva tudo em ${floor.cwd}.`, 'ok')
      studio(floor)
    } else toast(`Andar ${floor.name} pronto. Quem você contratar ou chamar aqui trabalha em ${floor.cwd}.`, 'ok')
  }

  /** Estúdio criativo of a creative floor, full screen. */
  const studio = (floor: ProjectFloor) =>
    void openStudio(ui, state, floor, {
      toast,
      openAgent: (id) => {
        panel.open(id)
        game.focusAgent(id)
      },
    })
  // On a creative floor, a button at the top opens its studio.
  const studioLaunch = h('button', { class: 'studio-launch', hidden: true }, icon('spark', 16), 'Abrir estúdio criativo', h('small', {}, 'E'))
  studioLaunch.addEventListener('click', () => {
    const p = game.currentProject
    if (p?.kind === 'creative') studio(p)
  })
  ui.append(studioLaunch)
  const syncLaunch = () => (studioLaunch.hidden = game.currentProject?.kind !== 'creative')

  const radio = new Radio(document.getElementById('overlay')!)

  const game = new Game(document.getElementById('world')!, document.getElementById('overlay')!, state, {
    onAgentClick: (id, helper) => {
      const items = state.itemsFor(id)
      if (!helper && (items.permissions.length || items.results.length)) openItem(id)
      panel.open(id, helper ?? null)
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
    onStudio: (project) => studio(project),
    onFloor: (n) => {
      hud.setFloors(game.floors, n)
      syncLaunch()
    },
    onTv: () => void radio.toggle(),
    onCoffee: () => openCoffee(ui, state, toast),
    onRoutines: () =>
      openRoutines(ui, state, {
        toast,
        openAgent: (id) => {
          panel.open(id)
          game.focusAgent(id)
        },
        openResult: (agentId, resultId) => {
          game.focusAgent(agentId)
          openItem(agentId, resultId)
        },
        project: () => game.currentProject,
      }),
  })

  const hud = new Hud(ui, state, {
    openAgent: (id) => {
      panel.open(id)
      game.focusAgent(id)
    },
    focusAgent: (id) => game.focusAgent(id),
    openItem: (agentId, itemId) => openItem(agentId, itemId),
    settings: (section) => openSettings(ui, state, toast, { section, tour: replayTour }),
    goHome: () => game.goHome(),
    zoom: (d) => game.zoom(d),
    toggleNight: () => setNight(!game.engine.night),
    newAgent: () => void newAgent(),
    goFloor: (n) => game.goFloor(n),
    newFloor: () => void newFloor(),
    accounts: () => openAccounts(ui, state, toast),
    reports: () => openReports(ui, state, { project: game.currentProject, toast }),
    quit: () => void window.office.quitApp().catch((err) => toast(cleanError(err), 'err')),
    backstage: (tab) =>
      openBackstage(ui, state, {
        tab,
        toast,
        openAgent: (id) => {
          panel.open(id)
          game.focusAgent(id)
        },
      }),
    about: () =>
      openAbout(ui, {
        toast,
        openAgent: (id) => {
          panel.open(id)
          game.focusAgent(id)
        },
      }),
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
    openItem: (agentId, itemId, read) => openItem(agentId, itemId, read),
    toast,
    exportConversation: (id) => void exportConversation(state, id, toast),
    copyReport: (id) => void copyReport(state, id, toast),
    openResult: (id, entry) => dialog.showEntry(id, entry),
    focusCard: () => dialog.focus(),
    chooseAccount: (id, limit) => dialog.chooseAccount(id, limit),
  })
  mountQuitBanner(ui, state, toast)
  // Once per start, after the office settles: copies nobody uses any more are only disk space.
  setTimeout(() => {
    void window.office
      .listWorktrees()
      .then((floors) => {
        const safe = floors.flatMap((f) => f.items).filter(isSafe)
        if (!safe.length) return
        const size = sizeText(safe.reduce((n, w) => n + (w.size ?? 0), 0))
        toast(`${safe.length === 1 ? '1 cópia esquecida ocupa' : `${safe.length} cópias esquecidas ocupam`} ${size}. Limpe em Bastidores (B) → Worktrees.`, 'info')
      })
      .catch(() => undefined)
  }, 30_000)

  const dialog = new Dialog(ui, state, {
    reply: (id) => {
      panel.open(id).then(() => panel.focusInput())
    },
    toast,
    exportConversation: (id) => void exportConversation(state, id, toast),
    figure: (id) => game.figure(id),
  })

  const board = new Board(ui, state, {
    currentProject: () => game.currentProject,
    openAgent: (id) => {
      panel.open(id)
      game.focusAgent(id)
    },
    toast,
  })

  // T opens the board, like a shortcut in any kanban; N opens "Novo agente"; R the reports; I the inbox.
  window.addEventListener('keydown', (e) => {
    const a = document.activeElement
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) return
    if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !board.isOpen) board.open()
    if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !board.isOpen && !ui.querySelector('.backdrop')) openReports(ui, state, { project: game.currentProject, toast })
    if (e.key.toLowerCase() === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !board.isOpen && !ui.querySelector('.backdrop')) hud.openBackstage()
    if (e.key.toLowerCase() === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !board.isOpen && !ui.querySelector('.backdrop') && game.currentProject?.kind === 'creative') studio(game.currentProject)
    if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !board.isOpen && !ui.querySelector('.backdrop')) setNight(!game.engine.night)
    if (e.key.toLowerCase() === 'i' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !board.isOpen && !ui.querySelector('.backdrop')) hud.toggleInbox()
    if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && !board.isOpen && !ui.querySelector('.backdrop')) {
      e.preventDefault()
      void newAgent()
    }
  })

  // ? lists every shortcut. Capture phase: it works over the board and windows too, which stop the keys they use.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping() || tour.showing) return
      e.preventDefault()
      e.stopPropagation()
      openShortcuts(ui, state.platform, { tour: replayTour })
    },
    true,
  )

  // Tour guiado: aponta o que fica escondido em teclas e ícones. Ele espera atrás de um
  // cartão, de uma janela ou do quadro e volta no mesmo passo quando eles fecham.
  const tourBlocked = () => dialog.isOpen || board.isOpen || !!ui.querySelector('.backdrop')
  const tour = new Tour(
    ui,
    {
      hasSpot: (id) => game.tourSpot(id) !== null,
      showSpot: (id, instant) => game.lookAtSpot(id, instant),
      spotOnPage: (id) => game.spotOnPage(id),
      release: () => game.followPlayer(),
      blocked: tourBlocked,
      paused: () => void dialog.focus(),
      toast: (text) => toast(text),
    },
    state.platform,
  )
  // After the window that offered it is gone and has given the focus back.
  function replayTour(): void {
    setTimeout(() => tour.start(), 0)
  }

  // Remember which card the player closed without deciding.
  const closeDialog = dialog.close.bind(dialog)
  dialog.close = () => {
    if (dialog.itemId && (state.permissions.has(dialog.itemId) || state.results.has(dialog.itemId))) dismissed.add(dialog.itemId)
    closeDialog()
  }

  // Modo noturno (L or the moon by the zoom), remembered on this machine
  function setNight(on: boolean): boolean {
    game.setNight(on)
    hud.setNight(on)
    localStorage.setItem(NIGHT_KEY, on ? '1' : '0')
    return on
  }
  setNight(localStorage.getItem(NIGHT_KEY) === '1')

  hud.setFloors(game.floors, game.currentFloor)
  syncLaunch()
  mountUpdateNotice(ui)

  // Configurações → Vídeo (AO-32): shadows and effects apply live; on battery, Economia if asked.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let video = effectiveVideo(state.settings.video ?? DEFAULT_VIDEO, state.onBattery)
  let videoKey = ''
  const applyVideo = () => {
    const was = video.saving
    video = effectiveVideo(state.settings.video ?? DEFAULT_VIDEO, state.onBattery)
    const reduced = video.effects === 'reduced' || reduceMotion.matches
    const key = JSON.stringify([video, reduced])
    if (key === videoKey) return
    if (videoKey && video.saving !== was) toast(video.saving ? 'Na bateria: o escritório entrou no modo Economia.' : 'Na tomada: a qualidade gráfica voltou ao normal.')
    videoKey = key
    game.engine.setShadows(video.shadows, video.shadowMapSize)
    game.setReducedEffects(reduced)
  }
  applyVideo()
  reduceMotion.addEventListener('change', applyVideo)

  let pixelSize = state.settings.pixelSize
  let reloading = false
  state.onChange(() => {
    // Configurações → Vídeo → Visual: the other view needs a fresh page (a new canvas, other floors)
    if (!forcedView && (state.settings.video?.view ?? 'iso') !== bootView) {
      if (!reloading) void window.office.reloadWindow()
      reloading = true
      return
    }
    applyVideo()
    game.setProjects(state.settings.projects, state.squads)
    syncLaunch()
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
    if (e.type === 'creative:progress') return studioProgress(e.jobId, e.text)
    if (e.type === 'creative:login-url') return setLoginUrl(e.url)
    if (e.type === 'creative:usage') return setCodexUsage(e.usage)
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
    // A new scan of what the agents left running: the card and the open Bastidores window.
    if (e.type === 'backstage') {
      state.backstage = e.processes
      hud.renderInfo()
      return refreshBackstage()
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
      // Interrupts the screen reader: the agent is stopped until the player decides.
      if (a) {
        const r = e.request
        const what = r.kind === 'question' ? 'tem uma pergunta' : r.kind === 'plan' ? 'trouxe um plano' : 'pede sua permissão'
        const detail = r.kind === 'tool' && r.detail ? ` ${r.detail.split('\n')[0].slice(0, 100)}.` : ''
        const how = r.kind === 'question' ? 'Abra o cartão para responder.' : `Enter no cartão permite, ${state.platform === 'darwin' ? 'Command' : 'Control'} Backspace nega. I abre a caixa de entrada.`
        announce(`${a.name} ${what}: ${r.title.replace(/[.?!:]*$/, '')}.${detail} ${how}`, 'assertive')
      }
    } else if (e.type === 'result:new') {
      const a = state.agents.get(e.result.agentId)
      if (a) toast(e.result.isError ? `${a.name} teve um problema.` : `${a.name} terminou e vai te entregar o resultado.`, e.result.isError ? 'err' : 'ok')
    }
  })

  // F3 (or ?perf) shows fps, draw calls and GPU memory; the bench reads the same numbers.
  bindPerfKeys()
  perf.source('overlays', () => game.overlays.count)
  perf.source('agentes', () => state.agents.size)

  // AO-29: draw only when it shows. Something moving: up to the fps limit; a still office: a slow
  // tick (IDLE_FPS); another app in front: BLUR_FPS; window hidden or minimized: no drawing at all,
  // while a timer keeps the agents walking so they are where they should be on return.
  // Screenshot and bench runs never show their window, so they count as visible and focused.
  const headless = new URLSearchParams(location.search).has('shots')
  // `hidden` lets a headless run act as minimized (AGENT_OFFICE_EVAL="__loop.hidden = true")
  const loop = { hidden: false, draws: 0 }
  const hidden = () => loop.hidden || (!headless && document.visibilityState === 'hidden')
  let stepped = performance.now()
  let drawnAt = 0
  /** Moves the world to `now` in steps of at most 50 ms; long gaps (hidden for minutes) are cut at `capS`. */
  const advance = (now: number, capS: number): number => {
    const dt = Math.min(capS, Math.max(0, (now - stepped) / 1000))
    stepped = now
    for (let left = dt; left > 1e-6; left -= 0.05) game.update(Math.min(0.05, left))
    return dt
  }
  const frame = (now: number) => {
    requestAnimationFrame(frame)
    if (hidden()) return
    const wait = frameInterval({ fpsLimit: video.fpsLimit, busy: game.busy, focused: headless || document.hasFocus(), fullSpeed: perf.recording })
    // 2 ms of slack: animation frames land a little early or late
    if (now - drawnAt < wait - 2) return
    drawnAt = now
    perf.begin()
    // the slow tick moves the world by its whole gap; a frame stalled longer moves it by 100 ms at most
    const dt = advance(now, 0.1)
    radio.update()
    game.draw(dt)
    tour.update()
    loop.draws++
    perf.frame(game.engine.renderer, dt, game.engine instanceof PixelEngine ? game.engine.draws : 0)
  }
  requestAnimationFrame(frame)
  setInterval(() => {
    if (hidden()) advance(performance.now(), 30)
  }, 250)
  document.addEventListener('visibilitychange', () => {
    if (!hidden()) game.wake()
  })

  // First opening: the tour once, after the office shows up and with no card on screen.
  // Screenshot and bench runs skip it; AGENT_OFFICE_TOUR=1 forces it.
  const forceTour = !!initial.forceTour
  if (!headless || forceTour) {
    const tryTour = () => {
      const go = autoStart({ done: tourDone(localStorage), forced: forceTour, blocked: tourBlocked() })
      if (go === 'wait') setTimeout(tryTour, 500)
      else if (go === 'start') tour.start()
    }
    setTimeout(tryTour, 1500)
  }

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('shots')) Object.assign(window, {
      __game: game,
      __state: state,
      __perf: perf,
      __loop: loop,
      __panel: panel,
      __dialog: dialog,
      __board: board,
      __tour: tour,
      // AO-28: floors, agents and the skull in a loop, reading GPU memory (dev and headless runs only)
      __leakTest: async () => (await import('./dev/leak-test')).leakTest(game, state),
    })
}

boot().catch((err) => {
  window.office.reportError({ kind: 'error', message: `Falha ao iniciar: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : undefined })
  document.body.textContent = `Falha ao iniciar: ${err instanceof Error ? err.message : String(err)}`
})
