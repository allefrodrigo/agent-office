import type { BackupEntry, DataNotice } from '@shared/types'
import { h, icon } from './dom'
import { cleanError, modal } from './modals'

type Toast = (t: string, k?: 'info' | 'ok' | 'err') => void

const SHOWN = 6

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function backupLabel(b: BackupEntry): string {
  // A daily backup is a day (from its folder name), not a moment.
  if (b.kind === 'daily') return `Diário · ${new Date(b.at).toLocaleDateString('pt-BR')}`
  return `Antes de restaurar · ${new Date(b.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
}

/** Configurações → Dados: daily backups with restore, the folder, export and import. */
export function dataSection(toast: Toast): HTMLElement {
  const list = h('div', { class: 'backup-list' }, h('div', { class: 'field-hint' }, 'Carregando backups…'))
  let all: BackupEntry[] = []
  let expanded = false

  const restore = async (b: BackupEntry, btn: HTMLButtonElement) => {
    btn.setAttribute('disabled', '')
    try {
      // The main process asks and restarts the app; false = the user said no.
      await window.office.restoreBackup(b.id)
    } catch (err) {
      toast(cleanError(err), 'err')
    }
    btn.removeAttribute('disabled')
  }

  const render = () => {
    if (!all.length) {
      list.replaceChildren(h('div', { class: 'field-hint' }, 'Nenhum backup ainda. O primeiro sai hoje, assim que houver dados.'))
      return
    }
    const rows = (expanded ? all : all.slice(0, SHOWN)).map((b) => {
      const btn = h('button', { class: 'btn btn-small', type: 'button' }, 'Restaurar')
      btn.addEventListener('click', () => restore(b, btn))
      return h(
        'div',
        { class: 'backup-row' },
        h('span', { class: 'backup-when' }, backupLabel(b)),
        h('span', { class: 'backup-size', title: b.files.join(', ') }, formatSize(b.size)),
        btn,
      )
    })
    const more = all.length > SHOWN && !expanded ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => ((expanded = true), render()) }, `Ver todos (${all.length})`) : null
    list.replaceChildren(...rows, ...(more ? [more] : []))
  }

  window.office
    .listBackups()
    .then((b) => {
      all = b
      render()
    })
    .catch((err) => list.replaceChildren(h('div', { class: 'field-hint' }, cleanError(err))))

  const exportBtn = h('button', { class: 'btn', type: 'button' }, 'Exportar…')
  exportBtn.addEventListener('click', async () => {
    try {
      const path = await window.office.exportData()
      if (path) toast(`Dados exportados para ${path}.`, 'ok')
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  })
  const importBtn = h('button', { class: 'btn', type: 'button' }, 'Importar…')
  importBtn.addEventListener('click', async () => {
    try {
      await window.office.importData()
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  })

  return h(
    'div',
    { class: 'bridge-box data-box' },
    h('div', { class: 'bridge-title' }, icon('archive', 16), 'Dados'),
    h(
      'div',
      { class: 'field-hint' },
      'Uma cópia por dia de agentes, configurações, gastos e tickets, guardada por 14 dias. Restaurar salva antes o estado atual e reinicia o app.',
    ),
    list,
    h(
      'div',
      { class: 'bridge-row' },
      h('button', { class: 'btn', type: 'button', onclick: () => window.office.openBackupsFolder() }, icon('folder', 15), 'Abrir pasta'),
      h('div', { class: 'grow' }),
      exportBtn,
      importBtn,
    ),
  )
}

/** The warning for a data file found corrupt at startup. Stays until the user closes it. */
export function showDataNotice(root: HTMLElement, n: DataNotice): void {
  const close = () => el.remove()
  const el = modal(
    n.kind === 'restored' ? 'Restauramos um backup' : 'Dados corrompidos',
    [h('div', { class: 'confirm-warn data-notice' }, icon('alert', 16), h('span', {}, n.text))],
    [
      h('button', { class: 'btn', onclick: () => window.office.revealPath(n.path) }, icon('folder', 15), 'Mostrar o arquivo'),
      h('button', { class: 'btn btn-primary', onclick: close }, 'Entendi'),
    ],
    close,
  )
  el.classList.add('backdrop-confirm')
  root.append(el)
}
