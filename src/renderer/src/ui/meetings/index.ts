import './meetings.css'
import { GROUND_FLOOR_ID } from '@shared/meeting-map'
import { clockTime, finishingLabel, delayLabel, isLive, showsAta, statusLabel } from '@shared/meeting-room'
import type {
  Meeting,
  MeetingCreateInput,
  MeetingDetail,
  MeetingDoctorInfo,
  MeetingProgress,
  MeetingTemplate,
  MeetingWarning,
  Segment,
} from '@shared/types/meetings'
import type { State } from '../../state'
import { OPEN_MEETING_EVENT, type OpenMeetingDetail } from '../../meetings/open'
import { OPEN_AGENT_EVENT } from './office'
import { modalA11y } from '../a11y'
import { h, icon } from '../dom'
import { cleanError, confirmDialog } from '../modals'
import { mountAta } from './ata'
import { mountChat } from './chat'
import type { MeetingPart, MeetingViewCtx } from './ctx'
import { readDoctor, systemAudioHint } from './doctor'
import { meetingList } from './list'
import { newMeetingForm } from './new'
import { notesEditor, type NotesEditor } from './notes'
import { liveRecording, recordingStrip } from './recording'
import { transcriptView } from './transcript'

// Sala de reunião (RN-07): tela cheia no molde do estúdio criativo. Esquerda, as reuniões do
// andar; centro, as notas (durante) ou a ata (depois); direita, recolhível, a transcrição e a
// conversa. Esc fecha e salva as notas; a gravação continua com a sala fechada.
// Docs: docs/prd/sala-de-reuniao.md ("Experiência").

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

/** O centro da tela, pelo estado da reunião aberta. */
type Layout = 'new' | 'live' | 'orphan' | 'finishing' | 'interrupted' | 'error' | 'ata'

interface Room {
  floor: string
  upsert(m: Meeting): void
  segment(meetingId: string, s: Segment): void
  progress(p: MeetingProgress): void
  warning(w: MeetingWarning): void
  removed(id: string): void
  select(id: string, segment?: number): Promise<void>
  close(): void
}

let room: Room | null = null

/** A sala está aberta (para quem decide se uma tecla é dela). */
export function meetingRoomOpen(): boolean {
  return room !== null
}

/** Avisos que valem um toast quando a sala está fechada e a reunião segue gravando. */
const TOAST_WHEN_CLOSED = new Set<MeetingWarning['kind']>([
  'idle',
  'autostop',
  'system-audio-failed',
  'system-audio-lost',
  'system-audio-silent',
])

/**
 * Liga a sala ao app, uma vez no boot: abre pelo evento do mapa, da tecla M e do HUD
 * (OPEN_MEETING_EVENT) e acompanha a gravação em office:event, com a sala aberta ou não.
 */
export function mountMeetingRoom(root: HTMLElement, state: State, opts: { toast: Toast }): void {
  window.addEventListener(OPEN_MEETING_EVENT, (e) => {
    const { floor, meetingId, segment } = (e as CustomEvent<OpenMeetingDetail>).detail ?? {}
    const at = typeof meetingId === 'string' && meetingId ? { meetingId, segment } : undefined
    if (typeof floor === 'string' && floor) void openMeetingRoomScreen(root, state, floor, opts, at)
  })
  // The agent panel opens under the room: close the room (recording goes on) so the panel shows.
  window.addEventListener(OPEN_AGENT_EVENT, () => room?.close())
  window.office.onEvent((e) => {
    switch (e.type) {
      case 'meeting:upsert':
        liveRecording.apply(e.meeting)
        room?.upsert(e.meeting)
        break
      case 'meeting:segment':
        liveRecording.segment(e.meetingId, e.segment)
        room?.segment(e.meetingId, e.segment)
        break
      case 'meeting:progress':
        room?.progress(e)
        break
      case 'meeting:warning':
        liveRecording.warning(e)
        if (room) room.warning(e)
        else if (e.meetingId === liveRecording.id && TOAST_WHEN_CLOSED.has(e.kind)) opts.toast(e.message, 'info')
        break
      case 'meeting:removed':
        room?.removed(e.meetingId)
        break
    }
  })
}

