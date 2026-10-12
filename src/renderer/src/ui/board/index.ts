import { projectFor } from '@shared/projects'
import { PRIORITIES, STATUSES, TYPES } from '@shared/tickets'
import type { Ticket, TicketPriority, TicketStatus, TicketType } from '@shared/types'
import { h, icon } from '../dom'
import { cleanError, field, LAST_CWD, modal } from '../modals'
import { GROUND, select } from './helpers'
import { BoardClosing } from './closing'

export type { BoardActions } from './base'

/** Full-screen kanban: columns, filters and a detail drawer to edit, delegate and review. */

export class Board extends BoardClosing {
  // ---------- create ----------

  /** On "Todos os andares": which floor a card belongs to. */
  protected floorTag(t: Ticket): HTMLElement {
    const p = projectFor(this.state.settings.projects, t.cwd)
    return h('span', { class: 'tfloor', style: p?.brandColor ? `--floor:${p.brandColor}` : '', title: p ? `Andar ${p.name}` : 'Térreo' }, p?.name ?? 'Térreo')
  }

  create(status: TicketStatus = 'todo'): void {
    const title = h('input', { class: 'input', maxlength: 160, placeholder: 'Ex.: Corrigir FITID duplicado na importação OFX' }) as HTMLInputElement
    const type = select(TYPES, 'task', () => undefined)
    const prio = select(PRIORITIES, 'medium', () => undefined)
    const column = select(
      STATUSES.filter((s) => s.value === 'backlog' || s.value === 'todo'),
      status === 'backlog' ? 'backlog' : 'todo',
      () => undefined,
    )
    // New tickets land on the floor being shown: its project folder, or the last folder used outside the projects.
    const floor = this.state.settings.projects.find((p) => p.id === this.floorFilter.value)
    const last = localStorage.getItem(LAST_CWD) ?? ''
    let cwd = floor ? floor.cwd : this.floorFilter.value === GROUND && projectFor(this.state.settings.projects, last) ? '' : last
    const cwdLabel = h('span', { class: 'path-label' }, cwd || 'Nenhuma pasta')
    const pick = h('button', { class: 'btn', type: 'button' }, icon('folder', 15), 'Escolher…')
    pick.addEventListener('click', async () => {
      const p = await window.office.pickFolder(cwd || undefined)
      if (p) {
        cwd = p
        cwdLabel.textContent = p
      }
    })
    const desc = h('textarea', { class: 'input', rows: 5, placeholder: 'Contexto: o que está errado ou o que falta, onde olhar (arquivos, telas), como reproduzir. Markdown funciona.' })
    const crit = h('textarea', { class: 'input', rows: 3, placeholder: 'Um critério por linha. Ex.:\nImportar o mesmo OFX duas vezes não duplica lançamentos\nTestes do importador passam' })
    const tags = h('input', { class: 'input', placeholder: 'backend, ofx' }) as HTMLInputElement

    const close = () => el.remove()
    const submit = async (delegate: boolean, btn: HTMLButtonElement) => {
      if (!title.value.trim()) {
        title.focus()
        return this.actions.toast('Dê um título ao ticket.', 'err')
      }
      if (delegate && !cwd) return this.actions.toast('Escolha a pasta do projeto para o agente saber onde trabalhar.', 'err')
      btn.setAttribute('disabled', '')
      try {
        const t = await window.office.createTicket({
          title: title.value,
          type: type.value as TicketType,
          priority: prio.value as TicketPriority,
          status: column.value as TicketStatus,
          cwd: cwd || undefined,
          description: desc.value,
          acceptance: crit.value
            .split('\n')
            .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])?\s*(?:\[[ x]\]\s*)?/i, '').trim())
            .filter(Boolean)
            .map((text) => ({ text, done: false })),
          tags: tags.value.split(','),
        })
        if (cwd) localStorage.setItem(LAST_CWD, cwd)
        close()
        this.open(t.id)
        if (delegate) {
          const a = await window.office.delegateTicket(t.id, { hire: {} })
          this.actions.toast(`${t.key} criado. ${a.name} foi contratado e está subindo.`, 'ok')
        } else this.actions.toast(`${t.key} criado.`, 'ok')
      } catch (err) {
        this.actions.toast(cleanError(err), 'err')
        btn.removeAttribute('disabled')
      }
    }
    const create = h('button', { class: 'btn' }, 'Criar')
    create.addEventListener('click', () => submit(false, create))
    const createGo = h('button', { class: 'btn btn-primary' }, icon('walk', 15), 'Criar e delegar')
    createGo.addEventListener('click', () => submit(true, createGo))

    const el = modal(
      'Novo ticket',
      [
        field('Título', title),
        h('div', { class: 'field-row' }, field('Tipo', type), field('Prioridade', prio), field('Coluna', column)),
        field('Pasta do projeto', h('div', { class: 'path-row' }, cwdLabel, pick)),
        field('Contexto', desc),
        field('Critérios de aceite', crit, 'O agente marca cada um ao cumprir. Critérios claros = entrega que você aprova de primeira.'),
        field('Tags', tags),
      ],
      [h('button', { class: 'btn', onclick: close }, 'Cancelar'), create, createGo],
      close,
    )
    el.classList.add('backdrop-ticket')
    this.root.append(el)
    title.focus()
  }
}
