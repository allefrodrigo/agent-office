import { describe, expect, it } from 'vitest'
import { autoStop, bandEdges, NO_SPEECH_MS, parseWhisper, SILENCE_STOP_MS } from '../src/shared/voice'

const LOG = 'whisper_init_from_file_with_params_no_state: loading model\nwhisper_full_with_state: auto-detected language: pt (p = 0.989128)\nwhisper_print_timings:    total time =   532.68 ms\n'

describe('parseWhisper', () => {
  it('junta as linhas do -nt num texto só, sem espaços sobrando', () => {
    expect(parseWhisper(' Olá, esse é um teste\n do modo voz do escritório.\n')).toEqual({ text: 'Olá, esse é um teste do modo voz do escritório.' })
  })
  it('lê o idioma que o whisper detectou no log', () => {
    expect(parseWhisper(' Abre um ticket.', LOG)).toEqual({ text: 'Abre um ticket.', lang: 'pt' })
  })
  it('sem idioma no log, não inventa um', () => {
    expect(parseWhisper('Oi', 'whisper_print_timings: total time = 10 ms')).toEqual({ text: 'Oi' })
  })
  it('tira as marcas de silêncio e ruído', () => {
    expect(parseWhisper(' [BLANK_AUDIO]\n')).toEqual({ text: '' })
    expect(parseWhisper(' (música)\n Pode começar. [Risos]\n')).toEqual({ text: 'Pode começar.' })
  })
  it('mantém parênteses dentro da fala', () => {
    expect(parseWhisper(' Roda os testes (todos) e me avisa.')).toEqual({ text: 'Roda os testes (todos) e me avisa.' })
  })
})

describe('autoStop', () => {
  it('depois de falar, para no silêncio longo', () => {
    expect(autoStop(10_000 + SILENCE_STOP_MS - 1, 0, 10_000)).toBeNull()
    expect(autoStop(10_000 + SILENCE_STOP_MS, 0, 10_000)).toBe('silence')
  })
  it('sem fala nenhuma, desiste no prazo e não chama o whisper', () => {
    expect(autoStop(NO_SPEECH_MS - 1, 0, 0)).toBeNull()
    expect(autoStop(5_000 + NO_SPEECH_MS, 5_000, 0)).toBe('nospeech')
  })
  it('quem acabou de falar não para', () => {
    expect(autoStop(60_000, 0, 59_900)).toBeNull()
  })
})

describe('bandEdges', () => {
  it('divide a voz em faixas crescentes, cada uma com pelo menos um bin', () => {
    const e = bandEdges(48_000, 2048, 12)
    expect(e).toHaveLength(13)
    for (let k = 1; k < e.length; k++) expect(e[k]).toBeGreaterThan(e[k - 1])
    // 90 Hz e 3200 Hz com bins de 23,4 Hz
    expect(e[0]).toBe(4)
    expect(e[12]).toBe(137)
  })
  it('com bins largos, as faixas graves não se sobrepõem', () => {
    const e = bandEdges(48_000, 256, 12)
    expect(new Set(e).size).toBe(e.length)
  })
})
