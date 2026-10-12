import type { SessionEntry } from '@shared/types'
import type { State } from '../../state'
import { h, icon, timeAgo } from '../dom'
import { cleanError, confirmDialog, modal } from './common'

// Resume center: recent Claude Code sessions.

const RECENT_MS = 2 * 60 * 1000

/** Resume center: recent Claude Code sessions, with a way to call each one back. */
export function openResume(
  root: HTMLElement,
  state: State,
  actions: { openAgent(id: string): void; toast(t: string, k?: 'info' | 'ok' | 'err'): void },
): void {
  let sessions: SessionEntry[] = []
  const search = h('input', { class: 'input resume-search', placeholder: 'Buscar por título, pedido ou pasta…' })
  const list = h('div', { class: 'resume-list' }, h('div', { class: 'resume-empty' }, 'Carregando sessões…'))
  const close = () => el.remove()

  const callBack = async (s: SessionEntry, btn: HTMLButtonElement) => {
    if (Date.now() - s.lastModified < RECENT_MS) {
      const go = await confirmDialog(root, {
        title: 'Essa sessão pode estar aberta',
        text: 'Ela foi usada há menos de 2 minutos, talvez num terminal. Retomar a mesma sessão em dois lugares ao mesmo tempo mistura as conversas.',
        confirm: 'Chamar mesmo assim',
        cancel: 'Cancelar',
      })
      if (!go) return
    }
    btn.setAttribute('disabled', '')
    try {
      const a = await window.office.recall(s.sessionId)
      close()
      actions.toast(`${a.name} voltou com a sessão "${clip(s.title, 40)}".`, 'ok')
      actions.openAgent(a.id)
    } catch (err) {
      actions.toast(cleanError(err), 'err')
      btn.removeAttribute('disabled')
    }
  }

  const row = (s: SessionEntry): HTMLElement => {
    const owner = [...state.agents.values()].find((a) => a.sessionId === s.sessionId)
    const recent = Date.now() - s.lastModified < RECENT_MS
    const folder = s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() : 'pasta desconhecida'
    const command = `cd '${(s.cwd ?? '.').replace(/'/g, `'\\''`)}' && claude --resume ${s.sessionId}`
    const badge = owner
      ? h('span', { class: owner.source === 'office' ? 'chip chip-done' : 'chip chip-term' }, owner.source === 'office' ? `no escritório: ${owner.name}` : 'aberta no terminal')
      : recent
        ? h('span', { class: 'chip chip-wait' }, 'usada agora')
        : null
    const callBtn = h('button', { class: 'btn btn-small btn-primary' }, icon('walk', 14), 'Chamar')
    callBtn.addEventListener('click', () => callBack(s, callBtn))
    const actionsEl = owner
      ? h('button', {
          class: 'btn btn-small',
          onclick: () => {
            close()
            actions.openAgent(owner.id)
          },
        }, icon('eye', 14), 'Ver')
      : h(
          'div',
          { class: 'resume-actions' },
          s.cwd ? callBtn : null,
          state.platform === 'darwin' && s.cwd
            ? h('button', {
                class: 'icon-btn',
                title: 'Abrir no Terminal',
                onclick: async () => {
                  const r = await window.office.openInTerminal(s.sessionId)
                  if (r.ok) actions.toast('Abrindo a sessão no Terminal.', 'ok')
                  else actions.toast(r.message ?? 'Não consegui abrir o Terminal.', 'err')
                },
              }, icon('terminal', 15))
            : null,
          h('button', {
            class: 'icon-btn',
            title: `Copiar: claude --resume ${s.sessionId}`,
            onclick: async () => {
              await navigator.clipboard.writeText(command)
              actions.toast('Comando copiado. Cole no terminal.', 'ok')
            },
          }, icon('copy', 15)),
        )
    const prompt = s.firstPrompt && s.firstPrompt !== s.title && !s.title.startsWith(s.firstPrompt.slice(0, 30)) ? s.firstPrompt : null
    return h(
      'div',
      { class: 'resume-row' },
      h(
        'div',
        { class: 'resume-main' },
        h('div', { class: 'resume-title' }, h('span', { class: 'resume-title-text' }, s.title), badge),
        h(
          'div',
          { class: 'resume-meta' },
          icon('folder', 12),
          h('span', { title: s.cwd ?? '' }, folder ?? ''),
          s.branch ? h('span', { class: 'resume-branch' }, s.branch) : null,
          h('span', {}, '·'),
          h('span', {}, timeAgo(s.lastModified)),
          h('span', { class: 'resume-id', title: s.sessionId }, s.sessionId.slice(0, 8)),
        ),
        prompt ? h('div', { class: 'resume-prompt' }, prompt) : null,
      ),
      actionsEl,
    )
  }

  const render = () => {
    const q = search.value.trim().toLowerCase()
    const shown = sessions.filter((s) => !q || [s.title, s.firstPrompt, s.cwd, s.branch, s.sessionId].some((v) => v?.toLowerCase().includes(q)))
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'resume-empty' }, sessions.length ? 'Nenhuma sessão com esse texto.' : 'Nenhuma sessão salva ainda.'))
      return
    }
    const groups = new Map<string, SessionEntry[]>()
    for (const s of shown) {
      const g = dayGroup(s.lastModified)
      groups.set(g, [...(groups.get(g) ?? []), s])
    }
    list.replaceChildren(...[...groups].flatMap(([g, items]) => [h('div', { class: 'resume-group' }, g), ...items.map(row)]))
  }

  search.addEventListener('input', render)
  const el = modal(
    'Central de resume',
    [h('div', { class: 'field-hint' }, 'Sessões recentes do Claude Code nesta máquina, do terminal ou do escritório. "Chamar" traz a sessão de volta como agente, com o histórico.'), search, list],
    [h('button', { class: 'btn', onclick: close }, 'Fechar')],
    close,
  )
  el.classList.add('backdrop-resume')
  root.append(el)
  search.focus()

  window.office
    .listSessions()
    .then((s) => {
      sessions = s
      render()
    })
    .catch((err) => list.replaceChildren(h('div', { class: 'resume-empty' }, cleanError(err))))
}

function dayGroup(t: number): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(new Date()) - day(new Date(t))) / 86400000)
  if (diff <= 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  if (diff < 7) return 'Esta semana'
  return 'Mais antigas'
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
