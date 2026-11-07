import { CONSENT_KEY, CONSENT_TEXT, consentDue, dayKey, defaultTitle, lastTemplate, parseAttendees } from '@shared/meeting-room'
import type { Meeting, MeetingCreateInput, MeetingDoctorInfo, MeetingSources, MeetingTemplate } from '@shared/types/meetings'
import { h, icon } from '../dom'
import { cleanError, field } from '../modals'
import { blocksRecording, doctorBox } from './doctor'

// "Nova reunião": só o necessário, com os padrões da spec. Título "Reunião 14:30", o modelo da
// última reunião do andar (ou Geral), participantes opcionais e as fontes das Configurações.
// Na primeira gravação, e depois uma vez por dia, o aviso de consentimento com "Copiar aviso".

export interface NewMeetingOpts {
  floor: string
  meetings: readonly Meeting[]
  templates: readonly MeetingTemplate[]
  defaultSources: MeetingSources
  doctor: MeetingDoctorInfo | null
  /** Grava: cria e começa. Erro com texto para a pessoa. */
  onStart(input: MeetingCreateInput): Promise<void>
  onRetryDoctor(): void
  toast(msg: string): void
}

export function newMeetingForm(o: NewMeetingOpts): { el: HTMLElement; focus(): void } {
  const title = h('input', { class: 'input', type: 'text', maxlength: 120, value: defaultTitle() })
  const tpl = h(
    'select',
    { class: 'input' },
    o.templates.map((t) => h('option', { value: t.id }, t.name)),
  )
  tpl.value = lastTemplate(
    o.meetings,
    o.templates.map((t) => t.id),
  )
  const attendees = h('input', { class: 'input', type: 'text', placeholder: 'Ana, Bruno, Carla', maxlength: 2000 })
  const radio = (value: MeetingSources, label: string, hint: string) =>
    h(
      'label',
      { class: 'mr-source' },
      h('input', { type: 'radio', name: 'mr-sources', value, checked: o.defaultSources === value }),
      h('span', {}, h('b', {}, label), h('small', {}, hint)),
    )
  const sources = h(
    'div',
    { class: 'mr-sources', role: 'radiogroup', 'aria-label': 'Fontes' },
    radio('mic+system', 'Microfone + áudio do computador', 'Chamada no Zoom, Meet ou Teams: você e os outros em faixas separadas.'),
    radio('mic', 'Só microfone (presencial)', 'Uma mesa, um notebook no meio.'),
  )

  // Aviso de consentimento: na primeira gravação e uma vez por dia.
  const showConsent = consentDue(localStorage.getItem(CONSENT_KEY))
  const consent = showConsent
    ? h(
        'div',
        { class: 'mr-consent', role: 'note' },
        icon('alert', 16),
        h(
          'div',
          {},
          h('b', {}, 'Avise quem está na chamada que você está transcrevendo.'),
          h('p', {}, 'O áudio fica nesta máquina; o whisper transcreve aqui mesmo.'),
        ),
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            onclick: () =>
              void window.office.copyText(CONSENT_TEXT).then(
                () => o.toast('Aviso copiado. Cole no chat da chamada.'),
                (err: unknown) => o.toast(cleanError(err)),
              ),
          },
          icon('copy', 14),
          'Copiar aviso',
        ),
      )
    : null

  const error = h('p', { class: 'mr-error', role: 'alert', hidden: true })
  const blocked = o.doctor ? blocksRecording(o.doctor) : false
  const start = h('button', { class: 'btn btn-primary mr-start', type: 'submit', disabled: blocked }, icon('record', 15), 'Gravar')
  const form = h(
    'form',
    { class: 'mr-new', 'aria-label': 'Nova reunião' },
    o.doctor ? doctorBox(o.doctor, o.onRetryDoctor) : null,
    consent,
    field('Título', title),
    h(
      'div',
      { class: 'field-row' },
      field('Modelo da ata', tpl),
      field('Participantes', attendees, 'Opcional. Ajuda o whisper com os nomes e a ata com os donos.'),
    ),
    h('fieldset', { class: 'mr-fieldset' }, h('legend', { class: 'field-label' }, 'Fontes'), sources),
    error,
    h('div', { class: 'mr-new-foot' }, start, blocked ? h('span', { class: 'mr-new-why' }, 'Instale o que falta para gravar.') : null),
  )

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (start.disabled) return
    const picked = form.querySelector<HTMLInputElement>('input[name="mr-sources"]:checked')?.value as MeetingSources | undefined
    const input: MeetingCreateInput = {
      floor: o.floor,
      title: title.value.trim() || defaultTitle(),
      template: tpl.value,
      attendees: parseAttendees(attendees.value),
      sources: { mic: true, system: (picked ?? o.defaultSources) === 'mic+system' },
    }
    start.disabled = true
    error.hidden = true
    start.replaceChildren(icon('record', 15), 'Começando…')
    void o.onStart(input).then(
      () => {
        if (showConsent) localStorage.setItem(CONSENT_KEY, dayKey())
      },
      (err: unknown) => {
        error.textContent = cleanError(err)
        error.hidden = false
        start.disabled = false
        start.replaceChildren(icon('record', 15), 'Gravar')
      },
    )
  })

  return {
    el: form,
    focus: () => {
      title.focus()
      title.select()
    },
  }
}
