import { describe, expect, it } from 'vitest'
import type { Segment } from '@shared/types'
import {
  AUDIO_CHUNK_MAX_BYTES,
  approxTokens,
  dropEcho,
  isHallucination,
  MEETING_MAX_HOURS,
  meetingId,
  normalizeText,
  parseVerboseJson,
  parseWhisperCliJson,
  SILENCE_AUTOSTOP_MIN,
  trigramSimilarity,
  WHISPER_PROMPT_MAX_TOKENS,
  whisperPrompt,
} from '@shared/meetings'

// RN-01: id da reunião, filtros da transcrição, prompt do whisper e leitura das saídas do whisper.

describe('limites', () => {
  it('valores da spec', () => {
    expect(MEETING_MAX_HOURS).toBe(4)
    expect(AUDIO_CHUNK_MAX_BYTES).toBe(65_536)
    expect(SILENCE_AUTOSTOP_MIN).toBe(15)
  })
})

describe('meetingId', () => {
  const at = new Date(2026, 10, 7, 14, 30)

  it('data, hora local e slug do título', () => {
    expect(meetingId(at, 'Kickoff do checkout')).toBe('2026-11-07-1430-kickoff-do-checkout')
    expect(meetingId(at.getTime(), '1:1 com a Ána — revisão')).toBe('2026-11-07-1430-1-1-com-a-ana-revisao')
  })

  it('título sem letras vira "reuniao"', () => {
    expect(meetingId(at, '')).toBe('2026-11-07-1430-reuniao')
    expect(meetingId(at, ' 🎙 — ')).toBe('2026-11-07-1430-reuniao')
  })

  it('título longo é cortado; o id não tem barra nem espaço', () => {
    const id = meetingId(at, 'a'.repeat(200) + ' / ../etc')
    expect(id).toMatch(/^[a-z0-9-]+$/)
    expect(id.length).toBeLessThanOrEqual(16 + 40)
  })

  it('com ids já usados, ganha sufixo até ficar único', () => {
    const base = '2026-11-07-1430-daily'
    expect(meetingId(at, 'Daily', [base])).toBe(`${base}-2`)
    expect(meetingId(at, 'Daily', new Set([base, `${base}-2`]))).toBe(`${base}-3`)
  })
})

describe('isHallucination', () => {
  it('no_speech_prob acima de 0,6 descarta', () => {
    expect(isHallucination('a gente fecha na sexta', 0.61)).toBe(true)
    expect(isHallucination('a gente fecha na sexta', 0.6)).toBe(false)
    expect(isHallucination('a gente fecha na sexta')).toBe(false)
  })

  it('frases conhecidas em pt e en, com qualquer pontuação e caixa', () => {
    for (const t of [
      'Legendas pela comunidade Amara.org',
      ' legendas pela comunidade amara.org ',
      'Legendas por Fulano de Tal',
      'Obrigado por assistir!',
      'OBRIGADA POR ASSISTIR.',
      'Inscreva-se no canal',
      'Thanks for watching!',
      'Thank you for watching.',
      'Subtitles by the Amara.org community',
      'Amara.org',
    ])
      expect(isHallucination(t, 0.1), t).toBe(true)
  })

  it('marcas de silêncio e música', () => {
    for (const t of ['[Música]', '(música)', '[BLANK_AUDIO]', '[Aplausos] [Risos]', '♪', '  ', '...'])
      expect(isHallucination(t), t).toBe(true)
  })

  it('fala de verdade passa, mesmo parecida', () => {
    for (const t of [
      'Obrigado a todos, até amanhã',
      'Obrigado por assistir a demo ontem, Ana',
      'Quem fez as legendas do vídeo?',
      'Thanks for watching the deploy',
      'Toca a [música] depois',
    ])
      expect(isHallucination(t, 0.2), t).toBe(false)
  })
})

describe('trigramSimilarity', () => {
  it('iguais dão 1, diferentes dão perto de 0, ignorando acento e pontuação', () => {
    expect(trigramSimilarity('Pix primeiro!', 'pix primeiro')).toBe(1)
    expect(trigramSimilarity('Ação', 'acao')).toBe(1)
    expect(trigramSimilarity('pix primeiro', 'cartão depois')).toBeLessThan(0.2)
    expect(trigramSimilarity('', 'x')).toBe(0)
  })

  it('normalizeText tira acento, pontuação e caixa', () => {
    expect(normalizeText('  Olá, MUNDO!  Ação… ')).toBe('ola mundo acao')
  })
})

