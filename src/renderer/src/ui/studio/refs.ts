import { mediaUrl } from '@shared/creative'
import { cleanTag, MAX_TAGS, type RefItem } from '@shared/social'
import type { ProjectFloor } from '@shared/types'
import { h, icon } from '../dom'
import { cleanError } from '../modals'
import { onStudioProgress } from './session'
import type { Widget } from './widget'

// Referências: ads captured from the Meta Ads Library (@perfil, library link or ad ID) and files
// added by hand, with tags. Drag one to the canvas and it becomes an Image or Video node.

/** dataTransfer type of a reference dragged to the canvas. */
export const REF_DRAG = 'application/x-office-ref'

export interface RefsActions {
  toast(t: string, k?: 'info' | 'ok' | 'err'): void
  preview(path: string): void
  /** Puts the reference on the canvas (Image or Video node near the middle). */
  use(it: RefItem): void
}

export function refsPanel(floor: ProjectFloor, w: Widget, actions: RefsActions): { refresh(): void } {
  let items: RefItem[] = []
  let tag: string | null = null
  let capturing = false

  const target = h('input', { class: 'input st-input', placeholder: '@perfil, link da Biblioteca ou ID', 'aria-label': 'Página ou anúncio da Biblioteca de Anúncios', spellcheck: 'false' })
  const max = h('input', { class: 'input st-input st-ref-max', type: 'number', min: 1, max: 30, value: 10, title: 'Quantos anúncios no máximo (os mais vistos primeiro)', 'aria-label': 'Máximo de anúncios' })
  const go = h('button', { class: 'btn btn-small btn-primary' }, icon('download', 13), 'Capturar')
  const stop = h('button', { class: 'btn btn-small', hidden: true }, 'Cancelar')
  const status = h('div', { class: 'st-ref-status', role: 'status' })
  const chips = h('div', { class: 'st-gal-chips' })
  const list = h('div', { class: 'st-ref-grid' })
  const add = h('button', { class: 'btn btn-small', title: 'Imagens ou vídeos desta máquina' }, icon('plus', 13), 'Arquivos')
  w.body.append(
    h('div', { class: 'st-ref-capture' }, h('div', { class: 'st-ref-row' }, target, max), h('div', { class: 'st-ref-row' }, go, stop, add)),
    status,
    chips,
    list,
  )

  const setStatus = (text: string, err = false) => {
    status.textContent = text
    status.classList.toggle('err', err)
  }

  const capture = async () => {
    const v = target.value.trim()
    if (!v || capturing) return
    capturing = true
    go.disabled = true
    stop.hidden = false
    setStatus('Abrindo a Biblioteca de Anúncios…')
    const off = onStudioProgress(`ads:${floor.id}`, (t) => setStatus(t))
    try {
      const r = await window.office.captureAds(floor.id, v, Number(max.value) || 10)
      items = r.refs
      if (r.notFound) setStatus(r.notFound, true)
      else {
        setStatus(`${r.added} novo(s) de ${r.anunciante || 'a página'}.`)
        target.value = ''
      }
      render()
    } catch (err) {
      setStatus(cleanError(err), true)
    } finally {
      off()
      capturing = false
      go.disabled = false
      stop.hidden = true
    }
  }
  go.addEventListener('click', () => void capture())
  target.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') void capture()
  })
  stop.addEventListener('click', () => void window.office.cancelCapture(floor.id))
  add.addEventListener('click', async () => {
    const paths = await window.office.pickMedia('media', true)
    if (!paths.length) return
    try {
      items = await window.office.addRefs(floor.id, paths)
      render()
    } catch (err) {
      actions.toast(cleanError(err), 'err')
    }
  })

  const saveTags = async (it: RefItem, tags: string[]) => {
    try {
      items = await window.office.setRefTags(floor.id, it.id, tags)
      render()
    } catch (err) {
      actions.toast(cleanError(err), 'err')
    }
  }

  const card = (it: RefItem): HTMLElement => {
    const media =
      it.kind === 'video'
        ? h('video', { src: mediaUrl(it.path), muted: true, preload: 'metadata', playsinline: true, loop: true })
        : h('img', { src: mediaUrl(it.path), alt: `Anúncio de ${it.anunciante}`, loading: 'lazy' })
    if (media instanceof HTMLVideoElement) {
      media.addEventListener('mouseenter', () => void media.play().catch(() => undefined))
      media.addEventListener('mouseleave', () => media.pause())
    }
    const thumb = h('button', { class: 'st-ref-thumb', title: it.kind === 'image' ? 'Ampliar' : 'Passe o mouse para ver; arraste para o canvas' }, media, it.kind === 'video' ? h('span', { class: 'st-ref-kind' }, icon('eye', 11), 'vídeo') : null)
    if (it.kind === 'image') thumb.addEventListener('click', () => actions.preview(it.path))
    const tagInput = h('input', { class: 'st-ref-tag-input', placeholder: '+ tag', maxlength: 24, 'aria-label': 'Nova tag' })
    tagInput.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key !== 'Enter') return
      const t = cleanTag(tagInput.value)
      if (!t) return void actions.toast('Tag com letras, números, espaço ou hífen (até 24).', 'err')
      if (it.tags.length >= MAX_TAGS) return void actions.toast(`No máximo ${MAX_TAGS} tags por referência.`, 'err')
      void saveTags(it, [...it.tags, t])
    })
    const el = h(
      'div',
      { class: 'st-ref', draggable: 'true', title: 'Arraste para o canvas' },
      thumb,
      h(
        'div',
        { class: 'st-ref-meta' },
        h('b', { title: it.anunciante }, it.anunciante || 'Anúncio'),
        it.dias !== undefined ? h('span', { class: `st-ref-days${it.dias >= 30 ? ' hot' : ''}`, title: it.inicio ? `Veiculação iniciada em ${it.inicio}` : '' }, `${it.dias} d no ar`) : null,
      ),
      h(
        'div',
        { class: 'st-ref-tags' },
        ...it.tags.map((t) =>
          h(
            'button',
            { class: 'st-ref-tag', title: 'Tirar a tag', 'aria-label': `Tirar a tag ${t}`, onclick: () => void saveTags(it, it.tags.filter((x) => x !== t)) },
            t,
            icon('x', 9),
          ),
        ),
        tagInput,
      ),
      h(
        'div',
        { class: 'st-gal-actions' },
        h('button', { class: 'btn btn-small', title: 'Coloca no fluxo como nó de entrada', onclick: () => actions.use(it) }, icon('plus', 12), 'Usar'),
        it.link ? h('button', { class: 'icon-btn', title: 'Abrir na Biblioteca de Anúncios', 'aria-label': 'Abrir na Biblioteca de Anúncios', onclick: () => void window.office.openExternal(it.link!) }, icon('external', 13)) : null,
        h('button', { class: 'icon-btn', title: 'Mostrar no Finder', 'aria-label': 'Mostrar no Finder', onclick: () => void window.office.revealPath(it.path) }, icon('folder', 13)),
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'Tirar das referências (o arquivo vai para referencias/.lixeira)',
            'aria-label': 'Tirar das referências',
            onclick: async () => {
              try {
                items = await window.office.removeRef(floor.id, it.id)
                render()
              } catch (err) {
                actions.toast(cleanError(err), 'err')
              }
            },
          },
          icon('trash', 13),
        ),
      ),
    )
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(REF_DRAG, JSON.stringify({ path: it.path, kind: it.kind }))
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
    })
    return el
  }

  const render = () => {
    const tags = [...new Set(items.flatMap((i) => i.tags))].sort()
    if (tag && !tags.includes(tag)) tag = null
    chips.replaceChildren(
      ...(tags.length
        ? [null, ...tags].map((t) =>
            h(
              'button',
              { class: `st-gal-chip${tag === t ? ' on' : ''}`, 'aria-pressed': String(tag === t), onclick: () => ((tag = t), render()) },
              t ?? 'Todas',
              h('b', {}, String(t ? items.filter((i) => i.tags.includes(t)).length : items.length)),
            ),
          )
        : []),
    )
    const shown = items.filter((i) => !tag || i.tags.includes(tag))
    list.replaceChildren(...(shown.length ? shown.map(card) : [h('div', { class: 'st-note' }, 'Nenhuma referência ainda. Capture os anúncios de uma página (os mais vistos vêm primeiro) ou adicione arquivos.')]))
    w.setSummary(items.length ? `${items.length}` : '')
  }

  const refresh = () =>
    void window.office
      .listRefs(floor.id)
      .then((v) => {
        items = v
        render()
      })
      .catch((err) => setStatus(cleanError(err), true))
  refresh()
  return { refresh }
}
