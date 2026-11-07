import type { MeetingDoctorInfo } from '@shared/types/meetings'
import { h, icon } from '../dom'

// "O que falta instalar": o que o meetingDoctor achou faltando para gravar e transcrever.

/** O doctor lido uma vez por abertura da sala (o botão "Verificar de novo" relê). */
let cached: Promise<MeetingDoctorInfo> | null = null

export function readDoctor(fresh = false): Promise<MeetingDoctorInfo> {
  if (fresh || !cached)
    cached = window.office.meetingDoctor().catch((err) => {
      cached = null
      throw err
    })
  return cached
}

/** O caminho nos Ajustes do Sistema para liberar o áudio do computador, se o doctor o deu. */
export function systemAudioHint(d: MeetingDoctorInfo | null): string | null {
  return d?.permissionHints.find((p) => p.startsWith('Áudio do computador')) ?? null
}

/** Falta algo que impede gravar (whisper ou modelo), ou o microfone está bloqueado. */
export function blocksRecording(d: MeetingDoctorInfo): boolean {
  return !d.canTranscribe || d.microphone.status === 'denied' || d.microphone.status === 'restricted'
}

/**
 * A caixa do que falta, ou null quando está tudo pronto. Os avisos que não impedem gravar
 * (áudio do computador, ffmpeg) aparecem também, mais discretos.
 */
export function doctorBox(d: MeetingDoctorInfo, onRetry: () => void): HTMLElement | null {
  const blocking = [...d.problems]
  if (d.microphone.message && (d.microphone.status === 'denied' || d.microphone.status === 'restricted'))
    blocking.push(d.microphone.message)
  const notes: string[] = []
  if (!d.systemAudio.supported && d.systemAudio.message) notes.push(d.systemAudio.message)
  if (!blocking.length && !notes.length) return null
  const hard = blocksRecording(d)
  return h(
    'section',
    { class: `mr-doctor${hard ? ' hard' : ''}`, 'aria-label': 'O que falta instalar' },
    h('div', { class: 'mr-doctor-head' }, icon('alert', 16), h('strong', {}, hard ? 'O que falta instalar' : 'Antes de gravar')),
    blocking.length
      ? h(
          'ul',
          {},
          blocking.map((p) => h('li', {}, p)),
        )
      : null,
    notes.length
      ? h(
          'ul',
          { class: 'mr-doctor-notes' },
          notes.map((p) => h('li', {}, p)),
        )
      : null,
    h('button', { class: 'btn btn-small', type: 'button', onclick: onRetry }, 'Verificar de novo'),
  )
}
