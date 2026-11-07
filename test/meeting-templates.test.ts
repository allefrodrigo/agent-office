import { describe, expect, it } from 'vitest'
import type { MeetingRecipe, MeetingTemplate, ProjectFloor } from '@shared/types'
import {
  BUILTIN_MEETING_RECIPES,
  BUILTIN_MEETING_TEMPLATES,
  MEETING_RECIPE_LIMITS,
  MEETING_TEMPLATE_LIMITS,
  recipesFor,
  templateById,
  templatesFor,
} from '@shared/meeting-templates'
import {
  cleanMeetingRecipe,
  cleanMeetingTemplate,
  loadMeetingRecipes,
  loadMeetingTemplates,
  removeById,
  upsertMeetingRecipe,
  upsertMeetingTemplate,
} from '../src/main/meetings/templates'
import { cleanMeetings } from '../src/main/validate'
import { DEFAULT_MEETING_SETTINGS } from '@shared/meetings'

// RN-10: modelos de ata e receitas, embutidos e próprios (globais ou por andar).

const floors: ProjectFloor[] = [{ id: 'acme', name: 'Acme', cwd: '/tmp/acme' }]
const base = { name: 'Comitê', sections: [{ title: 'Pauta', hint: 'Os itens da pauta.' }], instruction: 'Seja breve.' }
const recipe = { command: '/pauta', name: 'Pauta', prompt: 'Monte a pauta da próxima reunião.' }
const tpl = (id: string, extra: Partial<MeetingTemplate> = {}): MeetingTemplate => ({ id, name: id, sections: [{ title: 'A', hint: '' }], instruction: '', ...extra })
const rcp = (id: string, extra: Partial<MeetingRecipe> = {}): MeetingRecipe => ({ id, command: `/${id}`, name: id, prompt: 'p', ...extra })

describe('embutidos', () => {
  it('traz os 8 modelos da spec, cada um com seções e orientação', () => {
    expect(BUILTIN_MEETING_TEMPLATES.map((t) => t.name)).toEqual([
      'Geral',
      '1:1',
      'Daily',
      'Cliente (discovery)',
      'Planejamento',
      'Kickoff de projeto',
      'Retrospectiva',
      'Entrevista',
    ])
    for (const t of BUILTIN_MEETING_TEMPLATES) {
      expect(t.sections.length).toBeGreaterThan(0)
      expect(t.instruction).not.toBe('')
      expect(t).not.toHaveProperty('floor')
    }
    expect(BUILTIN_MEETING_TEMPLATES[0].sections.map((s) => s.title)).toEqual(['Resumo', 'Pontos discutidos', 'Decisões', 'Itens de ação'])
  })

  it('traz as 6 receitas da spec', () => {
    expect(BUILTIN_MEETING_RECIPES.map((r) => r.command)).toEqual(['/follow-up', '/decisoes', '/tickets', '/resumo', '/riscos', '/prd'])
  })

  it('os embutidos passam na própria limpeza', () => {
    for (const t of BUILTIN_MEETING_TEMPLATES) expect(cleanMeetingTemplate(t, floors)).toEqual(t)
    for (const r of BUILTIN_MEETING_RECIPES) expect(cleanMeetingRecipe(r, floors)).toEqual(r)
  })
})

