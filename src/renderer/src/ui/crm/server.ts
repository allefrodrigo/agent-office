import { formatBytes, serverView, type ServerTone } from '@shared/crm-server'
import type { CrmServerAction, CrmServerStatus } from '@shared/types'
import { h, icon } from '../dom'
import { chipPopover } from './chip'
import { crmError, type Toast } from './util'

// "Servidor local": a Evolution que roda neste computador, em Docker (Colima ou Docker Desktop).
// Mostra se está ligada, quanto de memória usa e deixa ligar e desligar — o usuário nem sempre
// usa o WhatsApp do CRM. A mesma caixa aparece em Configurações → CRM e no topo da tela do CRM.

/** How often the open box reads the state again. */
const POLL_MS = 15_000

const DOT: Record<ServerTone, string> = { on: 'dot-working', off: 'dot-idle', busy: 'dot-waiting', warn: 'dot-waiting', error: 'dot-error' }

export interface ServerBox {
  el: HTMLElement
  /** Reads the state now (the popover opened). */
  refresh(): void
  dispose(): void
}

/** Keeps the last status: the chip on the CRM screen draws from it without asking docker each time. */
let lastStatus: CrmServerStatus | null = null
const watchers = new Set<(s: CrmServerStatus) => void>()
let unsubscribe: (() => void) | null = null

function publish(s: CrmServerStatus): void {
  lastStatus = s
  for (const fn of watchers) fn(s)
}

/** Every status the main process sends (after an action) or a box reads. Returns the unsubscribe. */
export function watchServer(fn: (s: CrmServerStatus) => void): () => void {
  watchers.add(fn)
  unsubscribe ??= window.office.onEvent((e) => {
    if (e.type === 'crm:server') publish(e.status)
  })
  if (lastStatus) fn(lastStatus)
  return () => {
    watchers.delete(fn)
    if (!watchers.size && unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }
}

/** Reads the state (with the memory measure) and tells every watcher. */
export async function readServer(): Promise<CrmServerStatus> {
  const s = await window.office.crmServer('status')
  publish(s)
  return s
}

export function serverBox(opts: { toast: Toast; title?: boolean }): ServerBox {
  const dot = h('span', { class: 'dot', 'aria-hidden': 'true' })
  const label = h('span', { class: 'crm-server-label' }, 'Lendo o servidor…')
  const detail = h('div', { class: 'field-hint crm-server-detail' })
  const list = h('ul', { class: 'crm-server-list', 'aria-label': 'Contêineres da Evolution' })
  const primary = h('button', { class: 'btn', type: 'button' }) as HTMLButtonElement
  const engineStop = h('button', { class: 'btn', type: 'button' }, icon('power', 15), 'Desligar o Colima também') as HTMLButtonElement
  const refreshBtn = h(
    'button',
    { class: 'icon-btn', type: 'button', title: 'Atualizar', 'aria-label': 'Ler o estado do servidor de novo' },
    icon('reset', 15),
  ) as HTMLButtonElement
  const live = h('div', { class: 'crm-server-head', role: 'status', 'aria-live': 'polite' }, dot, label)
  const el = h(
    'div',
    { class: 'bridge-box crm-server' },
    opts.title === false ? null : h('div', { class: 'bridge-title' }, icon('rack', 16), 'Servidor local da Evolution'),
    h('div', { class: 'bridge-row' }, live, refreshBtn),
    detail,
    list,
    h('div', { class: 'bridge-row bridge-row-start' }, primary, engineStop),
  )

  let acting = false
  let disposed = false
  let timer: ReturnType<typeof setInterval> | null = null

  function render(s: CrmServerStatus): void {
    const v = serverView(s)
    dot.className = `dot ${DOT[v.tone]}`
    label.textContent = v.label
    detail.textContent = s.error ? `${v.detail} ${s.error}` : v.detail
    list.replaceChildren(
      ...s.containers.map((c) =>
        h(
          'li',
          {},
          h('span', {
            class: `dot ${c.state === 'running' ? 'dot-working' : c.state === 'starting' ? 'dot-waiting' : 'dot-idle'}`,
            'aria-hidden': 'true',
          }),
          h('span', { class: 'crm-server-name' }, c.service),
          h(
            'span',
            { class: 'crm-server-meta' },
            [c.state === 'running' ? 'rodando' : c.state === 'starting' ? 'reiniciando' : 'parado', c.mem ? formatBytes(c.mem) : '']
              .filter(Boolean)
              .join(' · '),
          ),
        ),
      ),
    )
    list.classList.toggle('hidden', !s.containers.length)
    const busy = acting || !!s.busy
    primary.classList.toggle('hidden', !v.primary)
    primary.disabled = busy
    primary.replaceChildren(icon('power', 15), v.primary === 'stop' ? 'Desligar' : 'Ligar')
    primary.classList.toggle('btn-primary', v.primary === 'start')
    primary.dataset.action = v.primary ?? ''
    engineStop.classList.toggle('hidden', !v.engineStop)
    engineStop.disabled = busy
    refreshBtn.disabled = busy
    el.setAttribute('aria-busy', String(busy))
  }

  const offWatch = watchServer((s) => !disposed && render(s))

  async function refresh(): Promise<void> {
    if (acting || disposed) return
    try {
      await readServer()
    } catch (err) {
      label.textContent = 'Não consegui ler o servidor'
      detail.textContent = crmError(err)
    }
  }

  async function act(action: CrmServerAction, done: string): Promise<void> {
    if (acting) return
    acting = true
    if (lastStatus) render(lastStatus)
    try {
      publish(await window.office.crmServer(action))
      opts.toast(done, 'ok')
    } catch (err) {
      opts.toast(crmError(err), 'err')
      void readServer().catch(() => undefined)
    } finally {
      acting = false
      if (lastStatus && !disposed) render(lastStatus)
    }
  }

  primary.addEventListener('click', () => {
    if (primary.dataset.action === 'stop') void act('stop', 'Evolution desligada. Ligue de novo quando for usar o WhatsApp do CRM.')
    else if (primary.dataset.action === 'start') void act('start', 'Evolution ligada.')
  })
  engineStop.addEventListener('click', () => void act('stopEngine', 'Colima desligado. A memória dele voltou para o computador.'))
  refreshBtn.addEventListener('click', () => void refresh())

  void refresh()
  timer = setInterval(() => {
    // the box left the page (settings closed): stop asking
    if (!el.isConnected) return dispose()
    void refresh()
  }, POLL_MS)

  function dispose(): void {
    if (disposed) return
    disposed = true
    offWatch()
    if (timer) clearInterval(timer)
  }

  return { el, refresh: () => void refresh(), dispose }
}

/**
 * The chip on the CRM screen's top bar: a dot with the server's state; it opens the box in a
 * popover. Hidden while the machine has no docker (a remote Evolution has nothing to turn off).
 */
export function serverChip(opts: { toast: Toast }): { el: HTMLElement; dispose(): void } {
  const chip = chipPopover({
    label: 'Evolution',
    title: 'Servidor local da Evolution',
    box: () => serverBox({ toast: opts.toast, title: true }),
  })
  chip.el.hidden = true
  const off = watchServer((s) => {
    chip.el.hidden = !s.docker
    if (!s.docker) chip.close()
    chip.dot.className = `dot ${DOT[serverView(s).tone]}`
    chip.btn.setAttribute('aria-label', `Servidor local da Evolution: ${serverView(s).label}`)
  })
  void readServer().catch(() => undefined)
  return {
    el: chip.el,
    dispose: () => {
      chip.dispose()
      off()
    },
  }
}