describe('dropEcho', () => {
  const seg = (id: number, track: Segment['track'], start: number, end: number, text: string): Segment => ({ id, track, start, end, text })
  const theirs = [seg(1, 'outros', 10_000, 14_000, 'a gente precisa do pix até dia vinte')]

  it('descarta a fala do microfone que repete o alto-falante na mesma hora', () => {
    const mine = [seg(2, 'eu', 10_300, 14_200, 'A gente precisa do pix até dia vinte.')]
    expect(dropEcho(mine, theirs)).toEqual([])
  })

  it('a janela é de ±1,5 s', () => {
    const text = 'a gente precisa do pix até dia vinte'
    expect(dropEcho([seg(2, 'eu', 15_400, 17_000, text)], theirs)).toEqual([])
    expect(dropEcho([seg(2, 'eu', 15_600, 17_000, text)], theirs)).toHaveLength(1)
    expect(dropEcho([seg(2, 'eu', 6000, 8400, text)], theirs)).toHaveLength(1)
  })

  it('fala diferente na mesma hora fica', () => {
    const mine = [seg(2, 'eu', 11_000, 13_000, 'fechado, pix primeiro e cartão depois')]
    expect(dropEcho(mine, theirs)).toEqual(mine)
  })

  it('similaridade abaixo de 0,8 fica', () => {
    const mine = [seg(2, 'eu', 10_000, 14_000, 'a gente precisa do cartão até dia trinta')]
    expect(trigramSimilarity(mine[0].text, theirs[0].text)).toBeLessThan(0.8)
    expect(dropEcho(mine, theirs)).toEqual(mine)
  })

  it('pega o eco mesmo quando a outra faixa cortou em dois trechos', () => {
    const split = [seg(1, 'outros', 10_000, 12_000, 'a gente precisa do pix'), seg(3, 'outros', 12_100, 14_000, 'até dia vinte')]
    expect(dropEcho([seg(2, 'eu', 10_100, 14_100, 'a gente precisa do pix até dia vinte')], split)).toEqual([])
  })

  it('sem nada na outra faixa, nada muda', () => {
    const mine = [seg(2, 'eu', 0, 1000, 'oi')]
    expect(dropEcho(mine, [])).toEqual(mine)
  })
})

describe('whisperPrompt', () => {
  it('participantes, andar, agentes e o fim do trecho anterior', () => {
    expect(
      whisperPrompt({
        attendees: ['Ana', 'Bruno'],
        floor: 'agents-2d',
        agents: ['Joana', 'Turing'],
        previous: 'e o pix fica para dia vinte',
      }),
    ).toBe('Participantes: Ana, Bruno. Projeto: agents-2d. Agentes: Joana, Turing. e o pix fica para dia vinte')
  })

  it('vazio quando não há nada; sem rótulo de grupo vazio', () => {
    expect(whisperPrompt({})).toBe('')
    expect(whisperPrompt({ agents: ['Joana'] })).toBe('Agentes: Joana.')
  })

  it('tira repetidos, quebras de linha e controles', () => {
    expect(whisperPrompt({ attendees: ['Ana', ' ana ', 'Bruno\nSilva', ''], agents: ['Ana'] })).toBe('Participantes: Ana, Bruno Silva.')
  })

  it(`respeita o limite de ${WHISPER_PROMPT_MAX_TOKENS} tokens com listas e texto longos`, () => {
    const names = Array.from({ length: 200 }, (_, i) => `Pessoa Número ${i}`)
    const previous = Array.from({ length: 500 }, (_, i) => `palavra${i}`).join(' ')
    const p = whisperPrompt({ attendees: names, floor: 'agents-2d', agents: names.map((n) => `Agente ${n}`), previous })
    expect(approxTokens(p)).toBeLessThanOrEqual(WHISPER_PROMPT_MAX_TOKENS)
    expect(p.startsWith('Participantes: Pessoa Número 0, Pessoa Número 1')).toBe(true)
    // o trecho anterior entra pelo fim, começando numa palavra inteira
    expect(p.endsWith('palavra499')).toBe(true)
    expect(p).toMatch(/\. palavra\d+ /)
  })

  it('sem nomes, o trecho anterior usa o espaço todo', () => {
    const previous = 'x'.repeat(5) + ' ' + Array.from({ length: 400 }, () => 'fala').join(' ')
    const p = whisperPrompt({ previous })
    expect(approxTokens(p)).toBeLessThanOrEqual(WHISPER_PROMPT_MAX_TOKENS)
    expect(p.length).toBeGreaterThan(WHISPER_PROMPT_MAX_TOKENS * 3 * 0.9)
  })
})

