process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import {
  authorLabel,
  conversationRows,
  conversationsWaiting,
  dayLabel,
  draftNote,
  draftOpen,
  linkParts,
  putItem,
  putSummary,
  rowTime,
  threadItems,
} from '@shared/crm-chat-view'
import type { ConversationItem, ConversationSummary, Draft } from '@shared/types'

// CR-14: a aba Conversas sem DOM.

const NOW = new Date(2026, 10, 18, 10, 0).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

const sum = (customerId: string, t: number, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  customerId,
  t,
  preview: '',
  previewKind: 'in',
  unread: 0,
  ...over,
})
const draft = (id: string, status: Draft['status'], over: Partial<Draft> = {}): ConversationItem => ({
  id,
  t: NOW,
  kind: 'draft',
  draft: { id, customerId: 'c', category: 'service', text: 'oi', by: { kind: 'bot', botId: 'b' }, createdAt: NOW, status, ...over },
})

describe('conversationRows', () => {
  const customers = [
    { id: 'a', name: 'Ana', company: 'Padaria' },
    { id: 'b', name: 'Bia' },
    { id: 'c', name: 'Caio' },
    { id: 'd', name: 'Duda' },
  ]

  it('Esperando você primeiro, depois as abertas, depois o resto; mais nova primeiro em cada grupo', () => {
    const rows = conversationRows(
      [
        sum('a', NOW - 10 * DAY),
        sum('b', NOW - HOUR),
        sum('c', NOW - 20 * DAY, { waiting: 'handoff' }),
        sum('d', NOW - 2 * HOUR, { waiting: 'draft' }),
        sum('sumiu', NOW),
      ],
      customers,
      NOW,
    )
    expect(rows.map((r) => [r.summary.customerId, r.group])).toEqual([
      ['d', 'waiting'],
      ['c', 'waiting'],
      ['b', 'open'],
      ['a', 'rest'],
    ])
    expect(rows.at(-1)?.company).toBe('Padaria')
  })

  it('mensagem não lida deixa aberta mesmo antiga', () => {
    expect(conversationRows([sum('a', NOW - 30 * DAY, { unread: 1 })], customers, NOW)[0].group).toBe('open')
  })

  it('conta o que espera você', () => {
    expect(conversationsWaiting([sum('a', 1, { waiting: 'blocked' }), sum('b', 2), sum('c', 3, { waiting: 'new-contact' })])).toBe(2)
  })
})

