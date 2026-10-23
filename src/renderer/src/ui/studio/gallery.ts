import { mediaUrl } from '@shared/creative'
import { AUDIO_EXT, LIBRARY_LABEL, type LibraryItem, type LibraryKind } from '@shared/creative-library'
import type { ProjectFloor } from '@shared/types'
import { h, icon } from '../dom'
import { cleanError } from '../modals'

// Galeria: everything the floor generated (images, artes, carrosséis, áudios, análises, posts),
// newest first and grouped by day, in a drawer on the right of the studio.

export interface GalleryActions {
  toast(t: string, k?: 'info' | 'ok' | 'err'): void
  preview(path: string): void
  showText(title: string, text: string): void
  /** Adds the image to the flow (selected Image node, or a new one). */
  useAsRef(path: string): void
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i

const dayLabel = (t: number) => {
  const d = new Date(t)
  const days = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (days <= 0) return 'Hoje'
  if (days === 1) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

const sizeText = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

export function galleryPanel(floor: ProjectFloor, actions: GalleryActions): { el: HTMLElement; toggle(on?: boolean): void; refresh(): void; readonly open: boolean } {
  const el = h('aside', { class: 'st-gallery', 'aria-label': 'Galeria do andar', hidden: true })
  const chips = h('div', { class: 'st-gal-chips' })
  const list = h('div', { class: 'st-gal-list' })
  let items: LibraryItem[] = []
  let filter: LibraryKind | 'all' = 'all'
  let loading = false
  let error = ''

  const head = h(
    'div',
    { class: 'st-gal-head' },
    h('b', {}, 'Galeria'),
    h('button', { class: 'icon-btn', title: 'Ler de novo', 'aria-label': 'Atualizar galeria', onclick: () => refresh() }, icon('reset', 14)),
    h('button', { class: 'icon-btn', title: 'Fechar', 'aria-label': 'Fechar galeria', onclick: () => toggle(false) }, icon('x', 15)),
  )
  el.append(head, chips, list)

  const card = (it: LibraryItem): HTMLElement => {
    const actionsRow: HTMLElement[] = []
    let media: HTMLElement
    if (it.kind === 'analise') {
      media = h('button', { class: 'st-gal-doc', title: 'Abrir a análise', onclick: () => void openText(it) }, icon('file', 22), h('span', {}, it.name.replace(/\.md$/i, '')))
    } else if (AUDIO_EXT.test(it.name)) {
      media = h('audio', { controls: true, preload: 'none', src: mediaUrl(it.path) })
    } else if (VIDEO_EXT.test(it.name)) {
      media = h('video', { controls: true, preload: 'metadata', muted: true, src: mediaUrl(it.path) })
    } else {
      media = h('button', { class: 'st-gal-thumb', title: 'Ampliar', onclick: () => actions.preview(it.path) }, h('img', { src: mediaUrl(it.path), alt: it.name, loading: 'lazy' }))
      actionsRow.push(h('button', { class: 'btn btn-small', title: 'Coloca a imagem no fluxo como referência', onclick: () => actions.useAsRef(it.path) }, icon('plus', 12), 'Referência'))
    }
    actionsRow.push(
      h('button', { class: 'icon-btn', title: 'Mostrar no Finder', 'aria-label': `Mostrar ${it.name} no Finder`, onclick: () => void window.office.revealPath(it.path) }, icon('folder', 13)),
      h('button', { class: 'icon-btn', title: 'Copiar caminho', 'aria-label': `Copiar o caminho de ${it.name}`, onclick: () => void window.office.copyText(it.path).then(() => actions.toast('Caminho copiado.', 'ok')) }, icon('copy', 13)),
    )
    return h(
      'div',
      { class: `st-gal-item k-${it.kind}` },
      media,
      h('div', { class: 'st-gal-meta', title: it.path }, h('span', {}, `${LIBRARY_LABEL[it.kind]} · ${new Date(it.mtime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · ${sizeText(it.size)}`)),
      h('div', { class: 'st-gal-actions' }, ...actionsRow),
    )
  }

  const openText = async (it: LibraryItem) => {
    try {
      actions.showText(it.name.replace(/\.md$/i, ''), await window.office.readLibraryText(floor.id, it.path))
    } catch (err) {
      actions.toast(cleanError(err), 'err')
    }
  }

  const render = () => {
    const kinds = [...new Set(items.map((i) => i.kind))]
    chips.replaceChildren(
      ...(['all', ...kinds] as (LibraryKind | 'all')[]).map((k) =>
        h(
          'button',
          { class: `st-gal-chip${filter === k ? ' on' : ''}`, 'aria-pressed': String(filter === k), onclick: () => ((filter = k), render()) },
          k === 'all' ? 'Tudo' : LIBRARY_LABEL[k],
          h('b', {}, String(k === 'all' ? items.length : items.filter((i) => i.kind === k).length)),
        ),
      ),
    )
    if (loading && !items.length) return void list.replaceChildren(h('div', { class: 'st-note' }, 'Lendo a pasta do andar…'))
    if (error) return void list.replaceChildren(h('div', { class: 'st-error' }, icon('alert', 14), h('span', {}, error)))
    const shown = items.filter((i) => filter === 'all' || i.kind === filter)
    if (!shown.length) return void list.replaceChildren(h('div', { class: 'st-note' }, 'Nada gerado ainda. Rode um nó e o resultado aparece aqui.'))
    const groups = new Map<string, LibraryItem[]>()
    for (const it of shown) {
      const k = dayLabel(it.mtime)
      groups.set(k, [...(groups.get(k) ?? []), it])
    }
    list.replaceChildren(...[...groups].flatMap(([day, its]) => [h('div', { class: 'st-gal-day' }, day), h('div', { class: 'st-gal-grid' }, ...its.map(card))]))
  }

  const refresh = () => {
    loading = true
    error = ''
    render()
    window.office
      .listLibrary(floor.id)
      .then((v) => void (items = v))
      .catch((err) => void (error = cleanError(err)))
      .finally(() => {
        loading = false
        render()
      })
  }

  const toggle = (on = el.hidden) => {
    el.hidden = !on
    if (on) refresh()
  }

  return {
    el,
    toggle,
    refresh: () => {
      if (!el.hidden) refresh()
    },
    get open() {
      return !el.hidden
    },
  }
}
