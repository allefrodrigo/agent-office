process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import type { ThreadItem } from '@shared/types'
import {
  channelLines,
  channelPrompt,
  findMentions,
  floorChannelId,
  foldName,
  insertMention,
  isFloorChannel,
  mentionQuery,
  mentionSuggestions,
  mentionText,
  parseMentions,
  sortChannels,
} from '@shared/bots-mentions'

const members = [
  { id: 'chefe', name: 'Chefe de gabinete' },
  { id: 'revisor', name: 'Revisor do dia' },
  { id: 'cacador', name: 'Caçador de bugs' },
  { id: 'ada', name: 'Ada' },
  { id: 'dep', name: 'Vigia de dependências' },
  { id: 'conc', name: 'Vigia de concorrentes' },
  { id: 'dr', name: 'Dr. Bot (QA)' },
]

describe('@menções', () => {
  it('acha o nome simples, em qualquer caixa', () => {
    expect(parseMentions('@Ada olha isso', members)).toEqual(['ada'])
    expect(parseMentions('oi @ada, tudo bem?', members)).toEqual(['ada'])
    expect(parseMentions('@ADA!', members)).toEqual(['ada'])
  })

  it('acha o nome composto pelas palavras, o mais longo que bate', () => {
    expect(parseMentions('@Chefe de gabinete pode resumir?', members)).toEqual(['chefe'])
    const withShort = [...members, { id: 'chefe-curto', name: 'Chefe' }]
    expect(parseMentions('@Chefe de gabinete, veja', withShort)).toEqual(['chefe'])
    expect(parseMentions('@Chefe, veja', withShort)).toEqual(['chefe-curto'])
  })

  it('aceita o nome entre aspas', () => {
    expect(parseMentions('@"Chefe de gabinete" pode?', members)).toEqual(['chefe'])
    expect(parseMentions('@“Revisor do dia” olha', members)).toEqual(['revisor'])
    expect(parseMentions('@"Dr. Bot (QA)" testa', members)).toEqual(['dr'])
    expect(parseMentions('@"Ninguém aqui" testa', members)).toEqual([])
  })

  it('ignora acentos dos dois lados', () => {
    expect(parseMentions('@Cacador de bugs reproduz', members)).toEqual(['cacador'])
    expect(parseMentions('@caçador de BUGS', members)).toEqual(['cacador'])
    expect(parseMentions('@Vigia de dependencias roda', members)).toEqual(['dep'])
  })

  it('a primeira palavra basta quando só um membro começa com ela', () => {
    expect(parseMentions('@Revisor olha o PR', members)).toEqual(['revisor'])
    expect(parseMentions('@Caçador reproduz', members)).toEqual(['cacador'])
    // dois "Vigia de …": ambíguo, ninguém
    expect(parseMentions('@Vigia roda', members)).toEqual([])
    expect(parseMentions('@Vigia de roda', members)).toEqual([])
  })

  it('aceita o nome com hífen ou sublinhado no lugar do espaço', () => {
    expect(parseMentions('@chefe-de-gabinete e @revisor_do_dia', members)).toEqual(['chefe', 'revisor'])
  })

  it('e-mail e @ grudado numa palavra não são menção', () => {
    expect(parseMentions('mande para a@b.com', [{ id: 'b', name: 'b' }])).toEqual([])
    expect(parseMentions('ada@ada.com', members)).toEqual([])
    expect(parseMentions('x.@Ada', members)).toEqual([])
    expect(parseMentions('(@Ada)', members)).toEqual(['ada'])
    expect(parseMentions('linha\n@Ada', members)).toEqual(['ada'])
  })

  it('o nome não atravessa uma quebra de linha', () => {
    expect(parseMentions('@Chefe de\ngabinete', [{ id: 'chefe', name: 'Chefe de gabinete' }])).toEqual(['chefe'])
    expect(
      parseMentions('@Chefe de\ngabinete', [
        { id: 'chefe', name: 'Chefe de gabinete' },
        { id: 'c2', name: 'Chefe de obra' },
      ]),
    ).toEqual([])
  })

  it('devolve cada membro uma vez, na ordem em que aparece', () => {
    expect(parseMentions('@Revisor e @Ada, e de novo @revisor do dia', members)).toEqual(['revisor', 'ada'])
  })

  it('marca onde cada menção está no texto', () => {
    const text = 'oi @Chefe de gabinete, e @Ada'
    const hits = findMentions(text, members)
    expect(hits.map((h) => text.slice(h.start, h.end))).toEqual(['@Chefe de gabinete', '@Ada'])
  })

  it('sem membros, nada', () => {
    expect(parseMentions('@Ada', [])).toEqual([])
    expect(parseMentions('', members)).toEqual([])
    expect(parseMentions('@', members)).toEqual([])
  })

  it('foldName tira acento, caixa e hífen', () => {
    expect(foldName('  Caçador-de_BUGS ')).toBe('cacador de bugs')
  })
})