function floorName(state: State, floor: string): string {
  if (floor === GROUND_FLOOR_ID) return 'Térreo'
  return state.settings.projects.find((p) => p.id === floor)?.name ?? floor
}

/** O texto de cada aviso do gravador na tela da sala. */
function warningText(w: MeetingWarning): string {
  if (w.kind === 'system-audio-waiting') return 'Aguardando a permissão do macOS… Aceite o pedido de gravar o áudio do computador.'
  return w.message
}

/** Abre a sala de um andar (tela cheia). Com a sala já aberta, troca de andar. */
export async function openMeetingRoomScreen(
  root: HTMLElement,
  state: State,
  floor: string,
  opts: { toast: Toast },
  at?: { meetingId: string; segment?: number },
): Promise<void> {
  if (room) {
    if (room.floor === floor) {
      if (at) await room.select(at.meetingId, at.segment)
      return
    }
    room.close()
  }
  const name = floorName(state, floor)
  const toast = (msg: string, kind: 'info' | 'ok' | 'err' = 'info') => opts.toast(msg, kind)

  let meetings: Meeting[] = []
  let templates: MeetingTemplate[] = []
  let doctor: MeetingDoctorInfo | null = null
  let selected: string | null = null
  let detail: MeetingDetail | null = null
  let layout: Layout | null = null
  let notes: NotesEditor | null = null
  let ata: MeetingPart | null = null
  let chat: MeetingPart | null = null
  let strip: { el: HTMLElement; destroy(): void } | null = null
  let progress: MeetingProgress | null = null
  const warnings = new Map<MeetingWarning['kind'], MeetingWarning>()
  let panelOpen = false
  let tab: 'transcript' | 'chat' = 'transcript'
  let closed = false

  // ---------- frame ----------
  const heading = h('h1', { class: 'mr-room-title' }, 'Sala de reunião', h('small', {}, name))
  const list = meetingList({ onSelect: (id) => void select(id), onNew: () => showNew() })
  const side = h(
    'aside',
    { class: 'mr-side', 'aria-label': 'Reuniões' },
    h('div', { class: 'mr-side-head' }, icon('mic', 16), heading),
    list.el,
  )

  const title = h('h2', { class: 'mr-title' })
  const meta = h('div', { class: 'mr-meta' })
  const panelBtn = h(
    'button',
    {
      class: 'btn btn-small mr-panel-btn',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'mr-panel',
      title: 'Mostrar a transcrição e a conversa',
    },
    icon('panel', 15),
    'Transcrição',
  )
  const delBtn = h(
    'button',
    { class: 'icon-btn', type: 'button', title: 'Apagar a reunião', 'aria-label': 'Apagar a reunião' },
    icon('trash', 16),
  )
  const closeBtn = h(
    'button',
    { class: 'icon-btn', type: 'button', title: 'Fechar (Esc)', 'aria-label': 'Fechar a sala de reunião' },
    icon('x', 17),
  )
  const head = h(
    'header',
    { class: 'mr-head' },
    h('div', { class: 'mr-head-text' }, title, meta),
    h('div', { class: 'mr-head-actions' }, panelBtn, delBtn, closeBtn),
  )
  const body = h('div', { class: 'mr-body' })
  const center = h('main', { class: 'mr-main' }, head, body)

  const tabT = h('button', { class: 'mr-tab', type: 'button', role: 'tab', id: 'mr-tab-t', 'aria-controls': 'mr-pane-t' }, 'Transcrição')
  const tabC = h('button', { class: 'mr-tab', type: 'button', role: 'tab', id: 'mr-tab-c', 'aria-controls': 'mr-pane-c' }, 'Conversa')
  const transcript = transcriptView()
  const paneT = h('div', { class: 'mr-pane', role: 'tabpanel', id: 'mr-pane-t', 'aria-labelledby': 'mr-tab-t' }, transcript.el)
  const paneC = h('div', { class: 'mr-pane', role: 'tabpanel', id: 'mr-pane-c', 'aria-labelledby': 'mr-tab-c' })
  const panel = h(
    'aside',
    { class: 'mr-panel', id: 'mr-panel', 'aria-label': 'Transcrição e conversa', hidden: true },
    h(
      'div',
      { class: 'mr-tabs', role: 'tablist', 'aria-label': 'Painel' },
      tabT,
      tabC,
      h(
        'button',
        {
          class: 'icon-btn mr-panel-close',
          type: 'button',
          title: 'Recolher o painel',
          'aria-label': 'Recolher o painel',
          onclick: () => setPanel(false),
        },
        icon('chevron', 16),
      ),
    ),
    paneT,
    paneC,
  )

  const box = h('div', { class: 'mr-box' }, side, center, panel)
  const el = h('div', { class: 'backdrop backdrop-meeting' }, box)
  modalA11y(el, box, heading)
  root.append(el)

  // ---------- panel ----------
  function setPanel(open: boolean, which: 'transcript' | 'chat' = tab): void {
    panelOpen = open
    tab = which
    panel.hidden = !open || layout === 'new'
    box.classList.toggle('with-panel', !panel.hidden)
    panelBtn.setAttribute('aria-expanded', String(open))
    panelBtn.classList.toggle('on', open)
    for (const [t, p, on] of [
      [tabT, paneT, which === 'transcript'],
      [tabC, paneC, which === 'chat'],
    ] as const) {
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
      p.hidden = !on
    }
  }
  panelBtn.addEventListener('click', () => setPanel(!panelOpen))
  tabT.addEventListener('click', () => setPanel(true, 'transcript'))
  tabC.addEventListener('click', () => setPanel(true, 'chat'))
  panel.querySelector('.mr-tabs')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key
    if (k !== 'ArrowLeft' && k !== 'ArrowRight') return
    e.preventDefault()
    const next = tab === 'transcript' ? 'chat' : 'transcript'
    setPanel(true, next)
    ;(next === 'chat' ? tabC : tabT).focus()
  })

  // ---------- context for the mounted parts ----------
  const ctxFor = (meetingId: string): MeetingViewCtx => ({
    floor,
    floorName: name,
    meetingId,
    refresh: () => reload(),
    highlightSegments: (ids) => {
      setPanel(true, 'transcript')
      requestAnimationFrame(() => {
        if (!transcript.highlight(ids) && ids.length) toast('Esse trecho não está mais na transcrição.')
      })
    },
    openMeetingAt: (id, segment) => void select(id, segment),
    toast: (msg) => toast(msg),
  })

  // ---------- data ----------
  async function loadList(): Promise<void> {
    meetings = await window.office.meetings(floor)
    list.render(meetings, selected)
  }

  /** Relê a reunião aberta e a lista. */
  async function reload(): Promise<void> {
    await loadList().catch(() => undefined)
    if (!selected) return
    try {
      const d = await window.office.meeting(selected)
      if (closed || d.meeting.id !== selected) return
      detail = d
      transcript.set(d.meeting, d.segments)
      header()
      render()
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  async function dropParts(): Promise<void> {
    const n = notes
    notes = null
    ata?.destroy()
    ata = null
    chat?.destroy()
    chat = null
    strip?.destroy()
    strip = null
    paneC.replaceChildren()
    if (n) await n.destroy()
  }

  async function select(id: string, segment?: number): Promise<void> {
    if (id !== selected || !detail) {
      await dropParts()
      let d: MeetingDetail
      try {
        d = await window.office.meeting(id)
      } catch (err) {
        return toast(cleanError(err), 'err')
      }
      if (closed) return
      selected = id
      detail = d
      layout = null
      warnings.clear()
      progress = null
      transcript.set(d.meeting, d.segments)
      transcript.setDelay(0)
      notes = notesEditor(id, d.notes, { onError: (m) => toast(m, 'err') })
      chat = mountChat(paneC, ctxFor(id))
      chat.update(d)
      list.render(meetings, selected)
      header()
      render()
      // Durante a gravação o painel fica fechado; depois, a transcrição aparece.
      setPanel(!isLive(d.meeting.status), tab)
    }
    if (segment !== undefined) ctxFor(id).highlightSegments([segment])
  }

  function showNew(): void {
    void dropParts().then(() => {
      if (closed) return
      selected = null
      detail = null
      layout = null
      list.render(meetings, null)
      header()
      render()
    })
  }

  // ---------- header ----------
  function header(): void {
    const m = detail?.meeting
    if (!m) {
      title.textContent = 'Nova reunião'
      meta.textContent = `Sala de reunião · ${name}`
      delBtn.hidden = true
      panelBtn.hidden = true
      return
    }
    title.textContent = m.title
    const tpl = templates.find((t) => t.id === m.template)?.name ?? m.template
    const date = new Date(m.startedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    const who = m.attendees.length ? ` · ${m.attendees.join(', ')}` : ''
    meta.textContent = `${date}, ${clockTime(m.startedAt)} · Modelo: ${tpl} · ${statusLabel(m.status)}${who}`
    delBtn.hidden = isLive(m.status) || m.status === 'finishing'
    panelBtn.hidden = false
  }

  // ---------- center ----------
  function layoutFor(): Layout {
    const m = detail?.meeting
    if (!m) return 'new'
    if (isLive(m.status)) return liveRecording.id === m.id ? 'live' : 'orphan'
    if (m.status === 'finishing') return 'finishing'
    if (m.status === 'interrupted') return 'interrupted'
    if (m.status === 'error') return 'error'
    return showsAta(m.status) ? 'ata' : 'error'
  }

  const warnBox = h('div', { class: 'mr-warnings', role: 'status', 'aria-live': 'polite' })
  const banner = h('div', { class: 'mr-banner', role: 'status' })

  function renderWarnings(): void {
    const items: HTMLElement[] = []
    const delay = progress?.stage === 'live' ? delayLabel(progress.delayMs) : null
    if (delay) items.push(h('div', { class: 'mr-warn' }, icon('history', 15), h('span', {}, `Transcrição ${delay}.`)))
    for (const w of warnings.values()) {
      // Sem botão que abra os Ajustes do Sistema (openExternal só abre links da web): o caminho vai escrito.
      const hint = w.kind === 'system-audio-silent' ? systemAudioHint(doctor) : null
      const dismiss = () => {
        warnings.delete(w.kind)
        renderWarnings()
      }
      items.push(
        h(
          'div',
          { class: `mr-warn k-${w.kind}` },
          icon('alert', 15),
          h('span', {}, warningText(w), hint ? h('small', {}, hint) : null),
          w.kind === 'idle'
            ? h(
                'button',
                { class: 'btn btn-small btn-danger-soft', type: 'button', onclick: () => void stopNow() },
                icon('stop', 13),
                'Encerrar',
              )
            : null,
          h(
            'button',
            { class: 'icon-btn', type: 'button', title: 'Dispensar', 'aria-label': 'Dispensar o aviso', onclick: dismiss },
            icon('x', 13),
          ),
        ),
      )
    }
    warnBox.replaceChildren(...items)
    warnBox.hidden = !items.length
  }

  async function stopNow(): Promise<void> {
    try {
      await liveRecording.stop()
    } catch (err) {
      toast(cleanError(err), 'err')
    }
  }

  function renderBanner(): void {
    const m = detail?.meeting
    if (!m) return
    if (layout === 'finishing') {
      banner.className = 'mr-banner busy'
      banner.replaceChildren(
        h('span', { class: 'mr-spin', 'aria-hidden': 'true' }),
        finishingLabel(progress?.delayMs ?? 0, progress?.label),
      )
    } else if (layout === 'interrupted') {
      const recover = h('button', { class: 'btn btn-primary btn-small', type: 'button' }, 'Transcrever o que ficou gravado')
      recover.addEventListener('click', () => {
        recover.disabled = true
        recover.textContent = 'Transcrevendo…'
        window.office.meetingRecover(m.id).then(
          () => void reload(),
          (err: unknown) => {
            recover.disabled = false
            recover.textContent = 'Transcrever o que ficou gravado'
            toast(cleanError(err), 'err')
          },
        )
      })
      const recovering = progress?.stage === 'recovering'
      banner.className = 'mr-banner warn'
      banner.replaceChildren(
        icon('alert', 16),
        h(
          'span',
          {},
          recovering
            ? finishingLabel(progress?.delayMs ?? 0, progress?.label)
            : 'A gravação parou no meio (o app fechou ou travou). O áudio que chegou ao disco ainda pode virar transcrição.',
        ),
        ...(recovering ? [] : [recover]),
      )
    } else if (layout === 'error') {
      banner.className = 'mr-banner warn'
      banner.replaceChildren(
        icon('alert', 16),
        h('span', {}, 'Esta reunião terminou com erro. As notas e o que foi transcrito ficaram salvos.'),
      )
    } else if (layout === 'orphan') {
      banner.className = 'mr-banner warn'
      banner.replaceChildren(
        icon('alert', 16),
        h('span', {}, 'Esta reunião está gravando, mas o microfone não está ligado nesta janela. Encerre pela barra de menus.'),
      )
    } else {
      // The ata steps and its failure live inside the ata part (ata.ts), not in this banner.
      banner.className = 'mr-banner'
      banner.replaceChildren()
    }
    banner.hidden = !banner.childNodes.length
  }

  function render(): void {
    const next = layoutFor()
    if (next === layout) {
      renderBanner()
      renderWarnings()
      if (detail) ata?.update(detail)
      return
    }
    layout = next
    strip?.destroy()
    strip = null
    if (layout !== 'ata') {
      ata?.destroy()
      ata = null
    }
    if (layout === 'new') {
      body.replaceChildren(h('div', { class: 'mr-loading' }, 'Carregando…'))
      void readDoctor()
        .catch(() => null)
        .then((d) => {
          doctor = d
          if (closed || layout !== 'new') return
          const form = newMeetingForm({
            floor,
            meetings,
            templates,
            defaultSources: state.settings.meetings?.defaultSources ?? 'mic+system',
            doctor,
            onStart: (input) => startMeeting(input),
            onRetryDoctor: () => {
              void readDoctor(true).then(() => {
                layout = null
                render()
              })
            },
            toast: (m) => toast(m),
          })
          body.replaceChildren(form.el)
          form.focus()
        })
      setPanel(panelOpen)
      return
    }
    const n = notes!
    if (layout === 'live') {
      strip = recordingStrip({ onError: (m) => toast(m, 'err'), onStop: () => void n.flush() })
      body.replaceChildren(strip.el, warnBox, n.el)
    } else if (layout === 'ata') {
      const ataEl = h('div', { class: 'mr-ata' })
      ata ??= mountAta(ataEl, ctxFor(selected!))
      ata.update(detail!)
      const notesBox = h('details', { class: 'mr-notes-after', open: !detail!.ata }, h('summary', {}, 'Suas notas'), n.el)
      body.replaceChildren(banner, warnBox, ataEl, notesBox)
    } else {
      body.replaceChildren(banner, warnBox, n.el)
    }
    renderBanner()
    renderWarnings()
    setPanel(panelOpen)
  }

  async function startMeeting(input: MeetingCreateInput): Promise<void> {
    const onWarn = (message: string) => {
      warnings.set('transcription', { meetingId: liveRecording.id ?? '', kind: 'transcription', message })
      renderWarnings()
    }
    const m = await liveRecording.begin(input, onWarn)
    if (closed) return
    await loadList().catch(() => undefined)
    await select(m.id)
    setPanel(false)
    notes?.textarea.focus()
  }

  // ---------- events ----------
  const self: Room = {
    floor,
    upsert(m) {
      if (m.floor !== floor) return
      const i = meetings.findIndex((x) => x.id === m.id)
      if (i >= 0) meetings[i] = m
      else meetings.unshift(m)
      list.render(meetings, selected)
      if (m.id !== selected || !detail) return
      const was = detail.meeting.status
      detail = { ...detail, meeting: m }
      header()
      // Encerrou e a ata chegou (ou vai chegar): relê notas, ata e transcrição.
      if (was !== m.status && (showsAta(m.status) || m.status === 'interrupted')) void reload()
      else render()
    },
    segment(meetingId, s) {
      if (meetingId !== selected || !detail) return
      detail = { ...detail, segments: [...detail.segments, s] }
      transcript.add(s)
    },
    progress(p) {
      if (p.meetingId !== selected) return
      progress = p
      transcript.setDelay(p.stage === 'live' ? p.delayMs : 0)
      renderBanner()
      renderWarnings()
    },
    warning(w) {
      if (w.meetingId !== selected) return
      if (w.kind === 'delay') return // vem também pelo meeting:progress, com o número atualizado
      if (w.kind === 'ata') return // a parte da ata mostra a falha com o botão Gerar ata
      // A permissão saiu: o aviso de espera some.
      if (w.kind !== 'system-audio-waiting') warnings.delete('system-audio-waiting')
      warnings.set(w.kind, w)
      renderWarnings()
      if (w.kind === 'autostop') toast(w.message)
    },
    removed(id) {
      meetings = meetings.filter((m) => m.id !== id)
      if (id === selected) showNew()
      else list.render(meetings, selected)
    },
    select: (id, segment) => select(id, segment),
    close,
  }
  room = self

  // ---------- delete ----------
  delBtn.addEventListener('click', () => {
    const m = detail?.meeting
    if (!m) return
    void confirmDialog(el, {
      title: 'Apagar a reunião?',
      text: `"${m.title}" sai da lista com as notas, a transcrição, a ata, a conversa e o áudio. Não dá para desfazer.`,
      confirm: 'Apagar',
      cancel: 'Cancelar',
      danger: true,
    }).then(async (ok) => {
      if (!ok) return
      try {
        await window.office.meetingDelete(m.id)
        toast('Reunião apagada.', 'ok')
        self.removed(m.id)
      } catch (err) {
        toast(cleanError(err), 'err')
      }
    })
  })

  // ---------- close ----------
  function close(): void {
    if (closed) return
    closed = true
    room = null
    void dropParts()
    el.remove()
    if (liveRecording.id) toast('A reunião continua gravando. M volta para a sala.')
  }
  closeBtn.addEventListener('click', () => close())
  el.addEventListener('keydown', (e) => {
    // Uma janela por cima (confirmar apagar) cuida das próprias teclas.
    if (e.key === 'Escape' && !el.querySelector('.backdrop')) {
      e.preventDefault()
      close()
    }
    e.stopPropagation()
  })

  // ---------- first paint ----------
  setPanel(false)
  try {
    const [list0, tpls] = await Promise.all([window.office.meetings(floor), window.office.meetingTemplates(floor)])
    meetings = list0
    templates = tpls.templates
  } catch (err) {
    toast(cleanError(err), 'err')
  }
  if (closed) return
  list.render(meetings, null)
  const liveHere = liveRecording.meeting?.floor === floor ? liveRecording.id : null
  const first = at?.meetingId ?? liveHere
  if (first) {
    await select(first, at?.segment)
    // select() muda layout e notes; o TypeScript não vê isso.
    if ((layout as Layout | null) === 'live') (notes as NotesEditor | null)?.textarea.focus()
  } else {
    header()
    render()
  }
}