describe('cleanMeetingTemplate', () => {
  it('modelo mínimo: textos aparados, id novo, sem andar', () => {
    const t = cleanMeetingTemplate({ ...base, name: '  Comitê ', instruction: ' Seja breve.\n' }, floors)
    expect(t.name).toBe('Comitê')
    expect(t.instruction).toBe('Seja breve.')
    expect(t.id).toMatch(/^[\w-]{1,64}$/)
    expect(t).not.toHaveProperty('floor')
  })

  it('guarda id seguro e andar existente (ou o térreo); troca id inseguro', () => {
    expect(cleanMeetingTemplate({ ...base, id: 'comite', floor: 'acme' }, floors)).toEqual({ id: 'comite', floor: 'acme', ...base })
    expect(cleanMeetingTemplate({ ...base, floor: 'terreo' }, floors).floor).toBe('terreo')
    expect(cleanMeetingTemplate({ ...base, floor: '' }, floors)).not.toHaveProperty('floor')
    expect(cleanMeetingTemplate({ ...base, id: '../x' }, floors).id).not.toBe('../x')
  })

  it('recusa campos extras, no modelo e na seção', () => {
    expect(() => cleanMeetingTemplate({ ...base, hack: 1 }, floors)).toThrow(/Campo desconhecido no modelo de ata: hack/)
    expect(() => cleanMeetingTemplate({ ...base, sections: [{ title: 'A', hint: '', x: 1 }] }, floors)).toThrow(/Campo desconhecido na seção: x/)
  })

  it('recusa textos acima do limite', () => {
    const L = MEETING_TEMPLATE_LIMITS
    expect(() => cleanMeetingTemplate({ ...base, name: 'a'.repeat(L.name + 1) }, floors)).toThrow(/nome/)
    expect(() => cleanMeetingTemplate({ ...base, instruction: 'a'.repeat(L.instruction + 1) }, floors)).toThrow(/orientação/)
    expect(() => cleanMeetingTemplate({ ...base, sections: [{ title: 'a'.repeat(L.sectionTitle + 1), hint: '' }] }, floors)).toThrow(/título/)
    expect(() => cleanMeetingTemplate({ ...base, sections: [{ title: 'A', hint: 'a'.repeat(L.sectionHint + 1) }] }, floors)).toThrow(/dica/)
    expect(cleanMeetingTemplate({ ...base, instruction: 'a'.repeat(L.instruction) }, floors).instruction).toHaveLength(L.instruction)
  })

  it('recusa formas erradas, sem seções, seções demais e andar inexistente', () => {
    expect(() => cleanMeetingTemplate(null, floors)).toThrow(/inválido/)
    expect(() => cleanMeetingTemplate([base], floors)).toThrow(/inválido/)
    expect(() => cleanMeetingTemplate({ ...base, name: '   ' }, floors)).toThrow(/nome/)
    expect(() => cleanMeetingTemplate({ ...base, name: 3 }, floors)).toThrow(/nome/)
    expect(() => cleanMeetingTemplate({ ...base, sections: [] }, floors)).toThrow(/seções/)
    expect(() => cleanMeetingTemplate({ ...base, sections: 'x' }, floors)).toThrow(/seções/)
    const many = Array.from({ length: MEETING_TEMPLATE_LIMITS.sections + 1 }, () => ({ title: 'A', hint: '' }))
    expect(() => cleanMeetingTemplate({ ...base, sections: many }, floors)).toThrow(/seções/)
    expect(() => cleanMeetingTemplate({ ...base, sections: ['A'] }, floors)).toThrow(/Seção inválida/)
    expect(() => cleanMeetingTemplate({ ...base, floor: 'sumiu' }, floors)).toThrow(/andar/)
    expect(() => cleanMeetingTemplate({ ...base, floor: 7 }, floors)).toThrow(/andar/)
  })
})

describe('cleanMeetingRecipe', () => {
  it('receita válida, com comando em minúsculas e andar', () => {
    expect(cleanMeetingRecipe({ ...recipe, id: 'pauta', command: ' /Pauta ', floor: 'acme' }, floors)).toEqual({ id: 'pauta', ...recipe, floor: 'acme' })
  })

  it('recusa campo extra, comando fora do formato e textos acima do limite', () => {
    const L = MEETING_RECIPE_LIMITS
    expect(() => cleanMeetingRecipe({ ...recipe, tools: ['Bash'] }, floors)).toThrow(/Campo desconhecido na receita: tools/)
    for (const command of ['pauta', '/', '/com espaço', '/1abc', '/a_b', `/${'a'.repeat(L.command)}`, 3]) {
      expect(() => cleanMeetingRecipe({ ...recipe, command }, floors)).toThrow(/comando/)
    }
    expect(() => cleanMeetingRecipe({ ...recipe, name: 'a'.repeat(L.name + 1) }, floors)).toThrow(/nome/)
    expect(() => cleanMeetingRecipe({ ...recipe, prompt: 'a'.repeat(L.prompt + 1) }, floors)).toThrow(/pedido/)
    expect(() => cleanMeetingRecipe({ ...recipe, prompt: '' }, floors)).toThrow(/pedido/)
    expect(() => cleanMeetingRecipe({ ...recipe, floor: 'sumiu' }, floors)).toThrow(/andar/)
    expect(() => cleanMeetingRecipe('x', floors)).toThrow(/inválida/)
  })
})

