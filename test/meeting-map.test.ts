import { describe, expect, it } from 'vitest'
import { doNotDisturb, meetingClock, pickSeat, waitingSummary } from '@shared/meeting-map'

const seats = [
  { x: 1, z: 1 },
  { x: 3, z: 1 },
  { x: 1, z: 2 },
]

describe('pickSeat', () => {
  it('escolhe o primeiro assento da lista quando a sala está vazia', () => {
    expect(pickSeat(seats, [])).toBe(0)
  })

  it('pula assentos com alguém sentado ou de pé em cima', () => {
    expect(pickSeat(seats, [{ x: 1.1, z: 1 }])).toBe(1)
    expect(pickSeat(seats, [{ x: 1, z: 1 }, { x: 3, z: 0.8 }])).toBe(2)
  })

  it('ignora quem está longe do assento', () => {
    expect(pickSeat(seats, [{ x: 2, z: 1 }])).toBe(0)
  })

  it('devolve -1 com todos ocupados ou sem assentos', () => {
    expect(pickSeat(seats, seats)).toBe(-1)
    expect(pickSeat([], [])).toBe(-1)
  })
})

describe('doNotDisturb', () => {
  const live = { floor: 'terreo', startedAt: 0 }

  it('vale só durante a reunião', () => {
    expect(doNotDisturb(null, { doNotDisturb: true })).toBe(false)
    expect(doNotDisturb(live, { doNotDisturb: true })).toBe(true)
  })

  it('vale também com a gravação em pausa', () => {
    expect(doNotDisturb({ ...live, paused: true }, { doNotDisturb: true })).toBe(true)
  })

  it('respeita o ajuste desligado', () => {
    expect(doNotDisturb(live, { doNotDisturb: false })).toBe(false)
  })

  it('sem ajuste salvo, fica ligado (padrão da spec)', () => {
    expect(doNotDisturb(live, undefined)).toBe(true)
    expect(doNotDisturb(live, {})).toBe(true)
  })
})

describe('waitingSummary', () => {
  it('não diz nada sem pedidos', () => {
    expect(waitingSummary(0)).toBeNull()
    expect(waitingSummary(-2)).toBeNull()
    expect(waitingSummary(Number.NaN)).toBeNull()
  })

  it('usa o singular para um pedido', () => {
    expect(waitingSummary(1)).toBe('1 pedido esperando você')
  })

  it('usa o plural a partir de dois', () => {
    expect(waitingSummary(2)).toBe('2 pedidos esperando você')
    expect(waitingSummary(3)).toBe('3 pedidos esperando você')
  })
})

describe('meetingClock', () => {
  it('mostra minutos e segundos abaixo de uma hora', () => {
    expect(meetingClock(0)).toBe('00:00')
    expect(meetingClock(425_000)).toBe('07:05')
    expect(meetingClock(3_599_999)).toBe('59:59')
  })

  it('mostra as horas depois de uma hora', () => {
    expect(meetingClock(3_729_000)).toBe('1:02:09')
  })

  it('trata relógio adiantado como zero', () => {
    expect(meetingClock(-5000)).toBe('00:00')
  })
})
