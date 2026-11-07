import { describe, expect, it } from 'vitest'
import {
  clockTime,
  consentDue,
  dayKey,
  defaultTitle,
  delayLabel,
  finishingLabel,
  groupMeetings,
  isLive,
  lastTemplate,
  matchesSearch,
  meetingGroup,
  mergeSegments,
  parseAttendees,
  recordedMs,
  shortDuration,
  showsAta,
  statusLabel,
  trackLabel,
} from '@shared/meeting-room'
import type { Segment } from '@shared/types/meetings'

const at = (y: number, mo: number, d: number, hh = 0, mm = 0) => new Date(y, mo - 1, d, hh, mm).getTime()
const NOW = at(2026, 11, 7, 15, 0)

describe('meetingGroup', () => {
  it('separa hoje, os 6 dias antes e o resto', () => {
    expect(meetingGroup(at(2026, 11, 7, 0, 1), NOW)).toBe('Hoje')
    expect(meetingGroup(at(2026, 11, 6, 23, 0), NOW)).toBe('Semana')
    expect(meetingGroup(at(2026, 11, 1, 9, 0), NOW)).toBe('Semana')
    expect(meetingGroup(at(2026, 10, 31, 23, 59), NOW)).toBe('Antes')
  })
})

describe('matchesSearch e groupMeetings', () => {
  const list = [
    { title: 'Daily', attendees: [], startedAt: at(2026, 11, 7, 9) },
    { title: 'Kickoff do checkout', attendees: ['Ana'], startedAt: at(2026, 11, 7, 14) },
    { title: '1:1 João', attendees: [], startedAt: at(2026, 11, 4, 10) },
    { title: 'Retro', attendees: [], startedAt: at(2026, 9, 1, 10) },
  ]

  it('busca no título e nos participantes sem acento nem caixa', () => {
    expect(matchesSearch(list[2], 'joao')).toBe(true)
    expect(matchesSearch(list[1], 'ANA')).toBe(true)
    expect(matchesSearch(list[1], 'kick ana')).toBe(true)
    expect(matchesSearch(list[0], 'checkout')).toBe(false)
    expect(matchesSearch(list[0], '  ')).toBe(true)
  })

  it('agrupa em Hoje, Semana e Antes, a mais nova primeiro, sem grupo vazio', () => {
    const g = groupMeetings(list, '', NOW)
    expect(g.map((x) => x.group)).toEqual(['Hoje', 'Semana', 'Antes'])
    expect(g[0].items.map((m) => m.title)).toEqual(['Kickoff do checkout', 'Daily'])
    expect(groupMeetings(list, 'retro', NOW).map((x) => x.group)).toEqual(['Antes'])
    expect(groupMeetings(list, 'nada disso', NOW)).toEqual([])
  })
})

describe('padrões da reunião nova', () => {
  it('título com a hora', () => {
    expect(defaultTitle(at(2026, 11, 7, 14, 5))).toBe('Reunião 14:05')
    expect(clockTime(at(2026, 11, 7, 9, 30))).toBe('09:30')
  })

  it('modelo: o da última reunião do andar que ainda existe, ou o Geral', () => {
    const ms = [
      { template: 'daily', startedAt: 1 },
      { template: 'apagado', startedAt: 3 },
      { template: 'kickoff', startedAt: 2 },
    ]
    expect(lastTemplate(ms, ['geral', 'daily', 'kickoff'])).toBe('kickoff')
    expect(lastTemplate([], ['geral', 'daily'])).toBe('geral')
    expect(lastTemplate([], ['daily'])).toBe('daily')
  })

  it('participantes separados por vírgula, sem repetir', () => {
    expect(parseAttendees(' Ana ,  Bruno Lima; ana,,\nCarla ')).toEqual(['Ana', 'Bruno Lima', 'Carla'])
    expect(parseAttendees('')).toEqual([])
  })
})

describe('aviso de consentimento', () => {
  it('aparece na primeira vez e depois uma vez por dia', () => {
    expect(consentDue(null, NOW)).toBe(true)
    expect(consentDue(dayKey(NOW), NOW)).toBe(false)
    expect(consentDue(dayKey(at(2026, 11, 6, 22)), NOW)).toBe(true)
    expect(dayKey(at(2026, 1, 3))).toBe('2026-01-03')
  })
})

describe('recordedMs', () => {
  const m = { startedAt: 1_000, pauses: [{ at: 10_000, ms: 5_000 }] }
  it('desconta as pausas e a pausa em curso', () => {
    expect(recordedMs(m, 61_000)).toBe(55_000)
    expect(recordedMs(m, 61_000, 51_000)).toBe(45_000)
  })
  it('usa a duração gravada ao encerrar', () => {
    expect(recordedMs({ ...m, durationMs: 42_000 }, 999_999)).toBe(42_000)
    expect(recordedMs({ ...m, endedAt: 31_000 }, 999_999)).toBe(25_000)
  })
  it('nunca fica negativo', () => {
    expect(recordedMs({ startedAt: 10_000, pauses: [] }, 5_000)).toBe(0)
  })
})

describe('transcrição', () => {
  const seg = (id: number, start: number, track: Segment['track'] = 'eu'): Segment => ({
    id,
    track,
    start,
    end: start + 500,
    text: `s${id}`,
  })

  it('junta sem repetir e ordena pelo início', () => {
    const out = mergeSegments([seg(1, 3000), seg(2, 1000)], [seg(3, 2000, 'outros'), { ...seg(1, 3000), text: 'novo' }])
    expect(out.map((s) => s.id)).toEqual([2, 3, 1])
    expect(out[2].text).toBe('novo')
  })

  it('nomeia as faixas', () => {
    expect(trackLabel('eu')).toBe('Você')
    expect(trackLabel('outros')).toBe('Outros')
    expect(trackLabel('sala')).toBe('Sala')
  })

  it('avisa o atraso só acima do limite', () => {
    expect(delayLabel(5_000)).toBeNull()
    expect(delayLabel(Number.NaN)).toBeNull()
    expect(delayLabel(40_400)).toBe('atrasada 40 s')
  })

  it('mostra quanto falta ao terminar', () => {
    expect(finishingLabel(11_200)).toBe('Terminando a transcrição… 12 s')
    expect(finishingLabel(0)).toBe('Terminando a transcrição…')
  })
})

describe('estado e duração', () => {
  it('sabe quando grava e quando mostra a ata', () => {
    expect(isLive('recording')).toBe(true)
    expect(isLive('paused')).toBe(true)
    expect(isLive('finishing')).toBe(false)
    expect(showsAta('ready')).toBe(true)
    expect(showsAta('enhancing')).toBe(true)
    expect(showsAta('interrupted')).toBe(false)
  })

  it('escreve o estado e a duração em pt-BR', () => {
    expect(statusLabel('interrupted')).toBe('Interrompida')
    expect(statusLabel('recording')).toBe('Gravando')
    expect(shortDuration(40_000)).toBe('40 s')
    expect(shortDuration(45 * 60_000)).toBe('45 min')
    expect(shortDuration(65 * 60_000)).toBe('1 h 05')
  })
})
