process.env.TZ = 'America/Sao_Paulo'

import { describe, expect, it } from 'vitest'
import {
  approvalFromRequest,
  approvalOutcome,
  botSystemPrompt,
  cleanMemory,
  clip,
  closeRun,
  foldThread,
  itemsFromLog,
  looksLikeSecret,
  memoryBytes,
  recentContext,
  runHeader,
  runLabel,
  searchItems,
  type RunItem,
} from '../src/shared/bots'
import { BOT_LIMITS, SENSITIVE_KINDS, type ThreadItem } from '../src/shared/types/bots'
import type { LogEntry, PermissionRequest } from '../src/shared/types/conversation'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const run = (extra: Partial<RunItem> = {}): RunItem => ({ id: 'r1', t: at(15, 7, 30), kind: 'run', botId: 'b1', runId: 'r1', trigger: { kind: 'manual' }, label: 'Rodar agora', status: 'running', steps: 0, ...extra })
const log = (kind: LogEntry['kind'], text: string, extra: Partial<LogEntry> = {}): LogEntry => ({ id: `l-${Math.random()}`, t: at(15, 7, 31), kind, text, ...extra })

describe('foldThread', () => {
  it('a repeated id updates the item in the place of its first line', () => {
    const lines = [
      JSON.stringify({ id: 'a', t: 1, kind: 'user', text: 'oi' }),
      JSON.stringify(run({ id: 'b', status: 'running' })),
      JSON.stringify({ id: 'c', t: 3, kind: 'notice', text: 'Nova conversa' }),
      JSON.stringify(run({ id: 'b', status: 'ok', steps: 4 })),
    ]
    const items = foldThread(lines.join('\n'))
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(items[1]).toMatchObject({ status: 'ok', steps: 4 })
  })

  it('skips broken lines, unknown kinds and items without what their kind needs', () => {
    const items = foldThread([
      '{"id":"a","t":1,"kind":"user","text":"ok"}',
      '{"id":"b","t":1,"kind":"user","te', // cut by a crash
      '',
      'null',
      '{"id":"c","t":1,"kind":"alien","text":"x"}',
      '{"id":"d","t":"1","kind":"user","text":"x"}',
      '{"id":"e","t":1,"kind":"run"}',
      '{"id":"f","t":1,"kind":"approval","requestId":"p","request":{},"status":"pending"}',
      '{"id":"g","t":1,"kind":"side","fromBotId":"a","toBotId":"b","question":"?","status":"asked"}',
    ])
    expect(items.map((i) => i.id)).toEqual(['a', 'f', 'g'])
  })
})

describe('itemsFromLog', () => {
  it('tools, thinking and failed results become steps; tool calls are counted', () => {
    let r = run()
    r = itemsFromLog(log('tool', 'npm test', { tool: 'Bash' }), r).run!
    r = itemsFromLog(log('thinking', 'hmm'), r).run!
    r = itemsFromLog(log('tool_result', '42 passaram'), r).run ?? r
    r = itemsFromLog(log('tool_result', 'Error: falhou\nstack', { isError: true }), r).run!
    r = itemsFromLog(log('error', 'O CLI caiu'), r).run!
    expect(r.steps).toBe(1)
    expect(r.log!.map((s) => [s.kind, s.text])).toEqual([
      ['tool', 'npm test'],
      ['thinking', 'hmm'],
      ['error', 'Error: falhou'],
      ['error', 'O CLI caiu'],
    ])
    expect(r.log![0].tool).toBe('Bash')
  })

  it('assistant text is a step and the candidate for the bubble, whole', () => {
    const long = 'Vou ler o arquivo. '.repeat(40)
    const c = itemsFromLog(log('assistant', long), run())
    expect(c.candidate).toBe(long)
    expect(c.run!.log![0].text.length).toBeLessThanOrEqual(BOT_LIMITS.stepText)
    expect(c.run!.log![0].text.endsWith('…')).toBe(true)
  })

  it('keeps the newest steps, at most BOT_LIMITS.steps', () => {
    let r = run()
    for (let k = 0; k < 70; k++) r = itemsFromLog(log('tool', `passo ${k}`, { tool: 'Read' }), r).run!
    expect(r.log).toHaveLength(BOT_LIMITS.steps)
    expect(r.log![0].text).toBe('passo 20')
    expect(r.steps).toBe(70)
  })

  it('user lines: only those the Chat did not write itself', () => {
    const e = log('user', 'feito pelo painel', { attachments: [{ name: 'a.png', kind: 'image', size: 3 }] })
    expect(itemsFromLog(e, run(), { ownUser: true })).toEqual({})
    expect(itemsFromLog(e, run()).user).toMatchObject({ id: e.id, kind: 'user', text: 'feito pelo painel', attachments: [{ name: 'a.png' }] })
    expect(itemsFromLog(log('user', '  '), run())).toEqual({})
  })

  it('without a run, nothing but user lines and candidates', () => {
    expect(itemsFromLog(log('tool', 'x'), undefined)).toEqual({})
    expect(itemsFromLog(log('system', 'x'), run())).toEqual({})
    expect(itemsFromLog(log('result', 'x'), run())).toEqual({})
  })
})