describe('loadMeetingTemplates / loadMeetingRecipes', () => {
  it('derruba item quebrado, deixa global o de andar que sumiu e fica com o primeiro id repetido', () => {
    const list = loadMeetingTemplates([{ ...base, id: 'a', floor: 'sumiu' }, { ...base, id: 'a', name: 'Outro' }, { ...base, hack: 1 }, 'x', { ...base, id: 't', floor: 'terreo' }], floors)
    expect(list).toEqual([{ id: 'a', ...base }, { id: 't', floor: 'terreo', ...base }])
    expect(loadMeetingRecipes([{ ...recipe, id: 'p', floor: 'sumiu' }, { command: 'x' }], floors)).toEqual([{ id: 'p', ...recipe }])
  })

  it('não é lista: vazio; acima do limite: corta', () => {
    expect(loadMeetingTemplates(undefined, floors)).toEqual([])
    expect(loadMeetingRecipes({}, floors)).toEqual([])
    const many = Array.from({ length: MEETING_RECIPE_LIMITS.count + 5 }, (_, i) => ({ ...recipe, id: `r${i}` }))
    expect(loadMeetingRecipes(many, floors)).toHaveLength(MEETING_RECIPE_LIMITS.count)
  })
})

describe('upsert e remoção', () => {
  it('troca no lugar, acrescenta no fim e respeita o limite', () => {
    expect(upsertMeetingTemplate([tpl('a'), tpl('b')], tpl('a', { name: 'novo' })).map((t) => t.name)).toEqual(['novo', 'b'])
    expect(upsertMeetingRecipe([rcp('a')], rcp('b')).map((r) => r.id)).toEqual(['a', 'b'])
    const full = Array.from({ length: MEETING_TEMPLATE_LIMITS.count }, (_, i) => tpl(`t${i}`))
    expect(() => upsertMeetingTemplate(full, tpl('nova'))).toThrow(/Limite de 100 modelos de ata/)
    expect(upsertMeetingTemplate(full, tpl('t3', { name: 'ok' }))[3].name).toBe('ok')
    expect(removeById([rcp('a'), rcp('b')], 'a').map((r) => r.id)).toEqual(['b'])
  })
})

describe('templatesFor / recipesFor', () => {
  const custom = [tpl('global'), tpl('so-acme', { floor: 'acme' }), tpl('outro', { floor: 'beta' })]

  it('sem próprios: só os embutidos, em ordem', () => {
    expect(templatesFor('acme', undefined)).toEqual(BUILTIN_MEETING_TEMPLATES)
    expect(recipesFor(null, [])).toEqual(BUILTIN_MEETING_RECIPES)
  })

  it('escopo por andar: globais em todo andar, os do andar só nele', () => {
    expect(templatesFor('acme', custom).slice(8).map((t) => t.id)).toEqual(['global', 'so-acme'])
    expect(templatesFor('beta', custom).slice(8).map((t) => t.id)).toEqual(['global', 'outro'])
    expect(templatesFor(null, custom).slice(8).map((t) => t.id)).toEqual(['global'])
    expect(templatesFor('terreo', [tpl('t', { floor: 'terreo' })]).map((t) => t.id)).toContain('t')
  })

  it('mesmo id: global substitui o embutido no lugar e o do andar vence o global', () => {
    const list = [tpl('geral', { floor: 'acme', name: 'Geral do Acme' }), tpl('geral', { name: 'Geral da casa' })]
    expect(templatesFor('acme', list)[0].name).toBe('Geral do Acme')
    expect(templatesFor('beta', list)[0].name).toBe('Geral da casa')
    expect(templatesFor('acme', list)).toHaveLength(8)
  })

  it('receitas: mesmo id ou mesmo comando, vence a camada mais específica', () => {
    const list = [rcp('resumo', { prompt: 'global' }), rcp('meu-resumo', { command: '/resumo', floor: 'acme', prompt: 'acme' }), rcp('extra', { floor: 'acme' })]
    const acme = recipesFor('acme', list)
    expect(acme.map((r) => r.command)).toEqual(['/follow-up', '/decisoes', '/tickets', '/resumo', '/riscos', '/prd', '/extra'])
    expect(acme.find((r) => r.command === '/resumo')?.prompt).toBe('acme')
    expect(recipesFor('beta', list).find((r) => r.command === '/resumo')?.prompt).toBe('global')
  })

  it('templateById: acha no andar ou cai no Geral', () => {
    expect(templateById('daily', 'acme', []).name).toBe('Daily')
    expect(templateById('so-acme', 'acme', custom).id).toBe('so-acme')
    expect(templateById('so-acme', 'beta', custom).id).toBe('geral')
    expect(templateById(undefined, null, undefined).id).toBe('geral')
  })
})

