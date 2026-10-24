import { describe, expect, it } from 'vitest'
import { BLUR_FPS, DEFAULT_VIDEO, effectiveVideo, frameInterval, IDLE_FPS, QUALITY_PRESETS, qualityOf } from '../src/shared/video'

describe('qualityOf', () => {
  it('reconhece cada predefinição e o padrão é Equilibrada', () => {
    for (const q of ['high', 'balanced', 'saver'] as const) expect(qualityOf({ ...QUALITY_PRESETS[q], batterySaver: false })).toBe(q)
    expect(qualityOf(DEFAULT_VIDEO)).toBe('balanced')
  })
  it('mistura feita à mão não é predefinição; sem sombras a resolução não conta', () => {
    expect(qualityOf({ ...QUALITY_PRESETS.high, fpsLimit: 30, batterySaver: false })).toBeNull()
    expect(qualityOf({ ...QUALITY_PRESETS.saver, shadowMapSize: 2048, batterySaver: false })).toBe('saver')
  })
})

describe('effectiveVideo', () => {
  it('na bateria com a opção marcada entra em Economia: sem sombras, 30 fps', () => {
    const v = effectiveVideo({ ...QUALITY_PRESETS.high, batterySaver: true }, true)
    expect(v).toMatchObject({ shadows: false, fpsLimit: 30, effects: 'reduced', saving: true })
  })
  it('a Economia da bateria não troca o visual (trocar recarrega a janela)', () => {
    expect(effectiveVideo({ ...QUALITY_PRESETS.high, batterySaver: true, view: '2d' }, true).view).toBe('2d')
  })
  it('na tomada, ou com a opção desmarcada, fica o que o jogador escolheu', () => {
    const high = { ...QUALITY_PRESETS.high, batterySaver: true }
    expect(effectiveVideo(high, false)).toEqual({ ...high, saving: false })
    expect(effectiveVideo({ ...high, batterySaver: false }, true)).toEqual({ ...high, batterySaver: false, saving: false })
  })
})

describe('frameInterval', () => {
  const base = { fpsLimit: 60 as const, busy: true, focused: true, fullSpeed: false }
  it('em movimento respeita o limite de fps', () => {
    expect(frameInterval(base)).toBeCloseTo(1000 / 60)
    expect(frameInterval({ ...base, fpsLimit: 30 })).toBeCloseTo(1000 / 30)
    expect(frameInterval({ ...base, fpsLimit: 0 })).toBe(0)
  })
  it('cena parada cai para o passo lento; sem foco, para o de fundo', () => {
    expect(frameInterval({ ...base, busy: false })).toBeCloseTo(1000 / IDLE_FPS)
    expect(frameInterval({ ...base, focused: false })).toBeCloseTo(1000 / BLUR_FPS)
    expect(frameInterval({ ...base, busy: false, focused: false })).toBeCloseTo(1000 / Math.min(IDLE_FPS, BLUR_FPS))
  })
  it('o bench sem ritmo desenha todo frame', () => {
    expect(frameInterval({ ...base, fpsLimit: 30, busy: false, focused: false, fullSpeed: true })).toBe(0)
  })
})