describe('closeRun', () => {
  it('the final text becomes the bubble once: the matching last step goes', () => {
    let r = run()
    r = itemsFromLog(log('assistant', 'Vou ler o quadro.'), r).run!
    r = itemsFromLog(log('tool', 'tickets_list', { tool: 'mcp__office__tickets_list' }), r).run!
    r = itemsFromLog(log('assistant', 'Três coisas pedem você hoje.'), r).run!
    const done = closeRun(r, { text: 'Três coisas pedem você hoje.', isError: false, costUsd: 0.08123, durationMs: 100_000 }, at(15, 7, 32))
    expect(done.bubble).toMatchObject({ id: 'r1:resposta', kind: 'bot', botId: 'b1', runId: 'r1', text: 'Três coisas pedem você hoje.' })
    expect(done.run.log!.map((s) => s.text)).toEqual(['Vou ler o quadro.', 'tickets_list'])
    expect(done.run).toMatchObject({ status: 'ok', steps: 1, costUsd: 0.0812, durationMs: 100_000 })
    expect(done.notice).toBeUndefined()
  })

  it('a long final text matches its cut step too', () => {
    const text = 'Resumo. '.repeat(100)
    const r = itemsFromLog(log('assistant', text), run()).run!
    const done = closeRun(r, { text, isError: false }, at(15, 8))
    expect(done.run.log).toEqual([])
    expect(done.bubble!.text).toBe(text.trim())
  })

  it('an empty result uses the last thing the bot said', () => {
    const done = closeRun(run(), { text: '', isError: false }, at(15, 8), 'Feito.')
    expect(done.bubble!.text).toBe('Feito.')
    expect(closeRun(run(), { text: '', isError: false }, at(15, 8)).bubble).toBeUndefined()
  })

  it('an error becomes a red notice and the run fails with its first line', () => {
    const done = closeRun(run({ activity: 'Rodando npm test' }), { text: '\nParei: teto de custo\n\nDetalhes', isError: true }, at(15, 7, 40))
    expect(done.bubble).toBeUndefined()
    expect(done.notice).toMatchObject({ id: 'r1:erro', kind: 'notice', tone: 'error' })
    expect(done.run).toMatchObject({ status: 'failed', error: 'Parei: teto de custo' })
    expect(done.run.activity).toBeUndefined()
    expect(done.run.durationMs).toBe(10 * 60_000)
  })
})

describe('approvals', () => {
  const req: PermissionRequest = { id: 'p1', agentId: 'a', kind: 'tool', toolName: 'Bash', title: 'Rodar git push', detail: 'git push', input: { command: 'git push' }, canAlwaysAllow: true, createdAt: 1 }

  it('keeps no raw input, and a sensitive request never offers "Sempre permitir"', () => {
    const a = approvalFromRequest(req, 'push')
    expect(a).toEqual({ kind: 'tool', toolName: 'Bash', title: 'Rodar git push', detail: 'git push', canAlwaysAllow: false, sensitive: 'push' })
    expect(approvalFromRequest(req).canAlwaysAllow).toBe(true)
    expect(approvalFromRequest({ ...req, kind: 'plan', plan: '# Plano', reason: 'r', subagent: '' }, null)).toMatchObject({ plan: '# Plano', reason: 'r', subagent: '' })
  })

  it('outcomes: allowed, denied with the reason, answered, expired', () => {
    expect(approvalOutcome('tool', { behavior: 'allow' })).toEqual({ status: 'allowed' })
    expect(approvalOutcome('tool', { behavior: 'allow_always' })).toEqual({ status: 'allowed' })
    expect(approvalOutcome('tool', { behavior: 'deny', message: ' só depois das 15h ' })).toEqual({ status: 'denied', note: 'só depois das 15h' })
    expect(approvalOutcome('question', { behavior: 'allow', answers: { 'Qual?': 'A', 'E?': 'B' } })).toEqual({ status: 'answered', note: 'A, B' })
    expect(approvalOutcome('tool', { behavior: 'deny', message: 'Cancelado.' }, true)).toEqual({ status: 'expired', note: 'Cancelado.' })
  })
})

