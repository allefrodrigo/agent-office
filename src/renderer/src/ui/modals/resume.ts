import { resumeCommand } from '@shared/commands'
import { groupSessionsByProject } from '@shared/sessions'
import type { SessionEntry } from '@shared/types'
import type { State } from '../../state'
import { h, icon, timeAgo } from '../dom'
import { osText, terminalError, terminalToast } from '../os-text'
import { cleanError, confirmDialog, modal } from './common'

// Resume center: recent Claude Code sessions.

const RECENT_MS = 2 * 60 * 1000
const GROUP_KEY = 'resume-group-by'
/** Projects open on arrival; the rest start folded so the list reads as an index. */
const OPEN_PROJECTS = 3

type GroupBy = 'project' | 'day'

/** Resume center: recent Claude Code sessions, with a way to call each one back. */
export function openResume(
  root: HTMLElement,
  state: State,
  actions: { openAgent(id: string): void; toast(t: string, k?: 'info' | 'ok' | 'err'): void },
): void {
  let sessions: SessionEntry[] = []
  let groupBy: GroupBy = localStorage.getItem(GROUP_KEY) === 'day' ? 'day' : 'project'
  // Folded state per project, set once the user clicks a header; until then OPEN_PROJECTS rules.
  const folded = new Map<string, boolean>()
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

  const mac = state.platform === 'darwin'
  /** "Terminal" is the Mac app's name; elsewhere it means any terminal. */
  const terminalLabel = mac ? 'Abrir no Terminal' : 'Abrir no terminal'

  const row = (s: SessionEntry, showFolder = true): HTMLElement => {
    const owner = [...state.agents.values()].find((a) => a.sessionId === s.sessionId)
    const recent = Date.now() - s.lastModified < RECENT_MS
    const folder = s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() : 'pasta desconhecida'
    const command = resumeCommand(state.platform, s.cwd, s.sessionId)
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
          (mac || state.platform === 'win32') && s.cwd
            ? h('button', {
                class: 'icon-btn',
                title: terminalLabel,
                'aria-label': terminalLabel,
                onclick: async () => {
                  const r = await window.office.openInTerminal(s.sessionId)
                  if (r.ok) actions.toast(terminalToast(r.via, state.platform), 'ok')
                  else actions.toast(terminalError(r.message, state.platform), 'err')
                },
              }, icon('terminal', 15))
            : null,
          command
            ? h('button', {
                class: 'icon-btn',
                title: `Copiar: claude --resume ${s.sessionId}`,
                'aria-label': 'Copiar comando',
                onclick: async () => {
                  await navigator.clipboard.writeText(command)
                  actions.toast(osText(state.platform).copiedToast, 'ok')
                },
              }, icon('copy', 15))
            : null,
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
          showFolder ? icon('folder', 12) : null,
          showFolder ? h('span', { title: s.cwd ?? '' }, folder ?? '') : null,
          s.branch ? h('span', { class: 'resume-branch' }, s.branch) : null,
          showFolder || s.branch ? h('span', {}, '·') : null,
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
    if (groupBy === 'day') {
      const groups = new Map<string, SessionEntry[]>()
      for (const s of shown) {
        const g = dayGroup(s.lastModified)
        groups.set(g, [...(groups.get(g) ?? []), s])
      }
      list.replaceChildren(...[...groups].flatMap(([g, items]) => [h('div', { class: 'resume-group' }, g), ...items.map((s) => row(s))]))
      return
    }
    const projects = groupSessionsByProject(shown, state.settings.projects)
    list.replaceChildren(
      ...projects.flatMap((p, i) => {
        // A search opens every project that matched.
        const open = q ? true : !(folded.get(p.key) ?? i >= OPEN_PROJECTS)
        const head = h(
          'button',
          {
            class: `resume-project${open ? ' open' : ''}`,
            type: 'button',
            title: p.cwd ?? '',
            'aria-expanded': String(open),
            onclick: () => {
              if (q) return
              folded.set(p.key, open)
              render()
            },
          },
          icon('chevron', 13),
          icon('folder', 14),
          h('span', { class: 'resume-project-name' }, p.name),
          h('span', { class: 'resume-project-count' }, String(p.sessions.length)),
          h('span', { class: 'resume-project-when' }, timeAgo(p.lastModified)),
        )
        return open ? [head, ...p.sessions.map((s) => row(s, !!s.cwd && sessionFolderDiffers(s.cwd, p.cwd)))] : [head]
      }),
    )
  }

  const tabBtn = (key: GroupBy, label: string) =>
    h('button', {
      class: `seg-btn${groupBy === key ? ' on' : ''}`,
      type: 'button',
      onclick: () => {
        groupBy = key
        localStorage.setItem(GROUP_KEY, key)
        for (const b of tabs.children) b.classList.toggle('on', b === tabs.children[key === 'project' ? 0 : 1])
        render()
      },
    }, label)
  const tabs = h('div', { class: 'seg resume-tabs', role: 'tablist' }, tabBtn('project', 'Por projeto'), tabBtn('day', 'Por data'))

  search.addEventListener('input', render)
  const el = modal(
    'Central de resume',
    [h('div', { class: 'field-hint' }, 'Sessões recentes do Claude Code nesta máquina, do terminal ou do escritório. "Chamar" traz a sessão de volta como agente, com o histórico.'), h('div', { class: 'resume-bar' }, search, tabs), list],
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

/** True when the session ran in a subfolder or worktree, not the project folder itself. */
function sessionFolderDiffers(cwd: string, root: string | undefined): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  return !root || norm(cwd) !== norm(root)
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
