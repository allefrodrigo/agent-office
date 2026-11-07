// Modo mini: page of the transparent strip on the bottom of the screen (src/main/pet.ts). The
// agents walk and work there; clicking one opens the same panel and cards as the office.
import '../styles/index.css'
import './pet.css'
import { State } from '../state'
import { AgentPanel } from '../ui/panel'
import { Dialog } from '../ui/dialog'
import { copyReport, exportConversation } from '../ui/export'
import { cleanError, confirmDialog, openNewAgent } from '../ui/modals'
import { mountLiveRegions } from '../ui/a11y'
import { h, icon } from '../ui/dom'
import { Stage } from './stage'

/** localStorage: CSS px per art pixel of the agents. */
const SCALE_KEY = 'pet.scale'
const SCALES = [1, 1.5, 2, 2.5]

window.addEventListener('error', (e) => {
  window.office.reportError({ kind: 'error', message: `[modo mini] ${String(e.message || e.error?.message || 'erro sem mensagem')}`, stack: e.error instanceof Error ? e.error.stack : undefined })
})

async function boot(): Promise<void> {
  const initial = await window.office.getState()
  const state = new State(initial)
  document.body.classList.add('pet', `platform-${state.platform}`)
  const ui = document.getElementById('ui')!
  mountLiveRegions(document.body)
  const canvas = document.getElementById('pet-stage') as HTMLCanvasElement
  const stage = new Stage(canvas, state)
  stage.scale = SCALES.includes(Number(localStorage.getItem(SCALE_KEY))) ? Number(localStorage.getItem(SCALE_KEY)) : 1.5

  // ---------- toasts ----------
  const toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })
  const toast = (text: string, kind: 'info' | 'ok' | 'err' = 'info') => {
    const el = h('div', { class: `toast toast-${kind}` }, text)
    toasts.append(el)
    setTimeout(() => el.classList.add('out'), 3800)
    setTimeout(() => el.remove(), 4300)
  }

  // ---------- panel and cards, the same as in the office ----------
  /** The panel and the card open above the agent, inside the screen. */
  const place = (id: string) => {
    const at = stage.where(id)
    if (at) document.documentElement.style.setProperty('--pet-anchor', `${Math.round(at.x)}px`)
    stage.hop(id)
  }
  const openPanel = async (id: string) => {
    place(id)
    window.office.petFocus()
    await panel.open(id)
    panel.focusInput()
  }
  const openItem = (agentId: string, itemId?: string, read = false) => {
    place(agentId)
    if (!dialog.open(agentId, itemId, read)) void openPanel(agentId)
    window.office.petFocus()
  }

  const closeTerminal = async (id: string) => {
    const a = state.agents.get(id)
    if (!a) return
    const yes = await confirmDialog(ui, { title: `Fechar a sessão de ${a.name}?`, text: 'O processo do claude no terminal termina.', confirm: 'Fechar sessão', cancel: 'Deixar viver', danger: true })
    if (!yes) return
    const r = await window.office.closeTerminal(id)
    toast(r.ok ? `A sessão de ${a.name} foi encerrada.` : (r.message ?? 'Não consegui fechar a sessão.'), 'err')
  }

  const panel = new AgentPanel(ui, state, {
    goTo: (id) => stage.hop(id),
    closeTerminal: (id) => void closeTerminal(id),
    openItem: (agentId, itemId, read) => openItem(agentId, itemId, read),
    toast,
    exportConversation: (id) => void exportConversation(state, id, toast),
    copyReport: (id) => void copyReport(state, id, toast),
    openResult: (id, entry) => dialog.showEntry(id, entry),
    focusCard: () => dialog.focus(),
    chooseAccount: (id, limit) => dialog.chooseAccount(id, limit),
  })
  const dialog = new Dialog(ui, state, {
    reply: (id) => void openPanel(id),
    toast,
    exportConversation: (id) => void exportConversation(state, id, toast),
    figure: () => null,
  })

  // ---------- the little bar on the right of the floor ----------
  const inboxBadge = h('span', { class: 'badge hidden' })
  const pending = () => [
    ...[...state.permissions.values()].sort((a, b) => a.createdAt - b.createdAt).map((p) => ({ agentId: p.agentId, id: p.id })),
    ...[...state.results.values()].map((r) => ({ agentId: r.agentId, id: r.id })),
  ]
  const nextItem = () => {
    const first = pending()[0]
    if (first) openItem(first.agentId, first.id)
    else toast('Nada esperando você.')
  }
  const syncBar = () => {
    const n = pending().length
    inboxBadge.textContent = String(n)
    inboxBadge.classList.toggle('hidden', n === 0)
  }
  const cycleScale = () => {
    stage.scale = SCALES[(SCALES.indexOf(stage.scale) + 1) % SCALES.length]
    localStorage.setItem(SCALE_KEY, String(stage.scale))
    stage.setGeometry(stage.geometry)
  }
  const newAgent = async () => {
    window.office.petFocus()
    const choice = await openNewAgent(ui, state, null, { toast })
    if (choice?.kind !== 'summon') return
    try {
      const a = await window.office.summon(choice.cwd, choice.permissionMode, choice.brain, choice.worktree)
      toast(`${a.name} chegou. Diga o que fazer.`, 'ok')
      // after it lands: the panel opens over it
      setTimeout(() => void openPanel(a.id), 900)
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }
  const bar = h(
    'div',
    { class: 'pet-bar' },
    h('button', { class: 'pet-btn pet-primary', title: 'Novo agente', onclick: () => void newAgent() }, icon('plus', 16)),
    h('button', { class: 'pet-btn', title: 'Próximo pedido ou resultado', onclick: () => nextItem() }, icon('inbox', 16), inboxBadge),
    h('button', { class: 'pet-btn', title: 'Tamanho dos agentes', onclick: () => cycleScale() }, icon('zoomIn', 16)),
    h('button', { class: 'pet-btn', title: 'Voltar ao escritório', onclick: () => void window.office.petLeave() }, icon('expand', 16)),
  )
  ui.append(bar, toasts)
  const fitBar = () => {
    const reserve = bar.offsetWidth + 24
    const g = stage.geometry
    if (reserve !== stage.reserveRight) {
      stage.reserveRight = reserve
      stage.setGeometry(g)
    }
    document.documentElement.style.setProperty('--pet-ground', `${Math.round(g.height - g.floor)}px`)
  }
  new ResizeObserver(fitBar).observe(bar)

  // ---------- the mouse: through the window, except over an agent or a card ----------
  let interactive = false
  const setInteractive = (on: boolean) => {
    if (on === interactive) return
    interactive = on
    window.office.petInteractive(on)
  }
  const overUi = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)
    return !!el && el !== canvas && el !== document.body && el !== document.documentElement && !!el.closest('#ui > *, .backdrop')
  }
  let press: { id: string; x: number; y: number; dragging: boolean } | null = null
  addEventListener('mousemove', (e) => {
    if (press) {
      if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) {
        press.dragging = true
        stage.grab(press.id)
      }
      if (press.dragging) stage.moveHeld(press.id, e.clientX, e.clientY)
      return
    }
    const hit = stage.hit(e.clientX, e.clientY)
    stage.hover = hit?.id ?? null
    canvas.style.cursor = hit ? 'pointer' : ''
    setInteractive(!!hit || overUi(e.clientX, e.clientY))
  })
  canvas.addEventListener('mousedown', (e) => {
    const hit = stage.hit(e.clientX, e.clientY)
    if (hit && e.button === 0) press = { id: hit.id, x: e.clientX, y: e.clientY, dragging: false }
  })
  addEventListener('mouseup', () => {
    const p = press
    press = null
    if (!p) return
    if (p.dragging) return stage.drop(p.id)
    const items = state.itemsFor(p.id)
    const first = items.permissions[0] ?? items.results[0]
    if (first) openItem(p.id, first.id)
    else void openPanel(p.id)
  })
  // left the window (onto the menu bar, another screen): let go of everything
  document.addEventListener('mouseleave', () => {
    if (press?.dragging) stage.drop(press.id)
    press = null
    stage.hover = null
    setInteractive(false)
  })

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || ui.querySelector('.backdrop')) return
    if (dialog.isOpen) dialog.close()
    else if (panel.isOpen) panel.close()
  })

  // ---------- state ----------
  const render = () => {
    stage.sync()
    panel.render()
    dialog.sync()
    syncBar()
  }
  state.onChange(render)
  window.office.onEvent((e) => {
    if (e.type === 'pet:geometry') {
      stage.setGeometry(e.geometry)
      return fitBar()
    }
    if (e.type === 'notice:open') return openItem(e.agentId, e.itemId)
    if (e.type === 'system' || e.type === 'backstage' || e.type === 'data:notice' || e.type.startsWith('creative:')) return
    if (e.type === 'agent:chat' || e.type === 'member:ended') return
    state.apply(e)
    if (e.type === 'permission:new') {
      const a = state.agents.get(e.request.agentId)
      if (a) toast(`${a.name} precisa de você.`, 'info')
    } else if (e.type === 'result:new') {
      const a = state.agents.get(e.result.agentId)
      if (a) toast(e.result.isError ? `${a.name} teve um problema.` : `${a.name} terminou.`, e.result.isError ? 'err' : 'ok')
    }
  })
  const g = await window.office.petGeometry()
  if (g) stage.setGeometry(g)
  fitBar()
  render()

  // ---------- loop: full speed while someone moves, slow when everyone sits still ----------
  let last = performance.now()
  let drawnAt = 0
  const frame = (now: number) => {
    requestAnimationFrame(frame)
    const wait = stage.busyNow || press ? 0 : 1000 / 12
    if (now - drawnAt < wait - 2) return
    drawnAt = now
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    stage.update(dt)
    stage.draw()
  }
  requestAnimationFrame(frame)

  if (import.meta.env.DEV) Object.assign(window, { __stage: stage, __state: state, __panel: panel })
}

boot().catch((err) => {
  window.office.reportError({ kind: 'error', message: `Modo mini não abriu: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : undefined })
})
