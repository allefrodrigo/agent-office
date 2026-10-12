import type { Ticket } from '@shared/types'
import { h, timeAgo } from '../dom'
import { cleanError, confirmDialog, field, modal } from '../modals'
import { AUTO_CLOSE, closedBody } from './helpers'
import { BoardDetail } from './detail'

/** Closing tickets: auto-close after done and the window of closed tickets. */
export abstract class BoardClosing extends BoardDetail {
  // ---------- closing ----------

  protected autoCloseText(t: Ticket): string {
    const days = this.state.settings.ticketAutoCloseDays
    if (!days) return 'Aprovado. Feche quando quiser tirar do quadro.'
    const left = Math.ceil(((t.doneAt ?? t.updatedAt) + days * 86_400_000 - Date.now()) / 86_400_000)
    return left > 1 ? `Aprovado. Fecha sozinho em ${left} dias.` : 'Aprovado. Fecha sozinho em até um dia.'
  }

  protected async closeOne(t: Ticket): Promise<void> {
    try {
      await window.office.closeTickets([t.id])
      this.select(null)
      this.actions.toast(`${t.key} fechado. Está em Fechados se precisar.`, 'ok')
    } catch (err) {
      this.actions.toast(cleanError(err), 'err')
    }
  }

  protected async closeAll(): Promise<void> {
    const n = [...this.state.tickets.values()].filter((t) => t.status === 'done').length
    const yes = await confirmDialog(this.root, {
      title: n === 1 ? 'Fechar 1 ticket?' : `Fechar ${n} tickets?`,
      text: 'Os tickets de Feito saem do quadro e vão para Fechados, com comentários e histórico. Dá para reabrir depois.',
      confirm: 'Fechar',
      cancel: 'Agora não',
    })
    if (!yes) return
    try {
      const closed = await window.office.closeTickets()
      this.actions.toast(closed === 1 ? '1 ticket fechado.' : `${closed} tickets fechados.`, 'ok')
    } catch (err) {
      this.actions.toast(cleanError(err), 'err')
    }
  }

  /** Closed tickets: search, read and reopen; also where auto-close is set. */
  protected openClosed(): void {
    const search = h('input', { class: 'input', placeholder: 'Buscar por chave, título, tag…' }) as HTMLInputElement
    const list = h('div', { class: 'closed-list' })
    const auto = h(
      'select',
      { class: 'input closed-auto' },
      ...AUTO_CLOSE.map((d) => h('option', { value: d }, d === 0 ? 'Só quando eu fechar' : d === 1 ? 'Depois de 1 dia em Feito' : `Depois de ${d} dias em Feito`)),
    ) as HTMLSelectElement
    auto.value = String(this.state.settings.ticketAutoCloseDays)
    auto.addEventListener('change', async () => {
      try {
        const saved = await window.office.saveSettings({ ticketAutoCloseDays: Number(auto.value) })
        this.state.apply({ type: 'settings', settings: saved })
      } catch (err) {
        this.actions.toast(cleanError(err), 'err')
      }
    })
    let open: string | null = null
    let found: Ticket[] = []
    const draw = () =>
      list.replaceChildren(
        ...(found.length
          ? found.map((t) => {
              const reopen = h('button', { class: 'btn btn-small', title: 'Volta para A fazer' }, 'Reabrir')
              reopen.addEventListener('click', async (e) => {
                e.stopPropagation()
                try {
                  await window.office.reopenTicket(t.id)
                  found = found.filter((x) => x.id !== t.id)
                  draw()
                  this.actions.toast(`${t.key} voltou para A fazer.`, 'ok')
                } catch (err) {
                  this.actions.toast(cleanError(err), 'err')
                }
              })
              const row = h(
                'div',
                { class: 'closed-row' + (open === t.id ? ' open' : '') },
                h(
                  'div',
                  { class: 'closed-head' },
                  h('span', { class: 'tkey' }, t.key),
                  h('span', { class: 'closed-title' }, t.title),
                  h('span', { class: 'closed-when', title: t.closedAt ? new Date(t.closedAt).toLocaleString('pt-BR') : '' }, t.closedAt ? timeAgo(t.closedAt) : ''),
                  reopen,
                ),
                open === t.id ? closedBody(t) : null,
              )
              row.querySelector('.closed-head')!.addEventListener('click', () => {
                open = open === t.id ? null : t.id
                draw()
              })
              return row
            })
          : [h('div', { class: 'field-hint' }, search.value.trim() ? 'Nenhum ticket fechado com essa busca.' : 'Nenhum ticket fechado ainda.')]),
      )
    let seq = 0
    const load = async () => {
      const mine = ++seq
      const r = await window.office.listClosed(search.value)
      if (mine !== seq) return
      found = r
      draw()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    search.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 200)
    })
    const el = modal(
      'Tickets fechados',
      [
        field('Fechar sozinho', auto, 'Tickets aprovados saem do quadro depois desse tempo. Ficam aqui, com comentários e histórico.'),
        search,
        list,
      ],
      [h('button', { class: 'btn', onclick: () => el.remove() }, 'Fechar janela')],
      () => el.remove(),
    )
    el.classList.add('closed-modal')
    el.addEventListener('keydown', (e) => e.stopPropagation())
    this.root.append(el)
    search.focus()
    void load()
  }

  protected async remove(t: Ticket): Promise<void> {
    const yes = await confirmDialog(this.root, {
      title: `Excluir ${t.key}?`,
      text: `"${t.title}" sai do quadro com comentários e histórico. Não dá para desfazer.`,
      confirm: 'Excluir',
      cancel: 'Manter',
      danger: true,
    })
    if (!yes) return
    await window.office.deleteTicket(t.id)
    this.select(null)
  }
}
