// Fixed zone (no daylight saving since 2019), so local times read the same on every machine.
process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import { countdown, describeSchedule, formatWhen, isPast, nextRun, nextRuns, runsBetween, scheduleError, scheduleSentence, weekdaysText } from '../src/shared/schedule'
import type { Schedule } from '@shared/types'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const show = (t: number | null) => (t === null ? null : new Date(t).toString().slice(0, 21))
const cron = (expr: string): Schedule => ({ kind: 'cron', expr })

describe('presets', () => {
  it('todo dia: later today, or tomorrow once the time passed', () => {
    const s: Schedule = { kind: 'daily', time: '09:00' }
    expect(nextRun(s, at(2026, 10, 13, 8, 0))).toBe(at(2026, 10, 13, 9, 0))
    expect(nextRun(s, at(2026, 10, 13, 9, 0))).toBe(at(2026, 10, 14, 9, 0))
    expect(nextRun(s, at(2026, 10, 13, 9, 30))).toBe(at(2026, 10, 14, 9, 0))
  })

  it('turns the month and the year', () => {
    const s: Schedule = { kind: 'daily', time: '23:30' }
    expect(nextRun(s, at(2026, 1, 31, 23, 45))).toBe(at(2026, 2, 1, 23, 30))
    expect(nextRun(s, at(2026, 12, 31, 23, 45))).toBe(at(2027, 1, 1, 23, 30))
  })

  it('dias da semana: skips to the next chosen day', () => {
    const weekdays: Schedule = { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' }
    // 2026-10-16 is a Friday
    expect(new Date(at(2026, 10, 16)).getDay()).toBe(5)
    expect(nextRun(weekdays, at(2026, 10, 16, 10, 0))).toBe(at(2026, 10, 19, 9, 0))
    const sunday: Schedule = { kind: 'weekly', days: [0], time: '18:00' }
    expect(nextRun(sunday, at(2026, 10, 13, 12, 0))).toBe(at(2026, 10, 18, 18, 0))
    // across the year
    expect(nextRun({ kind: 'weekly', days: [1], time: '10:00' }, at(2026, 12, 29, 0, 0))).toBe(at(2027, 1, 4, 10, 0))
  })

  it('uma vez: only before its time', () => {
    const s: Schedule = { kind: 'once', at: '2026-10-20T14:30' }
    expect(nextRun(s, at(2026, 10, 13))).toBe(at(2026, 10, 20, 14, 30))
    expect(nextRun(s, at(2026, 10, 20, 14, 30))).toBeNull()
    expect(isPast(s, at(2026, 10, 21))).toBe(true)
    expect(isPast(s, at(2026, 10, 13))).toBe(false)
  })

  it('a cada N: counted from the anchor, never in the past', () => {
    const anchor = at(2026, 10, 13, 10, 0)
    const s: Schedule = { kind: 'interval', every: 2, unit: 'hours', anchor }
    expect(nextRun(s, anchor)).toBe(at(2026, 10, 13, 12, 0))
    expect(nextRun(s, at(2026, 10, 13, 13, 0))).toBe(at(2026, 10, 13, 14, 0))
    expect(nextRun(s, anchor - 3_600_000)).toBe(at(2026, 10, 13, 12, 0))
    expect(nextRuns({ kind: 'interval', every: 15, unit: 'minutes', anchor }, anchor, 3)).toEqual([anchor + 15 * 60_000, anchor + 30 * 60_000, anchor + 45 * 60_000])
    // overnight, into the next month
    expect(nextRun({ kind: 'interval', every: 5, unit: 'hours', anchor: at(2026, 10, 31, 22, 0) }, at(2026, 10, 31, 23, 0))).toBe(at(2026, 11, 1, 3, 0))
  })
})

describe('cron', () => {
  it('weekdays at 9', () => {
    expect(nextRuns(cron('0 9 * * 1-5'), at(2026, 10, 16, 10), 3).map(show)).toEqual(
      [at(2026, 10, 19, 9), at(2026, 10, 20, 9), at(2026, 10, 21, 9)].map(show),
    )
  })

  it('steps, lists and names', () => {
    expect(nextRuns(cron('*/20 8-9 * * *'), at(2026, 10, 13, 8, 5), 4)).toEqual([at(2026, 10, 13, 8, 20), at(2026, 10, 13, 8, 40), at(2026, 10, 13, 9, 0), at(2026, 10, 13, 9, 20)])
    expect(nextRun(cron('30 7 * * mon,wed,fri'), at(2026, 10, 13, 12))).toBe(at(2026, 10, 14, 7, 30))
    expect(nextRun(cron('30 7 * * seg,qua'), at(2026, 10, 13, 12))).toBe(at(2026, 10, 14, 7, 30))
    expect(nextRun(cron('0 12 1 jan *'), at(2026, 10, 13))).toBe(at(2027, 1, 1, 12, 0))
    // 7 is Sunday too
    expect(nextRun(cron('0 8 * * 7'), at(2026, 10, 13))).toBe(at(2026, 10, 18, 8, 0))
  })

  it('end of the month and the year', () => {
    expect(nextRun(cron('0 0 1 * *'), at(2026, 12, 15))).toBe(at(2027, 1, 1, 0, 0))
    // only months with a 31st
    expect(nextRun(cron('0 6 31 * *'), at(2026, 10, 31, 7))).toBe(at(2026, 12, 31, 6, 0))
    // 29 de fevereiro: the next leap year
    expect(nextRun(cron('0 0 29 2 *'), at(2026, 10, 13))).toBe(at(2028, 2, 29, 0, 0))
  })

  it('day of month and weekday both set: either one runs (as in cron)', () => {
    // the 15th, or any Monday
    const s = cron('0 9 15 * 1')
    expect(nextRun(s, at(2026, 10, 13, 10))).toBe(at(2026, 10, 15, 9, 0))
    expect(nextRun(s, at(2026, 10, 15, 10))).toBe(at(2026, 10, 19, 9, 0))
  })

  it('says what to fix', () => {
    expect(scheduleError(cron('0 9 * *'))).toMatch(/5 campos.*essa tem 4/)
    expect(scheduleError(cron('0 25 * * *'))).toMatch(/Campo hora: 25 está fora do intervalo 0–23/)
    expect(scheduleError(cron('0 9 * * 1-x'))).toMatch(/Campo dia da semana: "x" não é um número nem um nome válido/)
    expect(scheduleError(cron('0 9 * * 5-1'))).toMatch(/invertido/)
    expect(scheduleError(cron('*/0 9 * * *'))).toMatch(/passo/)
    expect(scheduleError(cron('0,,5 9 * * *'))).toMatch(/vírgula/)
    expect(scheduleError(cron('* 9 * * *'))).toMatch(/a cada 1 min.*mínimo.*15 minutos/)
    expect(scheduleError(cron('0 9 31 2 *'))).toMatch(/nunca roda/)
    expect(scheduleError(cron('*/15 * * * *'))).toBeNull()
    expect(scheduleError(cron('0 9 * * 1-5'))).toBeNull()
  })

  it('an invalid one never runs', () => {
    expect(nextRun(cron('nada'), at(2026, 10, 13))).toBeNull()
  })
})

describe('checks of the presets', () => {
  it('refuses intervals under 15 minutes and over a week', () => {
    expect(scheduleError({ kind: 'interval', every: 10, unit: 'minutes' })).toMatch(/mínimo é a cada 15 minutos/)
    expect(scheduleError({ kind: 'interval', every: 15, unit: 'minutes' })).toBeNull()
    expect(scheduleError({ kind: 'interval', every: 169, unit: 'hours' })).toMatch(/máximo/)
    expect(nextRun({ kind: 'interval', every: 5, unit: 'minutes', anchor: 0 }, 0)).toBeNull()
  })

  it('weekly needs a day; once needs a real date', () => {
    expect(scheduleError({ kind: 'weekly', days: [], time: '09:00' })).toMatch(/pelo menos um dia/)
    expect(scheduleError({ kind: 'once', at: '2026-02-31T10:00' })).toMatch(/data/)
    expect(scheduleError({ kind: 'daily', time: '24:00' })).toMatch(/horário/)
  })
})

describe('sentences', () => {
  it('reads the week the way people say it', () => {
    expect(weekdaysText([1, 2, 3, 4, 5])).toBe('de segunda a sexta')
    expect(weekdaysText([0, 6])).toBe('aos sábados e domingos')
    expect(weekdaysText([2])).toBe('toda terça')
    expect(weekdaysText([6])).toBe('todo sábado')
    expect(weekdaysText([1, 3, 5])).toBe('toda segunda, quarta e sexta')
    expect(weekdaysText([5, 6, 0])).toBe('de sexta a domingo')
    expect(weekdaysText([0, 1, 2, 3, 4, 5, 6])).toBe('todo dia')
  })

  it('describes every kind', () => {
    expect(describeSchedule({ kind: 'daily', time: '09:00' })).toBe('Roda todo dia às 09:00.')
    expect(describeSchedule({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' })).toBe('Roda de segunda a sexta às 09:00.')
    expect(describeSchedule({ kind: 'interval', every: 2, unit: 'hours' })).toBe('Roda a cada 2 horas.')
    expect(describeSchedule({ kind: 'interval', every: 1, unit: 'hours' })).toBe('Roda a cada hora.')
    expect(describeSchedule({ kind: 'once', at: '2026-10-20T14:30' })).toBe('Roda uma vez, em 20/10/2026 às 14:30.')
    expect(describeSchedule(cron('0 9 * * 1-5'))).toBe('Roda de segunda a sexta às 09:00.')
    expect(describeSchedule(cron('*/30 * * * *'))).toBe('Roda a cada 30 minutos.')
    expect(describeSchedule(cron('0 * * * *'))).toBe('Roda toda hora cheia.')
    expect(describeSchedule(cron('0 8 1 * *'))).toBe('Roda todo dia 1 do mês às 08:00.')
    expect(describeSchedule(cron('15 8-18/2 * 3 *'))).toBe('Roda conforme o cron "15 8-18/2 * 3 *".')
  })

  it('the sentence of the form, with the next run', () => {
    const now = at(2026, 10, 13, 15, 0)
    const s: Schedule = { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '09:00' }
    expect(scheduleSentence(s, nextRun(s, now), now)).toBe('Roda de segunda a sexta às 09:00. Próxima: amanhã, 09:00')
    expect(scheduleSentence({ kind: 'once', at: '2026-10-01T09:00' }, null, now)).toBe('Roda uma vez, em 01/10/2026 às 09:00. Sem próxima execução.')
  })

  it('dates near and far', () => {
    const now = at(2026, 10, 13, 15, 0)
    expect(formatWhen(at(2026, 10, 13, 18, 5), now)).toBe('hoje, 18:05')
    expect(formatWhen(at(2026, 10, 14, 9, 0), now)).toBe('amanhã, 09:00')
    expect(formatWhen(at(2026, 10, 12, 9, 0), now)).toBe('ontem, 09:00')
    expect(formatWhen(at(2026, 10, 16, 9, 0), now)).toBe('sex, 16/10, 09:00')
    expect(formatWhen(at(2026, 12, 1, 9, 0), now)).toBe('01/12, 09:00')
    expect(formatWhen(at(2027, 1, 4, 10, 0), now)).toBe('04/01/2027, 10:00')
  })

  it('countdowns', () => {
    const now = at(2026, 10, 13, 12, 0)
    expect(countdown(now + 2 * 3_600_000 + 14 * 60_000 + 30_000, now)).toBe('em 2h14')
    expect(countdown(now + 14 * 60_000, now)).toBe('em 14 min')
    expect(countdown(now + 40_000, now)).toBe('em 40 s')
    expect(countdown(now + 3 * 86_400_000 + 4 * 3_600_000, now)).toBe('em 3d 4h')
    expect(countdown(now + 86_400_000, now)).toBe('em 1 dia')
    expect(countdown(now - 5, now)).toBe('agora')
  })
})

describe('runsBetween (missed while closed)', () => {
  it('counts the slots and keeps the first and the last', () => {
    const s: Schedule = { kind: 'interval', every: 1, unit: 'hours', anchor: at(2026, 10, 13, 0, 0) }
    const r = runsBetween(s, at(2026, 10, 13, 9, 0), at(2026, 10, 13, 13, 30))
    expect(r).toEqual({ count: 5, first: at(2026, 10, 13, 9, 0), last: at(2026, 10, 13, 13, 0) })
    expect(runsBetween({ kind: 'daily', time: '09:00' }, at(2026, 10, 13, 9, 0), at(2026, 10, 13, 9, 1)).count).toBe(1)
  })
})