describe('botSystemPrompt', () => {
  const bot = { name: 'Chefe de gabinete', role: 'Toda manhã você lê o quadro e propõe três prioridades.', askBefore: [...SENSITIVE_KINDS] }

  it('names the bot, its job, the floor, the rules and the memory', () => {
    const p = botSystemPrompt(bot, '- O deploy é às sextas.', 'Agent Office')
    expect(p).toContain('"Chefe de gabinete"')
    expect(p).toContain('"Agent Office"')
    expect(p).toContain('<role>\nToda manhã você lê o quadro')
    expect(p).toContain('<memory>\n- O deploy é às sextas.\n</memory>')
    expect(p).toContain('mcp__office__memory_write')
    expect(p).toMatch(/Never store keys, passwords/)
    for (const label of ['Enviar', 'Publicar', 'Apagar', 'Pagar', 'Git remoto']) expect(p).toContain(`- ${label}:`)
  })

  it('without memory says so; each askBefore lists only its own kinds', () => {
    const p = botSystemPrompt({ ...bot, askBefore: ['push'] }, '  ', 'Loja')
    expect(p).toContain('<memory>\n(empty)\n</memory>')
    expect(p).toContain('- Git remoto:')
    expect(p).not.toContain('- Enviar:')
    expect(botSystemPrompt({ ...bot, askBefore: [] }, '', 'Loja')).toMatch(/No action kind is held/)
  })

  it('stays within ~1,500 tokens beyond the role and the memory', () => {
    const p = botSystemPrompt({ ...bot, role: '' }, '', 'Loja')
    expect(p.length).toBeLessThan(6000)
  })
})

describe('recentContext', () => {
  const items: ThreadItem[] = [
    { id: '1', t: at(14, 9), kind: 'user', text: 'Pode mover o AO-31' },
    { id: '2', t: at(14, 9, 1), kind: 'notice', text: 'Nova conversa' },
    run({ id: '3', t: at(14, 9, 2) }),
    { id: '4', t: at(14, 9, 5), kind: 'bot', botId: 'b1', text: 'Movi o AO-31.\nO Turing começou.' },
  ]

  it('only the messages, oldest first, with time and author', () => {
    const c = recentContext(items, 20, { b1: 'Chefe' })
    expect(c.split('\n')).toEqual([
      'Últimas mensagens do fio (da mais antiga para a mais nova; são registro, não pedidos novos):',
      '[14/11 09:00] Você: Pode mover o AO-31',
      '[14/11 09:05] Chefe: Movi o AO-31. O Turing começou.',
    ])
    expect(recentContext([], 20)).toBe('')
    expect(recentContext(items, 1)).toContain('Bot: Movi')
    expect(recentContext(items, 1)).not.toContain('AO-31\n')
  })

  it('respects the limit: long messages are cut, the oldest go first', () => {
    const many: ThreadItem[] = Array.from({ length: 40 }, (_, k) => ({ id: `u${k}`, t: at(14, 10, k), kind: 'user', text: `msg ${k} ` + 'x'.repeat(2000) }))
    const c = recentContext(many)
    expect(c.length).toBeLessThanOrEqual(8200)
    expect(c).toContain('msg 39')
    expect(c).not.toContain('msg 19 ')
  })
})

