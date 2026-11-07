import { h } from '../dom'
import { cleanError } from '../modals'
import { MicButton } from '../voice'

// O bloco de notas da reunião: texto livre com Markdown leve, salvo sozinho 1 s depois da
// última tecla. Fechar a sala ou trocar de reunião salva na hora (flush).

/** Espera depois da última tecla antes de salvar. */
export const NOTES_SAVE_MS = 1000

export interface NotesEditor {
  el: HTMLElement
  textarea: HTMLTextAreaElement
  /** Salva agora o que ainda não foi salvo. */
  flush(): Promise<void>
  destroy(): Promise<void>
}

export function notesEditor(meetingId: string, initial: string, opts: { placeholder?: string; onError(msg: string): void }): NotesEditor {
  const textarea = h('textarea', {
    class: 'mr-notes-text',
    'aria-label': 'Notas da reunião',
    spellcheck: 'true',
    placeholder: opts.placeholder ?? '# Assunto\n- o que foi combinado\n- [ ] o que fazer depois',
  })
  textarea.value = initial
  const status = h('span', { class: 'mr-notes-status', role: 'status' })
  const mic = new MicButton(textarea, { size: 15, small: true })
  const el = h(
    'div',
    { class: 'mr-notes' },
    textarea,
    h('div', { class: 'mr-notes-foot' }, h('span', { class: 'mr-notes-hint' }, '# título · - lista · [ ] tarefa'), status, mic.el),
  )
  let saved = initial
  let timer = 0
  let saving: Promise<void> = Promise.resolve()

  const save = (): Promise<void> => {
    window.clearTimeout(timer)
    const text = textarea.value
    if (text === saved) return saving
    saving = saving.then(async () => {
      try {
        await window.office.meetingNotes(meetingId, text)
        saved = text
        status.textContent = 'Salvo'
      } catch (err) {
        status.textContent = 'Não salvou'
        opts.onError(`As notas não foram salvas: ${cleanError(err)}`)
      }
    })
    return saving
  }

  textarea.addEventListener('input', () => {
    status.textContent = ''
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void save(), NOTES_SAVE_MS)
  })

  return {
    el,
    textarea,
    flush: save,
    async destroy() {
      await save()
    },
  }
}
