import { describe, expect, it } from 'vitest'
import { autoStart, placeBalloon, resolveSteps, TOUR_DONE_KEY, TourFlow, tourDone, tourSteps, type FlagStore, type TourTarget } from '../src/renderer/src/ui/tour-plan'

/** localStorage stand-in. */
function store(): FlagStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

const everything = () => true
const key = (t: TourTarget) => ('hud' in t ? `hud:${t.hud}` : `world:${t.world}`)

describe('tour guiado: passos', () => {
  it('segue a ordem combinada', () => {
    expect(tourSteps('darwin').map((s) => s.id)).toEqual([
      'welcome', 'desk', 'roster', 'panel', 'cards', 'board', 'resume', 'floors', 'limits', 'skull', 'lounge', 'routines', 'camera', 'end',
    ])
  })

  it('tem título e um texto de no máximo duas frases em cada passo', () => {
    for (const s of tourSteps('darwin')) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.text.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length).toBeLessThanOrEqual(2)
    }
  })

  it('usa Ctrl fora do Mac', () => {
    const cards = (p: string) => tourSteps(p).find((s) => s.id === 'cards')!.text
    expect(cards('darwin')).toContain('⌘⌫')
    expect(cards('win32')).toContain('Ctrl+⌫')
  })

  it('pula em silêncio um alvo que não existe, como o totem de rotinas', () => {
    const missing = new Set(['world:routines', 'hud:roster'])
    const steps = resolveSteps(tourSteps('darwin'), (t) => !missing.has(key(t)))
    const ids = steps.map((s) => s.id)
    expect(ids).not.toContain('routines')
    expect(ids).not.toContain('roster')
    expect(ids[0]).toBe('welcome')
    expect(ids.at(-1)).toBe('end')
  })

  it('cai no alvo seguinte do passo quando o primeiro não existe', () => {
    // painel fechado: o passo aponta para a área do time no mundo
    const steps = resolveSteps(tourSteps('darwin'), (t) => key(t) !== 'hud:panel')
    expect(steps.find((s) => s.id === 'panel')!.target).toEqual({ world: 'team' })
  })

  it('mantém os passos sem alvo (boas-vindas e fim) no meio da tela', () => {
    const steps = resolveSteps(tourSteps('darwin'), () => false)
    expect(steps.map((s) => [s.id, s.target])).toEqual([
      ['welcome', null],
      ['end', null],
    ])
  })
})

describe('tour guiado: navegação e flag', () => {
  const steps = () => resolveSteps(tourSteps('darwin'), everything)

  it('conta "1 de N", anda e volta', () => {
    const flow = new TourFlow(steps(), store())
    const n = flow.steps.length
    expect(flow.label).toBe(`1 de ${n}`)
    expect(flow.back()).toBe(false)
    expect(flow.next()).toBe(true)
    expect(flow.label).toBe(`2 de ${n}`)
    expect(flow.back()).toBe(true)
    expect(flow.first).toBe(true)
  })

  it('grava a flag ao concluir', () => {
    const s = store()
    const flow = new TourFlow(steps(), s)
    while (flow.next()) expect(tourDone(s)).toBe(false)
    expect(flow.ended).toBe('done')
    expect(s.data.get(TOUR_DONE_KEY)).toBe('1')
    expect(tourDone(s)).toBe(true)
  })

  it('grava a flag ao pular', () => {
    const s = store()
    const flow = new TourFlow(steps(), s)
    flow.next()
    flow.skip()
    expect(flow.ended).toBe('skipped')
    expect(tourDone(s)).toBe(true)
    // depois de fechado, não anda mais
    expect(flow.next()).toBe(false)
  })

  it('não quebra se o armazenamento recusar a gravação', () => {
    const flow = new TourFlow(steps(), { getItem: () => null, setItem: () => { throw new Error('cheio') } })
    expect(() => flow.skip()).not.toThrow()
  })
})

describe('tour guiado: quando abre', () => {
  it('abre na primeira vez, sem nada na tela', () => {
    expect(autoStart({ done: false, forced: false, blocked: false })).toBe('start')
  })

  it('espera um cartão de permissão ou resultado fechar', () => {
    expect(autoStart({ done: false, forced: false, blocked: true })).toBe('wait')
  })

  it('não volta depois de concluído ou pulado', () => {
    expect(autoStart({ done: true, forced: false, blocked: false })).toBe('never')
  })

  it('AGENT_OFFICE_TOUR=1 força, mas ainda espera o cartão', () => {
    expect(autoStart({ done: true, forced: true, blocked: false })).toBe('start')
    expect(autoStart({ done: true, forced: true, blocked: true })).toBe('wait')
  })
})

describe('tour guiado: posição do balão', () => {
  const view = { w: 1200, h: 800 }
  const size = { w: 300, h: 140 }

  it('fica do lado pedido quando cabe', () => {
    const at = placeBalloon({ x: 500, y: 700, w: 60, h: 40 }, size, 'top', view)
    expect(at.side).toBe('top')
    expect(at.y + size.h).toBeLessThanOrEqual(700)
  })

  it('vira para o outro lado e não sai da janela', () => {
    const at = placeBalloon({ x: 1100, y: 300, w: 80, h: 80 }, size, 'right', view)
    expect(at.side).toBe('left')
    expect(at.x).toBeGreaterThanOrEqual(12)
    expect(at.x + size.w).toBeLessThanOrEqual(1100)
  })

  it('sem alvo, centraliza', () => {
    expect(placeBalloon(null, size, 'right', view)).toEqual({ x: 450, y: 330, side: 'center' })
  })
})
