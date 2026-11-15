import { describe, expect, it } from 'vitest'
import { BOT_COLORS, BOT_LIMITS, SENSITIVE_KINDS } from '@shared/types'
import {
  BLANK_TEMPLATE_ID,
  BOT_TEMPLATES,
  draftFromTemplate,
  FIRST_MESSAGES,
  templateAutomation,
  templateById,
} from '@shared/bot-templates'
import { draftError } from '@shared/bots-view'
import { scheduleError } from '@shared/schedule'

// CB-10: a galeria do "＋ Novo bot" (docs/prd/chat-de-bots.md, "Novo bot").

describe('BOT_TEMPLATES', () => {
  it('traz os 8 modelos da spec, com ids únicos', () => {
    expect(BOT_TEMPLATES.map((t) => t.name)).toEqual([
      'Chefe de gabinete',
      'Triagem do quadro',
      'Caçador de bugs',
      'Revisor do dia',
      'Ata em tickets',
      'Vigia de dependências',
      'Relator da semana',
      'Vigia de concorrentes',
    ])
    expect(new Set(BOT_TEMPLATES.map((t) => t.id)).size).toBe(8)
    expect(BOT_TEMPLATES.some((t) => t.id === BLANK_TEMPLATE_ID)).toBe(false)
  })

  it.each(BOT_TEMPLATES.map((t) => [t.name, t] as const))('%s: função, cor, permissões e agenda válidas', (_name, t) => {
    expect(t.role.trim().length).toBeGreaterThan(200)
    expect(t.role.length).toBeLessThanOrEqual(BOT_LIMITS.role)
    // what it does each run, what it must never do, how it reports
    expect(t.role).toMatch(/Em cada rodada/)
    expect(t.role).toMatch(/Nunca/)
    expect(t.role).toMatch(/Como reportar/)
    expect(t.name.length).toBeLessThanOrEqual(BOT_LIMITS.name)
    expect(t.tagline.length).toBeGreaterThan(0)
    expect(t.tagline.length).toBeLessThanOrEqual(BOT_LIMITS.tagline)
    expect(BOT_COLORS).toContain(t.color)
    expect(t.permissionMode).not.toBe('bypassPermissions')
    expect(t.askBefore.length).toBeGreaterThan(0)
    for (const k of t.askBefore) expect(SENSITIVE_KINDS).toContain(k)
    // every sensitive kind waits for a yes by default
    expect([...t.askBefore].sort()).toEqual([...SENSITIVE_KINDS].sort())
    expect(t.schedule || t.event).toBeTruthy()
    if (t.schedule) expect(scheduleError(t.schedule)).toBeNull()
  })

  it('só o Caçador de bugs trabalha numa cópia isolada', () => {
    expect(BOT_TEMPLATES.filter((t) => t.worktree).map((t) => t.id)).toEqual(['cacador-de-bugs'])
  })

  it('usa as ferramentas do quadro e das atas do escritório', () => {
    const roles = BOT_TEMPLATES.map((t) => t.role).join('\n')
    expect(roles).toContain('mcp__office__tickets_list')
    expect(roles).toContain('mcp__office__meeting_get')
    expect(roles).toContain('mcp__office__ticket_create')
  })

  it('mostra a automação de cada modelo como na spec', () => {
    expect(BOT_TEMPLATES.map(templateAutomation)).toEqual([
      'Dias úteis às 07:30',
      'A cada 30 min',
      'Quando nasce um ticket #bug',
      'Dias úteis às 18:00',
      'Quando uma ata fica pronta',
      'Segundas às 10:00',
      'Sextas às 17:00',
      'Segundas às 07:00',
    ])
    expect(templateAutomation({})).toBe('Só quando você chamar')
  })

  it('oferece três primeiras mensagens', () => {
    expect(FIRST_MESSAGES).toHaveLength(3)
  })
})

describe('draftFromTemplate', () => {
  it('preenche o formulário com o modelo e os padrões do app', () => {
    const t = templateById('chefe-de-gabinete')!
    const d = draftFromTemplate(t, { floor: 'ao', model: 'sonnet', effort: 'high' })
    expect(d).toMatchObject({
      name: 'Chefe de gabinete',
      floor: 'ao',
      model: 'sonnet',
      effort: 'high',
      permissionMode: 'default',
      apps: 'all',
      worktree: false,
      templateId: t.id,
      dailyBudgetUsd: 0,
    })
    expect(d.askBefore).toEqual([...SENSITIVE_KINDS])
    expect(d.schedule).toEqual({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30' })
    expect(draftError(d)).toBeNull()
    // a copy: changing the draft leaves the template alone
    if (d.schedule?.kind === 'weekly') d.schedule.days.push(6)
    d.askBefore!.pop()
    expect(t.schedule).toEqual({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30' })
    expect(t.askBefore).toHaveLength(5)
  })

  it('"Em branco" começa vazio, com tudo marcado e os padrões vazios fora', () => {
    const d = draftFromTemplate(undefined, { floor: 'terreo', cwd: '/tmp/proj', model: '', effort: '', color: BOT_COLORS[2] })
    expect(d).toMatchObject({
      name: '',
      role: '',
      floor: 'terreo',
      cwd: '/tmp/proj',
      color: BOT_COLORS[2],
      permissionMode: 'default',
      worktree: false,
    })
    expect(d.model).toBeUndefined()
    expect(d.effort).toBeUndefined()
    expect(d.schedule).toBeUndefined()
    expect(d.templateId).toBeUndefined()
    expect(d.askBefore).toEqual([...SENSITIVE_KINDS])
    expect(draftError(d)).toMatch(/nome/)
  })

  it('o caçador de bugs nasce com worktree e sem agenda', () => {
    const d = draftFromTemplate(templateById('cacador-de-bugs'), { floor: 'ao' })
    expect(d.worktree).toBe(true)
    expect(d.schedule).toBeUndefined()
    expect(templateById('nada')).toBeUndefined()
  })
})