describe('parseVerboseJson', () => {
  const body = JSON.stringify({
    task: 'transcribe',
    language: 'portuguese',
    duration: 6.2,
    text: ' A gente precisa do pix. Fechado.',
    segments: [
      {
        id: 0,
        text: ' A gente precisa do pix.',
        start: 0.0,
        end: 2.48,
        tokens: [1, 2],
        temperature: 0,
        avg_logprob: -0.2,
        no_speech_prob: 0.012,
      },
      { id: 1, text: ' Fechado.', start: 2.48, end: 6.2, no_speech_prob: 1.4 },
      { id: 2, text: '   ', start: 6.2, end: 6.2, no_speech_prob: 0.9 },
      { id: 3, text: 'sem tempo' },
    ],
  })

  it('segundos viram ms; texto aparado; no_speech_prob entre 0 e 1', () => {
    expect(parseVerboseJson(body)).toEqual([
      { start: 0, end: 2480, text: 'A gente precisa do pix.', noSpeechProb: 0.012 },
      { start: 2480, end: 6200, text: 'Fechado.', noSpeechProb: 1 },
    ])
  })

  it('aceita o objeto já lido; sem no_speech_prob, sem o campo', () => {
    expect(parseVerboseJson({ segments: [{ text: 'oi', start: 1, end: 2 }] })).toEqual([{ start: 1000, end: 2000, text: 'oi' }])
  })

  it('sem segmentos devolve vazio', () => {
    expect(parseVerboseJson('{"text":""}')).toEqual([])
    expect(parseVerboseJson(null)).toEqual([])
    expect(parseVerboseJson({ segments: [null, 3] })).toEqual([])
  })

  it('erro do servidor e corpo sem JSON viram exceção com mensagem clara', () => {
    expect(() => parseVerboseJson('{"error":"failed to read WAV"}')).toThrow(/whisper-server recusou.*failed to read WAV/)
    expect(() => parseVerboseJson('<html>404</html>')).toThrow(/JSON válido/)
  })
})

describe('parseWhisperCliJson', () => {
  const json = {
    systeminfo: 'AVX = 0',
    model: { type: 'small' },
    params: { language: 'pt' },
    result: { language: 'pt' },
    transcription: [
      { timestamps: { from: '00:00:00,000', to: '00:00:02,480' }, offsets: { from: 0, to: 2480 }, text: ' A gente precisa do pix.' },
      { timestamps: { from: '00:00:02,480', to: '00:00:06,200' }, offsets: { from: 2480, to: 6200 }, text: ' Fechado.' },
      { offsets: { from: 6200, to: 6300 }, text: ' ' },
      { text: 'sem offsets' },
    ],
  }

  it('offsets em ms e texto aparado, no mesmo formato do server', () => {
    const want = [
      { start: 0, end: 2480, text: 'A gente precisa do pix.' },
      { start: 2480, end: 6200, text: 'Fechado.' },
    ]
    expect(parseWhisperCliJson(json)).toEqual(want)
    expect(parseWhisperCliJson(JSON.stringify(json))).toEqual(want)
  })

  it('formato estranho devolve vazio; texto que não é JSON lança', () => {
    expect(parseWhisperCliJson({})).toEqual([])
    expect(parseWhisperCliJson({ transcription: [null] })).toEqual([])
    expect(() => parseWhisperCliJson('nada')).toThrow(/JSON válido/)
  })
})