describe('cleanMeetings', () => {
  const current = { ...DEFAULT_MEETING_SETTINGS, templates: [tpl('a')], recipes: [rcp('r')] }

  it('sem as listas no patch, mantém as atuais (e não as compartilha)', () => {
    const next = cleanMeetings({ outra: 1 }, current, floors)
    expect(next).toEqual(current)
    expect(next.templates).not.toBe(current.templates)
    expect(cleanMeetings(null, current, floors)).toEqual(current)
    expect(cleanMeetings({ templates: 'x' }, current, floors)).toEqual(current)
  })

  it('troca as listas item a item, derrubando os quebrados', () => {
    const next = cleanMeetings({ templates: [{ ...base, id: 'b' }, { hack: 1 }], recipes: [] }, current, floors)
    expect(next).toEqual({ ...DEFAULT_MEETING_SETTINGS, templates: [{ id: 'b', ...base }], recipes: [] })
  })

  // RN-13: os outros ajustes de Configurações → Reuniões.
  it('aplica os ajustes válidos e mantém as listas', () => {
    const patch = {
      lang: 'auto',
      whisperModel: 'ggml-base.bin',
      defaultSources: 'mic',
      autoAta: false,
      ataModel: 'opus',
      doNotDisturb: false,
      autoStopMin: 30,
      keepAudio: true,
      retentionDays: 90,
      agentsReadAtas: false,
    }
    expect(cleanMeetings(patch, current, floors)).toEqual({ ...current, ...patch })
  })

  it('números fora da faixa vão para a borda; frações arredondam', () => {
    const at = (p: Record<string, unknown>) => cleanMeetings(p, current, floors)
    expect(at({ autoStopMin: 1 }).autoStopMin).toBe(5)
    expect(at({ autoStopMin: 0 }).autoStopMin).toBe(5)
    expect(at({ autoStopMin: 999 }).autoStopMin).toBe(120)
    expect(at({ autoStopMin: 22.6 }).autoStopMin).toBe(23)
    expect(at({ retentionDays: -10 }).retentionDays).toBe(0)
    expect(at({ retentionDays: 100_000 }).retentionDays).toBe(3650)
  })

  it('tipo errado, valor fora da lista ou não finito mantém o atual', () => {
    const bad = {
      lang: 'es',
      whisperModel: '../../etc/passwd',
      defaultSources: 'system',
      autoAta: 'sim',
      ataModel: 'haiku',
      doNotDisturb: 1,
      autoStopMin: '30',
      keepAudio: null,
      retentionDays: Number.POSITIVE_INFINITY,
      agentsReadAtas: 'true',
    }
    expect(cleanMeetings(bad, current, floors)).toEqual(current)
    expect(cleanMeetings({ autoStopMin: Number.NaN }, current, floors).autoStopMin).toBe(15)
  })

  it('modelo do whisper: só o nome de um arquivo ggml, ou vazio para o melhor achado', () => {
    const model = (v: unknown) => cleanMeetings({ whisperModel: v }, { ...current, whisperModel: 'ggml-small.bin' }, floors).whisperModel
    expect(model('')).toBe('')
    expect(model('ggml-large-v3-turbo.bin')).toBe('ggml-large-v3-turbo.bin')
    expect(model('/Users/x/ggml-base.bin')).toBe('ggml-small.bin')
    expect(model('ggml-base.bin; rm -rf ~')).toBe('ggml-small.bin')
    expect(model('base.bin')).toBe('ggml-small.bin')
  })
})
