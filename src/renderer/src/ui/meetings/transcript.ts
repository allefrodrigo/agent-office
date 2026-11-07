import { clockTime, delayLabel, mergeSegments, shortDuration, trackLabel } from '@shared/meeting-room'
import type { Meeting, Segment } from '@shared/types/meetings'
import { h } from '../dom'

// A transcrição da aba "Transcrição": linhas "Você", "Outros" e "Sala" com a hora, em ordem de
// início, chegando ao vivo. Destaca os trechos que a ata ou a conversa citam.

/** Quanto tempo o destaque de um trecho citado fica aceso. */
const HIGHLIGHT_MS = 4000
/** Perto do fim (px): a lista acompanha as falas novas; mais acima, ela fica parada para ler. */
const STICK_PX = 48

export interface TranscriptView {
  el: HTMLElement
  /** Troca a reunião inteira (ao abrir). */
  set(meeting: Meeting, segments: Segment[]): void
  /** Uma fala nova (meeting:segment). */
  add(segment: Segment): void
  /** Atraso da fila do whisper; abaixo do limite o aviso some. */
  setDelay(delayMs: number): void
  /** Rola até o primeiro e acende todos por alguns segundos. Devolve quantos achou. */
  highlight(ids: number[]): number
}

export function transcriptView(): TranscriptView {
  const delay = h('div', { class: 'mr-delay', role: 'status', hidden: true })
  const list = h('div', { class: 'mr-lines', role: 'log', 'aria-label': 'Transcrição', 'aria-live': 'off', tabindex: 0 })
  const empty = h('p', { class: 'mr-empty' }, 'As falas aparecem aqui enquanto a reunião grava.')
  const el = h('div', { class: 'mr-transcript' }, delay, list)
  let meeting: Meeting | null = null
  let segments: Segment[] = []
  let timer = 0

  const line = (s: Segment) =>
    h(
      'div',
      { class: `mr-line t-${s.track}`, 'data-seg': s.id },
      h(
        'div',
        { class: 'mr-line-head' },
        h('time', {}, meeting ? clockTime(meeting.startedAt + s.start) : ''),
        h('b', {}, trackLabel(s.track)),
      ),
      h('p', {}, s.text),
    )

  /** A marca de cada pausa, no ponto da reunião em que ela começou. */
  const pauseMark = (p: Meeting['pauses'][number]) => h('div', { class: 'mr-pause-mark' }, `Pausa de ${shortDuration(p.ms)}`)

  const render = () => {
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_PX
    if (!segments.length) {
      list.replaceChildren(empty)
      return
    }
    const pauses = [...(meeting?.pauses ?? [])].sort((a, b) => a.at - b.at)
    const out: HTMLElement[] = []
    let pi = 0
    for (const s of segments) {
      while (pi < pauses.length && pauses[pi].at <= s.start) out.push(pauseMark(pauses[pi++]))
      out.push(line(s))
    }
    list.replaceChildren(...out)
    if (stick) list.scrollTop = list.scrollHeight
  }

  return {
    el,
    set(m, segs) {
      meeting = m
      segments = mergeSegments([], segs)
      render()
      list.scrollTop = list.scrollHeight
    },
    add(s) {
      const last = segments[segments.length - 1]
      segments = mergeSegments(segments, [s])
      // O caso comum (a fala nova é a mais recente) não redesenha a lista inteira.
      if (last && s.start >= last.start && list.querySelector('.mr-line')) {
        const stick = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_PX
        list.append(line(s))
        if (stick) list.scrollTop = list.scrollHeight
      } else render()
    },
    setDelay(ms) {
      const text = delayLabel(ms)
      delay.hidden = !text
      delay.textContent = text ? `Transcrição ${text}. As falas chegam assim que o whisper alcançar.` : ''
    },
    highlight(ids) {
      window.clearTimeout(timer)
      for (const old of list.querySelectorAll('.mr-line.hl')) old.classList.remove('hl')
      const found = ids.map((id) => list.querySelector<HTMLElement>(`.mr-line[data-seg="${id}"]`)).filter((x): x is HTMLElement => !!x)
      for (const f of found) f.classList.add('hl')
      found[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      timer = window.setTimeout(() => found.forEach((f) => f.classList.remove('hl')), HIGHLIGHT_MS)
      return found.length
    },
  }
}
