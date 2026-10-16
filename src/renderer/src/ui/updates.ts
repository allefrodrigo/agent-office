import './updates.css'
import type { UpdateChannel, UpdateStatus } from '@shared/types'
import { h, icon, timeAgo } from './dom'
import { confirmDialog } from './modals'

/** Last status from the main process; the notice and the settings box both read it. */
let current: UpdateStatus = { state: 'disabled' }
const listeners = new Set<(s: UpdateStatus) => void>()
let tracking = false

function track(): void {
  if (tracking) return
  tracking = true
  window.office.onEvent((e) => {
    if (e.type !== 'update') return
    current = e.update
    for (const l of listeners) l(current)
  })
  void window.office.updateStatus().then((s) => {
    current = s
    for (const l of listeners) l(current)
  })
}

/** The last status the main process sent. */
export function currentUpdate(): UpdateStatus {
  return current
}

export function listen(cb: (s: UpdateStatus) => void): () => void {
  track()
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Restarts into the new version; asks first when agents work or permissions wait. */
export async function restart(root: HTMLElement): Promise<void> {
  const r = await window.office.installUpdate()
  if (r.ok || (!r.working && !r.pending)) return
  const parts = [
    r.working ? `${r.working === 1 ? '1 agente está' : `${r.working} agentes estão`} trabalhando` : '',
    r.pending ? `${r.pending === 1 ? '1 pedido de permissão espera' : `${r.pending} pedidos de permissão esperam`} por você` : '',
  ].filter(Boolean)
  const go = await confirmDialog(root, {
    title: 'Reiniciar agora?',
    text: `${parts.join(' e ')}. Reiniciar interrompe o que estiver rodando; as conversas continuam depois, de onde pararam.`,
    confirm: 'Reiniciar mesmo assim',
    cancel: 'Depois',
    danger: true,
  })
  if (go) await window.office.installUpdate(true)
}

/** Small notice at the top of the HUD: "Versão X pronta. Reiniciar agora?". */
export function mountUpdateNotice(root: HTMLElement): void {
  const el = h('div', { class: 'update-notice hidden' })
  let dismissed = ''
  const render = (s: UpdateStatus) => {
    const show = s.state === 'ready' && !!s.version && s.version !== dismissed
    el.classList.toggle('hidden', !show)
    if (!show) return
    el.replaceChildren(
      icon('download', 15),
      h('span', {}, `Versão ${s.version} pronta. Reiniciar agora?`),
      h('button', { class: 'btn btn-small btn-primary', onclick: () => void restart(root) }, 'Reiniciar'),
      h(
        'button',
        { class: 'btn btn-small', title: 'Ela é instalada quando você fechar o app', onclick: () => ((dismissed = s.version ?? ''), render(s)) },
        'Depois',
      ),
    )
  }
  root.append(el)
  listen(render)
}

export function describe(s: UpdateStatus): string {
  const when = s.checkedAt ? ` (${timeAgo(s.checkedAt)})` : ''
  switch (s.state) {
    case 'disabled':
      return 'Só o app instalado se atualiza. Em desenvolvimento, nada a verificar.'
    case 'idle':
      return 'Verifica na abertura e a cada 6 horas.'
    case 'checking':
      return 'Procurando versão nova…'
    case 'downloading':
      return `Baixando a versão ${s.version ?? 'nova'}${s.percent ? `: ${s.percent}%` : '…'}`
    case 'ready':
      return `Versão ${s.version} pronta. Reinicie para instalar.`
    case 'latest':
      return `Você está na versão mais nova${when}.`
    case 'error':
      return `Não consegui verificar${when}: ${s.message ?? 'erro desconhecido'}`
  }
}

/** Settings section: channel, status and "Verificar agora". value() is saved with the form. */
export function updateSettingsBox(root: HTMLElement, channel: UpdateChannel | undefined): { el: HTMLElement; value(): UpdateChannel } {
  const select = h(
    'select',
    { class: 'input update-channel', title: 'Canal de atualização' },
    h('option', { value: 'stable' }, 'Estável'),
    h('option', { value: 'beta' }, 'Beta (versões de teste)'),
  ) as HTMLSelectElement
  select.value = channel === 'beta' ? 'beta' : 'stable'
  const status = h('div', { class: 'bridge-status' })
  const check = h('button', { class: 'btn', type: 'button' }, 'Verificar agora') as HTMLButtonElement
  const restartBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void restart(root) }, 'Reiniciar')
  const render = (s: UpdateStatus) => {
    const dot = s.state === 'error' ? 'dot-error' : s.state === 'ready' || s.state === 'latest' ? 'dot-working' : 'dot-stopped'
    status.replaceChildren(h('span', { class: `dot ${dot}` }), describe(s))
    check.disabled = s.state === 'disabled' || s.state === 'checking' || s.state === 'downloading'
    restartBtn.classList.toggle('hidden', s.state !== 'ready')
  }
  check.addEventListener('click', async () => {
    // Check on the channel picked here, even before the form is saved.
    if (select.value !== (channel ?? 'stable')) {
      channel = select.value as UpdateChannel
      await window.office.saveSettings({ updateChannel: channel })
    }
    render(await window.office.checkForUpdates())
  })
  const el = h(
    'div',
    { class: 'bridge-box' },
    h('div', { class: 'bridge-title' }, icon('download', 16), 'Atualizações'),
    h('div', { class: 'field-hint' }, 'O app baixa versões novas em segundo plano e pergunta antes de reiniciar.'),
    status,
    h('div', { class: 'update-actions' }, select, check, restartBtn),
  )
  const stop = listen(render)
  render(current)
  // The settings modal is removed from the DOM on close: stop listening then.
  let shown = false
  new MutationObserver((_, obs) => {
    if (el.isConnected) shown = true
    if (el.isConnected || !shown) return
    stop()
    obs.disconnect()
  }).observe(root, { childList: true, subtree: true })
  return { el, value: () => select.value as UpdateChannel }
}