describe('autocompletar do @', () => {
  it('acha o @ que está sendo digitado', () => {
    expect(mentionQuery('oi @Ch', 6)).toEqual({ start: 3, query: 'Ch' })
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('@Chefe de', 9)).toEqual({ start: 0, query: 'Chefe de' })
    expect(mentionQuery('@"Chefe de', 10)).toEqual({ start: 0, query: 'Chefe de' })
  })

  it('não abre em e-mail, depois de espaço, de linha nova ou de aspas fechadas', () => {
    expect(mentionQuery('a@b', 3)).toBeNull()
    expect(mentionQuery('@ x', 3)).toBeNull()
    expect(mentionQuery('@Ada\noi', 7)).toBeNull()
    expect(mentionQuery('@"Ada" oi', 9)).toBeNull()
    expect(mentionQuery('sem arroba', 10)).toBeNull()
    expect(mentionQuery('@a b c d e', 10)).toBeNull()
  })

  it('sugere quem começa com o texto, depois quem tem uma palavra que começa', () => {
    expect(mentionSuggestions('', members, 3).map((m) => m.id)).toEqual(['chefe', 'revisor', 'cacador'])
    expect(mentionSuggestions('vig', members).map((m) => m.id)).toEqual(['dep', 'conc'])
    expect(mentionSuggestions('bugs', members).map((m) => m.id)).toEqual(['cacador'])
    expect(mentionSuggestions('caca', members).map((m) => m.id)).toEqual(['cacador'])
    expect(mentionSuggestions('zzz', members)).toEqual([])
  })

  it('escreve o nome sem aspas quando dá, com aspas quando precisa', () => {
    expect(mentionText('Chefe de gabinete')).toBe('@Chefe de gabinete')
    expect(mentionText('Caçador de bugs')).toBe('@Caçador de bugs')
    expect(mentionText('Dr. Bot (QA)')).toBe('@"Dr. Bot (QA)"')
  })

  it('o texto inserido acha o mesmo membro de volta', () => {
    for (const m of members) {
      const { text } = insertMention('@x', 0, 2, m.name)
      expect(parseMentions(text, members)).toEqual([m.id])
    }
  })

  it('troca o @ digitado pelo nome e põe o cursor depois', () => {
    expect(insertMention('oi @Ch tudo', 3, 6, 'Chefe de gabinete')).toEqual({ text: 'oi @Chefe de gabinete tudo', caret: 22 })
    expect(insertMention('@Ad', 0, 3, 'Ada')).toEqual({ text: '@Ada ', caret: 5 })
  })
})

describe('últimas mensagens do canal', () => {
  const items: ThreadItem[] = [
    { id: '1', t: 1, kind: 'user', text: 'primeira', attachments: [{ name: 'a.png', kind: 'image', size: 1 }] },
    {
      id: '2',
      t: 2,
      kind: 'run',
      botId: 'ada',
      runId: 'r',
      trigger: { kind: 'channel', channelId: 'c' },
      label: 'x',
      status: 'ok',
      steps: 1,
    },
    { id: '3', t: 3, kind: 'bot', botId: 'ada', text: 'resposta\n\ncom   espaços' },
    { id: '4', t: 4, kind: 'notice', text: 'aviso' },
    { id: '5', t: 5, kind: 'bot', botId: 'sumiu', text: 'de um bot apagado' },
    { id: '6', t: 6, kind: 'bot', botId: 'ada', text: 'membro do squad', member: { id: 'm', name: 'Ana', icon: '🎯' } },
  ]

  it('só mensagens, com quem disse, sem arquivo e sem rodada', () => {
    const lines = channelLines(items, { ada: 'Ada' })
    expect(lines.map((l) => `${l.who}: ${l.text}`)).toEqual([
      'Usuário: primeira (1 anexo)',
      'Ada: resposta com espaços',
      'Bot removido: de um bot apagado',
      'Ana: membro do squad',
    ])
  })

  it('respeita o número e o tamanho', () => {
    expect(channelLines(items, {}, 2)).toHaveLength(2)
    const long: ThreadItem[] = Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, t: i, kind: 'user', text: 'x'.repeat(1000) }))
    const lines = channelLines(long, {}, 20, 600, 3000)
    expect(lines.length).toBeLessThan(20)
    expect(lines.every((l) => l.text.length <= 600)).toBe(true)
    expect(lines[lines.length - 1].t).toBe(29)
  })

  it('o prompt do bot tem o tema, os membros, as últimas e a nova', () => {
    const p = channelPrompt({
      channel: { name: 'lançamento', topic: 'A versão 0.5' },
      me: { id: 'ada', name: 'Ada' },
      members: [
        { id: 'ada', name: 'Ada' },
        { id: 'rev', name: 'Revisor do dia' },
      ],
      recent: channelLines(items, { ada: 'Ada' }),
      message: '@Ada pode revisar?',
      attachments: 2,
      at: Date.UTC(2026, 10, 15, 10, 30),
      by: 'mention',
    })
    expect(p).toContain('#lançamento · 15/11 07:30')
    expect(p).toContain('Tema do canal: A versão 0.5')
    expect(p).toContain('Membros: Ada (você), Revisor do dia')
    expect(p).toContain('Usuário: primeira (1 anexo)')
    expect(p).toContain('<mensagem>\n@Ada pode revisar?\n</mensagem>')
    expect(p).toContain('2 anexos vão junto')
    expect(p).toContain('bot_ask')
  })
})

describe('canal do andar', () => {
  it('tem o id do andar e vem primeiro', () => {
    expect(floorChannelId('terreo')).toBe('andar-terreo')
    expect(isFloorChannel({ id: 'andar-p1', floor: 'p1' })).toBe(true)
    expect(isFloorChannel({ id: 'andar-p1', floor: 'p2' })).toBe(false)
    const list = sortChannels([
      { id: 'b', floor: 'p1', order: 2, name: 'b' },
      { id: 'a', floor: 'p1', order: 1, name: 'z' },
      { id: 'andar-p1', floor: 'p1', order: 9, name: 'geral' },
    ])
    expect(list.map((c) => c.id)).toEqual(['andar-p1', 'a', 'b'])
  })
})