describe('putSummary e putItem', () => {
  it('troca pelo cliente', () => {
    expect(putSummary([sum('a', 1), sum('b', 2)], sum('a', 5, { unread: 2 })).find((s) => s.customerId === 'a')?.unread).toBe(2)
  })

  it('troca pelo id e põe o atrasado no lugar', () => {
    const items: ConversationItem[] = [
      { id: '1', t: 1, kind: 'in', text: 'a', waId: 'w1' },
      { id: '3', t: 3, kind: 'in', text: 'c', waId: 'w3' },
    ]
    expect(putItem(items, { id: '2', t: 2, kind: 'in', text: 'b', waId: 'w2' }).map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(putItem(items, { id: '3', t: 3, kind: 'in', text: 'C', waId: 'w3' }).map((x) => (x.kind === 'in' ? x.text : ''))).toEqual([
      'a',
      'C',
    ])
  })
})

describe('threadItems', () => {
  it('rascunho enviado ou descartado sai; agendado fica até a mensagem aparecer; aberto fica', () => {
    const items: ConversationItem[] = [
      draft('d1', 'sent'),
      draft('d2', 'discarded'),
      draft('d3', 'scheduled'),
      draft('d4', 'scheduled'),
      { id: 'k4', t: NOW, kind: 'out', text: 'oi', by: { kind: 'player' }, status: 'queued', draftId: 'd4' },
      draft('d5', 'held'),
      draft('d6', 'blocked'),
    ]
    expect(threadItems(items).map((x) => x.id)).toEqual(['d3', 'k4', 'd5', 'd6'])
  })

  it('draftOpen só para pendente, esperando e barrado', () => {
    expect(['pending', 'held', 'blocked', 'scheduled', 'sent'].map((s) => draftOpen({ status: s as Draft['status'] }))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
  })
})

describe('rótulos', () => {
  it('dia e hora', () => {
    expect(dayLabel(NOW - HOUR, NOW)).toBe('Hoje')
    expect(dayLabel(NOW - DAY, NOW)).toBe('Ontem')
    expect(dayLabel(NOW - 3 * DAY, NOW)).toBe('15/11/2026')
    expect(rowTime(new Date(2026, 10, 18, 9, 2).getTime(), NOW)).toBe('09:02')
    expect(rowTime(NOW - DAY, NOW)).toBe('ontem')
    expect(rowTime(NOW - 3 * DAY, NOW)).toBe('15/11')
  })

  it('autor', () => {
    const bots = (id: string) => (id === 'b1' ? 'Atendente' : undefined)
    expect(authorLabel({ kind: 'player' }, bots)).toBe('você')
    expect(authorLabel({ kind: 'phone' }, bots)).toBe('pelo celular')
    expect(authorLabel({ kind: 'bot', botId: 'b1' }, bots)).toBe('Atendente')
    expect(authorLabel({ kind: 'bot', botId: 'x' }, bots)).toBe('bot removido')
    expect(authorLabel({ kind: 'system' }, bots)).toBe('o app')
  })

  it('nota do rascunho: ensaio, agendada, motivo', () => {
    const d = (over: Partial<Draft>): Draft => ({
      id: 'd',
      customerId: 'c',
      category: 'service',
      text: 'oi',
      by: { kind: 'bot', botId: 'b' },
      createdAt: NOW,
      status: 'held',
      ...over,
    })
    expect(draftNote(d({ decision: { action: 'hold', rule: 13, reason: 'Espera você.', rehearsal: true } }))).toMatch(
      /^Modo ensaio: teria sido enviada/,
    )
    expect(draftNote(d({ status: 'scheduled', decision: { action: 'schedule', rule: 10, reason: 'x', at: NOW + DAY } }))).toMatch(
      /^Agendada para/,
    )
    expect(draftNote(d({ decision: { action: 'block', rule: 4, reason: 'Barrada: saiu das ofertas.' } }))).toBe(
      'Barrada: saiu das ofertas.',
    )
    expect(draftNote(d({}))).toMatch(/portão/)
  })
})

describe('linkParts: links no texto do cliente', () => {
  it('separa o link do texto e mostra o domínio de verdade', () => {
    expect(linkParts('veja https://exemplo.com.br/a?b=1. ok')).toEqual([
      { kind: 'text', text: 'veja ' },
      { kind: 'link', text: 'https://exemplo.com.br/a?b=1', url: 'https://exemplo.com.br/a?b=1', host: 'exemplo.com.br' },
      { kind: 'text', text: '. ok' },
    ])
  })

  it('www. vira https', () => {
    expect(linkParts('www.loja.com')).toEqual([{ kind: 'link', text: 'www.loja.com', url: 'https://www.loja.com', host: 'www.loja.com' }])
  })

  it('usuário no endereço não engana: o domínio é o de depois do @', () => {
    const p = linkParts('https://banco.com.br@golpe.io/login')
    expect(p[0]).toMatchObject({ kind: 'link', host: 'golpe.io' })
  })

  it('domínio com letras de outro alfabeto aparece em punycode', () => {
    const p = linkParts('https://раураl.com')
    expect(p[0].kind === 'link' && p[0].host.startsWith('xn--')).toBe(true)
  })

  it('outros esquemas continuam texto', () => {
    expect(linkParts('javascript:alert(1) file:///etc/passwd')).toEqual([{ kind: 'text', text: 'javascript:alert(1) file:///etc/passwd' }])
    expect(linkParts('')).toEqual([])
  })
})
