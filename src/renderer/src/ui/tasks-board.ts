import type { State } from '../state'
import type { TaskList } from '@shared/tasks'
import { h } from './dom'

export async function openTasksBoard(root: HTMLElement, state: State, toast: (msg: string, type?: string) => void): Promise<void> {
  const vaultPath = state.settings.vaultPath
  if (!vaultPath) {
    toast('Configure a pasta do vault em Ajustes → Tarefas.', 'err')
    return
  }

  try {
    const result = await (window as any).office.readTasks(vaultPath)
    const { data } = result

    const close = () => board.remove()
    const board = h(
      'div',
      { class: 'board' },
      h(
        'div',
        { class: 'board-head' },
        h('div', { class: 'board-title' }, '📋 Tarefas'),
        h(
          'button',
          { class: 'icon-btn', type: 'button', onclick: close },
          h('span', {}, '✕'),
        ),
      ),
      h(
        'div',
        { class: 'board-body' },
        h(
          'div',
          { class: 'board-cols' },
          ...data.lists.map((list: TaskList) =>
            h(
              'div',
              { class: 'tcol' },
              h(
                'div',
                { class: 'tcol-head' },
                h('span', { class: 'tcol-dot' }),
                h('span', {}, list.name),
                h('span', { class: 'tcol-count' }, String(list.tasks.length)),
              ),
              h(
                'div',
                { class: 'tcol-list' },
                ...(list.tasks.length === 0
                  ? [h('div', { class: 'tcol-empty' }, 'Nenhuma tarefa')]
                  : list.tasks.map((task) =>
                      h('div', { class: 'tcard' }, h('div', { class: 'tcard-title' }, task.text)),
                    )),
              ),
            ),
          ),
        ),
      ),
    ) as HTMLElement

    root.append(board)
    if (data.warnings.length > 0) {
      toast(`⚠️ ${data.warnings.length} linha(s) não reconhecida(s)`, 'info')
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'err')
  }
}
