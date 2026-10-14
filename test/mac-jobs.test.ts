import { describe, expect, it } from 'vitest'
import { calendarSchedules, describeMacJob, macJobFromPlist, macJobName, macJobState, parseLaunchctlList } from '@shared/mac-jobs'
import { totemView } from '@shared/routines'
import type { MacJob } from '@shared/types'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

const manha = {
  Label: 'com.mochilinho.agente.manha',
  StartCalendarInterval: { Hour: 10, Minute: 0 },
  ProgramArguments: ['/bin/bash', '/Users/me/mochilinho/scripts/agente/cron.sh', 'manha'],
  StandardOutPath: '/Users/me/mochilinho/logs/launchd-manha.log',
  RunAtLoad: false,
}

describe('launchctl list', () => {
  it('reads PID and last exit, "-" as none', () => {
    const map = parseLaunchctlList('PID\tStatus\tLabel\n-\t0\tcom.mochilinho.agente.manha\n812\t0\tcom.allef.kindle-dados\n-\t-9\tcom.balanca.copia-do-pi\n-\t-\tcom.nunca.rodou\n')
    expect(map.get('com.mochilinho.agente.manha')).toEqual({ pid: null, lastExit: 0 })
    expect(map.get('com.allef.kindle-dados')).toEqual({ pid: 812, lastExit: 0 })
    expect(map.get('com.balanca.copia-do-pi')).toEqual({ pid: null, lastExit: -9 })
    expect(map.get('com.nunca.rodou')).toEqual({ pid: null, lastExit: null })
  })
})

describe('plists', () => {
  it('turns calendar slots into cron, a missing key meaning every value', () => {
    expect(calendarSchedules({ Hour: 10, Minute: 0 })).toEqual([{ kind: 'cron', expr: '0 10 * * *' }])
    expect(calendarSchedules([{ Weekday: 1, Hour: 9, Minute: 30 }, { Day: 1, Hour: 0, Minute: 0 }])).toEqual([
      { kind: 'cron', expr: '30 9 * * 1' },
      { kind: 'cron', expr: '0 0 1 * *' },
    ])
    expect(calendarSchedules({ Minute: 15 })).toEqual([{ kind: 'cron', expr: '15 * * * *' }])
  })

  it('reads a daily job with its next run, command and log', () => {
    const job = macJobFromPlist(manha, { pid: null, lastExit: 0 }, at(2026, 10, 13, 10, 0), at(2026, 10, 14, 0, 40))!
    expect(job).toMatchObject({
      label: 'com.mochilinho.agente.manha',
      name: 'mochilinho · agente · manha',
      command: '/bin/bash /Users/me/mochilinho/scripts/agente/cron.sh manha',
      log: '/Users/me/mochilinho/logs/launchd-manha.log',
      loaded: true,
      running: false,
      lastExit: 0,
      nextAt: at(2026, 10, 14, 10, 0),
    })
    expect(describeMacJob(job)).toBe('Roda todo dia às 10:00.')
    expect(macJobState(job)).toBe('ok')
  })

  it('guesses the next interval run from the last log write', () => {
    const now = at(2026, 10, 14, 0, 40)
    const job = macJobFromPlist({ Label: 'com.allef.kindle-dados', StartInterval: 900 }, { pid: null, lastExit: 1 }, now - 5 * 60_000, now)!
    expect(job.everySec).toBe(900)
    expect(job.nextAt).toBe(now + 10 * 60_000)
    expect(describeMacJob(job)).toBe('Roda a cada 15 minutos.')
    expect(macJobState(job)).toBe('fail')
    expect(describeMacJob({ ...job, everySec: 3600 })).toBe('Roda a cada hora.')
  })

  it('skips vendor agents, unscheduled daemons and disabled jobs', () => {
    expect(macJobFromPlist({ Label: 'com.google.keystone.agent', StartInterval: 3600 }, undefined, undefined)).toBeNull()
    expect(macJobFromPlist({ Label: 'homebrew.mxcl.redis', KeepAlive: true, ProgramArguments: ['redis-server'] }, undefined, undefined)).toBeNull()
    expect(macJobFromPlist({ ...manha, Disabled: true }, undefined, undefined)).toBeNull()
    expect(macJobFromPlist({ StartInterval: 60 }, undefined, undefined)).toBeNull()
  })

  it('marks a plist launchd never loaded', () => {
    const job = macJobFromPlist(manha, undefined, undefined)!
    expect(job.loaded).toBe(false)
    expect(macJobState(job)).toBe('off')
  })

  it('names jobs from the label', () => {
    expect(macJobName('com.balanca.copia-do-pi')).toBe('balanca · copia-do-pi')
    expect(macJobName('backup')).toBe('backup')
  })
})

describe('totem with the Mac jobs', () => {
  const now = at(2026, 10, 14, 12, 0)
  const job = (over: Partial<MacJob>): MacJob => ({ ...macJobFromPlist(manha, { pid: null, lastExit: 0 }, undefined, now)!, ...over })

  it('counts down to the next Mac job when there is no routine', () => {
    const v = totemView([], now, [job({ name: 'mochilinho · agente · antecipa', nextAt: at(2026, 10, 14, 13, 0) })])
    expect(v).toMatchObject({ title: 'mochilinho · agente · antecipa', detail: 'em 1h00', led: 'ok', screen: { kind: 'count', text: '1H00' } })
  })

  it('shows a running job and turns red on a failed one', () => {
    expect(totemView([], now, [job({ running: true })]).screen).toEqual({ kind: 'run' })
    expect(totemView([], now, [job({ lastExit: 1 })]).led).toBe('fail')
  })

  it('stays as before without Mac jobs', () => {
    expect(totemView([], now)).toMatchObject({ title: 'Nenhuma rotina', led: 'none', screen: { kind: 'add' } })
  })
})
