import { citationLabel } from '@shared/meetings-search'
import { findMeetingRefs } from '@shared/meetings-view'
import type { Meeting, Segment } from '@shared/types'
import { openMeetingRoom } from '../../meetings/open'
import { h, icon } from '../dom'

// RN-18: no detalhe do ticket, a referência `reuniao:<id>#s<n>` vira o link "Kickoff do checkout,
// 14:52" que abre a sala no trecho. Link interno: um botão que dispara o evento da sala.

type Known = { meeting: Meeting; segments: Pick<Segment, 'id' | 'start'>[] } | null
const cache = new Map<string, Promise<Known>>()

function load(meetingId: string): Promise<Known> {
  let p = cache.get(meetingId)
  if (!p) {
    p = window.office
      .meeting(meetingId)
      .then((d) => ({ meeting: d.meeting, segments: d.segments.map((s) => ({ id: s.id, start: s.start })) }))
      .catch(() => null)
    cache.set(meetingId, p)
    // a meeting deleted (or created) later must not stay stuck in the cache
    void p.then((k) => !k && setTimeout(() => cache.delete(meetingId), 30_000))
  }
  return p
}

/**
 * Troca, no Markdown já renderizado (e sanitizado), cada `reuniao:<id>` por um botão. O rótulo
 * chega quando a reunião carrega; reunião apagada vira texto riscado. `before` roda antes de
 * abrir a sala (o quadro se fecha).
 */
export function linkMeetingRefs(root: HTMLElement, before: () => void = () => undefined): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.parentElement?.closest('pre, button') ?? null) !== null) continue
    if ((n.nodeValue ?? '').includes('reuniao:')) nodes.push(n as Text)
  }
  for (const node of nodes) {
    const value = node.nodeValue ?? ''
    const refs = findMeetingRefs(value)
    if (!refs.length) continue
    const frag = document.createDocumentFragment()
    let last = 0
    for (const ref of refs) {
      if (ref.index > last) frag.append(value.slice(last, ref.index))
      frag.append(meetingLink(ref.meetingId, ref.segment, before))
      last = ref.index + ref.length
    }
    if (last < value.length) frag.append(value.slice(last))
    node.replaceWith(frag)
  }
}

function meetingLink(meetingId: string, segment: number | undefined, before: () => void): HTMLElement {
  const label = h('span', {}, 'Abrir a reunião')
  const btn = h('button', { class: 'tmeeting-link', type: 'button', title: 'Abrir a sala de reunião neste trecho' }, icon('mic', 12), label)
  const known = load(meetingId)
  void known.then((k) => {
    if (!k) {
      label.textContent = 'Reunião apagada'
      btn.setAttribute('disabled', '')
      btn.title = 'Essa reunião foi apagada.'
      return
    }
    label.textContent = citationLabel(k.meeting, segment === undefined ? undefined : k.segments.find((s) => s.id === segment))
  })
  btn.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const k = await known
    if (!k) return
    before()
    openMeetingRoom(k.meeting.floor, { meetingId, ...(segment !== undefined ? { segment } : {}) })
  })
  return btn
}
