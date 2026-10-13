import { describe, expect, it } from 'vitest'
import type { AgentTemplate, ProjectFloor } from '@shared/types'
import { cleanLook, cleanTemplate, loadTemplates, upsertTemplate } from '../src/main/templates'
import { renderInstruction, TEMPLATE_LIMITS, templatesFor, ticketRef, usesTicket } from '@shared/templates'

// AO-37: modelos de agente, checados no main (cleanTemplate) e preenchidos no renderer.

const floors: ProjectFloor[] = [{ id: 'acme', name: 'Acme', cwd: '/tmp/acme' }]
const look = { skin: '#f1c27d', hair: '#2d3436', hairStyle: 2, shirt: '#0984e3', pants: '#2d3436', shoes: '#000000' }
const base = { name: 'Revisor', permissionMode: 'default', instruction: 'Revise {pasta}' }
const tpl = (id: string, extra: Partial<AgentTemplate> = {}): AgentTemplate => ({ id, name: 'Revisor', permissionMode: 'default', instruction: '', ...extra })

describe('cleanLook', () => {
  it('aceita uma aparência completa', () => {
    expect(cleanLook(look)).toEqual(look)
  })

  it('recusa cor fora de #rrggbb, penteado fora da lista e campo a mais', () => {
    expect(cleanLook({ ...look, skin: 'red' })).toBeUndefined()
    expect(cleanLook({ ...look, hairStyle: 99 })).toBeUndefined()
    expect(cleanLook({ ...look, hairStyle: 1.5 })).toBeUndefined()
    expect(cleanLook({ ...look, hat: '#ffffff' })).toBeUndefined()
    expect(cleanLook([look])).toBeUndefined()
    expect(cleanLook(null)).toBeUndefined()
  })
})

describe('cleanTemplate', () => {
  it('modelo mínimo: nome e instrução aparados, id novo', () => {
    const t = cleanTemplate({ ...base, name: '  Revisor  ', instruction: '  Revise {pasta}\n' }, floors)
    expect(t.name).toBe('Revisor')
    expect(t.instruction).toBe('Revise {pasta}')
    expect(t.id).toMatch(/^[\w-]{1,64}$/)
    expect(t).not.toHaveProperty('model')
    expect(t).not.toHaveProperty('floor')
  })

  it('guarda id válido, aparência, modelo, esforço e andar existente', () => {
    const t = cleanTemplate({ ...base, id: 'tpl-1', look, model: 'claude-opus-5-5[1m]', effort: 'high', floor: 'acme' }, floors)
    expect(t).toEqual({ id: 'tpl-1', name: 'Revisor', permissionMode: 'default', instruction: 'Revise {pasta}', look, model: 'claude-opus-5-5[1m]', effort: 'high', floor: 'acme' })
  })

  it('troca id inválido por um novo e ignora modelo, esforço e andar vazios', () => {
    const t = cleanTemplate({ ...base, id: '../x', model: '', effort: '', floor: '' }, floors)
    expect(t.id).not.toBe('../x')
    expect(t).not.toHaveProperty('model')
    expect(t).not.toHaveProperty('effort')
    expect(t).not.toHaveProperty('floor')
  })

  it('recusa entrada que não é objeto e campo desconhecido', () => {
    expect(() => cleanTemplate(null, floors)).toThrow('Modelo inválido.')
    expect(() => cleanTemplate([base], floors)).toThrow('Modelo inválido.')
    expect(() => cleanTemplate({ ...base, cwd: '/' }, floors)).toThrow('Campo desconhecido no modelo: cwd.')
  })

  it('recusa nome vazio ou longo e instrução longa ou de outro tipo', () => {
    expect(() => cleanTemplate({ ...base, name: '   ' }, floors)).toThrow(/Dê um nome/)
    expect(() => cleanTemplate({ ...base, name: 'x'.repeat(TEMPLATE_LIMITS.name + 1) }, floors)).toThrow(/Dê um nome/)
    expect(() => cleanTemplate({ ...base, instruction: 'x'.repeat(TEMPLATE_LIMITS.instruction + 1) }, floors)).toThrow(/passa de/)
    expect(() => cleanTemplate({ ...base, instruction: 42 }, floors)).toThrow(/passa de/)
  })

  it('recusa modo de permissão, aparência, modelo, esforço e andar fora do esperado', () => {
    expect(() => cleanTemplate({ ...base, permissionMode: 'yolo' }, floors)).toThrow(/modo de permissão/)
    expect(() => cleanTemplate({ ...base, look: { ...look, skin: 'x' } }, floors)).toThrow('Aparência inválida no modelo.')
    expect(() => cleanTemplate({ ...base, model: 'opus; rm -rf /' }, floors)).toThrow('Modelo de IA inválido.')
    expect(() => cleanTemplate({ ...base, effort: 'turbo' }, floors)).toThrow('Esforço inválido.')
    expect(() => cleanTemplate({ ...base, floor: 'sumiu' }, floors)).toThrow('Esse andar não existe mais.')
  })
})

