import { describe, expect, it } from 'vitest'
import { dockBadge, formatElapsed, isMeetingLive, meetingElapsedMs, taskbarOverlay, trayTitle, trayTooltip } from '@shared/meeting-tray'
import { badgePixels, dotPixels } from '../src/main/badge'

describe('barra de menus da reunião (RN-08)', () => {
  it('só grava ou pausada mostra o ícone', () => {
    expect(isMeetingLive('recording')).toBe(true)
    expect(isMeetingLive('paused')).toBe(true)
    for (const s of ['finishing', 'enhancing', 'ready', 'interrupted', 'error'] as const) expect(isMeetingLive(s)).toBe(false)
  })

  it('formata o tempo em m:ss e h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(7_900)).toBe('0:07')
    expect(formatElapsed(724_000)).toBe('12:04')
    expect(formatElapsed(3_723_000)).toBe('1:02:03')
    expect(formatElapsed(-5)).toBe('0:00')
    expect(formatElapsed(NaN)).toBe('0:00')
  })

  it('desconta as pausas feitas e a pausa em curso', () => {
    const m = { startedAt: 1_000_000, pauses: [{ at: 60_000, ms: 30_000 }] }
    expect(meetingElapsedMs(m, 1_000_000 + 754_000)).toBe(724_000)
    // pausada há 10 s: o relógio para
    expect(meetingElapsedMs(m, 1_000_000 + 764_000, 1_000_000 + 754_000)).toBe(724_000)
    // relógio do sistema voltou: nunca negativo
    expect(meetingElapsedMs(m, 0)).toBe(0)
  })

  it('título: o tempo gravando, ⏸ pausada', () => {
    expect(trayTitle('recording', 724_000)).toBe('12:04')
    expect(trayTitle('paused', 724_000)).toBe('⏸ 12:04')
    expect(trayTooltip('Kickoff', 'paused', 724_000)).toBe('Kickoff · pausada · 12:04')
    expect(trayTooltip('Kickoff', 'recording', 7_000)).toBe('Kickoff · gravando · 0:07')
  })
})

describe('selo do Dock e overlay com a reunião (RN-08)', () => {
  it('compõe o ponto vermelho com o número de pendências', () => {
    expect(dockBadge(0, false)).toBe('')
    expect(dockBadge(3, false)).toBe('3')
    expect(dockBadge(0, true)).toBe('●')
    expect(dockBadge(3, true)).toBe('● 3')
    expect(dockBadge(12, true)).toBe('● 12')
    expect(dockBadge(NaN, true)).toBe('●')
    expect(dockBadge(-1, false)).toBe('')
  })

  it('overlay do Windows: número quando há pendências, ponto gravando sem elas', () => {
    expect(taskbarOverlay(0, false)).toBeNull()
    expect(taskbarOverlay(1, false)).toEqual({ label: '1', description: '1 pendência no Agent Office' })
    expect(taskbarOverlay(12, false)).toEqual({ label: '9+', description: '12 pendências no Agent Office' })
    expect(taskbarOverlay(0, true)).toEqual({ label: '●', description: 'Reunião gravando' })
    expect(taskbarOverlay(2, true)).toEqual({ label: '2', description: 'Reunião gravando · 2 pendências no Agent Office' })
  })

  it('o disco do overlay desenha o ponto branco no centro', () => {
    const px = badgePixels('●', 16)
    const at = (x: number, y: number) => [...px.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)]
    expect(at(8, 8)).toEqual([255, 255, 255, 255])
    expect(badgePixels('', 16)[(8 * 16 + 8) * 4]).not.toBe(255)
  })

  it('o ponto da barra de menus fica no centro, com margem transparente', () => {
    const px = dotPixels(16, [229, 72, 77])
    expect(px.length).toBe(16 * 16 * 4)
    expect([...px.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)]).toEqual([229, 72, 77, 255])
    expect(px[3]).toBe(0) // canto
    expect(px[(8 * 16 + 0) * 4 + 3]).toBe(0) // borda esquerda
  })
})