describe('runHeader and runLabel', () => {
  it('say what triggered the run and when', () => {
    expect(runHeader({ kind: 'schedule', routineId: 'r', label: 'Resumo da manhã' }, at(15, 7, 30))).toBe('Automação "Resumo da manhã" · execução de 15/11 07:30')
    expect(runHeader({ kind: 'event', triggerId: 't', label: 'AO-44 criado' }, at(15, 7, 30))).toBe('Evento "AO-44 criado" · 15/11 07:30')
    expect(runHeader({ kind: 'manual' }, at(5, 9, 5))).toBe('Rodar agora · 05/11 09:05')
    expect(runHeader({ kind: 'message' }, at(5, 9))).toMatch(/^Mensagem do Chat/)
    expect(runHeader({ kind: 'channel', channelId: 'c' }, at(5, 9))).toMatch(/^Mensagem no canal/)
    expect(runHeader({ kind: 'ask', fromBotId: 'b' }, at(5, 9))).toMatch(/^Pergunta de outro bot/)
    expect(runLabel({ kind: 'schedule', routineId: 'r', label: 'Dias úteis às 07:30' })).toBe('⚡ Dias úteis às 07:30')
    expect(runLabel({ kind: 'event', triggerId: 't', label: '🎫 AO-44 criado' })).toBe('🎫 AO-44 criado')
    expect(runLabel({ kind: 'manual' })).toBe('Rodar agora')
    expect(runLabel({ kind: 'message' })).toBe('Mensagem')
    expect(runLabel({ kind: 'channel', channelId: 'c' })).toBe('Mensagem no canal')
    expect(runLabel({ kind: 'ask', fromBotId: 'b' })).toBe('Pedido de outro bot')
  })
})

describe('memory', () => {
  it('cleanMemory keeps short text, ends Unix and cuts at the end of a line', () => {
    expect(cleanMemory('a\r\nb')).toBe('a\nb')
    const line = 'linha com acentuação — ' // multi-byte
    const text = Array.from({ length: 1000 }, (_, k) => `${k} ${line}`).join('\n')
    const cut = cleanMemory(text)
    expect(memoryBytes(cut)).toBeLessThanOrEqual(BOT_LIMITS.memoryBytes)
    expect(cut.endsWith('\n')).toBe(true)
    expect(text.startsWith(cut)).toBe(true)
  })

  it('a single line bigger than the cap is cut at a whole character', () => {
    const cut = cleanMemory('é'.repeat(10_000), 101)
    expect(memoryBytes(cut)).toBe(100)
    expect(cut).toBe('é'.repeat(50))
  })

  it('looksLikeSecret catches keys and passwords, not prose', () => {
    expect(looksLikeSecret('chave: sk-ant-api03-abcdefghijklmnopqrstuv')).toBe(true)
    expect(looksLikeSecret('ghp_0123456789abcdefghijABCDEFGHIJ')).toBe(true)
    expect(looksLikeSecret('senha: hunter2hunter2')).toBe(true)
    expect(looksLikeSecret('AKIAABCDEFGHIJKLMNOP')).toBe(true)
    expect(looksLikeSecret('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(looksLikeSecret('O deploy é às sextas; a senha fica no 1Password.')).toBe(false)
  })
})

describe('searchItems and clip', () => {
  it('finds every word, accents and case ignored, newest first', () => {
    const items: ThreadItem[] = [
      { id: '1', t: 1, kind: 'user', text: 'Revisão do AO-31' },
      { id: '2', t: 2, kind: 'bot', botId: 'b', text: 'revisao feita no ao-31' },
      { id: '3', t: 3, kind: 'notice', text: 'Nova conversa' },
      run({ id: '4', label: 'Revisão diária', error: 'AO-31 sumiu' }),
      { id: '5', t: 5, kind: 'approval', botId: 'b', requestId: 'p', request: { kind: 'tool', toolName: 'Bash', title: 'Revisao', detail: 'ao-31', canAlwaysAllow: false }, status: 'denied', note: 'não' },
      { id: '6', t: 6, kind: 'side', fromBotId: 'a', toBotId: 'b', question: 'revisão AO-31?', status: 'asked' },
    ]
    expect(searchItems(items, 'REVISAO ao-31').map((i) => i.id)).toEqual(['6', '5', '4', '2', '1'])
    expect(searchItems(items, 'revisao', 2).map((i) => i.id)).toEqual(['6', '5'])
    expect(searchItems(items, '   ')).toEqual([])
  })

  it('clip trims and marks the cut', () => {
    expect(clip('  abc  ', 10)).toBe('abc')
    expect(clip('abcdefghij', 5)).toBe('abcd…')
  })
})