describe('loadTemplates', () => {
  it('sem modelos (office.json antigo) devolve lista vazia', () => {
    expect(loadTemplates(undefined, floors)).toEqual([])
    expect(loadTemplates({ a: 1 }, floors)).toEqual([])
  })

  it('descarta os quebrados e os ids repetidos; o de andar apagado vira global', () => {
    const out = loadTemplates(
      [
        { ...base, id: 'a' },
        { ...base, id: 'b', permissionMode: 'yolo' },
        'lixo',
        { ...base, id: 'a', name: 'Duplicado' },
        { ...base, id: 'c', floor: 'apagado' },
        { ...base, id: 'd', floor: 'acme' },
      ],
      floors,
    )
    expect(out.map((t) => t.id)).toEqual(['a', 'c', 'd'])
    expect(out[0].name).toBe('Revisor')
    expect(out[1]).not.toHaveProperty('floor')
    expect(out[2].floor).toBe('acme')
  })

  it('lê no máximo TEMPLATE_LIMITS.count modelos', () => {
    const many = Array.from({ length: TEMPLATE_LIMITS.count + 5 }, (_, i) => ({ ...base, id: `t${i}` }))
    expect(loadTemplates(many, floors)).toHaveLength(TEMPLATE_LIMITS.count)
  })
})

describe('upsertTemplate', () => {
  it('troca no lugar quando o id existe e acrescenta no fim quando não', () => {
    const list = [tpl('a'), tpl('b')]
    expect(upsertTemplate(list, tpl('a', { name: 'Novo' })).map((x) => x.name)).toEqual(['Novo', 'Revisor'])
    expect(upsertTemplate(list, tpl('c')).map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(list).toHaveLength(2)
  })

  it('recusa um modelo novo além do limite, mas ainda edita os que existem', () => {
    const full = Array.from({ length: TEMPLATE_LIMITS.count }, (_, i) => tpl(`t${i}`))
    expect(() => upsertTemplate(full, tpl('extra'))).toThrow(/Limite de/)
    expect(upsertTemplate(full, tpl('t0', { name: 'Editado' }))[0].name).toBe('Editado')
  })
})

describe('shared/templates', () => {
  const list = [tpl('global'), tpl('acme', { floor: 'acme' }), tpl('outro', { floor: 'outro' })]

  it('templatesFor mostra os globais e os do andar, na ordem salva', () => {
    expect(templatesFor(list, 'acme').map((t) => t.id)).toEqual(['global', 'acme'])
    expect(templatesFor(list, null).map((t) => t.id)).toEqual(['global'])
    expect(templatesFor(undefined, 'acme')).toEqual([])
  })

  it('usesTicket e ticketRef', () => {
    expect(usesTicket('Feche {ticket}')).toBe(true)
    expect(usesTicket('Revise {pasta}')).toBe(false)
    expect(ticketRef({ key: 'AO-37', title: 'Modelos' })).toBe('AO-37 ("Modelos")')
  })

  it('renderInstruction troca todas as variáveis e apara o resultado', () => {
    expect(renderInstruction(' Em {pasta}: {ticket}; de novo {pasta} ', { folder: '/p', ticket: 'AO-1' })).toBe('Em /p: AO-1; de novo /p')
    expect(renderInstruction('Faça {ticket}', { folder: '/p' })).toBe('Faça')
  })
})
